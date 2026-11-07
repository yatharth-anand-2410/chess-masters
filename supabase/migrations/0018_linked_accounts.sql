-- Linked chess platform profiles per user account (Lichess & Chess.com).
-- Run this in the Supabase SQL Editor after 0017_backfill_game_summary.sql.

alter table public.user_profiles
  add column if not exists linked_accounts jsonb not null default '[]'::jsonb;
