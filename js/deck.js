/* The presentation. Slides are the <section class="slide"> blocks in deck.html.
   Some slides are "live": they show the running game or this room's results,
   using the same views as the projector screen, so nothing ever leaves the slides.

   Keys:  right / space / PageDown = next     left / PageUp = back     F = full screen
   A slide can carry:
     data-part="..."   section label in the top bar        data-lead="2"   speaker number (config.js team)
     data-live="game|quick|full1|full2"                    the whole slide is a live view
     data-bare         no top bar (title slide)
   Inside a slide:
     class="step"              appears one click at a time
     data-panel="conn"         one live result panel from this room (names in js/views.js)
     class="d-timer" data-seconds="180"                    a discussion timer                    */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store, V = B2B.views;
  var esc = ui.esc;
  var deck = document.getElementById("deck");
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  var bar = document.getElementById("deckbar");

  var host = null;
  try { host = JSON.parse(store.getItem("b2bsim.host") || "null"); } catch (e) { host = null; }
  var D = { i: 0, code: (ui.qs("g") || (host && host.code) || "").toUpperCase(), pub: undefined, st: null, keys: {}, cards: null, msg: "" };
  function pin() { return host && host.code === D.code ? host.pin : null; }
  function ctx() { return { code: D.code, pin: pin(), cards: D.cards, cfg: cfg, api: api }; }

  // ---------- build each slide's frame ----------
  slides.forEach(function (s, n) {
    var body = document.createElement("div");
    body.className = "body" + (s.hasAttribute("data-live") ? " live" : "");
    while (s.firstChild) body.appendChild(s.firstChild);
    if (!s.hasAttribute("data-bare")) {
      var lead = s.getAttribute("data-lead");
      var name = lead ? (cfg.team || [])[Number(lead) - 1] || "Speaker " + lead : "";
      var chrome = document.createElement("div");
      chrome.className = "chrome";
      chrome.innerHTML = '<div class="part">' + esc(cfg.title) + (s.getAttribute("data-part") ? " &nbsp;·&nbsp; <b>" + esc(s.getAttribute("data-part")) + "</b>" : "") + "</div>" +
        '<div style="display:flex;gap:0.6rem;align-items:center"><span class="simchip"></span>' + (name ? '<span class="lead">Lead: ' + esc(name) + "</span>" : "") + "</div>";
      s.appendChild(chrome);
    }
    s.appendChild(body);
    if (s.getAttribute("data-live") === "game") {
      var p = document.createElement("div");
      p.className = "presenter";
      s.appendChild(p);
    }
    var foot = document.createElement("div");
    foot.className = "foot num";
    foot.textContent = n + 1 + " / " + slides.length;
    if (!s.hasAttribute("data-bare")) s.appendChild(foot);
  });

  // ---------- fit the 1600 x 900 stage to the window ----------
  function fit() {
    var k = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    deck.style.transform = "scale(" + k + ")";
  }
  window.addEventListener("resize", fit);
  setInterval(fit, 700); // also catches full-screen and projector changes that fire no resize event
  fit();

  // ---------- navigation ----------
  function show(i, back) {
    D.i = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function (s, n) { s.classList.toggle("on", n === D.i); });
    var steps = slides[D.i].querySelectorAll(".step");
    Array.prototype.forEach.call(steps, function (el) { el.classList.toggle("shown", !!back); });
    bar.style.width = ((D.i + 1) / slides.length) * 100 + "%";
    try { history.replaceState(null, "", location.pathname + location.search + "#" + (D.i + 1)); } catch (e) { /* ignore */ }
    D.keys = {};
    renderLive();
  }
  function next() {
    var hidden = slides[D.i].querySelector(".step:not(.shown)");
    if (hidden) { hidden.classList.add("shown"); return; }
    if (D.i < slides.length - 1) show(D.i + 1, false);
  }
  function prev() { if (D.i > 0) show(D.i - 1, true); }

  document.addEventListener("keydown", function (ev) {
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    if (document.querySelector(".d-vid")) return;
    var k = ev.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { ev.preventDefault(); next(); }
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { ev.preventDefault(); prev(); }
    else if (k === "Home") show(0, false);
    else if (k === "End") show(slides.length - 1, true);
    else if (k === "f" || k === "F") {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {});
    }
  });
  deck.addEventListener("click", function (ev) {
    if (ev.target.closest("button, a, input, .presenter, .d-timer")) return;
    next();
  });
  window.addEventListener("hashchange", function () {
    var n = Number((location.hash || "").replace("#", ""));
    if (n && n - 1 !== D.i) show(n - 1, true);
  });

  // ---------- live content ----------
  function setHtml(el, key, html) {
    if (el.__key === key) return;
    el.__key = key;
    B2B.views.redraw(el, html);
  }
  function empty(text) { return '<div class="d-empty">' + esc(text) + "</div>"; }

  function liveHtml(kind) {
    var pub = D.pub;
    if (!D.code) return '<div class="s-h1">No game yet</div><p class="s-sub" style="margin-top:0.8rem">Use "Create game" below, or open the slides from the host panel.</p>';
    if (pub === undefined) return '<p class="s-sub">Connecting…</p>';
    if (pub === null) return '<div class="s-h1">Game ' + esc(D.code) + ' not found</div>';
    if (kind === "game") return V.game(pub, D.code);
    if (!D.st) return '<div style="flex:1;display:grid;place-items:center">' + empty("This slide fills in with our room's results as soon as the last round closes.") + "</div>";
    return V[kind](D.st);
  }

  function presenterHtml() {
    var p = D.pub ? D.pub.game.phase : null, has = !!pin();
    function b(act, label, go) { return '<button data-do="' + act + '"' + (go ? ' class="go"' : "") + ">" + label + "</button>"; }
    var html = "";
    if (!D.code || D.pub === null) html = b("create", "Create game", true);
    else if (!has) html = "<span>Game " + esc(D.code) + " · controls are on the host panel</span>";
    else if (p === "lobby") html = b("start", "Start: deal the start-up cards", true) + b("bots", "+24 simulated players") +
      (D.pub.players.some(function (x) { return x.is_bot; }) ? b("speed", "Test speed " + B2B.speed.chosen(D.code) + "×") : "");
    else if (p === "briefing") html = b("open", "Start round 1 now", true);
    else if (p === "open") html = b("extend", "+" + cfg.extendSeconds + " s") + b("close", "Close the round");
    else if (p === "reveal") html = b("open", "Start round " + (D.pub.game.round + 1) + " now", true) + (D.pub.game.ends_at ? b("hold", "Hold") + b("extend", "+" + cfg.extendSeconds + " s") : "<span>on hold</span>");
    else if (p === "locked") html = "<span>Game over · next slide for the results</span>";
    var fast = has && D.pub && p !== "lobby" ? B2B.speed.of(D.code, D.pub.players) : 1;
    return html + (fast > 1 ? " <span>Test speed " + fast + "×</span>" : "") + (D.msg ? " <span>" + esc(D.msg) + "</span>" : "");
  }

  function renderLive() {
    var s = slides[D.i], pub = D.pub;
    var key = JSON.stringify(pub ? [pub.game, pub.players, pub.moves.length, pub.intros.length, !!pub.full] : pub) + D.code;
    var kind = s.getAttribute("data-live");
    if (kind) setHtml(s.querySelector(".body"), kind + key, liveHtml(kind));
    Array.prototype.forEach.call(s.querySelectorAll("[data-panel]"), function (el) {
      var name = el.getAttribute("data-panel");
      setHtml(el, name + key, D.st && V.panels[name] ? V.panels[name](D.st) : empty("Our room's result appears here after the game."));
    });
    var pr = s.querySelector(".presenter");
    if (pr) setHtml(pr, key + pin() + D.msg + B2B.speed.chosen(D.code), presenterHtml());
    var bots = pub ? pub.players.filter(function (p) { return p.is_bot; }).length : 0;
    var chip = s.querySelector(".simchip");
    if (chip) setHtml(chip, "sim" + bots, bots ? '<span class="chip sim" style="text-transform:none;letter-spacing:0">Simulated run · ' + bots + " simulated players</span>" : "");
  }

  // ---------- presenter controls ----------
  function run(promise) {
    D.msg = "";
    promise.then(function () { refresh(); }, function (e) { D.msg = B2B.errorText(e); renderLive(); });
  }
  deck.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-do]");
    if (!el) return;
    var a = el.getAttribute("data-do"), c = ctx();
    if (a === "create") {
      var newPin = String(Math.floor(100000 + Math.random() * 900000));
      api.createGame(newPin).then(function (r) {
        host = { code: r.code, pin: newPin };
        store.setItem("b2bsim.host", JSON.stringify(host));
        D.code = r.code; D.pub = undefined; D.st = null;
        try { history.replaceState(null, "", location.pathname + "?g=" + r.code + location.hash); } catch (e) { /* ignore */ }
        refresh();
      }, function (e) { D.msg = B2B.errorText(e); renderLive(); });
    } else if (a === "start") {
      run(api.hostState(c.code, c.pin).then(function (hs) { return B2B.driver.start(c, hs); }));
    } else if (a === "speed") {
      var opts = B2B.speed.options;
      B2B.speed.set(c.code, opts[(opts.indexOf(B2B.speed.chosen(c.code)) + 1) % opts.length]);
      renderLive();
    } else if (a === "bots") {
      run(B2B.bots.add(c, 24, (D.pub ? D.pub.players : []).map(function (p) { return p.name; })));
    } else if (a === "open") {
      run(api.hostState(c.code, c.pin).then(function (hs) { return B2B.driver.openRound(c, hs); }));
    } else if (a === "close") {
      if (window.confirm("Close this round now?")) run(api.hostState(c.code, c.pin).then(function (hs) { return B2B.driver.closeRound(c, hs); }));
    } else if (a === "hold") {
      run(api.host(c.code, c.pin, "hold"));
    } else if (a === "extend") {
      run(api.host(c.code, c.pin, "extend", { ms: B2B.speed.ms(c.code, D.pub && D.pub.players, cfg.extendSeconds * 1000) }));
    }
  });

  // ---------- an optional clip (config.js "video"), opened over the slide ----------
  var vid = cfg.video && cfg.video.url ? cfg.video : null, vidBox = null;
  function embedUrl(v) {
    var u = v.url, id = null, m;
    if ((m = u.match(/youtu\.be\/([\w-]{6,})/)) || (m = u.match(/[?&]v=([\w-]{6,})/)) || (m = u.match(/\/embed\/([\w-]{6,})/))) id = m[1];
    if (!id) return null;
    return "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0&modestbranding=1" +
      (v.start ? "&start=" + Math.floor(v.start) : "") + (v.end ? "&end=" + Math.floor(v.end) : "");
  }
  function openClip() {
    if (!vid || vidBox) return;
    var yt = embedUrl(vid), media;
    if (yt) media = '<iframe src="' + esc(yt) + '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    else media = '<video src="' + esc(vid.url) + (vid.start ? "#t=" + vid.start + (vid.end ? "," + vid.end : "") : "") + '" controls autoplay></video>';
    vidBox = document.createElement("div");
    vidBox.className = "d-vid";
    vidBox.innerHTML = '<div class="d-vid-in">' + media + '<div class="d-vid-cap"><span>' + esc(vid.title || "") + (vid.src ? ' <span class="d-src">' + esc(vid.src) + "</span>" : "") +
      '</span><button type="button" data-vid="close">Close (Esc)</button></div></div>';
    vidBox.addEventListener("click", function (ev) { if (ev.target === vidBox || ev.target.getAttribute("data-vid") === "close") closeClip(); });
    document.body.appendChild(vidBox);
  }
  function closeClip() { if (vidBox) { vidBox.remove(); vidBox = null; } }
  if (vid) {
    var clipSlide = slides[(Number(vid.slide) || 8) - 1];
    if (clipSlide) {
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "d-vidbtn"; btn.textContent = "\u25B6  Play the clip";
      btn.addEventListener("click", function (ev) { ev.stopPropagation(); openClip(); });
      clipSlide.querySelector(".body").appendChild(btn);
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      if (ev.key === "Escape") closeClip();
      else if ((ev.key === "v" || ev.key === "V") && slides[D.i] === clipSlide) openClip();
    }, true);
  }

  // ---------- discussion timers ----------
  var timers = [];
  Array.prototype.forEach.call(deck.querySelectorAll(".d-timer"), function (el) {
    var t = { el: el, total: Number(el.getAttribute("data-seconds")) || 120, left: 0, running: false, last: 0 };
    t.left = t.total * 1000;
    el.innerHTML = '<span class="tm num"></span><button data-t="go">Start</button><button class="ghost" data-t="reset">Reset</button>';
    el.addEventListener("click", function (ev) {
      var a = ev.target.getAttribute("data-t");
      if (a === "go") { t.running = !t.running; t.last = Date.now(); }
      if (a === "reset") { t.running = false; t.left = t.total * 1000; }
      paint(t);
    });
    timers.push(t);
    paint(t);
  });
  function paint(t) {
    t.el.querySelector(".tm").textContent = ui.mmss(t.left);
    t.el.querySelector('[data-t="go"]').textContent = t.running ? "Pause" : t.left < t.total * 1000 && t.left > 0 ? "Resume" : "Start";
    t.el.classList.toggle("done", t.left <= 0);
  }
  setInterval(function () {
    timers.forEach(function (t) {
      if (!t.running) return;
      var now = Date.now();
      t.left = Math.max(0, t.left - (now - t.last)); t.last = now;
      if (t.left <= 0) t.running = false;
      paint(t);
    });
  }, 250);

  // ---------- start ----------
  var refresh = function () {};
  var start = Number((location.hash || "").replace("#", "")) || 1;
  Promise.all([ui.loadJson("data/cards.json"), ui.loadJson("data/benchmarks.json").catch(function () { return {}; })]).then(function (r) {
    D.cards = r[0];
    V.init(r[0], r[1]);
    show(start - 1, true);
    ui.watchVersion(false);
    ui.tickClocks(function () { return D.pub && D.pub.game; });
    refresh = ui.loop(function () {
      if (!D.code) { renderLive(); return Promise.resolve(); }
      // With the host PIN in this browser, the slides also run the automatic steps of the game.
      var duty = pin() ? B2B.hostRound(ctx(), true).catch(function () {}) : Promise.resolve();
      return duty.then(function () { return api.public(D.code); }).then(function (pub) {
        if (pub) ui.syncClock(pub.now);
        D.pub = pub;
        D.st = pub && pub.full && !B2B.engine.stale(pub.game) ? B2B.stats.compute(pub.full, D.cards) : null;
        renderLive();
      });
    }, function () {
      var p = D.pub && D.pub.game && D.pub.game.phase;
      return B2B.speed.poll(D.code, pin() && D.pub && D.pub.players, B2B.mode === "local" ? 600 : p === "locked" ? 2500 : 1200);
    });
  });
})();
