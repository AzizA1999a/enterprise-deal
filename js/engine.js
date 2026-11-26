/* Game rules: role cards, what a marketing move is worth, and the score.
   Pure functions with no network or page access, so the same code runs on the
   host laptop, on phones and in the offline demo.

   The game in one paragraph: every player runs a start-up's marketing campaign to get inside
   one large company (a "giant"). A giant is four doors with one person behind each. Each round a
   start-up spends a small budget on moves; each move has a cost and a chance of opening the door
   the start-up is standing at. Every player also knows one person inside one giant, and can
   introduce a few classmates to them: the network is the room. */
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
  var DOORS = 4;
  var MESSAGES = ["cost", "risk", "speed"];

  // ---------- card file checks ----------
  function validateCards(cards) {
    var problems = [];
    if (!cards || !Array.isArray(cards.sellers) || !Array.isArray(cards.giants)) return ["cards.json must contain sellers (the start-ups) and giants."];
    if (!cards.sellers.length) problems.push("cards.json has no start-up cards.");
    if (!cards.giants.length) problems.push("cards.json has no giants.");
    cards.sellers.forEach(function (s) { if (!s.id || !s.name || !s.tagline) problems.push("A start-up card needs id, name and tagline: " + JSON.stringify(s.id || s.name || "?")); });
    cards.giants.forEach(function (g) {
      if (!g.id || !g.name) problems.push("A giant needs id and name: " + JSON.stringify(g.id || g.name || "?"));
      if (!Array.isArray(g.people) || g.people.length !== DOORS) problems.push("Giant " + (g.id || "?") + " needs " + DOORS + " people, in door order.");
    });
    if (!Array.isArray(cards.doors) || cards.doors.length !== DOORS) problems.push('cards.json needs "doors": ' + DOORS + " short labels.");
    MESSAGES.forEach(function (m) { if (!cards.messages || !cards.messages[m]) problems.push('cards.json "messages" needs "' + m + '".'); });
    return problems;
  }

  // ---------- the set-up of one game ----------
  // How many giants a class of this size plays with, so each one is contested.
  function giantsInPlay(nPlayers, cards, cfg) {
    var n = clamp(Math.round(nPlayers / (cfg.game.startupsPerGiant || 7)), nPlayers >= 6 ? 2 : 1, cards.giants.length);
    return cards.giants.slice(0, n).map(function (g) { return g.id; });
  }
  // Everything the referee (the database, or the offline store) needs: the settings, and for this game which
  // message each giant cares about. Drawn at random every game, so no file gives it away.
  function makeRules(nPlayers, cards, cfg, rnd) {
    rnd = rnd || makeRng();
    var G = cfg.game, giants = {};
    giantsInPlay(nPlayers, cards, cfg).forEach(function (id) { giants[id] = { priority: pick(MESSAGES, rnd) }; });
    return { rounds: G.rounds, budget: G.budget, slots: G.slots, vouches: G.vouches, awareBoost: G.awareBoost,
             fit: G.fit, misfit: G.misfit, fitDoors: G.fitDoors.slice(), moves: clone(G.moves), giants: giants };
  }
  // Rounds whose results are in.
  function closedRounds(game) {
    if (!game) return 0;
    if (game.phase === "open") return Math.max(0, (game.round || 0) - 1);
    if (game.phase === "reveal" || game.phase === "locked") return game.round || 0;
    return 0;
  }
  function newState() { return { giant: null, message: null, progress: 0, aware: false, researched: false, self_used: false, spent: {}, rank: null, signed_round: null, vouched: 0 }; }

  // ---------- role cards ----------
  function deal(ctx, p) {
    var pool = ctx.cards.sellers;
    var least = Math.min.apply(null, pool.map(function (t) { return ctx.used[t.id] || 0; }));
    var t = pick(pool.filter(function (x) { return (ctx.used[x.id] || 0) === least; }), ctx.rnd);
    var uses = (ctx.used[t.id] = (ctx.used[t.id] || 0) + 1);
    // A two-digit code. A classmate types it to introduce this start-up to the person they know.
    var code;
    do { code = String(10 + Math.floor(ctx.rnd() * 90)); } while (ctx.codes[code] && Object.keys(ctx.codes).length < 90);
    ctx.codes[code] = true;
    // The person this player knows: spread evenly over every door of every giant in play.
    if (!ctx.queue.length) ctx.queue = shuffle(ctx.slots, ctx.rnd);
    var slot = ctx.queue.pop(), giant = ctx.byId[slot.giant], who = giant.people[slot.door];
    var card = { templateId: t.id, org: t.name + (ROMAN[uses] != null ? ROMAN[uses] : " " + uses), tagline: t.tagline, code: code,
                 contact: { giant: giant.id, giantName: giant.name, door: slot.door, name: who.name, title: who.title },
                 hint: ctx.rules.giants[giant.id].priority };     // they also know what that giant cares about
    return { id: p.id, role: "startup", card: card, pub: { org: card.org, tagline: card.tagline } };
  }
  function makeCtx(assigned, cards, rules, rnd) {
    var ids = Object.keys(rules.giants), ctx = { cards: cards, rules: rules, rnd: rnd, used: {}, codes: {}, byId: {}, slots: [], queue: [] };
    cards.giants.forEach(function (g) { ctx.byId[g.id] = g; });
    ids.forEach(function (id) { for (var d = 0; d < DOORS; d++) ctx.slots.push({ giant: id, door: d }); });
    var taken = {};
    (assigned || []).forEach(function (p) {
      var c = p.card || {};
      if (c.code) ctx.codes[c.code] = true;
      if (c.templateId) ctx.used[c.templateId] = (ctx.used[c.templateId] || 0) + 1;
      if (c.contact) taken[c.contact.giant + ":" + c.contact.door] = (taken[c.contact.giant + ":" + c.contact.door] || 0) + 1;
    });
    // late joiners first fill the doors that the fewest players know
    if (assigned && assigned.length) {
      ctx.queue = shuffle(ctx.slots, rnd).sort(function (a, b) { return (taken[b.giant + ":" + b.door] || 0) - (taken[a.giant + ":" + a.door] || 0); });
    }
    return ctx;
  }
  // First deal, when the host presses Start. `players` = [{id, name}]. Returns a patch.
  function assign(players, cards, rules, rnd) {
    rnd = rnd || makeRng();
    var ctx = makeCtx([], cards, rules, rnd);
    return { players: shuffle(players, rnd).map(function (p) { return deal(ctx, p); }) };
  }
  // Late joiners. `assigned` = players that already hold a card.
  function assignLate(newcomers, assigned, cards, rules, rnd) {
    rnd = rnd || makeRng();
    var ctx = makeCtx(assigned, cards, rules, rnd);
    return { players: newcomers.map(function (p) { return deal(ctx, p); }) };
  }

  // ---------- what a move is worth ----------
  // The chance (%) that `move` opens door `door`, before the message is counted. null: this move opens no door.
  function baseOdds(rules, move, door, aware) {
    var m = rules.moves[move];
    if (!m || m.odds == null) return null;
    if (move === "intro") return m.odds;                                   // an introduction is worth the same to anyone
    return clamp((Array.isArray(m.odds) ? m.odds[door] : m.odds) + (aware ? rules.awareBoost : 0), 2, 95);
  }
  // What the start-up's message adds or takes away at this door.
  function fitShift(rules, move, door, message, priority) {
    if (move === "intro" || rules.fitDoors.indexOf(door) < 0 || !message || !priority) return 0;
    return message === priority ? rules.fit : -rules.misfit;
  }
  function odds(rules, move, door, state, priority) {
    var base = baseOdds(rules, move, door, state.aware);
    return base == null ? null : move === "intro" ? base : clamp(base + fitShift(rules, move, door, state.message, priority), 2, 95);
  }
  function spentIn(state, round) { return (state.spent && state.spent[round]) || 0; }
  function budgetLeft(rules, state, round) { return rules.budget - spentIn(state, round); }
  // Does this player know which message their target cares about?
  function knowsPriority(card, state) { return !!(state.researched || (card.contact && state.giant && card.contact.giant === state.giant)); }

  // ---------- the score ----------
  // intros: [{from_id, to_id}] ; players: every player row (with state).
  function score(player, players, intros, cfg, slots) {
    var P = cfg.points, st = player.state || newState(), parts = [];
    if (st.progress) parts.push({ label: st.progress + (st.progress === 1 ? " door opened" : " doors opened"), value: st.progress * P.door });
    if (st.rank != null) parts.push(st.rank <= slots ? { label: "Signed, among the first " + slots, value: P.win } : { label: "Got the signature, but too late", value: P.late });
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var helped = {};
    (intros || []).forEach(function (i) {
      var to = byId[i.to_id];
      if (i.from_id === player.id && to && to.state && to.state.rank != null) helped[i.to_id] = true;
    });
    var n = Object.keys(helped).length;
    if (n) parts.push({ label: n + (n === 1 ? " start-up you introduced signed" : " start-ups you introduced signed"), value: n * P.vouch });
    return { total: parts.reduce(function (s, x) { return s + x.value; }, 0), parts: parts };
  }

  B2B.engine = {
    DOORS: DOORS, MESSAGES: MESSAGES,
    makeRng: makeRng, shuffle: shuffle, pick: pick, clone: clone, clamp: clamp,
    validateCards: validateCards, giantsInPlay: giantsInPlay, makeRules: makeRules, closedRounds: closedRounds, newState: newState,
    assign: assign, assignLate: assignLate,
    baseOdds: baseOdds, fitShift: fitShift, odds: odds, spentIn: spentIn, budgetLeft: budgetLeft, knowsPriority: knowsPriority, score: score
  };
})(typeof window !== "undefined" ? window : globalThis);
