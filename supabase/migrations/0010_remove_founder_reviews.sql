-- AI Chess Game Analyzer: remove founder reviews from the public review list.
-- Run this in the Supabase SQL Editor after 0009_refund_failed_analyses.sql.
--
-- Verify before deleting:
--   select id, display_name, rating, comment from public.reviews;

delete from public.reviews
where lower(display_name) in ('parth kaushik', 'yatharth anand');
