/* Game rules: role assignment, connections, offer fit, scoring, delivery.
   Pure functions with no network or page access, so the same code runs on the
   host laptop, on phones (to explain an offer) and in the offline demo. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});

  // ---------- small helpers ----------
  function makeRng(seed) {
    var a = seed == null ? (Math.random() * 4294967296) >>> 0 : seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a;
  }
  function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  var ROMAN = ["", "", " II", " III", " IV", " V", " VI"];
  // Stable pseudo-random number in [0,1) from a string, so two host screens always agree.
  function hash01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // ---------- card file checks ----------
  function validateCards(cards) {
    var problems = [];
    if (!cards || !cards.categories || !cards.sellers || !cards.buyers) {
      return ["cards.json must contain categories, sellers and buyers."];
    }
    cards.categories.forEach(function (c) {
      if (!cards.sellers.some(function (s) { return s.category === c.id; })) problems.push('No seller cards for category "' + c.id + '".');
      if (!cards.buyers.some(function (b) { return b.category === c.id; })) problems.push('No buyer cards for category "' + c.id + '".');
    });
    cards.sellers.forEach(function (s) {
      if (!(s.floor <= s.list)) problems.push("Seller " + s.id + ": floor must not exceed list price.");
      if (!(s.reliability > 0 && s.reliability <= 1)) problems.push("Seller " + s.id + ": reliability must be between 0 and 1.");
      (s.assets || []).forEach(function (a) { if (!cards.proofs[a]) problems.push("Seller " + s.id + ': unknown asset "' + a + '".'); });
    });
    cards.buyers.forEach(function (b) {
      if (!cards.priorities[b.priority]) problems.push("Buyer " + b.id + ': unknown priority "' + b.priority + '".');
      if (!b.incumbent || !(b.incumbent.price > 0)) problems.push("Buyer " + b.id + ": incumbent price missing.");
      var t = b.constraint && b.constraint.type;
      if (["requires_proof", "requires_pilot", "min_savings", "max_deploy_weeks"].indexOf(t) < 0) problems.push("Buyer " + b.id + ': unknown constraint type "' + t + '".');
    });
    if (cards.rivals) {
      ["early", "counter", "final"].forEach(function (k) { if (!cards.rivals[k]) problems.push('rivals: the "' + k + '" message is missing.'); });
      Object.keys(cards.priorities).forEach(function (k) { if (!(cards.rivals.addons || {})[k]) problems.push('rivals: no add-on text for priority "' + k + '".'); });
    }
    return problems;
  }

  // ---------- assignment ----------
  function categoriesInPlay(nBuyers, cards, cfg) {
    var n = clamp(Math.floor(nBuyers / (cfg.minBuyersPerCategory || 2)), 1, cards.categories.length);
    return cards.categories.slice(0, n).map(function (c) { return c.id; });
  }

  function makeCtx(assigned, cards, cfg, rnd) {
    var ctx = { cards: cards, cfg: cfg, rnd: rnd, players: [], used: {}, dirty: {}, desks: {} };
    (assigned || []).forEach(function (p) {
      var w = { id: p.id, name: p.name, role: p.role, category: p.category, card: clone(p.card) };
      ctx.players.push(w);
      if (w.card && w.card.desk) ctx.desks[w.card.desk] = true;
      if (w.card && w.card.templateId) ctx.used[w.card.templateId] = (ctx.used[w.card.templateId] || 0) + 1;
    });
    return ctx;
  }

  function place(ctx, p, role, category) {
    var cards = ctx.cards;
    var pool = (role === "seller" ? cards.sellers : cards.buyers).filter(function (t) { return t.category === category; });
    if (!pool.length) throw new Error("No " + role + " cards for category " + category);
    var least = Math.min.apply(null, pool.map(function (t) { return ctx.used[t.id] || 0; }));
    var t = pick(pool.filter(function (x) { return (ctx.used[x.id] || 0) === least; }), ctx.rnd);
    var uses = (ctx.used[t.id] = (ctx.used[t.id] || 0) + 1);
    var suffix = ROMAN[uses] != null ? ROMAN[uses] : " " + uses;
    var cat = cards.categories.filter(function (c) { return c.id === category; })[0];
    var card, pub;
    if (role === "seller") {
      card = {
        role: "seller", templateId: t.id, category: category, categoryName: cat.name,
        org: t.name + suffix, tagline: t.tagline, list: t.list, floor: t.floor,
        assets: (t.assets || []).slice(), reliability: t.reliability, deployWeeks: t.deploy_weeks, connections: []
      };
      // What this seller's extras cost. Kept on the card so the phone, the host and the database all agree.
      var T = ctx.cfg.tokens;
      if (T && T.on) {
        card.tokens = { budget: T.perSeller, pilot: card.assets.indexOf("pilot_ready") >= 0 ? T.pilotReady : T.pilot,
                        fast: T.fast, proof: T.proof, fastWeeks: T.fastWeeks };
      }
      pub = { org: card.org, tagline: card.tagline, category: category, deployWeeks: card.deployWeeks };
    } else {
      card = {
        role: "buyer", templateId: t.id, category: category, categoryName: cat.name,
        org: t.enterprise + suffix, title: t.title, need: t.need, budget: t.budget,
        incumbent: { name: t.incumbent.name, price: t.incumbent.price },
        priority: t.priority, constraint: clone(t.constraint), connections: []
      };
      // A desk number only the buyer can see: a seller has to walk over and ask for it.
      if (ctx.cfg.requireMeetingCode) {
        var desk;
        do { desk = String(10 + Math.floor(ctx.rnd() * 90)); } while (ctx.desks[desk] && Object.keys(ctx.desks).length < 90);
        ctx.desks[desk] = true;
        card.desk = desk;
      }
      pub = { org: card.org, title: card.title, category: category, need: card.need };
    }
    var w = { id: p.id, name: p.name, role: role, category: category, card: card, pub: pub, isNew: true };
    ctx.players.push(w);
    return w;
  }

  function connect(ctx, seller, buyer) {
    var type = pick(Object.keys(ctx.cards.relationships), ctx.rnd);
    seller.card.connections.push({
      id: buyer.id, name: buyer.name, org: buyer.card.org, type: type,
      priority: buyer.card.priority, constraint: clone(buyer.card.constraint)
    });
    buyer.card.connections.push({
      id: seller.id, name: seller.name, org: seller.card.org, type: type,
      reliability: seller.card.reliability
    });
    ctx.dirty[seller.id] = true;
    ctx.dirty[buyer.id] = true;
  }

  // Pick the least-connected eligible partner in the same category.
  function findPartner(ctx, who, wantRole, maxPerPartner) {
    var linked = {};
    who.card.connections.forEach(function (c) { linked[c.id] = true; });
    var pool = ctx.players.filter(function (x) {
      return x.role === wantRole && x.category === who.category && !linked[x.id] && x.card.connections.length < maxPerPartner;
    });
    if (!pool.length) return null;
    var least = Math.min.apply(null, pool.map(function (x) { return x.card.connections.length; }));
    return pick(pool.filter(function (x) { return x.card.connections.length === least; }), ctx.rnd);
  }

  function connectSeller(ctx, seller, count) {
    for (var i = 0; i < count; i++) {
      var b = findPartner(ctx, seller, "buyer", ctx.cfg.maxConnectionsPerBuyer || 2);
      if (!b) return;
      connect(ctx, seller, b);
    }
  }

  function toPatch(ctx) {
    var out = [];
    ctx.players.forEach(function (w) {
      if (w.isNew) {
        out.push({ id: w.id, role: w.role, category: w.category, card: w.card, pub: w.pub,
                   offers_left: w.role === "seller" ? ctx.cfg.offersPerSeller : null });
      } else if (ctx.dirty[w.id]) {
        out.push({ id: w.id, card: w.card });
      }
    });
    return { players: out };
  }

  // First assignment, when the host presses Start. `players` = [{id, name}].
  function assign(players, cards, cfg, rnd) {
    rnd = rnd || makeRng();
    var ctx = makeCtx([], cards, cfg, rnd);
    var order = shuffle(players, rnd);
    var n = order.length;
    var nS = Math.round(n * cfg.sellerShare);
    if (n >= 2) nS = clamp(nS, 1, n - 1);
    var sellers = order.slice(0, nS), buyers = order.slice(nS);
    var cats = categoriesInPlay(buyers.length, cards, cfg);
    var placedSellers = [];
    buyers.forEach(function (p, i) { place(ctx, p, "buyer", cats[i % cats.length]); });
    sellers.forEach(function (p, i) { placedSellers.push(place(ctx, p, "seller", cats[i % cats.length])); });
    // Fixed quotas, so both "connected" and "not connected" groups are large enough to compare.
    var mix = cfg.connectionMix || [0.4, 0.4, 0.2];
    var n2 = Math.round(nS * mix[2]);
    var n0 = Math.round(nS * mix[0]);
    var n1 = Math.max(0, nS - n0 - n2);
    shuffle(placedSellers, rnd).forEach(function (s, i) {
      connectSeller(ctx, s, i < n2 ? 2 : i < n2 + n1 ? 1 : 0);
    });
    return toPatch(ctx);
  }

  // Late joiners. `assigned` = players that already hold a role (with cards).
  function assignLate(newcomers, assigned, cards, cfg, rnd) {
    rnd = rnd || makeRng();
    var ctx = makeCtx(assigned, cards, cfg, rnd);
    var mix = cfg.connectionMix || [0.4, 0.4, 0.2];
    newcomers.forEach(function (p) {
      var nS = ctx.players.filter(function (x) { return x.role === "seller"; }).length;
      var nB = ctx.players.length - nS;
      var n = ctx.players.length + 1;
      var role = Math.abs((nS + 1) / n - cfg.sellerShare) <= Math.abs(nS / n - cfg.sellerShare) ? "seller" : "buyer";
      if (nB === 0) role = "buyer";
      var cats = [];
      ctx.players.forEach(function (x) { if (cats.indexOf(x.category) < 0) cats.push(x.category); });
      if (!cats.length) cats = categoriesInPlay(1, cards, cfg);
      var counts = cats.map(function (c) {
        return ctx.players.filter(function (x) { return x.category === c && x.role === role; }).length;
      });
      var least = Math.min.apply(null, counts);
      var w = place(ctx, p, role, cats[counts.indexOf(least)]);
      if (role === "seller") {
        var r = rnd();
        connectSeller(ctx, w, r < mix[0] ? 0 : r < mix[0] + mix[1] ? 1 : 2);
      } else if (rnd() < 0.5) {
        var s = findPartner(ctx, w, "seller", 2);
        if (s) connect(ctx, s, w);
      }
    });
    return toPatch(ctx);
  }

  // ---------- resource tokens ----------
  // Proof a seller can choose to show. "Pilot-ready" is not shown: it makes the pilot cheaper.
  function showable(sellerCard) { return (sellerCard.assets || []).filter(function (a) { return a !== "pilot_ready"; }); }
  // Tokens one term sheet ties up. 0 when the game runs without tokens.
  function offerCost(sellerCard, offer) {
    var T = sellerCard && sellerCard.tokens;
    if (!T) return 0;
    return (offer.pilot ? T.pilot : 0) + (offer.fast ? T.fast : 0) +
      (offer.proof || []).filter(function (a) { return a !== "pilot_ready"; }).length * T.proof;
  }
  // Tokens tied up right now: open and signed term sheets. `exceptId` leaves out the one being edited.
  function tokensUsed(sellerCard, offers, exceptId) {
    return (offers || []).reduce(function (n, o) {
      return n + ((o.status === "pending" || o.status === "accepted") && o.id !== exceptId ? offerCost(sellerCard, o) : 0);
    }, 0);
  }
  function tokensFree(sellerCard, offers, exceptId) {
    var T = sellerCard && sellerCard.tokens;
    return T ? T.budget - tokensUsed(sellerCard, offers, exceptId) : Infinity;
  }
  // Weeks to go live under a term sheet: fast-track brings a slow start-up down to the fast-track time.
  function deployWeeks(offer, sellerPub, cfg) {
    var w = sellerPub && sellerPub.deployWeeks, fw = cfg.tokens && cfg.tokens.fastWeeks;
    return offer && offer.fast && w != null && fw != null ? Math.min(w, fw) : w;
  }
  // Did the seller know what this buyer cared about? "right", "wrong", or "none" (did not ask).
  function readOf(offer, buyerCard) {
    return !offer.guess || offer.guess === "none" ? "none" : offer.guess === buyerCard.priority ? "right" : "wrong";
  }

  // ---------- offer fit and scoring ----------
  // sellerPub needs deployWeeks; offer needs price, pilot, proof (and fast, when fast-track was added).
  function fit(buyerCard, offer, sellerPub, cfg) {
    var inc = buyerCard.incumbent.price;
    var savingsPct = ((inc - offer.price) / inc) * 100;
    var proof = offer.proof || [];
    var weeks = deployWeeks(offer, sellerPub, cfg);
    var rules = cfg.priorityRules;
    var priorityMet =
      buyerCard.priority === "lowest_cost" ? savingsPct >= rules.lowestCostSavingsPct :
      buyerCard.priority === "lowest_risk" ? !!offer.pilot || proof.indexOf("reference") >= 0 :
      buyerCard.priority === "fastest_deployment" ? weeks != null && weeks <= rules.fastestDeployWeeks : false;
    var c = buyerCard.constraint || {};
    var constraintMet =
      c.type === "requires_proof" ? proof.indexOf(c.proof) >= 0 :
      c.type === "requires_pilot" ? !!offer.pilot :
      c.type === "min_savings" ? savingsPct >= c.pct :
      c.type === "max_deploy_weeks" ? weeks != null && weeks <= c.weeks : true;
    return { savingsPct: savingsPct, priorityMet: priorityMet, constraintMet: constraintMet, overBudget: offer.price > buyerCard.budget };
  }

  function priorityRule(key, cfg) {
    var r = cfg.priorityRules;
    return key === "lowest_cost" ? "Met when the price is at least " + r.lowestCostSavingsPct + "% under your incumbent." :
           key === "lowest_risk" ? "Met when the offer includes a pilot or shows a reference customer." :
           key === "fastest_deployment" ? "Met when the start-up deploys in " + r.fastestDeployWeeks + " weeks or less. Fast-track counts." : "";
  }

  // ---------- the incumbent fights back ----------
  // A buyer's incumbent is played by the computer. Its counter-offers are kept on the
  // buyer's card as card.incumbent.counters = [{ kind, pct, addon, attack, vs, sig, at, t }].
  function counters(card) { return (card && card.incumbent && card.incumbent.counters) || []; }
  // The counter-offer a buyer accepted: `level` is how many counter-offers they had seen when they chose to stay.
  function standing(card, level) {
    var list = counters(card);
    return level > 0 && list.length ? list[Math.min(level, list.length) - 1] : null;
  }
  // What staying is worth with a given counter-offer (or with none).
  function stayValue(counter, cfg) {
    var P = cfg.points, parts = [{ label: "Stayed with the incumbent", value: P.incumbent }];
    if (counter) {
      if (counter.pct) parts.push({ label: "Counter-offer: " + counter.pct + "% off your renewal", value: Math.round(counter.pct * P.perPercentSaved) });
      if (counter.addon) parts.push({ label: "Counter-offer: an extra that fits your priority", value: (cfg.rivals || {}).addonPoints || 0 });
    }
    return { total: parts.reduce(function (s, x) { return s + x.value; }, 0), parts: parts };
  }

  // Should this buyer's incumbent make a (new) counter-offer right now? Pure: the caller handles the timing.
  // buyer = { card }, offers = every offer this buyer received, pubs = seller id -> pub, opts.early = the early-renewal moment has come.
  function rivalCounter(buyer, offers, pubs, cfg, opts) {
    var R = cfg.rivals;
    if (!R || !R.on) return null;
    var card = buyer.card, list = counters(card), last = list[list.length - 1];
    if (list.length >= R.maxCounters || (last && last.kind === "final")) return null;
    var live = offers.filter(function (o) { return o.status === "pending" && o.price <= card.budget; });
    if (!live.length) {
      // Nobody has reached this buyer yet: try to close the renewal before a start-up gets in the door.
      if (!list.length && !offers.length && opts && opts.early) return { kind: "early", pct: R.earlyDiscount, addon: false, attack: null, vs: null, sig: "" };
      return null;
    }
    var best = null, bestSav = -Infinity;
    live.forEach(function (o) {
      var f = fit(card, o, pubs[o.seller_id], cfg);
      if (f.savingsPct > bestSav) { best = o; bestSav = f.savingsPct; }
    });
    // Only react to something new: a new term sheet, or better terms on an old one.
    var sig = live.map(function (o) { return o.id + ":" + o.price + ":" + (o.pilot ? 1 : 0) + ":" + (o.proof || []).length + (o.fast ? ":f" : ""); }).sort().join("|");
    if (last && last.sig === sig) return null;
    var answered = list.filter(function (c) { return c.kind !== "early"; }).length;
    var isFinal = answered >= 1 || list.length >= R.maxCounters - 1;
    var prev = last ? last.pct : 0;
    var want = Math.round(Math.max(0, bestSav) * (isFinal ? R.finalMatchShare : R.matchShare));
    var pct = clamp(Math.max(want, R.firstDiscount, prev + (isFinal ? R.finalStep || 0 : 0)), prev, R.maxDiscount);
    var proof = best.proof || [];
    var attack = proof.indexOf("reference") < 0 ? "reference" : proof.indexOf("security_cert") < 0 ? "security_cert" : !best.pilot ? "pilot" : "young";
    var pub = pubs[best.seller_id] || {};
    return { kind: isFinal ? "final" : "counter", pct: pct, addon: isFinal, attack: attack, vs: pub.org || null, sig: sig };
  }

  // offer = the accepted offer (with delivered true/false), or null when the buyer stayed with the incumbent.
  // stay = { decision, level } of a buyer who did not sign a start-up.
  function buyerPoints(buyerCard, offer, sellerPub, cfg, stay) {
    var P = cfg.points;
    if (!offer) {
      if (stay && stay.decision === "incumbent_default" && counters(buyerCard).length) {
        return { total: P.incumbent, parts: [{ label: "Never decided: renewed at the full price", value: P.incumbent }] };
      }
      return stayValue(stay && stay.decision === "incumbent" ? standing(buyerCard, stay.level) : null, cfg);
    }
    if (offer.delivered === false) {
      return offer.pilot
        ? { total: P.failedWithPilot, parts: [{ label: "Start-up failed, but the pilot limited the damage", value: P.failedWithPilot }] }
        : { total: P.failed, parts: [{ label: "Start-up failed to deliver", value: P.failed }] };
    }
    var f = fit(buyerCard, offer, sellerPub, cfg);
    var parts = [{ label: "Start-up delivered", value: P.startupBase }];
    var sav = clamp(Math.round(f.savingsPct * P.perPercentSaved), -P.savingsCap, P.savingsCap);
    parts.push({ label: sav >= 0 ? "Savings against the incumbent" : "Paid more than the incumbent", value: sav });
    if (f.priorityMet) parts.push({ label: "Fits your hidden priority", value: P.priorityBonus });
    if (!f.constraintMet) parts.push({ label: "Broke your boss's rule", value: -P.constraintPenalty });
    var total = Math.max(0, parts.reduce(function (s, x) { return s + x.value; }, 0));
    return { total: total, parts: parts };
  }

  function sellerDealPoints(sellerCard, offer, cfg) {
    var P = cfg.points;
    if (offer.delivered === false) return 0;
    var span = sellerCard.list - sellerCard.floor;
    var held = span > 0 ? (offer.price - sellerCard.floor) / span : 1;
    var pts = P.sellerDeal + Math.round(P.sellerPriceHeld * clamp(held, 0, 1));
    // With tokens in play a pilot is paid for in tokens, not in points.
    if (!sellerCard.tokens && offer.pilot && sellerCard.assets.indexOf("pilot_ready") < 0) pts -= P.sellerPilotCost || 0;
    return Math.max(0, pts);
  }

  // ---------- delivery ----------
  function needsResolve(players, offers) {
    return offers.some(function (o) { return o.status === "accepted" && o.delivered == null; }) ||
           players.some(function (p) { return p.role && p.points == null; });
  }

  // Draw delivery once per signed deal and score everyone. Returns a patch.
  function resolve(players, offers, cfg, rnd) {
    rnd = rnd || makeRng();
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var offerPatch = [], sellerTotals = {}, buyerDeal = {};
    offers.forEach(function (o) {
      if (o.status !== "accepted") return;
      var seller = byId[o.seller_id];
      var delivered = o.delivered != null ? o.delivered : hash01("delivery:" + o.id) < seller.card.reliability;
      var resolved = { price: o.price, pilot: o.pilot, proof: o.proof, fast: o.fast, delivered: delivered };
      var sp = sellerDealPoints(seller.card, resolved, cfg);
      sellerTotals[o.seller_id] = (sellerTotals[o.seller_id] || 0) + sp;
      buyerDeal[o.buyer_id] = { offer: resolved, sellerPub: seller.pub };
      offerPatch.push({ id: o.id, delivered: delivered, seller_points: sp });
    });
    var playerPatch = [];
    players.forEach(function (p) {
      if (p.role === "seller") playerPatch.push({ id: p.id, points: sellerTotals[p.id] || 0 });
      else if (p.role === "buyer") {
        var d = buyerDeal[p.id];
        playerPatch.push({ id: p.id, points: buyerPoints(p.card, d ? d.offer : null, d ? d.sellerPub : null, cfg, { decision: p.decision, level: p.stay_level }).total });
      }
    });
    return { offers: offerPatch, players: playerPatch };
  }

  // ---------- clock ----------
  function remainingMs(game, now) {
    if (game.phase === "paused") return game.paused_ms || 0;
    if (game.phase === "open") return Math.max(0, game.ends_at - now);
    return 0;
  }

  B2B.engine = {
    makeRng: makeRng, hash01: hash01, shuffle: shuffle, pick: pick, clone: clone, clamp: clamp,
    validateCards: validateCards, categoriesInPlay: categoriesInPlay,
    assign: assign, assignLate: assignLate,
    showable: showable, offerCost: offerCost, tokensUsed: tokensUsed, tokensFree: tokensFree, deployWeeks: deployWeeks, readOf: readOf,
    fit: fit, priorityRule: priorityRule, buyerPoints: buyerPoints, sellerDealPoints: sellerDealPoints,
    counters: counters, standing: standing, stayValue: stayValue, rivalCounter: rivalCounter,
    needsResolve: needsResolve, resolve: resolve, remainingMs: remainingMs
  };
})(typeof window !== "undefined" ? window : globalThis);
