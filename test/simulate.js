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
for (const k of Object.keys(cfg.game.moves)) assert.ok(cards.moves[k] && cards.moves[k].title, "cards.json needs wording for the move " + k);
const refuses = async (job, code, why) => { let err = null; try { await job; } catch (e) { err = e.code; } assert.strictEqual(err, code, why + " (got " + err + ")"); };

async function playGame(nPlayers, quiet) {
  const pin = "1234", { code } = await api.createGame(pin), ctx = { code, pin, cards, cfg, api };
  B2B.bots.plans = {};
  await B2B.bots.add(ctx, nPlayers - 2, []);
  let hs = await api.hostState(code, pin);
  await B2B.driver.start(ctx, hs);
  await B2B.bots.add(ctx, 2, hs.players.map(p => p.name));          // two late joiners during the briefing
  for (let i = 0; i < 9000; i++) {
    hs = await api.hostState(code, pin);
    if (!(await B2B.driver.tick(ctx, hs))) await B2B.bots.tick(ctx, hs);
    const pub = i % 40 === 0 ? await api.public(code) : null;
    if (pub && pub.game.phase !== "locked") {
      assert.ok(!JSON.stringify(pub).includes("priority"), "the projector is never told which message a giant cares about");
      const p = hs.players.find(x => x.token && x.role && x.state.giant);
      if (p) {
        const st = await api.state(code, p.token);
        assert.ok(!JSON.stringify(st.game).includes("priority"), "a phone is not given every giant's priority");
        assert.strictEqual(st.priority != null, E.knowsPriority(st.me.card, st.me.state), "a player sees their target's priority only after research, or through their own contact");
      }
    }
    fakeNow += 500;
    if (hs.game.phase === "locked") break;
  }
  hs = await api.hostState(code, pin);
  const pub = await api.public(code), R = hs.game.rules, ids = Object.keys(R.giants);
  assert.strictEqual(hs.game.phase, "locked", "the game ends by itself");
  assert.strictEqual(hs.game.round, R.rounds);
  assert.ok(hs.players.every(p => p.role && p.card && p.state), "everyone has a card, late joiners included");
  assert.strictEqual(new Set(hs.players.map(p => p.card.code)).size, hs.players.length, "codes are unique");
  assert.deepStrictEqual(ids, E.giantsInPlay(nPlayers - 2, cards, cfg), "giants in play follow the class size at Start");
  // every door of every giant is known by somebody, about evenly
  const known = {};
  hs.players.forEach(p => { const k = p.card.contact.giant + ":" + p.card.contact.door; known[k] = (known[k] || 0) + 1; assert.ok(R.giants[p.card.contact.giant], "contacts sit in giants that are in play"); assert.strictEqual(p.card.hint, R.giants[p.card.contact.giant].priority); });
  const counts = ids.flatMap(id => [0, 1, 2, 3].map(d => known[id + ":" + d] || 0));
  if (hs.players.length >= ids.length * 4) assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "contacts are spread evenly: " + counts.join(","));
  for (const p of hs.players) {
    const st = p.state, mine = hs.moves.filter(m => m.player_id === p.id).sort((a, b) => a.at - b.at);
    assert.ok(mine.every(m => m.giant === st.giant), "a start-up keeps the giant it started on");
    let door = 0;
    const spent = {}, intros = new Set();
    for (const m of mine) {
      const def = R.moves[m.move];
      spent[m.round] = (spent[m.round] || 0) + def.cost;
      assert.strictEqual(m.door, door, "a move is made at the door the start-up is standing at");
      if (m.move === "content" || m.move === "research") assert.strictEqual(m.success, null);
      else {
        assert.ok(m.odds >= 2 && m.odds <= 95 && typeof m.success === "boolean");
        if (m.move === "intro") {
          assert.strictEqual(m.odds, R.moves.intro.odds);
          assert.ok(m.via, "an introduction comes from somebody");
          if (m.via === p.id) assert.ok(p.card.contact.giant === m.giant && p.card.contact.door === m.door, "your own contact only works at their door");
          else { const key = m.via; assert.ok(!intros.has(key), "an introduction is used once"); intros.add(key);
                 assert.ok(hs.intros.some(i => i.from_id === m.via && i.to_id === p.id && i.giant === m.giant && i.door === m.door && i.used), "the introduction was really given, for that door"); }
        }
        if (m.success) door++;
      }
    }
    assert.strictEqual(st.progress, door, "progress is the number of doors opened");
    assert.ok(mine.filter(m => m.move === "content").length <= 1 && mine.filter(m => m.move === "research").length <= 1, "content and research are done once");
    assert.ok(mine.filter(m => m.via === p.id).length <= 1, "your own contact is used once");
    for (let r = 1; r <= R.rounds; r++) { assert.ok((spent[r] || 0) <= R.budget, "never over budget in a round"); assert.strictEqual(E.spentIn(st, r), spent[r] || 0); }
    assert.strictEqual(st.rank != null, st.progress === 4, "a rank means all four doors are open");
    const gave = hs.intros.filter(i => i.from_id === p.id);
    assert.ok(gave.length <= R.vouches && gave.length === st.vouched, "introductions given stay within the limit");
    assert.ok(gave.every(i => i.to_id !== p.id && i.giant === p.card.contact.giant && i.door === p.card.contact.door), "you introduce others, to the person you know");
    assert.strictEqual(new Set(gave.map(i => i.to_id)).size, gave.length, "no start-up is introduced twice by the same person");
    // points
    const sc = E.score(p, hs.players, hs.intros, cfg, R.slots);
    const helped = new Set(gave.filter(i => hs.players.find(x => x.id === i.to_id).state.rank != null).map(i => i.to_id)).size;
    assert.strictEqual(sc.total, st.progress * cfg.points.door + (st.rank == null ? 0 : st.rank <= R.slots ? cfg.points.win : cfg.points.late) + helped * cfg.points.vouch, "points follow the table");
  }
  for (const id of ids) {
    const ranks = hs.players.filter(p => p.state.giant === id && p.state.rank != null).map(p => p.state.rank).sort((a, b) => a - b);
    assert.deepStrictEqual(ranks, ranks.map((_, i) => i + 1), "signing order at a giant is 1, 2, 3...");
  }
  assert.ok(pub.full && pub.full.players.every(p => !("token" in p)), "public data has no tokens");
  const st = B2B.stats.compute(pub.full, cards);
  assert.strictEqual(st.funnel.signed, hs.players.filter(p => p.state.rank != null).length);
  assert.strictEqual(B2B.exporter.movesCsv(pub.full, cards).trim().split("\r\n").length, hs.moves.length + 1);
  B2B.exporter.playersCsv(pub.full, cards, cfg);
  B2B.exporter.eventsCsv(await api.hostEvents(code, pin), hs.players);
  if (!quiet) console.log(JSON.stringify(st, null, 1));
  return { st, hs };
}

