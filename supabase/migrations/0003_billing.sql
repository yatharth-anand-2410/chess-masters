-- Razorpay monthly subscription state and idempotent webhook ledger.

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_subscription_id text not null unique,
  razorpay_plan_id text not null,
  razorpay_customer_id text,
  status text not null,
  amount integer not null default 39900,
  currency text not null default 'INR',
  current_start timestamptz,
  current_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_active_user_idx
  on public.billing_subscriptions (user_id)
  where status in ('authenticated', 'active', 'pending');

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  razorpay_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists "users read own billing subscription" on public.billing_subscriptions;
create policy "users read own billing subscription"
  on public.billing_subscriptions for select
  using (auth.uid() = user_id);

alter table public.account_usage
  add column if not exists subscription_status text not null default 'inactive';

alter table public.account_usage
  add column if not exists current_period_end timestamptz;

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
  current_subscription_status text;
begin
  insert into public.account_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select analyses_used, free_analysis_limit, plan, subscription_status
    into current_used, current_limit, current_plan, current_subscription_status
  from public.account_usage
  where user_id = p_user_id
  for update;

  if current_plan = 'paid' and current_subscription_status in ('authenticated', 'active') then
    return jsonb_build_object(
      'allowed', true,
      'plan', 'paid',
      'analyses_used', current_used,
      'free_analysis_limit', current_limit
    );
  end if;

  if current_used >= current_limit then
    return jsonb_build_object(
      'allowed', false,
      'plan', 'free',
      'analyses_used', current_used,
      'free_analysis_limit', current_limit
    );
  end if;

  update public.account_usage
     set analyses_used = analyses_used + 1,
         plan = 'free',
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'plan', 'free',
    'analyses_used', current_used + 1,
    'free_analysis_limit', current_limit
  );
end;
$$;
