/* Plays one real-time game against the live Supabase project with simulated players.
   Run:  node test/online.js [players] [marketSeconds]                              */
const path = require("path"), fs = require("fs"), assert = require("assert");
function load(f) { new Function(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").replace(/window\.B2B_CONFIG/g, "globalThis.B2B_CONFIG"))(); }
load("config.js"); load("engine.js"); load("api.js"); load("driver.js"); load("stats.js");
const B2B = globalThis.B2B, cfg = globalThis.B2B_CONFIG, api = B2B.remoteApi;
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cards.json"), "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const n = Number(process.argv[2] || 28);
  cfg.briefingSeconds = 2; cfg.marketSeconds = Number(process.argv[3] || 40);
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const { code } = await api.createGame(pin);
  const ctx = { code, pin, cards, cfg, api };
  console.log("game", code);

  // wrong PIN and unknown game are refused
  await assert.rejects(api.hostState(code, "0000"), e => e.code === "bad_pin");
  await assert.rejects(api.join("ZZZZ", "x", "token-12345678", false), e => e.code === "no_game");
  assert.strictEqual(await api.state("ZZZZ", "t"), null);

  // everyone joins at once, including two people with the same name
  let t0 = Date.now();
  await Promise.all([B2B.bots.add(ctx, n - 2, []), api.join(code, "Sam", "human-token-aaaaaaaa", false), api.join(code, "sam", "human-token-bbbbbbbb", false)]);
  console.log(`joined ${n} at once in ${Date.now() - t0} ms`);
  const again = await api.join(code, "Sam", "human-token-aaaaaaaa", false);
  let hs = await api.hostState(code, pin);
  assert.strictEqual(hs.players.length, n, "rejoin with the same token does not add a player");
  assert.strictEqual(new Set(hs.players.map(p => p.name.toLowerCase())).size, n, "names are unique");
  assert.ok(hs.players.filter(p => !p.is_bot).every(p => !("token" in p)), "human tokens are never returned");
  await assert.rejects(api.offer(code, "human-token-aaaaaaaa", hs.players[0].id, 100, false, []), e => e.code === "not_joined");

  await B2B.driver.start(ctx, hs);
  let st = await api.state(code, "human-token-aaaaaaaa");
  assert.ok(st.me.role && st.me.card, "human got a role card");
  assert.strictEqual(st.me.id, again.id);
  const pubDuring = await api.public(code);
  assert.strictEqual(pubDuring.full, null, "no full data before the lock");
  assert.ok(!JSON.stringify(pubDuring).includes("reliability"), "projector data hides reliability during play");

  let polls = 0, pollMs = 0, paused = false;
  for (let i = 0; i < 600; i++) {
    const a = Date.now();
    hs = await api.hostState(code, pin);
    pollMs += Date.now() - a; polls++;
    await B2B.driver.tick(ctx, hs);
    await B2B.bots.tick(ctx, hs);
    if (!paused && hs.game.phase === "open" && hs.offers.length > 5) {       // pause, extend, resume
      paused = true;
      await api.host(code, pin, "pause");
      const seller = hs.players.find(p => p.role === "seller" && p.offers_left > 0);
      const buyer = hs.players.find(p => p.role === "buyer" && p.category === seller.category);
      await assert.rejects(api.offer(code, seller.token, buyer.id, seller.card.list, false, []), e => e.code === "not_open");
      await api.host(code, pin, "extend", { ms: 5000 });
      await api.host(code, pin, "resume");
    }
    if (hs.game.phase === "locked" && hs.players.filter(p => p.is_bot).every(p => p.exit_answer)) break;
    await sleep(700);
  }
  hs = await api.hostState(code, pin);
  assert.strictEqual(hs.game.phase, "locked");
  assert.strictEqual(hs.game.total_ms, cfg.marketSeconds * 1000 + 5000);
  const sellers = hs.players.filter(p => p.role === "seller"), buyers = hs.players.filter(p => p.role === "buyer");
  for (const s of sellers) {
    const sent = hs.offers.filter(o => o.seller_id === s.id);
    assert.ok(sent.length <= cfg.offersPerSeller);
    assert.strictEqual(s.offers_left, cfg.offersPerSeller - sent.length);
  }
  for (const b of buyers) {
    assert.ok(hs.offers.filter(o => o.buyer_id === b.id && o.status === "accepted").length <= 1);
    assert.ok(b.decision && typeof b.points === "number");
  }
  assert.ok(hs.offers.every(o => o.status !== "pending"));
  assert.ok(hs.offers.filter(o => o.status === "accepted").every(o => typeof o.delivered === "boolean"));
  await api.exit(code, "human-token-aaaaaaaa", "price");
  await api.host(code, pin, "view", { view: "quick" });
  const pub = await api.public(code);
  assert.strictEqual(pub.game.view, "quick");
  const stats = B2B.stats.compute(pub.full, cards);
  const csv = B2B.exporter.offersCsv(pub.full, cards, cfg);
  const events = await api.hostEvents(code, pin);
  console.log(`players ${hs.players.length} (${sellers.length} sellers / ${buyers.length} buyers), offers ${hs.offers.length}, deals ${stats.counts.deals}, events ${events.length}, csv rows ${csv.trim().split("\r\n").length - 1}`);
  console.log(`host poll average ${(pollMs / polls).toFixed(0)} ms over ${polls} polls`);
  console.log("quick:", JSON.stringify(stats.quick));

  await api.host(code, pin, "reset");
  hs = await api.hostState(code, pin);
  assert.strictEqual(hs.players.length + hs.offers.length, 0);
  assert.strictEqual(hs.game.phase, "lobby");
  console.log("ONLINE OK", code, pin);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
