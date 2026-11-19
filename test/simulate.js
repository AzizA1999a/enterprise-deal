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
  B2B.bots.plans = {};
  await B2B.bots.add(ctx, nPlayers - 2, []);
  let hs = await api.hostState(code, pin);
  await B2B.driver.start(ctx, hs);

  // Two late joiners during the briefing.
  await B2B.bots.add(ctx, 2, hs.players.map(p => p.name));
  for (let i = 0; i < 4000; i++) {
    hs = await api.hostState(code, pin);
    await B2B.driver.tick(ctx, hs);
    hs = await api.hostState(code, pin);
    await B2B.bots.tick(ctx, hs);
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
    for (const o of sent) {
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
  }
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

(async () => {
  const n = Number(process.argv[2] || 28), games = Number(process.argv[3] || 1);
  if (games === 1) { await playGame(n, false); console.log("OK"); return; }
  const acc = { withC: [0, 0], without: [0, 0], inc: [0, 0], notCheap: [0, 0], offers: 0, deals: 0, fail: [0, 0] };
  for (let i = 0; i < games; i++) {
    const s = await playGame(n, true);
    acc.withC[0] += s.quick.connWith.won; acc.withC[1] += s.quick.connWith.n;
    acc.without[0] += s.quick.connWithout.won; acc.without[1] += s.quick.connWithout.n;
    acc.inc[0] += s.quick.incumbent.count; acc.inc[1] += s.quick.incumbent.n;
    acc.notCheap[0] += s.quick.notCheapest.count; acc.notCheap[1] += s.quick.notCheapest.n;
    acc.fail[0] += s.delivery.all.failed; acc.fail[1] += s.delivery.all.n;
    acc.offers += s.counts.offers; acc.deals += s.counts.deals;
  }
  const pct = a => (100 * a[0] / a[1]).toFixed(0) + "% (" + a[0] + "/" + a[1] + ")";
  console.log(`${games} games of ${n} players — all invariants held`);
  console.log("win rate with connection:", pct(acc.withC), "| without:", pct(acc.without));
  console.log("stayed with incumbent:", pct(acc.inc), "| winners not cheapest:", pct(acc.notCheap), "| deliveries failed:", pct(acc.fail));
  console.log("offers per game:", (acc.offers / games).toFixed(1), "| deals per game:", (acc.deals / games).toFixed(1));
})().catch(e => { console.error(e); process.exit(1); });
