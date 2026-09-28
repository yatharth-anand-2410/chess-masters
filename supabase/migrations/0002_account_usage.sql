-- AI Chess Game Analyzer: per-account usage quota + atomic credit consumption
-- Run this in the Supabase SQL Editor after 0001_init.sql.

create table if not exists public.account_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  analyses_used integer not null default 0,
  free_analysis_limit integer not null default 2,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_usage enable row level security;

drop policy if exists "users read own usage" on public.account_usage;
create policy "users read own usage"
  on public.account_usage for select
  using (auth.uid() = user_id);

-- Atomic credit consumption. Returns jsonb:
--   {"allowed": true, "plan": "free", "analyses_used": n, "free_analysis_limit": 2}
--   {"allowed": false, "plan": "free", "analyses_used": 2, "free_analysis_limit": 2}
-- Concurrency-safe: the row is locked with FOR UPDATE so two simultaneous
-- requests cannot both consume the same final free credit.
create or replace function public.consume_analysis_credit(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_used integer;
  current_limit integer;
  current_plan text;
begin
  insert into public.account_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select analyses_used, free_analysis_limit, plan
    into current_used, current_limit, current_plan
  from public.account_usage
  where user_id = p_user_id
  for update;

  if current_plan = 'paid' then
    return jsonb_build_object(
      'allowed', true,
      'plan', current_plan,
      'analyses_used', current_used,
      'free_analysis_limit', current_limit
    );
  end if;

  if current_used >= current_limit then
    return jsonb_build_object(
      'allowed', false,
      'plan', current_plan,
      'analyses_used', current_used,
      'free_analysis_limit', current_limit
    );
  end if;

  update public.account_usage
     set analyses_used = analyses_used + 1,
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'plan', current_plan,
    'analyses_used', current_used + 1,
    'free_analysis_limit', current_limit
  );
end;
$$;