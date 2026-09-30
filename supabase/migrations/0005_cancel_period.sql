-- Option A: a cancelled subscription keeps paid access until the current
-- period ends (Razorpay cancels at cycle end), then read-time gating treats
-- the account as free.
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
  period_end_value timestamptz;
begin
  insert into public.account_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select analyses_used, free_analysis_limit, plan, subscription_status, current_period_end
    into current_used, current_limit, current_plan, current_subscription_status, period_end_value
  from public.account_usage
  where user_id = p_user_id
  for update;

  if current_plan = 'paid' and (
    current_subscription_status in ('authenticated', 'active')
    or (
      current_subscription_status in ('paused', 'cancelled')
      and period_end_value is not null
      and period_end_value > now()
    )
  ) then
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
