/* Turns the data in js/facts.js into slide content. No research lives in this file. */
(function () {
  var F = window.B2B_FACTS, cfg = window.B2B_CONFIG || {};
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ital(s) { return esc(s).replace(/\*([^*]+)\*/g, "<i>$1</i>"); }
  function $(id) { return document.getElementById(id); }
  var EMPTY = '<div class="d-empty">Research for this slide has not been added yet.</div>';

  function fact(f) {
    return '<div class="d-fact">' + (f.n ? '<div class="n num">' + esc(f.n) + "</div>" : "") + '<div class="t">' + esc(f.t) + "</div>" +
      (f.src ? '<div class="d-src">' + esc(f.src) + "</div>" : "") + "</div>";
  }
  // every <div id="fact-KEY"> is filled from F.KEY
  Object.keys(F).forEach(function (k) {
    var el = $("fact-" + k);
    if (el && Array.isArray(F[k])) el.innerHTML = F[k].length ? F[k].map(fact).join("") : EMPTY;
  });

  // a list marked data-step-each appears one item per click
  Array.prototype.forEach.call(document.querySelectorAll("[data-step-each] > .d-fact"), function (el) { el.classList.add("step"); });

  if ($("def-note")) $("def-note").textContent = F.defNote || "";

  if ($("examples")) {
    $("examples").innerHTML = !(F.examples || []).length ? EMPTY : F.examples.map(function (x) {
      return '<div class="d-ex step"><span class="yr">' + esc(x.year) + '</span><div class="nm">' + esc(x.name) + '</div><div class="how">' + esc(x.how) + "</div>" +
        '<div class="grow"></div><div class="way">' + esc(x.way) + '</div><div class="d-src">' + esc(x.src) + "</div></div>";
    }).join("");
  }

  if ($("chain")) {
    $("chain").innerHTML = !(F.chain || []).length ? EMPTY : F.chain.map(function (x, i) {
      return '<div class="d-link step' + (i === F.chain.length - 1 ? " last" : "") + '"><div class="k">' + esc(x.t) + '</div><div class="s">' + esc(x.s || "") + "</div>" +
        (x.src ? '<div class="d-src">' + esc(x.src) + "</div>" : "") + "</div>";
    }).join("");
  }

  if ($("fit")) {
    $("fit").innerHTML = !(F.fit || []).length ? EMPTY :
      '<table class="d-fit"><tr><th>Ask yourself</th><th>Go after enterprises when</th><th>Think twice when</th></tr>' + F.fit.map(function (x) {
        return '<tr class="step"><td><div class="q">' + esc(x.test) + "</div>" + (x.src ? '<div class="d-src" style="margin-top:0.3rem">' + esc(x.src) + "</div>" : "") +
          '</td><td class="yes"><b>Yes: </b>' + esc(x.yes) + '</td><td class="no"><b>No: </b>' + esc(x.no) + "</td></tr>";
      }).join("") + "</table>";
  }

  function story(el, cs, art) {
    if (!el) return;
    el.innerHTML = !cs ? '<div class="d-empty" style="margin-top:1rem">This case has not been added yet.</div>' :
      '<div class="d-h" style="margin:0.5rem 0 1.2rem">' + esc(cs.title) + '</div><div class="d-cols top wide-l" style="flex:1"><ul class="d-list">' +
      cs.points.map(function (p, i) { return '<li class="step"><i>' + (i + 1) + "</i><span>" + esc(p.t) + (p.s ? "<small>" + esc(p.s) + "</small>" : "") + "</span></li>"; }).join("") +
      '</ul><div style="display:flex;flex-direction:column;gap:1rem">' + (art ? '<div class="d-art" style="height:14rem"><img src="' + art + '" alt=""></div>' : "") +
      '<div class="d-fact step"><div class="t" style="font-size:1.3rem">' + esc(cs.lesson) + '</div></div><div class="grow"></div><div class="d-src">' + esc(cs.src) + "</div></div></div>";
  }
  story($("case-body"), F.caseStudy, "art/door-pilot.jpg");
  story($("failure-body"), F.failure, "art/risk.jpg");

  if ($("playbook")) {
    $("playbook").innerHTML = !(F.playbook || []).length ? EMPTY : '<div class="d-play">' + F.playbook.map(function (x, i) {
      return '<div class="step"><i>' + (i + 1) + "</i><b>" + esc(x.t) + "</b><span><em>Watch out: </em>" + esc(x.watch) + "</span></div>";
    }).join("") + "</div>";
  }

  // references: split evenly over the reference slides
  var src = F.sources || [], lists = ["sources1", "sources2", "sources3"].map($).filter(Boolean);
  var per = Math.ceil(src.length / (lists.length || 1));
  lists.forEach(function (el, i) {
    var part = src.slice(i * per, (i + 1) * per);
    el.innerHTML = part.length ? part.map(function (x) { return "<li>" + ital(x) + "</li>"; }).join("") : "";
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-team]"), function (el) {
    el.innerHTML = (cfg.team || []).map(function (n) { return "<span>" + esc(n) + "</span>"; }).join("");
  });
})();
