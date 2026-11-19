-- The Enterprise Deal: database for the live class game.
-- Tables live in a private schema ("sim") that the public API cannot reach.
-- Phones and screens can only call the sim_* functions below, which enforce the rules.
-- This mirrors the offline store in js/api.js call for call.

create schema if not exists sim;

create table if not exists sim.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  pin text not null,
  phase text not null default 'lobby',      -- lobby | briefing | open | paused | locked
  view text not null default 'closed',      -- projector view once locked
  briefing_ends_at timestamptz,
  opened_at timestamptz,
  ends_at timestamptz,
  paused_ms bigint,
  total_ms bigint,
  created_at timestamptz not null default now()
);

create table if not exists sim.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references sim.games (id) on delete cascade,
  name text not null,
  token text not null,                      -- secret, kept on the player's phone
  role text,                                -- seller | buyer
  category text,
  card jsonb,                               -- private role card, including connections
  pub jsonb,                                -- what other players may see
  is_bot boolean not null default false,
  offers_left int,
  decision text,                            -- startup | incumbent | incumbent_default
  decided_at timestamptz,
  decided_t int,
  points int,
  exit_answer text,
  exit_at timestamptz,
  joined_at timestamptz not null default now(),
  unique (game_id, token)
);
create index if not exists players_game_idx on sim.players (game_id);

create table if not exists sim.offers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references sim.games (id) on delete cascade,
  seller_id uuid not null references sim.players (id) on delete cascade,
  buyer_id uuid not null references sim.players (id) on delete cascade,
  price numeric not null,
  pilot boolean not null default false,
  proof jsonb not null default '[]'::jsonb,
  status text not null default 'pending',   -- pending | accepted | rejected | lost | lost_incumbent | expired
  reason text,
  created_at timestamptz not null default now(),
  sent_t int,                               -- seconds of market clock when sent
  decided_at timestamptz,
  decided_t int,
  delivered boolean,
  seller_points int
);
create index if not exists offers_game_idx on sim.offers (game_id);
create index if not exists offers_seller_idx on sim.offers (seller_id);
create index if not exists offers_buyer_idx on sim.offers (buyer_id);

