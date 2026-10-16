-- Per-game telemetry captured at analysis time:
--   * game_summary -- the compact per-game facts the history and progress
--     surfaces aggregate without opening a full report.
--   * replay -- the move-by-move replay served on demand by
--     GET /api/analyses/{id}/replay.
--   * replay_available -- a generated boolean so list queries can show the
--     "replay" affordance without ever selecting the replay JSON.
-- Rows analyzed before this migration simply have no telemetry; readers must
-- fall back gracefully.
-- Run this in the Supabase SQL Editor after 0013_batch_student.sql.

alter table public.analyses
  add column if not exists game_summary jsonb;

alter table public.analyses
  add column if not exists replay jsonb;

alter table public.analyses
  add column if not exists replay_available boolean
    generated always as (replay is not null) stored;

-- Progress aggregates filter and group games by speed bucket.
create index if not exists analyses_game_summary_speed_idx
  on public.analyses ((game_summary->>'speed'));
