-- Failed analyses should not consume credits.
-- Run this in the Supabase SQL Editor after 0008_multi_game_batches.sql and
-- before deploying the backend change that calls refund_analysis_credits.

-- ---------------------------------------------------------------------------
-- Atomic credit refund, used when an analysis (or one game in a batch) fails
-- before producing a report. Mirrors consume_analysis_credit but subtracts.
-- Returns jsonb: {"refunded": n, "analyses_used": n}
-- ---------------------------------------------------------------------------
create or replace function public.refund_analysis_credits(
  p_user_id uuid,
  p_count integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if p_count is null or p_count <= 0 then
    return jsonb_build_object('refunded', 0);
  end if;

  update public.account_usage
     set analyses_used = greatest(analyses_used - p_count, 0),
         updated_at = now()
   where user_id = p_user_id
  returning analyses_used into remaining;

  if remaining is null then
    return jsonb_build_object('refunded', 0);
  end if;

  return jsonb_build_object('refunded', p_count, 'analyses_used', remaining);
end;
$$;

-- ---------------------------------------------------------------------------
-- One-time reconciliation: return credits already spent on failed analyses.
-- ---------------------------------------------------------------------------
with failed_counts as (
  select user_id, count(*)::integer as failed_count
  from public.analyses
  where status = 'failed'
  group by user_id
)
update public.account_usage as usage
   set analyses_used = greatest(usage.analyses_used - failed_counts.failed_count, 0),
       updated_at = now()
  from failed_counts
 where failed_counts.user_id = usage.user_id;
