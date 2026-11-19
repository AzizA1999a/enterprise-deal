-- You cannot give everything. Run after schema.sql, 002_face_to_face.sql and 003_rivals.sql.
-- Each seller's card carries its token rules (written by the host laptop when roles are assigned):
--   card.tokens = { budget, pilot, fast, proof, fastWeeks }
-- The database only has to
--   1. remember two new things about a term sheet: fast-track deployment, and the seller's read of the buyer,
--   2. refuse a term sheet that would tie up more tokens than the seller holds.
-- Tokens are tied up by pending and accepted term sheets, and come back when a buyer says no.
-- A seller whose card has no "tokens" (a game started before this update) is not limited.

alter table sim.offers add column if not exists fast boolean not null default false;  -- fast-track deployment
alter table sim.offers add column if not exists guess text;                           -- what the seller thinks the buyer cares about
alter table sim.offers add column if not exists cost int not null default 0;          -- tokens this term sheet ties up

create or replace function sim.offer_view(o sim.offers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'seller_id', o.seller_id, 'buyer_id', o.buyer_id, 'price', o.price, 'pilot', o.pilot,
    'proof', o.proof, 'status', o.status, 'reason', o.reason, 'created_at', sim.ms(o.created_at), 'sent_t', o.sent_t,
    'decided_at', sim.ms(o.decided_at), 'decided_t', o.decided_t, 'delivered', o.delivered, 'seller_points', o.seller_points,
    'revisions', o.revisions, 'fast', o.fast, 'guess', o.guess, 'cost', o.cost)
$$;

