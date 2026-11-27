/* Data layer. Two interchangeable back ends:
     B2B.localApi   the whole game kept in this browser (offline demo mode)
     B2B.remoteApi  Supabase database functions (the live class game)
   Every call returns a Promise. Failures reject with an Error whose .code is a short keyword.

   The game: lobby -> briefing (choose a target) -> round 1 open -> reveal -> ... -> last round -> locked.
   Every player runs a start-up. In a round a start-up spends its budget on marketing moves; the referee
   (this file offline, the database online) rolls each move against its odds and records the result. */
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
  // A game saved by an earlier version of this site is treated as not there.
  function load(code) {
    var s = store.getItem(KEY + String(code || "").toUpperCase()), g = s ? JSON.parse(s) : null;
    return g && Array.isArray(g.moves) && Array.isArray(g.intros) ? g : null;
  }
  function save(g) { store.setItem(KEY + g.code, JSON.stringify(g)); }
  function need(code) { var g = load(code); if (!g) throw fail("no_game"); return g; }
  function needHost(code, pin) { var g = need(code); if (g.pin !== String(pin)) throw fail("bad_pin"); return g; }
  function byToken(g, token) { return g.players.filter(function (p) { return p.token === token; })[0] || null; }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
  // Seconds into the current round; null outside a round.
  function clock(g, now) { return g.phase === "open" ? Math.max(0, Math.round(((g.total_ms || 0) - Math.max(0, g.ends_at - now)) / 1000)) : null; }
  function log(g, type, actor, data) {
    var now = Date.now();
    g.events.push({ at: now, round: g.round || 0, t: clock(g, now), type: type, actor: actor || null, data: data || null });
  }
  // What everybody may know about the rules: all of it, except which message each giant cares about.
  function publicRules(g) {
    if (!g.rules) return null;
    var r = JSON.parse(JSON.stringify(g.rules));
    r.giants = Object.keys(r.giants || {});
    return r;
  }
  function gameView(g, secret) {
    return { code: g.code, phase: g.phase, round: g.round || 0, rounds: g.rules ? g.rules.rounds : 0, rules: secret ? g.rules : publicRules(g),
             briefing_ends_at: g.briefing_ends_at, ends_at: g.ends_at, total_ms: g.total_ms, view: g.view };
  }
  function playerRow(p, withToken) {
    var r = { id: p.id, name: p.name, role: p.role, card: p.card, pub: p.pub, state: p.state, is_bot: p.is_bot, joined_at: p.joined_at };
    if (withToken) r.token = p.token;
    return r;
  }
  function publicPlayer(p) {
    var s = p.state || {};
    return { id: p.id, name: p.name, role: p.role, is_bot: p.is_bot, org: p.pub ? p.pub.org : null,
             giant: s.giant || null, progress: s.progress || 0, rank: s.rank == null ? null : s.rank, aware: !!s.aware };
  }
  function moveView(m) { return { id: m.id, round: m.round, player_id: m.player_id, giant: m.giant, door: m.door, move: m.move, odds: m.odds, success: m.success, via: m.via || null, at: m.at, t: m.t }; }
  function introView(i) { return { id: i.id, from_id: i.from_id, to_id: i.to_id, giant: i.giant, door: i.door, used: !!i.used, at: i.at }; }
  function hasMoved(g, p) { return g.moves.some(function (m) { return m.player_id === p.id; }); }

  var local = {
    createGame: function (pin) {
      var letters = "ABCDEFGHJKLMNPQRSTUVWXYZ", code;
      do {
        code = "";
        for (var i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
      } while (load(code));
      save({ code: code, pin: String(pin), phase: "lobby", round: 0, rules: null, view: "closed", briefing_ends_at: null,
             ends_at: null, total_ms: null, players: [], moves: [], intros: [], events: [], created_at: Date.now() });
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
      me = { id: uid(), name: name, token: token, role: null, card: null, pub: null, state: null, is_bot: !!bot, joined_at: Date.now() };
      g.players.push(me);
      log(g, "join", me.id, { name: name });
      save(g);
      return { id: me.id, name: me.name };
    },

    // What one phone may know.
    state: function (code, token) {
      var g = load(code);
      if (!g) return null;
      var names = {};
      g.players.forEach(function (p) { names[p.id] = p; });
      var taken = {};
      g.players.forEach(function (p) {
        var s = p.state;
        if (!s || !s.giant) return;
        var t = taken[s.giant] || (taken[s.giant] = { taken: 0, signed: 0 });
        t.taken++; if (s.rank != null) t.signed++;
      });
      var out = { now: Date.now(), game: gameView(g), n_players: g.players.length, me: null, intros: [], given: [], giants: taken, moves: [], priority: null };
      var me = byToken(g, token);
      if (!me) return out;
      out.me = playerRow(me);
      if (!me.role) return out;
      out.intros = g.intros.filter(function (i) { return i.to_id === me.id; }).map(function (i) {
        var v = introView(i), f = names[i.from_id];
        v.from_name = f ? f.name : "A classmate";
        return v;
      });
      out.given = g.intros.filter(function (i) { return i.from_id === me.id; }).map(function (i) {
        var v = introView(i), t = names[i.to_id];
        v.to_name = t ? t.name : ""; v.to_org = t && t.pub ? t.pub.org : "";
        v.to_signed = !!(t && t.state && t.state.rank != null);
        return v;
      });
      out.moves = g.moves.filter(function (m) { return m.player_id === me.id; }).map(moveView);
      if (me.state && me.state.giant && B2B.engine.knowsPriority(me.card, me.state)) out.priority = g.rules.giants[me.state.giant].priority;
      return out;
    },

    // What the projector may show: every start-up's progress, and every move made so far.
    public: function (code) {
      var g = load(code);
      if (!g) return null;
      return {
        now: Date.now(), game: gameView(g),
        players: g.players.map(publicPlayer),
        moves: g.moves.map(moveView), intros: g.intros.map(introView),
        full: g.phase === "locked" ? { players: g.players.map(function (p) { return playerRow(p); }), moves: g.moves.map(moveView),
                                       intros: g.intros.map(introView), rules: g.rules } : null
      };
    },

    // Choose (or change) the giant to go after, and the message to lead with.
    // The giant is fixed once the first move is made; the message can change at any time.
    target: function (code, token, giant, message) {
      var g = need(code), me = byToken(g, token);
      if (!me || !me.role) throw fail("not_joined");
      if (g.phase === "lobby" || g.phase === "locked") throw fail("not_open");
      var st = me.state;
      if (giant != null && giant !== st.giant) {
        if (!g.rules.giants[giant]) throw fail("bad_arg");
        if (st.giant && hasMoved(g, me)) throw fail("target_locked");
        st.giant = giant;
      }
      if (message != null) {
        if (B2B.engine.MESSAGES.indexOf(message) < 0) throw fail("bad_arg");
        st.message = message;
      }
      log(g, "target", me.id, { giant: st.giant, message: st.message });
      save(g);
      return { ok: true };
    },

    // One marketing move. introId: for "intro", the introduction to use, or "self" for the player's own contact.
    move: function (code, token, move, introId) {
      var g = need(code), me = byToken(g, token), E = B2B.engine;
      if (!me || !me.role) throw fail("not_joined");
      if (g.phase !== "open" || Date.now() >= g.ends_at) throw fail("not_open");
      var R = g.rules, st = me.state, def = R.moves[move];
      if (!def) throw fail("bad_arg");
      if (!st.giant) throw fail("no_target");
      if (st.progress >= E.DOORS) throw fail("done");
      if (def.cost > E.budgetLeft(R, st, g.round)) throw fail("no_budget");
      var door = st.progress, now = Date.now(), row = { id: uid(), round: g.round, player_id: me.id, giant: st.giant, door: door, move: move,
                                                         odds: null, success: null, via: null, at: now, t: clock(g, now) };
      if (move === "content") {
        if (st.aware) throw fail("already_done");
        st.aware = true;
      } else if (move === "research") {
        if (st.researched) throw fail("already_done");
        st.researched = true;
      } else {
        if (move === "intro") {
          if (introId === "self") {
            if (st.self_used || !me.card.contact || me.card.contact.giant !== st.giant || me.card.contact.door !== door) throw fail("no_intro");
            st.self_used = true; row.via = me.id;
          } else {
            var intro = byId(g.intros, introId);
            if (!intro || intro.to_id !== me.id || intro.used || intro.giant !== st.giant || intro.door !== door) throw fail("no_intro");
            intro.used = true; row.via = intro.from_id;
          }
        }
        row.odds = E.odds(R, move, door, st, R.giants[st.giant].priority);
        row.success = Math.random() * 100 < row.odds;
        if (row.success) {
          st.progress += 1;
          if (st.progress >= E.DOORS) {
            st.rank = 1 + g.players.filter(function (p) { return p.state && p.state.giant === st.giant && p.state.rank != null; }).length;
            st.signed_round = g.round;
          }
        }
      }
      st.spent[g.round] = E.spentIn(st, g.round) + def.cost;
      g.moves.push(row);
      log(g, "move", me.id, { round: g.round, move: move, giant: st.giant, door: door, odds: row.odds, success: row.success, via: row.via });
      save(g);
      return { move: move, door: door, odds: row.odds, success: row.success, progress: st.progress, rank: st.rank };
    },

    // Introduce a classmate to the person this player knows. A player can do this a few times per game.
    vouch: function (code, token, startupCode) {
      var g = need(code), me = byToken(g, token);
      if (!me || !me.role) throw fail("not_joined");
      if (g.phase === "lobby" || g.phase === "locked") throw fail("not_open");
      var to = g.players.filter(function (p) { return p.role && p.card.code === String(startupCode || "").trim(); })[0];
      if (!to || to.id === me.id) throw fail("bad_code");
      if (me.state.vouched >= g.rules.vouches) throw fail("no_vouches");
      if (g.intros.some(function (i) { return i.from_id === me.id && i.to_id === to.id; })) throw fail("already_vouched");
      var c = me.card.contact;
      g.intros.push({ id: uid(), from_id: me.id, to_id: to.id, giant: c.giant, door: c.door, used: false, at: Date.now() });
      me.state.vouched += 1;
      log(g, "vouch", me.id, { to: to.id, giant: c.giant, door: c.door });
      save(g);
      return { ok: true, to_name: to.name, to_org: to.pub.org };
    },

    hostState: function (code, pin) {
      var g = needHost(code, pin);
      return { now: Date.now(), game: gameView(g, true),
               players: g.players.map(function (p) { return playerRow(p, p.is_bot); }),
               moves: g.moves.map(moveView), intros: g.intros.map(introView) };
    },

    hostEvents: function (code, pin) { return needHost(code, pin).events.slice(); },

    host: function (code, pin, action, arg) {
      var g = needHost(code, pin), now = Date.now(), changed = false, rounds = g.rules ? g.rules.rounds : 0;
      arg = arg || {};
      if (action === "start" && g.phase === "lobby") {
        if (!arg.rules || !arg.rules.giants) throw fail("bad_arg");
        g.phase = "briefing"; g.round = 0; g.rules = arg.rules; g.briefing_ends_at = now + (arg.briefing_ms || 0); changed = true;
      } else if (action === "open" && (g.phase === "briefing" || g.phase === "reveal") && g.round < rounds) {
        if (!(arg.ms > 0)) throw fail("bad_arg");
        g.phase = "open"; g.round += 1; g.total_ms = arg.ms; g.ends_at = now + arg.ms; changed = true;
      } else if (action === "close" && g.phase === "open") {
        // The last round closes the game; any other round goes to a reveal, with the next round on a timer.
        if (g.round >= rounds) { g.phase = "locked"; g.view = "closed"; g.ends_at = null; }
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
        g.players = []; g.moves = []; g.intros = []; g.events = [];
        g.phase = "lobby"; g.round = 0; g.rules = null; g.view = "closed";
        g.briefing_ends_at = g.ends_at = g.total_ms = null; changed = true;
      }
      if (changed && action !== "reset") log(g, action, null, action === "start" ? { briefing_ms: arg.briefing_ms } : arg);
      if (changed) save(g);
      return { changed: changed };
    },

    // The host laptop deals the role cards (js/engine.js) and stores them here. A newly dealt player starts with a clean state.
    hostApply: function (code, pin, patch) {
      var g = needHost(code, pin);
      (patch.players || []).forEach(function (u) {
        var p = byId(g.players, u.id);
        if (!p) return;
        ["role", "card", "pub"].forEach(function (k) { if (u[k] != null) p[k] = u[k]; });
        if (!p.state) p.state = B2B.engine.newState();
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
  // The caller's loop simply asks again. (A move is the one call that is not repeated automatically.)
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
    state: function (code, token) { return rpc("sim_camp_state", { p_code: code, p_token: token }); },
    public: function (code) { return rpc("sim_camp_public", { p_code: code }); },
    target: function (code, token, giant, message) { return rpc("sim_camp_target", { p_code: code, p_token: token, p_giant: giant == null ? null : giant, p_message: message == null ? null : message }); },
    move: function (code, token, move, introId) { return rpc("sim_camp_move", { p_code: code, p_token: token, p_move: move, p_intro: introId == null ? null : String(introId) }); },
    vouch: function (code, token, startupCode) { return rpc("sim_camp_vouch", { p_code: code, p_token: token, p_startup_code: String(startupCode == null ? "" : startupCode) }); },
    hostState: function (code, pin) { return rpc("sim_camp_host_state", { p_code: code, p_pin: String(pin) }); },
    hostEvents: function (code, pin) { return rpc("sim_host_events", { p_code: code, p_pin: String(pin) }); },
    host: function (code, pin, action, arg) { return rpc("sim_camp_host", { p_code: code, p_pin: String(pin), p_action: action, p_arg: arg || {} }); },
    hostApply: function (code, pin, patch) { return rpc("sim_camp_apply", { p_code: code, p_pin: String(pin), p_patch: patch }); }
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
      no_target: "Choose the company you are going after first.",
      target_locked: "You have already started on this company. You cannot switch now.",
      no_budget: "Not enough budget left this round.",
      already_done: "You have already done that.",
      done: "You already have the signature.",
      no_intro: "That introduction cannot be used here.",
      bad_code: "No classmate has that code. Ask them to show you their phone.",
      no_vouches: "You have no introductions left to give.",
      already_vouched: "You have already introduced that start-up.",
      bad_arg: "That action could not be completed.",
      network: "No connection. Trying again…"
    };
    var code = e && e.code ? e.code : String(e && e.message ? e.message : e);
    return map[code] || "Something went wrong (" + code + ").";
  };
})(typeof window !== "undefined" ? window : globalThis);
