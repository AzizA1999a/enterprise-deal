/* Headless full game with simulated players, to check the rules end to end.
   Run:  node test/simulate.js [players] [games]                               */
const path = require("path");
const fs = require("fs");
const assert = require("assert");

let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;

globalThis.B2B_CONFIG = undefined;
globalThis.window = undefined;
function load(f) { new Function(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").replace(/window\.B2B_CONFIG/g, "globalThis.B2B_CONFIG"))(); }
delete globalThis.window;
load("config.js"); load("engine.js"); load("api.js"); load("driver.js"); load("stats.js");

const B2B = globalThis.B2B, cfg = globalThis.B2B_CONFIG, api = B2B.localApi; // always offline, never the live database
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cards.json"), "utf8"));
const problems = B2B.engine.validateCards(cards);
assert.deepStrictEqual(problems, [], "cards.json problems: " + problems.join(" | "));

async function playGame(nPlayers, quiet) {
  const pin = "1234";
  const { code } = await api.createGame(pin);
  const ctx = { code, pin, cards, cfg, api };
  B2B.bots.plans = {}; B2B.rivals.plans = {};
  await B2B.bots.add(ctx, nPlayers - 2, []);
  let hs = await api.hostState(code, pin);
  await B2B.driver.start(ctx, hs);

  // Two late joiners during the briefing.
  await B2B.bots.add(ctx, 2, hs.players.map(p => p.name));
  for (let i = 0; i < 4000; i++) {
    hs = await api.hostState(code, pin);
    await B2B.driver.tick(ctx, hs);
    hs = await api.hostState(code, pin);
    if (await B2B.rivals.tick(ctx, hs)) hs = await api.hostState(code, pin);
    await B2B.bots.tick(ctx, hs);
    // resource tokens: never more tied up than the seller holds, at any moment
    for (const s of hs.players) {
      if (s.role !== "seller" || !s.card.tokens) continue;
      assert.ok(B2B.engine.tokensUsed(s.card, hs.offers.filter(o => o.seller_id === s.id)) <= s.card.tokens.budget, "a seller never ties up more tokens than it holds");
    }
    fakeNow += 1000;
    if (hs.game.phase === "locked" && hs.players.every(p => p.exit_answer)) break;
  }
  hs = await api.hostState(code, pin);
  const pub = await api.public(code);

  // ---- invariants ----
  assert.strictEqual(hs.game.phase, "locked");
  assert.ok(hs.players.every(p => p.role), "everyone has a role");
  const sellers = hs.players.filter(p => p.role === "seller"), buyers = hs.players.filter(p => p.role === "buyer");
  for (const s of sellers) {
    const sent = hs.offers.filter(o => o.seller_id === s.id);
    assert.ok(sent.length <= cfg.offersPerSeller, "seller offer limit");
    assert.strictEqual(s.offers_left, cfg.offersPerSeller - sent.length);
    if (cfg.tokens.on) assert.deepStrictEqual(s.card.tokens, { budget: cfg.tokens.perSeller, pilot: s.card.assets.includes("pilot_ready") ? cfg.tokens.pilotReady : cfg.tokens.pilot,
      fast: cfg.tokens.fast, proof: cfg.tokens.proof, fastWeeks: cfg.tokens.fastWeeks }, "token rules are on the seller's card");
    for (const o of sent) {
      assert.strictEqual(o.cost, B2B.engine.offerCost(s.card, o), "the recorded token cost matches the terms");
      assert.ok(["lowest_cost", "lowest_risk", "fastest_deployment", "none"].includes(o.guess), "every term sheet records the seller's read of the buyer");
      assert.ok(o.price >= s.card.floor && o.price <= s.card.list, "price in range");
      assert.ok(o.proof.every(a => s.card.assets.includes(a)), "proof held");
      const b = buyers.find(x => x.id === o.buyer_id);
      assert.strictEqual(b.category, s.category, "same category");
    }
    for (const c of s.card.connections) {
      const b = buyers.find(x => x.id === c.id);
      assert.ok(b && b.category === s.category, "connection in category");
      assert.ok(b.card.connections.some(x => x.id === s.id && x.type === c.type && x.reliability === s.card.reliability), "mirrored");
      assert.strictEqual(c.priority, b.card.priority);
    }
  }
  for (const b of buyers) {
    const acc = hs.offers.filter(o => o.buyer_id === b.id && o.status === "accepted");
    assert.ok(acc.length <= 1, "one deal per buyer");
    assert.ok(b.decision, "every buyer ends with a decision");
    assert.strictEqual(b.decision === "startup", acc.length === 1);
    if (acc.length) assert.ok(acc[0].price <= b.card.budget, "within budget");
    assert.ok(b.card.connections.length <= cfg.maxConnectionsPerBuyer);
    assert.ok(typeof b.points === "number");
    // the incumbent's account manager
    const made = B2B.engine.counters(b.card), R = cfg.rivals;
    assert.ok(made.length <= R.maxCounters, "counter-offer limit");
    assert.ok(made.every((c, i) => c.pct <= R.maxDiscount && (i === 0 || c.pct >= made[i - 1].pct)), "discounts only deepen, up to the cap");
    assert.ok(made.filter(c => c.kind === "final").length <= 1 && made.every((c, i) => c.kind !== "final" || i === made.length - 1), "the final offer is the last one");
    assert.ok(made.every(c => c.kind !== "early" || !hs.offers.some(o => o.buyer_id === b.id && o.created_at < c.at)), "early renewal only before any pitch");
    assert.strictEqual((b.pub.defence ? b.pub.defence.n : 0), made.length, "sellers see the right number of counter-offers");
    if (b.decision === "incumbent") {
      const taken = B2B.engine.standing(b.card, b.stay_level);
      assert.strictEqual(b.points, cfg.points.incumbent + (taken ? taken.pct + (taken.addon ? R.addonPoints : 0) : 0), "stay points follow the accepted counter-offer");
    }
    if (b.decision === "incumbent_default") assert.strictEqual(b.points, cfg.points.incumbent, "no decision, no discount");
  }
  const counterEvents = (await api.hostEvents(code, pin)).filter(e => e.type === "counter").length;
  assert.strictEqual(counterEvents, buyers.reduce((n, b) => n + B2B.engine.counters(b.card).length, 0), "every counter-offer is logged");
  assert.ok(!JSON.stringify(pub.players).includes("pct"), "the projector never shows a discount during play");
  assert.ok(hs.offers.every(o => o.status !== "pending"), "no pending offers after lock");
  assert.ok(hs.offers.filter(o => o.status === "accepted").every(o => typeof o.delivered === "boolean"));
  assert.ok(pub.full && pub.full.players.every(p => !("token" in p)), "public data has no tokens");

  const st = B2B.stats.compute(pub.full, cards);
  const csv = B2B.exporter.offersCsv(pub.full, cards, cfg);
  assert.strictEqual(csv.trim().split("\r\n").length, hs.offers.length + 1);
  B2B.exporter.playersCsv(pub.full, cards);
  B2B.exporter.eventsCsv(await api.hostEvents(code, pin), hs.players);
  if (!quiet) {
    const cats = [...new Set(hs.players.map(p => p.category))];
    console.log(`players ${hs.players.length}: ${sellers.length} sellers / ${buyers.length} buyers, ${cats.length} categories`);
    console.log(`connections per seller: ${sellers.map(s => s.card.connections.length).join("")}`);
    console.log(JSON.stringify(st, null, 1));
  }
  return st;
}

// The token limit, step by step, on one seller with three buyers to pitch.
async function tokenRules() {
  if (!cfg.tokens.on) return;
  for (let attempt = 0; attempt < 60; attempt++) {
    const pin = "1234", { code } = await api.createGame(pin), ctx = { code, pin, cards, cfg, api };
    B2B.bots.plans = {}; B2B.rivals.plans = {};
    await B2B.bots.add(ctx, 40, []);
    let hs = await api.hostState(code, pin);
    await B2B.driver.start(ctx, hs);
    fakeNow += (cfg.briefingSeconds + 1) * 1000;
    await B2B.driver.tick(ctx, await api.hostState(code, pin));
    hs = await api.hostState(code, pin);
    assert.strictEqual(hs.game.phase, "open");
    const s = hs.players.find(p => p.role === "seller" && !p.card.assets.includes("pilot_ready") && p.card.assets.includes("reference") &&
      hs.players.filter(b => b.role === "buyer" && b.category === p.category).length >= 3);
    if (!s) continue;
    const bs = hs.players.filter(b => b.role === "buyer" && b.category === s.category).slice(0, 3);
    const T = s.card.tokens, send = (b, pilot, proof, fast) => api.offer(code, s.token, b.id, s.card.list, pilot, proof, b.card.desk, { fast: !!fast, guess: "none" });
    const refuses = async (job, why) => { let err = null; try { await job; } catch (e) { err = e.code; } assert.strictEqual(err, "no_tokens", why); };
    const o1 = await send(bs[0], true, []);                                   // pilot: 3 of 6
    const o2 = await send(bs[1], true, []);                                   // pilot: 6 of 6
    await refuses(send(bs[2], true, []), "a third pilot is refused: no tokens left");
    await refuses(api.revise(code, s.token, o2.id, s.card.list, true, ["reference"], { guess: "none" }), "an edit that needs more tokens than are free is refused");
    hs = await api.hostState(code, pin);
    assert.strictEqual(hs.players.find(p => p.id === s.id).offers_left, cfg.offersPerSeller - 2, "a refused term sheet does not use one up");
    assert.strictEqual(B2B.engine.tokensFree(s.card, hs.offers.filter(o => o.seller_id === s.id)), T.budget - 2 * T.pilot);
    await api.revise(code, s.token, o2.id, s.card.list, false, ["reference"], { guess: "lowest_risk" });   // swap the pilot for a reference: frees 2
    await api.decide(code, bs[0].token, o1.id, false, "price");               // a rejection gives the tokens back
    const o3 = await send(bs[2], true, ["reference"]);                        // pilot + reference: 4, with 1 tied up elsewhere
    hs = await api.hostState(code, pin);
    const mine = hs.offers.filter(o => o.seller_id === s.id);
    assert.strictEqual(mine.find(o => o.id === o2.id).guess, "lowest_risk");
    assert.strictEqual(mine.find(o => o.id === o3.id).cost, T.pilot + T.proof);
    assert.strictEqual(B2B.engine.tokensFree(s.card, mine), T.budget - T.proof - (T.pilot + T.proof));
    // fast-track counts for the buyer: a slow start-up meets a "4 weeks" need only with it
    const slow = { deployWeeks: cfg.tokens.fastWeeks + 2 }, bc = { incumbent: { price: 100 }, priority: "fastest_deployment", constraint: { type: "max_deploy_weeks", weeks: cfg.tokens.fastWeeks } };
    assert.deepStrictEqual([B2B.engine.fit(bc, { price: 90, proof: [] }, slow, cfg).priorityMet, B2B.engine.fit(bc, { price: 90, proof: [], fast: true }, slow, cfg).priorityMet], [false, true]);
    assert.strictEqual(B2B.engine.fit(bc, { price: 90, proof: [], fast: true }, slow, cfg).constraintMet, true);
    return true;
  }
  throw new Error("token rules: no suitable seller found in 60 games");
}

(async () => {
  const n = Number(process.argv[2] || 28), games = Number(process.argv[3] || 1);
  await tokenRules();
  if (games === 1) { await playGame(n, false); console.log("OK"); return; }
  if (process.argv[4] === "norivals") cfg.rivals.on = false;
  const acc = { withC: [0, 0], without: [0, 0], inc: [0, 0], notCheap: [0, 0], offers: 0, deals: 0, fail: [0, 0], d: { counters: 0, pitched: 0, signed: 0, wonBack: 0, early: 0, notPitched: 0, disc: [], lev: 0 }, noWin: [0, 0], price: [], read: { right: [0, 0], wrong: [0, 0], none: [0, 0] }, load: { light: [0, 0], mid: [0, 0], heavy: [0, 0] }, fit: [0, 0], noFit: [0, 0], tok: [] };
  for (let i = 0; i < games; i++) {
    const s = await playGame(n, true);
    acc.withC[0] += s.quick.connWith.won; acc.withC[1] += s.quick.connWith.n;
    acc.without[0] += s.quick.connWithout.won; acc.without[1] += s.quick.connWithout.n;
    acc.inc[0] += s.quick.incumbent.count; acc.inc[1] += s.quick.incumbent.n;
    acc.notCheap[0] += s.quick.notCheapest.count; acc.notCheap[1] += s.quick.notCheapest.n;
    acc.fail[0] += s.delivery.all.failed; acc.fail[1] += s.delivery.all.n;
    acc.offers += s.counts.offers; acc.deals += s.counts.deals;
    const d = s.defence;
    acc.d.counters += d.counters; acc.d.pitched += d.pitched; acc.d.signed += d.signed; acc.d.wonBack += d.wonBack;
    acc.d.early += d.earlyLocked; acc.d.notPitched += d.notPitched; acc.d.lev += d.leverage;
    if (d.avgDiscount != null) acc.d.disc.push(d.avgDiscount);
    acc.noWin[0] += s.firstWin.noWin; acc.noWin[1] += s.firstWin.sellers;
    if (s.price.win != null) acc.price.push(s.price.win);
    s.read.bars.forEach(b => { acc.read[b.key][0] += b.rate.won; acc.read[b.key][1] += b.rate.n; });
    s.load.bars.forEach(b => { acc.load[b.key][0] += b.rate.won; acc.load[b.key][1] += b.rate.n; });
    acc.fit[0] += s.read.fit.won; acc.fit[1] += s.read.fit.n; acc.noFit[0] += s.read.noFit.won; acc.noFit[1] += s.read.noFit.n;
    if (s.load.avg != null) acc.tok.push(s.load.avg);
  }
  const pct = a => (100 * a[0] / a[1]).toFixed(0) + "% (" + a[0] + "/" + a[1] + ")";
  console.log(`${games} games of ${n} players — all invariants held`);
  console.log("win rate with connection:", pct(acc.withC), "| without:", pct(acc.without));
  console.log("stayed with incumbent:", pct(acc.inc), "| winners not cheapest:", pct(acc.notCheap), "| deliveries failed:", pct(acc.fail));
  console.log("offers per game:", (acc.offers / games).toFixed(1), "| deals per game:", (acc.deals / games).toFixed(1));
  const mean = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "-";
  console.log("sellers with no deal:", pct(acc.noWin), "| average winning price, % of incumbent:", mean(acc.price));
  console.log("account managers:", cfg.rivals.on ? "ON" : "off", "| counter-offers per game:", (acc.d.counters / games).toFixed(1),
    "| pitched buyers won back:", pct([acc.d.wonBack, acc.d.pitched]), "| pitched buyers who signed:", pct([acc.d.signed, acc.d.pitched]),
    "| never-pitched buyers closed early:", acc.d.notPitched ? pct([acc.d.early, acc.d.notPitched]) : "-", "| average discount accepted:", mean(acc.d.disc) + "%");
  console.log("knew what the buyer cared about:", pct(acc.read.right), "| guessed wrong:", pct(acc.read.wrong), "| did not ask:", pct(acc.read.none));
  console.log("term sheets that fit priority and rule:", pct(acc.fit), "| the rest:", pct(acc.noFit));
  console.log("tokens on the term sheet, 0-1:", pct(acc.load.light), "| 2-3:", pct(acc.load.mid), "| 4+:", pct(acc.load.heavy), "| average per term sheet:", mean(acc.tok));
})().catch(e => { console.error(e); process.exit(1); });
