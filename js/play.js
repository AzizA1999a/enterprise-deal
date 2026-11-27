/* The player's phone. Everyone runs a start-up's marketing campaign to get inside one large company.
   Campaign tab: the four doors, this round's budget, and the moves (each with its cost and its chance).
   Network tab: the player's code, the person they know, and introductions given and received. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, E = B2B.engine, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store;
  var esc = ui.esc, P = cfg.points;
  var app = document.getElementById("app"), sheetEl = document.getElementById("sheet"), toastEl = document.getElementById("toast");

  var S = { code: "", token: "", st: undefined, cards: null, tab: "main", busy: false, key: "", typed: "", last: null, seenIntros: null };
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
  function giant(id) { return (S.cards.giants || []).filter(function (g) { return g.id === id; })[0] || { id: id, name: id, need: "", people: [] }; }
  function person(id, door) { return giant(id).people[door] || { name: "", title: "" }; }
  function doorName(d) { return S.cards.doors[d] || "Door " + (d + 1); }
  function msg(k) { return S.cards.messages[k] || k; }
  function moveText(k) { return S.cards.moves[k] || { title: k, sub: "" }; }
  function ordinal(n) { return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th"; }
  function dots(n, total) { return "●".repeat(Math.max(0, n)) + "○".repeat(Math.max(0, total - n)); }
  function header(sub, title, clockLabel) {
    return '<header class="top"><div class="row"><div><div class="label">' + esc(sub) + "</div><h1>" + esc(title) + "</h1></div>" +
      (clockLabel ? '<div style="text-align:right"><div class="label">' + esc(clockLabel) + '</div><div class="clock num" data-clock></div></div>' : "") +
      "</div></header>";
  }
  function doorsRow(st, big) {
    var s = st.me.state, people = giant(s.giant).people;
    return '<div class="doors' + (big ? " big" : "") + '">' + [0, 1, 2, 3].map(function (d) {
      var cls = d < s.progress ? " open" : d === s.progress ? " now" : "";
      return '<div class="door' + cls + '"><div class="k">' + (d < s.progress ? "✓" : d + 1) + '</div><div class="t">' + esc(doorName(d)) + "</div>" +
        (big && people[d] ? '<div class="w">' + esc(people[d].name) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function myScore(st) {
    var s = st.me.state, R = st.game.rules, parts = [];
    if (s.progress) parts.push({ label: s.progress + (s.progress === 1 ? " door opened" : " doors opened"), value: s.progress * P.door });
    if (s.rank != null) parts.push(s.rank <= R.slots ? { label: "Signed, among the first " + R.slots, value: P.win } : { label: "Got the signature, but too late", value: P.late });
    var helped = {};
    st.given.forEach(function (i) { if (i.to_signed) helped[i.to_id] = true; });
    var n = Object.keys(helped).length;
    if (n) parts.push({ label: n + (n === 1 ? " start-up you introduced signed" : " start-ups you introduced signed"), value: n * P.vouch });
    return { total: parts.reduce(function (a, x) { return a + x.value; }, 0), parts: parts };
  }

  // ---------- choosing a target ----------
  function targetView(st, locked) {
    var me = st.me, s = me.state, c = me.card, R = st.game.rules, html = "";
    html += '<div class="card stack"><div class="label">Your start-up</div><div class="bigname">' + esc(c.org) + "</div><p>" + esc(c.tagline) + "</p></div>";
    html += '<div class="label" style="margin:16px 0 8px">1 · Which company will you go after?</div>';
    R.giants.forEach(function (id) {
      var g = giant(id), t = st.giants[id] || { taken: 0 }, on = s.giant === id, knows = c.contact.giant === id;
      html += '<button class="option tall' + (on ? " on" : "") + '" data-act="giant" data-id="' + esc(id) + '"' + (locked && !on ? " disabled" : "") + '><span class="box">' + (on ? "✓" : "") + '</span><span style="flex:1"><b>' + esc(g.name) +
        '</b><br><span class="muted">' + esc(g.need) + "</span>" +
        (knows ? '<br><span class="chip conn" style="margin-top:6px">You know ' + esc(c.contact.name) + ", " + esc(c.contact.title) + "</span>" : "") +
        '<br><span class="muted num" style="font-size:0.85em">' + t.taken + (t.taken === 1 ? " start-up is" : " start-ups are") + " going after it · it signs the first " + R.slots + "</span></span></button>";
    });
    if (locked) html += '<p class="muted">You have started on ' + esc(giant(s.giant).name) + ", so you cannot switch now.</p>";
    html += '<div class="label" style="margin:18px 0 8px">2 · What will you lead with?</div><div class="stack">' + E.MESSAGES.map(function (k) {
      return '<button class="option' + (s.message === k ? " on" : "") + '" data-act="message" data-id="' + k + '"><span class="box">' + (s.message === k ? "✓" : "") + "</span><span><b>" + esc(msg(k)) + "</b></span></button>";
    }).join("") + "</div>";
    html += '<p class="muted" style="margin-top:8px">Each company cares most about one of these. The right one helps with the manager and the executive; the wrong one hurts.' +
      (s.giant && c.contact.giant === s.giant ? " <b>" + esc(c.contact.name) + " told you: " + esc(giant(s.giant).name) + " cares most about “" + esc(msg(c.hint)) + "”.</b>" : " You can research it once the rounds start, or ask a classmate who knows someone there.") + "</p>";
    return html;
  }

  // ---------- the campaign ----------
  function fitLine(st) {
    var s = st.me.state, g = giant(s.giant);
    if (!s.message) return '<div class="check no">You have not picked a message yet. Tap Target.</div>';
    if (st.priority == null) return '<div class="check">Your message: “' + esc(msg(s.message)) + "”. You do not know yet whether " + esc(g.name) + " cares.</div>";
    return st.priority === s.message ? '<div class="check ok">✓ Your message, “' + esc(msg(s.message)) + "”, is what " + esc(g.name) + " cares about most.</div>"
      : '<div class="check no">✗ ' + esc(g.name) + " cares most about “" + esc(msg(st.priority)) + "”, not “" + esc(msg(s.message)) + '”. <button class="btn small" data-act="message" data-id="' + esc(st.priority) + '">Switch</button></div>';
  }
  function moveButton(st, key, opts) {
    var s = st.me.state, R = st.game.rules, def = R.moves[key], t = moveText(key), door = s.progress, left = E.budgetLeft(R, s, st.game.round);
    opts = opts || {};
    var once = (key === "content" && s.aware) || (key === "research" && (s.researched || st.priority != null));
    var off = S.busy || st.game.phase !== "open" || def.cost > left || once;
    var chance;
    if (key === "content") chance = s.aware ? "done" : "+" + R.awareBoost + "%";
    else if (key === "research") chance = once ? "known" : "info";
    else if (st.priority != null || key === "intro" || R.fitDoors.indexOf(door) < 0 || !s.message) chance = E.odds(R, key, door, s, st.priority) + "%";
    else chance = E.baseOdds(R, key, door, s.aware) + "%<small> ±" + R.fit + "</small>";
    return '<button class="mv' + (opts.strong ? " strong" : "") + '" data-act="move" data-id="' + key + '"' + (opts.intro ? ' data-intro="' + esc(opts.intro) + '"' : "") + (off ? " disabled" : "") + '><span class="tx"><b>' +
      esc(opts.title || t.title) + '</b><br><span class="muted">' + esc(opts.sub || (key === "content" ? "Every later move is " + R.awareBoost + "% more likely to work" : t.sub)) + '</span></span><span class="od num">' + chance +
      '<br><span class="muted">costs ' + def.cost + "</span></span></button>";
  }
  function campaign(st) {
    var me = st.me, s = me.state, c = me.card, R = st.game.rules, g = st.game, G = giant(s.giant), html = "";
    if (!s.giant) return '<div class="banner paused" style="margin:0 0 14px;border-radius:14px">Choose your target first.</div>' + targetView(st, false);
    var done = s.progress >= E.DOORS, who = person(s.giant, s.progress), left = E.budgetLeft(R, s, g.round);
    html += '<div class="card stack"><div class="row"><div><div class="label">Your target</div><div class="bigname">' + esc(G.name) + "</div></div>" +
      '<div style="text-align:right"><div class="label">Budget this round</div><div class="dots bigname" aria-label="' + left + " of " + R.budget + '">' + dots(left, R.budget) + "</div></div></div>" + doorsRow(st, true) +
      (done ? "" : '<p>Now: <b>' + esc(who.name) + "</b>, " + esc(who.title) + ". " + (s.progress === 0 ? "Nobody inside knows you yet." : "") + "</p>") + "</div>";
    if (done) {
      html += '<div class="banner done" style="margin:0 0 14px;border-radius:14px">' + (s.rank <= R.slots ? "Signed. You are the " + ordinal(s.rank) + " start-up into " + esc(G.name) + "." : "You got the signature, but " + esc(G.name) + " had already signed " + R.slots + " start-ups.") + "</div>";
    } else {
      if (S.last) html += '<div class="card result ' + (S.last.good ? "ok" : S.last.good === false ? "no" : "") + '"><p>' + S.last.text + "</p></div>";
      html += fitLine(st);
      html += '<div class="label" style="margin:16px 0 8px">Your moves</div>';
      // introductions for this door
      var mine = st.intros.filter(function (i) { return !i.used && i.giant === s.giant && i.door === s.progress; });
      var own = c.contact.giant === s.giant && c.contact.door === s.progress && !s.self_used;
      if (own) html += moveButton(st, "intro", { intro: "self", strong: true, title: "Call " + c.contact.name, sub: "You know them yourself" });
      mine.forEach(function (i) { html += moveButton(st, "intro", { intro: i.id, strong: true, title: "Use " + i.from_name + "’s introduction", sub: i.from_name + " vouched for you with " + who.name }); });
      if (!own && !mine.length) {
        html += '<div class="card hint"><p><b>No introduction for this door.</b> Find a classmate who knows ' + esc(who.name) + ", " + esc(who.title) + " at " + esc(G.name) + ", and give them your code <span class=\"deskpill num\">" + esc(c.code) + "</span></p></div>";
      }
      ["content", "research", "proof", "pilot", "partner", "cold"].forEach(function (k) { if (R.moves[k]) html += moveButton(st, k); });
      if (!left && g.phase === "open") html += '<p class="muted" style="text-align:center">Budget spent. While you wait: who in the room could introduce you to the next person?</p>';
    }
    var hist = st.moves.filter(function (m) { return m.round === g.round; });
    if (hist.length) {
      html += '<div class="card stack"><div class="label">This round</div><table class="breakdown">' + hist.map(function (m) {
        return "<tr><td>" + esc(moveText(m.move).title) + (m.success == null ? "" : " · " + esc(doorName(m.door))) + '</td><td class="num">' +
          (m.success == null ? "done" : m.success ? '<span class="good">opened</span>' : '<span class="bad">no</span>') + "</td></tr>";
      }).join("") + "</table></div>";
    }
    return html;
  }

  // ---------- the network ----------
  function network(st) {
    var me = st.me, s = me.state, c = me.card, R = st.game.rules, k = c.contact, left = R.vouches - s.vouched, html = "";
    html += '<div class="badge seller"><div class="strip">Your code</div><div class="desk" style="border:0;margin:6px 14px"><div class="d num">' + esc(c.code) +
      '</div><div class="muted">A classmate types this to introduce you to the person they know.</div></div></div>';
    html += '<div class="card conn stack"><div class="label">The person you know</div><div class="bigname">' + esc(k.name) + '</div><div class="muted">' + esc(k.title) + " at " + esc(k.giantName) +
      "</div><p>They are the <b>" + esc(doorName(k.door).toLowerCase()) + "</b> door at " + esc(k.giantName) + ". They also told you what the company cares about most: <b>“" + esc(msg(c.hint)) + "”</b>.</p>" +
      "<p>You can introduce <b>" + left + (left === 1 ? " more start-up" : " more start-ups") + "</b>. Choose well: you score " + pts(P.vouch) + " for each one that goes on to sign.</p>" +
      (left > 0 && st.game.phase !== "locked" ? '<div class="inline"><input class="field deskinput num" id="vouchInput" style="font-size:1.6em;width:110px" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="--" value="' + esc(S.typed) + '">' +
        '<button class="btn primary" data-act="vouch"' + (S.busy ? " disabled" : "") + ">Introduce them</button></div>" : "") + "</div>";
    if (st.given.length) {
      html += '<div class="card stack"><div class="label">You introduced</div>' + st.given.map(function (i) {
        return '<div class="row"><span><b>' + esc(i.to_name) + '</b> <span class="muted">' + esc(i.to_org) + "</span></span>" +
          '<span class="chip ' + (i.to_signed ? "good" : i.used ? "plain" : "grey") + '">' + (i.to_signed ? "Signed" : i.used ? "Used it" : "Not used yet") + "</span></div>";
      }).join("") + "</div>";
    }
    if (st.intros.length) {
      html += '<div class="card stack"><div class="label">Introductions you received</div>' + st.intros.map(function (i) {
        var w = person(i.giant, i.door), usable = !i.used && i.giant === s.giant;
        return '<div class="row"><span><b>' + esc(i.from_name) + '</b> <span class="muted">to ' + esc(w.name) + ", " + esc(doorName(i.door).toLowerCase()) + " at " + esc(giant(i.giant).name) + "</span></span>" +
          '<span class="chip ' + (i.used ? "grey" : usable ? "good" : "bad") + '">' + (i.used ? "Used" : usable ? (i.door === s.progress ? "Ready" : i.door > s.progress ? "For later" : "Too late") : "Wrong company") + "</span></div>";
      }).join("") + "</div>";
    }
    return html;
  }

  // ---------- after a round, and at the end ----------
  function roundDone(st) {
    var s = st.me.state, g = st.game, G = giant(s.giant), sc = myScore(st);
    var hist = st.moves.filter(function (m) { return m.round === g.round; }), opened = hist.filter(function (m) { return m.success; }).length;
    var final = g.phase === "locked", head, text;
    if (!s.giant) { head = "You never chose a target."; text = "A campaign with no target reaches nobody."; }
    else if (s.rank != null && s.rank <= st.game.rules.slots) { head = "You landed " + G.name + "."; text = "You were the " + ordinal(s.rank) + " start-up to get the signature."; }
    else if (s.rank != null) { head = "Signed, but too late."; text = G.name + " had already signed " + st.game.rules.slots + " start-ups before you."; }
    else if (final) { head = "You reached " + (s.progress === 0 ? "nobody" : doorName(s.progress - 1).toLowerCase() + "’s yes") + "."; text = s.progress === 0 ? "Nobody inside " + G.name + " ever answered." : "The next door, " + doorName(s.progress).toLowerCase() + ", stayed shut."; }
    else { head = opened ? opened + (opened === 1 ? " door opened" : " doors opened") + " this round." : "No door opened this round."; text = "Next: " + person(s.giant, s.progress).name + ", " + person(s.giant, s.progress).title + "."; }
    var html = '<div class="card stack" style="text-align:center"><div class="label">' + (final ? "Final result" : "Round " + g.round + " of " + g.rounds) + '</div><div class="bigname">' + esc(head) + "</div>" +
      (s.giant ? doorsRow(st, false) : "") + "<p>" + esc(text) + "</p>" +
      '<div class="points num">' + sc.total + '</div><div class="label">points</div>' +
      (sc.parts.length ? '<table class="breakdown">' + sc.parts.map(function (p) { return "<tr><td>" + esc(p.label) + '</td><td class="num">' + pts(p.value) + "</td></tr>"; }).join("") + "</table>" : "") + "</div>";
    if (final) html += '<div class="card note" style="text-align:center"><div class="bigname">Eyes on the big screen.</div><p>Which moves opened which doors in this room?</p></div>';
    return html;
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
    // A game started from an out-of-date host page: say so, whether or not this player was given a role in it.
    if (E.stale(g) || (me.role && !me.state)) {
      return '<div class="hero"><div class="label">One moment</div><h1>This game needs a restart.</h1><p class="muted">It was started from an out-of-date host page. ' +
        "Ask the host to reload their page and press Reset game. Then scan the code again.</p></div>";
    }
    if (!me.role) {
      return '<div class="hero-art"><img src="art/hero-s.jpg" alt=""></div><div class="hero"><div class="label">You are in</div><h1>' + esc(me.name) + '</h1><p class="muted">' +
        (g.phase === "lobby" ? st.n_players + " joined so far. Keep this page open: your start-up appears when the host starts." : "Getting your start-up…") + "</p></div>";
    }
    var s = me.state, started = st.moves.length > 0;
    if (g.phase === "locked") return header("Start-up", me.card.org, "") + roundDone(st);
    var tabs = [["main", g.phase === "briefing" ? "Target" : g.phase === "reveal" ? "Result" : "Campaign"], ["net", "Network"]];
    if (g.phase !== "briefing" && s.giant) tabs.push(["target", "Target"]);
    var tab = tabs.some(function (t) { return t[0] === S.tab; }) ? S.tab : "main";
    var body = tab === "net" ? network(st) : tab === "target" ? targetView(st, started) :
      g.phase === "briefing" ? '<div class="banner paused" style="margin:0 0 14px;border-radius:14px">' + (s.giant && s.message ? "Ready. You can still change your mind until round 1 starts." : "Choose a company and a message before round 1.") + "</div>" + targetView(st, false) :
      g.phase === "reveal" ? roundDone(st) : campaign(st);
    return header("Start-up", me.card.org, g.phase === "briefing" ? "Round 1 starts in" : g.phase === "reveal" ? (g.ends_at ? "Next round in" : "") : "Round " + g.round + " of " + g.rounds) +
      '<div class="tabs">' + tabs.map(function (t) {
        return '<button class="btn' + (tab === t[0] ? " on" : "") + '" data-act="tab" data-id="' + t[0] + '">' + esc(t[1]) + "</button>";
      }).join("") + "</div>" + body;
  }

  function render(force) {
    var st = S.st;
    var key = JSON.stringify([st ? [st.game, st.me, st.intros, st.given, st.giants, st.moves.length, st.priority, st.n_players] : st, S.tab, S.busy, S.code, S.last]);
    if (!force && key === S.key) return;
    // Do not wipe a text field the player is typing in.
    var active = document.activeElement;
    if (!force && active && (active.id === "name" || active.id === "code" || active.id === "vouchInput")) { S.key = ""; return; }
    S.key = key;
    var y = window.scrollY;
    app.innerHTML = view();
    window.scrollTo(0, y);
  }

  var toastTimer = null;
  function toast(msgText) {
    toastEl.textContent = msgText;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; }, 3500);
  }

  // Run a player action, then refresh.
  function act(promiseFn, after) {
    if (S.busy) return;
    S.busy = true; render(true);
    promiseFn().then(function (r) { if (after) after(r); return true; }, function (e) { toast(B2B.errorText(e)); return false; })
      .then(function () { S.busy = false; render(true); refresh(); });
  }
  // Say what a move did, in words.
  function report(r, key, st) {
    var s = st.me.state, G = giant(s.giant), t = moveText(key).title;
    if (key === "content") return { good: true, text: "<b>Published.</b> People inside " + esc(G.name) + " have now heard of you: every move is " + st.game.rules.awareBoost + "% more likely to work." };
    if (key === "research") return { good: true, text: "<b>Research done.</b> You now know what " + esc(G.name) + " cares about most." };
    var who = person(s.giant, r.door);
    if (!r.success) return { good: false, text: "<b>" + esc(t) + " did not work.</b> " + esc(who.name) + " did not say yes. It had a " + r.odds + "% chance." };
    if (r.rank != null) return { good: true, text: "<b>Signed.</b> " + esc(who.name) + " said yes. You are the " + ordinal(r.rank) + " start-up into " + esc(G.name) + "." };
    var next = person(s.giant, r.progress);
    return { good: true, text: "<b>" + esc(t) + " worked.</b> " + esc(who.name) + " said yes. Next door: " + esc(next.name) + ", " + esc(next.title) + "." };
  }

  // ---------- events ----------
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var a = el.getAttribute("data-act"), id = el.getAttribute("data-id"), st = S.st;
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
    } else if (a === "giant") {
      act(function () { return api.target(S.code, S.token, id, null); });
    } else if (a === "message") {
      act(function () { return api.target(S.code, S.token, null, id); });
    } else if (a === "move") {
      var intro = el.getAttribute("data-intro");
      act(function () { return api.move(S.code, S.token, id, intro || null); }, function (r) {
        S.last = report(r, id, st);
        if (navigator.vibrate) navigator.vibrate(r.success === false ? 40 : [60, 40, 60]);
      });
    } else if (a === "vouch") {
      var v = S.typed;
      if (!/^\d{2}$/.test(v || "")) return toast("A code has 2 digits. Ask them to show you their phone.");
      act(function () { return api.vouch(S.code, S.token, v); }, function (r) { S.typed = ""; toast("Done. " + (r.to_name || "They") + " can now use your introduction."); });
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target.id !== "vouchInput") return;
    S.typed = ev.target.value = ev.target.value.replace(/\D/g, "").slice(0, 2);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var btn = ev.target.id === "name" ? '[data-act="join"]' : ev.target.id === "code" ? '[data-act="setcode"]' : ev.target.id === "vouchInput" ? '[data-act="vouch"]' : null;
    if (btn) { ev.target.blur(); document.querySelector(btn).click(); }
  });

  // ---------- start ----------
  if (S.code) setCode(S.code);
  ui.loadJson("data/cards.json").then(function (cards) {
    S.cards = cards;
    render(true);
    ui.tickClocks(function () { return S.st && S.st.game; });
    ui.watchVersion(true);
    refresh = ui.loop(function () {
      if (!S.code) return Promise.resolve();
      return api.state(S.code, S.token).then(function (st) {
        if (st) ui.syncClock(st.now);
        var before = S.st && S.st.game ? S.st.game.phase + S.st.game.round : "";
        S.st = st;
        // A new round starts on the Campaign tab, with the last result cleared.
        if (st && st.game && before && before !== st.game.phase + st.game.round) {
          S.tab = "main"; if (st.game.phase === "open") S.last = null;
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          window.scrollTo(0, 0);
          render(true);
        }
        // Tell a player the moment a classmate introduces them.
        if (st && st.me && st.me.role) {
          var n = st.intros.length;
          if (S.seenIntros != null && n > S.seenIntros) {
            var i = st.intros[st.intros.length - 1];
            toast(i.from_name + " just introduced you to " + person(i.giant, i.door).name + ".");
            if (navigator.vibrate) navigator.vibrate(120);
          }
          S.seenIntros = n;
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
