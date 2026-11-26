/* The stand-alone projector screen. Read-only: it shows whatever phase and view the host has set.
   (During the presentation the slides in deck.html show the same views.) */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store, V = B2B.views;
  var esc = ui.esc;
  var stage = document.getElementById("stage"), bar = document.getElementById("sbar");
  var VIEWS = ["closed", "quick", "full1", "full2"];

  var host = null;
  try { host = JSON.parse(store.getItem("b2bsim.host") || "null"); } catch (e) { host = null; }
  var S = { code: (ui.qs("g") || (host && host.code) || "").toUpperCase(), pub: undefined, key: "" };

  function view() {
    var pub = S.pub;
    if (!S.code) return '<div class="s-h1">No game selected</div><p class="s-sub">Open this screen from the host panel.</p>';
    if (pub === undefined) return '<p class="s-sub">Connecting…</p>';
    if (pub === null) return '<div class="s-h1">Game ' + esc(S.code) + ' not found</div><p class="s-sub">Create a game from the host panel.</p>';
    if (pub.game.phase !== "locked") return V.game(pub, S.code);
    var v = pub.game.view || "closed";
    if (v === "closed" || !pub.full) return V.closed(pub);
    var st = B2B.stats.compute(pub.full, V.cards);
    return (V[v] || V.quick)(st);
  }

  function render() {
    var pub = S.pub;
    var key = JSON.stringify(pub ? [pub.game, pub.players, pub.moves.length, pub.intros.length, !!pub.full] : pub);
    if (key === S.key) return;
    S.key = key;
    var bots = pub ? pub.players.filter(function (p) { return p.is_bot; }).length : 0;
    var g = pub && pub.game;
    var phaseName = g ? { lobby: "Joining", briefing: "Briefing", open: "Round " + g.round, reveal: "Round " + g.round + " result", locked: "Results" }[g.phase] : "";
    bar.innerHTML = '<div class="title">' + esc(cfg.title) + ' <span class="muted" style="font-weight:500">· ' + esc(cfg.subtitle) + "</span></div>" +
      '<div class="right">' + (bots ? '<span class="chip sim">Simulated run · ' + bots + " simulated players</span>" : "") +
      (pub ? '<span class="chip">' + esc(phaseName) + "</span>" : "") + "</div>";
    V.redraw(stage, view());
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
    V.init(r[0], r[1]);
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
