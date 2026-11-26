/* The player's phone.
   A buyer makes one decision per round: stay, or sign a start-up by typing its two-digit deal code.
   A start-up only talks: its phone shows its deal code, its secret, and who signed it. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, E = B2B.engine, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store;
  var esc = ui.esc, P = cfg.payoff;
  var app = document.getElementById("app"), sheetEl = document.getElementById("sheet"), toastEl = document.getElementById("toast");

  var S = { code: "", token: "", st: undefined, cards: null, tab: "main", sheet: null, busy: false, key: "", typed: "", signedBy: null };
  S.code = (ui.qs("g") || store.getItem("b2bsim.lastcode") || "").toUpperCase().replace(/[^A-Z]/g, "");
  var refresh = function () {};

  function setCode(code) {
    S.code = code;
    store.setItem("b2bsim.lastcode", code);
    S.token = store.getItem("b2bsim.token." + code);
    if (!S.token) { S.token = B2B.uid(); store.setItem("b2bsim.token." + code, S.token); }
  }

  // ---------- small helpers ----------
  function pts(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
  function word(r) { return (S.cards.rounds[r - 1] || {}); }
  function header(sub, title, clockLabel) {
    return '<header class="top"><div class="row"><div><div class="label">' + esc(sub) + "</div><h1>" + esc(title) + "</h1></div>" +
      (clockLabel ? '<div style="text-align:right"><div class="label">' + esc(clockLabel) + '</div><div class="clock num" data-clock></div></div>' : "") +
      "</div></header>";
  }
  function kindName(k) { return k === "pilot" ? "a pilot" : "the full deal"; }
  function sellerById(st, id) { return st.sellers.filter(function (s) { return s.id === id; })[0] || null; }
  function total(st) { return E.score(st.me, st.closed, E.closedRounds(st.game), cfg); }
  // The payoff table, as the buyer needs it in front of them.
  function payoffTable(rule, incumbent) {
    function row(a, b, c) { return "<tr><td>" + a + '</td><td class="num good">' + b + '</td><td class="num bad">' + c + "</td></tr>"; }
    return '<table class="payoff"><tr><th></th><th>It delivers</th><th>It fails</th></tr>' +
      "<tr><td>Stay with " + esc(incumbent) + '</td><td class="num" colspan="2" style="text-align:center">' + pts(P.stay) + ", always</td></tr>" +
      row("Sign a start-up: full deal", pts(P.fullWin), pts(P.fullLose)) +
      (rule.pilot ? row("Sign a start-up: pilot", pts(P.pilotWin), pts(P.pilotLose)) : "") + "</table>";
  }
  // One line per closed round: what happened and what it was worth.
  function history(st) {
    var sc = total(st), me = st.me;
    if (!sc.rounds.length) return "";
    return '<div class="card stack"><div class="row"><div class="label">Your rounds so far</div><div class="bigname num">' + pts(sc.total) + '</div></div><table class="breakdown">' +
      sc.rounds.map(function (x) {
        var d = x.row, text;
        if (me.role === "buyer") {
          var s = d && d.seller_id ? sellerById(st, d.seller_id) : null;
          text = !d ? "Stayed (no decision)" : d.kind === "stay" ? "Stayed" :
            (d.kind === "pilot" ? "Pilot with " : "Full deal with ") + esc(s ? s.org : "a start-up") + (d.delivered ? ": delivered" : ': <span class="bad">failed</span>');
        } else {
          text = !d ? "Nobody signed you" : "Signed, " + (d.kind === "pilot" ? "pilot" : "full deal") + (d.delivered ? "" : ' <span class="bad">(you failed to deliver)</span>');
        }
        return "<tr><td>Round " + x.round + " · " + text + '</td><td class="num">' + pts(x.points) + "</td></tr>";
      }).join("") + "</table></div>";
  }

  // ---------- role cards ----------
  function secretCard(c) {
    var T = S.cards.secret;
    return '<div class="card stack secret ' + (c.ready ? "ok" : "no") + '"><div class="label">Your secret. Show this to nobody.</div>' +
      '<div class="bigname">' + (c.ready ? "Your product works." : "Your product is not ready.") + "</div><p>" + esc(c.ready ? T.ready : T.notReady) + "</p>" +
      (c.ready ? '<p class="muted">' + esc(c.proof ? T.proof : T.noProof) + "</p>" : "") + "</div>";
  }
  function codeCard(c) {
    return '<div class="badge seller"><div class="strip">Start-up · selling</div><div class="who"><div class="n">' + esc(S.st.me.name) + '</div><div class="o">' + esc(c.org) +
      '</div><div class="muted" style="margin-top:4px">' + esc(c.tagline) + '</div></div><div class="desk"><div class="label">Your deal code</div><div class="d num">' + esc(c.code) +
      '</div><div class="muted">A buyer signs you by typing this on their phone.</div></div></div>';
  }
  function sellerCard(c) {
    return codeCard(c) + secretCard(c) +
      '<div class="card note stack"><div class="label">How you play</div><p><b>Walk up to buyers and pitch.</b> When one wants to sign, tell them your deal code. One buyer can sign you per round.</p>' +
      '<p class="muted">A full deal scores you ' + pts(P.sellerFull) + ", a pilot " + pts(P.sellerPilot) + ". There are " + E.roundCount(cfg) + " rounds, and each one changes what buyers can check.</p></div>";
  }
  function buyerCard(c) {
    return '<div class="card stack"><div class="rolebanner"><img src="art/buyer-s.jpg" alt=""></div><div class="label">You are the ' + esc(c.title) + ' at</div><div class="bigname">' + esc(c.org) + "</div>" +
      (c.need ? "<p>You need: " + esc(c.need) + "</p>" : "") + "<p>Your supplier today is <b>" + esc(c.incumbent) + "</b>.</p></div>" +
      '<div class="card warn stack"><div class="label" style="color:var(--bad)">Your choice, every round</div><p><b>' + esc(S.cards.buyerRule) + "</b></p>" +
      payoffTable(E.roundRule(cfg, E.roundCount(cfg)), c.incumbent) + "</div>" +
      '<div class="card note stack"><div class="label">How you play</div><p><b>Start-ups will come to you and pitch.</b> Some have a product that is not ready, and they will not tell you. To sign one, type its deal code. Or tap Stay.</p>' +
      '<p class="muted">One decision per round, ' + E.roundCount(cfg) + " rounds. If you do nothing, you stay.</p></div>";
  }
  function roleCard(me) { return me.role === "seller" ? sellerCard(me.card) : buyerCard(me.card); }
  function roleLine(me) { return me.role === "seller" ? "Start-up" : "Buyer"; }

  // ---------- a round, for a start-up ----------
  function sellerRound(st) {
    var me = st.me, c = me.card, g = st.game, rule = E.roundRule(cfg, g.round), d = st.mine;
    var rec = E.record(me.id, st.closed, E.closedRounds(g));
    var html = '<div class="card note"><p><b>Round ' + g.round + ": " + esc(word(g.round).title) + ".</b> " + esc(word(g.round).seller) + "</p></div>";
    html += d ? '<div class="banner done" style="margin:0 0 14px;border-radius:14px">Signed this round: ' + (d.kind === "pilot" ? "a pilot" : "the full deal") + ". " + pts(E.sellerRound(d, cfg)) + ".</div>"
              : '<div class="card"><p><b>Nobody has signed you yet this round.</b> Find a buyer and pitch.</p></div>';
    html += codeCard(c);
    if (rule.proof) {
      html += '<div class="card stack"><div class="label">What a buyer sees when they type your code</div>' +
        (c.proof ? '<div class="check ok">✓ Proof on file: a reference customer</div>' : '<div class="check no">No proof on file</div>') +
        (rule.record ? (rec.delivered.length ? '<div class="check ok">✓ Delivered in ' + rec.delivered.length + (rec.delivered.length === 1 ? " earlier round" : " earlier rounds") + "</div>" : "") +
          (rec.failed.length ? '<div class="check no">✗ Failed to deliver in ' + rec.failed.length + (rec.failed.length === 1 ? " earlier round" : " earlier rounds") + "</div>" : "") +
          (!rec.delivered.length && !rec.failed.length ? '<div class="check">No record yet</div>' : "") : "") + "</div>";
    }
    return html + secretCard(c) + history(st);
  }

  // ---------- a round, for a buyer ----------
  function knownList(st) {
    var c = st.me.card;
    if (!c.knows || !c.knows.length) return "";
    return '<div class="card conn stack"><div class="label">People you know</div>' + c.knows.map(function (k) {
      var s = sellerById(st, k.id);
      return '<div class="row"><div><b>' + esc(k.name) + '</b><div class="muted">' + esc(k.org) + "</div></div>" +
        '<span class="chip ' + (k.ready ? "good" : "bad") + '">' + (k.ready ? "Their product works" : "Not ready. Stay away") + "</span></div>" +
        (s && s.is_bot && !s.busy && !st.mine && st.game.phase === "open" ? '<button class="btn small" data-act="look" data-id="' + esc(s.code) + '">Look at ' + esc(k.org) + "</button>" : "");
    }).join("") + "</div>";
  }
  // Simulated start-ups cannot be talked to, so a buyer may tap them (demo mode only).
  function botList(st) {
    var botsOnly = st.sellers.filter(function (s) { return s.is_bot; });
    if (!botsOnly.length) return "";
    var rule = E.roundRule(cfg, st.game.round);
    return '<div class="label" style="margin:18px 0 8px">Simulated start-ups (tap one to look)</div>' + botsOnly.map(function (s) {
      return '<button class="option' + (s.busy ? " cant" : "") + '" data-act="look" data-id="' + esc(s.code) + '"' + (s.busy ? " disabled" : "") + '><span style="flex:1"><b>' + esc(s.org) +
        '</b><br><span class="muted">' + esc(s.name) + " · " + esc(s.tagline) + "</span></span>" +
        (s.busy ? '<span class="chip grey">Signed</span>' : rule.proof && s.proof ? '<span class="chip good">Proof</span>' : "") + "</button>";
    }).join("");
  }
  function buyerRound(st) {
    var me = st.me, c = me.card, g = st.game, rule = E.roundRule(cfg, g.round), d = st.mine, html = "";
    html += '<div class="card note"><p><b>Round ' + g.round + ": " + esc(word(g.round).title) + ".</b> " + esc(word(g.round).buyer) + "</p></div>";
    if (d) {
      var s = d.seller_id ? sellerById(st, d.seller_id) : null;
      html += '<div class="banner done" style="margin:0 0 14px;border-radius:14px">' +
        (d.kind === "stay" ? "You stayed with " + esc(c.incumbent) + " this round." : "You signed " + kindName(d.kind) + " with " + esc(s ? s.org : "a start-up") + ".") + " Wait for the reveal.</div>";
    } else {
      html += '<div class="card stack"><div class="label">Sign a start-up</div><p>Type the deal code the start-up tells you.</p>' +
        '<input class="field deskinput num" id="codeInput" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="--" value="' + esc(S.typed) + '">' +
        '<button class="btn primary block" data-act="lookup"' + (S.busy ? " disabled" : "") + ">Look at this start-up</button>" + payoffTable(rule, c.incumbent) + "</div>";
    }
    if (rule.intros) html += knownList(st);
    if (!d) html += botList(st);
    html += history(st);
    // The Stay button is pinned to the bottom of the screen; the spacer keeps it from covering the end of the page.
    if (!d) html += '<div style="height:84px"></div><div class="sticky-bottom"><button class="btn block" data-act="stay-open">Stay this round · ' + pts(P.stay) + "</button></div>";
    return html;
  }

  // ---------- after a round ----------
  function nextNote(st) {
    var g = st.game, n = g.round + 1;
    if (g.phase !== "reveal" || n > g.rounds) return "";
    return '<div class="card note stack"><div class="label">Next: round ' + n + '</div><div class="bigname">' + esc(word(n).title) + "</div><p>" + esc(word(n).new) + "</p></div>";
  }
  function result(st) {
    var me = st.me, g = st.game, r = g.round, d = E.rowOf(me, st.closed, r), n, head, text, bad = false;
    if (me.role === "buyer") {
      n = E.buyerRound(d, cfg);
      var s = d && d.seller_id ? sellerById(st, d.seller_id) : null, who = esc(s ? s.org : "The start-up");
      if (!d || d.kind === "stay") { head = "You stayed."; text = (d ? "" : "You did not decide, so nothing changed. ") + "Safe, and nothing gained."; }
      else if (d.delivered) { head = who + " delivered."; text = d.kind === "pilot" ? "The pilot worked. A full deal would have been worth " + pts(P.fullWin) + "." : "You took the risk and it paid."; }
      else { bad = true; head = who + " failed."; text = d.kind === "pilot" ? "It was never ready. But it was only a pilot: a full deal would have cost you " + pts(P.fullLose) + "." : "It was never ready. You signed it, so you answer for it."; }
    } else {
      n = E.sellerRound(d, cfg);
      if (!d) { head = "Nobody signed you."; text = "No deal this round."; }
      else if (d.delivered) { head = "You were signed, and you delivered."; text = d.kind === "pilot" ? "A pilot: the door is open. A full deal is worth " + pts(P.sellerFull) + "." : "A full deal."; }
      else { bad = true; head = "You got the deal. Then you failed."; text = "Your product was not ready. Your buyer lost " + Math.abs(d.kind === "pilot" ? P.pilotLose : P.fullLose) + (Math.abs(d.kind === "pilot" ? P.pilotLose : P.fullLose) === 1 ? " point" : " points") + ", and the room will see it."; }
    }
    var sc = total(st);
    return '<div class="card stack" style="text-align:center"><div class="label">Round ' + r + " of " + g.rounds + '</div><div class="bigname"' + (bad ? ' style="color:var(--bad)"' : "") + ">" + head + "</div>" +
      '<div class="points num"' + (n < 0 ? ' style="color:var(--bad)"' : "") + ">" + pts(n) + "</div><p>" + text + "</p>" +
      '<div class="row" style="margin-top:8px"><span class="label">Your total</span><span class="bigname num">' + pts(sc.total) + "</span></div></div>";
  }
  function finalNote(st) {
    var me = st.me, sc = total(st);
    return '<div class="card note" style="text-align:center"><div class="bigname">Final score: ' + pts(sc.total) + "</div><p>" +
      (me.role === "buyer" ? "A buyer who stayed every round has " + pts(st.game.rounds * P.stay) + "." : me.card.ready ? "Your product worked all along." : "Your product was never ready.") +
      " Eyes on the big screen.</p></div>";
  }

  // ---------- page ----------
  function view() {
    var st = S.st;
    if (!S.code || st === null) {
      return '<div class="hero"><div class="label">' + esc(cfg.subtitle) + "</div><h1>" + esc(cfg.title) + "</h1><p class=\"muted\">" +
        (st === null ? "Game " + esc(S.code) + " was not found. Check the code on the big screen." : "Enter the game code from the big screen.") + "</p></div>" +
        '<div class="stack"><input class="field" id="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="Code" value="">' +
        '<button class="btn primary block" data-act="setcode">Continue</button></div>';
    }
    if (st === undefined) return '<div class="hero"><p class="muted">Connecting…</p></div>';
    var g = st.game, me = st.me;
    if (!me) {
      if (g.phase === "locked") return '<div class="hero"><h1>This game has finished.</h1><p class="muted">Watch the big screen for the results.</p></div>';
      return '<div class="hero-art"><img src="art/hero-s.jpg" alt=""></div><div class="hero"><div class="label">' + esc(cfg.subtitle) + "</div><h1>" + esc(cfg.title) + '</h1><p class="muted">Enter your name to join. No account needed.</p></div>' +
        '<div class="stack"><input class="field" id="name" maxlength="24" autocomplete="given-name" placeholder="Your first name" value="' + esc(store.getItem("b2bsim.name") || "") + '">' +
        '<button class="btn primary block" data-act="join"' + (S.busy ? " disabled" : "") + ">Join the game</button></div>";
    }
    if (!me.role) {
      return '<div class="hero-art"><img src="art/hero-s.jpg" alt=""></div><div class="hero"><div class="label">You are in</div><h1>' + esc(me.name) + '</h1><p class="muted">' +
        (g.phase === "lobby" ? st.n_players + " joined so far. Keep this page open: your role appears when the host starts." : "Getting your role…") + "</p></div>";
    }
    if (g.phase === "lobby" || g.phase === "briefing") {
      return header(roleLine(me), me.card.org, g.phase === "briefing" ? "Round 1 starts in" : "") +
        '<div class="banner paused">Read your card. Then stand up: round 1 starts soon.</div>' + roleCard(me);
    }
    if (g.phase === "locked") return header(roleLine(me), me.card.org, "") + result(st) + finalNote(st) + history(st);
    if (g.phase === "reveal") {
      return header(roleLine(me), me.card.org, g.ends_at ? "Next round in" : "") + result(st) + nextNote(st) + history(st);
    }
    // a round is open
    var tabs = [["main", "Round " + g.round + " of " + g.rounds], ["card", "My card"]];
    var tab = S.tab === "card" ? "card" : "main";
    return header(roleLine(me), me.card.org, "Round ends in") +
      '<div class="tabs">' + tabs.map(function (t) {
        return '<button class="btn' + (tab === t[0] ? " on" : "") + '" data-act="tab" data-id="' + t[0] + '">' + esc(t[1]) + "</button>";
      }).join("") + "</div>" + (tab === "card" ? roleCard(me) : me.role === "seller" ? sellerRound(st) : buyerRound(st));
  }

  function render(force) {
    var st = S.st;
    var key = JSON.stringify([st ? [st.game, st.me, st.mine, st.closed, st.sellers, st.n_players] : st, S.tab, S.busy, S.code]);
    if (!force && key === S.key) return;
    // Do not wipe a text field the player is typing in.
    var active = document.activeElement;
    if (!force && active && (active.id === "name" || active.id === "code" || active.id === "codeInput")) { S.key = ""; return; }
    S.key = key;
    app.innerHTML = view();
  }

  // ---------- sheets ----------
  function renderSheet() {
    var sh = S.sheet, st = S.st;
    if (!sh || !st || !st.me) { sheetEl.__html = sheetEl.innerHTML = ""; return; }
    var me = st.me, g = st.game, rule = E.roundRule(cfg, g.round), html = "";
    if (sh.type === "sign") {
      var s = st.sellers.filter(function (x) { return x.code === sh.code; })[0];
      if (!s) { S.sheet = null; sheetEl.__html = sheetEl.innerHTML = ""; return; }
      var done = E.closedRounds(g), rec = E.record(s.id, st.closed, done);
      var own = st.closed.filter(function (d) { return d.buyer_id === me.id && d.seller_id === s.id; });
      var k = (me.card.knows || []).filter(function (x) { return x.id === s.id; })[0];
      html = '<div class="label">Deal code ' + esc(s.code) + '</div><div class="bigname">' + esc(s.org) + '</div><div class="muted">' + esc(s.name) + " · " + esc(s.tagline) + '</div><div class="stack" style="margin-top:14px">' +
        (s.busy ? '<div class="check no">Already signed by another buyer this round.</div>' : "") +
        own.map(function (d) { return '<div class="check ' + (d.delivered ? "ok" : "no") + '">' + (d.delivered ? "✓ Delivered for you" : "✗ Failed you") + " in round " + d.round + "</div>"; }).join("") +
        (rule.intros && k ? '<div class="check ' + (k.ready ? "ok" : "no") + '">' + (k.ready ? "✓ You know them: their product works" : "✗ You know them: their product is not ready") + "</div>" : "") +
        (rule.proof ? '<div class="check ' + (s.proof ? "ok" : "") + '">' + (s.proof ? "✓ Proof on file: a reference customer" : "No proof on file") + "</div>" : "") +
        (rule.record ? (rec.delivered.length ? '<div class="check ok">✓ Delivered in ' + rec.delivered.length + (rec.delivered.length === 1 ? " earlier round" : " earlier rounds") + "</div>" : "") +
          (rec.failed.length ? '<div class="check no">✗ Failed to deliver in ' + rec.failed.length + (rec.failed.length === 1 ? " earlier round" : " earlier rounds") + "</div>" : "") +
          (!rec.delivered.length && !rec.failed.length ? '<div class="check">No record: nobody has signed them yet</div>' : "") : "") +
        (!rule.proof ? '<p class="muted">This round you have only their word.</p>' : "") + "</div>" +
        '<div class="stack" style="margin-top:16px">' +
        '<button class="btn good block" data-act="sign" data-id="full"' + (S.busy || s.busy ? " disabled" : "") + ">Sign the full deal · " + pts(P.fullWin) + " or " + pts(P.fullLose) + "</button>" +
        (rule.pilot ? '<button class="btn primary block" data-act="sign" data-id="pilot"' + (S.busy || s.busy ? " disabled" : "") + ">Sign a pilot · " + pts(P.pilotWin) + " or " + pts(P.pilotLose) + "</button>" : "") +
        '<button class="btn block" data-act="sheet-close">Go back</button><p class="muted" style="text-align:center">This is your one decision for the round.</p></div>';
    } else if (sh.type === "stay") {
      html = '<div class="label">Your decision for round ' + g.round + '</div><div class="bigname">Stay with ' + esc(me.card.incumbent) + "?</div>" +
        '<p style="margin-top:8px">A safe ' + pts(P.stay) + ". You cannot sign a start-up this round after this.</p>" +
        '<div class="stack" style="margin-top:16px"><button class="btn primary block" data-act="stay"' + (S.busy ? " disabled" : "") + ">Yes, stay this round</button>" +
        '<button class="btn block" data-act="sheet-close">Go back</button></div>';
    }
    // Only touch the page when something changed, so a tap is never lost to a redraw.
    var out = '<div class="panel">' + html + "</div>";
    if (sheetEl.__html !== out) { sheetEl.__html = out; sheetEl.innerHTML = out; }
  }
  function openSheet(sh) { S.sheet = sh; renderSheet(); }
  function closeSheet() { S.sheet = null; sheetEl.__html = sheetEl.innerHTML = ""; }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; }, 3500);
  }

  // Run a player action, then refresh.
  function act(promiseFn, after, keepOnError) {
    if (S.busy) return;
    S.busy = true; render(true); renderSheet();
    promiseFn().then(function (r) { if (after) after(r); return true; }, function (e) { toast(B2B.errorText(e)); return false; })
      .then(function (ok) {
        S.busy = false;
        if (ok || !keepOnError) closeSheet(); else renderSheet();
        render(true); refresh();
      });
  }
  function lookUp(code) {
    var st = S.st;
    if (!/^\d{2}$/.test(code || "")) return toast("A deal code has 2 digits. Ask the start-up for it.");
    if (!st.sellers.some(function (s) { return s.code === code; })) return toast(B2B.errorText({ code: "bad_code" }));
    openSheet({ type: "sign", code: code });
  }

  // ---------- events ----------
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var a = el.getAttribute("data-act"), id = el.getAttribute("data-id"), sh = S.sheet;
    if (a === "setcode") {
      var code = (document.getElementById("code").value || "").toUpperCase().replace(/[^A-Z]/g, "");
      if (code.length !== 4) return toast("The code has 4 letters.");
      setCode(code); S.st = undefined; render(true); refresh();
    } else if (a === "join") {
      var name = (document.getElementById("name").value || "").trim();
      if (!name) return toast("Please enter your name.");
      store.setItem("b2bsim.name", name);
      act(function () { return api.join(S.code, name, S.token, false); });
    } else if (a === "tab") {
      S.tab = id; render(true); window.scrollTo(0, 0);
    } else if (a === "sheet-close") {
      closeSheet();
    } else if (a === "lookup") {
      lookUp(S.typed);
    } else if (a === "look") {
      lookUp(id);
    } else if (a === "sign") {
      act(function () { return api.sign(S.code, S.token, sh.code, id); }, function () { S.typed = ""; toast("Signed. Wait for the reveal."); }, true);
    } else if (a === "stay-open") {
      openSheet({ type: "stay" });
    } else if (a === "stay") {
      act(function () { return api.sign(S.code, S.token, null, "stay"); }, function () { S.typed = ""; });
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target.id !== "codeInput") return;
    S.typed = ev.target.value = ev.target.value.replace(/\D/g, "").slice(0, 2);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var btn = ev.target.id === "name" ? '[data-act="join"]' : ev.target.id === "code" ? '[data-act="setcode"]' : ev.target.id === "codeInput" ? '[data-act="lookup"]' : null;
    if (btn) { ev.target.blur(); document.querySelector(btn).click(); }
  });
  sheetEl.addEventListener("click", function (ev) { if (ev.target === sheetEl) closeSheet(); });

  // ---------- start ----------
  if (S.code) setCode(S.code);
  ui.loadJson("data/cards.json").then(function (cards) {
    S.cards = cards;
    render(true);
    ui.tickClocks(function () { return S.st && S.st.game; });
    refresh = ui.loop(function () {
      if (!S.code) return Promise.resolve();
      return api.state(S.code, S.token).then(function (st) {
        if (st) ui.syncClock(st.now);
        var before = S.st && S.st.game ? S.st.game.phase + S.st.game.round : "";
        S.st = st;
        // A sheet is only valid while a round is open; a new round starts with a clean screen.
        if (S.sheet && (!st || !st.me || st.game.phase !== "open")) closeSheet();
        if (st && st.game && before && before !== st.game.phase + st.game.round) {
          S.typed = ""; S.tab = "main"; window.scrollTo(0, 0);
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          render(true);
        }
        if (S.sheet && !S.busy) renderSheet();
        // Tell a start-up the moment a buyer signs it.
        if (st && st.me && st.me.role === "seller") {
          var id = st.mine ? st.mine.id : null;
          if (id && id !== S.signedBy) { toast("A buyer just signed you."); if (navigator.vibrate) navigator.vibrate(120); }
          S.signedBy = id;
        }
        render();
      });
    }, function () {
      var p = S.st && S.st.game && S.st.game.phase;
      if (B2B.mode === "local") return 700;
      return p === "open" || p === "briefing" || p === "reveal" ? cfg.pollMs.market : cfg.pollMs.idle;
    });
  }, function () {
    app.innerHTML = '<div class="hero"><h1>Could not load the game.</h1><p class="muted">Check your connection and reload.</p></div>';
  });
})();
