/* One real-time game against the live database (about a minute and a half), to check that the database
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
cfg.briefingSeconds = 4; cfg.roundSeconds = 14; cfg.revealSeconds = 4;
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
  await refuses(api.target(code, hs.players.find(p => p.token).token, "atlas", "cost"), "not_joined", "no target before the cards are dealt");
  await B2B.driver.start(ctx, hs);
  await B2B.bots.add(ctx, 1, hs.players.map(p => p.name));            // a late joiner during the briefing

  let referee = false, polls = 0, pollMs = 0;
  for (let i = 0; i < 900; i++) {
    const a = Date.now();
    hs = await api.hostState(code, pin);
    pollMs += Date.now() - a; polls++;
    const g = hs.game;
    if (!referee && g.phase === "open" && g.round === 1) {                 // the referee, before the simulated start-ups move
      referee = true;
      const R = g.rules, ids = Object.keys(R.giants), mine = hs.players.filter(p => p.token && p.role);
      // a start-up that is not standing at its own contact's door, and any other start-up
      const p1 = mine.find(p => !(p.card.contact.giant === (p.state.giant || ids[0]) && p.card.contact.door === 0)), p2 = mine.find(p => p.id !== p1.id);
      const giant = p1.state.giant || ids[0], other = ids.find(x => x !== giant);
      await refuses(api.target(code, p1.token, "nowhere", null), "bad_arg", "an unknown company is refused");
      await refuses(api.target(code, p1.token, giant, "magic"), "bad_arg", "an unknown message is refused");
      await api.target(code, p1.token, giant, "cost");
      await refuses(api.move(code, p1.token, "bribe"), "bad_arg", "an unknown move is refused");
      await refuses(api.move(code, p1.token, "intro", "self"), "no_intro", "your own contact only works at their door");
      await refuses(api.move(code, p1.token, "intro", "not-an-id"), "no_intro", "an introduction must exist");
      const r1 = await api.move(code, p1.token, "content");
      assert.deepStrictEqual([r1.success, r1.odds, r1.progress], [null, null, 0], "a case study opens no door by itself");
      await refuses(api.move(code, p1.token, "content"), "already_done", "a case study is published once");
      await refuses(api.target(code, p1.token, other, null), "target_locked", "no switching companies after the first move");
      await refuses(api.move(code, p1.token, "pilot"), "no_budget", "a move that costs more than what is left is refused");
      await api.target(code, p1.token, null, "risk");                    // the message can still change
      let st = await api.state(code, p1.token);
      assert.strictEqual(st.me.state.message, "risk");
      assert.ok(Array.isArray(st.game.rules.giants) && !JSON.stringify(st.game).includes("priority"), "a phone is not given every company's priority");
      assert.strictEqual(st.priority != null, E.knowsPriority(st.me.card, st.me.state), "a player sees their target's priority only after research, or through their own contact");
      assert.strictEqual(E.budgetLeft(R, st.me.state, 1), R.budget - 1);
      await refuses(api.vouch(code, p1.token, p1.card.code), "bad_code", "you cannot introduce yourself");
      await refuses(api.vouch(code, p1.token, "zz"), "bad_code", "an unknown code is refused");
      const v = await api.vouch(code, p1.token, p2.card.code);
      assert.strictEqual(v.to_name, p2.name);
      await refuses(api.vouch(code, p1.token, p2.card.code), "already_vouched", "one introduction per classmate");
      st = await api.state(code, p1.token);
      assert.ok(st.given.length === 1 && st.given[0].to_id === p2.id && st.given[0].to_signed === false && st.moves.length === 1);
      const st2 = await api.state(code, p2.token);
      assert.ok(st2.intros.some(x => x.from_id === p1.id && x.from_name === p1.name && x.giant === p1.card.contact.giant && x.door === p1.card.contact.door), "the classmate sees the introduction");
      const pub = await api.public(code);
      assert.ok(!JSON.stringify(pub).includes("priority") && !JSON.stringify(pub).includes('"token"') && pub.full === null, "the projector data holds no secrets");
      assert.ok(pub.moves.length >= 1 && pub.intros.length >= 1 && pub.players.find(p => p.id === p1.id).aware === true);
      console.log("referee rules OK (targets, budget, once-only moves, introductions, nothing leaks)");
    }
    if (!(await B2B.driver.tick(ctx, hs))) await B2B.bots.tick(ctx, hs);
    if (g.phase === "locked") break;
    await sleep(350);
  }
  hs = await api.hostState(code, pin);
  const pub = await api.public(code), R = hs.game.rules, ids = Object.keys(R.giants);
  assert.strictEqual(hs.game.phase, "locked", "the game ends by itself");
  assert.ok(referee, "the referee checks ran");
  assert.ok(hs.players.every(p => p.role && p.card && p.state), "everyone has a start-up, the late joiner included");
  for (const p of hs.players) {
    const st = p.state, mine = hs.moves.filter(m => m.player_id === p.id).sort((a, b) => a.at - b.at);
    let door = 0;
    const spent = {};
    for (const m of mine) {
      spent[m.round] = (spent[m.round] || 0) + R.moves[m.move].cost;
      assert.strictEqual(m.door, door, "a move is made at the door the start-up is standing at");
      assert.strictEqual(m.giant, st.giant, "a start-up keeps the company it started on");
      if (m.move === "content" || m.move === "research") assert.strictEqual(m.success, null);
      else assert.ok(m.odds >= 2 && m.odds <= 95 && typeof m.success === "boolean");
      if (m.move === "intro" && m.via !== p.id) assert.ok(hs.intros.some(i => i.from_id === m.via && i.to_id === p.id && i.giant === m.giant && i.door === m.door && i.used), "the introduction was really given, for that door");
      if (m.success) door++;
    }
    assert.strictEqual(st.progress, door, "progress is the number of doors opened");
    for (let r = 1; r <= R.rounds; r++) { assert.ok((spent[r] || 0) <= R.budget, "never over budget in a round"); assert.strictEqual(E.spentIn(st, r), spent[r] || 0); }
    assert.strictEqual(st.rank != null, st.progress === 4, "a rank means all four doors are open");
    const gave = hs.intros.filter(i => i.from_id === p.id);
    assert.ok(gave.length <= R.vouches && gave.length === st.vouched, "introductions given stay within the limit");
  }
  for (const id of ids) {
    const ranks = hs.players.filter(p => p.state.giant === id && p.state.rank != null).map(p => p.state.rank).sort((a, b) => a - b);
    assert.deepStrictEqual(ranks, ranks.map((_, i) => i + 1), "signing order at a company is 1, 2, 3...");
  }
  assert.ok(pub.full && pub.full.players.every(p => !("token" in p)) && pub.full.moves.length === hs.moves.length, "at the end everything is public, except tokens");
  const st = B2B.stats.compute(pub.full, cards);
  assert.strictEqual(B2B.exporter.movesCsv(pub.full, cards).trim().split("\r\n").length, hs.moves.length + 1);
  assert.strictEqual(B2B.exporter.playersCsv(pub.full, cards, cfg).trim().split("\r\n").length, hs.players.length + 1);
  const events = await api.hostEvents(code, pin);
  assert.strictEqual(events.filter(e => e.type === "move").length, hs.moves.length, "every move is in the event log");
  console.log(`players ${hs.players.length}, companies ${ids.length}, moves ${hs.moves.length}, introductions ${hs.intros.length}, events ${events.length}`);
  console.log(`funnel: ${st.funnel.opened.join(" > ")} of ${st.funnel.startups}; won a contract: ${st.funnel.winners}`);
  console.log(`cold ${Math.round(st.network.cold.pct || 0)}% of ${st.network.cold.n}, introduction ${Math.round(st.network.intro.pct || 0)}% of ${st.network.intro.n}`);
  console.log(`host poll average ${Math.round(pollMs / polls)} ms over ${polls} polls`);
  console.log("ONLINE OK", code, pin);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
