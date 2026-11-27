/* Small helpers shared by the three pages. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});
  var offset = 0; // server clock minus this device's clock

  var ui = {
    esc: function (s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    },
    money: function (v) { return "$" + Math.round(v) + "k"; },
    mmss: function (ms) {
      var s = Math.max(0, Math.ceil(ms / 1000));
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    },
    tclock: function (sec) { return sec == null ? "" : Math.floor(sec / 60) + ":" + String(Math.round(sec) % 60).padStart(2, "0"); },
    pct: function (v) { return v == null ? "–" : Math.round(v) + "%"; },
    qs: function (name) { return new URLSearchParams(root.location.search).get(name); },
    syncClock: function (serverNow) { offset = serverNow - Date.now(); },
    now: function () { return Date.now() + offset; },

    // Milliseconds left in the current countdown, or null when no clock is running.
    left: function (game) {
      if (!game) return null;
      if (game.phase === "briefing") return Math.max(0, game.briefing_ends_at - ui.now());
      if (game.phase === "open") return Math.max(0, game.ends_at - ui.now());
      if (game.phase === "reveal" && game.ends_at) return Math.max(0, game.ends_at - ui.now());   // until the next round starts by itself
      return null;
    },

    loadJson: function (path) {
      return fetch(path, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("Could not load " + path);
        return r.json();
      });
    },

    // Repeats `fn` (which returns a Promise) forever, waiting `delay()` ms between runs.
    loop: function (fn, delay) {
      var timer = null, running = false;
      function run() {
        if (running) return;
        running = true;
        clearTimeout(timer);
        Promise.resolve().then(fn).catch(function () {}).then(function () {
          running = false;
          timer = setTimeout(run, delay());
        });
      }
      document.addEventListener("visibilitychange", function () { if (!document.hidden) run(); });
      run();
      return run; // call to refresh immediately
    },

    // Keeps every [data-clock] element ticking between server updates.
    tickClocks: function (getGame) {
      setInterval(function () {
        var game = getGame(), left = ui.left(game);
        document.querySelectorAll("[data-clock]").forEach(function (el) {
          el.textContent = left == null ? "" : ui.mmss(left);
          el.classList.toggle("low", !!game && game.phase === "open" && left <= 20000);
        });
      }, 250);
    },

    // The version this page was loaded with (the ?v= stamp on its scripts), and a check against the published one.
    // A phone reloads itself once; the host panel, slides and projector show a bar with a Reload button,
    // because reloading them is the presenter's call.
    version: (function () {
      var el = root.document && root.document.querySelector('script[src*="js/ui.js"]');
      var m = el && /[?&]v=([^&]+)/.exec(el.getAttribute("src") || "");
      return m ? m[1] : "";
    })(),
    hardReload: function () {
      var u = new URL(root.location.href);
      u.searchParams.set("_", String(Date.now()));          // a new address, so the browser fetches the page again
      root.location.replace(u.toString());
    },
    watchVersion: function (auto) {
      if (!ui.version) return;
      function check() {
        fetch("version.json?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          if (!j || !j.v || j.v === ui.version) return;
          var once = "b2bsim.reloaded." + j.v, done = false;
          try { done = root.sessionStorage.getItem(once) === "1"; } catch (e) { /* no storage */ }
          if (auto && !done) {
            try { root.sessionStorage.setItem(once, "1"); } catch (e) { /* no storage */ }
            return ui.hardReload();
          }
          if (root.document.getElementById("newversion")) return;
          var bar = root.document.createElement("div");
          bar.id = "newversion";
          bar.innerHTML = "<span>This page is out of date. A newer version of the game has been published.</span><button type=\"button\">Reload now</button>";
          bar.querySelector("button").addEventListener("click", function (ev) { ev.stopPropagation(); ui.hardReload(); });
          root.document.body.appendChild(bar);
        }).catch(function () { /* offline: nothing to compare with */ });
      }
      check();
      setInterval(check, 60000);
      root.document.addEventListener("visibilitychange", function () { if (!root.document.hidden) check(); });
    },

    download: function (filename, text) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  };

  B2B.ui = ui;
})(window);
