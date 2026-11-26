/* Results and CSV export. Everything is computed from the raw players, moves and introductions
   of one game; nothing here is estimated or invented. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});
  var DOOR_MOVES = ["cold", "intro", "proof", "pilot", "partner"];     // the moves that try to open a door

  function rate(won, n) { return { won: won, n: n, pct: n ? (won / n) * 100 : null }; }
  function rateOf(list) { return rate(list.filter(function (m) { return m.success; }).length, list.length); }
  function avg(nums) { return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null; }
  function tries(moves) { return moves.filter(function (m) { return m.success != null; }); }

  // How far the room has got: how many start-ups have opened each door. Works on public data.
  // players: [{giant, progress, rank}]
  function funnel(players, slots) {
    var inGame = players.filter(function (p) { return p.giant; }), E = B2B.engine, opened = [];
    for (var d = 0; d < E.DOORS; d++) opened.push(inGame.filter(function (p) { return p.progress > d; }).length);
    return { startups: players.filter(function (p) { return p.role; }).length, targeting: inGame.length, opened: opened,
             signed: opened[E.DOORS - 1], winners: inGame.filter(function (p) { return p.rank != null && p.rank <= slots; }).length };
  }
  // The same, giant by giant.
  function byGiant(players, ids, cards, slots) {
    var names = {};
    (cards.giants || []).forEach(function (g) { names[g.id] = g; });
    return ids.map(function (id) {
      var mine = players.filter(function (p) { return p.giant === id; }), f = funnel(mine, slots);
      var signed = mine.filter(function (p) { return p.rank != null; }).sort(function (a, b) { return a.rank - b.rank; });
      return { id: id, name: (names[id] || {}).name || id, need: (names[id] || {}).need || "", startups: mine.length, opened: f.opened,
               at: [0, 1, 2, 3].map(function (d) { return mine.filter(function (p) { return p.progress === d; }).length; }),
               winners: signed.filter(function (p) { return p.rank <= slots; }).map(function (p) { return { name: p.name, org: p.org }; }),
               late: signed.filter(function (p) { return p.rank > slots; }).length };
    });
  }
  // How often each kind of move opened a door. `round` limits it to one round; `door` to one door.
  function moveRates(moves, round, door) {
    var list = tries(moves).filter(function (m) { return (round == null || m.round === round) && (door == null || m.door === door); });
    return DOOR_MOVES.map(function (k) { return { key: k, rate: rateOf(list.filter(function (m) { return m.move === k; })) }; });
  }

  // full = { players: [rows with card and state], moves, intros, rules }
  function compute(full, cards) {
    var cfg = root.B2B_CONFIG, E = B2B.engine, R = full.rules || {};
    var slots = R.slots || cfg.game.slots, ids = Object.keys(R.giants || {});
    var startups = full.players.filter(function (p) { return p.role; });
    var byId = {};
    startups.forEach(function (p) { byId[p.id] = p; });
    var pub = startups.map(function (p) { return { id: p.id, name: p.name, org: p.card.org, role: p.role, giant: p.state.giant, progress: p.state.progress, rank: p.state.rank }; });
    var moves = full.moves.filter(function (m) { return byId[m.player_id]; });
    var intros = full.intros || [];
    function mine(p) { return moves.filter(function (m) { return m.player_id === p.id; }); }
    function group(list) {
      return { n: list.length, doors: avg(list.map(function (p) { return p.state.progress; })),
               signed: rate(list.filter(function (p) { return p.state.rank != null; }).length, list.length) };
    }
    function split(test) { return { yes: group(startups.filter(test)), no: group(startups.filter(function (p) { return !test(p); })) }; }

    // --- the network ---
    var usedIntro = function (p) { return mine(p).some(function (m) { return m.move === "intro"; }); };
    var network = {
      given: intros.length, used: intros.filter(function (i) { return i.used; }).length,
      intro: rateOf(tries(moves).filter(function (m) { return m.move === "intro"; })),
      cold: rateOf(tries(moves).filter(function (m) { return m.move === "cold"; })),
      groups: split(usedIntro)
    };
    // --- content: did being known help? ---
    var content = split(function (p) { return p.state.aware; });
    // --- message: the right one for this giant, or not (start-ups that picked one) ---
    var withMsg = startups.filter(function (p) { return p.state.giant && p.state.message; });
    function fits(p) { return R.giants[p.state.giant] && R.giants[p.state.giant].priority === p.state.message; }
    var message = { right: group(withMsg.filter(fits)), wrong: group(withMsg.filter(function (p) { return !fits(p); })),
                    researched: startups.filter(function (p) { return p.state.researched; }).length };
    // --- targeting: going where you know someone, and how crowded each giant was ---
    var targeting = split(function (p) { return p.card.contact && p.card.contact.giant === p.state.giant; });
    // --- where campaigns ended ---
    var stuck = [0, 1, 2, 3, 4].map(function (d) { return startups.filter(function (p) { return p.state.giant && p.state.progress === d; }).length; });
    // --- the first thing each start-up did ---
    var firsts = {};
    startups.forEach(function (p) {
      var m = mine(p).sort(function (a, b) { return a.at - b.at; })[0];
      if (!m) return;
      (firsts[m.move] = firsts[m.move] || []).push(p);
    });
    var first = Object.keys(firsts).map(function (k) { return { key: k, n: firsts[k].length, doors: avg(firsts[k].map(function (p) { return p.state.progress; })) }; })
      .sort(function (a, b) { return b.n - a.n; });
    // --- points ---
    var board = startups.map(function (p) {
      var sc = E.score(p, startups, intros, cfg, slots);
      var helped = {};
      intros.forEach(function (i) { if (i.from_id === p.id && byId[i.to_id] && byId[i.to_id].state.rank != null) helped[i.to_id] = true; });
      return { name: p.name, org: p.card.org, points: sc.total, doors: p.state.progress, rank: p.state.rank, giant: p.state.giant,
               gave: intros.filter(function (i) { return i.from_id === p.id; }).length, helped: Object.keys(helped).length, is_bot: p.is_bot };
    });
    var leaders = {
      startups: board.slice().sort(function (a, b) { return b.points - a.points || a.name.localeCompare(b.name); }),
      connectors: board.filter(function (x) { return x.gave > 0; }).sort(function (a, b) { return b.helped - a.helped || b.gave - a.gave || a.name.localeCompare(b.name); })
    };
    // --- what the winners did that the others did not ---
    var won = startups.filter(function (p) { return p.state.rank != null; }), rest = startups.filter(function (p) { return p.state.rank == null; });
    function share(list, test) { return rate(list.filter(test).length, list.length); }
    var winners = {
      n: won.length, others: rest.length,
      rows: [
        { key: "intro", label: "Used an introduction", won: share(won, usedIntro), rest: share(rest, usedIntro) },
        { key: "content", label: "Published a case study", won: share(won, function (p) { return p.state.aware; }), rest: share(rest, function (p) { return p.state.aware; }) },
        { key: "message", label: "Had the right message", won: share(won, function (p) { return p.state.giant && fits(p); }), rest: share(rest, function (p) { return p.state.giant && fits(p); }) }
      ]
    };

    var rounds = [];
    for (var r = 1; r <= (R.rounds || 0); r++) {
      rounds.push({ round: r, moves: moveRates(moves, r), opened: tries(moves).filter(function (m) { return m.round === r && m.success; }).length,
                    signed: startups.filter(function (p) { return p.state.signed_round != null && p.state.signed_round <= r; }).length });
    }
    return {
      simulated: full.players.filter(function (p) { return p.is_bot; }).length,
      counts: { startups: startups.length, giants: ids.length, moves: moves.length, slots: slots, rounds: R.rounds || 0 },
      funnel: funnel(pub, slots), giants: byGiant(pub, ids, cards, slots),
      moves: moveRates(moves), doors: [0, 1, 2, 3].map(function (d) { return moveRates(moves, null, d); }),
      network: network, content: content, message: message, targeting: targeting, stuck: stuck, first: first,
      leaders: leaders, winners: winners, rounds: rounds
    };
  }

  // ---------- CSV ----------
  function cell(v) {
    if (v == null) return "";
    var s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, lines) {
    return [header].concat(lines).map(function (l) { return l.map(cell).join(","); }).join("\r\n") + "\r\n";
  }
  function iso(ms) { return ms ? new Date(ms).toISOString() : ""; }
  function yn(b) { return b == null ? "" : b ? "yes" : "no"; }

  // One line per marketing move.
  function movesCsv(full, cards) {
    var byId = {}, giants = {}, doors = cards.doors || [];
    full.players.forEach(function (p) { byId[p.id] = p; });
    (cards.giants || []).forEach(function (g) { giants[g.id] = g.name; });
    var header = ["round", "seconds_into_round", "player", "startup", "target", "door", "move", "chance_pct", "opened_the_door", "introduced_by", "player_simulated"];
    return toCsv(header, full.moves.slice().sort(function (a, b) { return a.at - b.at; }).map(function (m) {
      var p = byId[m.player_id] || {}, via = m.via ? byId[m.via] : null;
      return [m.round, m.t, p.name, p.card ? p.card.org : "", giants[m.giant] || m.giant, doors[m.door] || m.door, m.move, m.odds == null ? "" : m.odds,
        yn(m.success), via ? (via.id === m.player_id ? "own contact" : via.name) : "", yn(p.is_bot)];
    }));
  }

  function playersCsv(full, cards, cfg) {
    var E = B2B.engine, giants = {}, R = full.rules || {}, slots = R.slots || cfg.game.slots;
    (cards.giants || []).forEach(function (g) { giants[g.id] = g.name; });
    var startups = full.players.filter(function (p) { return p.role; });
    var header = ["name", "simulated", "startup", "code", "knows", "knows_at", "target", "knew_someone_at_target", "message", "right_message", "published_case_study",
      "researched", "doors_opened", "signed", "signing_order", "moves_made", "introductions_given", "introductions_received", "points", "joined_at"];
    return toCsv(header, full.players.map(function (p) {
      var c = p.card || {}, s = p.state || {}, k = c.contact || {};
      var pr = s.giant && R.giants && R.giants[s.giant] ? R.giants[s.giant].priority : null;
      return [p.name, yn(p.is_bot), c.org || "", c.code || "", k.name ? k.name + ", " + k.title : "", giants[k.giant] || "", giants[s.giant] || "",
        s.giant ? yn(k.giant === s.giant) : "", s.message || "", s.giant && s.message ? yn(pr === s.message) : "", yn(s.aware), yn(s.researched),
        p.role ? s.progress : "", p.role ? yn(s.rank != null) : "", s.rank == null ? "" : s.rank,
        p.role ? full.moves.filter(function (m) { return m.player_id === p.id; }).length : "",
        p.role ? full.intros.filter(function (i) { return i.from_id === p.id; }).length : "",
        p.role ? full.intros.filter(function (i) { return i.to_id === p.id; }).length : "",
        p.role ? E.score(p, startups, full.intros, cfg, slots).total : "", iso(p.joined_at)];
    }));
  }

  function eventsCsv(events, players) {
    var names = {};
    players.forEach(function (p) { names[p.id] = p.name; });
    return toCsv(["at", "seconds_into_round", "event", "player", "details"], events.map(function (e) {
      return [iso(e.at), e.t, e.type, e.actor ? names[e.actor] || e.actor : "", e.data ? JSON.stringify(e.data) : ""];
    }));
  }

  B2B.stats = { compute: compute, funnel: funnel, byGiant: byGiant, moveRates: moveRates, DOOR_MOVES: DOOR_MOVES };
  B2B.exporter = { movesCsv: movesCsv, playersCsv: playersCsv, eventsCsv: eventsCsv };
})(typeof window !== "undefined" ? window : globalThis);
