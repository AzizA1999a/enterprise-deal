/* Data layer. Two interchangeable back ends with the same calls:
   - local:  the whole game lives in this browser (offline demo and rehearsal)
   - remote: Supabase database functions (the live class game)
   Every call returns a Promise. Failures reject with an Error whose .code is a short keyword. */
(function (root) {
  "use strict";
  var B2B = (root.B2B = root.B2B || {});
  var cfg = root.B2B_CONFIG || {};

  var store = root.localStorage || (function () {
    var m = {};
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  })();
  B2B.store = store;

  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function uid() {
    return root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() :
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
      });
  }
  B2B.uid = uid;

  // =====================================================================
  // Local back end
  // =====================================================================
  var KEY = "b2bsim.game.";
  function load(code) { var s = store.getItem(KEY + String(code || "").toUpperCase()); return s ? JSON.parse(s) : null; }
  function save(g) { store.setItem(KEY + g.code, JSON.stringify(g)); }
  function need(code) { var g = load(code); if (!g) throw fail("no_game"); return g; }
  function needHost(code, pin) { var g = need(code); if (g.pin !== String(pin)) throw fail("bad_pin"); return g; }
  function byToken(g, token) { return g.players.filter(function (p) { return p.token === token; })[0]; }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  function remaining(g, now) {
    return g.phase === "paused" ? g.paused_ms || 0 : g.phase === "open" ? Math.max(0, g.ends_at - now) : 0;
  }
  function clock(g, now) {
    return g.phase === "open" || g.phase === "paused" ? Math.round(((g.total_ms || 0) - remaining(g, now)) / 1000) : null;
  }
  function log(g, type, actor, data) {
    var now = Date.now();
    g.events.push({ at: now, t: clock(g, now), type: type, actor: actor || null, data: data || null });
  }
  function gameView(g) {
    return { code: g.code, phase: g.phase, briefing_ends_at: g.briefing_ends_at, opened_at: g.opened_at,
             ends_at: g.ends_at, paused_ms: g.paused_ms, total_ms: g.total_ms, view: g.view };
  }
  function offerView(o) {
    return { id: o.id, seller_id: o.seller_id, buyer_id: o.buyer_id, price: o.price, pilot: o.pilot, proof: o.proof,
             status: o.status, reason: o.reason, created_at: o.created_at, sent_t: o.sent_t,
             decided_at: o.decided_at, decided_t: o.decided_t, delivered: o.delivered, seller_points: o.seller_points,
             revisions: o.revisions || 0 };
  }
  function playerRow(p, withToken) {
    var r = { id: p.id, name: p.name, role: p.role, category: p.category, card: p.card, pub: p.pub, is_bot: p.is_bot,
              offers_left: p.offers_left, decision: p.decision, decided_at: p.decided_at, decided_t: p.decided_t,
              points: p.points, exit_answer: p.exit_answer, exit_at: p.exit_at, joined_at: p.joined_at,
              stay_level: p.stay_level == null ? null : p.stay_level };
    if (withToken) r.token = p.token;
    return r;
  }
  function openOnly(g) {
    if (g.phase !== "open" || Date.now() >= g.ends_at) throw fail("not_open");
  }

  var local = {
    createGame: function (pin) {
      var letters = "ABCDEFGHJKLMNPQRSTUVWXYZ", code;
      do {
        code = "";
        for (var i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
      } while (load(code));
      save({ code: code, pin: String(pin), phase: "lobby", view: "closed", briefing_ends_at: null, opened_at: null,
             ends_at: null, paused_ms: null, total_ms: null, players: [], offers: [], events: [], created_at: Date.now() });
      return { code: code };
    },

    join: function (code, name, token, bot) {
      var g = need(code);
      var me = byToken(g, token);
      if (me) return { id: me.id, name: me.name };
      if (g.phase === "locked") throw fail("closed");
      name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 24);
      if (!name) throw fail("bad_name");
      var base = name, n = 1;
      while (g.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) name = base + " " + ++n;
      me = { id: uid(), name: name, token: token, role: null, category: null, card: null, pub: null, is_bot: !!bot,
             offers_left: null, decision: null, decided_at: null, decided_t: null, points: null,
             exit_answer: null, exit_at: null, joined_at: Date.now() };
      g.players.push(me);
      log(g, "join", me.id, { name: name });
      save(g);
      return { id: me.id, name: me.name };
    },

    state: function (code, token) {
      var g = load(code);
      if (!g) return null;
      var out = { now: Date.now(), game: gameView(g), n_players: g.players.length, me: null, buyers: [], offers: [] };
      var me = byToken(g, token);
      if (!me) return out;
      out.me = playerRow(me);
      if (me.role === "seller") {
        out.buyers = g.players.filter(function (b) { return b.role === "buyer" && b.category === me.category; })
          .map(function (b) { return { id: b.id, name: b.name, pub: b.pub, decided: !!b.decision }; });
        out.offers = g.offers.filter(function (o) { return o.seller_id === me.id; }).map(offerView);
      } else if (me.role === "buyer") {
        out.offers = g.offers.filter(function (o) { return o.buyer_id === me.id; }).map(function (o) {
          var v = offerView(o), s = byId(g.players, o.seller_id);
          v.seller = { name: s.name, pub: s.pub };
          return v;
        });
      }
      return out;
    },

    public: function (code) {
      var g = load(code);
      if (!g) return null;
      var locked = g.phase === "locked";
      return {
        now: Date.now(), game: gameView(g), n_offers: g.offers.length,
        players: g.players.map(function (p) {
          return { id: p.id, name: p.name, role: p.role, is_bot: p.is_bot, org: p.pub ? p.pub.org : null,
                   decision: p.decision, decided_t: p.decided_t, exit_done: !!p.exit_answer,
                   defence: p.pub && p.pub.defence ? p.pub.defence : null };
        }),
        deals: g.offers.filter(function (o) { return o.status === "accepted"; })
          .map(function (o) { return { seller_id: o.seller_id, buyer_id: o.buyer_id, decided_t: o.decided_t, delivered: o.delivered }; }),
        full: locked ? { players: g.players.map(function (p) { return playerRow(p); }), offers: g.offers.map(offerView) } : null
      };
    },

    offer: function (code, token, buyerId, price, pilot, proof, desk) {
      var g = need(code), me = byToken(g, token);
      if (!me || me.role !== "seller") throw fail("not_joined");
      openOnly(g);
      if (!(me.offers_left > 0)) throw fail("no_offers_left");
      var b = byId(g.players, buyerId);
      if (!b || b.role !== "buyer" || b.category !== me.category) throw fail("wrong_category");
      if (b.decision) throw fail("buyer_closed");
      if (b.card.desk && String(desk || "").trim() !== String(b.card.desk)) throw fail("bad_desk");
      if (g.offers.some(function (x) { return x.seller_id === me.id && x.buyer_id === b.id && x.status === "pending"; })) throw fail("already_pitched");
      price = Number(price);
      if (!(price >= me.card.floor && price <= me.card.list)) throw fail("bad_price");
      proof = (proof || []).slice();
      if (proof.some(function (a) { return me.card.assets.indexOf(a) < 0; })) throw fail("bad_proof");
      var now = Date.now();
      var o = { id: uid(), seller_id: me.id, buyer_id: b.id, price: price, pilot: !!pilot, proof: proof, status: "pending",
                reason: null, created_at: now, sent_t: clock(g, now), decided_at: null, decided_t: null, delivered: null, seller_points: null, revisions: 0 };
      g.offers.push(o);
      me.offers_left -= 1;
      log(g, "offer", me.id, { offer: o.id, buyer: b.id, price: price, pilot: !!pilot, proof: proof });
      save(g);
      return { id: o.id };
    },

    // Change the terms of a term sheet the buyer has not answered yet. Free: it does not use up an offer.
    revise: function (code, token, offerId, price, pilot, proof) {
      var g = need(code), me = byToken(g, token);
      if (!me || me.role !== "seller") throw fail("not_joined");
      openOnly(g);
      var o = byId(g.offers, offerId);
      if (!o || o.seller_id !== me.id || o.status !== "pending") throw fail("offer_gone");
      price = Number(price);
      if (!(price >= me.card.floor && price <= me.card.list)) throw fail("bad_price");
      proof = (proof || []).slice();
      if (proof.some(function (a) { return me.card.assets.indexOf(a) < 0; })) throw fail("bad_proof");
      log(g, "revise", me.id, { offer: o.id, buyer: o.buyer_id, from: { price: o.price, pilot: o.pilot, proof: o.proof }, to: { price: price, pilot: !!pilot, proof: proof } });
      o.price = price; o.pilot = !!pilot; o.proof = proof; o.revisions = (o.revisions || 0) + 1;
      save(g);
      return { ok: true };
    },

    decide: function (code, token, offerId, accept, reason, expectPrice) {
      var g = need(code), me = byToken(g, token);
      if (!me || me.role !== "buyer") throw fail("not_joined");
      openOnly(g);
      var o = byId(g.offers, offerId);
      if (!o || o.buyer_id !== me.id || o.status !== "pending") throw fail("offer_gone");
      var now = Date.now(), t = clock(g, now);
      if (accept) {
        if (me.decision) throw fail("already_decided");
        if (expectPrice != null && Number(expectPrice) !== o.price) throw fail("offer_changed");
        if (o.price > me.card.budget) throw fail("over_budget");
        o.status = "accepted"; o.decided_at = now; o.decided_t = t;
        g.offers.forEach(function (x) {
          if (x.buyer_id === me.id && x.status === "pending") { x.status = "lost"; x.decided_at = now; x.decided_t = t; }
        });
        me.decision = "startup"; me.decided_at = now; me.decided_t = t;
        log(g, "accept", me.id, { offer: o.id, seller: o.seller_id });
      } else {
        o.status = "rejected"; o.reason = reason || null; o.decided_at = now; o.decided_t = t;
        log(g, "reject", me.id, { offer: o.id, seller: o.seller_id, reason: reason || null });
      }
      save(g);
      return { ok: true };
    },

    // seen = how many counter-offers from the incumbent the buyer had on screen when they chose to stay.
    incumbent: function (code, token, seen) {
      var g = need(code), me = byToken(g, token);
      if (!me || me.role !== "buyer") throw fail("not_joined");
      openOnly(g);
      if (me.decision) throw fail("already_decided");
      var now = Date.now(), t = clock(g, now);
      var made = ((me.card.incumbent || {}).counters || []).length;
      me.stay_level = Math.max(0, Math.min(made, Math.floor(Number(seen) || 0)));
      me.decision = "incumbent"; me.decided_at = now; me.decided_t = t;
      g.offers.forEach(function (x) {
        if (x.buyer_id === me.id && x.status === "pending") { x.status = "lost_incumbent"; x.decided_at = now; x.decided_t = t; }
      });
      log(g, "incumbent", me.id, { counter_offers_seen: me.stay_level });
      save(g);
      return { ok: true };
    },

    exit: function (code, token, answer) {
      var g = need(code), me = byToken(g, token);
      if (!me || !me.role) throw fail("not_joined");
      if (g.phase !== "locked") throw fail("not_locked");
      me.exit_answer = String(answer); me.exit_at = Date.now();
      log(g, "exit", me.id, { answer: me.exit_answer });
      save(g);
      return { ok: true };
    },

    hostState: function (code, pin) {
      var g = needHost(code, pin);
      return { now: Date.now(), game: gameView(g),
               players: g.players.map(function (p) { return playerRow(p, p.is_bot); }),
               offers: g.offers.map(offerView) };
    },

    hostEvents: function (code, pin) { return needHost(code, pin).events.slice(); },

    host: function (code, pin, action, arg) {
      var g = needHost(code, pin), now = Date.now(), changed = false;
      arg = arg || {};
      if (action === "start" && g.phase === "lobby") {
        g.phase = "briefing"; g.briefing_ends_at = now + (arg.briefing_ms || 0); changed = true;
      } else if (action === "open" && g.phase === "briefing") {
        g.phase = "open"; g.opened_at = now; g.total_ms = arg.market_ms; g.ends_at = now + arg.market_ms; changed = true;
      } else if (action === "pause" && g.phase === "open") {
        g.paused_ms = Math.max(0, g.ends_at - now); g.phase = "paused"; changed = true;
      } else if (action === "resume" && g.phase === "paused") {
        g.ends_at = now + g.paused_ms; g.paused_ms = null; g.phase = "open"; changed = true;
      } else if (action === "extend" && (g.phase === "open" || g.phase === "paused")) {
        if (g.phase === "open") g.ends_at = Math.max(g.ends_at, now) + arg.ms; else g.paused_ms += arg.ms;
        g.total_ms += arg.ms; changed = true;
      } else if (action === "lock" && (g.phase === "open" || g.phase === "paused")) {
        var t = clock(g, now);
        g.offers.forEach(function (o) { if (o.status === "pending") { o.status = "expired"; o.decided_at = now; o.decided_t = t; } });
        g.players.forEach(function (p) {
          if (p.role === "buyer" && !p.decision) { p.decision = "incumbent_default"; p.decided_at = now; p.decided_t = t; }
        });
        log(g, "lock", null, null);
        g.phase = "locked"; g.view = "closed"; changed = true;
      } else if (action === "view" && g.phase === "locked") {
        g.view = arg.view; changed = true;
      } else if (action === "reset") {
        g.players = []; g.offers = []; g.events = [];
        g.phase = "lobby"; g.view = "closed";
        g.briefing_ends_at = g.opened_at = g.ends_at = g.paused_ms = g.total_ms = null; changed = true;
      }
      if (changed && action !== "lock" && action !== "reset") log(g, action, null, arg);
      if (changed) save(g);
      return { changed: changed };
    },

    hostApply: function (code, pin, patch) {
      var g = needHost(code, pin);
      (patch.players || []).forEach(function (u) {
        var p = byId(g.players, u.id);
        if (!p) return;
        ["role", "category", "card", "pub", "offers_left", "points"].forEach(function (k) { if (u[k] != null) p[k] = u[k]; });
      });
      (patch.offers || []).forEach(function (u) {
        var o = byId(g.offers, u.id);
        if (!o) return;
        ["delivered", "seller_points"].forEach(function (k) { if (u[k] != null) o[k] = u[k]; });
      });
      (patch.events || []).forEach(function (e) { log(g, String(e.type), e.actor || null, e.data || null); });
      save(g);
      return { ok: true };
    }
  };

  // Wrap the synchronous local functions so both back ends look the same.
  var localApi = {};
  Object.keys(local).forEach(function (k) {
    localApi[k] = function () {
      var args = arguments;
      return new Promise(function (resolve, reject) {
        try { resolve(local[k].apply(null, args)); } catch (e) { reject(e); }
      });
    };
  });

  // =====================================================================
  // Remote back end (Supabase database functions)
  // =====================================================================
  function rpc(fn, params) {
    return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey, Authorization: "Bearer " + cfg.supabaseKey },
      body: JSON.stringify(params)
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
        if (!res.ok) throw fail((body && body.message) || "server_" + res.status);
        return body;
      });
    }, function () { throw fail("network"); });
  }

  var remoteApi = {
    createGame: function (pin) { return rpc("sim_create_game", { p_pin: String(pin) }); },
    join: function (code, name, token, bot) { return rpc("sim_join", { p_code: code, p_name: name, p_token: token, p_bot: !!bot }); },
    state: function (code, token) { return rpc("sim_state", { p_code: code, p_token: token }); },
    public: function (code) { return rpc("sim_public", { p_code: code }); },
    offer: function (code, token, buyerId, price, pilot, proof, desk) {
      return rpc("sim_offer", { p_code: code, p_token: token, p_buyer: buyerId, p_price: price, p_pilot: !!pilot, p_proof: proof || [], p_desk: desk == null ? null : String(desk) });
    },
    revise: function (code, token, offerId, price, pilot, proof) {
      return rpc("sim_revise", { p_code: code, p_token: token, p_offer: offerId, p_price: price, p_pilot: !!pilot, p_proof: proof || [] });
    },
    decide: function (code, token, offerId, accept, reason, expectPrice) {
      return rpc("sim_decide", { p_code: code, p_token: token, p_offer: offerId, p_accept: !!accept, p_reason: reason || null, p_expect_price: expectPrice == null ? null : expectPrice });
    },
    incumbent: function (code, token, seen) { return rpc("sim_incumbent", { p_code: code, p_token: token, p_seen: Math.floor(Number(seen) || 0) }); },
    exit: function (code, token, answer) { return rpc("sim_exit", { p_code: code, p_token: token, p_answer: answer }); },
    hostState: function (code, pin) { return rpc("sim_host_state", { p_code: code, p_pin: String(pin) }); },
    hostEvents: function (code, pin) { return rpc("sim_host_events", { p_code: code, p_pin: String(pin) }); },
    host: function (code, pin, action, arg) { return rpc("sim_host", { p_code: code, p_pin: String(pin), p_action: action, p_arg: arg || {} }); },
    hostApply: function (code, pin, patch) { return rpc("sim_host_apply", { p_code: code, p_pin: String(pin), p_patch: patch }); }
  };

  // =====================================================================
  // host.html?offline=1 switches this browser to offline mode; ?offline=0 switches back.
  try {
    var flag = new URLSearchParams(root.location.search).get("offline");
    if (flag === "1" || flag === "0") store.setItem("b2bsim.offline", flag);
  } catch (e) { /* not in a browser */ }

  B2B.hasRemote = !!(cfg.supabaseUrl && cfg.supabaseKey);
  B2B.mode = B2B.hasRemote && store.getItem("b2bsim.offline") !== "1" ? "online" : "local";
  B2B.localApi = localApi;
  B2B.remoteApi = remoteApi;
  B2B.api = B2B.mode === "online" ? remoteApi : localApi;

  B2B.errorText = function (e) {
    var map = {
      no_game: "That game code was not found.",
      bad_pin: "Wrong host PIN.",
      bad_name: "Please enter your name.",
      closed: "This game has already finished.",
      not_joined: "You are not in this game yet.",
      not_open: "The market is not open right now.",
      not_locked: "The market has not closed yet.",
      no_offers_left: "You have used all your offers.",
      wrong_category: "That buyer is not in your category.",
      buyer_closed: "That buyer has already decided.",
      bad_price: "The price must be between your floor and your list price.",
      bad_proof: "You can only show proof you actually hold.",
      bad_desk: "That is not their desk number. Ask them to show you their badge.",
      already_pitched: "You already have an open term sheet with this buyer. Edit that one.",
      offer_changed: "The seller just changed these terms. Check them again.",
      bad_arg: "That action could not be completed.",
      already_decided: "You have already made your decision.",
      over_budget: "That price is over your budget.",
      offer_gone: "That offer is no longer open.",
      network: "No connection. Trying again…"
    };
    return map[e && e.code] || "Something went wrong (" + ((e && (e.code || e.message)) || "unknown") + ").";
  };
})(typeof window !== "undefined" ? window : globalThis);
