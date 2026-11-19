/* The projector screen. Read-only: it shows whatever phase and view the host has set. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store;
  var esc = ui.esc, pct = ui.pct;
  var stage = document.getElementById("stage"), bar = document.getElementById("sbar");
  var VIEWS = ["closed", "quick", "full1", "full2", "full3", "full4"];

  var host = null;
  try { host = JSON.parse(store.getItem("b2bsim.host") || "null"); } catch (e) { host = null; }
  var S = { code: (ui.qs("g") || (host && host.code) || "").toUpperCase(), pub: undefined, cards: null, bench: {}, key: "", qr: {} };

  function joinUrl() {
    var u = new URL(".", window.location.href);
    return u.origin + u.pathname + "?g=" + S.code;
  }
  function qrSvg(url) {
    if (S.qr[url] != null) return S.qr[url];
    var out = "";
    try {
      var q = window.qrcode(0, "M");
      q.addData(url); q.make();
      out = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    } catch (e) { out = ""; }
    return (S.qr[url] = out);
  }
  function optLabel(list, key) {
    var o = (S.cards[list] || []).filter(function (x) { return x.key === key; })[0];
    return o ? o.short || o.label : key;
  }

  // ---------- building blocks ----------
  function bench(key) {
    var b = S.bench[key];
    if (b && b.value) {
      return '<div class="bench filled"><span class="label">Real world</span><br><b>' + esc(b.value) + '</b><span class="src">' + esc(b.source || "") + "</span></div>";
    }
    return cfg.showEmptyBenchmarks === false ? "" : '<div class="bench">Real-world benchmark: to be added</div>';
  }
  // items: [{label, width (0..100), value, note, hl, empty}]
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
  function counter(n, label) { return '<div class="s-panel counter"><div class="n num">' + esc(n) + '</div><div class="label">' + esc(label) + "</div></div>"; }

  // ---------- views ----------
  function lobby(pub) {
    var url = joinUrl(), local = B2B.mode === "local";
    var humans = pub.players.length;
    return '<div class="s-cols"><div style="display:grid;place-items:center">' +
      (local ? '<div class="s-panel" style="max-width:28rem"><div class="s-h2">Offline demo</div><p class="s-sub" style="margin-top:0.6rem">Phones cannot join in this mode. Add simulated players from the host panel.</p></div>'
             : '<div class="qr">' + (qrSvg(url) || '<div class="s-h2">' + esc(url) + "</div>") + "</div>") +
      '</div><div style="display:flex;flex-direction:column;gap:1.2rem;min-height:0;height:100%;justify-content:center">' +
      '<div><div class="label" style="font-size:1rem">Join on your phone</div><div class="s-h1">Scan to enter the market</div></div>' +
      (local ? "" : '<div><div class="joinurl">' + esc(url.replace(/^https?:\/\//, "")) + '</div><div class="s-sub">Game code <span class="code">' + esc(S.code) + "</span></div></div>") +
      '<div class="s-h2"><span class="num" style="font-size:4.5rem;color:var(--brand)">' + humans + "</span> joined</div>" +
      '<div class="names" style="max-height:30vh">' + pub.players.slice().reverse().map(function (p) { return '<span class="chip plain">' + esc(p.name) + "</span>"; }).join("") + "</div></div></div>";
  }
  function briefing(pub) {
    var s = pub.players.filter(function (p) { return p.role === "seller"; }).length;
    var b = pub.players.filter(function (p) { return p.role === "buyer"; }).length;
    return '<div class="s-cols" style="grid-template-columns:1.7fr 1fr"><div><div class="label" style="font-size:1rem;margin-bottom:1.4rem">Read your role card · the rules</div><ol class="rules" style="padding:0;margin:0">' +
      S.cards.projectorRules.map(function (r) { return "<li><span>" + esc(r) + "</span></li>"; }).join("") + "</ol></div>" +
      '<div class="s-panel" style="text-align:center"><div class="label" style="font-size:1rem">Market opens in</div><div class="giant num" style="font-size:9rem" data-clock></div>' +
      '<div class="s-h2" style="margin-top:1rem"><span class="num">' + s + "</span> sellers · <span class=\"num\">" + b + "</span> buyers</div></div></div>";
  }
  function market(pub) {
    var by = {};
    pub.players.forEach(function (p) { by[p.id] = p; });
    var buyers = pub.players.filter(function (p) { return p.role === "buyer"; });
    var stayed = buyers.filter(function (p) { return p.decision === "incumbent"; });
    var events = pub.deals.map(function (d) { return { t: d.decided_t, html: '<b class="who">' + esc(by[d.buyer_id].org) + "</b> signed with <b>" + esc(by[d.seller_id].org) + "</b>", deal: true }; })
      .concat(stayed.map(function (p) { return { t: p.decided_t, html: "<b>" + esc(p.org) + "</b> stayed with its incumbent" }; }))
      .sort(function (a, b) { return b.t - a.t; }).slice(0, 8);
    var paused = pub.game.phase === "paused";
    return '<div class="s-cols" style="grid-template-columns:1.25fr 1fr;align-items:stretch"><div style="display:flex;flex-direction:column;justify-content:center;gap:1.6rem">' +
      '<div><div class="label" style="font-size:1rem">' + (paused ? "Paused" : "Market open · time left") + '</div><div class="giant num" data-clock></div></div>' +
      '<div class="counters">' + counter(pub.n_offers, "Offers sent") + counter(pub.deals.length, "Deals signed") + counter(stayed.length, "Stayed with incumbent") +
      counter(buyers.length - pub.deals.length - stayed.length, "Buyers undecided") + "</div></div>" +
      '<div class="s-panel" style="min-height:0"><div class="label" style="font-size:1rem;margin-bottom:1rem">Live deal ticker</div><div class="ticker">' +
      (events.length ? events.map(function (e) { return '<div class="tick' + (e.deal ? " deal" : "") + '"><span class="t num">' + ui.tclock(e.t) + "</span><span>" + e.html + "</span></div>"; }).join("")
                     : '<p class="s-sub">No deals yet. Who will sign first?</p>') + "</div></div></div>";
  }
  function closed(pub) {
    var players = pub.players.filter(function (p) { return p.role; });
    var buyers = players.filter(function (p) { return p.role === "buyer"; });
    var resolved = pub.deals.every(function (d) { return d.delivered != null; });
    var failed = pub.deals.filter(function (d) { return d.delivered === false; }).length;
    var answered = players.filter(function (p) { return p.exit_done; }).length;
    return '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:2rem"><div><div class="s-h1">Market closed</div><div class="s-sub">Answer the one question on your phone.</div></div>' +
      '<div class="counters">' + counter(pub.deals.length, "Deals signed") + counter(resolved ? pub.deals.length - failed : "…", "Start-ups delivered") +
      counter(resolved ? failed : "…", "Start-ups failed") + counter(buyers.length - pub.deals.length, "Stayed with incumbent") + "</div>" +
      '<div><div class="row" style="margin-bottom:0.5rem"><span class="label" style="font-size:1rem">Exit answers</span><span class="num s-sub">' + answered + " of " + players.length + "</span></div>" +
      '<div class="progress"><i style="width:' + (players.length ? (answered / players.length) * 100 : 0) + '%"></i></div></div></div>';
  }
  function quick(st) {
    var q = st.quick;
    return '<div class="pagehead"><div class="s-h2">What just happened in this room</div><div class="s-sub num">' + st.counts.offers + " offers · " + st.counts.deals + " deals · " + st.counts.buyers + " buyers</div></div>" +
      '<div class="reveal">' +
      '<div class="s-panel"><div class="q">Win rate of offers sent to a connection</div><div class="big num">' + pct(q.connWith.pct) + '</div><div class="n num">' + q.connWith.won + " of " + q.connWith.n + " offers accepted</div>" +
      '<div class="vs">versus <b class="num">' + pct(q.connWithout.pct) + '</b> without a connection</div><div class="n num">' + q.connWithout.won + " of " + q.connWithout.n + ' offers accepted</div><div class="grow"></div>' + bench("conn_win_rate") + "</div>" +
      '<div class="s-panel"><div class="q">Buyers who stayed with the incumbent</div><div class="big num">' + pct(q.incumbent.pct) + '</div><div class="n num">' + q.incumbent.count + " of " + q.incumbent.n + " buyers" +
      (q.incumbent.byDefault ? " (" + q.incumbent.byDefault + " by never deciding)" : "") + '</div><div class="grow"></div>' + bench("incumbent_share") + "</div>" +
      '<div class="s-panel"><div class="q">Winning offers that were NOT the cheapest the buyer received</div><div class="big num">' + pct(q.notCheapest.pct) + '</div><div class="n num">' + q.notCheapest.count + " of " + q.notCheapest.n + ' winning offers</div><div class="grow"></div>' + bench("not_cheapest") + "</div>" +
      "</div>";
  }
  function head(title, page) {
    return '<div class="pagehead"><div class="s-h2">' + esc(title) + '</div><div class="s-sub">Dashboard ' + page + " of 4</div></div>";
  }
  function full1(st) {
    var note = "Share of offers accepted";
    return head("What won deals", 1) + '<div class="dash c3">' +
      panel("By relationship", rateBars(st.byConnType, "none"), "conn_type", note) +
      panel("With and without a pilot", rateBars(st.pilot, "no"), "pilot", note) +
      panel("By proof shown", rateBars(st.proof, "none"), "proof", note) + "</div>";
  }
  function full2(st) {
    var p = st.price, fw = st.firstWin, pb = st.perBuyer, t = st.time;
    var priceBars = bars([
      { label: "Winning offers", width: (p.win || 0) / 1.2, value: p.win == null ? "none" : Math.round(p.win) + "%", note: p.nWin + " offers", empty: p.win == null },
      { label: "Losing offers", width: (p.lose || 0) / 1.2, value: p.lose == null ? "none" : Math.round(p.lose) + "%", note: p.nLose + " offers", empty: p.lose == null }
    ], 100 / 1.2);
    return head("Price and effort", 2) + '<div class="dash c4">' +
      panel("Average price, as a share of the incumbent's price", priceBars, "price", "The vertical line marks the incumbent's price (100%)") +
      panel("Offers received per buyer", stat(pb.avg == null ? "–" : pb.avg.toFixed(1), pb.avg == null ? "" : "on average. From " + pb.min + " to " + pb.max + " across " + pb.n + " buyers."), "offers_per_buyer") +
      panel("Offers a seller needed for a first win", stat(fw.avg == null ? "–" : fw.avg.toFixed(1), "on average, among sellers who won. " + fw.noWin + " of " + fw.sellers + " sellers never won a deal."), "offers_to_first_win") +
      panel("Time to the first deal", stat(t.first == null ? "–" : ui.tclock(t.first), t.median == null ? "No deals were signed" : "after the market opened. The median deal came at " + ui.tclock(t.median) + "."), "time_to_first_deal") +
      "</div>";
  }
  function full3(st) {
    var r = st.reasons, q = st.quick.incumbent;
    return head("What buyers said drove the decision", 3) + '<div class="dash c3">' +
      panel("Buyers who signed a start-up", countBars(r.buyerStartup, "exitOptions"), "reasons_signed", "Main reason for the decision") +
      panel("Buyers who stayed with the incumbent", countBars(r.buyerIncumbent, "exitOptions"), "reasons_stayed", q.count + " of " + q.n + " buyers stayed") +
      panel("Reasons given for rejecting an offer", countBars(r.reject, "rejectReasons"), "reject_reasons", "Chosen when an offer was rejected") + "</div>";
  }
  function full4(st) {
    var r = st.reasons, d = st.delivery;
    function failBar(label, x, base) { return { label: label, width: x.pct || 0, value: x.n ? pct(x.pct) : "no deals", note: x.n ? x.failed + " of " + x.n : "", empty: !x.n, base: base }; }
    return head("What sellers believed, and what the risk really was", 4) + '<div class="dash c3">' +
      panel("Sellers who won a deal", countBars(r.sellerWon, "exitOptions"), "reasons_sellers_won", "Why do you think you won?") +
      panel("Sellers who won nothing", countBars(r.sellerLost, "exitOptions"), "reasons_sellers_lost", "Why do you think you lost?") +
      panel("Start-ups that failed to deliver", bars([failBar("Start-ups holding proof", d.withProof), failBar("Start-ups with no proof", d.noProof), failBar("All signed deals", d.all, true)]), "delivery", "Share of signed deals that failed") + "</div>";
  }

  function view() {
    var pub = S.pub;
    if (!S.code) return '<div class="s-h1">No game selected</div><p class="s-sub">Open this screen from the host panel.</p>';
    if (pub === undefined) return '<p class="s-sub">Connecting…</p>';
    if (pub === null) return '<div class="s-h1">Game ' + esc(S.code) + ' not found</div><p class="s-sub">Create a game from the host panel.</p>';
    var p = pub.game.phase;
    if (p === "lobby") return lobby(pub);
    if (p === "briefing") return briefing(pub);
    if (p === "open" || p === "paused") return market(pub);
    var v = pub.game.view || "closed";
    if (v === "closed" || !pub.full) return closed(pub);
    var st = B2B.stats.compute(pub.full, S.cards);
    return v === "quick" ? quick(st) : v === "full1" ? full1(st) : v === "full2" ? full2(st) : v === "full3" ? full3(st) : full4(st);
  }

  function render() {
    var pub = S.pub;
    var key = JSON.stringify(pub ? [pub.game, pub.players, pub.deals, pub.n_offers, pub.full] : pub);
    if (key === S.key) return;
    S.key = key;
    var bots = pub ? pub.players.filter(function (p) { return p.is_bot; }).length : 0;
    var phaseName = { lobby: "Joining", briefing: "Briefing", open: "Market open", paused: "Paused", locked: "Results" };
    bar.innerHTML = '<div class="title">' + esc(cfg.title) + ' <span class="muted" style="font-weight:500">· ' + esc(cfg.subtitle) + "</span></div>" +
      '<div class="right">' + (bots ? '<span class="chip sim">Simulated run · ' + bots + " simulated players</span>" : "") +
      (pub ? '<span class="chip">' + phaseName[pub.game.phase] + "</span>" : "") + "</div>";
    stage.innerHTML = view();
  }

  // Arrow keys change the results view, when this browser is also the host's.
  document.addEventListener("keydown", function (ev) {
    if (!host || host.code !== S.code || !S.pub || S.pub.game.phase !== "locked") return;
    var d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    var i = Math.max(0, VIEWS.indexOf(S.pub.game.view)) + d;
    if (i < 0 || i >= VIEWS.length) return;
    api.host(S.code, host.pin, "view", { view: VIEWS[i] }).then(refresh, function () {});
  });

  var refresh = function () {};
  Promise.all([ui.loadJson("data/cards.json"), ui.loadJson("data/benchmarks.json").catch(function () { return {}; })]).then(function (r) {
    S.cards = r[0]; S.bench = r[1];
    ui.tickClocks(function () { return S.pub && S.pub.game; });
    refresh = ui.loop(function () {
      if (!S.code) { render(); return Promise.resolve(); }
      return api.public(S.code).then(function (pub) {
        if (pub) ui.syncClock(pub.now);
        S.pub = pub;
        render();
      });
    }, function () { return B2B.mode === "local" ? 600 : 1500; });
  });
})();
