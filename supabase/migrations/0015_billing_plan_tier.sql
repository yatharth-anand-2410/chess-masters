-- Two subscription tiers: Pro Student (₹399) and Master Coach (₹1,999).
--
--   * billing_subscriptions.plan_tier records which tier a checkout was
--     started for (also written into the Razorpay notes as "plan_tier").
--   * account_usage.plan_tier is what the API gates features on: the
--     coach-only surfaces require 'coach'.
--
-- The existing columns and functions stay exactly as they are:
--   * plan keeps the 'free'/'paid' vocabulary every quota check reads,
--   * paid_analysis_limit is set per tier at activation (100 for student,
--     500 for coach), which is all consume_analysis_credit needs,
--   * consume_analysis_credit is deliberately NOT recreated: it reads
--     paid_analysis_limit and keeps working unchanged.
--
-- Run this in the Supabase SQL Editor after 0014_game_telemetry.sql.

alter table public.billing_subscriptions
  add column if not exists plan_tier text not null default 'student';

alter table public.account_usage
  add column if not exists plan_tier text not null default 'free';

-- Check constraints, idempotently (adding one twice is an error in Postgres).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'billing_subscriptions_plan_tier_check'
  ) then
    alter table public.billing_subscriptions
      add constraint billing_subscriptions_plan_tier_check
      check (plan_tier in ('student', 'coach'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'account_usage_plan_tier_check'
  ) then
    alter table public.account_usage
      add constraint account_usage_plan_tier_check
      check (plan_tier in ('free', 'student', 'coach'));
  end if;
end
$$;

-- Backfill: usage rows still on the default 'free' inherit the tier of the
-- account's newest subscription. The original single plan cost ₹399, i.e. the
-- Pro Student tier, which is also the column default, so this only makes the
-- usage payload agree with the billing history. Re-running changes nothing
-- (the default is restored only by a granted activation, never by a lapse).
update public.account_usage as usage
   set plan_tier = subscription.plan_tier,
       updated_at = now()
  from (
    select distinct on (user_id) user_id, plan_tier
      from public.billing_subscriptions
     order by user_id, created_at desc
  ) as subscription
 where usage.user_id = subscription.user_id
   and usage.plan_tier = 'free';
