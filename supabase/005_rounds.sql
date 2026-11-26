-- The game as three short rounds around one gamble. Run after schema.sql and 002 to 004.
--
-- lobby -> briefing -> round 1 open -> reveal -> round 2 open -> reveal -> ... -> locked
-- A buyer makes one decision per round: stay, or sign a start-up (full deal or pilot) by typing its deal code.
-- A start-up can be signed by one buyer per round. Whether it delivers is fixed by its card ("ready"),
-- decided the moment the buyer signs, and shown to nobody until the round has closed.
--
-- These functions have new names (sim_round_*, sim_sign), so the functions of the earlier game are left
-- untouched. sim_create_game, sim_join and sim_host_events are shared with it.

alter table sim.games add column if not exists round int not null default 0;
alter table sim.games add column if not exists rules jsonb;          -- { rounds, pilotFrom, proofFrom }, set by the host at Start

create table if not exists sim.deals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references sim.games (id) on delete cascade,
  round int not null,
  buyer_id uuid not null references sim.players (id) on delete cascade,
  seller_id uuid references sim.players (id) on delete cascade,      -- null when the buyer stayed
  kind text not null,                                                 -- full | pilot | stay
  delivered boolean,                                                  -- null when the buyer stayed
  at timestamptz not null default clock_timestamp(),
  t int,                                                              -- seconds into the round
  unique (game_id, round, buyer_id)                                   -- one decision per buyer per round
);
create unique index if not exists deals_one_per_seller on sim.deals (game_id, round, seller_id) where seller_id is not null;
create index if not exists deals_game_idx on sim.deals (game_id);
alter table sim.deals enable row level security;
revoke all on sim.deals from anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function sim.round_rules(g sim.games) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(g.rules, '{"rounds": 3, "pilotFrom": 2, "proofFrom": 2}'::jsonb)
$$;

-- Rounds whose results everybody may see.
create or replace function sim.closed_rounds(g sim.games) returns int
language sql stable set search_path = '' as $$
  select case when g.phase = 'open' then greatest(0, g.round - 1)
              when g.phase in ('reveal', 'locked') then g.round else 0 end
$$;

create or replace function sim.round_game_view(g sim.games) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('code', g.code, 'phase', g.phase, 'round', g.round,
    'rounds', (sim.round_rules(g)->>'rounds')::int, 'rules', sim.round_rules(g),
    'briefing_ends_at', sim.ms(g.briefing_ends_at), 'ends_at', sim.ms(g.ends_at), 'total_ms', g.total_ms, 'view', g.view)
$$;

-- p_secret hides whether the start-up delivered (a decision in a round that is still open).
create or replace function sim.deal_view(d sim.deals, p_secret boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'round', d.round, 'buyer_id', d.buyer_id, 'seller_id', d.seller_id, 'kind', d.kind,
    'delivered', case when p_secret then null else d.delivered end, 'at', sim.ms(d.at), 't', d.t)
$$;

create or replace function sim.round_player_row(p sim.players, with_token boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'card', p.card, 'pub', p.pub,
    'is_bot', p.is_bot, 'joined_at', sim.ms(p.joined_at))
    || case when with_token then jsonb_build_object('token', p.token) else '{}'::jsonb end
$$;

create or replace function sim.closed_deals(g sim.games) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select jsonb_agg(sim.deal_view(d, false) order by d.round, d.at)
                   from sim.deals d where d.game_id = g.id and d.round <= sim.closed_rounds(g)), '[]'::jsonb)
$$;

-- ---------------------------------------------------------------- player: read
create or replace function public.sim_round_state(p_code text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; res jsonb; v_proof boolean;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then return null; end if;
  res := jsonb_build_object('now', sim.ms(clock_timestamp()), 'game', sim.round_game_view(g),
    'n_players', (select count(*) from sim.players where game_id = g.id),
    'me', 'null'::jsonb, 'mine', 'null'::jsonb, 'closed', sim.closed_deals(g), 'sellers', '[]'::jsonb);
  select * into me from sim.players where game_id = g.id and token = p_token;
  if not found then return res; end if;
  res := res || jsonb_build_object('me', sim.round_player_row(me, false));
  if g.phase = 'open' then
    res := res || jsonb_build_object('mine', coalesce((select sim.deal_view(d, true) from sim.deals d
      where d.game_id = g.id and d.round = g.round and (d.buyer_id = me.id or d.seller_id = me.id) limit 1), 'null'::jsonb));
  end if;
  if me.role = 'buyer' then
    v_proof := g.round >= coalesce((sim.round_rules(g)->>'proofFrom')::int, 99);
    res := res || jsonb_build_object('sellers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'org', s.pub->>'org', 'tagline', s.pub->>'tagline', 'is_bot', s.is_bot, 'code', s.card->>'code',
        'proof', case when v_proof then coalesce((s.card->>'proof')::boolean, false) else null end,
        'busy', g.phase = 'open' and exists (select 1 from sim.deals d where d.game_id = g.id and d.round = g.round and d.seller_id = s.id)
      ) order by s.joined_at) from sim.players s where s.game_id = g.id and s.role = 'seller'), '[]'::jsonb));
  end if;
  return res;