// The referee, step by step.
async function refereeRules() {
  const pin = "1234", { code } = await api.createGame(pin), ctx = { code, pin, cards, cfg, api };
  B2B.bots.plans = {};
  await B2B.bots.add(ctx, 14, []);
  let hs = await api.hostState(code, pin);
  await refuses(api.move(code, hs.players[0].token, "cold"), "not_joined", "no moves before cards are dealt");
  await B2B.driver.start(ctx, hs);
  hs = await api.hostState(code, pin);
  const R = hs.game.rules, ids = Object.keys(R.giants), [a, b, c] = hs.players;
  await refuses(api.move(code, a.token, "cold"), "not_open", "no moves during the briefing");
  await refuses(api.target(code, a.token, "nowhere", "cost"), "bad_arg", "an unknown giant is refused");
  await refuses(api.target(code, a.token, ids[0], "magic"), "bad_arg", "an unknown message is refused");
  const tg = b.card.contact.giant;                                   // everybody goes after the giant where b knows someone
  for (const p of [a, b, c]) await api.target(code, p.token, tg, "cost");
  fakeNow += cfg.briefingSeconds * 1000 + 1;
  await B2B.driver.tick(ctx, await api.hostState(code, pin));
  assert.strictEqual((await api.public(code)).game.round, 1);
  const d = hs.players.find(p => p.id !== a.id && p.id !== b.id && p.id !== c.id);
  await refuses(api.move(code, d.token, "cold"), "no_target", "a start-up must choose a giant first");
  await refuses(api.move(code, a.token, "dance"), "bad_arg", "an unknown move is refused");
  await refuses(api.move(code, a.token, "intro", "nope"), "no_intro", "an introduction has to exist");
  await api.move(code, a.token, "content");
  await refuses(api.move(code, a.token, "content"), "already_done", "content is published once");
  await api.move(code, a.token, "research");
  assert.strictEqual((await api.state(code, a.token)).priority, R.giants[tg].priority, "research reveals the giant's priority");
  for (let left = R.budget - 2; left > 0; left--) await api.move(code, a.token, "cold");     // spend whatever is left
  await refuses(api.move(code, a.token, "cold"), "no_budget", "the round's budget is a hard limit");
  await refuses(api.target(code, a.token, ids.find(x => x !== tg) || tg + "x", null), ids.length > 1 ? "target_locked" : "bad_arg", "no switching giants after the first move");
  await api.target(code, a.token, null, "risk");                     // the message can still change
  // introductions
  await refuses(api.vouch(code, b.token, b.card.code), "bad_code", "you cannot introduce yourself");
  await refuses(api.vouch(code, b.token, "00"), "bad_code", "an unknown code is refused");
  await api.vouch(code, b.token, c.card.code);
  await refuses(api.vouch(code, b.token, c.card.code), "already_vouched", "one introduction per start-up");
  let cs = await api.state(code, c.token);
  assert.strictEqual(cs.intros.length, 1);
  assert.deepStrictEqual([cs.intros[0].giant, cs.intros[0].door, cs.intros[0].from_name], [tg, b.card.contact.door, b.name]);
  if (b.card.contact.door !== 0) await refuses(api.move(code, c.token, "intro", cs.intros[0].id), "no_intro", "an introduction only works at that person's door");
  else { const r = await api.move(code, c.token, "intro", cs.intros[0].id); assert.strictEqual(r.odds, R.moves.intro.odds); await refuses(api.move(code, c.token, "intro", cs.intros[0].id), "no_intro", "an introduction is used once"); }
  await api.vouch(code, b.token, a.card.code);
  await refuses(api.vouch(code, b.token, d.card.code), R.vouches === 2 ? "no_vouches" : "bad_arg", "introductions are limited");
  fakeNow += cfg.roundSeconds * 1000 + 1;
  await B2B.driver.tick(ctx, await api.hostState(code, pin));
  assert.strictEqual((await api.public(code)).game.phase, "reveal");
  await refuses(api.move(code, b.token, "cold"), "not_open", "no moves during a reveal");
  // the odds a phone shows are the odds the referee uses
  const st = { ...E.newState(), aware: true, message: "cost" };
  assert.strictEqual(E.odds(R, "cold", 0, st, "cost"), R.moves.cold.odds[0] + R.awareBoost + R.fit);
  assert.strictEqual(E.odds(R, "cold", 0, st, "risk"), R.moves.cold.odds[0] + R.awareBoost - R.misfit);
  assert.strictEqual(E.odds(R, "proof", 1, st, "risk"), Math.min(95, R.moves.proof.odds[1] + R.awareBoost), "the message does not matter at the security door");
  assert.strictEqual(E.odds(R, "intro", 0, st, "risk"), R.moves.intro.odds, "an introduction is worth the same to anyone");
  return true;
}

