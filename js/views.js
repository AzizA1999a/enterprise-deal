/* The projector views of the game, as functions that return HTML.
   Used by screen.html (stand-alone projector) and by the slides (deck.html),
   so the live game looks identical in both. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, cfg = window.B2B_CONFIG;
  var esc = ui.esc, pct = ui.pct;
  var V = { cards: null, bench: {}, qr: {}, code: "" };

  V.init = function (cards, bench) { V.cards = cards; V.bench = bench || {}; };

  V.joinUrl = function (code) {
    var u = new URL(".", window.location.href);
    return u.origin + u.pathname + "?g=" + code;
  };
  function qrSvg(url) {
    if (V.qr[url] != null) return V.qr[url];
    var out = "";
    try {
      var q = window.qrcode(0, "M");
      q.addData(url); q.make();
      out = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    } catch (e) { out = ""; }
    return (V.qr[url] = out);
  }
  function optLabel(list, key) {
    var o = (V.cards[list] || []).filter(function (x) { return x.key === key; })[0];
    return o ? o.short || o.label : key;
  }

  // ---------- building blocks ----------
  function bench(key) {
    var b = V.bench[key];
    if (b && b.value) {
      return '<div class="bench filled"><span class="label">Real world</span><br><b>' + esc(b.value) + '</b><span class="src">' + esc(b.source || "") + "</span></div>";
    }
    return cfg.showEmptyBenchmarks === false ? "" : '<div class="bench">Real-world benchmark: to be added</div>';
  }
  // items: [{label, width (0..100), value, note, base, empty}]
  function bars(items, refAt, compact) {
    return '<div class="bars' + (compact ? " compact" : "") + '">' + items.map(function (it) {
      return '<div class="bar' + (it.base ? " base" : "") + (it.empty ? " empty" : "") + '" title="' + esc(it.label + ": " + it.value + (it.note ? " (" + it.note + ")" : "")) + '">' +
        '<div class="top"><span>' + esc(it.label) + '</span><span class="v num">' + esc(it.value) + (it.note ? "<small>" + esc(it.note) + "</small>" : "") + "</span></div>" +
        '<div class="track">' + (it.empty ? "" : '<div class="fill" style="width:' + Math.max(0, Math.min(100, it.width)) + '%"></div>') +
        (refAt != null ? '<div class="ref" style="left:' + refAt + '%"></div>' : "") + "</div></div>";
    }).join("") + "</div>";
  }
  function rateBars(list, baseKey) {
    return bars(list.map(function (x) {
      var r = x.rate;
      return { label: x.label, width: r.pct || 0, value: r.n ? pct(r.pct) : "no offers", note: r.n ? r.won + " of " + r.n : "", base: x.key === baseKey, empty: !r.n };
    }));
  }
  function countBars(tally, list, limit) {
    var keys = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, limit || 6);
    var total = Object.keys(tally).reduce(function (s, k) { return s + tally[k]; }, 0);
    var max = keys.length ? tally[keys[0]] : 1;
    if (!keys.length) return '<p class="muted">No answers yet.</p>';
    return bars(keys.map(function (k) {
      return { label: optLabel(list, k), width: (tally[k] / max) * 100, value: String(tally[k]), note: pct((tally[k] / total) * 100) };
    }), null, true);
  }
  function panel(title, body, benchKey, sub) {
    return '<div class="s-panel"><h3>' + esc(title) + "</h3>" + (sub ? '<div class="muted">' + esc(sub) + "</div>" : "") + body + '<div class="grow"></div>' + (benchKey ? bench(benchKey) : "") + "</div>";
  }
  function stat(n, d) { return '<div class="stat"><div class="n num">' + esc(n) + '</div><div class="d">' + esc(d) + "</div></div>"; }
  function counter(n, label, cls) { return '<div class="s-panel counter' + (cls ? " " + cls : "") + '"><div class="n num">' + esc(n) + '</div><div class="label">' + esc(label) + "</div></div>"; }

  // ---------- game phases ----------
  V.lobby = function (pub, code) {
    var url = V.joinUrl(code), local = B2B.mode === "local";
    return '<div class="s-cols"><div style="display:grid;place-items:center">' +
      (local ? '<div class="s-panel" style="max-width:28rem"><div class="s-h2">Offline demo</div><p class="s-sub" style="margin-top:0.6rem">Phones cannot join in this mode. Add simulated players from the host controls.</p></div>'
             : '<div class="qr">' + (qrSvg(url) || '<div class="s-h2">' + esc(url) + "</div>") + "</div>") +
      '</div><div style="display:flex;flex-direction:column;gap:1.1rem;min-height:0;height:100%;justify-content:center">' +
      '<div><div class="label" style="font-size:1rem">Join on your phone</div><div class="s-h1">Scan to enter the market</div></div>' +
      (local ? "" : '<div><div class="joinurl">' + esc(url.replace(/^https?:\/\//, "")) + '</div><div class="s-sub">Game code <span class="code">' + esc(code) + "</span></div></div>") +
      '<div class="s-h2"><span class="num" style="font-size:4.5rem;color:var(--accent);text-shadow:0.2rem 0.2rem 0 var(--ink)">' + pub.players.length + "</span> joined</div>" +
      '<div class="names" style="max-height:14rem">' + pub.players.slice().reverse().map(function (p) { return '<span class="chip plain">' + esc(p.name) + "</span>"; }).join("") + "</div></div></div>";
  };
  V.briefing = function (pub) {
    var s = pub.players.filter(function (p) { return p.role === "seller"; }).length;
    var b = pub.players.filter(function (p) { return p.role === "buyer"; }).length;
    return '<div class="s-cols" style="grid-template-columns:1.7fr 1fr"><div><div class="label" style="font-size:1rem;margin-bottom:1.3rem">Read your role card · the rules</div><ol class="rules" style="padding:0;margin:0">' +
      V.cards.projectorRules.map(function (r) { return "<li><span>" + esc(r) + "</span></li>"; }).join("") + "</ol></div>" +
      '<div class="s-panel" style="text-align:center"><div class="label" style="font-size:1rem">Market opens in</div><div class="giant num" style="font-size:9rem" data-clock></div>' +
      '<div class="s-h2" style="margin-top:1.2rem"><span class="num">' + s + "</span> sellers · <span class=\"num\">" + b + "</span> buyers</div></div></div>";
  };
  V.market = function (pub) {
    var by = {};
    pub.players.forEach(function (p) { by[p.id] = p; });
    var buyers = pub.players.filter(function (p) { return p.role === "buyer"; });
    var stayed = buyers.filter(function (p) { return p.decision === "incumbent"; });
    var who = function (p) { return p && p.name ? ' <span class="pn">(' + esc(p.name) + ")</span>" : ""; };
    var events = pub.deals.map(function (d) { return { t: d.decided_t, html: '<b class="who">' + esc(by[d.buyer_id].org) + "</b>" + who(by[d.buyer_id]) + " signed with <b>" + esc(by[d.seller_id].org) + "</b>" + who(by[d.seller_id]), deal: true }; })
      .concat(stayed.map(function (p) { return { t: p.decided_t, html: "<b>" + esc(p.org) + "</b>" + who(p) + " stayed with its incumbent" }; }))
      .concat(buyers.filter(function (p) { return p.defence && !p.decision; }).map(function (p) {
        return { t: p.defence.t, rival: true, html: "<b>" + esc(p.defence.by) + "</b> " + (p.defence.n > 1 ? "raised its counter-offer to " : "made a counter-offer to ") + esc(p.org) + who(p) };
      }))
      .sort(function (a, b) { return b.t - a.t; });   // newest first; the panel scrolls
    var counterOffers = buyers.reduce(function (n, p) { return n + (p.defence ? p.defence.n : 0); }, 0);
    var rivalsOn = !!(cfg.rivals && cfg.rivals.on);
    var paused = pub.game.phase === "paused";
    return '<div class="s-cols" style="grid-template-columns:1.25fr 1fr;grid-template-rows:minmax(0,1fr);align-items:stretch"><div style="display:flex;flex-direction:column;justify-content:center;gap:1.8rem">' +
      '<div><div class="label" style="font-size:1rem">' + (paused ? "Paused" : "Market open · walk, talk, sign") + '</div><div class="giant num" data-clock></div></div>' +
      '<div class="counters' + (rivalsOn ? " five" : "") + '">' + counter(pub.n_offers, "Term sheets") + (rivalsOn ? counter(counterOffers, "Incumbent counter-offers", "rival") : "") +
      counter(pub.deals.length, "Deals signed") + counter(stayed.length, "Stayed with incumbent") +
      counter(buyers.length - pub.deals.length - stayed.length, "Buyers undecided") + "</div></div>" +
      '<div class="s-panel tickerbox"><div class="row" style="margin-bottom:1rem"><span class="label" style="font-size:1rem">Live deal ticker</span>' +
      (events.length > 5 ? '<span class="muted" style="font-size:0.95rem">' + events.length + " so far · scroll for earlier</span>" : "") + '</div><div class="ticker">' +
      (events.length ? events.map(function (e) { return '<div class="tick' + (e.deal ? " deal" : e.rival ? " rival" : "") + '"><span class="t num">' + ui.tclock(e.t) + "</span><span>" + e.html + "</span></div>"; }).join("")
                     : '<p class="s-sub">No deals yet. Who will sign first?</p>') + "</div></div></div>";
  };
  // Redraw a live view without losing the place the presenter scrolled the ticker to.
  V.redraw = function (el, html) {
    var old = el.querySelector(".ticker"), top = old ? old.scrollTop : 0;
    el.innerHTML = html;
    var now = el.querySelector(".ticker");
    if (now && top) now.scrollTop = top;
  };
  V.closed = function (pub) {
    var players = pub.players.filter(function (p) { return p.role; });
    var buyers = players.filter(function (p) { return p.role === "buyer"; });
    var resolved = pub.deals.every(function (d) { return d.delivered != null; });
    var failed = pub.deals.filter(function (d) { return d.delivered === false; }).length;
    var answered = players.filter(function (p) { return p.exit_done; }).length;
    return '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:2rem"><div><div class="s-h1">Market closed</div><div class="s-sub">Sit down, and answer the one question on your phone.</div></div>' +
      '<div class="counters">' + counter(pub.deals.length, "Deals signed") + counter(resolved ? pub.deals.length - failed : "…", "Start-ups delivered") +
      counter(resolved ? failed : "…", "Start-ups failed") + counter(buyers.length - pub.deals.length, "Stayed with incumbent") + "</div>" +
      '<div><div class="row" style="margin-bottom:0.5rem"><span class="label" style="font-size:1rem">Exit answers</span><span class="num s-sub">' + answered + " of " + players.length + "</span></div>" +
      '<div class="progress"><i style="width:' + (players.length ? (answered / players.length) * 100 : 0) + '%"></i></div></div></div>';
  };
  // The live game slide: follows the phase until the market is locked.
  V.game = function (pub, code) {
    var p = pub.game.phase;
    return p === "lobby" ? V.lobby(pub, code) : p === "briefing" ? V.briefing(pub) : p === "open" || p === "paused" ? V.market(pub) : V.closed(pub);
  };

  // ---------- results ----------
  V.quick = function (st, noHead) {
    var q = st.quick;
    return (noHead ? "" : '<div class="pagehead"><div class="s-h2">What just happened in this room</div><div class="s-sub num">' + st.counts.offers + " term sheets · " + st.counts.deals + " deals · " + st.counts.buyers + " buyers</div></div>") +
      '<div class="reveal">' +
      '<div class="s-panel"><div class="q">Win rate of term sheets sent to a connection</div><div class="big num">' + pct(q.connWith.pct) + '</div><div class="n num">' + q.connWith.won + " of " + q.connWith.n + " signed</div>" +
      '<div class="vs">versus <b class="num">' + pct(q.connWithout.pct) + '</b> without a connection</div><div class="n num">' + q.connWithout.won + " of " + q.connWithout.n + ' signed</div><div class="grow"></div>' + bench("conn_win_rate") + "</div>" +
      '<div class="s-panel"><div class="q">Buyers who stayed with the incumbent</div><div class="big num">' + pct(q.incumbent.pct) + '</div><div class="n num">' + q.incumbent.count + " of " + q.incumbent.n + " buyers" +
      (q.incumbent.byDefault ? " (" + q.incumbent.byDefault + " by never deciding)" : "") + '</div><div class="grow"></div>' + bench("incumbent_share") + "</div>" +
      '<div class="s-panel"><div class="q">Winning deals that were NOT the cheapest the buyer was offered</div><div class="big num">' + pct(q.notCheapest.pct) + '</div><div class="n num">' + q.notCheapest.count + " of " + q.notCheapest.n + ' signed deals</div><div class="grow"></div>' + bench("not_cheapest") + "</div>" +
      "</div>";
  };
  function head(title, page) {
    return '<div class="pagehead"><div class="s-h2">' + esc(title) + '</div><div class="s-sub">Dashboard ' + page + " of 4</div></div>";
  }
  // Single panels, also used one at a time on the evidence slides.
  V.panels = {
    conn: function (st) { return panel("Win rate by relationship", rateBars(st.byConnType, "none"), "conn_type", "Share of term sheets signed"); },
    pilot: function (st) { return panel("With and without a pilot", rateBars(st.pilot, "no"), "pilot", "Share of term sheets signed"); },
    proof: function (st) { return panel("By proof shown", rateBars(st.proof, "none"), "proof", "Share of term sheets signed"); },
    price: function (st) {
      var p = st.price;
      return panel("Average price, as a share of the incumbent's price", bars([
        { label: "Signed deals", width: (p.win || 0) / 1.2, value: p.win == null ? "none" : Math.round(p.win) + "%", note: p.nWin + " term sheets", empty: p.win == null },
        { label: "Unsigned term sheets", width: (p.lose || 0) / 1.2, value: p.lose == null ? "none" : Math.round(p.lose) + "%", note: p.nLose + " term sheets", empty: p.lose == null }
      ], 100 / 1.2), "price", "The vertical line marks the incumbent's price (100%)");
    },
    perBuyer: function (st) {
      var pb = st.perBuyer;
      return panel("Term sheets received per buyer", stat(pb.avg == null ? "–" : pb.avg.toFixed(1), pb.avg == null ? "" : "on average. From " + pb.min + " to " + pb.max + " across " + pb.n + " buyers."), "offers_per_buyer");
    },
    firstWin: function (st) {
      var fw = st.firstWin;
      return panel("Term sheets a seller needed for a first win", stat(fw.avg == null ? "–" : fw.avg.toFixed(1), "on average, among sellers who won. " + fw.noWin + " of " + fw.sellers + " sellers never won a deal."), "offers_to_first_win");
    },
    time: function (st) {
      var t = st.time;
      return panel("Time to the first deal", stat(t.first == null ? "–" : ui.tclock(t.first), t.median == null ? "No deals were signed." : "after the market opened. The median deal came at " + ui.tclock(t.median) + "."), "time_to_first_deal");
    },
    signed: function (st) { return panel("Buyers who signed a start-up", countBars(st.reasons.buyerStartup, "exitOptions"), "reasons_signed", "Main reason for the decision"); },
    stayed: function (st) {
      var q = st.quick.incumbent;
      return panel("Buyers who stayed with the incumbent", countBars(st.reasons.buyerIncumbent, "exitOptions"), "reasons_stayed", q.count + " of " + q.n + " buyers stayed");
    },
    reject: function (st) { return panel("Reasons given for rejecting a term sheet", countBars(st.reasons.reject, "rejectReasons"), "reject_reasons", "Chosen at the moment of rejection"); },
    sellersWon: function (st) { return panel("Sellers who won a deal", countBars(st.reasons.sellerWon, "exitOptions"), "reasons_sellers_won", "Why do you think you won?"); },
    sellersLost: function (st) { return panel("Sellers who won nothing", countBars(st.reasons.sellerLost, "exitOptions"), "reasons_sellers_lost", "Why do you think you lost?"); },
    delivery: function (st) {
      var d = st.delivery;
      function failBar(label, x, base) { return { label: label, width: x.pct || 0, value: x.n ? pct(x.pct) : "no deals", note: x.n ? x.failed + " of " + x.n : "", empty: !x.n, base: base }; }
      return panel("Start-ups that failed to deliver", bars([failBar("Start-ups holding proof", d.withProof), failBar("Start-ups with no proof", d.noProof), failBar("All signed deals", d.all, true)]), "delivery", "Share of signed deals that failed");
    },
    incumbent: function (st) {
      var q = st.quick.incumbent;
      return panel("Buyers who stayed with the incumbent", stat(pct(q.pct), q.count + " of " + q.n + " buyers" + (q.byDefault ? ", " + q.byDefault + " of them by never deciding" : "") + "."), "incumbent_share");
    },
    // What the incumbents' account managers achieved, among buyers a start-up actually reached.
    defence: function (st) {
      var d = st.defence;
      if (!d.on) return panel("When the incumbent fought back", '<p class="muted">The incumbents made no counter-offers in this game.</p>', "incumbent_defence");
      function part(label, n, base) { return { label: label, width: d.pitched ? (n / d.pitched) * 100 : 0, value: d.pitched ? pct((n / d.pitched) * 100) : "none", note: n + " of " + d.pitched, base: base, empty: !d.pitched }; }
      return panel("When the incumbent fought back", bars([
        part("Took the incumbent's counter-offer", d.wonBack),
        part("Signed the start-up anyway", d.signed),
        part("Stayed without a counter-offer", d.stayedPlain, true)
      ], null, true) + '<p class="muted" style="margin-top:0.6rem">' + d.counters + " counter-offers, from account managers played by the computer" +
        (d.avgDiscount == null ? "." : ". Keeping a customer cost them " + Math.round(d.avgDiscount) + "% off, on average.") +
        (d.earlyLocked ? " " + d.earlyLocked + (d.earlyLocked === 1 ? " buyer was" : " buyers were") + " renewed early, before any start-up reached them." : "") + "</p>",
        "incumbent_defence", "Buyers who were pitched by at least one start-up");
    },
    connQuick: function (st) {
      var q = st.quick;
      return panel("Term sheets signed, with and without a connection", bars([
        { label: "Sent to a connection", width: q.connWith.pct || 0, value: q.connWith.n ? pct(q.connWith.pct) : "none", note: q.connWith.won + " of " + q.connWith.n, empty: !q.connWith.n },
        { label: "Sent cold", width: q.connWithout.pct || 0, value: q.connWithout.n ? pct(q.connWithout.pct) : "none", note: q.connWithout.won + " of " + q.connWithout.n, empty: !q.connWithout.n, base: true }
      ]), "conn_win_rate", "Share of term sheets signed");
    },
    notCheapest: function (st) {
      var q = st.quick.notCheapest;
      return panel("Signed deals that were NOT the cheapest offer", stat(pct(q.pct), q.count + " of " + q.n + " signed deals."), "not_cheapest");
    }
  };
  var P = V.panels;
  V.full1 = function (st) { return head("What won deals", 1) + '<div class="dash c3">' + P.conn(st) + P.pilot(st) + P.proof(st) + "</div>"; };
  V.full2 = function (st) { return head("Price and effort", 2) + '<div class="dash c4">' + P.price(st) + P.perBuyer(st) + P.firstWin(st) + P.time(st) + "</div>"; };
  V.full3 = function (st) {
    return head("What buyers said drove the decision", 3) + (st.defence.on
      ? '<div class="dash c4 even">' + P.defence(st) + P.signed(st) + P.stayed(st) + P.reject(st) + "</div>"
      : '<div class="dash c3">' + P.signed(st) + P.stayed(st) + P.reject(st) + "</div>");
  };
  V.full4 = function (st) { return head("What sellers believed, and what the risk really was", 4) + '<div class="dash c3">' + P.sellersWon(st) + P.sellersLost(st) + P.delivery(st) + "</div>"; };

  B2B.views = V;
})();
