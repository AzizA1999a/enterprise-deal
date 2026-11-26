-- The game as a marketing campaign. Run after schema.sql and 002 to 005.
--
-- lobby -> briefing (choose a target) -> round 1 open -> reveal -> ... -> last round -> locked
-- Every player runs a start-up. It goes after one large company, which has four people to get past
-- (manager, security, procurement, executive). In a round a start-up spends a small budget on marketing
-- moves; each move has a chance of opening the door it stands at, and this database rolls the dice.
-- A player also knows one person inside one company and can introduce a few classmates to that person.
--
-- These functions have new names (sim_camp_*), so the functions of the earlier games are left untouched.
-- sim_create_game, sim_join and sim_host_events are shared with them.
-- The numbers of the game (odds, budget, rounds) are sent by the host laptop at Start, from js/config.js.

alter table sim.players add column if not exists state jsonb;      -- the start-up's campaign so far

create table if not exists sim.moves (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references sim.games (id) on delete cascade,
  round int not null,
  player_id uuid not null references sim.players (id) on delete cascade,
  giant text not null,
  door int not null,
  move text not null,
  odds int,                                                         -- null for moves that open no door (case study, research)
  success boolean,
  via uuid,                                                         -- who made the introduction that was used
  at timestamptz not null default clock_timestamp(),
  t int                                                             -- seconds into the round
);
create index if not exists moves_game_idx on sim.moves (game_id);
alter table sim.moves enable row level security;
revoke all on sim.moves from anon, authenticated;

create table if not exists sim.intros (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references sim.games (id) on delete cascade,
  from_id uuid not null references sim.players (id) on delete cascade,
  to_id uuid not null references sim.players (id) on delete cascade,
  giant text not null,
  door int not null,
  used boolean not null default false,
  at timestamptz not null default clock_timestamp(),
  unique (game_id, from_id, to_id)                                  -- a player introduces a classmate once
);
create index if not exists intros_game_idx on sim.intros (game_id);
alter table sim.intros enable row level security;
revoke all on sim.intros from anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function sim.camp_new_state() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"giant": null, "message": null, "progress": 0, "aware": false, "researched": false, "self_used": false,
           "spent": {}, "rank": null, "signed_round": null, "vouched": 0}'::jsonb
$$;

-- p_secret: the host sees which message each company cares about; nobody else does.
create or replace function sim.camp_game_view(g sim.games, p_secret boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('code', g.code, 'phase', g.phase, 'round', g.round,
    'rounds', coalesce((g.rules->>'rounds')::int, 0),
    'rules', case when g.rules is null then 'null'::jsonb
                  when p_secret then g.rules
                  else g.rules || jsonb_build_object('giants',
                         coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(g.rules->'giants') k), '[]'::jsonb)) end,
    'briefing_ends_at', sim.ms(g.briefing_ends_at), 'ends_at', sim.ms(g.ends_at), 'total_ms', g.total_ms, 'view', g.view)
$$;

create or replace function sim.camp_player_row(p sim.players, with_token boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'card', p.card, 'pub', p.pub, 'state', p.state,
    'is_bot', p.is_bot, 'joined_at', sim.ms(p.joined_at))
    || case when with_token then jsonb_build_object('token', p.token) else '{}'::jsonb end
$$;

create or replace function sim.camp_move_view(m sim.moves) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'round', m.round, 'player_id', m.player_id, 'giant', m.giant, 'door', m.door, 'move', m.move,
    'odds', m.odds, 'success', m.success, 'via', m.via, 'at', sim.ms(m.at), 't', m.t)
$$;

create or replace function sim.camp_intro_view(i sim.intros) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'from_id', i.from_id, 'to_id', i.to_id, 'giant', i.giant, 'door', i.door, 'used', i.used, 'at', sim.ms(i.at))
$$;

create or replace function sim.camp_moves(g sim.games) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select jsonb_agg(sim.camp_move_view(m) order by m.at) from sim.moves m where m.game_id = g.id), '[]'::jsonb)
$$;