-- Tokens a term sheet ties up. "pilot_ready" is not a proof to show: it only makes the pilot cheaper.
create or replace function sim.offer_cost(p_card jsonb, p_pilot boolean, p_fast boolean, p_proof jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when p_card ? 'tokens' then
      (case when p_pilot then coalesce((p_card->'tokens'->>'pilot')::int, 0) else 0 end)
    + (case when p_fast then coalesce((p_card->'tokens'->>'fast')::int, 0) else 0 end)
    + coalesce((p_card->'tokens'->>'proof')::int, 0)
      * (select count(*)::int from jsonb_array_elements_text(coalesce(p_proof, '[]'::jsonb)) a where a <> 'pilot_ready')
  else 0 end
$$;

-- Tokens a seller still has free. `p_except` leaves out the term sheet being edited.
create or replace function sim.tokens_free(p_seller sim.players, p_except uuid) returns int
language sql stable set search_path = '' as $$
  select case when p_seller.card ? 'tokens' then
      coalesce((p_seller.card->'tokens'->>'budget')::int, 0)
    - coalesce((select sum(x.cost)::int from sim.offers x
                where x.seller_id = p_seller.id and x.status in ('pending', 'accepted') and x.id is distinct from p_except), 0)
  else 2147483647 end
$$;

create or replace function sim.clean_guess(p_guess text) returns text
language sql immutable set search_path = '' as $$
  select case when p_guess in ('lowest_cost', 'lowest_risk', 'fastest_deployment', 'none') then p_guess else null end
$$;

-- ---------------------------------------------------------------- seller: open a term sheet
drop function if exists public.sim_offer(text, text, uuid, numeric, boolean, jsonb, text);
create or replace function public.sim_offer(p_code text, p_token text, p_buyer uuid, p_price numeric, p_pilot boolean, p_proof jsonb,
    p_desk text default null, p_fast boolean default false, p_guess text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; b sim.players; v_id uuid; v_proof jsonb := coalesce(p_proof, '[]'::jsonb);
  v_pilot boolean := coalesce(p_pilot, false); v_fast boolean := coalesce(p_fast, false); v_cost int; v_guess text := sim.clean_guess(p_guess);
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
  -- The desk number is shown only on the buyer's phone: the seller has to meet them to learn it.
  if b.card ? 'desk' and btrim(coalesce(p_desk, '')) is distinct from (b.card->>'desk') then raise exception 'bad_desk'; end if;
  if exists (select 1 from sim.offers x where x.seller_id = me.id and x.buyer_id = b.id and x.status = 'pending') then raise exception 'already_pitched'; end if;
  if p_price is null or p_price < (me.card->>'floor')::numeric or p_price > (me.card->>'list')::numeric then raise exception 'bad_price'; end if;
  if jsonb_typeof(v_proof) <> 'array' or exists (
       select 1 from jsonb_array_elements_text(v_proof) a where not (me.card->'assets') ? a) then
    raise exception 'bad_proof';
  end if;
  v_cost := sim.offer_cost(me.card, v_pilot, v_fast, v_proof);
  if v_cost > sim.tokens_free(me, null) then raise exception 'no_tokens'; end if;
  insert into sim.offers (game_id, seller_id, buyer_id, price, pilot, proof, fast, guess, cost, sent_t)
    values (g.id, me.id, b.id, p_price, v_pilot, v_proof, v_fast, v_guess, v_cost, sim.clock(g)) returning id into v_id;
  update sim.players set offers_left = offers_left - 1 where id = me.id;
  perform sim.log(g, 'offer', me.id, jsonb_build_object('offer', v_id, 'buyer', b.id, 'price', p_price, 'pilot', v_pilot, 'proof', v_proof,
    'fast', v_fast, 'guess', v_guess, 'tokens', v_cost));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------- seller: edit an open term sheet
-- p_fast null keeps fast-track as it was; p_guess null keeps the earlier read.
drop function if exists public.sim_revise(text, text, uuid, numeric, boolean, jsonb);
create or replace function public.sim_revise(p_code text, p_token text, p_offer uuid, p_price numeric, p_pilot boolean, p_proof jsonb,
    p_fast boolean default null, p_guess text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; o sim.offers; v_proof jsonb := coalesce(p_proof, '[]'::jsonb);
  v_pilot boolean := coalesce(p_pilot, false); v_fast boolean; v_cost int; v_guess text;
begin
  select * into g from sim.games where code = upper(p_code) for share;
  if not found then raise exception 'no_game'; end if;
  select * into me from sim.players where game_id = g.id and token = p_token for update;
  if not found or me.role is distinct from 'seller' then raise exception 'not_joined'; end if;
  if g.phase <> 'open' or clock_timestamp() >= g.ends_at then raise exception 'not_open'; end if;
  select * into o from sim.offers where id = p_offer and seller_id = me.id and status = 'pending' for update;
  if not found then raise exception 'offer_gone'; end if;
  if p_price is null or p_price < (me.card->>'floor')::numeric or p_price > (me.card->>'list')::numeric then raise exception 'bad_price'; end if;
  if jsonb_typeof(v_proof) <> 'array' or exists (
       select 1 from jsonb_array_elements_text(v_proof) a where not (me.card->'assets') ? a) then
    raise exception 'bad_proof';
  end if;
  v_fast := coalesce(p_fast, o.fast);
  v_guess := coalesce(sim.clean_guess(p_guess), o.guess);
  v_cost := sim.offer_cost(me.card, v_pilot, v_fast, v_proof);
  if v_cost > sim.tokens_free(me, o.id) then raise exception 'no_tokens'; end if;
  perform sim.log(g, 'revise', me.id, jsonb_build_object('offer', o.id, 'buyer', o.buyer_id,
    'from', jsonb_build_object('price', o.price, 'pilot', o.pilot, 'proof', o.proof, 'fast', o.fast, 'tokens', o.cost),
    'to', jsonb_build_object('price', p_price, 'pilot', v_pilot, 'proof', v_proof, 'fast', v_fast, 'guess', v_guess, 'tokens', v_cost)));
  update sim.offers set price = p_price, pilot = v_pilot, proof = v_proof, fast = v_fast, guess = v_guess, cost = v_cost,
    revisions = revisions + 1 where id = o.id;
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
