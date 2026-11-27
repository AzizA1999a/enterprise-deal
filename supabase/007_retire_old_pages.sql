-- A host page or slide deck left open (or cached) from before the marketing-campaign game still calls the
-- functions of the three-round game. It could start a game that today's phones cannot read.
-- This makes such a page say so instead: Start and "open a round" are refused with a readable reason,
-- and every other action (Reset above all) is passed on to the current game's function.
-- Run after 006_campaign.sql.

create or replace function public.sim_round_host(p_code text, p_pin text, p_action text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_action in ('start', 'open') then
    raise exception 'this page is out of date: reload it, then press Reset game';
  end if;
  return public.sim_camp_host(p_code, p_pin, p_action, p_arg);
end $$;

revoke all on function public.sim_round_host(text, text, text, jsonb) from public;
grant execute on function public.sim_round_host(text, text, text, jsonb) to anon, authenticated;