create table if not exists sim.events (
  id bigint generated always as identity primary key,
  game_id uuid not null references sim.games (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  t int,
  type text not null,
  actor uuid,
  data jsonb
);
create index if not exists events_game_idx on sim.events (game_id);

alter table sim.games enable row level security;
alter table sim.players enable row level security;
alter table sim.offers enable row level security;
alter table sim.events enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function sim.ms(ts timestamptz) returns bigint
language sql immutable set search_path = '' as $$
  select (extract(epoch from ts) * 1000)::bigint
$$;

-- Seconds of market clock elapsed (pauses excluded); null outside the market.
create or replace function sim.clock(g sim.games) returns int
language sql stable set search_path = '' as $$
  select case
    when g.phase = 'paused' then round((g.total_ms - coalesce(g.paused_ms, 0)) / 1000.0)::int
    when g.phase = 'open' then round((g.total_ms - greatest(0, sim.ms(g.ends_at) - sim.ms(clock_timestamp()))) / 1000.0)::int
    else null end
$$;

create or replace function sim.game_view(g sim.games) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('code', g.code, 'phase', g.phase, 'briefing_ends_at', sim.ms(g.briefing_ends_at),
    'opened_at', sim.ms(g.opened_at), 'ends_at', sim.ms(g.ends_at), 'paused_ms', g.paused_ms, 'total_ms', g.total_ms, 'view', g.view)
$$;

create or replace function sim.offer_view(o sim.offers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'seller_id', o.seller_id, 'buyer_id', o.buyer_id, 'price', o.price, 'pilot', o.pilot,
    'proof', o.proof, 'status', o.status, 'reason', o.reason, 'created_at', sim.ms(o.created_at), 'sent_t', o.sent_t,
    'decided_at', sim.ms(o.decided_at), 'decided_t', o.decided_t, 'delivered', o.delivered, 'seller_points', o.seller_points)
$$;

create or replace function sim.player_row(p sim.players, with_token boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'category', p.category, 'card', p.card, 'pub', p.pub,
    'is_bot', p.is_bot, 'offers_left', p.offers_left, 'decision', p.decision, 'decided_at', sim.ms(p.decided_at),
    'decided_t', p.decided_t, 'points', p.points, 'exit_answer', p.exit_answer, 'exit_at', sim.ms(p.exit_at),
    'joined_at', sim.ms(p.joined_at))
    || case when with_token then jsonb_build_object('token', p.token) else '{}'::jsonb end
$$;

create or replace function sim.log(g sim.games, p_type text, p_actor uuid, p_data jsonb) returns void
language sql set search_path = '' as $$
  insert into sim.events (game_id, t, type, actor, data) values (g.id, sim.clock(g), p_type, p_actor, p_data)
$$;

-- ---------------------------------------------------------------- host: create
create or replace function public.sim_create_game(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
begin
  if p_pin is null or length(p_pin) < 4 then raise exception 'bad_pin'; end if;
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    exit when not exists (select 1 from sim.games where code = v_code);
  end loop;
  insert into sim.games (code, pin) values (v_code, p_pin);
  return jsonb_build_object('code', v_code);
end $$;

-- ---------------------------------------------------------------- player: join
create or replace function public.sim_join(p_code text, p_name text, p_token text, p_bot boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; v_name text; v_base text; n int := 1;
begin
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token;
  if found then return jsonb_build_object('id', me.id, 'name', me.name); end if;
  if g.phase = 'locked' then raise exception 'closed'; end if;
  if p_token is null or length(p_token) < 8 then raise exception 'not_joined'; end if;
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  if v_name = '' then raise exception 'bad_name'; end if;
  if (select count(*) from sim.players where game_id = g.id) >= 200 then raise exception 'closed'; end if;
  v_base := v_name;
  while exists (select 1 from sim.players where game_id = g.id and lower(name) = lower(v_name)) loop
    n := n + 1;
    v_name := v_base || ' ' || n;
  end loop;
  insert into sim.players (game_id, name, token, is_bot) values (g.id, v_name, p_token, coalesce(p_bot, false)) returning * into me;
  perform sim.log(g, 'join', me.id, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', me.id, 'name', me.name);
end $$;

-- ---------------------------------------------------------------- player: read
create or replace function public.sim_state(p_code text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; res jsonb;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then return null; end if;
  res := jsonb_build_object('now', sim.ms(clock_timestamp()), 'game', sim.game_view(g),
    'n_players', (select count(*) from sim.players where game_id = g.id),
    'me', 'null'::jsonb, 'buyers', '[]'::jsonb, 'offers', '[]'::jsonb);
  select * into me from sim.players where game_id = g.id and token = p_token;
  if not found then return res; end if;
  res := res || jsonb_build_object('me', sim.player_row(me, false));
  if me.role = 'seller' then
    res := res || jsonb_build_object(
      'buyers', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'pub', b.pub, 'decided', b.decision is not null) order by b.name)
                          from sim.players b where b.game_id = g.id and b.role = 'buyer' and b.category = me.category), '[]'::jsonb),
      'offers', coalesce((select jsonb_agg(sim.offer_view(o) order by o.created_at) from sim.offers o where o.seller_id = me.id), '[]'::jsonb));
  elsif me.role = 'buyer' then
    res := res || jsonb_build_object(
      'offers', coalesce((select jsonb_agg(sim.offer_view(o) || jsonb_build_object('seller', jsonb_build_object('name', s.name, 'pub', s.pub)) order by o.created_at)
                          from sim.offers o join sim.players s on s.id = o.seller_id where o.buyer_id = me.id), '[]'::jsonb));
  end if;
  return res;
end $$;

-- What the projector may show. Full data only once the market is locked.
create or replace function public.sim_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then return null; end if;
  return jsonb_build_object(
    'now', sim.ms(clock_timestamp()), 'game', sim.game_view(g),
    'n_offers', (select count(*) from sim.offers where game_id = g.id),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'is_bot', p.is_bot,
                           'org', p.pub->>'org', 'decision', p.decision, 'decided_t', p.decided_t, 'exit_done', p.exit_answer is not null) order by p.joined_at)
                         from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'deals', coalesce((select jsonb_agg(jsonb_build_object('seller_id', o.seller_id, 'buyer_id', o.buyer_id, 'decided_t', o.decided_t, 'delivered', o.delivered) order by o.decided_at)
                       from sim.offers o where o.game_id = g.id and o.status = 'accepted'), '[]'::jsonb),
    'full', case when g.phase = 'locked' then jsonb_build_object(
        'players', coalesce((select jsonb_agg(sim.player_row(p, false) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
        'offers', coalesce((select jsonb_agg(sim.offer_view(o) order by o.created_at) from sim.offers o where o.game_id = g.id), '[]'::jsonb))
      else 'null'::jsonb end);
end $$;

-- ---------------------------------------------------------------- seller: offer
create or replace function public.sim_offer(p_code text, p_token text, p_buyer uuid, p_price numeric, p_pilot boolean, p_proof jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; b sim.players; v_id uuid; v_proof jsonb := coalesce(p_proof, '[]'::jsonb);
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is distinct from 'seller' then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  if coalesce(me.offers_left, 0) <= 0 then raise exception 'no_offers_left'; end if;
  select * into b from sim.players where game_id = g.id and id = p_buyer for update;
  if not found or b.role is distinct from 'buyer' or b.category is distinct from me.category then raise exception 'wrong_category'; end if;
  if b.decision is not null then raise exception 'buyer_closed'; end if;
  if p_price is null or p_price < (me.card->>'floor')::numeric or p_price > (me.card->>'list')::numeric then raise exception 'bad_price'; end if;
  if jsonb_typeof(v_proof) <> 'array' or exists (
       select 1 from jsonb_array_elements_text(v_proof) a where not (me.card->'assets') ? a) then
    raise exception 'bad_proof';
  end if;
  insert into sim.offers (game_id, seller_id, buyer_id, price, pilot, proof, sent_t)
    values (g.id, me.id, b.id, p_price, coalesce(p_pilot, false), v_proof, sim.clock(g)) returning id into v_id;
  update sim.players set offers_left = offers_left - 1 where id = me.id;
  perform sim.log(g, 'offer', me.id, jsonb_build_object('offer', v_id, 'buyer', b.id, 'price', p_price, 'pilot', coalesce(p_pilot, false), 'proof', v_proof));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------- buyer: accept / reject
create or replace function public.sim_decide(p_code text, p_token text, p_offer uuid, p_accept boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; o sim.offers; v_t int;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is distinct from 'buyer' then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  select * into o from sim.offers where id = p_offer and buyer_id = me.id and status = 'pending' for update;
  if not found then raise exception 'offer_gone'; end if;
  v_t := sim.clock(g);
  if p_accept then
    if me.decision is not null then raise exception 'already_decided'; end if;
    if o.price > (me.card->>'budget')::numeric then raise exception 'over_budget'; end if;
    update sim.offers set status = 'accepted', decided_at = clock_timestamp(), decided_t = v_t where id = o.id;
    update sim.offers set status = 'lost', decided_at = clock_timestamp(), decided_t = v_t where buyer_id = me.id and status = 'pending';
    update sim.players set decision = 'startup', decided_at = clock_timestamp(), decided_t = v_t where id = me.id;
    perform sim.log(g, 'accept', me.id, jsonb_build_object('offer', o.id, 'seller', o.seller_id));
  else
    update sim.offers set status = 'rejected', reason = nullif(p_reason, ''), decided_at = clock_timestamp(), decided_t = v_t where id = o.id;
    perform sim.log(g, 'reject', me.id, jsonb_build_object('offer', o.id, 'seller', o.seller_id, 'reason', nullif(p_reason, '')));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sim_incumbent(p_code text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; v_t int;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is distinct from 'buyer' then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  if me.decision is not null then raise exception 'already_decided'; end if;
  v_t := sim.clock(g);
  update sim.players set decision = 'incumbent', decided_at = clock_timestamp(), decided_t = v_t where id = me.id;
  update sim.offers set status = 'lost_incumbent', decided_at = clock_timestamp(), decided_t = v_t where buyer_id = me.id and status = 'pending';
  perform sim.log(g, 'incumbent', me.id, null);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- everyone: exit question
create or replace function public.sim_exit(p_code text, p_token text, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is null then raise exception 'not_joined'; end if;
  if g.phase <> 'locked' then raise exception 'not_locked'; end if;
  update sim.players set exit_answer = left(p_answer, 40), exit_at = clock_timestamp() where id = me.id;
  perform sim.log(g, 'exit', me.id, jsonb_build_object('answer', left(p_answer, 40)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- host: read
create or replace function public.sim_host_state(p_code text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;
  return jsonb_build_object('now', sim.ms(clock_timestamp()), 'game', sim.game_view(g),
    'players', coalesce((select jsonb_agg(sim.player_row(p, p.is_bot) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(sim.offer_view(o) order by o.created_at) from sim.offers o where o.game_id = g.id), '[]'::jsonb));
end $$;

create or replace function public.sim_host_events(p_code text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code);
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', sim.ms(e.at), 't', e.t, 'type', e.type, 'actor', e.actor, 'data', e.data) order by e.id)
                   from sim.events e where e.game_id = g.id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- host: controls
create or replace function public.sim_host(p_code text, p_pin text, p_action text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; v_changed boolean := false; v_t int; v_ms bigint;
begin
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;

  if p_action = 'start' and g.phase = 'lobby' then
    update sim.games set phase = 'briefing',
      briefing_ends_at = clock_timestamp() + make_interval(secs => coalesce((p_arg->>'briefing_ms')::numeric, 0) / 1000.0) where id = g.id;
    v_changed := true;
  elsif p_action = 'open' and g.phase = 'briefing' then
    v_ms := (p_arg->>'market_ms')::bigint;
    if v_ms is null or v_ms <= 0 then raise exception 'bad_arg'; end if;
    update sim.games set phase = 'open', opened_at = clock_timestamp(), total_ms = v_ms,
      ends_at = clock_timestamp() + make_interval(secs => v_ms / 1000.0) where id = g.id;
    v_changed := true;
  elsif p_action = 'pause' and g.phase = 'open' then
    update sim.games set phase = 'paused', paused_ms = greatest(0, sim.ms(ends_at) - sim.ms(clock_timestamp())) where id = g.id;
    v_changed := true;
  elsif p_action = 'resume' and g.phase = 'paused' then
    update sim.games set phase = 'open', ends_at = clock_timestamp() + make_interval(secs => paused_ms / 1000.0), paused_ms = null where id = g.id;
    v_changed := true;
  elsif p_action = 'extend' and g.phase in ('open', 'paused') then
    v_ms := (p_arg->>'ms')::bigint;
    if v_ms is null or v_ms <= 0 then raise exception 'bad_arg'; end if;
    if g.phase = 'open' then
      update sim.games set ends_at = greatest(ends_at, clock_timestamp()) + make_interval(secs => v_ms / 1000.0), total_ms = total_ms + v_ms where id = g.id;
    else
      update sim.games set paused_ms = paused_ms + v_ms, total_ms = total_ms + v_ms where id = g.id;
    end if;
    v_changed := true;
  elsif p_action = 'lock' and g.phase in ('open', 'paused') then
    v_t := sim.clock(g);
    update sim.offers set status = 'expired', decided_at = clock_timestamp(), decided_t = v_t where game_id = g.id and status = 'pending';
    update sim.players set decision = 'incumbent_default', decided_at = clock_timestamp(), decided_t = v_t
      where game_id = g.id and role = 'buyer' and decision is null;
    perform sim.log(g, 'lock', null, null);
    update sim.games set phase = 'locked', view = 'closed' where id = g.id;
    return jsonb_build_object('changed', true);
  elsif p_action = 'view' and g.phase = 'locked' then
    if (p_arg->>'view') not in ('closed', 'quick', 'full1', 'full2', 'full3', 'full4') then raise exception 'bad_arg'; end if;
    update sim.games set view = p_arg->>'view' where id = g.id;
    v_changed := true;
  elsif p_action = 'reset' then
    delete from sim.offers where game_id = g.id;
    delete from sim.players where game_id = g.id;
    delete from sim.events where game_id = g.id;
    update sim.games set phase = 'lobby', view = 'closed', briefing_ends_at = null, opened_at = null, ends_at = null,
      paused_ms = null, total_ms = null where id = g.id;
    return jsonb_build_object('changed', true);
  end if;

  if v_changed then
    select * into g from sim.games where id = g.id;
    perform sim.log(g, p_action, null, p_arg);
  end if;
  return jsonb_build_object('changed', v_changed);
end $$;

-- The host laptop computes role cards and results (js/engine.js) and stores them here.
create or replace function public.sim_host_apply(p_code text, p_pin text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games;
begin
  select * into g from sim.games where code = upper(p_code) for update;
  if not found then raise exception 'no_game'; end if;
  if g.pin <> p_pin then raise exception 'bad_pin'; end if;

  update sim.players p set
    role = coalesce(u->>'role', p.role),
    category = coalesce(u->>'category', p.category),
    card = case when jsonb_typeof(u->'card') = 'object' then u->'card' else p.card end,
    pub = case when jsonb_typeof(u->'pub') = 'object' then u->'pub' else p.pub end,
    offers_left = coalesce((u->>'offers_left')::int, p.offers_left),
    points = coalesce((u->>'points')::int, p.points)
  from jsonb_array_elements(coalesce(p_patch->'players', '[]'::jsonb)) u
  where p.game_id = g.id and p.id = (u->>'id')::uuid;

  update sim.offers o set
    delivered = coalesce((u->>'delivered')::boolean, o.delivered),
    seller_points = coalesce((u->>'seller_points')::int, o.seller_points)
  from jsonb_array_elements(coalesce(p_patch->'offers', '[]'::jsonb)) u
  where o.game_id = g.id and o.id = (u->>'id')::uuid;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permissions
revoke all on schema sim from anon, authenticated;
revoke all on all tables in schema sim from anon, authenticated;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sim\_%' loop
    execute 'revoke all on function ' || f || ' from public';
    execute 'grant execute on function ' || f || ' to anon, authenticated';
  end loop;
end $$;
