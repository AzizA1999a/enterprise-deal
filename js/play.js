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
    if (s === "pending") return '<span class="chip plain">Waiting for a signature</span>';
    if (s === "accepted") return '<span class="chip good">Deal signed</span>';
    if (s === "rejected") return '<span class="chip bad">Rejected' + (o.reason ? ": " + optLabel("rejectReasons", o.reason) : "") + "</span>";
    if (s === "lost") return '<span class="chip grey">Lost: buyer signed another start-up</span>';
    if (s === "lost_incumbent") return '<span class="chip grey">Lost: buyer stayed with the incumbent</span>';
    return '<span class="chip grey">No answer before the close</span>';
  }
  // ---------- the incumbent's account manager ----------
  function fill(text, c, card) {
    return String(text || "").replace(/\{pct\}/g, c.pct).replace(/\{startup\}/g, c.vs || "that start-up")
      .replace(/\{incumbent\}/g, card.incumbent.name).replace(/\{addon\}/g, ((S.cards.rivals || {}).addons || {})[card.priority] || "an extra");
  }
  function counterLines(c, card) {
    var R = S.cards.rivals || {};
    var out = [fill(R[c.kind] || R.counter, c, card)];
    if (c.attack && c.kind !== "early" && (R.attack || {})[c.attack]) out.push(fill(R.attack[c.attack], c, card));
    return out;
  }
  // The incumbent's side of the buyer's inbox: the renewal, and every counter-offer made so far.
  function incumbentCard(st) {
    var me = st.me, c = me.card, list = E.counters(c), last = list[list.length - 1];
    var taken = me.decision === "incumbent" ? E.standing(c, me.stay_level) : me.decision ? null : last;
    var val = E.stayValue(taken, cfg);
    var price = taken ? Math.round(c.incumbent.price * (1 - taken.pct / 100)) : c.incumbent.price;
    var html = '<div class="card rival stack"><div class="row"><div><div class="label">Your incumbent</div><div class="bigname">' + esc(c.incumbent.name) + "</div></div>" +
      '<div style="text-align:right"><div class="price num">' + money(price) + '</div><div class="muted num">' + (taken ? taken.pct + "% off " + money(c.incumbent.price) : "renewal price") + "</div></div></div>";
    if (list.length) {
      html += '<div class="chips"><span class="chip rival">' + (last.kind === "final" ? "Final offer" : last.kind === "early" ? "Early renewal offer" : "Counter-offer " + list.length) + "</span>" +
        (last.addon ? '<span class="chip plain">+ ' + esc(((S.cards.rivals || {}).addons || {})[c.priority] || "an extra") + "</span>" : "") + "</div>" +
        list.slice().reverse().map(function (x, i) {
          var lines = counterLines(x, c);
          return '<div class="say' + (i ? " old" : "") + '">' + (i ? lines.slice(0, 1) : lines).map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>";
        }).join("");
    } else {
      html += '<p class="muted">Staying carries zero risk. If a start-up pitches you, expect ' + esc(c.incumbent.name) + " to fight for you.</p>";
    }
    if (!me.decision) html += '<div class="check ok">Staying now scores ' + val.total + " points, with zero risk" + (list.length ? ". Use it to negotiate." : ".") + "</div>";
    return html + "</div>";
  }

  function shown(o) { return (o.proof || []).filter(function (a) { return a !== "pilot_ready"; }); }
  function offerTerms(o) {
    return '<div class="chips">' + (o.pilot ? '<span class="chip good">Pilot included</span>' : "") +
      (o.fast ? '<span class="chip good">Fast-track: live in ' + cfg.tokens.fastWeeks + " weeks</span>" : "") + proofChips(shown(o)) +
      (!o.pilot && !o.fast && !shown(o).length ? '<span class="chip grey">Nothing added</span>' : "") + "</div>";
  }
  // ---------- resource tokens (sellers) ----------
  function tok(n) { return n + (n === 1 ? " token" : " tokens"); }
  function dots(free, total) { return "●".repeat(Math.max(0, free)) + "○".repeat(Math.max(0, total - free)); }

  // ---------- role cards ----------
  function sellerCard(c) {
    var P = cfg.points;
    var conns = c.connections.map(function (k) {
      return '<div class="card conn"><span class="chip conn">' + label("relationships", k.type) + '</span><div class="bigname" style="margin-top:6px">' + esc(k.name) +
        '</div><div class="muted">Buyer at ' + esc(k.org) + '</div><p style="margin-top:8px">Hidden priority: <b>' + label("priorities", k.priority) +
        "</b></p><p>Boss's rule: <b>" + esc(k.constraint.text) + "</b></p></div>";
    }).join("");
    return '<div class="card stack"><div class="rolebanner"><img src="art/seller-s.jpg" alt=""></div><div class="label">Your start-up</div><div class="bigname">' + esc(c.org) + "</div><p>" + esc(c.tagline) + "</p>" +
      '<div class="kv"><div><div class="label">List price</div><div class="v num">' + money(c.list) + '</div></div><div><div class="label">Floor (never below)</div><div class="v num">' + money(c.floor) + "</div></div></div>" +
      "<p>Deploys in <b>" + c.deployWeeks + " weeks</b>. Prices are per year.</p></div>" +
      '<div class="card stack"><div class="label">Your proof</div>' +
      (c.assets.length ? '<div class="chips">' + proofChips(c.assets) + "</div>" : "<p><b>None.</b> You are selling on a promise.</p>") + "</div>" +
      (c.tokens ? '<div class="card stack"><div class="label">Your resources</div><div class="row"><div class="bigname num">' + tok(c.tokens.budget) + '</div><div class="dots bigname" aria-hidden="true">' + dots(c.tokens.budget, c.tokens.budget) + "</div></div>" +
        "<p>Your team is small. Everything you add to a term sheet ties up tokens:</p>" +
        '<table class="breakdown"><tr><td>A pilot' + (c.assets.indexOf("pilot_ready") >= 0 ? " (you are pilot-ready)" : "") + '</td><td class="num">' + c.tokens.pilot + "</td></tr>" +
        (c.deployWeeks > c.tokens.fastWeeks ? "<tr><td>Fast-track: live in " + c.tokens.fastWeeks + ' weeks</td><td class="num">' + c.tokens.fast + "</td></tr>" : "") +
        E.showable(c).map(function (a) { return "<tr><td>Show your " + label("proofs", a).toLowerCase() + '</td><td class="num">' + c.tokens.proof + "</td></tr>"; }).join("") + "</table>" +
        '<p class="muted">You cannot give everything to everyone. Tokens come back if a buyer says no.</p></div>' : "") +
      '<div class="card stack"><div class="label">People you know</div>' +
      (conns || "<p><b>Nobody.</b> You are selling cold: you cannot see any buyer's priority.</p>") + "</div>" +
      '<div class="card note stack"><div class="label">Rules</div><p><b>Ask before you offer.</b> Each buyer has a hidden priority and a rule from their boss. What they do not need is wasted on them' + (c.tokens ? ", and it still ties up your tokens" : "") + ".</p>" +
      "<p><b>Then write the term sheet together.</b> Ask for their desk number. You can open <b>" + cfg.offersPerSeller + " term sheets</b> in the whole game, and edit one until it is signed or rejected.</p>" +
      (cfg.rivals && cfg.rivals.on ? '<p><b>You are not alone at the table.</b> Every buyer has an incumbent, and its account manager will answer your term sheet with a counter-offer. Ask the buyer what they were offered, then improve your terms.</p>' : "") +
      '<p class="muted">Each delivered deal scores ' + P.sellerDeal + " points, plus up to " + P.sellerPriceHeld + " for keeping your price near list." + (c.tokens ? "" : " A pilot costs you " + P.sellerPilotCost + " points unless you are pilot-ready.") + "</p></div>";
  }
  function buyerCard(c) {
    var P = cfg.points;
    var conns = c.connections.map(function (k) {
      return '<div class="card conn"><span class="chip conn">' + label("relationships", k.type) + '</span><div class="bigname" style="margin-top:6px">' + esc(k.name) +
        '</div><div class="muted">Seller at ' + esc(k.org) + "</div><p style=\"margin-top:8px\">You know the truth: " + esc(k.org) + " <b>" + reliabilityText(k.reliability) + "</b>.</p></div>";
    }).join("");
    return '<div class="card stack"><div class="rolebanner"><img src="art/buyer-s.jpg" alt=""></div><div class="label">You are the ' + esc(c.title) + ' at</div><div class="bigname">' + esc(c.org) + "</div><p>You need: " + esc(c.need) + "</p>" +
      '<div class="kv"><div><div class="label">Budget</div><div class="v num">' + money(c.budget) + '</div></div><div><div class="label">Incumbent price</div><div class="v num">' + money(c.incumbent.price) + "</div></div></div>" +
      "<p>Your incumbent is <b>" + esc(c.incumbent.name) + "</b>. Staying is always possible and carries zero risk." +
      (cfg.rivals && cfg.rivals.on ? " Their account manager will fight to keep you: any counter-offer is real, and you can use it to negotiate." : "") + "</p></div>" +
      '<div class="card stack"><div class="label">Hidden priority (sellers cannot see it)</div><div class="bigname">' + label("priorities", c.priority) + '</div><p class="muted">' + esc(E.priorityRule(c.priority, cfg)) + "</p>" +
      '<div class="label" style="margin-top:14px">Your boss\'s rule</div><p><b>' + esc(c.constraint.text) + "</b></p></div>" +
      '<div class="card warn stack"><div class="label" style="color:var(--bad)">Career risk</div><p><b>' + esc(S.cards.riskRule) + "</b></p></div>" +
      '<div class="card stack"><div class="label">People you know</div>' + (conns || "<p><b>Nobody.</b> You cannot check any start-up's real reliability.</p>") + "</div>" +
      '<div class="card note stack"><div class="label">Rules</div><p><b>Sellers will come to you.</b> Listen, push back, negotiate out loud. A start-up cannot give you everything, so a seller who never asks what you need will bring you the wrong offer. You decide how much to tell.' + (c.desk ? " Give a seller your desk number <b>" + esc(c.desk) + "</b> only when you want their term sheet on your phone." : "") + " You can sign <b>1 deal</b>, or stay with your incumbent.</p>" +
      '<p class="muted">Staying scores ' + P.incumbent + " points" + (cfg.rivals && cfg.rivals.on ? ", plus 1 per 1% your incumbent takes off if you accept its counter-offer before the close" : "") + ". A start-up that delivers scores " + P.startupBase + ", plus 1 per 1% saved (up to " + P.savingsCap + "), plus " + P.priorityBonus + " if it fits your priority, minus " + P.constraintPenalty + " if it breaks your boss's rule.</p></div>";
  }
  function roleCard(me) { return me.role === "seller" ? sellerCard(me.card) : buyerCard(me.card); }
  // A name tag to hold up while walking around the room.
  function badge(me) {
    var c = me.card, seller = me.role === "seller";
    return '<div class="badge ' + me.role + '"><div class="strip">' + (seller ? "Start-up · selling" : "Enterprise · buying") + '</div><div class="who"><div class="n">' + esc(me.name) + '</div><div class="o">' +
      esc(c.org) + '</div><div class="muted" style="margin-top:4px">' + esc(seller ? c.tagline : c.title + " · needs: " + c.need) + "</div></div>" +
      '<div class="desk"><div class="label">' + esc(c.categoryName) + '</div><div class="muted">' +
      (seller ? "Find buyers in your category, pitch them, then ask for their desk number." : "Your desk number is on your Inbox tab. Give it only to sellers you want a term sheet from.") + "</div></div>" +
      "</div>" + '<p class="muted" style="text-align:center;margin-top:14px">Hold your phone up so people can find you.</p>';
  }
  function roleLine(me) { return (me.role === "seller" ? "Seller" : "Buyer") + " · " + me.card.categoryName; }

  // ---------- seller market ----------
  function sellerMarket(st) {
    var me = st.me, open = st.game.phase === "open";
    var conn = {};
    me.card.connections.forEach(function (c) { conn[c.id] = c; });
    var left = me.offers_left, total = cfg.offersPerSeller, T = me.card.tokens;
    var html = '<div class="card stack"><div class="row"><div><div class="label">Term sheets left</div><div class="bigname num">' + left + " of " + total + '</div></div><div class="dots bigname" aria-hidden="true">' + dots(left, total) + "</div></div>" +
      (T ? '<div class="row"><div><div class="label">Tokens free</div><div class="bigname num">' + E.tokensFree(me.card, st.offers) + " of " + T.budget + '</div></div><div class="dots bigname" aria-hidden="true">' + dots(E.tokensFree(me.card, st.offers), T.budget) + "</div></div>" : "") + "</div>" +
      '<div class="card note stack"><div class="label">How to win a buyer</div><ol class="steps"><li><b>Find</b> a buyer in your category.</li><li><b>Ask</b> before you offer:<ul>' +
      (S.cards.askFirst || []).map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ul></li><li><b>Build</b> a term sheet that fits what you heard.</li><li><b>Sign:</b> get their desk number and send it.</li></ol></div>";
    function rank(b) { return b.decided ? 2 : conn[b.id] ? 0 : 1; }
    var buyers = st.buyers.slice().sort(function (a, b) { return rank(a) - rank(b) || a.name.localeCompare(b.name); });
    buyers.forEach(function (b) {
      var k = conn[b.id];
      var mine = st.offers.filter(function (o) { return o.buyer_id === b.id; });
      html += '<div class="card stack' + (k ? " conn" : "") + (b.decided ? " closed" : "") + '">' +
        (k ? '<span class="chip conn">You know them · ' + label("relationships", k.type) + "</span>" : "") +
        '<div><div class="bigname">' + esc(b.name) + '</div><div class="muted">' + esc(b.pub.title) + ", " + esc(b.pub.org) + "</div></div>" +
        "<p>Needs: " + esc(b.pub.need) + "</p>" +
        (b.pub.defence && !b.decided ? '<div class="card rivalnote"><p><b>' + esc(b.pub.defence.by) + "</b> has made " + (b.pub.defence.n === 1 ? "a counter-offer" : b.pub.defence.n + " counter-offers") + ". Ask what they were offered, then beat it.</p></div>" : "") +
        (k ? '<div class="card note"><p>Hidden priority: <b>' + label("priorities", k.priority) + "</b></p><p>Boss's rule: <b>" + esc(k.constraint.text) + "</b></p></div>" : "") +
        mine.map(function (o) { return '<div class="row"><span class="num"><b>' + money(o.price) + "</b>" + (o.pilot ? " + pilot" : "") + (o.fast ? " + fast-track" : "") +
          (T && (o.status === "pending" || o.status === "accepted") && E.offerCost(me.card, o) ? ' <span class="muted">· ' + tok(E.offerCost(me.card, o)) + "</span>" : "") + "</span>" + statusChip(o) + "</div>"; }).join("") +
        (function () {
          var pending = mine.filter(function (o) { return o.status === "pending"; })[0];
          if (b.decided) return '<span class="chip grey">Has decided</span>';
          if (pending) return '<button class="btn block" data-act="revise-open" data-id="' + pending.id + '"' + (open ? "" : " disabled") + ">Edit the term sheet</button>";
          if (left > 0) return '<button class="btn primary block" data-act="offer-open" data-id="' + b.id + '"' + (open ? "" : " disabled") + ">" + (mine.length ? "New term sheet" : "Write a term sheet") + "</button>";
          return "";
        })() +
        "</div>";
    });
    if (!buyers.length) html += '<div class="card"><p>No buyers in your category yet.</p></div>';
    return html;
  }
  function sellerOffers(st) {
    var names = {};
    st.buyers.forEach(function (b) { names[b.id] = b; });
    if (!st.offers.length) return '<div class="card"><p><b>No term sheets yet.</b> Go and talk to a buyer first.</p></div>';
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
      "<p>" + esc(o.seller.pub.tagline) + "</p>" + offerTerms(o) + (o.revisions ? '<div><span class="chip plain">Edited ' + o.revisions + (o.revisions === 1 ? " time" : " times") + "</span></div>" : "") +
      '<p class="muted">Deploys in ' + E.deployWeeks(o, o.seller.pub, cfg) + " weeks" + (o.fast ? " (fast-track)" : "") + ".</p>" +
      (k ? '<div class="card note"><p>You know the truth: this start-up <b>' + reliabilityText(k.reliability) + "</b>.</p></div>" : "") +
      (closed ? "<div>" + statusChip(o) + "</div>" :
        '<div class="stack"><div class="check ' + (f.priorityMet ? "ok" : "no") + '">' + (f.priorityMet ? "✓ Fits" : "✗ Does not fit") + " your priority (" + label("priorities", c.priority) + ")</div>" +
        '<div class="check ' + (f.constraintMet ? "ok" : "no") + '">' + (f.constraintMet ? "✓ Passes" : "✗ Breaks") + " your boss's rule</div>" +
        (f.overBudget ? '<div class="check no">✗ Over your budget: you cannot sign this</div>' : "") + "</div>" +
        (canAct ? '<div class="row"><button class="btn block" data-act="reject-open" data-id="' + o.id + '">Reject</button><button class="btn good block" data-act="accept-open" data-id="' + o.id + '"' + (f.overBudget ? " disabled" : "") + ">Sign</button></div>" : "")) +
      "</div>";
  }
  function buyerMarket(st) {
    var me = st.me, c = me.card, html = "";
    var known = {};
    c.connections.forEach(function (x) { known[x.id] = true; });
    if (me.decision === "startup") html += '<div class="banner done">Deal signed. Wait for the market to close.</div>';
    if (me.decision === "incumbent") html += '<div class="banner done">You stayed with ' + esc(c.incumbent.name) + ".</div>";
    html += incumbentCard(st);
    html += '<div class="card row"><span class="label">Your budget</span><span class="bigname num">' + money(c.budget) + "</span></div>";
    if (c.desk && !me.decision) html += '<div class="card note row"><span>Your desk number, for sellers you want to hear from</span><span class="deskpill num" style="font-size:1.5em">' + esc(c.desk) + "</span></div>";
    var pending = st.offers.filter(function (o) { return o.status === "pending"; }).sort(function (a, b) {
      return (known[b.seller_id] ? 1 : 0) - (known[a.seller_id] ? 1 : 0) || b.created_at - a.created_at;
    });
    var closed = st.offers.filter(function (o) { return o.status !== "pending"; }).sort(function (a, b) { return b.created_at - a.created_at; });
    if (!st.offers.length) html += '<div class="card"><p><b>No term sheets yet.</b> Sellers will walk up and pitch you. What you agree out loud appears here for you to sign.</p></div>';
    html += pending.map(function (o) { return offerCard(st, o, false); }).join("");
    if (closed.length) html += '<div class="label" style="margin:18px 0 8px">Closed offers</div>' + closed.map(function (o) { return offerCard(st, o, true); }).join("");
    if (!me.decision && st.game.phase === "open") {
      html += '<div class="sticky-bottom"><button class="btn block" data-act="incumbent-open">Stay with ' + esc(c.incumbent.name) + " · " + E.stayValue(E.standing(c, E.counters(c).length), cfg).total + " points, zero risk</button></div>";
    }
    return html;
  }

  // ---------- after the close ----------
  function outcome(st) {
    var me = st.me, html = "";
    if (me.points == null) return '<div class="hero"><h1>Market closed</h1><p class="muted">Checking which start-ups delivered…</p></div>';
    if (me.role === "buyer") {
      var deal = st.offers.filter(function (o) { return o.status === "accepted"; })[0];
      var res = E.buyerPoints(me.card, deal || null, deal ? deal.seller.pub : null, cfg, { decision: me.decision, level: me.stay_level });
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
      return '<div class="hero-art"><img src="art/hero-s.jpg" alt=""></div><div class="hero"><div class="label">' + esc(cfg.subtitle) + "</div><h1>" + esc(cfg.title) + '</h1><p class="muted">Enter your name to join. No account needed.</p></div>' +
        '<div class="stack"><input class="field" id="name" maxlength="24" autocomplete="given-name" placeholder="Your first name" value="' + esc(store.getItem("b2bsim.name") || "") + '">' +
        '<button class="btn primary block" data-act="join"' + (S.busy ? " disabled" : "") + ">Join the game</button></div>";
    }
    if (!me.role) {
      return '<div class="hero-art"><img src="art/hero-s.jpg" alt=""></div><div class="hero"><div class="label">You are in</div><h1>' + esc(me.name) + '</h1><p class="muted">' +
        (g.phase === "lobby" ? st.n_players + " joined so far. Keep this page open: your role appears when the host starts." : "Getting your role…") + "</p></div>";
    }
    if (g.phase === "lobby" || g.phase === "briefing") {
      return header(roleLine(me), me.card.org, g.phase === "briefing" ? "Market opens in" : "") +
        '<div class="banner paused">Read your card. Then stand up: the market opens soon.</div>' +
        '<div class="tabs"><button class="btn' + (S.tab !== "badge" ? " on" : "") + '" data-act="tab" data-id="card">My card</button><button class="btn' + (S.tab === "badge" ? " on" : "") + '" data-act="tab" data-id="badge">My badge</button></div>' +
        (S.tab === "badge" ? badge(me) : roleCard(me));
    }
    if (g.phase === "locked") return header(roleLine(me), me.card.org, "") + outcome(st);

    // market open or paused
    var tabs = me.role === "seller"
      ? [["main", "Buyers"], ["offers", "Deals (" + st.offers.length + ")"], ["badge", "Badge"], ["card", "Card"]]
      : [["main", "Inbox (" + st.offers.filter(function (o) { return o.status === "pending"; }).length + ")"], ["badge", "Badge"], ["card", "Card"]];
    var tab = ["main", "offers", "badge", "card"].indexOf(S.tab) >= 0 ? S.tab : "main";
    if (tab === "offers" && me.role !== "seller") tab = "main";
    var body = tab === "card" ? roleCard(me) : tab === "badge" ? badge(me) : me.role === "seller" ? (tab === "offers" ? sellerOffers(st) : sellerMarket(st)) : buyerMarket(st);
    return header(roleLine(me), me.card.org, g.phase === "paused" ? "Paused" : "Time left") +
      (g.phase === "paused" ? '<div class="banner paused">The host paused the market.</div>' : "") +
      '<div class="tabs">' + tabs.map(function (t) {
        return '<button class="btn' + (tab === t[0] ? " on" : "") + '" data-act="tab" data-id="' + t[0] + '">' + esc(t[1]) + "</button>";
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
    if (!sh || !st || !st.me) { sheetEl.__html = sheetEl.innerHTML = ""; return; }
    var me = st.me, html = "";
    if (sh.type === "offer") {
      var b = st.buyers.filter(function (x) { return x.id === sh.buyerId; })[0];
      var c = me.card, ready = c.assets.indexOf("pilot_ready") >= 0, T = c.tokens;
      if (!b) { S.sheet = null; sheetEl.__html = sheetEl.innerHTML = ""; return; }
      var known = c.connections.filter(function (k) { return k.id === b.id; })[0];
      var free = E.tokensFree(c, st.offers, sh.offerId), cost = E.offerCost(c, sh), left = free - cost;
      // One extra on the term sheet: a tick box with its price in tokens. It cannot be ticked when the tokens are not there.
      function extra(on, act, id, title, sub, price) {
        var cant = T && !on && price > left;
        return '<button class="option' + (on ? " on" : "") + (cant ? " cant" : "") + '" data-act="' + act + '"' + (id ? ' data-id="' + id + '"' : "") + (cant ? " disabled" : "") + '><span class="box">' + (on ? "✓" : "") +
          "</span><span style=\"flex:1\"><b>" + title + "</b>" + (sub ? '<br><span class="muted">' + sub + "</span>" : "") + "</span>" + (T ? '<span class="cost num">' + price + "</span>" : "") + "</button>";
      }
      var n = 0;
      function step(text) { n++; return '<div class="label" style="margin-top:18px">' + n + " · " + text + "</div>"; }
      html = '<div class="label">' + (sh.offerId ? "Edit the term sheet for" : "Term sheet for") + '</div><div class="bigname">' + esc(b.name) + '</div><div class="muted">' + esc(b.pub.org) + "</div>" +
        step("What does this buyer care about most?") +
        (known ? '<p class="muted">You know this through your connection. Their boss\'s rule: <b>' + esc(known.constraint.text) + "</b></p>" : '<p class="muted">Ask them. Their boss has a rule too: ask about that as well.</p>') +
        '<div class="picks">' + Object.keys(S.cards.priorities).map(function (k) {
          return '<button class="btn small' + (sh.guess === k ? " on" : "") + '" data-act="guess" data-id="' + k + '">' + label("priorities", k) + "</button>";
        }).join("") + '<button class="btn small' + (sh.guess === "none" ? " on" : "") + '" data-act="guess" data-id="none">I did not ask</button></div>' +
        step("Agreed price per year") +
        '<div class="stepper"><button class="btn" data-act="price" data-id="-5">−</button><div class="big num" id="priceOut">' + money(sh.price) + '</div><button class="btn" data-act="price" data-id="5">+</button></div>' +
        '<input class="slider" id="priceSlider" type="range" min="' + c.floor + '" max="' + c.list + '" step="1" value="' + sh.price + '">' +
        '<div class="row muted num"><span>Floor ' + money(c.floor) + "</span><span>List " + money(c.list) + "</span></div>" +
        step("What you add") +
        (T ? '<div class="row num" style="margin-bottom:8px"><span><b>' + Math.max(0, left) + "</b> of " + T.budget + ' tokens left</span><span class="dots" aria-hidden="true">' + dots(Math.max(0, left), T.budget) + "</span></div>" : "") + '<div class="stack">' +
        extra(sh.pilot, "pilot", "", "Include a pilot", T ? (ready ? "Cheaper for you: you are pilot-ready." : "A small, safe first step for the buyer.") :
          (ready ? "You are pilot-ready, so this costs you nothing." : "Costs you " + cfg.points.sellerPilotCost + " points if the deal is signed."), T ? T.pilot : 0) +
        (T && c.deployWeeks > T.fastWeeks ? extra(sh.fast, "fast", "", "Fast-track deployment", "A dedicated team: live in " + T.fastWeeks + " weeks, not " + c.deployWeeks + ".", T.fast) : "") +
        E.showable(c).map(function (a) { return extra(sh.proof.indexOf(a) >= 0, "proof", a, "Show: " + label("proofs", a), "", T ? T.proof : 0); }).join("") + "</div>" +
        (T && c.deployWeeks <= T.fastWeeks ? '<p class="muted" style="margin-top:8px">You already deploy in ' + c.deployWeeks + " weeks, so there is nothing to fast-track.</p>" : "") +
        (E.showable(c).length ? "" : '<p class="muted" style="margin-top:8px">You have no proof to show.</p>') +
        (T ? '<p class="muted" style="margin-top:8px">This term sheet ties up <b>' + tok(cost) + "</b>. What the buyer does not need is wasted. Tokens come back if they say no.</p>" : "") +
        (!sh.offerId && cfg.requireMeetingCode ? step("Their desk number (ask them, face to face)") +
          '<input class="field deskinput num" id="deskInput" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="--" value="' + esc(sh.desk || "") + '">' : "") +
        '<div class="stack" style="margin-top:18px"><button class="btn primary block" data-act="offer-send"' + (S.busy ? " disabled" : "") + ">" +
        (sh.offerId ? "Update the term sheet" : "Send for signature · uses 1 of your " + me.offers_left) + "</button>" +
        '<button class="btn block" data-act="sheet-close">Cancel</button><p class="muted" style="text-align:center">' +
        (sh.offerId ? "The buyer sees the new terms at once." : "You can still edit the terms until the buyer signs or rejects.") + "</p></div>";
    } else if (sh.type === "accept") {
      var o = st.offers.filter(function (x) { return x.id === sh.offerId; })[0];
      if (!o) { S.sheet = null; sheetEl.__html = sheetEl.innerHTML = ""; return; }
      if (o.price !== sh.price) { sh.price = o.price; toast("The seller changed the terms. Check them."); }
      html = '<div class="label">Sign this deal?</div><div class="bigname">' + esc(o.seller.pub.org) + " · " + money(o.price) + (o.pilot ? " + pilot" : "") + (o.fast ? " + fast-track" : "") + "</div>" +
        '<div class="card warn" style="margin-top:12px"><p><b>This is your one deal.</b> ' + esc(S.cards.riskRule) + "</p>" +
        (o.pilot ? "<p style=\"margin-top:6px\">This offer includes a pilot: if they fail, you keep " + cfg.points.failedWithPilot + " points.</p>" : "") + "</div>" +
        (E.counters(me.card).length ? '<div class="card rivalnote" style="margin-top:10px"><p>Before you sign: <b>' + esc(me.card.incumbent.name) + "</b> has " + E.stayValue(E.standing(me.card, E.counters(me.card).length), cfg).total + " points on the table, with zero risk.</p></div>" : "") +
        '<div class="stack" style="margin-top:16px"><button class="btn good block" data-act="accept"' + (S.busy ? " disabled" : "") + ">Sign the deal</button>" +
        '<button class="btn block" data-act="sheet-close">Go back</button></div>';
    } else if (sh.type === "reject") {
      html = '<div class="label">Reject this offer</div><div class="bigname">Why? (optional)</div><div class="stack" style="margin-top:12px">' +
        S.cards.rejectReasons.map(function (r) { return '<button class="btn block" data-act="reject" data-id="' + esc(r.key) + '">' + esc(r.label) + "</button>"; }).join("") +
        '<button class="btn block danger" data-act="reject" data-id="">Reject without a reason</button><button class="btn block" data-act="sheet-close">Go back</button></div>';
    } else if (sh.type === "incumbent") {
      var lvl = E.counters(me.card).length, stand = E.standing(me.card, lvl), sv = E.stayValue(stand, cfg);
      sh.level = lvl;
      html = '<div class="label">Final decision</div><div class="bigname">Stay with ' + esc(me.card.incumbent.name) + "?</div>" +
        '<p style="margin-top:8px">You keep a safe ' + sv.total + " points" + (stand ? ": " + cfg.points.incumbent + " for staying, plus their counter-offer" : "") + ". Every open offer in your inbox is declined.</p>" +
        (stand ? '<table class="breakdown">' + sv.parts.map(function (p) { return "<tr><td>" + esc(p.label) + '</td><td class="num">+' + p.value + "</td></tr>"; }).join("") + "</table>" : "") +
        '<div class="stack" style="margin-top:16px"><button class="btn primary block" data-act="incumbent"' + (S.busy ? " disabled" : "") + ">Yes, stay with the incumbent</button>" +
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
    S.busy = true; render(); renderSheet();
    promiseFn().then(function (r) { if (after) after(r); return true; }, function (e) { toast(B2B.errorText(e)); return false; })
      .then(function (ok) {
        S.busy = false;
        if (ok || !keepOnError) closeSheet(); else renderSheet();
        render(true); refresh();
      });
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
      // Nothing is ticked to start with: the seller adds what this buyer needs.
      var kn = st.me.card.connections.filter(function (k) { return k.id === id; })[0];
      openSheet({ type: "offer", buyerId: id, desk: "", price: st.me.card.list, pilot: false, fast: false, proof: [], guess: kn ? kn.priority : null });
    } else if (a === "revise-open") {
      var cur = st.offers.filter(function (x) { return x.id === id; })[0];
      if (cur) openSheet({ type: "offer", offerId: cur.id, buyerId: cur.buyer_id, price: cur.price, pilot: cur.pilot, fast: !!cur.fast, proof: shown(cur), guess: cur.guess || null });
    } else if (a === "price") {
      sh.price = E.clamp(sh.price + Number(id), st.me.card.floor, st.me.card.list); renderSheet();
    } else if (a === "pilot") {
      sh.pilot = !sh.pilot; renderSheet();
    } else if (a === "fast") {
      sh.fast = !sh.fast; renderSheet();
    } else if (a === "guess") {
      sh.guess = id; renderSheet();
    } else if (a === "proof") {
      var i = sh.proof.indexOf(id);
      if (i >= 0) sh.proof.splice(i, 1); else sh.proof.push(id);
      renderSheet();
    } else if (a === "offer-send") {
      if (!sh.guess) return toast("Step 1: tap what this buyer cares about, or \"I did not ask\".");
      var more = { fast: !!sh.fast, guess: sh.guess };
      if (sh.offerId) {
        act(function () { return api.revise(S.code, S.token, sh.offerId, sh.price, sh.pilot, sh.proof, more); }, function () { toast("Term sheet updated."); }, true);
      } else {
        if (cfg.requireMeetingCode && !/^\d{2}$/.test(sh.desk || "")) return toast("Ask the buyer for their 2-digit desk number.");
        act(function () { return api.offer(S.code, S.token, sh.buyerId, sh.price, sh.pilot, sh.proof, sh.desk, more); }, function () { toast("Sent. Ask them to sign on their phone."); }, true);
      }
    } else if (a === "accept-open") {
      var seen = st.offers.filter(function (x) { return x.id === id; })[0];
      if (seen) openSheet({ type: "accept", offerId: id, price: seen.price });
    } else if (a === "accept") {
      act(function () { return api.decide(S.code, S.token, sh.offerId, true, null, sh.price); }, function () { toast("Deal signed."); });
    } else if (a === "reject-open") {
      openSheet({ type: "reject", offerId: id });
    } else if (a === "reject") {
      act(function () { return api.decide(S.code, S.token, sh.offerId, false, id || null); });
    } else if (a === "incumbent-open") {
      openSheet({ type: "incumbent" });
    } else if (a === "incumbent") {
      act(function () { return api.incumbent(S.code, S.token, sh.level || 0); });
    } else if (a === "exit") {
      act(function () { return api.exit(S.code, S.token, id); });
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target.id === "deskInput" && S.sheet) { S.sheet.desk = ev.target.value.replace(/\D/g, "").slice(0, 2); return; }
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
        if (S.sheet && (S.sheet.type === "accept" || S.sheet.type === "incumbent") && !S.busy) renderSheet();
        if (st && st.me && st.me.role === "buyer" && st.me.card) {
          var nc = E.counters(st.me.card).length;
          if (S.counters != null && nc > S.counters && !st.me.decision) {
            toast(st.me.card.incumbent.name + " just made you a counter-offer.");
            if (navigator.vibrate) navigator.vibrate(120);
          }
          S.counters = nc;
        }
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
