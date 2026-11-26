/* Game rules: who plays what, what each round allows, and how a round is scored.
   Pure functions with no network or page access, so the same code runs on the
   host laptop, on phones and in the offline demo.

   The game in one paragraph: buyers can stay with the supplier they have (safe) or sign a
   start-up (more to win, more to lose). Some start-ups are secretly not ready and will fail.
   Each round gives the room one more way to tell them apart: proof and pilots, then
   references and introductions. */
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

  // ---------- card file checks ----------
  function validateCards(cards) {
    var problems = [];
    if (!cards || !Array.isArray(cards.sellers) || !Array.isArray(cards.buyers)) return ["cards.json must contain sellers and buyers."];
    if (!cards.sellers.length) problems.push("cards.json has no seller cards.");
    if (!cards.buyers.length) problems.push("cards.json has no buyer cards.");
    cards.sellers.forEach(function (s) { if (!s.id || !s.name || !s.tagline) problems.push("A seller card needs id, name and tagline: " + JSON.stringify(s.id || s.name || "?")); });
    cards.buyers.forEach(function (b) { if (!b.id || !b.enterprise || !b.title) problems.push("A buyer card needs id, enterprise and title: " + JSON.stringify(b.id || b.enterprise || "?")); });
    if (!Array.isArray(cards.rounds) || !cards.rounds.length) problems.push('cards.json needs "rounds": the wording for each round.');
    return problems;
  }

  // ---------- the rounds ----------
  function roundCount(cfg) { return cfg.game.rounds.length; }
  // What round `r` (1-based) allows.
  function roundRule(cfg, r) { return cfg.game.rounds[clamp(r, 1, roundCount(cfg)) - 1]; }
  // What the database has to know to referee: how many rounds, and from which round a pilot may be signed and proof is shown.
  function serverRules(cfg) {
    var pilot = 0, proof = 0;
    cfg.game.rounds.forEach(function (x, i) { if (x.pilot && !pilot) pilot = i + 1; if (x.proof && !proof) proof = i + 1; });
    return { rounds: roundCount(cfg), pilotFrom: pilot || 99, proofFrom: proof || 99 };
  }
  // Rounds whose results everybody may see.
  function closedRounds(game) {
    if (!game) return 0;
    if (game.phase === "open") return Math.max(0, (game.round || 0) - 1);
    if (game.phase === "reveal" || game.phase === "locked") return game.round || 0;
    return 0;
  }

  // ---------- assignment ----------
  function makeCtx(assigned, cards, cfg, rnd) {
    var ctx = { cards: cards, cfg: cfg, rnd: rnd, players: [], used: {}, codes: {}, dirty: {} };
    (assigned || []).forEach(function (p) {
      var w = { id: p.id, name: p.name, role: p.role, card: clone(p.card) };
      ctx.players.push(w);
      if (w.card && w.card.code) ctx.codes[w.card.code] = true;
      if (w.card && w.card.templateId) ctx.used[w.card.templateId] = (ctx.used[w.card.templateId] || 0) + 1;
    });
    return ctx;
  }

  // Give a player a role card. `kind` for a seller: { ready, proof }.
  function place(ctx, p, role, kind) {
    var pool = role === "seller" ? ctx.cards.sellers : ctx.cards.buyers;
    var least = Math.min.apply(null, pool.map(function (t) { return ctx.used[t.id] || 0; }));
    var t = pick(pool.filter(function (x) { return (ctx.used[x.id] || 0) === least; }), ctx.rnd);
    var uses = (ctx.used[t.id] = (ctx.used[t.id] || 0) + 1);
    var suffix = ROMAN[uses] != null ? ROMAN[uses] : " " + uses;
    var card, pub;
    if (role === "seller") {
      // A two-digit deal code. A buyer has to hear it from the seller, so deals are made face to face.
      var code;
      do { code = String(10 + Math.floor(ctx.rnd() * 90)); } while (ctx.codes[code] && Object.keys(ctx.codes).length < 90);
      ctx.codes[code] = true;
      card = { role: "seller", templateId: t.id, org: t.name + suffix, tagline: t.tagline, ready: !!kind.ready, proof: !!(kind.ready && kind.proof), code: code };
      pub = { org: card.org, tagline: card.tagline };
    } else {
      card = { role: "buyer", templateId: t.id, org: t.enterprise + suffix, title: t.title, need: t.need || "",
               incumbent: (t.incumbent && t.incumbent.name) || "your current supplier", knows: [] };
      pub = { org: card.org, title: card.title };
    }
    var w = { id: p.id, name: p.name, role: role, card: card, pub: pub, isNew: true };
    ctx.players.push(w);
    return w;
  }

  // A buyer "knows" a few start-ups: in the round with introductions they see whether each one is ready.
  function introduce(ctx, buyer, seller) {
    if (buyer.card.knows.some(function (k) { return k.id === seller.id; })) return false;
    buyer.card.knows.push({ id: seller.id, name: seller.name, org: seller.card.org, ready: seller.card.ready });
    ctx.dirty[buyer.id] = true;
    return true;
  }

  function toPatch(ctx) {
    var out = [];
    ctx.players.forEach(function (w) {
      if (w.isNew) out.push({ id: w.id, role: w.role, card: w.card, pub: w.pub });
      else if (ctx.dirty[w.id]) out.push({ id: w.id, card: w.card });
    });
    return { players: out };
  }

  // First assignment, when the host presses Start. `players` = [{id, name}].
  function assign(players, cards, cfg, rnd) {
    rnd = rnd || makeRng();
    var G = cfg.game, ctx = makeCtx([], cards, cfg, rnd);
    var order = shuffle(players, rnd), n = order.length;
    var nS = Math.round(n * cfg.sellerShare);
    if (n >= 2) nS = clamp(nS, 1, n - 1);
    // Fixed numbers of each kind, so every game has start-ups that are not ready and start-ups with proof.
    var nLemon = nS >= 2 ? clamp(Math.round(nS * G.lemonShare), 1, nS - 1) : 0;
    var nReady = nS - nLemon;
    var nProof = nReady >= 2 ? clamp(Math.round(nReady * G.proofShare), 1, nReady - 1) : 0;
    var sellers = order.slice(0, nS).map(function (p, i) {
      return place(ctx, p, "seller", { ready: i >= nLemon, proof: i >= nLemon && i < nLemon + nProof });
    });
    var buyers = order.slice(nS).map(function (p) { return place(ctx, p, "buyer"); });
    // Introductions, spread evenly: every start-up is known by about the same number of buyers.
    var queue = shuffle(sellers, rnd), q = 0;
    for (var k = 0; k < (G.introsPerBuyer || 0); k++) {
      shuffle(buyers, rnd).forEach(function (b) {
        for (var tries = 0; tries < queue.length; tries++) {
          var s = queue[q % queue.length]; q++;
          if (introduce(ctx, b, s)) break;
        }
      });
    }
    return toPatch(ctx);
  }

  // Late joiners. `assigned` = players that already hold a role (with cards).
  function assignLate(newcomers, assigned, cards, cfg, rnd) {
    rnd = rnd || makeRng();
    var G = cfg.game, ctx = makeCtx(assigned, cards, cfg, rnd);
    newcomers.forEach(function (p) {
      var sellers = ctx.players.filter(function (x) { return x.role === "seller"; });
      var nS = sellers.length, nB = ctx.players.length - nS, n = ctx.players.length + 1;
      var role = Math.abs((nS + 1) / n - cfg.sellerShare) <= Math.abs(nS / n - cfg.sellerShare) ? "seller" : "buyer";
      if (nB === 0) role = "buyer"; else if (nS === 0) role = "seller";
      if (role === "seller") {
        var lemons = sellers.filter(function (x) { return !x.card.ready; }).length;
        var ready = lemons / (nS + 1) >= G.lemonShare;
        var readies = nS - lemons, proofs = sellers.filter(function (x) { return x.card.proof; }).length;
        place(ctx, p, "seller", { ready: ready, proof: ready && proofs / (readies + 1) < G.proofShare });
      } else {
        var w = place(ctx, p, "buyer");
        shuffle(sellers, rnd).slice(0, G.introsPerBuyer || 0).forEach(function (s) { introduce(ctx, w, s); });
      }
    });
    return toPatch(ctx);
  }

  // ---------- scoring ----------
  // A "row" is one buyer's decision in one round: { round, buyer_id, seller_id, kind: "full"|"pilot"|"stay", delivered }.
  // A buyer with no row in a closed round stayed with their supplier by default.
  function buyerRound(row, cfg) {
    var P = cfg.payoff;
    if (!row || row.kind === "stay") return P.stay;
    if (row.kind === "pilot") return row.delivered ? P.pilotWin : P.pilotLose;
    return row.delivered ? P.fullWin : P.fullLose;
  }
  function sellerRound(row, cfg) {
    var P = cfg.payoff;
    return !row ? 0 : row.kind === "pilot" ? P.sellerPilot : P.sellerFull;
  }
  function rowOf(player, deals, round) {
    return deals.filter(function (d) {
      return d.round === round && (player.role === "seller" ? d.seller_id === player.id : d.buyer_id === player.id);
    })[0] || null;
  }
  // Points for rounds 1..upTo. Returns { total, rounds: [{ round, row, points }] }.
  function score(player, deals, upTo, cfg) {
    var out = { total: 0, rounds: [] };
    for (var r = 1; r <= upTo; r++) {
      var row = rowOf(player, deals, r);
      var pts = player.role === "seller" ? sellerRound(row, cfg) : buyerRound(row, cfg);
      out.rounds.push({ round: r, row: row, points: pts });
      out.total += pts;
    }
    return out;
  }
  // What a start-up did in the rounds already closed: its references, and its failures.
  function record(sellerId, deals, upTo) {
    var mine = deals.filter(function (d) { return d.seller_id === sellerId && d.round <= upTo && d.kind !== "stay"; });
    return { delivered: mine.filter(function (d) { return d.delivered; }), failed: mine.filter(function (d) { return !d.delivered; }) };
  }

  B2B.engine = {
    makeRng: makeRng, shuffle: shuffle, pick: pick, clone: clone, clamp: clamp,
    validateCards: validateCards, assign: assign, assignLate: assignLate,
    roundCount: roundCount, roundRule: roundRule, serverRules: serverRules, closedRounds: closedRounds,
    buyerRound: buyerRound, sellerRound: sellerRound, rowOf: rowOf, score: score, record: record
  };
})(typeof window !== "undefined" ? window : globalThis);