(async () => {
  const n = Number(process.argv[2] || 28), games = Number(process.argv[3] || 1);
  await refereeRules();
  if (games === 1) { await playGame(n, false); console.log("OK"); return; }
  const acc = { startups: 0, opened: [0, 0, 0, 0], signed: 0, winners: 0, moves: {}, intro: [0, 0], cold: [0, 0], given: 0, used: 0,
                g: { coldOnly: [], market: [], intro: [], noIntro: [], aware: [], notAware: [], right: [], wrong: [], knew: [], notKnew: [] }, finishRound: {}, giants: 0 };
  for (let i = 0; i < games; i++) {
    const { st, hs } = await playGame(n, true);
    acc.startups += st.funnel.startups; acc.signed += st.funnel.signed; acc.winners += st.funnel.winners; acc.giants += st.counts.giants;
    st.funnel.opened.forEach((x, d) => acc.opened[d] += x);
    st.moves.forEach(m => { const a = acc.moves[m.key] = acc.moves[m.key] || [0, 0]; a[0] += m.rate.won; a[1] += m.rate.n; });
    acc.given += st.network.given; acc.used += st.network.used;
    const push = (k, grp) => { if (grp.n) acc.g[k].push([grp.doors, grp.signed.pct, grp.n]); };
    push("intro", st.network.groups.yes); push("noIntro", st.network.groups.no); push("aware", st.content.yes); push("notAware", st.content.no);
    push("right", st.message.right); push("wrong", st.message.wrong); push("knew", st.targeting.yes); push("notKnew", st.targeting.no);
    for (const p of hs.players) {
      const pl = B2B.bots.plans[p.id];
      if (pl) acc.g[pl.cold ? "coldOnly" : "market"].push([p.state.progress, p.state.rank != null ? 100 : 0, 1]);
      if (p.state.signed_round) acc.finishRound[p.state.signed_round] = (acc.finishRound[p.state.signed_round] || 0) + 1;
    }
  }
  const pct = (a, b) => (b ? (100 * a / b).toFixed(0) : "-") + "%";
  const w = k => { const L = acc.g[k], N = L.reduce((s, x) => s + x[2], 0); return N ? `${(L.reduce((s, x) => s + x[0] * x[2], 0) / N).toFixed(2)} doors, ${(L.reduce((s, x) => s + x[1] * x[2], 0) / N).toFixed(0)}% signed` : "-"; };
  console.log(`${games} games of ${n} players — all invariants held (${(acc.giants / games).toFixed(1)} giants in play)`);
  console.log("funnel, share of start-ups that opened each door:", acc.opened.map(x => pct(x, acc.startups)).join(" → "), "| signed in time (winners):", pct(acc.winners, acc.startups), "| signed late:", pct(acc.signed - acc.winners, acc.startups));
  console.log("signatures by round:", Object.keys(acc.finishRound).sort().map(r => `r${r}: ${acc.finishRound[r]}`).join(", ") || "none");
  console.log("a move opened the door:", Object.keys(acc.moves).map(k => `${k} ${pct(acc.moves[k][0], acc.moves[k][1])} (${(acc.moves[k][1] / games).toFixed(0)}/game)`).join(" | "));
  console.log(`introductions per game: ${(acc.given / games).toFixed(1)} given, ${(acc.used / games).toFixed(1)} used`);
  console.log("used an introduction:", w("intro"), "| never did:", w("noIntro"));
  console.log("published a case study:", w("aware"), "| did not:", w("notAware"));
  console.log("right message:", w("right"), "| wrong:", w("wrong"));
  console.log("targeted a giant where they knew someone:", w("knew"), "| did not:", w("notKnew"));
  console.log("simulated founders who only cold-email:", w("coldOnly"), "| the rest:", w("market"));
})().catch(e => { console.error(e); process.exit(1); });
