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
  cfg.rivals.reactSeconds = [2, 5];                                            // a short game needs quick account managers
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

  let polls = 0, pollMs = 0, paused = false, faceTested = false, stayTested = false;
  for (let i = 0; i < 600; i++) {
    const a = Date.now();
    hs = await api.hostState(code, pin);
    pollMs += Date.now() - a; polls++;
    await B2B.driver.tick(ctx, hs);
    if (await B2B.rivals.tick(ctx, hs)) hs = await api.hostState(code, pin);
    await B2B.bots.tick(ctx, hs);
    if (!stayTested && hs.game.phase === "open") {                             // a buyer cannot claim a counter-offer that was never made
      const b = hs.players.find(p => p.role === "buyer" && !p.decision && B2B.engine.counters(p.card).length);
      if (b) {
        stayTested = true;
        const during = await api.public(code);
        assert.ok(during.players.some(p => p.defence && p.defence.n >= 1), "the projector knows an incumbent has countered");
        assert.ok(!JSON.stringify(during.players).includes("pct"), "the projector never shows the discount during play");
        const sellerTok = hs.players.find(p => p.role === "seller" && p.category === b.category).token;
        const sv = await api.state(code, sellerTok);
        assert.ok(sv.buyers.some(x => x.id === b.id && x.pub.defence && x.pub.defence.n >= 1) && !JSON.stringify(sv.buyers).includes("counters"), "sellers see that a counter-offer exists, not what it is");
        await api.incumbent(code, b.token, 99);
        const after = (await api.hostState(code, pin)).players.find(p => p.id === b.id);
        assert.strictEqual(after.stay_level, B2B.engine.counters(after.card).length, "stay level is capped at the counter-offers really made");
        console.log("incumbent counter-offer rules OK");
        continue;
      }
    }
    if (!faceTested && hs.game.phase === "open") {                            // desk number, edit, sign-what-you-saw
      faceTested = true;
      // simulated players only: the host is given their tokens, never a real player's
      const seller = hs.players.find(p => p.role === "seller" && p.token && p.offers_left > 0 &&
        hs.players.some(b => b.role === "buyer" && b.token && b.category === p.category && !b.decision));
      const buyer = hs.players.find(p => p.role === "buyer" && p.token && p.category === seller.category && !p.decision);
      assert.ok(/^\d{2}$/.test(buyer.card.desk), "buyer has a 2-digit desk number");
      const sellerView = await api.state(code, seller.token);
      assert.ok(!JSON.stringify(sellerView.buyers).includes('"desk"'), "sellers cannot read desk numbers");
      const wrong = buyer.card.desk === "11" ? "12" : "11";
      await assert.rejects(api.offer(code, seller.token, buyer.id, seller.card.list, false, [], wrong), e => e.code === "bad_desk");
      const made = await api.offer(code, seller.token, buyer.id, seller.card.list, false, [], buyer.card.desk);
      await assert.rejects(api.offer(code, seller.token, buyer.id, seller.card.list, false, [], buyer.card.desk), e => e.code === "already_pitched");
      await api.revise(code, seller.token, made.id, seller.card.floor, true, []);
      const buyerView = await api.state(code, buyer.token);
      const seen = buyerView.offers.find(o => o.id === made.id);
      assert.strictEqual(seen.price, seller.card.floor); assert.strictEqual(seen.revisions, 1); assert.strictEqual(seen.pilot, true);
      await assert.rejects(api.decide(code, buyer.token, made.id, true, null, seller.card.list), e => e.code === "offer_changed");
      console.log("face-to-face rules OK (desk number, edit, sign-what-you-saw)");
      // resource tokens: the database prices each term sheet and refuses one the seller cannot afford
      const T = seller.card.tokens, E = B2B.engine;
      assert.ok(T && T.budget === cfg.tokens.perSeller, "the seller's card carries the token rules");
      assert.strictEqual(seen.cost, T.pilot, "a pilot costs the seller its pilot price in tokens");
      await api.revise(code, seller.token, made.id, seller.card.floor, true, [], { fast: true, guess: "lowest_risk" });
      let mine = (await api.state(code, seller.token)).offers;
      const now = mine.find(o => o.id === made.id);
      assert.deepStrictEqual([now.fast, now.guess, now.cost], [true, "lowest_risk", T.pilot + T.fast], "fast-track and the seller's read are stored and priced");
      const other = hs.players.find(p => p.role === "buyer" && p.token && p.category === seller.category && !p.decision && p.id !== buyer.id &&
        !mine.some(o => o.buyer_id === p.id && o.status === "pending"));
      if (other) {
        const free = E.tokensFree(seller.card, mine);
        if (free < T.pilot + T.fast) {
          await assert.rejects(api.offer(code, seller.token, other.id, seller.card.list, true, [], other.card.desk, { fast: true, guess: "none" }), e => e.code === "no_tokens");
          assert.strictEqual((await api.state(code, seller.token)).me.offers_left, sellerView.me.offers_left - 1, "a refused term sheet does not use one up");
        }
      }
      await api.revise(code, seller.token, made.id, seller.card.floor, true, [], { fast: false });
      mine = (await api.state(code, seller.token)).offers;
      assert.strictEqual(mine.find(o => o.id === made.id).guess, "lowest_risk", "an edit keeps the earlier read when none is sent");
      assert.strictEqual(E.tokensUsed(seller.card, mine), mine.filter(o => o.status === "pending" || o.status === "accepted").reduce((n, o) => n + o.cost, 0));
      console.log("token rules OK (priced by the database, freed by an edit; refusal when short " + (other ? "tested" : "NOT tested: no second buyer") + ")");
      continue;
    }
    if (!paused && hs.game.phase === "open" && hs.offers.length > 5) {       // pause, extend, resume
      paused = true;
      await api.host(code, pin, "pause");
      const seller = hs.players.find(p => p.role === "seller" && p.token && p.offers_left > 0);   // a simulated one: the host holds its token
      const buyer = hs.players.find(p => p.role === "buyer" && p.category === seller.category);
      await assert.rejects(api.offer(code, seller.token, buyer.id, seller.card.list, false, []), e => e.code === "not_open" || (console.log("unexpected refusal while paused:", e.code), false));
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
    assert.ok(sent.every(o => o.cost === B2B.engine.offerCost(s.card, o)), "every term sheet's token cost matches its terms");
    assert.ok(B2B.engine.tokensUsed(s.card, sent) <= s.card.tokens.budget, "no seller ends over its token budget");
  }
  for (const b of buyers) {
    assert.ok(hs.offers.filter(o => o.buyer_id === b.id && o.status === "accepted").length <= 1);
    assert.ok(b.decision && typeof b.points === "number");
    const made = B2B.engine.counters(b.card), took = b.decision === "incumbent" ? B2B.engine.standing(b.card, b.stay_level) : null;
    assert.ok(made.length <= cfg.rivals.maxCounters);
    if (b.decision !== "startup") assert.strictEqual(b.points, cfg.points.incumbent + (took ? took.pct + (took.addon ? cfg.rivals.addonPoints : 0) : 0), "stay points follow the accepted counter-offer");
  }
  assert.ok(stayTested, "at least one counter-offer was made and tested");
  assert.ok(hs.offers.every(o => o.status !== "pending"));
  assert.ok(hs.offers.filter(o => o.status === "accepted").every(o => typeof o.delivered === "boolean"));
  await api.exit(code, "human-token-aaaaaaaa", "price");
  await api.host(code, pin, "view", { view: "quick" });
  const pub = await api.public(code);
  assert.strictEqual(pub.game.view, "quick");
  const stats = B2B.stats.compute(pub.full, cards);
  const csv = B2B.exporter.offersCsv(pub.full, cards, cfg);
  const events = await api.hostEvents(code, pin);
  assert.strictEqual(events.filter(e => e.type === "counter").length, buyers.reduce((n, b) => n + B2B.engine.counters(b.card).length, 0), "every counter-offer is in the event log");
  console.log("incumbent defence:", JSON.stringify(stats.defence));
  console.log(`players ${hs.players.length} (${sellers.length} sellers / ${buyers.length} buyers), offers ${hs.offers.length}, deals ${stats.counts.deals}, events ${events.length}, csv rows ${csv.trim().split("\r\n").length - 1}`);
  console.log(`host poll average ${(pollMs / polls).toFixed(0)} ms over ${polls} polls`);
  console.log("quick:", JSON.stringify(stats.quick));

  await api.host(code, pin, "reset");
  hs = await api.hostState(code, pin);
  assert.strictEqual(hs.players.length + hs.offers.length, 0);
  assert.strictEqual(hs.game.phase, "lobby");
  console.log("ONLINE OK", code, pin);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
