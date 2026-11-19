-- The incumbents fight back. Run after schema.sql and 002_face_to_face.sql.
-- The account managers are played by the host laptop (js/driver.js): it writes each
-- counter-offer onto the buyer's card through sim_host_apply. The database only has to
--   1. remember which counter-offer a buyer accepted when they chose to stay,
--   2. tell the projector that an incumbent has countered (never the amount),
--   3. keep every counter-offer in the event log.
-- Everything here is additive: a phone still running the older page keeps working.

alter table sim.players add column if not exists stay_level int;   -- counter-offers seen when the buyer chose to stay

create or replace function sim.player_row(p sim.players, with_token boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'category', p.category, 'card', p.card, 'pub', p.pub,
    'is_bot', p.is_bot, 'offers_left', p.offers_left, 'decision', p.decision, 'decided_at', sim.ms(p.decided_at),
    'decided_t', p.decided_t, 'points', p.points, 'exit_answer', p.exit_answer, 'exit_at', sim.ms(p.exit_at),
    'joined_at', sim.ms(p.joined_at), 'stay_level', p.stay_level)
    || case when with_token then jsonb_build_object('token', p.token) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------- buyer: stay with the incumbent
-- p_seen = how many counter-offers the buyer had on screen. It can never exceed the number really made.
drop function if exists public.sim_incumbent(text, text);
create or replace function public.sim_incumbent(p_code text, p_token text, p_seen int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; v_t int; v_made int; v_level int;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is distinct from 'buyer' then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  if me.decision is not null then raise exception 'already_decided'; end if;
  v_t := sim.clock(g);
  v_made := case when jsonb_typeof(me.card->'incumbent'->'counters') = 'array'
                 then jsonb_array_length(me.card->'incumbent'->'counters') else 0 end;
  v_level := greatest(0, least(v_made, coalesce(p_seen, 0)));
  update sim.players set decision = 'incumbent', stay_level = v_level, decided_at = clock_timestamp(), decided_t = v_t where id = me.id;
  update sim.offers set status = 'lost_incumbent', decided_at = clock_timestamp(), decided_t = v_t where buyer_id = me.id and status = 'pending';
  perform sim.log(g, 'incumbent', me.id, jsonb_build_object('counter_offers_seen', v_level));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- projector
-- Adds "defence" (how many counter-offers, when, by whom). The discount itself stays private.
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
                           'org', p.pub->>'org', 'decision', p.decision, 'decided_t', p.decided_t, 'exit_done', p.exit_answer is not null,
                           'defence', p.pub->'defence') order by p.joined_at)
                         from sim.players p where p.game_id = g.id), '[]'::jsonb),
    'deals', coalesce((select jsonb_agg(jsonb_build_object('seller_id', o.seller_id, 'buyer_id', o.buyer_id, 'decided_t', o.decided_t, 'delivered', o.delivered) order by o.decided_at)
                       from sim.offers o where o.game_id = g.id and o.status = 'accepted'), '[]'::jsonb),
    'full', case when g.phase = 'locked' then jsonb_build_object(
        'players', coalesce((select jsonb_agg(sim.player_row(p, false) order by p.joined_at) from sim.players p where p.game_id = g.id), '[]'::jsonb),
        'offers', coalesce((select jsonb_agg(sim.offer_view(o) order by o.created_at) from sim.offers o where o.game_id = g.id), '[]'::jsonb))
      else 'null'::jsonb end);
end $$;

-- ---------------------------------------------------------------- host: apply
-- Same as before, plus an optional list of events to log (the counter-offers).
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
