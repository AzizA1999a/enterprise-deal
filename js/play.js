/* The player's phone. */
(function () {
  "use strict";
  var B2B = window.B2B, ui = B2B.ui, E = B2B.engine, api = B2B.api, cfg = window.B2B_CONFIG, store = B2B.store;
  var esc = ui.esc, money = ui.money;
  var app = document.getElementById("app"), sheetEl = document.getElementById("sheet"), toastEl = document.getElementById("toast");

  var S = { code: "", token: "", st: undefined, cards: null, tab: "main", sheet: null, busy: false, offline: false, key: "" };
  S.code = (ui.qs("g") || store.getItem("b2bsim.lastcode") || "").toUpperCase().replace(/[^A-Z]/g, "");
  var refresh = function () {};

  function setCode(code) {
    S.code = code;
    store.setItem("b2bsim.lastcode", code);
    S.token = store.getItem("b2bsim.token." + code);
    if (!S.token) { S.token = B2B.uid(); store.setItem("b2bsim.token." + code, S.token); }
  }

  // ---------- small view helpers ----------
  function label(map, key) { return esc((S.cards[map] || {})[key] || key); }
  function optLabel(list, key) {
    var o = (S.cards[list] || []).filter(function (x) { return x.key === key; })[0];
    return esc(o ? o.label : key);
  }
  function reliabilityText(r) { return "delivers about " + Math.round(r * 10) + " times in 10"; }
  function proofChips(list) {
    return (list || []).map(function (k) { return '<span class="chip">' + label("proofs", k) + "</span>"; }).join("");
  }
  function header(sub, title, clockLabel) {
    return '<header class="top"><div class="row"><div><div class="label">' + esc(sub) + "</div><h1>" + esc(title) + "</h1></div>" +
      (clockLabel ? '<div style="text-align:right"><div class="label">' + esc(clockLabel) + '</div><div class="clock num" data-clock></div></div>' : "") +
      "</div></header>";
  }
  function statusChip(o) {
    var s = o.status;
    if (s === "pending") return '<span class="chip plain">Waiting for an answer</span>';
    if (s === "accepted") return '<span class="chip good">Deal signed</span>';
    if (s === "rejected") return '<span class="chip bad">Rejected' + (o.reason ? ": " + optLabel("rejectReasons", o.reason) : "") + "</span>";
    if (s === "lost") return '<span class="chip grey">Lost: buyer signed another start-up</span>';
    if (s === "lost_incumbent") return '<span class="chip grey">Lost: buyer stayed with the incumbent</span>';
    return '<span class="chip grey">No answer before the close</span>';
  }
  function offerTerms(o) {
    return '<div class="chips">' + (o.pilot ? '<span class="chip good">Pilot included</span>' : "") + proofChips(o.proof) +
      (!o.pilot && !(o.proof || []).length ? '<span class="chip grey">No proof shown</span>' : "") + "</div>";
  }

  // ---------- role cards ----------
  function sellerCard(c) {
    var P = cfg.points;
    var conns = c.connections.map(function (k) {
      return '<div class="card conn"><span class="chip conn">' + label("relationships", k.type) + '</span><div class="bigname" style="margin-top:6px">' + esc(k.name) +
        '</div><div class="muted">Buyer at ' + esc(k.org) + '</div><p style="margin-top:8px">Hidden priority: <b>' + label("priorities", k.priority) +
        "</b></p><p>Boss's rule: <b>" + esc(k.constraint.text) + "</b></p></div>";
    }).join("");
    return '<div class="card stack"><div class="label">Your start-up</div><div class="bigname">' + esc(c.org) + "</div><p>" + esc(c.tagline) + "</p>" +
      '<div class="kv"><div><div class="label">List price</div><div class="v num">' + money(c.list) + '</div></div><div><div class="label">Floor (never below)</div><div class="v num">' + money(c.floor) + "</div></div></div>" +
      "<p>Deploys in <b>" + c.deployWeeks + " weeks</b>. Prices are per year.</p></div>" +
      '<div class="card stack"><div class="label">Your proof</div>' +
      (c.assets.length ? '<div class="chips">' + proofChips(c.assets) + "</div>" : "<p><b>None.</b> You are selling on a promise.</p>") + "</div>" +
      '<div class="card stack"><div class="label">People you know</div>' +
      (conns || "<p><b>Nobody.</b> You are selling cold: you cannot see any buyer's priority.</p>") + "</div>" +
      '<div class="card note stack"><div class="label">Rules</div><p>You can send <b>' + cfg.offersPerSeller + " offers</b> in the whole game. Talk first, then send.</p>" +
      '<p class="muted">Each delivered deal scores ' + P.sellerDeal + " points, plus up to " + P.sellerPriceHeld + " for keeping your price near list. A pilot costs you " + P.sellerPilotCost + ' points unless you are pilot-ready.</p></div>';
  }
  function buyerCard(c) {
    var P = cfg.points;
    var conns = c.connections.map(function (k) {
      return '<div class="card conn"><span class="chip conn">' + label("relationships", k.type) + '</span><div class="bigname" style="margin-top:6px">' + esc(k.name) +
        '</div><div class="muted">Seller at ' + esc(k.org) + "</div><p style=\"margin-top:8px\">You know the truth: " + esc(k.org) + " <b>" + reliabilityText(k.reliability) + "</b>.</p></div>";
    }).join("");
    return '<div class="card stack"><div class="label">You are the ' + esc(c.title) + ' at</div><div class="bigname">' + esc(c.org) + "</div><p>You need: " + esc(c.need) + "</p>" +
      '<div class="kv"><div><div class="label">Budget</div><div class="v num">' + money(c.budget) + '</div></div><div><div class="label">Incumbent price</div><div class="v num">' + money(c.incumbent.price) + "</div></div></div>" +
      "<p>Your incumbent is <b>" + esc(c.incumbent.name) + "</b>. Staying is always possible and carries zero risk.</p></div>" +
      '<div class="card stack"><div class="label">Hidden priority (keep it to yourself)</div><div class="bigname">' + label("priorities", c.priority) + '</div><p class="muted">' + esc(E.priorityRule(c.priority, cfg)) + "</p>" +
      '<div class="label" style="margin-top:14px">Your boss\'s rule</div><p><b>' + esc(c.constraint.text) + "</b></p></div>" +
      '<div class="card warn stack"><div class="label" style="color:var(--bad)">Career risk</div><p><b>' + esc(S.cards.riskRule) + "</b></p></div>" +
      '<div class="card stack"><div class="label">People you know</div>' + (conns || "<p><b>Nobody.</b> You cannot check any start-up's real reliability.</p>") + "</div>" +
      '<div class="card note stack"><div class="label">Rules</div><p>You can sign <b>1 deal</b>, or stay with your incumbent.</p>' +
      '<p class="muted">Staying scores ' + P.incumbent + " points. A start-up that delivers scores " + P.startupBase + ", plus 1 per 1% saved (up to " + P.savingsCap + "), plus " + P.priorityBonus + " if it fits your priority, minus " + P.constraintPenalty + " if it breaks your boss's rule.</p></div>";
  }
  function roleCard(me) { return me.role === "seller" ? sellerCard(me.card) : buyerCard(me.card); }
  function roleLine(me) { return (me.role === "seller" ? "Seller" : "Buyer") + " · " + me.card.categoryName; }

  // ---------- seller market ----------
  function sellerMarket(st) {
    var me = st.me, open = st.game.phase === "open";
    var conn = {};
    me.card.connections.forEach(function (c) { conn[c.id] = c; });
    var left = me.offers_left, total = cfg.offersPerSeller;
    var html = '<div class="card row"><div><div class="label">Offers left</div><div class="bigname num">' + left + " of " + total + '</div></div><div class="dots bigname" aria-hidden="true">' +
      "●".repeat(Math.max(0, left)) + "○".repeat(Math.max(0, total - left)) + "</div></div>";
    function rank(b) { return b.decided ? 2 : conn[b.id] ? 0 : 1; }
    var buyers = st.buyers.slice().sort(function (a, b) { return rank(a) - rank(b) || a.name.localeCompare(b.name); });
    buyers.forEach(function (b) {
      var k = conn[b.id];
      var mine = st.offers.filter(function (o) { return o.buyer_id === b.id; });
      html += '<div class="card stack' + (k ? " conn" : "") + (b.decided ? " closed" : "") + '">' +
        (k ? '<span class="chip conn">You know them · ' + label("relationships", k.type) + "</span>" : "") +
        '<div><div class="bigname">' + esc(b.name) + '</div><div class="muted">' + esc(b.pub.title) + ", " + esc(b.pub.org) + "</div></div>" +
        "<p>Needs: " + esc(b.pub.need) + "</p>" +
        (k ? '<div class="card note"><p>Hidden priority: <b>' + label("priorities", k.priority) + "</b></p><p>Boss's rule: <b>" + esc(k.constraint.text) + "</b></p></div>" : "") +
        mine.map(function (o) { return '<div class="row"><span class="num"><b>' + money(o.price) + "</b> sent</span>" + statusChip(o) + "</div>"; }).join("") +
        (b.decided ? '<span class="chip grey">Has decided</span>' :
          left > 0 ? '<button class="btn primary block" data-act="offer-open" data-id="' + b.id + '"' + (open ? "" : " disabled") + ">Make an offer</button>" : "") +
        "</div>";
    });
    if (!buyers.length) html += '<div class="card"><p>No buyers in your category yet.</p></div>';
    return html;
  }
  function sellerOffers(st) {
    var names = {};
    st.buyers.forEach(function (b) { names[b.id] = b; });
    if (!st.offers.length) return '<div class="card"><p>You have not sent any offers yet.</p></div>';
    return st.offers.slice().reverse().map(function (o) {
      var b = names[o.buyer_id] || { name: "Buyer", pub: { org: "" } };
      return '<div class="card stack"><div class="row"><div><div class="bigname">' + esc(b.name) + '</div><div class="muted">' + esc(b.pub.org) + '</div></div><div class="price num">' + money(o.price) + "</div></div>" +
        offerTerms(o) + "<div>" + statusChip(o) + "</div></div>";
    }).join("");
  }

  // ---------- buyer market ----------
  function offerCard(st, o, closed) {
    var me = st.me, c = me.card;
    var k = c.connections.filter(function (x) { return x.id === o.seller_id; })[0];
    var f = E.fit(c, o, o.seller.pub, cfg);
    var sav = Math.round(f.savingsPct);
    var canAct = !closed && !me.decision && st.game.phase === "open";
    return '<div class="card stack' + (k ? " conn" : "") + (closed ? " closed" : "") + '">' +
      (k ? '<span class="chip conn">You know them · ' + label("relationships", k.type) + "</span>" : "") +
      '<div class="row"><div><div class="bigname">' + esc(o.seller.pub.org) + '</div><div class="muted">from ' + esc(o.seller.name) + '</div></div><div style="text-align:right"><div class="price num">' + money(o.price) + '</div><div class="muted num">' +
      (sav >= 0 ? sav + "% under incumbent" : -sav + "% over incumbent") + "</div></div></div>" +
      "<p>" + esc(o.seller.pub.tagline) + "</p>" + offerTerms(o) +
      '<p class="muted">Deploys in ' + o.seller.pub.deployWeeks + " weeks.</p>" +
      (k ? '<div class="card note"><p>You know the truth: this start-up <b>' + reliabilityText(k.reliability) + "</b>.</p></div>" : "") +
      (closed ? "<div>" + statusChip(o) + "</div>" :
        '<div class="stack"><div class="check ' + (f.priorityMet ? "ok" : "no") + '">' + (f.priorityMet ? "✓ Fits" : "✗ Does not fit") + " your priority (" + label("priorities", c.priority) + ")</div>" +
        '<div class="check ' + (f.constraintMet ? "ok" : "no") + '">' + (f.constraintMet ? "✓ Passes" : "✗ Breaks") + " your boss's rule</div>" +
        (f.overBudget ? '<div class="check no">✗ Over your budget: you cannot sign this</div>' : "") + "</div>" +
        (canAct ? '<div class="row"><button class="btn block" data-act="reject-open" data-id="' + o.id + '">Reject</button><button class="btn good block" data-act="accept-open" data-id="' + o.id + '"' + (f.overBudget ? " disabled" : "") + ">Accept</button></div>" : "")) +
      "</div>";
  }
  function buyerMarket(st) {
    var me = st.me, c = me.card, html = "";
    var known = {};
    c.connections.forEach(function (x) { known[x.id] = true; });
    if (me.decision === "startup") html += '<div class="banner done">Deal signed. Wait for the market to close.</div>';
    if (me.decision === "incumbent") html += '<div class="banner done">You stayed with ' + esc(c.incumbent.name) + ".</div>";
    html += '<div class="card kv"><div><div class="label">Incumbent · ' + esc(c.incumbent.name) + '</div><div class="v num">' + money(c.incumbent.price) + '</div></div><div><div class="label">Your budget</div><div class="v num">' + money(c.budget) + "</div></div></div>";
    var pending = st.offers.filter(function (o) { return o.status === "pending"; }).sort(function (a, b) {
      return (known[b.seller_id] ? 1 : 0) - (known[a.seller_id] ? 1 : 0) || b.created_at - a.created_at;
    });
    var closed = st.offers.filter(function (o) { return o.status !== "pending"; }).sort(function (a, b) { return b.created_at - a.created_at; });
    if (!st.offers.length) html += '<div class="card"><p><b>No offers yet.</b> Sellers will come and find you. Offers appear here.</p></div>';
    html += pending.map(function (o) { return offerCard(st, o, false); }).join("");
    if (closed.length) html += '<div class="label" style="margin:18px 0 8px">Closed offers</div>' + closed.map(function (o) { return offerCard(st, o, true); }).join("");
    if (!me.decision && st.game.phase === "open") {
      html += '<div class="sticky-bottom"><button class="btn block" data-act="incumbent-open">Stay with ' + esc(c.incumbent.name) + " · zero risk</button></div>";
    }
    return html;
  }

  // ---------- after the close ----------
  function outcome(st) {
    var me = st.me, html = "";
    if (me.points == null) return '<div class="hero"><h1>Market closed</h1><p class="muted">Checking which start-ups delivered…</p></div>';
    if (me.role === "buyer") {
      var deal = st.offers.filter(function (o) { return o.status === "accepted"; })[0];
      var res = E.buyerPoints(me.card, deal || null, deal ? deal.seller.pub : null, cfg);
      var head = !deal ? "You stayed with " + esc(me.card.incumbent.name) + "." :
        deal.delivered ? esc(deal.seller.pub.org) + " delivered." : esc(deal.seller.pub.org) + " failed to deliver.";
      html += '<div class="card stack" style="text-align:center"><div class="label">Your result</div><div class="bigname"' + (deal && !deal.delivered ? ' style="color:var(--bad)"' : "") + ">" + head + "</div>" +
        '<div class="points num">' + me.points + '</div><div class="label">points</div>' +
        '<table class="breakdown">' + res.parts.map(function (p) { return "<tr><td>" + esc(p.label) + '</td><td class="num">' + (p.value > 0 ? "+" : "") + p.value + "</td></tr>"; }).join("") + "</table></div>";
    } else {
      var names = {};
      st.buyers.forEach(function (b) { names[b.id] = b; });
      var wins = st.offers.filter(function (o) { return o.status === "accepted"; });
      html += '<div class="card stack" style="text-align:center"><div class="label">Your result</div><div class="bigname">' +
        (wins.length ? "You signed " + wins.length + (wins.length === 1 ? " deal." : " deals.") : "No deals this time.") + "</div>" +
        '<div class="points num">' + me.points + '</div><div class="label">points</div>' +
        (wins.length ? '<table class="breakdown">' + wins.map(function (o) {
          var b = names[o.buyer_id];
          return "<tr><td>" + esc(b ? b.pub.org : "Buyer") + " · " + money(o.price) + (o.delivered ? "" : ' · <span style="color:var(--bad)">you failed to deliver</span>') + '</td><td class="num">+' + (o.seller_points || 0) + "</td></tr>";
        }).join("") + "</table>" : "") + "</div>";
    }
    if (me.exit_answer) {
      html += '<div class="card note" style="text-align:center"><div class="bigname">Thank you.</div><p>Eyes on the big screen.</p></div>';
    } else {
      html += '<div class="card stack"><div class="label">One last tap</div><div class="bigname">' + esc(S.cards.exitQuestion[me.role]) + "</div>" +
        S.cards.exitOptions.map(function (o) {
          return '<button class="btn block" data-act="exit" data-id="' + esc(o.key) + '"' + (S.busy ? " disabled" : "") + ">" + esc(o.label) + "</button>";
        }).join("") + "</div>";
    }
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
      return '<div class="hero"><div class="label">' + esc(cfg.subtitle) + "</div><h1>" + esc(cfg.title) + '</h1><p class="muted">Enter your name to join. No account needed.</p></div>' +
        '<div class="stack"><input class="field" id="name" maxlength="24" autocomplete="given-name" placeholder="Your first name" value="' + esc(store.getItem("b2bsim.name") || "") + '">' +
        '<button class="btn primary block" data-act="join"' + (S.busy ? " disabled" : "") + ">Join the game</button></div>";
    }
    if (!me.role) {
      return '<div class="hero"><div class="label">You are in</div><h1>' + esc(me.name) + '</h1><p class="muted">' +
        (g.phase === "lobby" ? st.n_players + " joined so far. Keep this page open: your role appears when the host starts." : "Getting your role…") + "</p></div>";
    }
    if (g.phase === "lobby" || g.phase === "briefing") {
      return header(roleLine(me), me.card.org, g.phase === "briefing" ? "Market opens in" : "") +
        '<div class="banner paused">Read your card. The market opens soon.</div>' + roleCard(me);
    }
    if (g.phase === "locked") return header(roleLine(me), me.card.org, "") + outcome(st);

    // market open or paused
    var tabs = me.role === "seller"
      ? [["main", "Buyers"], ["offers", "My offers (" + st.offers.length + ")"], ["card", "My card"]]
      : [["main", "Inbox (" + st.offers.filter(function (o) { return o.status === "pending"; }).length + ")"], ["card", "My card"]];
    var body = S.tab === "card" ? roleCard(me) : me.role === "seller" ? (S.tab === "offers" ? sellerOffers(st) : sellerMarket(st)) : buyerMarket(st);
    return header(roleLine(me), me.card.org, g.phase === "paused" ? "Paused" : "Time left") +
      (g.phase === "paused" ? '<div class="banner paused">The host paused the market.</div>' : "") +
      '<div class="tabs">' + tabs.map(function (t) {
        return '<button class="btn' + (S.tab === t[0] ? " on" : "") + '" data-act="tab" data-id="' + t[0] + '">' + esc(t[1]) + "</button>";
      }).join("") + "</div>" + body;
  }

  function render(force) {
    var st = S.st;
    var key = JSON.stringify([st ? [st.game, st.me, st.buyers, st.offers, st.n_players] : st, S.tab, S.busy, S.code]);
    if (!force && key === S.key) return;
    // Do not wipe a text field the player is typing in.
    var active = document.activeElement;
    if (!force && active && active.id === "name" && st && !st.me && st.game.phase !== "locked") { S.key = key; return; }
    if (!force && active && active.id === "code" && (!S.code || st === null)) { S.key = key; return; }
    S.key = key;
    app.innerHTML = view();
  }

  // ---------- sheets ----------
  function renderSheet() {
    var sh = S.sheet, st = S.st;
    if (!sh || !st || !st.me) { sheetEl.innerHTML = ""; return; }
    var me = st.me, html = "";
    if (sh.type === "offer") {
      var b = st.buyers.filter(function (x) { return x.id === sh.buyerId; })[0];
      var c = me.card, ready = c.assets.indexOf("pilot_ready") >= 0;
      html = '<div class="label">Offer to</div><div class="bigname">' + esc(b.name) + '</div><div class="muted">' + esc(b.pub.org) + "</div>" +
        '<div class="label" style="margin-top:16px">Price per year</div>' +
        '<div class="stepper"><button class="btn" data-act="price" data-id="-5">−</button><div class="big num" id="priceOut">' + money(sh.price) + '</div><button class="btn" data-act="price" data-id="5">+</button></div>' +
        '<input class="slider" id="priceSlider" type="range" min="' + c.floor + '" max="' + c.list + '" step="1" value="' + sh.price + '">' +
        '<div class="row muted num"><span>Floor ' + money(c.floor) + "</span><span>List " + money(c.list) + "</span></div>" +
        '<div class="label" style="margin-top:16px">Terms</div><div class="stack">' +
        '<button class="option' + (sh.pilot ? " on" : "") + '" data-act="pilot"><span class="box">' + (sh.pilot ? "✓" : "") + "</span><span><b>Include a pilot</b><br><span class=\"muted\">" +
        (ready ? "You are pilot-ready, so this costs you nothing." : "Costs you " + cfg.points.sellerPilotCost + " points if the deal is signed.") + "</span></span></button>" +
        c.assets.map(function (a) {
          var on = sh.proof.indexOf(a) >= 0;
          return '<button class="option' + (on ? " on" : "") + '" data-act="proof" data-id="' + a + '"><span class="box">' + (on ? "✓" : "") + "</span><span><b>Show: " + label("proofs", a) + "</b></span></button>";
        }).join("") +
        (c.assets.length ? "" : '<p class="muted">You have no proof to show.</p>') + "</div>" +
        '<div class="stack" style="margin-top:18px"><button class="btn primary block" data-act="offer-send"' + (S.busy ? " disabled" : "") + ">Send offer · uses 1 of your " + me.offers_left + " left</button>" +
        '<button class="btn block" data-act="sheet-close">Cancel</button><p class="muted" style="text-align:center">A sent offer cannot be taken back.</p></div>';
    } else if (sh.type === "accept") {
      var o = st.offers.filter(function (x) { return x.id === sh.offerId; })[0];
      if (!o) { S.sheet = null; sheetEl.innerHTML = ""; return; }
      html = '<div class="label">Sign this deal?</div><div class="bigname">' + esc(o.seller.pub.org) + " · " + money(o.price) + "</div>" +
        '<div class="card warn" style="margin-top:12px"><p><b>This is your one deal.</b> ' + esc(S.cards.riskRule) + "</p>" +
        (o.pilot ? "<p style=\"margin-top:6px\">This offer includes a pilot: if they fail, you keep " + cfg.points.failedWithPilot + " points.</p>" : "") + "</div>" +
        '<div class="stack" style="margin-top:16px"><button class="btn good block" data-act="accept"' + (S.busy ? " disabled" : "") + ">Sign the deal</button>" +
        '<button class="btn block" data-act="sheet-close">Go back</button></div>';
    } else if (sh.type === "reject") {
      html = '<div class="label">Reject this offer</div><div class="bigname">Why? (optional)</div><div class="stack" style="margin-top:12px">' +
        S.cards.rejectReasons.map(function (r) { return '<button class="btn block" data-act="reject" data-id="' + esc(r.key) + '">' + esc(r.label) + "</button>"; }).join("") +
        '<button class="btn block danger" data-act="reject" data-id="">Reject without a reason</button><button class="btn block" data-act="sheet-close">Go back</button></div>';
    } else if (sh.type === "incumbent") {
      html = '<div class="label">Final decision</div><div class="bigname">Stay with ' + esc(me.card.incumbent.name) + "?</div>" +
        '<p style="margin-top:8px">You keep a safe ' + cfg.points.incumbent + " points. Every open offer in your inbox is declined.</p>" +
        '<div class="stack" style="margin-top:16px"><button class="btn primary block" data-act="incumbent"' + (S.busy ? " disabled" : "") + ">Yes, stay with the incumbent</button>" +
        '<button class="btn block" data-act="sheet-close">Go back</button></div>';
    }
    sheetEl.innerHTML = '<div class="panel">' + html + "</div>";
  }
  function openSheet(sh) { S.sheet = sh; renderSheet(); }
  function closeSheet() { S.sheet = null; sheetEl.innerHTML = ""; }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; }, 3500);
  }

  // Run a player action, then refresh.
  function act(promiseFn, after) {
    if (S.busy) return;
    S.busy = true; render(); renderSheet();
    promiseFn().then(function (r) { if (after) after(r); }, function (e) { toast(B2B.errorText(e)); })
      .then(function () { S.busy = false; closeSheet(); render(true); refresh(); });
  }

  // ---------- events ----------
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var a = el.getAttribute("data-act"), id = el.getAttribute("data-id"), sh = S.sheet, st = S.st;
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
      S.tab = id; render(); window.scrollTo(0, 0);
    } else if (a === "sheet-close") {
      closeSheet();
    } else if (a === "offer-open") {
      openSheet({ type: "offer", buyerId: id, price: st.me.card.list, pilot: false, proof: st.me.card.assets.slice() });
    } else if (a === "price") {
      sh.price = E.clamp(sh.price + Number(id), st.me.card.floor, st.me.card.list); renderSheet();
    } else if (a === "pilot") {
      sh.pilot = !sh.pilot; renderSheet();
    } else if (a === "proof") {
      var i = sh.proof.indexOf(id);
      if (i >= 0) sh.proof.splice(i, 1); else sh.proof.push(id);
      renderSheet();
    } else if (a === "offer-send") {
      act(function () { return api.offer(S.code, S.token, sh.buyerId, sh.price, sh.pilot, sh.proof); }, function () { toast("Offer sent."); });
    } else if (a === "accept-open") {
      openSheet({ type: "accept", offerId: id });
    } else if (a === "accept") {
      act(function () { return api.decide(S.code, S.token, sh.offerId, true, null); }, function () { toast("Deal signed."); });
    } else if (a === "reject-open") {
      openSheet({ type: "reject", offerId: id });
    } else if (a === "reject") {
      act(function () { return api.decide(S.code, S.token, sh.offerId, false, id || null); });
    } else if (a === "incumbent-open") {
      openSheet({ type: "incumbent" });
    } else if (a === "incumbent") {
      act(function () { return api.incumbent(S.code, S.token); });
    } else if (a === "exit") {
      act(function () { return api.exit(S.code, S.token, id); });
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target.id === "priceSlider" && S.sheet) {
      S.sheet.price = Number(ev.target.value);
      document.getElementById("priceOut").textContent = money(S.sheet.price);
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var btn = ev.target.id === "name" ? '[data-act="join"]' : ev.target.id === "code" ? '[data-act="setcode"]' : null;
    if (btn) document.querySelector(btn).click();
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
        S.st = st;
        // A sheet is only valid while the market is open.
        if (S.sheet && (!st || !st.me || st.game.phase !== "open")) closeSheet();
        render();
      });
    }, function () {
      var p = S.st && S.st.game && S.st.game.phase;
      if (B2B.mode === "local") return 700;
      return p === "open" || p === "briefing" ? cfg.pollMs.market : cfg.pollMs.idle;
    });
  }, function () {
    app.innerHTML = '<div class="hero"><h1>Could not load the game.</h1><p class="muted">Check your connection and reload.</p></div>';
  });
})();
