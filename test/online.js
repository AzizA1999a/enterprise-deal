/* One real-time game against the live database (about a minute), to check that the database
   referees the same way as the offline store.
   Run:  node test/online.js [players]
   It leaves one finished game behind; the code and PIN are printed at the end. */
const path = require("path");
const fs = require("fs");
const assert = require("assert");

function load(f) { new Function(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").replace(/window\.B2B_CONFIG/g, "globalThis.B2B_CONFIG"))(); }
load("config.js"); load("engine.js"); load("api.js"); load("driver.js"); load("stats.js");

const B2B = globalThis.B2B, cfg = globalThis.B2B_CONFIG, api = B2B.remoteApi, E = B2B.engine;
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cards.json"), "utf8"));
assert.ok(B2B.hasRemote, "no Supabase connection in js/config.js");
// a short game: the rules are the same, only the clock is faster
cfg.briefingSeconds = 3; cfg.roundSeconds = 14; cfg.revealSeconds = 4;
const N = E.roundCount(cfg), P = cfg.payoff;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const refuses = async (job, code, why) => { let err = null; try { await job; } catch (e) { err = e.code; } assert.strictEqual(err, code, why + " (got " + err + ")"); };

(async () => {
  const n = Number(process.argv[2] || 26), pin = String(100000 + Math.floor(Math.random() * 900000));
  const { code } = await api.createGame(pin), ctx = { code, pin, cards, cfg, api };
  console.log("game", code);
  await refuses(api.hostState(code, "0000"), "bad_pin", "the host PIN is checked");
  const t0 = Date.now();
  await B2B.bots.add(ctx, n - 1, []);
  await api.join(code, "Real Player", "human-token-aaaaaaaa", false);
  console.log(`joined ${n} at once in ${Date.now() - t0} ms`);
  let hs = await api.hostState(code, pin);
  assert.strictEqual(hs.players.length, n);
  assert.ok(hs.players.filter(p => p.token).length === n - 1, "the host is given simulated players' tokens only");
  await B2B.driver.start(ctx, hs);
  await B2B.bots.add(ctx, 1, hs.players.map(p => p.name));            // a late joiner during the briefing

  let referee = false, polls = 0, pollMs = 0;
  for (let i = 0; i < 900; i++) {
    const a = Date.now();
    hs = await api.hostState(code, pin);
    pollMs += Date.now() - a; polls++;
    if (!(await B2B.driver.tick(ctx, hs)) && referee) await B2B.bots.tick(ctx, hs);
    const g = hs.game;
    if (!referee && g.phase === "open" && g.round === 1) {                 // the referee, before the simulated buyers move
      referee = true;
      const buyers = hs.players.filter(p => p.role === "buyer" && p.token), sellers = hs.players.filter(p => p.role === "seller" && p.token);
      const [b1, b2] = buyers, [s1, s2] = sellers;
      await refuses(api.sign(code, s1.token, s2.card.code, "full"), "not_joined", "a start-up cannot sign");
      await refuses(api.sign(code, b1.token, "00", "full"), "bad_code", "an unknown deal code is refused");
      await refuses(api.sign(code, b1.token, s1.card.code, "pilot"), "no_pilot", "no pilot in round 1");
      await refuses(api.sign(code, b1.token, s1.card.code, "gift"), "bad_arg", "an unknown kind of deal is refused");
      await api.sign(code, b1.token, s1.card.code, "full");
      await refuses(api.sign(code, b1.token, s2.card.code, "full"), "already_decided", "one decision per round");
      await refuses(api.sign(code, b2.token, s1.card.code, "full"), "seller_busy", "a start-up takes one customer per round");
      const st = await api.state(code, b1.token);
      assert.strictEqual(st.mine.seller_id, s1.id);
      assert.strictEqual(st.mine.delivered, null, "a buyer cannot see the outcome before the round closes");
      assert.ok(st.sellers.length === hs.players.filter(p => p.role === "seller").length && st.sellers.every(s => !("ready" in s) && s.proof === null), "buyers are never told who is ready, and see no proof in round 1");
      assert.strictEqual((await api.state(code, s1.token)).mine.buyer_id, b1.id, "a start-up sees who signed it");
      const pub = await api.public(code);
      assert.deepStrictEqual([pub.decided_now, pub.signed_now, pub.closed.length, pub.full], [1, 1, 0, null], "during a round the projector shows counts only");
      assert.ok(!JSON.stringify(pub).includes('"ready"') && !JSON.stringify(pub).includes('"token"'), "the projector data holds no secrets");
      console.log("referee rules OK (codes, one decision, one customer, no pilot in round 1, nothing leaks)");
    }
    if (g.phase === "locked") break;
    await sleep(350);
  }
  hs = await api.hostState(code, pin);
  const pub = await api.public(code);
  assert.strictEqual(hs.game.phase, "locked", "the game ends by itself");
  assert.ok(referee, "the referee checks ran");
  assert.ok(hs.players.every(p => p.role), "everyone has a role, the late joiner included");
  const sellers = hs.players.filter(p => p.role === "seller"), buyers = hs.players.filter(p => p.role === "buyer");
  for (let r = 1; r <= N; r++) {
    const rows = hs.deals.filter(d => d.round === r), signed = rows.filter(d => d.kind !== "stay");
    assert.strictEqual(new Set(rows.map(d => d.buyer_id)).size, rows.length, "one decision per buyer per round");
    assert.strictEqual(new Set(signed.map(d => d.seller_id)).size, signed.length, "one customer per start-up per round");
    for (const d of signed) {
      assert.strictEqual(d.delivered, sellers.find(s => s.id === d.seller_id).card.ready, "a start-up delivers exactly when its product is ready");
      assert.ok(E.roundRule(cfg, r).pilot || d.kind === "full", "no pilots before the pilot round");
    }
  }
  assert.deepStrictEqual(pub.closed.length, hs.deals.length, "at the end every decision is public");
  assert.ok(pub.full && pub.full.players.every(p => !("token" in p)), "public data has no tokens");
  const st = B2B.stats.compute(pub.full, cards);
  assert.strictEqual(B2B.exporter.decisionsCsv(pub.full, cfg).trim().split("\r\n").length, buyers.length * N + 1);
  const events = await api.hostEvents(code, pin);
  assert.ok(events.filter(e => e.type === "sign").length === hs.deals.filter(d => d.kind !== "stay").length, "every signature is in the event log");
  console.log(`players ${hs.players.length} (${sellers.length} start-ups / ${buyers.length} buyers), decisions ${hs.deals.length}, events ${events.length}`);
  console.log("rounds:", st.rounds.map(x => `${x.signed}/${x.buyers} signed, ${x.burned} burned`).join(" | "));
  console.log(`host poll average ${Math.round(pollMs / polls)} ms over ${polls} polls`);
  console.log("ONLINE OK", code, pin);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