create or replace function sim.camp_intros(g sim.games) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select jsonb_agg(sim.camp_intro_view(i) order by i.at) from sim.intros i where i.game_id = g.id), '[]'::jsonb)
$$;

-- Does this player know which message their target cares about? (They researched it, or they know someone there.)
create or replace function sim.camp_knows(p sim.players) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((p.state->>'researched')::boolean, false)
      or (p.state->>'giant' is not null and p.card->'contact'->>'giant' = p.state->>'giant')
$$;

-- ---------------------------------------------------------------- player: read
create or replace function public.sim_camp_state(p_code text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; res jsonb;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then return null; end if;
  res := jsonb_build_object('now', sim.ms(clock_timestamp()), 'game', sim.camp_game_view(g, false),
    'n_players', (select count(*) from sim.players where game_id = g.id),
    'me', 'null'::jsonb, 'intros', '[]'::jsonb, 'given', '[]'::jsonb, 'moves', '[]'::jsonb, 'priority', 'null'::jsonb,
    'giants', coalesce((select jsonb_object_agg(x.giant, jsonb_build_object('taken', x.taken, 'signed', x.signed))
                        from (select p.state->>'giant' as giant, count(*) as taken, count(*) filter (where p.state->>'rank' is not null) as signed
                              from sim.players p where p.game_id = g.id and p.state->>'giant' is not null group by 1) x), '{}'::jsonb));
  select * into me from sim.players where game_id = g.id and token = p_token;
  if not found then return res; end if;
  res := res || jsonb_build_object('me', sim.camp_player_row(me, false));
  if me.role is null then return res; end if;
  res := res || jsonb_build_object(
    'intros', coalesce((select jsonb_agg(sim.camp_intro_view(i) || jsonb_build_object('from_name', coalesce(f.name, 'A classmate')) order by i.at)
                        from sim.intros i left join sim.players f on f.id = i.from_id where i.game_id = g.id and i.to_id = me.id), '[]'::jsonb),
    'given', coalesce((select jsonb_agg(sim.camp_intro_view(i) || jsonb_build_object('to_name', t.name, 'to_org', coalesce(t.pub->>'org', ''),
                                          'to_signed', t.state->>'rank' is not null) order by i.at)
                       from sim.intros i join sim.players t on t.id = i.to_id where i.game_id = g.id and i.from_id = me.id), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(sim.camp_move_view(m) order by m.at) from sim.moves m where m.game_id = g.id and m.player_id = me.id), '[]'::jsonb));
  if sim.camp_knows(me) then
    res := res || jsonb_build_object('priority', g.rules->'giants'->(me.state->>'giant')->'priority');
  end if;
  return res;
end $$;

