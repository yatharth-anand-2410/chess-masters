-- Multi-game batch analyses + free plan limit raised to 5.
-- Run this in the Supabase SQL Editor after 0007_paid_analysis_limit.sql.

-- ---------------------------------------------------------------------------
-- Free plan now includes 5 analyses. Bump existing accounts too.
-- ---------------------------------------------------------------------------
alter table public.account_usage
  alter column free_analysis_limit set default 5;

update public.account_usage
   set free_analysis_limit = 5
 where free_analysis_limit < 5;

-- ---------------------------------------------------------------------------
-- A batch groups several games analyzed together under one overall report.
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text,
  game_count integer not null default 0,
  report_markdown text,
  insights jsonb,
  status text not null default 'processing',
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analysis_batches_user_created_idx
  on public.analysis_batches (user_id, created_at desc);

alter table public.analysis_batches enable row level security;

drop policy if exists "users read own batches" on public.analysis_batches;
create policy "users read own batches"
  on public.analysis_batches for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own batches" on public.analysis_batches;
create policy "users insert own batches"
  on public.analysis_batches for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own batches" on public.analysis_batches;
create policy "users update own batches"
  on public.analysis_batches for update
  using (auth.uid() = user_id);

drop policy if exists "users delete own batches" on public.analysis_batches;
create policy "users delete own batches"
  on public.analysis_batches for delete
  using (auth.uid() = user_id);

alter table public.analyses
  add column if not exists batch_id uuid references public.analysis_batches(id) on delete set null;

create index if not exists analyses_batch_idx
  on public.analyses (batch_id);

-- ---------------------------------------------------------------------------
-- Atomic all-or-nothing credit consumption for a batch of games.
-- Mirrors consume_analysis_credit (0007) but increments by p_count and
-- refuses without incrementing when the account cannot cover the whole batch.
-- Returns jsonb:
--   {"allowed": true, "plan": "free", "analyses_used": n, ...}
--   {"allowed": false, "plan": "free", "requested": n, "remaining": r, ...}
--   {"allowed": false, "plan": "paid", "limit_reached": true, "remaining": r, ...}
-- ---------------------------------------------------------------------------
create or replace function public.consume_analysis_credits(p_user_id uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_used integer;
  current_free_limit integer;
  current_paid_limit integer;
  current_plan text;
  current_subscription_status text;
  period_end_value timestamptz;
  usage_period_end_value timestamptz;
  paid_active boolean;
  requested integer;
begin
  requested := greatest(1, coalesce(p_count, 1));

  insert into public.account_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select analyses_used, free_analysis_limit, paid_analysis_limit, plan,
         subscription_status, current_period_end, usage_period_end
    into current_used, current_free_limit, current_paid_limit, current_plan,
         current_subscription_status, period_end_value, usage_period_end_value
  from public.account_usage
  where user_id = p_user_id
  for update;

  paid_active := current_plan = 'paid' and (
    current_subscription_status in ('authenticated', 'active')
    or (
      current_subscription_status in ('paused', 'cancelled')
      and period_end_value is not null
      and period_end_value > now()
    )
  );

  if paid_active then
    -- Renewal detected: the billing period advanced, start a fresh count.
    if period_end_value is not null
       and (usage_period_end_value is null or usage_period_end_value < period_end_value)
    then
      current_used := 0;
      usage_period_end_value := period_end_value;
      update public.account_usage
         set analyses_used = 0,
             usage_period_end = period_end_value,
             updated_at = now()
       where user_id = p_user_id;
    end if;

    if current_used + requested > current_paid_limit then
      return jsonb_build_object(
        'allowed', false,
        'plan', 'paid',
        'limit_reached', true,
        'requested', requested,
        'remaining', greatest(0, current_paid_limit - current_used),
        'analyses_used', current_used,
        'free_analysis_limit', current_free_limit,
        'paid_analysis_limit', current_paid_limit,
        'subscription_status', current_subscription_status,
        'current_period_end', period_end_value,
        'usage_period_end', usage_period_end_value
      );
    end if;

    update public.account_usage
       set analyses_used = analyses_used + requested,
           updated_at = now()
     where user_id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'plan', 'paid',
      'requested', requested,
      'analyses_used', current_used + requested,
      'free_analysis_limit', current_free_limit,
      'paid_analysis_limit', current_paid_limit,
      'subscription_status', current_subscription_status,
      'current_period_end', period_end_value,
      'usage_period_end', usage_period_end_value
    );
  end if;

  if current_used + requested > current_free_limit then
    return jsonb_build_object(
      'allowed', false,
      'plan', 'free',
      'requested', requested,
      'remaining', greatest(0, current_free_limit - current_used),
      'analyses_used', current_used,
      'free_analysis_limit', current_free_limit,
      'paid_analysis_limit', current_paid_limit,
      'subscription_status', current_subscription_status
    );
  end if;

  update public.account_usage
     set analyses_used = analyses_used + requested,
         plan = 'free',
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'plan', 'free',
    'requested', requested,
    'analyses_used', current_used + requested,
    'free_analysis_limit', current_free_limit,
    'paid_analysis_limit', current_paid_limit,
    'subscription_status', current_subscription_status
  );
end;
$$;
