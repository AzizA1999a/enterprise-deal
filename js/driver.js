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

    // The host pressed Start: draw this game's rules, deal the role cards, then begin the briefing.
    start: function (ctx, hs) {
      var rules = E.makeRules(hs.players.length, ctx.cards, ctx.cfg);
      var patch = E.assign(hs.players.map(function (p) { return { id: p.id, name: p.name }; }), ctx.cards, rules);
      return ctx.api.hostApply(ctx.code, ctx.pin, patch).then(function () {
        return ctx.api.host(ctx.code, ctx.pin, "start", { briefing_ms: speed.ms(ctx.code, hs.players, ctx.cfg.briefingSeconds * 1000), rules: rules });
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
        step = function () { return ctx.api.hostApply(ctx.code, ctx.pin, E.assignLate(newcomers, assigned, ctx.cards, g.rules)); };
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

    // A simulated founder's habits. About a third only ever send cold emails; the rest market first.
    plan: function (p) {
      var r = bots.rnd, pl = bots.plans[p.id];
      if (!pl) pl = bots.plans[p.id] = { cold: r() < 0.3, generous: r() < 0.6, next: {}, vouchAt: {}, pickAt: 0.1 + r() * 0.7 };
      return pl;
    },

    // Choose a giant and a message. A founder who knows someone inside a giant usually goes after that one.
    choose: function (ctx, hs, p) {
      var r = bots.rnd, ids = Object.keys(hs.game.rules.giants), c = p.card.contact;
      var giant = c && r() < 0.55 ? c.giant : E.pick(ids, r);
      var message = c && c.giant === giant ? p.card.hint : E.pick(E.MESSAGES, r);
      return ctx.api.target(ctx.code, p.token, giant, message);
    },

    // The next move of one simulated start-up, or null when it has nothing sensible left to do this round.
    nextMove: function (ctx, hs, p, pl) {
      var r = bots.rnd, R = hs.game.rules, st = p.state, door = st.progress, left = E.budgetLeft(R, st, hs.game.round);
      function can(m) { return R.moves[m] && R.moves[m].cost <= left; }
      // An introduction in hand is always the first thing to use.
      var intro = hs.intros.filter(function (i) { return i.to_id === p.id && !i.used && i.giant === st.giant && i.door === door; })[0];
      if (intro && can("intro")) return { move: "intro", intro: intro.id };
      var c = p.card.contact;
      if (c && c.giant === st.giant && c.door === door && !st.self_used && can("intro")) return { move: "intro", intro: "self" };
      if (pl.cold) return can("cold") ? { move: "cold" } : null;
      if (!st.aware && can("content") && r() < 0.8) return { move: "content" };
      if (!E.knowsPriority(p.card, st) && can("research") && r() < 0.35) return { move: "research" };
      var best = [["pilot", "cold"], ["proof"], ["partner", "proof"], ["pilot", "proof"]][door];
      for (var i = 0; i < best.length; i++) if (can(best[i])) return { move: best[i] };
      return null;
    },

    // Call on every host refresh. Bots act through the normal player calls.
    tick: function (ctx, hs) {
      var g = hs.game, jobs = [], r = bots.rnd;
      if (g.phase === "lobby") { bots.plans = {}; return Promise.resolve(0); }
      var mine = hs.players.filter(function (p) { return p.is_bot && p.role && p.token; });
      if (g.phase === "briefing") {
        var gone = g.briefing_ends_at ? 1 - Math.max(0, g.briefing_ends_at - hs.now) / Math.max(1, ctx.cfg.briefingSeconds * 1000 / speed.of(ctx.code, hs.players)) : 1;
        mine.forEach(function (p) {
          var pl = bots.plan(p);
          if (!p.state.giant && gone >= pl.pickAt) jobs.push(bots.choose(ctx, hs, p).catch(function () {}));
        });
        return Promise.all(jobs).then(function () { return jobs.length; });
      }
      if (g.phase !== "open" || !g.total_ms) return Promise.resolve(0);
      var frac = (g.total_ms - Math.max(0, g.ends_at - hs.now)) / g.total_ms;
      mine.forEach(function (p) {
        var pl = bots.plan(p), st = p.state;
        if (!st.giant) { jobs.push(bots.choose(ctx, hs, p).catch(function () {})); return; }
        // Introduce a classmate who is standing at the door of the person this founder knows.
        if (pl.vouchAt[g.round] == null) pl.vouchAt[g.round] = 0.05 + r() * 0.6;
        if (pl.generous && st.vouched < g.rules.vouches && frac >= pl.vouchAt[g.round] && !pl["v" + g.round]) {
          pl["v" + g.round] = true;
          var c = p.card.contact;
          var asking = hs.players.filter(function (x) {
            return x.role && x.id !== p.id && x.state.giant === c.giant && x.state.progress === c.door &&
              !hs.intros.some(function (i) { return i.to_id === x.id && i.door === c.door && i.giant === c.giant; });
          });
          if (asking.length) { jobs.push(ctx.api.vouch(ctx.code, p.token, E.pick(asking, r).card.code).catch(function () {})); return; }
        }
        // Spend the budget in a few sittings spread over the round.
        if (pl.next[g.round] == null) pl.next[g.round] = 0.08 + r() * 0.3;
        if (frac < pl.next[g.round] || st.progress >= E.DOORS) return;
        pl.next[g.round] = frac + 0.1 + r() * 0.2;
        if (E.knowsPriority(p.card, st) && g.rules.giants[st.giant].priority !== st.message) {
          jobs.push(ctx.api.target(ctx.code, p.token, null, g.rules.giants[st.giant].priority).catch(function () {}));
          return;
        }
        var m = bots.nextMove(ctx, hs, p, pl);
        if (m) jobs.push(ctx.api.move(ctx.code, p.token, m.move, m.intro).catch(function () {}));
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
