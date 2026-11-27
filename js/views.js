/* The projector views of the game, as functions that return HTML.
   Used by screen.html (stand-alone projector) and by the slides (deck.html),
   so the live game looks identical in both. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, cfg = window.B2B_CONFIG, E = B2B.engine;
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
  function doorName(d) { return V.cards.doors[d] || "Door " + (d + 1); }
  function moveName(k) { return (V.cards.moves[k] || {}).title || k; }
  function slotsOf(pub) { return (pub.game.rules && pub.game.rules.slots) || cfg.game.slots; }
  function giantIds(pub) { return (pub.game.rules && pub.game.rules.giants) || []; }

  // ---------- building blocks ----------
  function bench(key) {
    var b = V.bench[key];
    if (b && b.value) {
      return '<div class="bench filled"><span class="label">Real world</span><br><b>' + esc(b.value) + '</b><span class="src">' + esc(b.source || "") + "</span></div>";
    }
    return cfg.showEmptyBenchmarks === false ? "" : '<div class="bench">Real-world benchmark: to be added</div>';
  }
  // items: [{label, width (0..100), value, note, base, empty}]
  function bars(items, compact) {
    return '<div class="bars' + (compact ? " compact" : "") + '">' + items.map(function (it) {
      return '<div class="bar' + (it.base ? " base" : "") + (it.empty ? " empty" : "") + '" title="' + esc(it.label + ": " + it.value + (it.note ? " (" + it.note + ")" : "")) + '">' +
        '<div class="top"><span>' + esc(it.label) + '</span><span class="v num">' + esc(it.value) + (it.note ? "<small>" + esc(it.note) + "</small>" : "") + "</span></div>" +
        '<div class="track">' + (it.empty ? "" : '<div class="fill" style="width:' + Math.max(0, Math.min(100, it.width)) + '%"></div>') + "</div></div>";
    }).join("") + "</div>";
  }
  function rateBar(label, r, base, none) {
    return { label: label, width: r.pct || 0, value: r.n ? pct(r.pct) : none || "not tried", note: r.n ? r.won + " of " + r.n : "", base: !!base, empty: !r.n };
  }
  function moveBars(list, compact, baseKey) {
    return bars(list.filter(function (x) { return x.rate.n || x.key === "cold" || x.key === "intro"; })
      .sort(function (a, b) { return (b.rate.pct == null ? -1 : b.rate.pct) - (a.rate.pct == null ? -1 : a.rate.pct); })
      .map(function (x) { return rateBar(moveName(x.key), x.rate, x.key === (baseKey || "cold")); }), compact);
  }
  function panel(title, body, benchKey, sub) {
    return '<div class="s-panel"><h3>' + esc(title) + "</h3>" + (sub ? '<div class="muted">' + esc(sub) + "</div>" : "") + body + '<div class="grow"></div>' + (benchKey ? bench(benchKey) : "") + "</div>";
  }
  function stat(n, d) { return '<div class="stat"><div class="n num">' + esc(n) + '</div><div class="d">' + esc(d) + "</div></div>"; }
  function counter(n, label, cls) { return '<div class="s-panel counter' + (cls ? " " + cls : "") + '"><div class="n num">' + esc(n) + '</div><div class="label">' + esc(label) + "</div></div>"; }

  // The funnel: how many start-ups have opened each door.
  function funnelBars(f, compact) {
    var n = f.startups || 0;
    return bars([0, 1, 2, 3].map(function (d) {
      return { label: d === 3 ? "Got the executive's signature" : "Got past " + (d === 0 ? "the manager" : doorName(d).toLowerCase()), width: n ? (f.opened[d] / n) * 100 : 0,
               value: n ? pct((f.opened[d] / n) * 100) : "–", note: f.opened[d] + " of " + n, base: d === 3 };
    }), compact);
  }
  // One giant as a building: the executive on the top floor, the manager at street level.
  // Each dot is a start-up standing at that door.
  function building(g, slots, small) {
    var html = '<div class="bld' + (small ? " small" : "") + '"><div class="nm">' + esc(g.name) + '</div><div class="sub num">' + g.startups + (g.startups === 1 ? " start-up" : " start-ups") + "</div>" +
      '<div class="roof' + (g.winners.length ? " won" : "") + '">' + (g.winners.length ? g.winners.map(function (w) { return "<b>" + esc(w.name) + "</b>"; }).join(" · ") + (g.late ? ' <span class="muted">+' + g.late + " too late</span>" : "")
        : '<span class="muted">nobody signed yet · room for ' + slots + "</span>") + "</div>";
    for (var d = 3; d >= 0; d--) {
      html += '<div class="floor"><span class="lb">' + esc(doorName(d)) + '</span><span class="dots2">' + "●".repeat(Math.min(g.at[d], 14)) + (g.at[d] > 14 ? "+" : "") + "</span></div>";
    }
    return html + "</div>";
  }
  function buildings(pub, small) {
    var gs = B2B.stats.byGiant(pub.players, giantIds(pub), V.cards, slotsOf(pub));
    return '<div class="blds" style="grid-template-columns:repeat(' + Math.max(1, gs.length) + ',minmax(0,1fr))">' + gs.map(function (g) { return building(g, slotsOf(pub), small); }).join("") + "</div>";
  }

  // ---------- game phases ----------
  V.lobby = function (pub, code) {
    var url = V.joinUrl(code), local = B2B.mode === "local";
    return '<div class="s-cols"><div style="display:grid;place-items:center">' +
      (local ? '<div class="s-panel" style="max-width:28rem"><div class="s-h2">Offline demo</div><p class="s-sub" style="margin-top:0.6rem">Phones cannot join in this mode. Add simulated players from the host controls.</p></div>'
             : '<div class="qr">' + (qrSvg(url) || '<div class="s-h2">' + esc(url) + "</div>") + "</div>") +
      '</div><div style="display:flex;flex-direction:column;gap:1.1rem;min-height:0;height:100%;justify-content:center">' +
      '<div><div class="label" style="font-size:1rem">Join on your phone</div><div class="s-h1">Scan to play</div></div>' +
      (local ? "" : '<div><div class="joinurl">' + esc(url.replace(/^https?:\/\//, "")) + '</div><div class="s-sub">Game code <span class="code">' + esc(code) + "</span></div></div>") +
      '<div class="s-h2"><span class="num" style="font-size:4.5rem;color:var(--accent);text-shadow:0.2rem 0.2rem 0 var(--ink)">' + pub.players.length + "</span> joined</div>" +
      '<div class="names" style="max-height:14rem">' + pub.players.slice().reverse().map(function (p) { return '<span class="chip plain">' + esc(p.name) + "</span>"; }).join("") + "</div></div></div>";
  };
  V.briefing = function (pub) {
    var chosen = pub.players.filter(function (p) { return p.giant; }).length, all = pub.players.filter(function (p) { return p.role; }).length;
    return '<div class="s-cols" style="grid-template-columns:1.25fr 1fr;align-items:stretch"><div style="display:flex;flex-direction:column;justify-content:center"><div class="label" style="font-size:1rem;margin-bottom:1.1rem">Read your card · choose your target</div><ol class="rules" style="padding:0;margin:0">' +
      V.cards.rules.map(function (r) { return "<li><span>" + esc(r) + "</span></li>"; }).join("") + "</ol></div>" +
      '<div style="display:flex;flex-direction:column;gap:1rem;justify-content:center"><div class="s-panel" style="text-align:center"><div class="label" style="font-size:1rem">Round 1 starts in</div><div class="giant num" style="font-size:7rem" data-clock></div>' +
      '<div class="s-sub num">' + chosen + " of " + all + " have chosen a target</div></div>" + buildings(pub, true) + "</div></div>";
  };
  // A round in play: the clock and every giant, with the start-ups standing at its doors.
  V.round = function (pub) {
    var g = pub.game, R = g.rules, now = pub.moves.filter(function (m) { return m.round === g.round && m.success != null; });
    return '<div class="roundtop"><div><div class="label" style="font-size:1rem">Round ' + g.round + " of " + g.rounds + ' · budget of ' + R.budget + ' each</div><div class="s-h1">Get inside.</div></div>' +
      '<div class="counters" style="grid-template-columns:repeat(2,auto)">' + counter(now.filter(function (m) { return m.success; }).length, "doors opened this round") + counter(pub.intros.length, "introductions given") + "</div>" +
      '<div class="giant num" style="font-size:7.5rem" data-clock></div></div>' + buildings(pub, false);
  };
  // After a round: which moves worked, and how far the room has got.
  V.reveal = function (pub) {
    var g = pub.game, r = g.round, last = g.phase === "locked", slots = slotsOf(pub);
    var f = B2B.stats.funnel(pub.players, slots), rates = B2B.stats.moveRates(pub.moves, last ? null : r);
    var signedNow = pub.players.filter(function (p) { return p.rank != null; });
    return '<div class="s-cols" style="grid-template-columns:1fr 1.15fr;align-items:stretch;gap:2rem"><div style="display:flex;flex-direction:column;gap:1rem;min-height:0">' +
      '<div><div class="label" style="font-size:1rem">' + (last ? "The game is over" : "Round " + r + " of " + g.rounds) + '</div><div class="s-h1" style="font-size:3.1rem">' + (last ? "What opened the doors" : "What worked this round") + "</div></div>" +
      '<div class="s-panel" style="flex:1;min-height:0">' + '<div class="label" style="font-size:0.95rem;margin-bottom:0.6rem">How often each move opened a door' + (last ? ", whole game" : "") + ' · chances set by us</div>' + moveBars(rates, false) + "</div>" +
      (last ? "" : '<div class="s-panel next"><div class="row"><div><div class="label" style="font-size:0.9rem">Next</div><div class="s-h2">Round ' + (r + 1) + " of " + g.rounds + "</div></div>" +
        (g.ends_at ? '<div class="s-h1 num" data-clock></div>' : '<div class="s-sub">waiting for the host</div>') + "</div></div>") + "</div>" +
      '<div style="display:flex;flex-direction:column;gap:1rem;min-height:0"><div class="s-panel"><div class="label" style="font-size:0.95rem;margin-bottom:0.5rem">How far the room has got · ' + signedNow.length + " signed</div>" + funnelBars(f, true) + "</div>" +
      buildings(pub, true) + "</div></div>";
  };
  V.closed = function (pub) { return V.reveal(pub); };
  // The live game slide: follows the phase to the end.
  V.stale = function () {
    return '<div style="flex:1;display:grid;place-items:center"><div class="s-panel" style="max-width:46rem"><div class="s-h2">This game needs a restart</div>' +
      '<p class="s-sub" style="margin-top:0.6rem">It was started from an out-of-date page. Reload the host panel, press Reset game, and start again.</p></div></div>';
  };
  V.game = function (pub, code) {
    if (E.stale(pub.game)) return V.stale();
    var p = pub.game.phase;
    return p === "lobby" ? V.lobby(pub, code) : p === "briefing" ? V.briefing(pub) : p === "open" ? V.round(pub) : V.reveal(pub);
  };

  // ---------- results ----------
  function signedPct(g) { return g.n ? pct(g.signed.pct) : "–"; }
  function groupBars(a, la, b, lb) {
    return bars([
      { label: la, width: a.signed.pct || 0, value: a.n ? pct(a.signed.pct) : "nobody", note: a.n ? a.signed.won + " of " + a.n + " signed" : "", empty: !a.n },
      { label: lb, width: b.signed.pct || 0, value: b.n ? pct(b.signed.pct) : "nobody", note: b.n ? b.signed.won + " of " + b.n + " signed" : "", base: true, empty: !b.n }
    ], true);
  }
  function d1(n) { return n == null ? "–" : (Math.round(n * 10) / 10).toFixed(1); }

  V.quick = function (st, noHead) {
    var f = st.funnel, n = st.network;
    return (noHead ? "" : '<div class="pagehead"><div class="s-h2">What just happened in this room</div><div class="s-sub num">' + st.counts.startups + " start-ups · " + st.counts.giants + " giants · " + st.counts.moves + " marketing moves</div></div>") +
      '<div class="s-cols" style="grid-template-columns:1.2fr 1fr;align-items:stretch;gap:2rem"><div class="s-panel" style="display:flex;flex-direction:column;min-height:0;gap:0.8rem">' +
      '<div class="label" style="font-size:1rem">How far the room got</div>' + funnelBars(f, false) + "</div>" +
      '<div style="display:flex;flex-direction:column;gap:1rem;justify-content:center">' +
      '<div class="s-panel">' + stat((n.cold.n ? pct(n.cold.pct) : "–") + " vs " + (n.intro.n ? pct(n.intro.pct) : "–"), "A cold email opened the door, against an introduction. Chances set by us.") + "</div>" +
      '<div class="s-panel">' + stat(signedPct(n.groups.yes) + " vs " + signedPct(n.groups.no), "of start-ups got the signature: those who used an introduction, against those who never did.") + "</div>" +
      '<div class="s-panel">' + stat(f.winners + " of " + f.startups, "start-ups won a contract." + (f.signed > f.winners ? " " + (f.signed - f.winners) + " more got every yes, but too late:" : "") +
        " each company signed only its first " + st.counts.slots + ".") + "</div></div></div>";
  };

  V.panels = {
    funnel: function (st) { return panel("How far the room got", funnelBars(st.funnel, true), "funnel", "Share of start-ups that opened each door"); },
    moves: function (st) { return panel("What opened doors", moveBars(st.moves, true), "moves", "How often each move worked. The chances were set by us."); },
    cold: function (st) {
      var c = st.network.cold;
      return panel("Cold outreach", stat(c.n ? pct(c.pct) : "–", c.n ? c.won + " of " + c.n + " cold emails opened a door. (A low chance, set by us.)" : "Nobody sent a cold email."), "cold");
    },
    network: function (st) {
      var n = st.network;
      return panel("Did an introduction change the result?", groupBars(n.groups.yes, "Used an introduction", n.groups.no, "Never did") +
        '<p class="muted" style="margin-top:0.5rem">' + n.given + " introductions were given in this room, " + n.used + " were used. One opened the door " + (n.intro.n ? pct(n.intro.pct) : "–") +
        " of the time; a cold email, " + (n.cold.n ? pct(n.cold.pct) : "–") + ".</p>", "network", "Share of start-ups that got the signature");
    },
    content: function (st) {
      var c = st.content;
      return panel("Did a case study help?", groupBars(c.yes, "Published", c.no, "Did not") +
        '<p class="muted" style="margin-top:0.5rem">Doors opened on average: ' + d1(c.yes.doors) + " against " + d1(c.no.doors) + ".</p>", "content", "Share of start-ups that got the signature");
    },
    message: function (st) {
      var m = st.message;
      return panel("Did the right message matter?", groupBars(m.right, "Right message", m.wrong, "Wrong message") +
        '<p class="muted" style="margin-top:0.5rem">' + m.researched + (m.researched === 1 ? " start-up" : " start-ups") + " spent budget on research to find out.</p>", "message", "Led with what the company cares about most, or not: share that got the signature");
    },
    targeting: function (st) {
      var t = st.targeting;
      return panel("Did it pay to go where you knew someone?", groupBars(t.yes, "Knew someone there", t.no, "Knew nobody there") +
        '<p class="muted" style="margin-top:0.5rem">Doors opened on average: ' + d1(t.yes.doors) + " against " + d1(t.no.doors) + ".</p>", "targeting", "Share of start-ups that got the signature");
    },
    stuck: function (st) {
      var n = st.stuck.reduce(function (a, b) { return a + b; }, 0);
      return panel("Where campaigns ended", bars(st.stuck.map(function (x, d) {
        return { label: d === 0 ? "Never got past the first door" : d === 4 ? "Got the signature" : "Stopped at " + doorName(d).toLowerCase(), width: n ? (x / n) * 100 : 0, value: String(x), note: n ? pct((x / n) * 100) : "", base: d === 4 };
      }), true), "stuck", "Start-ups, by the last door they reached");
    },
    winners: function (st) {
      var w = st.winners;
      if (!w.n) return panel("What the winners did", '<p class="muted">Nobody got the signature in this game.</p>', "winners");
      return panel("What the start-ups that signed did", bars(w.rows.map(function (r) {
        return { label: r.label, width: r.won.pct || 0, value: pct(r.won.pct), note: "the rest: " + (r.rest.n ? pct(r.rest.pct) : "–") };
      }), true), "winners", "Share of the " + w.n + " that signed, against the " + w.others + " that did not");
    },
    leaders: function (st) {
      function list(rows, val) {
        if (!rows.length) return '<p class="muted">Nobody.</p>';
        return '<ol class="leaders">' + rows.slice(0, 3).map(function (x) {
          return "<li><span><b>" + esc(x.name) + '</b> <span class="muted">' + esc(x.org) + '</span></span><span class="num">' + val(x) + "</span></li>";
        }).join("") + "</ol>";
      }
      return panel("Top of the room", '<div class="label" style="margin-top:0.2rem">Start-ups</div>' + list(st.leaders.startups, function (x) { return x.points + " pts"; }) +
        '<div class="label" style="margin-top:0.5rem">Best-connected: start-ups they introduced that signed</div>' + list(st.leaders.connectors, function (x) { return x.helped + " of " + x.gave; }), null);
    },
    giants: function (st) {
      return panel("Who went after whom", bars(st.giants.map(function (g) {
        return { label: g.name, width: st.counts.startups ? (g.startups / st.counts.startups) * 100 : 0, value: g.startups + " start-ups", note: g.winners.length + " signed in time" };
      }), true), "giants", "Each company signed only its first " + st.counts.slots);
    }
  };
  // One panel per door: which moves worked on that person.
  ["manager", "security", "procurement", "executive"].forEach(function (key, d) {
    V.panels[key] = function (st) {
      return panel(["At the manager’s door", "At the security door", "At the procurement door", "At the executive’s door"][d], moveBars(st.doors[d], true), "door_" + key, "How often each move opened this door. The chances were set by us.");
    };
  });
  var Pn = V.panels;
  function head(title, n) { return '<div class="pagehead"><div class="s-h2">' + esc(title) + '</div><div class="s-sub num">' + n + " of 2</div></div>"; }
  V.full1 = function (st) { return head("What opened the doors", 1) + '<div class="dash c4 even">' + Pn.funnel(st) + Pn.moves(st) + Pn.network(st) + Pn.content(st) + "</div>"; };
  V.full2 = function (st) { return head("Who got in, and how", 2) + '<div class="dash c4 even">' + Pn.winners(st) + Pn.message(st) + Pn.targeting(st) + Pn.leaders(st) + "</div>"; };

  V.redraw = function (el, html) { el.innerHTML = html; };

  B2B.views = V;
})();
