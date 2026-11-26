/* Results and CSV export. Everything is computed from the raw players and decisions
   of one game; nothing here is estimated or invented. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});

  function rate(won, n) { return { won: won, n: n, pct: n ? (won / n) * 100 : null }; }
  function avg(nums) { return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null; }

  // full = { players: [rows with cards], deals: [every decision of every round] }
  function compute(full, cards) {
    var cfg = root.B2B_CONFIG, E = B2B.engine;
    var players = full.players.filter(function (p) { return p.role; });
    var sellers = players.filter(function (p) { return p.role === "seller"; });
    var buyers = players.filter(function (p) { return p.role === "buyer"; });
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var deals = full.deals.filter(function (d) { return d.kind !== "stay" && byId[d.seller_id] && byId[d.buyer_id]; });
    var N = Math.max(E.roundCount(cfg), full.deals.reduce(function (m, d) { return Math.max(m, d.round); }, 0));
    function ruleOf(r) { return E.roundRule(cfg, r); }
    function label(r) { return ((cards && cards.rounds && cards.rounds[r - 1]) || {}).title || "Round " + r; }
    function line(d) {
      var b = byId[d.buyer_id], s = byId[d.seller_id];
      return { round: d.round, kind: d.kind, delivered: d.delivered, buyer: b.name, buyerOrg: b.card.org, seller: s.name, sellerOrg: s.card.org };
    }

    // --- round by round ---
    var rounds = [];
    for (var r = 1; r <= N; r++) {
      var rows = deals.filter(function (d) { return d.round === r; });
      rounds.push({
        round: r, title: label(r), buyers: buyers.length, signed: rows.length,
        full: rows.filter(function (d) { return d.kind === "full"; }).length,
        pilot: rows.filter(function (d) { return d.kind === "pilot"; }).length,
        stayed: buyers.length - rows.length,
        burned: rows.filter(function (d) { return !d.delivered; }).length,
        toNotReady: rows.filter(function (d) { return !byId[d.seller_id].card.ready; }).length,
        pct: buyers.length ? (rows.length / buyers.length) * 100 : null,
        burnedList: rows.filter(function (d) { return !d.delivered; }).map(line),
        servedList: rows.filter(function (d) { return d.delivered; }).map(line)
      });
    }

    // --- could buyers tell a ready start-up from one that is not? ---
    var notReady = sellers.filter(function (s) { return !s.card.ready; });
    var tell = {
      share: sellers.length ? (notReady.length / sellers.length) * 100 : null, notReady: notReady.length, sellers: sellers.length,
      rounds: rounds.map(function (x) { return { round: x.round, title: x.title, rate: rate(x.toNotReady, x.signed) }; })
    };

    // --- proof: how often was each kind of start-up signed, in the rounds where proof is shown? ---
    var proofRounds = [], pilotRounds = [], introRounds = [], recordRounds = [];
    for (var q = 1; q <= N; q++) {
      if (ruleOf(q).proof) proofRounds.push(q);
      if (ruleOf(q).pilot) pilotRounds.push(q);
      if (ruleOf(q).intros) introRounds.push(q);
      if (ruleOf(q).record) recordRounds.push(q);
    }
    function sellerRounds(group, rs) {
      var won = 0;
      group.forEach(function (s) { rs.forEach(function (x) { if (deals.some(function (d) { return d.round === x && d.seller_id === s.id; })) won++; }); });
      return rate(won, group.length * rs.length);
    }
    var holders = sellers.filter(function (s) { return s.card.proof; });
    var readyNoProof = sellers.filter(function (s) { return s.card.ready && !s.card.proof; });
    var proof = {
      rounds: proofRounds,
      bars: [
        { key: "proof", label: "Start-ups with proof", rate: sellerRounds(holders, proofRounds) },
        { key: "ready", label: "Ready, but no proof", rate: sellerRounds(readyNoProof, proofRounds) },
        { key: "not", label: "Not ready", rate: sellerRounds(notReady, proofRounds) }
      ],
      before: sellerRounds(sellers, [1].filter(function (x) { return proofRounds.indexOf(x) < 0; }))
    };

    // --- pilots: who was offered the small first step, and what did it save? ---
    var inPilot = deals.filter(function (d) { return pilotRounds.indexOf(d.round) >= 0; });
    function pilotShare(list) { return rate(list.filter(function (d) { return d.kind === "pilot"; }).length, list.length); }
    var failedPilots = inPilot.filter(function (d) { return d.kind === "pilot" && !d.delivered; }).length;
    var pilot = {
      rounds: pilotRounds,
      bars: [
        { key: "unproven", label: "Deals with a start-up that had no proof", rate: pilotShare(inPilot.filter(function (d) { return !byId[d.seller_id].card.proof; })) },
        { key: "proven", label: "Deals with a start-up that had proof", rate: pilotShare(inPilot.filter(function (d) { return byId[d.seller_id].card.proof; })) }
      ],
      pilots: inPilot.filter(function (d) { return d.kind === "pilot"; }).length, failedPilots: failedPilots,
      saved: failedPilots * (cfg.payoff.pilotLose - cfg.payoff.fullLose)
    };

    // --- trust: did an introduction change what a buyer did? ---
    var introduced = buyers.filter(function (b) { return (b.card.knows || []).some(function (k) { return k.ready; }); });
    var others = buyers.filter(function (b) { return introduced.indexOf(b) < 0; });
    function signedIn(group, rs) {
      var won = 0;
      group.forEach(function (b) { rs.forEach(function (x) { if (deals.some(function (d) { return d.round === x && d.buyer_id === b.id; })) won++; }); });
      return rate(won, group.length * rs.length);
    }
    var inIntro = deals.filter(function (d) { return introRounds.indexOf(d.round) >= 0; });
    function knew(d, ready) { return (byId[d.buyer_id].card.knows || []).some(function (k) { return k.id === d.seller_id && k.ready === ready; }); }
    var inRecord = deals.filter(function (d) { return recordRounds.indexOf(d.round) >= 0; });
    var trust = {
      rounds: introRounds,
      bars: [
        { key: "intro", label: "Buyers who knew a start-up that works", rate: signedIn(introduced, introRounds) },
        { key: "none", label: "Buyers with no such introduction", rate: signedIn(others, introRounds) }
      ],
      viaIntro: inIntro.filter(function (d) { return knew(d, true); }).length, dealsInIntro: inIntro.length,
      warnedAndSigned: inIntro.filter(function (d) { return knew(d, false); }).length,
      toReferenced: inRecord.filter(function (d) { return E.record(d.seller_id, deals, d.round - 1).delivered.length > 0; }).length, dealsInRecord: inRecord.length
    };

    // --- points ---
    function total(p) { return E.score(p, full.deals, N, cfg).total; }
    function board(list) {
      return list.map(function (p) { return { name: p.name, org: p.card.org, points: total(p), ready: p.role === "seller" ? p.card.ready : null, is_bot: p.is_bot }; })
        .sort(function (a, b) { return b.points - a.points || a.name.localeCompare(b.name); });
    }
    var points = {
      buyers: board(buyers), sellers: board(sellers),
      alwaysStay: N * cfg.payoff.stay,
      avgReady: avg(sellers.filter(function (s) { return s.card.ready; }).map(total)),
      avgNotReady: avg(notReady.map(total)),
      avgBuyer: avg(buyers.map(total))
    };

    var allBurned = [];
    rounds.forEach(function (x) { allBurned = allBurned.concat(x.burnedList); });
    return {
      simulated: full.players.filter(function (p) { return p.is_bot; }).length,
      counts: { players: players.length, sellers: sellers.length, buyers: buyers.length, deals: deals.length, rounds: N,
                notReady: notReady.length, withProof: holders.length },
      rounds: rounds, tell: tell, proof: proof, pilot: pilot, trust: trust, points: points, burned: allBurned
    };
  }

  // The same round-by-round numbers from public data alone (no role cards), for the reveal after each round.
  // players: [{id, name, role, org}], closed: decisions of the rounds already closed.
  function liveRounds(players, closed, upTo, cards) {
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var nB = players.filter(function (p) { return p.role === "buyer"; }).length, out = [];
    for (var r = 1; r <= upTo; r++) {
      var rows = closed.filter(function (d) { return d.round === r && d.kind !== "stay" && byId[d.seller_id] && byId[d.buyer_id]; });
      var line = function (d) {
        return { round: d.round, kind: d.kind, delivered: d.delivered, buyer: byId[d.buyer_id].name, buyerOrg: byId[d.buyer_id].org,
                 seller: byId[d.seller_id].name, sellerOrg: byId[d.seller_id].org };
      };
      out.push({ round: r, title: ((cards && cards.rounds && cards.rounds[r - 1]) || {}).title || "Round " + r, buyers: nB, signed: rows.length,
                 stayed: nB - rows.length, pilot: rows.filter(function (d) { return d.kind === "pilot"; }).length,
                 burned: rows.filter(function (d) { return !d.delivered; }).length, pct: nB ? (rows.length / nB) * 100 : null,
                 burnedList: rows.filter(function (d) { return !d.delivered; }).map(line), servedList: rows.filter(function (d) { return d.delivered; }).map(line) });
    }
    return out;
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

  // One line per buyer per round, including the rounds where a buyer stayed.
  function decisionsCsv(full, cfg) {
    var E = B2B.engine, byId = {};
    full.players.forEach(function (p) { byId[p.id] = p; });
    var buyers = full.players.filter(function (p) { return p.role === "buyer"; });
    var N = Math.max(E.roundCount(cfg), full.deals.reduce(function (m, d) { return Math.max(m, d.round); }, 0));
    var header = ["round", "buyer_name", "buyer_enterprise", "decision", "decided_by_tapping", "seconds_into_round", "startup_name", "startup",
      "startup_ready", "startup_had_proof", "delivered", "buyer_knew_startup", "startup_had_delivered_before", "buyer_points", "startup_points",
      "buyer_simulated", "startup_simulated"];
    var lines = [];
    for (var r = 1; r <= N; r++) {
      buyers.forEach(function (b) {
        var d = E.rowOf(b, full.deals, r), s = d && d.seller_id ? byId[d.seller_id] : null;
        var k = s ? (b.card.knows || []).filter(function (x) { return x.id === s.id; })[0] : null;
        lines.push([r, b.name, b.card.org, !d || d.kind === "stay" ? "stayed" : d.kind === "pilot" ? "pilot" : "full deal", yn(!!d), d ? d.t : "",
          s ? s.name : "", s ? s.card.org : "", s ? yn(s.card.ready) : "", s ? yn(s.card.proof) : "", s ? yn(d.delivered) : "",
          s ? yn(!!k) : "", s ? yn(E.record(s.id, full.deals, r - 1).delivered.length > 0) : "",
          E.buyerRound(d, cfg), s ? E.sellerRound(d, cfg) : "", yn(b.is_bot), s ? yn(s.is_bot) : ""]);
      });
    }
    return toCsv(header, lines);
  }

  function playersCsv(full, cfg) {
    var E = B2B.engine;
    var N = Math.max(E.roundCount(cfg), full.deals.reduce(function (m, d) { return Math.max(m, d.round); }, 0));
    var header = ["name", "simulated", "role", "organisation", "product_ready", "has_proof", "deal_code", "knows", "deals_signed", "times_burned", "points", "joined_at"];
    var lines = full.players.map(function (p) {
      var c = p.card || {}, mine = full.deals.filter(function (d) { return d.kind !== "stay" && (d.buyer_id === p.id || d.seller_id === p.id); });
      return [p.name, yn(p.is_bot), p.role, c.org || "", p.role === "seller" ? yn(c.ready) : "", p.role === "seller" ? yn(c.proof) : "", c.code || "",
        (c.knows || []).map(function (k) { return k.name + " (" + (k.ready ? "works" : "not ready") + ")"; }).join("; "),
        p.role ? mine.length : "", p.role === "buyer" ? mine.filter(function (d) { return !d.delivered; }).length : "",
        p.role ? E.score(p, full.deals, N, cfg).total : "", iso(p.joined_at)];
    });
    return toCsv(header, lines);
  }

  function eventsCsv(events, players) {
    var names = {};
    players.forEach(function (p) { names[p.id] = p.name; });
    return toCsv(["at", "seconds_into_round", "event", "player", "details"], events.map(function (e) {
      return [iso(e.at), e.t, e.type, e.actor ? names[e.actor] || e.actor : "", e.data ? JSON.stringify(e.data) : ""];
    }));
  }

  B2B.stats = { compute: compute, liveRounds: liveRounds };
  B2B.exporter = { decisionsCsv: decisionsCsv, playersCsv: playersCsv, eventsCsv: eventsCsv };
})(typeof window !== "undefined" ? window : globalThis);
