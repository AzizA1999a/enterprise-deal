/* The host control panel. This page also runs the automatic steps and the demo bots,
   so keep it open (and visible) on the laptop for the whole game. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store;
  var esc = ui.esc;
  var root = document.getElementById("app");

  var H = { sess: null, hs: null, cards: null, problems: [], msg: "", key: "", shell: false, busy: false };
  try { H.sess = JSON.parse(store.getItem("b2bsim.host") || "null"); } catch (e) { H.sess = null; }
  var refresh = function () {};

  function ctx() { return { code: H.sess.code, pin: H.sess.pin, cards: H.cards, cfg: cfg, api: api }; }
  function saveSess(s) {
    H.sess = s; H.hs = null; H.shell = false; H.key = "";
    if (s) store.setItem("b2bsim.host", JSON.stringify(s)); else store.removeItem("b2bsim.host");
  }
  function joinUrl() {
    var u = new URL(".", window.location.href);
    return u.origin + u.pathname + "?g=" + H.sess.code;
  }
  function modeName() { return B2B.mode === "online" ? "Live (Supabase)" : "Offline on this laptop"; }

  // ---------- setup ----------
  function setupView() {
    var pin = String(Math.floor(1000 + Math.random() * 9000));
    return '<div class="card stack" style="max-width:560px;margin:40px auto"><div class="label">Host panel</div><h1>' + esc(cfg.title) + "</h1>" +
      (H.msg ? '<div class="card warn">' + esc(H.msg) + "</div>" : "") +
      "<p>Mode: <b>" + modeName() + "</b></p>" +
      (B2B.hasRemote ? '<div class="inline"><button class="btn small' + (B2B.mode === "online" ? " on" : "") + '" data-act="mode" data-id="online">Live</button><button class="btn small' + (B2B.mode === "local" ? " on" : "") + '" data-act="mode" data-id="local">Offline on this laptop</button></div>'
                     : '<p class="muted">No Supabase connection is configured in js/config.js, so only offline mode is available.</p>') +
      (B2B.mode === "local" ? '<p class="muted">Offline mode keeps the whole game in this browser. Phones cannot join; use simulated players.</p>' : "") +
      '<h2 style="margin-top:10px">New game</h2><div class="inline"><label>Host PIN <input class="field" id="pin" style="width:110px" value="' + pin + '" inputmode="numeric"></label><button class="btn primary" data-act="create">Create game</button></div>' +
      '<h2 style="margin-top:10px">Return to a game</h2><div class="inline"><input class="field" id="rcode" style="width:110px" placeholder="Code" maxlength="4"><input class="field" id="rpin" style="width:110px" placeholder="PIN" inputmode="numeric"><button class="btn" data-act="rejoin">Open</button></div>' +
      (H.problems.length ? '<div class="card warn"><b>Problems in data/cards.json</b><ul>' + H.problems.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></div>" : "") +
      "</div>";
  }

  // ---------- panel ----------
  function shellView() {
    var url = joinUrl();
    return '<div class="row"><div><div class="label">Host panel · ' + modeName() + "</div><h1>Game <code>" + esc(H.sess.code) + '</code> <span class="muted" style="font-size:0.6em;font-weight:500">PIN ' + esc(H.sess.pin) + "</span></h1></div>" +
      '<div class="inline"><a class="btn small primary" href="deck.html?g=' + esc(H.sess.code) + '" target="_blank" rel="noopener">Open the presentation</a><a class="btn small" href="screen.html?g=' + esc(H.sess.code) + '" target="_blank" rel="noopener">Projector only</a><button class="btn small" data-act="leave">Leave this game</button></div></div>' +
      (B2B.mode === "online" ? '<p class="muted" style="margin-top:6px">Phones join at <a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a></p>" : "") +
      (H.problems.length ? '<div class="card warn" style="margin-top:12px"><b>Problems in data/cards.json</b><ul>' + H.problems.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<div class="grid"><div class="card stack" id="status"></div><div><div class="card stack"><h2>Demo mode</h2>' +
      '<div class="inline"><input class="field" id="botn" type="number" min="1" max="60" value="24" style="width:90px"><button class="btn" data-act="addbots">Add simulated players</button></div>' +
      '<label class="inline"><input type="checkbox" id="autobots" checked> Simulated players act on their own</label>' +
      '<p class="muted">Simulated players join, negotiate and answer like a class would. Results that include them are labelled "Simulated run" on the projector.</p></div>' +
      '<div class="card stack"><h2>Data</h2><div class="inline"><button class="btn" data-act="export">Download CSV files</button><button class="btn danger" data-act="reset">Reset game</button></div>' +
      '<p class="muted">Three files: every offer, every player, and the event log. Reset removes all players and offers but keeps the game code.</p></div></div></div>' +
      '<div class="card" id="roster" style="margin-top:14px"></div>';
  }

  function statusView(hs) {
    var g = hs.game, P = hs.players;
    var sellers = P.filter(function (p) { return p.role === "seller"; }).length;
    var buyers = P.filter(function (p) { return p.role === "buyer"; }).length;
    var deals = hs.offers.filter(function (o) { return o.status === "accepted"; }).length;
    var stayed = P.filter(function (p) { return p.decision === "incumbent" || p.decision === "incumbent_default"; }).length;
    var answered = P.filter(function (p) { return p.exit_answer; }).length;
    var counterOffers = P.reduce(function (n, p) { return n + (p.role === "buyer" ? B2B.engine.counters(p.card).length : 0); }, 0);
    var names = { lobby: "Lobby", briefing: "Briefing", open: "Market open", paused: "Paused", locked: "Market closed" };
    function btn(act, label, cls, id, disabled) {
      return '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (id ? ' data-id="' + id + '"' : "") + (disabled ? " disabled" : "") + ">" + label + "</button>";
    }
    var controls = "";
    if (g.phase === "lobby") controls = btn("start", "Start: assign roles", "primary", "", P.length < 2);
    else if (g.phase === "briefing") controls = btn("open", "Open the market now", "primary");
    else if (g.phase === "open") controls = btn("pause", "Pause") + btn("extend", "+1 minute") + btn("lock", "Lock the market", "primary");
    else if (g.phase === "paused") controls = btn("resume", "Resume", "primary") + btn("extend", "+1 minute") + btn("lock", "Lock the market");
    else {
      controls = [["closed", "Market closed"], ["quick", "Quick reveal"], ["full1", "Dashboard 1: what won"], ["full2", "Dashboard 2: price and effort"], ["full3", "Dashboard 3: buyers' reasons"], ["full4", "Dashboard 4: sellers and risk"]]
        .map(function (v) { return btn("view", v[1], g.view === v[0] ? "on" : "", v[0]); }).join("");
    }
    var hint = g.phase === "lobby" ? (P.length < 2 ? "Waiting for players. At least 2 are needed." : "Press Start when everyone has joined. Late joiners still get a role.") :
      g.phase === "briefing" ? "Players are reading their cards. The market opens by itself when the clock reaches zero." :
      g.phase === "open" ? "The market locks by itself at zero." + (cfg.rivals && cfg.rivals.on ? " The incumbents' account managers are played by this laptop: keep this page or the slides open." : "") :
      g.phase === "paused" ? "No offers or decisions while paused." :
      "These buttons set the stand-alone projector screen. The slides show results on their own.";
    return '<div class="row"><div><div class="label">Phase</div><div class="phase">' + names[g.phase] + '</div></div><div style="text-align:right"><div class="label">Clock</div><div class="phase num" data-clock></div></div></div>' +
      '<div class="chips"><span class="chip plain num">' + P.length + ' players</span><span class="chip plain num">' + sellers + " sellers · " + buyers + ' buyers</span><span class="chip plain num">' + hs.offers.length +
      ' offers</span><span class="chip plain num">' + deals + ' deals</span><span class="chip plain num">' + stayed + ' stayed with incumbent</span>' +
      (cfg.rivals && cfg.rivals.on ? '<span class="chip plain num">' + counterOffers + " incumbent counter-offers</span>" : "") +
      (g.phase === "locked" ? '<span class="chip plain num">' + answered + " of " + (sellers + buyers) + " exit answers</span>" : "") + "</div>" +
      '<p class="muted">' + hint + '</p><div class="controls">' + controls + "</div>" +
      (H.msg ? '<div class="card warn">' + esc(H.msg) + "</div>" : "");
  }

  function rosterView(hs) {
    if (!hs.players.length) return "<h2>Players</h2><p class=\"muted\">Nobody has joined yet.</p>";
    var rows = hs.players.slice().sort(function (a, b) { return (a.role || "z").localeCompare(b.role || "z") || (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name); });
    return "<h2>Players</h2><table><tr><th>Name</th><th>Role</th><th>Organisation</th><th>Category</th><th>Knows</th><th>Offers</th><th>Result</th><th>Exit</th></tr>" +
      rows.map(function (p) {
        var sent = hs.offers.filter(function (o) { return o.seller_id === p.id; });
        var got = hs.offers.filter(function (o) { return o.buyer_id === p.id; });
        var wins = sent.filter(function (o) { return o.status === "accepted"; }).length;
        var result = !p.role ? "" : p.role === "seller" ? (wins ? wins + " won" : "") :
          p.decision === "startup" ? "Signed a start-up" : p.decision === "incumbent" ? "Stayed" + (function () { var c = B2B.engine.standing(p.card, p.stay_level); return c ? " (took " + c.pct + "% off)" : ""; })() :
          p.decision === "incumbent_default" ? "Stayed (no decision)" : B2B.engine.counters(p.card).length ? B2B.engine.counters(p.card).length + " counter-offer(s) on the table" : "";
        return "<tr><td>" + esc(p.name) + (p.is_bot ? ' <span class="chip grey">sim</span>' : "") + "</td><td>" + esc(p.role || "waiting") + "</td><td>" + esc(p.card ? p.card.org : "") + "</td><td>" + esc(p.card ? p.card.categoryName : "") +
          "</td><td>" + esc(p.card ? p.card.connections.map(function (c) { return c.name; }).join(", ") : "") + '</td><td class="num">' + (p.role === "seller" ? sent.length + " sent" : p.role === "buyer" ? got.length + " received" : "") +
          "</td><td>" + result + (p.points != null ? ' · <span class="num">' + p.points + " pts</span>" : "") + "</td><td>" + esc(p.exit_answer || "") + "</td></tr>";
      }).join("") + "</table>";
  }

  function render() {
    if (!H.sess) { root.innerHTML = setupView(); H.shell = false; return; }
    if (!H.shell) { root.innerHTML = shellView(); H.shell = true; H.key = ""; }
    var hs = H.hs;
    if (!hs) return;
    var key = JSON.stringify([hs.game, hs.players, hs.offers, H.msg]);
    if (key === H.key) return;
    H.key = key;
    document.getElementById("status").innerHTML = statusView(hs);
    document.getElementById("roster").innerHTML = rosterView(hs);
  }

  function run(promise) {
    H.msg = "";
    return promise.then(function () { refresh(); }, function (e) { H.msg = B2B.errorText(e); H.key = ""; render(); });
  }

  // ---------- events ----------
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var a = el.getAttribute("data-act"), id = el.getAttribute("data-id");
    if (a === "mode") {
      store.setItem("b2bsim.offline", id === "local" ? "1" : "0");
      saveSess(null);
      window.location.reload();
    } else if (a === "create") {
      var pin = document.getElementById("pin").value.trim();
      if (pin.length < 4) { H.msg = "Choose a PIN of at least 4 digits."; return render(); }
      api.createGame(pin).then(function (r) { H.msg = ""; saveSess({ code: r.code, pin: pin }); render(); refresh(); },
        function (e) { H.msg = B2B.errorText(e); render(); });
    } else if (a === "rejoin") {
      var code = document.getElementById("rcode").value.trim().toUpperCase(), rpin = document.getElementById("rpin").value.trim();
      api.hostState(code, rpin).then(function () { H.msg = ""; saveSess({ code: code, pin: rpin }); render(); refresh(); },
        function (e) { H.msg = B2B.errorText(e); render(); });
    } else if (a === "leave") {
      if (window.confirm("Leave this game on this laptop? The game itself is kept; you can return with its code and PIN.")) { saveSess(null); render(); }
    } else if (!H.hs) {
      return;
    } else if (a === "start") {
      if (H.problems.length) { H.msg = "Fix data/cards.json first."; H.key = ""; return render(); }
      run(B2B.driver.start(ctx(), H.hs));
    } else if (a === "open") {
      run(api.host(H.sess.code, H.sess.pin, "open", { market_ms: cfg.marketSeconds * 1000 }));
    } else if (a === "pause" || a === "resume") {
      run(api.host(H.sess.code, H.sess.pin, a));
    } else if (a === "extend") {
      run(api.host(H.sess.code, H.sess.pin, "extend", { ms: cfg.extendSeconds * 1000 }));
    } else if (a === "lock") {
      if (window.confirm("Lock the market now? No more offers or decisions after this.")) run(api.host(H.sess.code, H.sess.pin, "lock"));
    } else if (a === "view") {
      run(api.host(H.sess.code, H.sess.pin, "view", { view: id }));
    } else if (a === "reset") {
      if (window.confirm("Reset the game? All players, offers and results are deleted. Export first if you need the data.")) {
        B2B.bots.plans = {}; B2B.rivals.plans = {};
        run(api.host(H.sess.code, H.sess.pin, "reset"));
      }
    } else if (a === "addbots") {
      var n = Math.max(1, Math.min(60, Number(document.getElementById("botn").value) || 0));
      run(B2B.bots.add(ctx(), n, H.hs.players.map(function (p) { return p.name; })));
    } else if (a === "export") {
      var full = { players: H.hs.players, offers: H.hs.offers }, base = "enterprise-deal-" + H.sess.code + "-";
      api.hostEvents(H.sess.code, H.sess.pin).then(function (events) {
        ui.download(base + "offers.csv", B2B.exporter.offersCsv(full, H.cards, cfg));
        setTimeout(function () { ui.download(base + "players.csv", B2B.exporter.playersCsv(full, H.cards)); }, 400);
        setTimeout(function () { ui.download(base + "events.csv", B2B.exporter.eventsCsv(events, full.players)); }, 800);
      }, function (e) { H.msg = B2B.errorText(e); H.key = ""; render(); });
    }
  });

  // ---------- start ----------
  ui.loadJson("data/cards.json").then(function (cards) {
    H.cards = cards;
    H.problems = B2B.engine.validateCards(cards);
    render();
    ui.tickClocks(function () { return H.hs && H.hs.game; });
    refresh = ui.loop(function () {
      if (!H.sess) return Promise.resolve();
      var c = ctx();
      var auto = document.getElementById("autobots");
      return B2B.hostRound(c, !auto || auto.checked).then(function (hs) {
        ui.syncClock(hs.now);
        H.hs = hs;
        render();
      }, function (e) {
        if (e.code === "no_game" || e.code === "bad_pin") { H.msg = "That game could not be opened: " + B2B.errorText(e); saveSess(null); render(); }
      });
    }, function () { return B2B.mode === "local" ? 500 : 1000; });
  }, function () { root.innerHTML = '<div class="card warn">Could not load data/cards.json.</div>'; });
})();
