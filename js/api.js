/* Data layer. Two interchangeable back ends:
     B2B.localApi   the whole game kept in this browser (offline demo mode)
     B2B.remoteApi  Supabase database functions (the live class game)
   Every call returns a Promise. Failures reject with an Error whose .code is a short keyword.

   The game: lobby -> briefing -> round 1 open -> reveal -> round 2 open -> reveal -> ... -> locked.
   A buyer makes one decision per round: stay, or sign a start-up (full deal or pilot) by typing its deal code.
   A start-up can be signed by one buyer per round. Whether it delivers is fixed by its card ("ready"). */
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
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }
  B2B.uid = uid;

  // =====================================================================
  // Local back end
  // =====================================================================
  var KEY = "b2bsim.game.";
  // A game saved by an earlier version of this site (before the rounds) is treated as not there.
  function load(code) {
    var s = store.getItem(KEY + String(code || "").toUpperCase()), g = s ? JSON.parse(s) : null;
    return g && Array.isArray(g.deals) ? g : null;
  }
  function save(g) { store.setItem(KEY + g.code, JSON.stringify(g)); }
  function need(code) { var g = load(code); if (!g) throw fail("no_game"); return g; }
  function needHost(code, pin) { var g = need(code); if (g.pin !== String(pin)) throw fail("bad_pin"); return g; }
  function byToken(g, token) { return g.players.filter(function (p) { return p.token === token; })[0] || null; }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
  function rules(g) { return g.rules || { rounds: 3, pilotFrom: 2 }; }
  function closedRounds(g) { return g.phase === "open" ? Math.max(0, g.round - 1) : g.phase === "reveal" || g.phase === "locked" ? g.round : 0; }
  // Seconds into the current round; null outside a round.
  function clock(g, now) { return g.phase === "open" ? Math.max(0, Math.round(((g.total_ms || 0) - Math.max(0, g.ends_at - now)) / 1000)) : null; }
  function log(g, type, actor, data) {
    var now = Date.now();
    g.events.push({ at: now, round: g.round || 0, t: clock(g, now), type: type, actor: actor || null, data: data || null });
  }
  function gameView(g) {
    return { code: g.code, phase: g.phase, round: g.round || 0, rounds: rules(g).rounds, rules: rules(g),
             briefing_ends_at: g.briefing_ends_at, ends_at: g.ends_at, total_ms: g.total_ms, view: g.view };
  }
  // `secret` hides whether the start-up delivered (a decision in a round that is still open).
  function dealView(d, secret) {
    return { id: d.id, round: d.round, buyer_id: d.buyer_id, seller_id: d.seller_id, kind: d.kind,
             delivered: secret ? null : d.delivered, at: d.at, t: d.t };
  }
  function playerRow(p, withToken) {
    var r = { id: p.id, name: p.name, role: p.role, card: p.card, pub: p.pub, is_bot: p.is_bot, joined_at: p.joined_at };
    if (withToken) r.token = p.token;
    return r;
  }
  function closedDeals(g) {
    var n = closedRounds(g);
    return g.deals.filter(function (d) { return d.round <= n; }).map(function (d) { return dealView(d); });
  }

  var local = {
    createGame: function (pin) {
      var letters = "ABCDEFGHJKLMNPQRSTUVWXYZ", code;
      do {
        code = "";
        for (var i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
      } while (load(code));
      save({ code: code, pin: String(pin), phase: "lobby", round: 0, rules: null, view: "closed", briefing_ends_at: null,
             ends_at: null, total_ms: null, players: [], deals: [], events: [], created_at: Date.now() });
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
      me = { id: uid(), name: name, token: token, role: null, card: null, pub: null, is_bot: !!bot, joined_at: Date.now() };
      g.players.push(me);
      log(g, "join", me.id, { name: name });
      save(g);
      return { id: me.id, name: me.name };
    },

    // What one phone may know.
    state: function (code, token) {
      var g = load(code);
      if (!g) return null;
      var out = { now: Date.now(), game: gameView(g), n_players: g.players.length, me: null, mine: null, closed: closedDeals(g), sellers: [] };
      var me = byToken(g, token);
      if (!me) return out;
      out.me = playerRow(me);
      if (g.phase === "open") {
        var row = g.deals.filter(function (d) { return d.round === g.round && (d.buyer_id === me.id || d.seller_id === me.id); })[0];
        out.mine = row ? dealView(row, true) : null;
      }
      if (me.role === "buyer") {
        var R = rules(g), showProof = g.round >= (R.proofFrom || 99);
        out.sellers = g.players.filter(function (s) { return s.role === "seller"; }).map(function (s) {
          return { id: s.id, name: s.name, org: s.pub.org, tagline: s.pub.tagline, is_bot: s.is_bot, code: s.card.code,
                   proof: showProof ? !!s.card.proof : null,
                   busy: g.phase === "open" && g.deals.some(function (d) { return d.round === g.round && d.seller_id === s.id; }) };
        });
      }
      return out;
    },

    // What the projector may show. Results of a round appear only when it has closed.
    public: function (code) {
      var g = load(code);
      if (!g) return null;
      var now = g.deals.filter(function (d) { return g.phase === "open" && d.round === g.round; });
      return {
        now: Date.now(), game: gameView(g),
        players: g.players.map(function (p) { return { id: p.id, name: p.name, role: p.role, is_bot: p.is_bot, org: p.pub ? p.pub.org : null }; }),
        decided_now: now.length, signed_now: now.filter(function (d) { return d.kind !== "stay"; }).length,
        closed: closedDeals(g),
        full: g.phase === "locked" ? { players: g.players.map(function (p) { return playerRow(p); }), deals: g.deals.map(function (d) { return dealView(d); }) } : null
      };
    },

    // A buyer's one decision for the round. kind: "full", "pilot" or "stay" (then sellerCode is ignored).
    sign: function (code, token, sellerCode, kind) {
      var g = need(code), me = byToken(g, token);
      if (!me || me.role !== "buyer") throw fail("not_joined");
      if (g.phase !== "open" || Date.now() >= g.ends_at) throw fail("not_open");
      if (["full", "pilot", "stay"].indexOf(kind) < 0) throw fail("bad_arg");
      if (g.deals.some(function (d) { return d.round === g.round && d.buyer_id === me.id; })) throw fail("already_decided");
      var now = Date.now(), d = { id: uid(), round: g.round, buyer_id: me.id, seller_id: null, kind: kind, delivered: null, at: now, t: clock(g, now) };
      if (kind !== "stay") {
        if (kind === "pilot" && g.round < rules(g).pilotFrom) throw fail("no_pilot");
        var s = g.players.filter(function (x) { return x.role === "seller" && x.card.code === String(sellerCode || "").trim(); })[0];
        if (!s) throw fail("bad_code");
        if (g.deals.some(function (x) { return x.round === g.round && x.seller_id === s.id; })) throw fail("seller_busy");
        d.seller_id = s.id;
        d.delivered = !!s.card.ready;      // fixed by the start-up's card; shown to nobody until the round closes
      }
      g.deals.push(d);
      log(g, kind === "stay" ? "stay" : "sign", me.id, { round: g.round, seller: d.seller_id, kind: kind });
      save(g);
      return { ok: true };
    },

    hostState: function (code, pin) {
      var g = needHost(code, pin);
      return { now: Date.now(), game: gameView(g),
               players: g.players.map(function (p) { return playerRow(p, p.is_bot); }),
               deals: g.deals.map(function (d) { return dealView(d); }) };
    },

    hostEvents: function (code, pin) { return needHost(code, pin).events.slice(); },

    host: function (code, pin, action, arg) {
      var g = needHost(code, pin), now = Date.now(), changed = false, R = rules(g);
      arg = arg || {};
      if (action === "start" && g.phase === "lobby") {
        g.phase = "briefing"; g.round = 0; g.rules = arg.rules || R; g.briefing_ends_at = now + (arg.briefing_ms || 0); changed = true;
      } else if (action === "open" && (g.phase === "briefing" || g.phase === "reveal") && g.round < R.rounds) {
        if (!(arg.ms > 0)) throw fail("bad_arg");
        g.phase = "open"; g.round += 1; g.total_ms = arg.ms; g.ends_at = now + arg.ms; changed = true;
      } else if (action === "close" && g.phase === "open") {
        // The last round closes the game; any other round goes to a reveal, with the next round on a timer.
        if (g.round >= R.rounds) { g.phase = "locked"; g.view = "closed"; g.ends_at = null; }
        else { g.phase = "reveal"; g.ends_at = arg.reveal_ms > 0 ? now + arg.reveal_ms : null; }
        changed = true;
      } else if (action === "extend" && (g.phase === "open" || g.phase === "reveal") && g.ends_at) {
        if (!(arg.ms > 0)) throw fail("bad_arg");
        g.ends_at = Math.max(g.ends_at, now) + arg.ms;
        if (g.phase === "open") g.total_ms += arg.ms;
        changed = true;
      } else if (action === "hold" && g.phase === "reveal") {
        g.ends_at = null; changed = true;     // the next round waits for the host
      } else if (action === "view" && g.phase === "locked") {
        g.view = arg.view; changed = true;
      } else if (action === "reset") {
        g.players = []; g.deals = []; g.events = [];
        g.phase = "lobby"; g.round = 0; g.rules = null; g.view = "closed";
        g.briefing_ends_at = g.ends_at = g.total_ms = null; changed = true;
      }
      if (changed && action !== "reset") log(g, action, null, arg);
      if (changed) save(g);
      return { changed: changed };
    },

    // The host laptop deals the role cards (js/engine.js) and stores them here.
    hostApply: function (code, pin, patch) {
      var g = needHost(code, pin);
      (patch.players || []).forEach(function (u) {
        var p = byId(g.players, u.id);
        if (!p) return;
        ["role", "card", "pub"].forEach(function (k) { if (u[k] != null) p[k] = u[k]; });
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
  // A call that gets no answer is given up after 10 seconds, so one stuck connection cannot freeze a phone or the host.
  // The caller's loop simply asks again; every game action is safe to repeat.
  var RPC_TIMEOUT_MS = 10000;
  function rpc(fn, params) {
    var ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, RPC_TIMEOUT_MS) : null;
    function done() { if (timer) clearTimeout(timer); }
    return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey, Authorization: "Bearer " + cfg.supabaseKey },
      body: JSON.stringify(params),
      signal: ac ? ac.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        done();
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
        if (!res.ok) throw fail((body && body.message) || "server_" + res.status);
        return body;
      }, function () { done(); throw fail("network"); });
    }, function () { done(); throw fail("network"); });
  }

  var remoteApi = {
    createGame: function (pin) { return rpc("sim_create_game", { p_pin: String(pin) }); },
    join: function (code, name, token, bot) { return rpc("sim_join", { p_code: code, p_name: name, p_token: token, p_bot: !!bot }); },
    state: function (code, token) { return rpc("sim_round_state", { p_code: code, p_token: token }); },
    public: function (code) { return rpc("sim_round_public", { p_code: code }); },
    sign: function (code, token, sellerCode, kind) {
      return rpc("sim_sign", { p_code: code, p_token: token, p_seller_code: sellerCode == null ? null : String(sellerCode), p_kind: kind });
    },
    hostState: function (code, pin) { return rpc("sim_round_host_state", { p_code: code, p_pin: String(pin) }); },
    hostEvents: function (code, pin) { return rpc("sim_host_events", { p_code: code, p_pin: String(pin) }); },
    host: function (code, pin, action, arg) { return rpc("sim_round_host", { p_code: code, p_pin: String(pin), p_action: action, p_arg: arg || {} }); },
    hostApply: function (code, pin, patch) { return rpc("sim_round_apply", { p_code: code, p_pin: String(pin), p_patch: patch }); }
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
      not_open: "The round is not open right now.",
      already_decided: "You have already decided for this round.",
      bad_code: "No start-up has that deal code. Ask them to show you their phone.",
      seller_busy: "That start-up has already been signed this round. Try another, or stay.",
      no_pilot: "Pilots are not allowed in this round yet.",
      bad_arg: "That action could not be completed.",
      network: "No connection. Trying again…"
    };
    var code = e && e.code ? e.code : String(e && e.message ? e.message : e);
    return map[code] || "Something went wrong (" + code + ").";
  };
})(typeof window !== "undefined" ? window : globalThis);
