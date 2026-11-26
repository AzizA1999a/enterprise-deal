/* Headless full games with simulated players, to check the rules end to end.
   Run:  node test/simulate.js [players] [games]                               */
const path = require("path");
const fs = require("fs");
const assert = require("assert");

let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;

function load(f) { new Function(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").replace(/window\.B2B_CONFIG/g, "globalThis.B2B_CONFIG"))(); }
load("config.js"); load("engine.js"); load("api.js"); load("driver.js"); load("stats.js");

const B2B = globalThis.B2B, cfg = globalThis.B2B_CONFIG, api = B2B.localApi, E = B2B.engine; // always offline, never the live database
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cards.json"), "utf8"));
const problems = E.validateCards(cards);
assert.deepStrictEqual(problems, [], "cards.json problems: " + problems.join(" | "));
assert.strictEqual(cards.rounds.length, cfg.game.rounds.length, "cards.json needs wording for every round in config.js");
const N = E.roundCount(cfg), P = cfg.payoff;
const refuses = async (job, code, why) => { let err = null; try { await job; } catch (e) { err = e.code; } assert.strictEqual(err, code, why); };

async function playGame(nPlayers, quiet) {
  const pin = "1234", { code } = await api.createGame(pin), ctx = { code, pin, cards, cfg, api };
  B2B.bots.plans = {};
  await B2B.bots.add(ctx, nPlayers - 2, []);
  let hs = await api.hostState(code, pin);
  await B2B.driver.start(ctx, hs);
  await B2B.bots.add(ctx, 2, hs.players.map(p => p.name));          // two late joiners during the briefing
  const seen = [];                                                   // what the projector could see, round by round
  for (let i = 0; i < 6000; i++) {
    hs = await api.hostState(code, pin);
    if (!(await B2B.driver.tick(ctx, hs))) await B2B.bots.tick(ctx, hs);
    const pub = await api.public(code), g = pub.game;
    // nothing about a round leaks before it closes
    assert.ok(pub.closed.every(d => d.round <= E.closedRounds(g)), "the projector shows no decision from an open round");
    if (g.phase === "open") {
      const buyer = hs.players.find(p => p.role === "buyer" && p.token);
      const st = await api.state(code, buyer.token);
      assert.ok(!st.mine || st.mine.delivered === null, "a buyer cannot see the outcome before the round closes");
      assert.ok(st.sellers.every(s => !("ready" in s)), "a buyer is never told which start-ups are ready");
      assert.ok(st.sellers.every(s => (s.proof === null) === (g.round < E.serverRules(cfg).proofFrom)), "proof is shown only from the proof round");
    }
    if (g.phase === "reveal" || g.phase === "locked") seen[g.round] = pub.closed.filter(d => d.round === g.round).length;
    fakeNow += 500;
    if (g.phase === "locked") break;
  }
  hs = await api.hostState(code, pin);
  const pub = await api.public(code);
  assert.strictEqual(hs.game.phase, "locked", "the game ends by itself");
  assert.strictEqual(hs.game.round, N);
  assert.ok(hs.players.every(p => p.role), "everyone has a role, late joiners included");
  const sellers = hs.players.filter(p => p.role === "seller"), buyers = hs.players.filter(p => p.role === "buyer");
  assert.ok(sellers.some(s => !s.card.ready) && sellers.some(s => s.card.ready), "some start-ups are ready and some are not");
  assert.ok(sellers.every(s => !s.card.proof || s.card.ready), "only a ready start-up can hold proof");
  assert.strictEqual(new Set(sellers.map(s => s.card.code)).size, sellers.length, "deal codes are unique");
  assert.ok(sellers.every(s => /^\d{2}$/.test(s.card.code)));
  for (const b of buyers) {
    assert.ok(b.card.knows.length <= cfg.game.introsPerBuyer);
    for (const k of b.card.knows) assert.strictEqual(k.ready, sellers.find(s => s.id === k.id).card.ready, "an introduction tells the truth");
  }
  for (let r = 1; r <= N; r++) {
    const rows = hs.deals.filter(d => d.round === r), rule = E.roundRule(cfg, r);
    assert.strictEqual(new Set(rows.map(d => d.buyer_id)).size, rows.length, "one decision per buyer per round");
    const signed = rows.filter(d => d.kind !== "stay");
    assert.strictEqual(new Set(signed.map(d => d.seller_id)).size, signed.length, "one customer per start-up per round");
    for (const d of signed) {
      const s = sellers.find(x => x.id === d.seller_id);
      assert.strictEqual(d.delivered, s.card.ready, "a start-up delivers exactly when its product is ready");
      assert.ok(rule.pilot || d.kind === "full", "no pilots before the pilot round");
    }
    assert.strictEqual(seen[r], rows.length, "the reveal shows every decision of the round");
  }
  // points
  for (const p of hs.players) {
    const sc = E.score(p, hs.deals, N, cfg);
    let expect = 0;
    for (let r = 1; r <= N; r++) {
      const d = hs.deals.find(x => x.round === r && (p.role === "seller" ? x.seller_id === p.id : x.buyer_id === p.id));
      if (p.role === "seller") expect += !d ? 0 : d.kind === "pilot" ? P.sellerPilot : P.sellerFull;
      else expect += !d || d.kind === "stay" ? P.stay : d.kind === "pilot" ? (d.delivered ? P.pilotWin : P.pilotLose) : (d.delivered ? P.fullWin : P.fullLose);
    }
    assert.strictEqual(sc.total, expect, "points follow the payoff table");
  }
  assert.ok(pub.full && pub.full.players.every(p => !("token" in p)), "public data has no tokens");
  const st = B2B.stats.compute(pub.full, cards);
  const live = B2B.stats.liveRounds(pub.players, pub.closed, N, cards);
  st.rounds.forEach((x, i) => assert.deepStrictEqual([live[i].signed, live[i].burned, live[i].stayed], [x.signed, x.burned, x.stayed], "the reveal and the final results agree"));
  assert.strictEqual(B2B.exporter.decisionsCsv(pub.full, cfg).trim().split("\r\n").length, buyers.length * N + 1);
  B2B.exporter.playersCsv(pub.full, cfg);
  B2B.exporter.eventsCsv(await api.hostEvents(code, pin), hs.players);
  if (!quiet) console.log(JSON.stringify(st, null, 1));
  return st;
}

// The referee, step by step.
async function refereeRules() {
  const pin = "1234", { code } = await api.createGame(pin), ctx = { code, pin, cards, cfg, api };
  B2B.bots.plans = {};
  await B2B.bots.add(ctx, 12, []);
  let hs = await api.hostState(code, pin);
  await refuses(api.sign(code, hs.players[0].token, "11", "full"), "not_joined", "nobody can sign before roles are dealt");
  await B2B.driver.start(ctx, hs);
  hs = await api.hostState(code, pin);
  const buyers = hs.players.filter(p => p.role === "buyer"), sellers = hs.players.filter(p => p.role === "seller");
  const [b1, b2, b3] = buyers, [s1, s2] = sellers;
  await refuses(api.sign(code, b1.token, s1.card.code, "full"), "not_open", "no signing during the briefing");
  fakeNow += cfg.briefingSeconds * 1000 + 1;
  await B2B.driver.tick(ctx, await api.hostState(code, pin));
  assert.strictEqual((await api.public(code)).game.round, 1);
  await refuses(api.sign(code, s1.token, s2.card.code, "full"), "not_joined", "a start-up cannot sign");
  await refuses(api.sign(code, b1.token, "00", "full"), "bad_code", "an unknown deal code is refused");
  await refuses(api.sign(code, b1.token, s1.card.code, "pilot"), "no_pilot", "no pilot in round 1");
  await api.sign(code, b1.token, s1.card.code, "full");
  await refuses(api.sign(code, b1.token, s2.card.code, "full"), "already_decided", "one decision per round");
  await refuses(api.sign(code, b2.token, s1.card.code, "full"), "seller_busy", "a start-up takes one customer per round");
  await api.sign(code, b2.token, null, "stay");
  await refuses(api.sign(code, b2.token, s2.card.code, "full"), "already_decided", "staying is a decision too");
  let pub = await api.public(code);
  assert.deepStrictEqual([pub.decided_now, pub.signed_now, pub.closed.length], [2, 1, 0], "during a round the projector shows counts only");
  assert.strictEqual((await api.state(code, s1.token)).mine.buyer_id, b1.id, "a start-up sees who signed it");
  fakeNow += cfg.roundSeconds * 1000 + 1;
  await B2B.driver.tick(ctx, await api.hostState(code, pin));
  pub = await api.public(code);
  assert.strictEqual(pub.game.phase, "reveal");
  assert.strictEqual(pub.closed.find(d => d.buyer_id === b1.id).delivered, s1.card.ready, "the reveal shows whether the start-up delivered");
  await refuses(api.sign(code, b3.token, s2.card.code, "full"), "not_open", "no signing during a reveal");
  await api.host(code, pin, "hold");
  fakeNow += cfg.revealSeconds * 1000 * 3;
  assert.strictEqual(await B2B.driver.tick(ctx, await api.hostState(code, pin)), false, "a held reveal waits for the host");
  await B2B.driver.openRound(ctx, await api.hostState(code, pin));
  assert.strictEqual((await api.public(code)).game.round, 2);
  await api.sign(code, b1.token, s1.card.code, "pilot");            // pilots are allowed now, and the same start-up can be signed again
  const sc = E.score(b3, (await api.hostState(code, pin)).deals, 1, cfg);
  assert.strictEqual(sc.total, P.stay, "a buyer who never tapped stayed by default");
  return true;
}

(async () => {
  const n = Number(process.argv[2] || 28), games = Number(process.argv[3] || 1);
  await refereeRules();
  if (games === 1) { await playGame(n, false); console.log("OK"); return; }
  const acc = Array.from({ length: N }, () => ({ buyers: 0, signed: 0, burned: 0, pilot: 0, notReady: 0 }));
  const sums = { ready: [], notReady: [], buyer: [], intro: [0, 0], none: [0, 0], proof: [0, 0], unproven: [0, 0] };
  for (let i = 0; i < games; i++) {
    const s = await playGame(n, true);
    s.rounds.forEach((x, k) => { acc[k].buyers += x.buyers; acc[k].signed += x.signed; acc[k].burned += x.burned; acc[k].pilot += x.pilot; acc[k].notReady += x.toNotReady; });
    sums.ready.push(s.points.avgReady); sums.notReady.push(s.points.avgNotReady); sums.buyer.push(s.points.avgBuyer);
    const add = (a, r) => { a[0] += r.won; a[1] += r.n; };
    add(sums.intro, s.trust.bars[0].rate); add(sums.none, s.trust.bars[1].rate); add(sums.proof, s.proof.bars[0].rate); add(sums.unproven, s.proof.bars[1].rate);
  }
  const pct = (a, b) => (b ? (100 * a / b).toFixed(0) : "-") + "% (" + a + "/" + b + ")";
  const mean = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  console.log(`${games} games of ${n} players — all invariants held`);
  acc.forEach((x, k) => console.log(`round ${k + 1} "${cards.rounds[k].title}": signed a start-up ${pct(x.signed, x.buyers)} | burned ${pct(x.burned, x.signed)} | pilots ${pct(x.pilot, x.signed)} | deals that went to a start-up that was not ready ${pct(x.notReady, x.signed)}`));
  console.log("signed per round, start-ups with proof:", pct(...sums.proof), "| ready without proof:", pct(...sums.unproven));
  console.log("introduction round, buyers who knew a working start-up:", pct(...sums.intro), "| others:", pct(...sums.none));
  console.log("average points: buyer", mean(sums.buyer), "(always staying =", N * P.stay + ")", "| ready start-up", mean(sums.ready), "| not-ready start-up", mean(sums.notReady));
})().catch(e => { console.error(e); process.exit(1); });
