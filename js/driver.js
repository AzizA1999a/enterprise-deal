/* Runs on the host laptop only.
   driver: the automatic steps (assign late joiners, open the market after the
           briefing, lock at zero, resolve deliveries).
   rivals: the incumbents' account managers. Always computer-played, in a real
           class as well as in demo mode: they counter every start-up term sheet.
   bots:   simulated players for demo mode. They use the same calls as phones. */
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

  // One round of host duties: read the game, run automatic steps, let bots act. Returns the state.
  function hostRound(ctx, botsOn) {
    return ctx.api.hostState(ctx.code, ctx.pin).then(function (hs) {
      if (!leader.has(ctx.code)) return hs;
      return driver.tick(ctx, hs).then(function (changed) {
        if (changed) return hs;
        return rivals.tick(ctx, hs).then(function (moved) {
          if (moved || !botsOn) return hs;
          return bots.tick(ctx, hs).then(function () { return hs; });
        });
      });
    });
  }

  // ctx = { code, pin, cards, cfg, api }
  var driver = {
    busy: false,

    start: function (ctx, hs) {
      var patch = E.assign(hs.players.map(function (p) { return { id: p.id, name: p.name }; }), ctx.cards, ctx.cfg);
      return ctx.api.hostApply(ctx.code, ctx.pin, patch).then(function () {
        return ctx.api.host(ctx.code, ctx.pin, "start", { briefing_ms: ctx.cfg.briefingSeconds * 1000 });
      });
    },

    // Call on every host refresh. Does at most one automatic step.
    tick: function (ctx, hs) {
      if (driver.busy) return Promise.resolve(false);
      var g = hs.game, step = null;
      var assigned = hs.players.filter(function (p) { return p.role; });
      var newcomers = hs.players.filter(function (p) { return !p.role; });
      if (g.phase !== "lobby" && g.phase !== "locked" && newcomers.length) {
        step = function () { return ctx.api.hostApply(ctx.code, ctx.pin, E.assignLate(newcomers, assigned, ctx.cards, ctx.cfg)); };
      } else if (g.phase === "briefing" && hs.now >= g.briefing_ends_at) {
        step = function () { return ctx.api.host(ctx.code, ctx.pin, "open", { market_ms: ctx.cfg.marketSeconds * 1000 }); };
      } else if (g.phase === "open" && hs.now >= g.ends_at) {
        step = function () { return ctx.api.host(ctx.code, ctx.pin, "lock"); };
      } else if (g.phase === "locked" && E.needsResolve(assigned, hs.offers)) {
        step = function () { return ctx.api.hostApply(ctx.code, ctx.pin, E.resolve(assigned, hs.offers, ctx.cfg)); };
      }
      if (!step) return Promise.resolve(false);
      driver.busy = true;
      return step().then(function () { driver.busy = false; return true; }, function (e) { driver.busy = false; throw e; });
    }
  };

  // ===================================================================
  // The incumbents' account managers. One per buyer, played by this laptop.
  var rivals = {
    plans: {},
    rnd: Math.random,
    busy: false,

    tick: function (ctx, hs) {
      var R = ctx.cfg.rivals, g = hs.game;
      if (g.phase === "lobby") rivals.plans = {};
      if (!R || !R.on || rivals.busy || g.phase !== "open" || !g.total_ms) return Promise.resolve(false);
      var elapsed = g.total_ms - Math.max(0, g.ends_at - hs.now);
      var frac = elapsed / g.total_ms, t = Math.round(elapsed / 1000);
      var pubs = {}, patch = [], events = [], r = rivals.rnd;
      hs.players.forEach(function (p) { pubs[p.id] = p.pub; });
      hs.players.forEach(function (b) {
        if (b.role !== "buyer" || b.decision) return;
        var pl = rivals.plans[b.id] || (rivals.plans[b.id] = { early: R.earlyRenewalAt[0] + r() * (R.earlyRenewalAt[1] - R.earlyRenewalAt[0]), due: null });
        var mine = hs.offers.filter(function (o) { return o.buyer_id === b.id; });
        var c = E.rivalCounter(b, mine, pubs, ctx.cfg, { early: frac >= pl.early });
        if (!c) { pl.due = null; return; }
        // An account manager needs a moment to hear about the start-up and get a discount approved.
        if (pl.due == null) pl.due = hs.now + (c.kind === "early" ? 0 : (R.reactSeconds[0] + r() * (R.reactSeconds[1] - R.reactSeconds[0])) * 1000);
        if (hs.now < pl.due) return;
        pl.due = null;
        c.at = hs.now; c.t = t;
        var card = E.clone(b.card), pub = E.clone(b.pub);
        card.incumbent.counters = E.counters(card).concat([c]);
        pub.defence = { n: card.incumbent.counters.length, t: t, by: card.incumbent.name };
        patch.push({ id: b.id, card: card, pub: pub });
        events.push({ type: "counter", actor: b.id, data: { incumbent: card.incumbent.name, number: pub.defence.n, kind: c.kind, discount_pct: c.pct, extra: c.addon, against: c.vs, argument: c.attack } });
      });
      if (!patch.length) return Promise.resolve(false);
      rivals.busy = true;
      return ctx.api.hostApply(ctx.code, ctx.pin, { players: patch, events: events })
        .then(function () { rivals.busy = false; return true; }, function (e) { rivals.busy = false; throw e; });
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

    plan: function (p) {
      var r = bots.rnd, pl = bots.plans[p.id];
      if (pl) return pl;
      if (p.role === "seller") {
        pl = { sendAt: [0.04 + r() * 0.3, 0.2 + r() * 0.4, 0.4 + r() * 0.42].sort(), sent: 0, seen: {}, nextAnswer: 0 };
      } else {
        pl = { wake: 0.18 + r() * 0.35, giveUp: 0.74 + r() * 0.22, nextLook: 0, scores: {}, reason: null, abstain: r() < 0.12 };
      }
      pl.exitDelay = 1500 + r() * 9000;
      return (bots.plans[p.id] = pl);
    },

    scoreOffer: function (buyer, o, sellerPub, cfg) {
      var f = E.fit(buyer.card, o, sellerPub, cfg);
      var conn = buyer.card.connections.filter(function (c) { return c.id === o.seller_id; })[0];
      var risky = buyer.card.priority === "lowest_risk";
      var hard = (o.proof || []).filter(function (a) { return a !== "pilot_ready"; }).length;
      var parts = {
        price: f.savingsPct * (buyer.card.priority === "lowest_cost" ? 1.4 : 0.8),
        proof: hard * 12 * (risky ? 1.5 : 1),
        pilot: o.pilot ? 14 * (risky ? 1.5 : 1) : 0,
        trust: conn ? 6 + (conn.reliability - 0.75) * 100 : -3,
        fit: (f.priorityMet ? 12 : 0) + (f.constraintMet ? 0 : -40)
      };
      var total = f.overBudget ? -999 : parts.price + parts.proof + parts.pilot + parts.trust + parts.fit + (bots.rnd() * 16 - 8);
      var top = Object.keys(parts).sort(function (a, b) { return parts[b] - parts[a]; })[0];
      var why = !f.constraintMet ? "constraint" : f.overBudget || f.savingsPct < 5 ? "price" :
                hard === 0 && !o.pilot ? "proof" : !conn ? "unknown" : "fit";
      return { total: total, top: top, why: why };
    },

    sellerOffer: function (ctx, hs, s) {
      var r = bots.rnd;
      var mine = hs.offers.filter(function (o) { return o.seller_id === s.id; });
      var open = hs.players.filter(function (b) { return b.role === "buyer" && b.category === s.category && !b.decision; });
      if (!open.length) return null;
      var fresh = open.filter(function (b) { return !mine.some(function (o) { return o.buyer_id === b.id; }); });
      var revised = !fresh.length;
      var pool = revised ? open : fresh;
      var known = pool.filter(function (b) { return s.card.connections.some(function (c) { return c.id === b.id; }); });
      var target = known.length && r() < 0.85 ? E.pick(known, r) : E.pick(pool, r);
      var info = s.card.connections.filter(function (c) { return c.id === target.id; })[0];
      var frac = 0.35 + r() * 0.65;
      if (info && (info.priority === "lowest_cost" || info.constraint.type === "min_savings")) frac = r() * 0.35;
      if (revised) frac *= 0.5;
      var price = Math.round(s.card.floor + (s.card.list - s.card.floor) * frac);
      var hasPilot = s.card.assets.indexOf("pilot_ready") >= 0;
      var pilot = hasPilot ? r() < 0.7 : r() < 0.15;
      if (info && (info.constraint.type === "requires_pilot" || (info.priority === "lowest_risk" && r() < 0.8))) pilot = true;
      var proof = s.card.assets.slice();
      if (proof.length && r() > 0.9) proof.splice(Math.floor(r() * proof.length), 1);
      var open2 = mine.filter(function (o) { return o.buyer_id === target.id && o.status === "pending"; })[0];
      if (open2) return ctx.api.revise(ctx.code, s.token, open2.id, Math.min(open2.price, price), pilot || open2.pilot, proof);
      return ctx.api.offer(ctx.code, s.token, target.id, price, pilot, proof, target.card.desk);
    },

    // A seller hears that the incumbent has countered, and improves the open term sheet.
    sellerAnswer: function (ctx, hs, s, pl) {
      var r = bots.rnd, job = null;
      hs.offers.forEach(function (o) {
        if (job || o.seller_id !== s.id || o.status !== "pending") return;
        var b = hs.players.filter(function (x) { return x.id === o.buyer_id; })[0];
        var n = b && b.pub && b.pub.defence ? b.pub.defence.n : 0;
        if (!n || pl.seen[o.id] === n) return;
        pl.seen[o.id] = n;
        if (r() > 0.75) return;                                  // some sellers never hear about it
        var price = Math.round(o.price - (o.price - s.card.floor) * (0.3 + r() * 0.5));
        var pilot = o.pilot || s.card.assets.indexOf("pilot_ready") >= 0 || r() < 0.4;
        if (price === o.price && pilot === o.pilot) return;
        job = ctx.api.revise(ctx.code, s.token, o.id, price, pilot, s.card.assets.slice());
      });
      return job;
    },

    buyerLook: function (ctx, hs, b, pl, frac) {
      var r = bots.rnd;
      var byId = {};
      hs.players.forEach(function (p) { byId[p.id] = p; });
      var pending = hs.offers.filter(function (o) { return o.buyer_id === b.id && o.status === "pending"; });
      pending.forEach(function (o) {
        if (!pl.scores[o.id]) pl.scores[o.id] = bots.scoreOffer(b, o, byId[o.seller_id].pub, ctx.cfg);
      });
      // The incumbent's standing counter-offer raises the bar a start-up has to clear.
      var made = E.counters(b.card), level = made.length, standing = E.standing(b.card, level);
      var stayGain = E.stayValue(standing, ctx.cfg).total - ctx.cfg.points.incumbent;
      var threshold = 84 - 20 * frac + stayGain * 0.9;
      // An edited term sheet is scored again.
      pending.forEach(function (o) {
        var key = o.price + ":" + (o.pilot ? 1 : 0) + ":" + (o.proof || []).length;
        if (pl.scores[o.id].key !== key) { pl.scores[o.id] = bots.scoreOffer(b, o, byId[o.seller_id].pub, ctx.cfg); pl.scores[o.id].key = key; }
      });
      var best = pending.slice().sort(function (x, y) { return pl.scores[y.id].total - pl.scores[x.id].total; })[0];
      if (best && pl.scores[best.id].total >= threshold) {
        pl.reason = pl.scores[best.id].top;
        return ctx.api.decide(ctx.code, b.token, best.id, true, null, best.price);
      }
      // Take the counter-offer: at the end, or sooner when it is the final one, or when nobody has come to pitch.
      var takeNow = standing && (
        (standing.kind === "final" && (!best || pl.scores[best.id].total < threshold - 6) && r() < 0.3) ||
        (standing.kind === "early" && !pending.length && r() < 0.12));
      if (frac >= pl.giveUp || takeNow) {
        if (pl.abstain && !takeNow) return null;
        pl.reason = "incumbent";
        return ctx.api.incumbent(ctx.code, b.token, level);
      }
      var weak = pending.filter(function (o) { return pl.scores[o.id].total < threshold - 22; })[0];
      if (weak) return ctx.api.decide(ctx.code, b.token, weak.id, false, r() < 0.85 ? pl.scores[weak.id].why : null);
      return null;
    },

    exitAnswer: function (hs, p, pl) {
      var r = bots.rnd;
      if (p.role === "buyer") {
        var a = p.decision === "startup" ? pl.reason || "fit" : "incumbent";
        if (r() < 0.15) a = E.pick(p.decision === "startup" ? ["trust", "price", "proof", "fit", "pilot"] : ["incumbent", "incumbent", "price", "proof"], r);
        return a;
      }
      var wins = hs.offers.filter(function (o) { return o.seller_id === p.id && o.status === "accepted"; });
      if (!wins.length) return E.pick(["incumbent", "incumbent", "incumbent", "trust", "trust", "price", "price", "proof", "proof"], r);
      var viaConn = wins.some(function (o) { return p.card.connections.some(function (c) { return c.id === o.buyer_id; }); });
      if (viaConn && r() < 0.65) return "trust";
      if (wins[0].pilot && r() < 0.35) return "pilot";
      return E.pick(["price", "price", "proof", "proof", "fit"], r);
    },

    // Call on every host refresh. Bots act through the normal player calls.
    tick: function (ctx, hs) {
      var g = hs.game, jobs = [];
      var live = hs.players.filter(function (p) { return p.is_bot && p.role && p.token; });
      if (g.phase === "open" && g.total_ms) {
        var frac = (g.total_ms - Math.max(0, g.ends_at - hs.now)) / g.total_ms;
        live.forEach(function (p) {
          var pl = bots.plan(p), job = null;
          if (p.role === "seller") {
            if (p.offers_left > 0 && pl.sent < pl.sendAt.length && frac >= pl.sendAt[pl.sent]) {
              pl.sent++;
              job = bots.sellerOffer(ctx, hs, p);
            } else if (hs.now >= pl.nextAnswer) {
              pl.nextAnswer = hs.now + 4000 + bots.rnd() * 6000;
              job = bots.sellerAnswer(ctx, hs, p, pl);
            }
          } else if (!p.decision && frac >= pl.wake && hs.now >= pl.nextLook) {
            pl.nextLook = hs.now + 2500 + bots.rnd() * 4000;
            job = bots.buyerLook(ctx, hs, p, pl, frac);
          }
          if (job) jobs.push(job.catch(function () { /* lost a race with another player: ignore */ }));
        });
      } else if (g.phase === "locked") {
        live.forEach(function (p) {
          var pl = bots.plan(p);
          if (p.exit_answer || p.points == null) return;
          if (!pl.lockedSeen) { pl.lockedSeen = hs.now; return; }
          if (hs.now - pl.lockedSeen < pl.exitDelay) return;
          jobs.push(ctx.api.exit(ctx.code, p.token, bots.exitAnswer(hs, p, pl)).catch(function () {}));
        });
      } else if (g.phase === "lobby") {
        bots.plans = {};
      }
      return Promise.all(jobs).then(function () { return jobs.length; });
    }
  };

  B2B.driver = driver;
  B2B.rivals = rivals;
  B2B.bots = bots;
  B2B.leader = leader;
  B2B.hostRound = hostRound;
})(typeof window !== "undefined" ? window : globalThis);