end $$;

-- What the projector may show. Results of a round appear only when it has closed.
create or replace function public.sim_round_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then return null; end if;
  return jsonb_build_object(
    'now', sim.ms(clock_timestamp()), 'game', sim.round_game_view(g),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'is_bot', p.is_bot,
                           'org', p.pub->>'org') order by p.joined_at)
                         from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'decided_now', (select count(*) from sim.deals d where g.phase = 'open' and d.game_id = g.id and d.round = g.round),
    'signed_now', (select count(*) from sim.deals d where g.phase = 'open' and d.game_id = g.id and d.round = g.round and d.kind <> 'stay'),
    'closed', sim.closed_deals(g),
    'full', case when g.phase = 'locked' then jsonb_build_object(
        'players', coalesce((select jsonb_agg(sim.round_player_row(p, false) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
        'deals', coalesce((select jsonb_agg(sim.deal_view(d, false) order by d.round, d.at) from sim.deals d where d.game_id = g.id), '[]'::jsonb))
      else 'null'::jsonb end);
end $$;

-- ---------------------------------------------------------------- buyer: the one decision of the round
create or replace function public.sim_sign(p_code text, p_token text, p_seller_code text, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; s sim.players; v_seller uuid; v_delivered boolean;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is distinct from 'buyer' then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  if p_kind is null or p_kind not in ('full', 'pilot', 'stay') then raise exception 'bad_arg'; end if;
  if exists (select 1 from sim.deals d where d.game_id = g.id and d.round = g.round and d.buyer_id = me.id) then raise exception 'already_decided'; end if;
  if p_kind <> 'stay' then
    if p_kind = 'pilot' and g.round < coalesce((sim.round_rules(g)->>'pilotFrom')::int, 99) then raise exception 'no_pilot'; end if;
    select * into s from sim.players where game_id = g.id and role = 'seller' and card->>'code' = btrim(coalesce(p_seller_code, '')) for update;
    if not found then raise exception 'bad_code'; end if;
    if exists (select 1 from sim.deals d where d.game_id = g.id and d.round = g.round and d.seller_id = s.id) then raise exception 'seller_busy'; end if;
    v_seller := s.id;
    v_delivered := coalesce((s.card->>'ready')::boolean, false);
  end if;
  begin
    insert into sim.deals (game_id, round, buyer_id, seller_id, kind, delivered, t)
      values (g.id, g.round, me.id, v_seller, p_kind, v_delivered, sim.clock(g));
  exception when unique_violation then
    -- two phones at the same instant: the unique rules above decide
    if exists (select 1 from sim.deals d where d.game_id = g.id and d.round = g.round and d.buyer_id = me.id) then raise exception 'already_decided'; end if;
    raise exception 'seller_busy';
  end;
  perform sim.log(g, case when p_kind = 'stay' then 'stay' else 'sign' end, me.id,
    jsonb_build_object('round', g.round, 'seller', v_seller, 'kind', p_kind));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- host: read
create or replace function public.sim_round_host_state(p_code text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;
  return jsonb_build_object('now', sim.ms(clock_timestamp()), 'game', sim.round_game_view(g),
    'players', coalesce((select jsonb_agg(sim.round_player_row(p, p.is_bot) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'deals', coalesce((select jsonb_agg(sim.deal_view(d, false) order by d.round, d.at) from sim.deals d where d.game_id = g.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- host: controls
create or replace function public.sim_round_host(p_code text, p_pin text, p_action text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; v_changed boolean := false; v_ms bigint; v_rounds int;
begin
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;
  v_rounds := (sim.round_rules(g)->>'rounds')::int;

  if p_action = 'start' and g.phase = 'lobby' then
    update sim.games set phase = 'briefing', round = 0,
      rules = case when jsonb_typeof(p_arg->'rules') = 'object' then p_arg->'rules' else rules end,
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
    perform sim.log(g, p_action, null, p_arg || jsonb_build_object('round', g.round));
  end if;
  return jsonb_build_object('changed', v_changed);
end $$;

-- The host laptop deals the role cards (js/engine.js) and stores them here.
create or replace function public.sim_round_apply(p_code text, p_pin text, p_patch jsonb) returns jsonb
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
    pub = case when jsonb_typeof(u->'pub') = 'object' then u->'pub' else p.pub end
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
