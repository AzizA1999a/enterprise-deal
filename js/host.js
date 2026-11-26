/* The host control panel. This page also runs the automatic steps and the demo bots,
   so keep it (or the slides) open and in front on the laptop for the whole game. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store, E = B2B.engine;
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
  function giantName(id) { var g = (H.cards.giants || []).filter(function (x) { return x.id === id; })[0]; return g ? g.name : id || ""; }
  function doorName(d) { return (H.cards.doors || [])[d] || "door " + (d + 1); }

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
      '<label class="inline">Test speed <select class="field" id="speed" style="width:auto">' + B2B.speed.options.map(function (n) { return '<option value="' + n + '"' + (n === B2B.speed.chosen(H.sess.code) ? " selected" : "") + ">" + (n === 1 ? "1× (as in class)" : n + "×") + "</option>"; }).join("") + '</select></label>' +
      '<p class="muted" id="speednote"></p>' +
      '<p class="muted">Simulated start-ups run their own campaigns: about a third only send cold emails, the rest market first, and some introduce each other. Results that include them are labelled "Simulated run" on the projector.</p></div>' +
      '<div class="card stack"><h2>Data</h2><div class="inline"><button class="btn" data-act="export">Download CSV files</button><button class="btn danger" data-act="reset">Reset game</button></div>' +
      '<p class="muted">Three files: every marketing move, every player, and the event log. Reset removes all players and results but keeps the game code.</p></div></div></div>' +
      '<div class="card" id="roster" style="margin-top:14px"></div>';
  }

  function statusView(hs) {
    var g = hs.game, Pl = hs.players, R = g.rules;
    var startups = Pl.filter(function (p) { return p.role; });
    var now = hs.moves.filter(function (m) { return m.round === g.round; });
    var names = { lobby: "Lobby", briefing: "Briefing", open: "Round " + g.round + " of " + g.rounds, reveal: "Reveal · round " + g.round, locked: "Game over" };
    function btn(act, label, cls, id, disabled) {
      return '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (id ? ' data-id="' + id + '"' : "") + (disabled ? " disabled" : "") + ">" + label + "</button>";
    }
    var controls = "";
    if (g.phase === "lobby") controls = btn("start", "Start: deal the start-up cards", "primary", "", Pl.length < 2);
    else if (g.phase === "briefing") controls = btn("open", "Start round 1 now", "primary");
    else if (g.phase === "open") controls = btn("extend", "+" + cfg.extendSeconds + " s") + btn("close", "Close the round now", "primary");
    else if (g.phase === "reveal") controls = btn("open", "Start round " + (g.round + 1) + " now", "primary") + (g.ends_at ? btn("hold", "Hold: wait for me") + btn("extend", "+" + cfg.extendSeconds + " s") : "");
    else {
      controls = [["closed", "What opened the doors"], ["quick", "The room in one look"], ["full1", "Dashboard 1: what worked"], ["full2", "Dashboard 2: who got in"]]
        .map(function (v) { return btn("view", v[1], g.view === v[0] ? "on" : "", v[0]); }).join("");
    }
    var hint = g.phase === "lobby" ? (Pl.length < 2 ? "Waiting for players. At least 2 are needed." : "Press Start when everyone has joined. Late joiners still get a start-up.") :
      g.phase === "briefing" ? "Players are reading their cards and choosing a company to go after. Round 1 starts by itself when the clock reaches zero." :
      g.phase === "open" ? "The round closes by itself at zero. Budget that is not spent is lost." :
      g.phase === "reveal" ? (g.ends_at ? "The projector shows which moves worked. The next round starts by itself at zero; press Hold if you need longer." : "On hold. Press the button when you are ready for the next round.") :
      "These buttons set the stand-alone projector screen. The slides show results on their own.";
    var priorities = R ? '<p class="muted">What each company cares about most (hidden from players): ' + Object.keys(R.giants).map(function (id) {
      return "<b>" + esc(giantName(id)) + "</b> " + esc(String((H.cards.messages || {})[R.giants[id].priority] || R.giants[id].priority).toLowerCase());
    }).join(" · ") + "</p>" : "";
    return '<div class="row"><div><div class="label">Phase</div><div class="phase">' + names[g.phase] + '</div></div><div style="text-align:right"><div class="label">Clock</div><div class="phase num" data-clock></div></div></div>' +
      '<div class="chips"><span class="chip plain num">' + Pl.length + " players</span>" +
      (R ? '<span class="chip plain num">' + startups.filter(function (p) { return p.state.giant; }).length + " of " + startups.length + " chose a target</span>" +
           '<span class="chip plain num">' + startups.filter(function (p) { return p.state.rank != null; }).length + " signed</span>" +
           '<span class="chip plain num">' + hs.intros.length + " introductions</span>" : "") +
      (g.phase === "open" || g.phase === "reveal" ? '<span class="chip plain num">This round: ' + now.length + " moves, " + now.filter(function (m) { return m.success; }).length + " doors opened</span>" : "") +
      (B2B.speed.of(H.sess.code, Pl) > 1 ? '<span class="chip sim">Test speed ' + B2B.speed.of(H.sess.code, Pl) + "×</span>" : "") + "</div>" +
      '<p class="muted">' + hint + "</p>" + priorities + '<div class="controls">' + controls + "</div>" +
      (H.msg ? '<div class="card warn">' + esc(H.msg) + "</div>" : "");
  }

  function rosterView(hs) {
    if (!hs.players.length) return "<h2>Players</h2><p class=\"muted\">Nobody has joined yet.</p>";
    var g = hs.game, R = g.rules, slots = R ? R.slots : cfg.game.slots;
    var startups = hs.players.filter(function (p) { return p.role; });
    var rows = hs.players.slice().sort(function (a, b) { return (a.role ? 0 : 1) - (b.role ? 0 : 1) || a.name.localeCompare(b.name); });
    if (!R) {
      return "<h2>Players</h2><table><tr><th>Name</th></tr>" + rows.map(function (p) {
        return "<tr><td>" + esc(p.name) + (p.is_bot ? ' <span class="chip grey">sim</span>' : "") + "</td></tr>";
      }).join("") + "</table>";
    }
    return "<h2>Players</h2>" + '<p class="muted">This table shows who knows whom and which message is the right one. Keep this panel off the projector.</p>' +
      "<table><tr><th>Name</th><th>Code</th><th>Start-up</th><th>Knows</th><th>Going after</th><th>Message</th><th>Doors</th><th>Gave</th><th>Got</th><th>Points</th></tr>" +
      rows.map(function (p) {
        var c = p.card || {}, s = p.state || {}, k = c.contact;
        if (!p.role) return "<tr><td>" + esc(p.name) + (p.is_bot ? ' <span class="chip grey">sim</span>' : "") + '</td><td colspan="9" class="muted">waiting for a start-up</td></tr>';
        var right = s.giant && s.message ? R.giants[s.giant].priority === s.message : null;
        var doors = s.rank != null ? '<span class="chip ' + (s.rank <= slots ? "good" : "grey") + '">signed ' + (s.rank <= slots ? "#" + s.rank : "too late") + "</span>"
          : s.giant ? s.progress + " of " + E.DOORS + ' <span class="muted">at ' + esc(doorName(s.progress).toLowerCase()) + "</span>" : "";
        return "<tr><td>" + esc(p.name) + (p.is_bot ? ' <span class="chip grey">sim</span>' : "") + '</td><td><span class="deskpill num">' + esc(c.code || "") + "</span></td><td>" + esc(c.org || "") + "</td><td>" +
          (k ? esc(doorName(k.door).toLowerCase()) + " at " + esc(k.giantName || giantName(k.giant)) : "") + "</td><td>" + (s.giant ? esc(giantName(s.giant)) + (k && k.giant === s.giant ? " ✓" : "") : '<span class="muted">not chosen</span>') + "</td><td>" +
          (s.message ? esc(s.message) + (right ? " ✓" : " ✗") : "") + "</td><td>" + doors + '</td><td class="num">' +
          hs.intros.filter(function (i) { return i.from_id === p.id; }).length + '</td><td class="num">' + hs.intros.filter(function (i) { return i.to_id === p.id; }).length +
          '</td><td class="num">' + (g.round ? E.score(p, startups, hs.intros, cfg, slots).total : "") + "</td></tr>";
      }).join("") + "</table>";
  }

  function render() {
    if (!H.sess) { root.innerHTML = setupView(); H.shell = false; return; }
    if (!H.shell) { root.innerHTML = shellView(); H.shell = true; H.key = ""; }
    var hs = H.hs;
    if (!hs) return;
    var key = JSON.stringify([hs.game, hs.players, hs.moves.length, hs.intros, H.msg]);
    if (key === H.key) return;
    H.key = key;
    document.getElementById("status").innerHTML = statusView(hs);
    document.getElementById("roster").innerHTML = rosterView(hs);
    speedNote();
  }

  // Says what the chosen test speed does, and whether it is in force.
  function speedNote() {
    var el = document.getElementById("speednote");
    if (!el || !H.sess) return;
    var n = B2B.speed.chosen(H.sess.code), on = H.hs && B2B.speed.of(H.sess.code, H.hs.players) > 1;
    el.textContent = n === 1 ? "For rehearsing alone: shorter rounds and reveals, with the simulated players keeping pace."
      : "At " + n + "×: each round " + ui.tclock(cfg.roundSeconds / n) + ", each reveal " + ui.tclock(cfg.revealSeconds / n) + ". " +
        (on ? "In force for this game." : "Not in force yet: it only applies once simulated players are in the game, so a real class always runs at normal speed.");
  }

  function run(promise) {
    H.msg = "";
    return promise.then(function () { refresh(); }, function (e) { H.msg = B2B.errorText(e); H.key = ""; render(); });
  }

  // ---------- events ----------
  document.addEventListener("change", function (ev) {
    if (ev.target.id !== "speed" || !H.sess) return;
    B2B.speed.set(H.sess.code, Number(ev.target.value));
    H.key = "";
    render();
    refresh();
  });
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
      run(B2B.driver.openRound(ctx(), H.hs));
    } else if (a === "close") {
      if (window.confirm("Close round " + H.hs.game.round + " now? Budget that is not spent is lost.")) run(B2B.driver.closeRound(ctx(), H.hs));
    } else if (a === "hold") {
      run(api.host(H.sess.code, H.sess.pin, "hold"));
    } else if (a === "extend") {
      run(api.host(H.sess.code, H.sess.pin, "extend", { ms: B2B.speed.ms(H.sess.code, H.hs.players, cfg.extendSeconds * 1000) }));
    } else if (a === "view") {
      run(api.host(H.sess.code, H.sess.pin, "view", { view: id }));
    } else if (a === "reset") {
      if (window.confirm("Reset the game? All players and results are deleted. Export first if you need the data.")) {
        B2B.bots.plans = {};
        run(api.host(H.sess.code, H.sess.pin, "reset"));
      }
    } else if (a === "addbots") {
      var n = Math.max(1, Math.min(60, Number(document.getElementById("botn").value) || 0));
      run(B2B.bots.add(ctx(), n, H.hs.players.map(function (p) { return p.name; })));
    } else if (a === "export") {
      var full = { players: H.hs.players, moves: H.hs.moves, intros: H.hs.intros, rules: H.hs.game.rules || {} }, base = "enterprise-deal-" + H.sess.code + "-";
      api.hostEvents(H.sess.code, H.sess.pin).then(function (events) {
        ui.download(base + "moves.csv", B2B.exporter.movesCsv(full, H.cards));
        setTimeout(function () { ui.download(base + "players.csv", B2B.exporter.playersCsv(full, H.cards, cfg)); }, 400);
        setTimeout(function () { ui.download(base + "events.csv", B2B.exporter.eventsCsv(events, full.players)); }, 800);
      }, function (e) { H.msg = B2B.errorText(e); H.key = ""; render(); });
    }
  });

  // ---------- start ----------
  ui.loadJson("data/cards.json").then(function (cards) {
    H.cards = cards;
    H.problems = E.validateCards(cards);
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
    }, function () { return B2B.speed.poll(H.sess && H.sess.code, H.hs && H.hs.players, B2B.mode === "local" ? 500 : 1000); });
  }, function () { root.innerHTML = '<div class="card warn">Could not load data/cards.json.</div>'; });
})();
