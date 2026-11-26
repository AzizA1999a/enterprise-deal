/* The projector views of the game, as functions that return HTML.
   Used by screen.html (stand-alone projector) and by the slides (deck.html),
   so the live game looks identical in both. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, cfg = window.B2B_CONFIG, E = B2B.engine;
  var esc = ui.esc, pct = ui.pct, P = cfg.payoff;
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
  function pts(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
  function word(r) { return (V.cards.rounds[r - 1] || {}); }

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
  function rateBars(list, baseKey, compact, refAt, none) {
    return bars(list.map(function (x) {
      var r = x.rate;
      return { label: x.label, width: r.pct || 0, value: r.n ? pct(r.pct) : none || "none", note: r.n ? r.won + " of " + r.n : "", base: x.key === baseKey, empty: !r.n };
    }), refAt, compact);
  }
  function panel(title, body, benchKey, sub) {
    return '<div class="s-panel"><h3>' + esc(title) + "</h3>" + (sub ? '<div class="muted">' + esc(sub) + "</div>" : "") + body + '<div class="grow"></div>' + (benchKey ? bench(benchKey) : "") + "</div>";
  }
  function stat(n, d) { return '<div class="stat"><div class="n num">' + esc(n) + '</div><div class="d">' + esc(d) + "</div></div>"; }
  function counter(n, label, cls) { return '<div class="s-panel counter' + (cls ? " " + cls : "") + '"><div class="n num">' + esc(n) + '</div><div class="label">' + esc(label) + "</div></div>"; }

  // The picture of the whole game: one column per round. Its height is the share of buyers who signed a start-up;
  // the dark part at the bottom is the buyers whose start-up failed.
  function roundChart(rounds, total, cls) {
    var html = '<div class="rchart ' + (cls || "") + '">';
    for (var i = 0; i < total; i++) {
      var x = rounds[i];
      if (!x) { html += '<div class="col todo"><div class="v num">?</div><div class="stack"></div><div class="t">Round ' + (i + 1) + "<small>" + esc(word(i + 1).title || "") + "</small></div><div class=\"s\">&nbsp;</div></div>"; continue; }
      var ok = x.buyers ? ((x.signed - x.burned) / x.buyers) * 100 : 0, burn = x.buyers ? (x.burned / x.buyers) * 100 : 0;
      html += '<div class="col"><div class="v num">' + pct(x.pct) + '</div><div class="stack"><div style="flex:' + (100 - ok - burn) + ' 0 0px"></div>' +
        '<div class="ok" style="flex:' + ok + ' 0 0px"></div><div class="burn" style="flex:' + burn + ' 0 0px"></div></div>' +
        '<div class="t">Round ' + x.round + "<small>" + esc(x.title) + '</small></div><div class="s num">' + x.signed + " of " + x.buyers + " signed · " +
        '<span class="burnt">' + x.burned + " burned</span></div></div>";
    }
    return html + '</div><div class="rkey"><span><i class="ok"></i>signed a start-up that delivered</span><span><i class="burn"></i>signed a start-up that failed</span></div>';
  }
  function burnedLines(list, limit) {
    if (!list.length) return '<p class="s-sub">Nobody got burned.</p>';
    return '<ul class="burnlist">' + list.slice(0, limit).map(function (d) {
      return "<li><b>" + esc(d.buyer) + "</b> signed " + (d.kind === "pilot" ? "a pilot with " : "") + "<b>" + esc(d.sellerOrg) + "</b>. It was never ready.</li>";
    }).join("") + (list.length > limit ? "<li>…and " + (list.length - limit) + " more.</li>" : "") + "</ul>";
  }
  function payoffLine(rule) {
    return '<div class="payline num"><span>Stay <b>' + pts(P.stay) + "</b></span><span>Full deal <b>" + pts(P.fullWin) + "</b> or <b class=\"bad\">" + pts(P.fullLose) + "</b></span>" +
      (rule.pilot ? "<span>Pilot <b>" + pts(P.pilotWin) + "</b> or <b class=\"bad\">" + pts(P.pilotLose) + "</b></span>" : "") + "</div>";
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
    var s = pub.players.filter(function (p) { return p.role === "seller"; }).length;
    var b = pub.players.filter(function (p) { return p.role === "buyer"; }).length;
    return '<div class="s-cols" style="grid-template-columns:1.7fr 1fr"><div><div class="label" style="font-size:1rem;margin-bottom:1.3rem">Read your role card · the rules</div><ol class="rules" style="padding:0;margin:0">' +
      V.cards.rules.map(function (r) { return "<li><span>" + esc(r) + "</span></li>"; }).join("") + "</ol></div>" +
      '<div class="s-panel" style="text-align:center"><div class="label" style="font-size:1rem">Round 1 starts in</div><div class="giant num" style="font-size:9rem" data-clock></div>' +
      '<div class="s-h2" style="margin-top:1.2rem"><span class="num">' + s + "</span> start-ups · <span class=\"num\">" + b + "</span> buyers</div></div></div>";
  };
  // A round in play: the clock, what is new this round, and how many buyers have decided. No names, no outcomes.
  V.round = function (pub) {
    var g = pub.game, r = g.round, rule = E.roundRule(cfg, r);
    var buyers = pub.players.filter(function (p) { return p.role === "buyer"; }).length;
    return '<div class="s-cols" style="grid-template-columns:1.1fr 1fr;align-items:stretch"><div style="display:flex;flex-direction:column;justify-content:center;gap:1.4rem">' +
      '<div><div class="label" style="font-size:1rem">Round ' + r + " of " + g.rounds + '</div><div class="s-h1">' + esc(word(r).title) + "</div></div>" +
      '<div class="giant num" data-clock></div>' + payoffLine(rule) + "</div>" +
      '<div style="display:flex;flex-direction:column;gap:1.2rem;justify-content:center">' +
      '<div class="s-panel"><div class="label" style="font-size:1rem;margin-bottom:0.6rem">' + (r === 1 ? "This round" : "New this round") + '</div><div class="s-h2" style="font-weight:700">' + esc(word(r).new) + "</div></div>" +
      '<div class="counters" style="grid-template-columns:1fr 1fr">' + counter(pub.decided_now, "of " + buyers + " buyers have decided") + counter(pub.signed_now, "signed a start-up") + "</div></div></div>";
  };
  // After a round: who signed, who got burned, and the picture so far.
  V.reveal = function (pub) {
    var g = pub.game, r = g.round, last = g.phase === "locked";
    var rounds = B2B.stats.liveRounds(pub.players, pub.closed, r, V.cards), x = rounds[r - 1];
    var next = r + 1 <= g.rounds ? word(r + 1) : null;
    return '<div class="s-cols" style="grid-template-columns:1fr 1.05fr;align-items:stretch;gap:2.2rem"><div style="display:flex;flex-direction:column;gap:1.1rem;min-height:0">' +
      '<div><div class="label" style="font-size:1rem">' + (last ? "Final round" : "Round " + r + " of " + g.rounds) + ' · what happened</div><div class="s-h1" style="font-size:3.2rem">' + esc(x.title) + "</div></div>" +
      '<div class="counters three">' + counter(x.signed, "of " + x.buyers + " buyers signed a start-up") + counter(x.burned, "got burned", x.burned ? "burn" : "") + counter(x.stayed, "stayed") + "</div>" +
      '<div class="s-panel" style="flex:1;min-height:0;overflow:hidden"><div class="label" style="font-size:1rem;margin-bottom:0.6rem">Burned this round</div>' + burnedLines(x.burnedList, 5) + "</div></div>" +
      '<div style="display:flex;flex-direction:column;gap:1rem;min-height:0"><div class="s-panel" style="flex:1;min-height:0;display:flex;flex-direction:column"><div class="label" style="font-size:1rem;margin-bottom:0.4rem">Buyers who signed a start-up</div>' +
      roundChart(rounds, g.rounds) + "</div>" +
      (next ? '<div class="s-panel next"><div class="row"><div><div class="label" style="font-size:0.9rem">Next: round ' + (r + 1) + '</div><div class="s-h2">' + esc(next.title) + "</div></div>" +
        (g.ends_at ? '<div class="s-h1 num" data-clock></div>' : '<div class="s-sub">waiting for the host</div>') + '</div><p class="s-sub" style="margin-top:0.4rem;font-size:1.15rem">' + esc(next.new) + "</p></div>" : "") +
      "</div></div>";
  };
  V.closed = function (pub) { return V.reveal(pub); };
  // The live game slide: follows the phase to the end.
  V.game = function (pub, code) {
    var p = pub.game.phase;
    return p === "lobby" ? V.lobby(pub, code) : p === "briefing" ? V.briefing(pub) : p === "open" ? V.round(pub) : V.reveal(pub);
  };

  // ---------- results ----------
  V.quick = function (st, noHead) {
    var R = st.rounds, first = R[0], last = R[R.length - 1];
    return (noHead ? "" : '<div class="pagehead"><div class="s-h2">What just happened in this room</div><div class="s-sub num">' + st.counts.sellers + " start-ups, " + st.counts.notReady + " of them not ready · " + st.counts.buyers + " buyers</div></div>") +
      '<div class="s-cols" style="grid-template-columns:1.25fr 1fr;align-items:stretch;gap:2rem"><div class="s-panel" style="display:flex;flex-direction:column;min-height:0">' +
      '<div class="label" style="font-size:1rem;margin-bottom:0.4rem">Buyers who signed a start-up</div>' + roundChart(R, R.length, "big") + "</div>" +
      '<div style="display:flex;flex-direction:column;gap:1rem;justify-content:center">' +
      '<div class="s-panel">' + stat(pct(first.pct) + " → " + pct(last.pct), "of buyers signed a start-up: with words only, then with everything the room could check.") + "</div>" +
      '<div class="s-panel">' + stat(first.signed ? pct((first.burned / first.signed) * 100) + " → " + (last.signed ? pct((last.burned / last.signed) * 100) : "–") : "–", "of those who signed got burned: round 1, then the last round.") + "</div>" +
      '<div class="s-panel">' + stat(first.stayed + " of " + first.buyers, "buyers stayed with what they had in round 1. Staying scored " + pts(P.stay) + ", with no risk.") + "</div></div></div>";
  };

  V.panels = {
    rounds: function (st) {
      return panel("Buyers who signed a start-up, round by round", roundChart(st.rounds, st.rounds.length, "small"), "rounds_signed");
    },
    stayed1: function (st) {
      var x = st.rounds[0];
      return panel("Round 1: words only", stat(pct(x.buyers ? (x.stayed / x.buyers) * 100 : null), x.stayed + " of " + x.buyers + " buyers stayed with the supplier they had."), "stayed_round1");
    },
    burned: function (st) {
      var x = st.rounds[0], all = st.burned;
      return panel("Buyers who got burned", '<div class="burnstat"><span class="num">' + all.length + "</span> " + (all.length === 1 ? "time" : "times") + " in the whole game, " + x.burned + " in round 1</div>" + burnedLines(all, 4),
        "burned", "Signed a start-up whose product was not ready");
    },
    tell: function (st) {
      var t = st.tell;
      return panel("Could buyers tell who was ready?", rateBars(t.rounds.map(function (x) { return { key: "r" + x.round, label: "Round " + x.round + ": " + x.title, rate: x.rate }; }), null, true, t.share, "no deals") +
        '<p class="muted" style="margin-top:0.5rem">The line marks blind luck: ' + t.notReady + " of " + t.sellers + " start-ups (" + pct(t.share) + ") were not ready.</p>",
        "tell_apart", "Share of deals that went to a start-up that was not ready");
    },
    proof: function (st) {
      var p = st.proof;
      if (!p.rounds.length) return panel("Proof", '<p class="muted">No round of this game showed proof.</p>', "proof");
      return panel("Who got signed once proof could be shown?", rateBars(p.bars, "not", true, null, "none in this game"), "proof",
        "Share of start-ups signed per round, " + (p.rounds.length > 1 ? "rounds " + p.rounds[0] + " to " + p.rounds[p.rounds.length - 1] : "round " + p.rounds[0]));
    },
    pilot: function (st) {
      var p = st.pilot;
      if (!p.rounds.length) return panel("Pilots", '<p class="muted">No round of this game allowed pilots.</p>', "pilot");
      return panel("Who was signed with a pilot, not a full deal?", rateBars(p.bars, "proven", true, null, "no deals") +
        '<p class="muted" style="margin-top:0.5rem">' + p.pilots + (p.pilots === 1 ? " pilot" : " pilots") + " in all. " +
        (p.failedPilots ? p.failedPilots + " failed: each cost its buyer " + Math.abs(P.pilotLose) + (Math.abs(P.pilotLose) === 1 ? " point" : " points") + ", not " + Math.abs(P.fullLose) + "." : "None of them failed.") + "</p>",
        "pilot", "Share of deals that were pilots");
    },
    trust: function (st) {
      var t = st.trust;
      if (!t.rounds.length) return panel("Introductions", '<p class="muted">No round of this game had introductions.</p>', "trust");
      return panel("Did knowing someone change the decision?", rateBars(t.bars, "none", true, null, "no such buyers") +
        '<p class="muted" style="margin-top:0.5rem">' + t.viaIntro + " of " + t.dealsInIntro + " deals in that round went to a start-up the buyer knew. " +
        t.toReferenced + " of " + t.dealsInRecord + " went to one that had already delivered for somebody in the room.</p>",
        "trust", "Share who signed a start-up in round " + t.rounds[0]);
    },
    notReady: function (st) {
      var p = st.points;
      function v(n) { return n == null ? "–" : (Math.round(n * 10) / 10).toFixed(1); }
      return panel("Did it pay to sell a product that was not ready?", bars([
        { label: "Start-ups whose product worked", width: Math.max(0, (p.avgReady || 0)) / (E.roundCount(cfg) * P.sellerFull) * 100, value: v(p.avgReady), note: "points each" },
        { label: "Start-ups that were not ready", width: Math.max(0, (p.avgNotReady || 0)) / (E.roundCount(cfg) * P.sellerFull) * 100, value: v(p.avgNotReady), note: "points each", base: true }
      ], null, true), "not_ready", "Average points over the whole game");
    },
    leaders: function (st) {
      function list(rows) {
        return '<ol class="leaders">' + rows.slice(0, 3).map(function (x) {
          return "<li><span><b>" + esc(x.name) + '</b> <span class="muted">' + esc(x.org) + '</span></span><span class="num">' + pts(x.points) + "</span></li>";
        }).join("") + "</ol>";
      }
      return panel("Top of the room", '<div class="label" style="margin-top:0.2rem">Buyers</div>' + list(st.points.buyers) + '<div class="label" style="margin-top:0.5rem">Start-ups</div>' + list(st.points.sellers) +
        '<p class="muted" style="margin-top:0.4rem">A buyer who stayed every round scored ' + pts(st.points.alwaysStay) + ".</p>", null);
    }
  };
  var Pn = V.panels;
  function head(title, n) { return '<div class="pagehead"><div class="s-h2">' + esc(title) + '</div><div class="s-sub num">' + n + " of 2</div></div>"; }
  V.full1 = function (st) { return head("What opened the door", 1) + '<div class="dash c4 even">' + Pn.tell(st) + Pn.proof(st) + Pn.pilot(st) + Pn.trust(st) + "</div>"; };
  V.full2 = function (st) { return head("Who paid, and who won", 2) + '<div class="dash c3">' + Pn.burned(st) + Pn.notReady(st) + Pn.leaders(st) + "</div>"; };

  // Redraw a live view without losing a scroll position inside it.
  V.redraw = function (el, html) { el.innerHTML = html; };

  B2B.views = V;
})();
