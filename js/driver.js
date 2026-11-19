/* Runs on the host laptop only.
   driver: the automatic steps (assign late joiners, open the market after the
           briefing, lock at zero, resolve deliveries).
   bots:   simulated players for demo mode. They use the same calls as phones. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});
  var E = B2B.engine;

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
        pl = { sendAt: [0.04 + r() * 0.3, 0.2 + r() * 0.4, 0.4 + r() * 0.42].sort(), sent: 0 };
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
      return ctx.api.offer(ctx.code, s.token, target.id, price, pilot, proof);
    },

    buyerLook: function (ctx, hs, b, pl, frac) {
      var r = bots.rnd;
      var byId = {};
      hs.players.forEach(function (p) { byId[p.id] = p; });
      var pending = hs.offers.filter(function (o) { return o.buyer_id === b.id && o.status === "pending"; });
      pending.forEach(function (o) {
        if (!pl.scores[o.id]) pl.scores[o.id] = bots.scoreOffer(b, o, byId[o.seller_id].pub, ctx.cfg);
      });
      var threshold = 84 - 20 * frac;
      var best = pending.slice().sort(function (x, y) { return pl.scores[y.id].total - pl.scores[x.id].total; })[0];
      if (best && pl.scores[best.id].total >= threshold) {
        pl.reason = pl.scores[best.id].top;
        return ctx.api.decide(ctx.code, b.token, best.id, true, null);
      }
      if (frac >= pl.giveUp) {
        if (pl.abstain) return null;
        pl.reason = "incumbent";
        return ctx.api.incumbent(ctx.code, b.token);
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
  B2B.bots = bots;
})(typeof window !== "undefined" ? window : globalThis);
