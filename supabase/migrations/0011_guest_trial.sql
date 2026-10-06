-- AI Chess Game Analyzer: guest trial (one free analysis before sign-in)
-- plus a one-time claim so the first signed-in report consumes the guest trial.
-- Run this in the Supabase SQL Editor after 0010_remove_founder_reviews.sql.

create table if not exists public.guest_analyses (
  ip text primary key,
  analyses_used integer not null default 0,
  window_start timestamptz not null default now()
);

alter table public.guest_analyses enable row level security;

-- Atomic guest credit consumption, one analysis per IP per rolling 24h window.
-- Returns jsonb:
--   {"allowed": true, "analyses_used": 1, "limit": 1}
--   {"allowed": false, "analyses_used": 1, "limit": 1}
create or replace function public.consume_guest_analysis(
  p_ip text,
  p_daily_limit integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_used integer;
  current_window timestamptz;
begin
  insert into public.guest_analyses (ip)
  values (p_ip)
  on conflict (ip) do nothing;

  select analyses_used, window_start
    into current_used, current_window
  from public.guest_analyses
  where ip = p_ip
  for update;

  if current_window < now() - interval '1 day' then
    update public.guest_analyses
       set analyses_used = 0,
           window_start = now()
     where ip = p_ip;
    current_used := 0;
  end if;

  if current_used >= p_daily_limit then
    return jsonb_build_object(
      'allowed', false,
      'analyses_used', current_used,
      'limit', p_daily_limit
    );
  end if;

  update public.guest_analyses
     set analyses_used = analyses_used + 1
   where ip = p_ip;

  return jsonb_build_object(
    'allowed', true,
    'analyses_used', current_used + 1,
    'limit', p_daily_limit
  );
end;
$$;

-- Count the guest trial against the new account's free analyses once, so the
-- "4 free game analyses left" promise holds after sign-in.
alter table public.account_usage
  add column if not exists guest_trial_claimed boolean not null default false;

create or replace function public.claim_guest_trial(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_used integer;
  already_claimed boolean;
begin
  insert into public.account_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select analyses_used, guest_trial_claimed
    into current_used, already_claimed
  from public.account_usage
  where user_id = p_user_id
  for update;

  if already_claimed then
    return jsonb_build_object(
      'claimed', false,
      'analyses_used', current_used
    );
  end if;

  update public.account_usage
     set analyses_used = greatest(analyses_used, 1),
         guest_trial_claimed = true,
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object(
    'claimed', true,
    'analyses_used', greatest(current_used, 1)
  );
end;
$$;
