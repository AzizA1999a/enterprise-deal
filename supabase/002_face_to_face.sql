-- Face-to-face play: desk numbers, editable term sheets, and a price check on signing.
-- Apply after schema.sql.

alter table sim.offers add column if not exists revisions int not null default 0;

create or replace function sim.offer_view(o sim.offers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'seller_id', o.seller_id, 'buyer_id', o.buyer_id, 'price', o.price, 'pilot', o.pilot,
    'proof', o.proof, 'status', o.status, 'reason', o.reason, 'created_at', sim.ms(o.created_at), 'sent_t', o.sent_t,
    'decided_at', sim.ms(o.decided_at), 'decided_t', o.decided_t, 'delivered', o.delivered, 'seller_points', o.seller_points,
    'revisions', o.revisions)
$$;

drop function if exists public.sim_offer(text, text, uuid, numeric, boolean, jsonb);
create or replace function public.sim_offer(p_code text, p_token text, p_buyer uuid, p_price numeric, p_pilot boolean, p_proof jsonb, p_desk text default null) returns jsonb
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
  -- The desk number is shown only on the buyer's phone: the seller has to meet them to learn it.
  if b.card ? 'desk' and btrim(coalesce(p_desk, '')) is distinct from (b.card->>'desk') then raise exception 'bad_desk'; end if;
  if exists (select 1 from sim.offers x where x.seller_id = me.id and x.buyer_id = b.id and x.status = 'pending') then raise exception 'already_pitched'; end if;
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

-- Change the terms of an unanswered term sheet. Does not use up an offer.
create or replace function public.sim_revise(p_code text, p_token text, p_offer uuid, p_price numeric, p_pilot boolean, p_proof jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sim.games; me sim.players; o sim.offers; v_proof jsonb := coalesce(p_proof, '[]'::jsonb);
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
  perform sim.log(g, 'revise', me.id, jsonb_build_object('offer', o.id, 'buyer', o.buyer_id,
    'from', jsonb_build_object('price', o.price, 'pilot', o.pilot, 'proof', o.proof),
    'to', jsonb_build_object('price', p_price, 'pilot', coalesce(p_pilot, false), 'proof', v_proof)));
  update sim.offers set price = p_price, pilot = coalesce(p_pilot, false), proof = v_proof, revisions = revisions + 1 where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists public.sim_decide(text, text, uuid, boolean, text);
create or replace function public.sim_decide(p_code text, p_token text, p_offer uuid, p_accept boolean, p_reason text default null, p_expect_price numeric default null) returns jsonb
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
    -- The buyer signs the terms they saw, not terms changed a moment earlier.
    if p_expect_price is not null and p_expect_price <> o.price then raise exception 'offer_changed'; end if;
    if o.price > (me.card->>'budget')::numeric then raise exception 'over_budget'; end if;
    update sim.offers set status = 'accepted', decided_at = clock_timestamp(), decided_t = v_t where id = o.id;
    update sim.offers set status = 'lost', decided_at = clock_timestamp(), decided_t = v_t where buyer_id = me.id and status = 'pending';
    update sim.players set decision = 'startup', decided_at = clock_timestamp(), decided_t = v_t where id = me.id;
    perform sim.log(g, 'accept', me.id, jsonb_build_object('offer', o.id, 'seller', o.seller_id, 'price', o.price));
  else
    update sim.offers set status = 'rejected', reason = nullif(p_reason, ''), decided_at = clock_timestamp(), decided_t = v_t where id = o.id;
    perform sim.log(g, 'reject', me.id, jsonb_build_object('offer', o.id, 'seller', o.seller_id, 'reason', nullif(p_reason, '')));
  end if;
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sim\_%' loop
    execute 'revoke all on function ' || f || ' from public';
    execute 'grant execute on function ' || f || ' to anon, authenticated';
  end loop;
end $$;
