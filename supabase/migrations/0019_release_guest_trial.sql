-- AI Chess Game Analyzer: give a guest their free trial back when the
-- analysis it paid for fails (engine error, AI outage, bad game link after
-- extraction). Counterpart of consume_guest_analysis from 0011_guest_trial.sql.
-- Run this in the Supabase SQL Editor after 0018_linked_accounts.sql.

create or replace function public.release_guest_analysis(p_ip text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.guest_analyses
     set analyses_used = greatest(analyses_used - 1, 0)
   where ip = p_ip;
end;
$$;

-- Only the backend (service role) may call it; anonymous clients must not be
-- able to reset their own trial.
revoke all on function public.release_guest_analysis(text) from public, anon, authenticated;
grant execute on function public.release_guest_analysis(text) to service_role;
