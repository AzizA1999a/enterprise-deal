/* Runs on the host laptop only.
   driver: the automatic steps (deal role cards, late joiners, open and close each round on the clock).
   bots:   simulated players for demo mode. They use the same calls as phones.
   speed:  a test speed (2x to 16x) for rehearsing alone. It only ever applies to a
           game that has simulated players in it; a real class runs at normal speed. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});
  var E = B2B.engine;

  // Only one tab in this browser may run the automatic steps and the bots for a game,
  // so the host panel and the slides can both be open without stepping on each other.
  var leader = {
    held: {}, asked: {},
    has: function (code) {
      if (!leader.asked[code]) {
        leader.asked[code] = true;
        if (root.navigator && root.navigator.locks) {
          root.navigator.locks.request("b2bsim-driver-" + code, function () {
            leader.held[code] = true;
            return new Promise(function () {}); // keep it until this tab closes
          });
        } else {
          leader.held[code] = true;
        }
      }
      return !!leader.held[code];
    }
  };

  // Test speed. Chosen per game in this browser, and ignored unless the game has simulated players.
  var speed = {
    options: [1, 2, 4, 8, 16],
    key: function (code) { return "b2bsim.speed." + String(code || "").toUpperCase(); },
    chosen: function (code) {
      var n = 1;
      try { n = Number(B2B.store.getItem(speed.key(code))); } catch (e) { /* no storage */ }
      return speed.options.indexOf(n) >= 0 ? n : 1;
    },
    set: function (code, n) { try { B2B.store.setItem(speed.key(code), String(n)); } catch (e) { /* no storage */ } },
    of: function (code, players) {
      return (players || []).some(function (p) { return p.is_bot; }) ? speed.chosen(code) : 1;
    },
    ms: function (code, players, ms) { return Math.max(1, Math.round(ms / speed.of(code, players))); },
    // How often the host page should look at the game: faster at a test speed, so nothing is skipped.
    poll: function (code, players, ms) { return Math.max(250, Math.round(ms / speed.of(code, players))); }
  };

  // One round of host duties: read the game, run automatic steps, let bots act. Returns the state.
  function hostRound(ctx, botsOn) {
    return ctx.api.hostState(ctx.code, ctx.pin).then(function (hs) {
      if (!leader.has(ctx.code)) return hs;
      return driver.tick(ctx, hs).then(function (changed) {
        if (changed || !botsOn) return hs;
        return bots.tick(ctx, hs).then(function () { return hs; });
      });
    });
  }

  // ctx = { code, pin, cards, cfg, api }
  var driver = {
    busy: false,
    roundMs: function (ctx, hs) { return speed.ms(ctx.code, hs.players, ctx.cfg.roundSeconds * 1000); },
    revealMs: function (ctx, hs) { return speed.ms(ctx.code, hs.players, ctx.cfg.revealSeconds * 1000); },

    // The host pressed Start: deal the role cards, then begin the briefing.
    start: function (ctx, hs) {
      var patch = E.assign(hs.players.map(function (p) { return { id: p.id, name: p.name }; }), ctx.cards, ctx.cfg);
      return ctx.api.hostApply(ctx.code, ctx.pin, patch).then(function () {
        return ctx.api.host(ctx.code, ctx.pin, "start",
          { briefing_ms: speed.ms(ctx.code, hs.players, ctx.cfg.briefingSeconds * 1000), rules: E.serverRules(ctx.cfg) });
      });
    },
    openRound: function (ctx, hs) { return ctx.api.host(ctx.code, ctx.pin, "open", { ms: driver.roundMs(ctx, hs) }); },
    closeRound: function (ctx, hs) { return ctx.api.host(ctx.code, ctx.pin, "close", { reveal_ms: driver.revealMs(ctx, hs) }); },

    // Call on every host refresh. Does at most one automatic step.
    tick: function (ctx, hs) {
      if (driver.busy) return Promise.resolve(false);
      var g = hs.game, step = null;
      var assigned = hs.players.filter(function (p) { return p.role; });
      var newcomers = hs.players.filter(function (p) { return !p.role; });
      if (g.phase !== "lobby" && g.phase !== "locked" && newcomers.length) {
        step = function () { return ctx.api.hostApply(ctx.code, ctx.pin, E.assignLate(newcomers, assigned, ctx.cards, ctx.cfg)); };
      } else if (g.phase === "briefing" && hs.now >= g.briefing_ends_at) {
        step = function () { return driver.openRound(ctx, hs); };
      } else if (g.phase === "open" && hs.now >= g.ends_at) {
        step = function () { return driver.closeRound(ctx, hs); };
      } else if (g.phase === "reveal" && g.ends_at && hs.now >= g.ends_at) {
        step = function () { return driver.openRound(ctx, hs); };
      }
      if (!step) return Promise.resolve(false);
      driver.busy = true;
      return step().then(function () { driver.busy = false; return true; }, function (e) { driver.busy = false; throw e; });
    }
  };

  // ===================================================================
  var NAMES = ["Ava", "Liam", "Noor", "Mateo", "Zoe", "Omar", "Maya", "Lucas", "Sara", "Ethan", "Lina", "Diego",
    "Chloe", "Yusuf", "Emma", "Kai", "Layla", "Noah", "Priya", "Leo", "Hana", "Marco", "Ines", "Tariq", "Grace",
    "Jonas", "Amira", "Felix", "Nadia", "Hugo", "Mei", "Sami", "Elena", "Ravi", "Clara", "Idris", "Julia", "Andre",
    "Salma", "Theo", "Rosa", "Bilal", "Nina", "Oscar", "Farah", "Ivan", "Dana", "Malik"];

  var bots = {
    plans: {},
    rnd: Math.random,

    add: function (ctx, count, existingNames) {
      var taken = {};
      (existingNames || []).forEach(function (n) { taken[n.toLowerCase()] = true; });
      var pool = E.shuffle(NAMES.filter(function (n) { return !taken[n.toLowerCase()]; }), bots.rnd);
      var jobs = [];
      for (var i = 0; i < count; i++) {
        var name = pool[i] || "Player " + (i + 1);
        jobs.push(ctx.api.join(ctx.code, name, "bot-" + B2B.uid(), true));
      }
      return Promise.all(jobs);
    },

    // A simulated buyer's character, and when in each round it makes up its mind.
    plan: function (p) {
      var r = bots.rnd, pl = bots.plans[p.id];
      if (!pl) pl = bots.plans[p.id] = { nerve: r(), at: {}, met: {} };
      return pl;
    },

    // What a simulated buyer believes about a start-up, from what it is allowed to see in this round.
    belief: function (b, s, deals, round, rule) {
      var done = round - 1;
      var own = deals.filter(function (d) { return d.round <= done && d.buyer_id === b.id && d.seller_id === s.id; });
      if (own.some(function (d) { return d.delivered === false; })) return "bad";      // it burned me
      if (own.some(function (d) { return d.delivered === true; })) return "good";      // it delivered for me
      if (rule.intros) {
        var k = b.card.knows.filter(function (x) { return x.id === s.id; })[0];
        if (k) return k.ready ? "good" : "bad";
      }
      if (rule.record) {
        var rec = E.record(s.id, deals, done);
        if (rec.failed.length) return "bad";
        if (rec.delivered.length) return "good";
      }
      if (rule.proof && s.card.proof) return "good";
      return "unknown";
    },

    // One simulated buyer decides for the round. Returns a Promise, or null to try again later.
    decide: function (ctx, hs, b, pl) {
      var r = bots.rnd, g = hs.game, round = g.round, rule = E.roundRule(ctx.cfg, round);
      var sellers = hs.players.filter(function (p) { return p.role === "seller"; });
      // In two minutes a buyer hears a handful of pitches, not all of them.
      if (!pl.met[round]) {
        pl.met[round] = E.shuffle(sellers, r).slice(0, 3 + Math.floor(r() * 3)).map(function (s) { return s.id; });
        // With an introduction in hand, a buyer goes looking for the start-up it knows.
        if (rule.intros) (b.card.knows || []).forEach(function (k) { if (pl.met[round].indexOf(k.id) < 0) pl.met[round].push(k.id); });
      }
      var free = sellers.filter(function (s) {
        return pl.met[round].indexOf(s.id) >= 0 && !hs.deals.some(function (d) { return d.round === round && d.seller_id === s.id; });
      });
      var good = [], unknown = [];
      free.forEach(function (s) {
        var v = bots.belief(b, s, hs.deals, round, rule);
        if (v === "good") good.push(s); else if (v === "unknown") unknown.push(s);
      });
      var pickOne = null, kind = "stay";
      if (good.length && r() < 0.92) { pickOne = E.pick(good, r); kind = "full"; }
      else if (unknown.length) {
        if (rule.pilot) { if (r() < 0.35 + 0.35 * pl.nerve) { pickOne = E.pick(unknown, r); kind = "pilot"; } }
        else if (r() < 0.1 + 0.4 * pl.nerve) { pickOne = E.pick(unknown, r); kind = "full"; }      // a blind bet on the pitch alone
      }
      return ctx.api.sign(ctx.code, b.token, pickOne ? pickOne.card.code : null, kind);
    },

    // Call on every host refresh. Bots act through the normal player calls.
    tick: function (ctx, hs) {
      var g = hs.game, jobs = [];
      if (g.phase === "lobby") { bots.plans = {}; return Promise.resolve(0); }
      if (g.phase !== "open" || !g.total_ms) return Promise.resolve(0);
      var frac = (g.total_ms - Math.max(0, g.ends_at - hs.now)) / g.total_ms;
      hs.players.forEach(function (b) {
        if (!b.is_bot || b.role !== "buyer" || !b.token) return;
        if (hs.deals.some(function (d) { return d.round === g.round && d.buyer_id === b.id; })) return;
        var pl = bots.plan(b);
        if (pl.at[g.round] == null) pl.at[g.round] = 0.2 + bots.rnd() * 0.65;
        if (frac < pl.at[g.round]) return;
        // Lost a race for a start-up that was signed a moment ago: think again on the next refresh.
        jobs.push(bots.decide(ctx, hs, b, pl).catch(function () { pl.met[g.round] = null; }));
      });
      return Promise.all(jobs).then(function () { return jobs.length; });
    }
  };

  B2B.driver = driver;
  B2B.bots = bots;
  B2B.leader = leader;
  B2B.speed = speed;
  B2B.hostRound = hostRound;
})(typeof window !== "undefined" ? window : globalThis);
