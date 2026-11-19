/* Dashboard numbers and CSV export. Everything is computed from the raw
   players and offers of one game; nothing here is estimated or invented. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});

  function rate(list) {
    var won = list.filter(function (r) { return r.won; }).length;
    return { won: won, n: list.length, pct: list.length ? (won / list.length) * 100 : null };
  }
  function avg(nums) { return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null; }
  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function tally(keys) {
    var out = {};
    keys.forEach(function (k) { if (k) out[k] = (out[k] || 0) + 1; });
    return out;
  }

  // One row per offer, joined with both players.
  function offerRows(full) {
    var byId = {};
    full.players.forEach(function (p) { byId[p.id] = p; });
    return full.offers.map(function (o) {
      var s = byId[o.seller_id], b = byId[o.buyer_id];
      var conn = s.card.connections.filter(function (c) { return c.id === b.id; })[0];
      return { o: o, s: s, b: b, conn: conn ? conn.type : null, won: o.status === "accepted",
               pct: (o.price / b.card.incumbent.price) * 100 };
    }).sort(function (x, y) { return x.o.created_at - y.o.created_at; });
  }

  function compute(full, cards) {
    var players = full.players.filter(function (p) { return p.role; });
    var sellers = players.filter(function (p) { return p.role === "seller"; });
    var buyers = players.filter(function (p) { return p.role === "buyer"; });
    var rows = offerRows(full);
    var wins = rows.filter(function (r) { return r.won; });
    var losses = rows.filter(function (r) { return !r.won; });

    // --- quick reveal ---
    var stayed = buyers.filter(function (b) { return b.decision !== "startup"; });
    var notCheapest = wins.filter(function (w) {
      var prices = rows.filter(function (r) { return r.b.id === w.b.id; }).map(function (r) { return r.o.price; });
      return w.o.price > Math.min.apply(null, prices);
    });
    var quick = {
      connWith: rate(rows.filter(function (r) { return r.conn; })),
      connWithout: rate(rows.filter(function (r) { return !r.conn; })),
      incumbent: { count: stayed.length, n: buyers.length, pct: buyers.length ? (stayed.length / buyers.length) * 100 : null,
                   byDefault: buyers.filter(function (b) { return b.decision === "incumbent_default"; }).length },
      notCheapest: { count: notCheapest.length, n: wins.length, pct: wins.length ? (notCheapest.length / wins.length) * 100 : null }
    };

    // --- win rates ---
    var byConnType = [{ key: "none", label: "No connection", rate: rate(rows.filter(function (r) { return !r.conn; })) }]
      .concat(Object.keys(cards.relationships).map(function (k) {
        return { key: k, label: cards.relationships[k], rate: rate(rows.filter(function (r) { return r.conn === k; })) };
      }));
    var pilot = [
      { key: "yes", label: "Pilot offered", rate: rate(rows.filter(function (r) { return r.o.pilot; })) },
      { key: "no", label: "No pilot", rate: rate(rows.filter(function (r) { return !r.o.pilot; })) }
    ];
    var proof = Object.keys(cards.proofs).map(function (k) {
      return { key: k, label: cards.proofs[k], rate: rate(rows.filter(function (r) { return (r.o.proof || []).indexOf(k) >= 0; })) };
    });
    proof.push({ key: "none", label: "No proof shown", rate: rate(rows.filter(function (r) { return !(r.o.proof || []).length; })) });

    // --- price (as % of the buyer's incumbent price, so categories are comparable) ---
    var price = { win: avg(wins.map(function (r) { return r.pct; })), nWin: wins.length,
                  lose: avg(losses.map(function (r) { return r.pct; })), nLose: losses.length };

    // --- volume ---
    var received = buyers.map(function (b) { return rows.filter(function (r) { return r.b.id === b.id; }).length; });
    var perBuyer = { avg: avg(received), min: received.length ? Math.min.apply(null, received) : null,
                     max: received.length ? Math.max.apply(null, received) : null, n: buyers.length };
    var needed = [], noWin = 0;
    sellers.forEach(function (s) {
      var mine = rows.filter(function (r) { return r.s.id === s.id; });
      var idx = -1;
      mine.forEach(function (r, i) { if (r.won && idx < 0) idx = i; });
      if (idx >= 0) needed.push(idx + 1); else noWin++;
    });
    var firstWin = { avg: avg(needed), n: needed.length, noWin: noWin, sellers: sellers.length, dist: tally(needed.map(String)) };

    // --- reasons ---
    var sellerWon = {};
    wins.forEach(function (r) { sellerWon[r.s.id] = true; });
    var reasons = {
      buyerStartup: tally(buyers.filter(function (b) { return b.decision === "startup"; }).map(function (b) { return b.exit_answer; })),
      buyerIncumbent: tally(stayed.map(function (b) { return b.exit_answer; })),
      sellerWon: tally(sellers.filter(function (s) { return sellerWon[s.id]; }).map(function (s) { return s.exit_answer; })),
      sellerLost: tally(sellers.filter(function (s) { return !sellerWon[s.id]; }).map(function (s) { return s.exit_answer; })),
      reject: tally(rows.filter(function (r) { return r.o.status === "rejected"; }).map(function (r) { return r.o.reason; })),
      answered: players.filter(function (p) { return p.exit_answer; }).length
    };

    // --- timing (seconds of market clock) ---
    var dealTimes = wins.map(function (r) { return r.o.decided_t; }).filter(function (t) { return t != null; }).sort(function (a, b) { return a - b; });
    var time = { first: dealTimes.length ? dealTimes[0] : null, median: median(dealTimes), deals: dealTimes };

    // --- delivery ---
    var resolved = wins.filter(function (r) { return r.o.delivered != null; });
    function failRate(list) {
      var failed = list.filter(function (r) { return r.o.delivered === false; }).length;
      return { failed: failed, n: list.length, pct: list.length ? (failed / list.length) * 100 : null };
    }
    var delivery = {
      all: failRate(resolved),
      withProof: failRate(resolved.filter(function (r) { return r.s.card.assets.length > 0; })),
      noProof: failRate(resolved.filter(function (r) { return r.s.card.assets.length === 0; }))
    };

    return {
      simulated: full.players.filter(function (p) { return p.is_bot; }).length,
      counts: { players: players.length, sellers: sellers.length, buyers: buyers.length, offers: rows.length, deals: wins.length },
      quick: quick, byConnType: byConnType, pilot: pilot, proof: proof, price: price,
      perBuyer: perBuyer, firstWin: firstWin, reasons: reasons, time: time, delivery: delivery
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

  function offersCsv(full, cards, cfg) {
    var E = B2B.engine;
    var header = ["offer_id", "sent_at", "seconds_from_market_open", "category", "seller_name", "seller_startup", "buyer_name",
      "buyer_enterprise", "connection", "connection_type", "price_k", "incumbent_price_k", "price_pct_of_incumbent",
      "seller_list_k", "seller_floor_k", "buyer_budget_k", "pilot_included", "proof_reference", "proof_security_cert",
      "proof_pilot_ready", "status", "accepted", "reject_reason", "decided_at", "decided_seconds_from_market_open",
      "delivered", "seller_true_reliability", "buyer_hidden_priority", "buyer_boss_constraint", "fits_priority",
      "meets_boss_constraint", "cheapest_offer_buyer_received", "seller_exit_answer", "buyer_exit_answer",
      "seller_simulated", "buyer_simulated"];
    var rows = offerRows(full);
    var lines = rows.map(function (r) {
      var o = r.o, f = E.fit(r.b.card, o, r.s.pub, cfg), proof = o.proof || [];
      var min = Math.min.apply(null, rows.filter(function (x) { return x.b.id === r.b.id; }).map(function (x) { return x.o.price; }));
      return [o.id, iso(o.created_at), o.sent_t, r.s.card.categoryName, r.s.name, r.s.card.org, r.b.name, r.b.card.org,
        yn(!!r.conn), r.conn ? cards.relationships[r.conn] : "", o.price, r.b.card.incumbent.price, r.pct.toFixed(1),
        r.s.card.list, r.s.card.floor, r.b.card.budget, yn(o.pilot), yn(proof.indexOf("reference") >= 0),
        yn(proof.indexOf("security_cert") >= 0), yn(proof.indexOf("pilot_ready") >= 0), o.status, yn(r.won), o.reason,
        iso(o.decided_at), o.decided_t, yn(o.delivered), r.s.card.reliability, r.b.card.priority, r.b.card.constraint.text,
        yn(f.priorityMet), yn(f.constraintMet), yn(o.price === min), r.s.exit_answer, r.b.exit_answer, yn(r.s.is_bot), yn(r.b.is_bot)];
    });
    return toCsv(header, lines);
  }

  function playersCsv(full, cards) {
    var header = ["name", "simulated", "role", "category", "organisation", "connections", "connection_details",
      "offers_sent", "offers_received", "deals_won", "decision", "decided_seconds_from_market_open", "points",
      "exit_answer", "joined_at"];
    var lines = full.players.map(function (p) {
      var conns = p.card ? p.card.connections : [];
      var sent = full.offers.filter(function (o) { return o.seller_id === p.id; });
      var got = full.offers.filter(function (o) { return o.buyer_id === p.id; });
      return [p.name, yn(p.is_bot), p.role, p.card ? p.card.categoryName : "", p.card ? p.card.org : "", conns.length,
        conns.map(function (c) { return c.name + " (" + cards.relationships[c.type] + ")"; }).join("; "),
        p.role === "seller" ? sent.length : "", p.role === "buyer" ? got.length : "",
        p.role === "seller" ? sent.filter(function (o) { return o.status === "accepted"; }).length : "",
        p.decision, p.decided_t, p.points, p.exit_answer, iso(p.joined_at)];
    });
    return toCsv(header, lines);
  }

  function eventsCsv(events, players) {
    var names = {};
    players.forEach(function (p) { names[p.id] = p.name; });
    return toCsv(["at", "seconds_from_market_open", "event", "player", "details"], events.map(function (e) {
      return [iso(e.at), e.t, e.type, e.actor ? names[e.actor] || e.actor : "", e.data ? JSON.stringify(e.data) : ""];
    }));
  }

  B2B.stats = { compute: compute, offerRows: offerRows };
  B2B.exporter = { offersCsv: offersCsv, playersCsv: playersCsv, eventsCsv: eventsCsv };
})(typeof window !== "undefined" ? window : globalThis);
