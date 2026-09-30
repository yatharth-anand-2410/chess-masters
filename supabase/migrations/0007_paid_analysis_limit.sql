-- Paid plans now include 100 analyses per billing cycle instead of unlimited.
-- The counter resets lazily: `usage_period_end` stores the billing period the
-- current `analyses_used` count belongs to. When a renewal advances
-- `current_period_end`, the next consumption (or usage read) starts a fresh
-- period. No scheduled job is required.

alter table public.account_usage
  add column if not exists paid_analysis_limit integer not null default 100;

alter table public.account_usage
  add column if not exists usage_period_end timestamptz;

-- Atomic credit consumption. Returns jsonb:
--   {"allowed": true, "plan": "free", "analyses_used": n, "free_analysis_limit": 2, ...}
--   {"allowed": true, "plan": "paid", "analyses_used": n, "paid_analysis_limit": 100, ...}
--   {"allowed": false, "plan": "free", "analyses_used": 2, ...}
--   {"allowed": false, "plan": "paid", "limit_reached": true, ...}
-- Concurrency-safe: the row is locked with FOR UPDATE so two simultaneous
-- requests cannot both consume the same final credit.
create or replace function public.consume_analysis_credit(p_user_id uuid)
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
begin
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

    if current_used >= current_paid_limit then
      return jsonb_build_object(
        'allowed', false,
        'plan', 'paid',
        'limit_reached', true,
        'analyses_used', current_used,
        'free_analysis_limit', current_free_limit,
        'paid_analysis_limit', current_paid_limit,
        'subscription_status', current_subscription_status,
        'current_period_end', period_end_value,
        'usage_period_end', usage_period_end_value
      );
    end if;

    update public.account_usage
       set analyses_used = analyses_used + 1,
           updated_at = now()
     where user_id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'plan', 'paid',
      'analyses_used', current_used + 1,
      'free_analysis_limit', current_free_limit,
      'paid_analysis_limit', current_paid_limit,
      'subscription_status', current_subscription_status,
      'current_period_end', period_end_value,
      'usage_period_end', usage_period_end_value
    );
  end if;

  if current_used >= current_free_limit then
    return jsonb_build_object(
      'allowed', false,
      'plan', 'free',
      'analyses_used', current_used,
      'free_analysis_limit', current_free_limit,
      'paid_analysis_limit', current_paid_limit,
      'subscription_status', current_subscription_status
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
    'free_analysis_limit', current_free_limit,
    'paid_analysis_limit', current_paid_limit,
    'subscription_status', current_subscription_status
  );
end;
$$;