-- What the projector may show: every start-up's progress, and every move made so far.
create or replace function public.sim_camp_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then return null; end if;
  return jsonb_build_object(
    'now', sim.ms(clock_timestamp()), 'game', sim.camp_game_view(g, false),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'is_bot', p.is_bot,
                           'org', p.pub->>'org', 'giant', p.state->>'giant', 'progress', coalesce((p.state->>'progress')::int, 0),
                           'rank', (p.state->>'rank')::int, 'aware', coalesce((p.state->>'aware')::boolean, false)) order by p.joined_at)
                         from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'moves', sim.camp_moves(g), 'intros', sim.camp_intros(g),
    'full', case when g.phase = 'locked' then jsonb_build_object(
        'players', coalesce((select jsonb_agg(sim.camp_player_row(p, false) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
        'moves', sim.camp_moves(g), 'intros', sim.camp_intros(g), 'rules', g.rules)
      else 'null'::jsonb end);
end $$;

-- ---------------------------------------------------------------- player: choose a target and a message
-- The company is fixed once the first move is made; the message can change at any time.
create or replace function public.sim_camp_target(p_code text, p_token text, p_giant text, p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; st jsonb;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is null then raise exception 'not_joined'; end if;
  if g.phase in ('lobby', 'locked') then raise exception 'not_open'; end if;
  st := coalesce(me.state, sim.camp_new_state());
  if p_giant is not null and p_giant is distinct from st->>'giant' then
    if not (g.rules->'giants' ? p_giant) then raise exception 'bad_arg'; end if;
    if st->>'giant' is not null and exists (select 1 from sim.moves m where m.game_id = g.id and m.player_id = me.id) then raise exception 'target_locked'; end if;
    st := st || jsonb_build_object('giant', p_giant);
  end if;
  if p_message is not null then
    if p_message not in ('cost', 'risk', 'speed') then raise exception 'bad_arg'; end if;
    st := st || jsonb_build_object('message', p_message);
  end if;
  update sim.players set state = st where id = me.id;
  perform sim.log(g, 'target', me.id, jsonb_build_object('giant', st->'giant', 'message', st->'message'));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- player: one marketing move
-- p_intro: for the move "intro", the introduction to use, or 'self' for the player's own contact.
create or replace function public.sim_camp_move(p_code text, p_token text, p_move text, p_intro text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; i sim.intros; R jsonb; st jsonb; def jsonb;
  v_cost int; v_spent int; v_door int; v_odds numeric; v_success boolean; v_via uuid; v_giant text; v_priority text; v_rank int;
begin
  -- One move at a time per game, so two start-ups finishing together get a clear order.
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is null then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  R := g.rules; st := coalesce(me.state, sim.camp_new_state()); def := R->'moves'->p_move;
  if p_move is null or def is null then raise exception 'bad_arg'; end if;
  v_giant := st->>'giant';
  if v_giant is null then raise exception 'no_target'; end if;
  v_door := coalesce((st->>'progress')::int, 0);
  if v_door >= 4 then raise exception 'done'; end if;
  v_cost := (def->>'cost')::int;
  v_spent := coalesce((st->'spent'->>(g.round::text))::int, 0);
  if v_cost > (R->>'budget')::int - v_spent then raise exception 'no_budget'; end if;

  if p_move = 'content' then
    if coalesce((st->>'aware')::boolean, false) then raise exception 'already_done'; end if;
    st := st || '{"aware": true}'::jsonb;
  elsif p_move = 'research' then
    if coalesce((st->>'researched')::boolean, false) then raise exception 'already_done'; end if;
    st := st || '{"researched": true}'::jsonb;
  else
    if p_move = 'intro' then
      if p_intro = 'self' then
        if coalesce((st->>'self_used')::boolean, false) or me.card->'contact'->>'giant' is distinct from v_giant
           or (me.card->'contact'->>'door')::int is distinct from v_door then raise exception 'no_intro'; end if;
        st := st || '{"self_used": true}'::jsonb;
        v_via := me.id;
      else
        begin
          select * into i from sim.intros where game_id = g.id and id = p_intro::uuid for update;
        exception when others then raise exception 'no_intro';
        end;
        if i.id is null or i.to_id <> me.id or i.used or i.giant <> v_giant or i.door <> v_door then raise exception 'no_intro'; end if;
        update sim.intros set used = true where id = i.id;
        v_via := i.from_id;
      end if;
      v_odds := (def->>'odds')::numeric;                    -- an introduction is worth the same to anyone
    else
      v_odds := case when jsonb_typeof(def->'odds') = 'array' then (def->'odds'->>v_door)::numeric else (def->>'odds')::numeric end;
      if v_odds is null then raise exception 'bad_arg'; end if;
      if coalesce((st->>'aware')::boolean, false) then v_odds := v_odds + coalesce((R->>'awareBoost')::numeric, 0); end if;
      v_odds := least(95, greatest(2, v_odds));
      v_priority := R->'giants'->v_giant->>'priority';
      if (R->'fitDoors') @> to_jsonb(v_door) and st->>'message' is not null and v_priority is not null then
        v_odds := v_odds + case when st->>'message' = v_priority then coalesce((R->>'fit')::numeric, 0) else -coalesce((R->>'misfit')::numeric, 0) end;
        v_odds := least(95, greatest(2, v_odds));
      end if;
    end if;
    v_success := random() * 100 < v_odds;
    if v_success then
      st := st || jsonb_build_object('progress', v_door + 1);
      if v_door + 1 >= 4 then
        v_rank := 1 + (select count(*) from sim.players p where p.game_id = g.id and p.id <> me.id and p.state->>'giant' = v_giant and p.state->>'rank' is not null);
        st := st || jsonb_build_object('rank', v_rank, 'signed_round', g.round);
      end if;
    end if;
  end if;

  st := jsonb_set(st || case when jsonb_typeof(st->'spent') = 'object' then '{}'::jsonb else '{"spent": {}}'::jsonb end,
                  array['spent', g.round::text], to_jsonb(v_spent + v_cost), true);
  update sim.players set state = st where id = me.id;
  insert into sim.moves (game_id, round, player_id, giant, door, move, odds, success, via, t)
    values (g.id, g.round, me.id, v_giant, v_door, p_move, round(v_odds)::int, v_success, v_via, sim.clock(g));
  perform sim.log(g, 'move', me.id, jsonb_build_object('round', g.round, 'move', p_move, 'giant', v_giant, 'door', v_door,
    'odds', round(v_odds)::int, 'success', v_success, 'via', v_via));
  return jsonb_build_object('move', p_move, 'door', v_door, 'odds', round(v_odds)::int, 'success', v_success,
    'progress', (st->>'progress')::int, 'rank', (st->>'rank')::int);
end $$;

-- ---------------------------------------------------------------- player: introduce a classmate
-- The classmate can then use the introduction at the door of the person this player knows.
create or replace function public.sim_camp_vouch(p_code text, p_token text, p_startup_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; t sim.players; st jsonb;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is null then raise exception 'not_joined'; end if;
  if g.phase in ('lobby', 'locked') then raise exception 'not_open'; end if;
  select * into t from sim.players where game_id = g.id and role is not null and card->>'code' = btrim(coalesce(p_startup_code, ''));
  if not found or t.id = me.id then raise exception 'bad_code'; end if;
  st := coalesce(me.state, sim.camp_new_state());
  if coalesce((st->>'vouched')::int, 0) >= coalesce((g.rules->>'vouches')::int, 0) then raise exception 'no_vouches'; end if;
  begin
    insert into sim.intros (game_id, from_id, to_id, giant, door)
      values (g.id, me.id, t.id, me.card->'contact'->>'giant', (me.card->'contact'->>'door')::int);
  exception when unique_violation then raise exception 'already_vouched';
  end;
  update sim.players set state = st || jsonb_build_object('vouched', coalesce((st->>'vouched')::int, 0) + 1) where id = me.id;
  perform sim.log(g, 'vouch', me.id, jsonb_build_object('to', t.id, 'giant', me.card->'contact'->'giant', 'door', me.card->'contact'->'door'));
  return jsonb_build_object('ok', true, 'to_name', t.name, 'to_org', coalesce(t.pub->>'org', ''));
end $$;

-- ---------------------------------------------------------------- host: read
create or replace function public.sim_camp_host_state(p_code text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;
  return jsonb_build_object('now', sim.ms(clock_timestamp()), 'game', sim.camp_game_view(g, true),
    'players', coalesce((select jsonb_agg(sim.camp_player_row(p, p.is_bot) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'moves', sim.camp_moves(g), 'intros', sim.camp_intros(g));
end $$;

-- ---------------------------------------------------------------- host: controls
create or replace function public.sim_camp_host(p_code text, p_pin text, p_action text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; v_changed boolean := false; v_ms bigint; v_rounds int;
begin
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;
  v_rounds := coalesce((g.rules->>'rounds')::int, 0);

  if p_action = 'start' and g.phase = 'lobby' then
    if jsonb_typeof(p_arg->'rules'->'giants') is distinct from 'object' then raise exception 'bad_arg'; end if;
    update sim.games set phase = 'briefing', round = 0, rules = p_arg->'rules',
      briefing_ends_at = clock_timestamp() + make_interval(secs => coalesce((p_arg->>'briefing_ms')::numeric, 0) / 1000.0) where id = g.id;
    v_changed := true;
  elsif p_action = 'open' and g.phase in ('briefing', 'reveal') and g.round < v_rounds then
    v_ms := (p_arg->>'ms')::bigint;
    if v_ms is null or v_ms <= 0 then raise exception 'bad_arg'; end if;
    update sim.games set phase = 'open', round = round + 1, opened_at = clock_timestamp(), total_ms = v_ms, paused_ms = null,
      ends_at = clock_timestamp() + make_interval(secs => v_ms / 1000.0) where id = g.id;
    v_changed := true;
  elsif p_action = 'close' and g.phase = 'open' then
    -- The last round closes the game; any other round goes to a reveal, with the next round on a timer.
    if g.round >= v_rounds then
      update sim.games set phase = 'locked', view = 'closed', ends_at = null where id = g.id;
    else
      v_ms := coalesce((p_arg->>'reveal_ms')::bigint, 0);
      update sim.games set phase = 'reveal',
        ends_at = case when v_ms > 0 then clock_timestamp() + make_interval(secs => v_ms / 1000.0) else null end where id = g.id;
    end if;
    v_changed := true;
  elsif p_action = 'extend' and g.phase in ('open', 'reveal') and g.ends_at is not null then
    v_ms := (p_arg->>'ms')::bigint;
    if v_ms is null or v_ms <= 0 then raise exception 'bad_arg'; end if;
    update sim.games set ends_at = greatest(ends_at, clock_timestamp()) + make_interval(secs => v_ms / 1000.0),
      total_ms = case when phase = 'open' then total_ms + v_ms else total_ms end where id = g.id;
    v_changed := true;
  elsif p_action = 'hold' and g.phase = 'reveal' then
    update sim.games set ends_at = null where id = g.id;        -- the next round waits for the host
    v_changed := true;
  elsif p_action = 'view' and g.phase = 'locked' then
    if (p_arg->>'view') not in ('closed', 'quick', 'full1', 'full2') then raise exception 'bad_arg'; end if;
    update sim.games set view = p_arg->>'view' where id = g.id;
    v_changed := true;
  elsif p_action = 'reset' then
    delete from sim.moves where game_id = g.id;
    delete from sim.intros where game_id = g.id;
    delete from sim.deals where game_id = g.id;
    delete from sim.offers where game_id = g.id;
    delete from sim.players where game_id = g.id;
    delete from sim.events where game_id = g.id;
    update sim.games set phase = 'lobby', round = 0, rules = null, view = 'closed', briefing_ends_at = null, opened_at = null,
      ends_at = null, paused_ms = null, total_ms = null where id = g.id;
    return jsonb_build_object('changed', true);
  end if;

  if v_changed then
    select * into g from sim.games where id = g.id;
    perform sim.log(g, p_action, null, case when p_action = 'start' then jsonb_build_object('briefing_ms', p_arg->'briefing_ms')
                                            else p_arg || jsonb_build_object('round', g.round) end);
  end if;
  return jsonb_build_object('changed', v_changed);
end $$;

-- The host laptop deals the start-up cards (js/engine.js) and stores them here. A newly dealt player starts with a clean state.
create or replace function public.sim_camp_apply(p_code text, p_pin text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;

  update sim.players p set
    role = coalesce(u->>'role', p.role),
    card = case when jsonb_typeof(u->'card') = 'object' then u->'card' else p.card end,
    pub = case when jsonb_typeof(u->'pub') = 'object' then u->'pub' else p.pub end,
    state = coalesce(p.state, sim.camp_new_state())
  from jsonb_array_elements(coalesce(p_patch->'players', '[]'::jsonb)) u
  where p.game_id = g.id and p.id = (u->>'id')::uuid;

  insert into sim.events (game_id, t, type, actor, data)
  select g.id, sim.clock(g), left(e->>'type', 40), nullif(e->>'actor', '')::uuid, e->'data'
  from jsonb_array_elements(coalesce(p_patch->'events', '[]'::jsonb)) with ordinality as x(e, n)
  where e->>'type' is not null and n <= 200
  order by n;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permissions
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sim\_%' loop
    execute 'revoke all on function ' || f || ' from public';
    execute 'grant execute on function ' || f || ' to anon, authenticated';
  end loop;
end $$;
