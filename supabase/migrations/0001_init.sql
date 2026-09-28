-- AI Chess Game Analyzer: initial schema + Row Level Security
-- Run this in the Supabase SQL Editor.

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  game_url text not null,
  game_id text not null,
  username text,
  player_color text not null,
  player_name text,
  pgn text,
  opening_name text,
  eco text,
  result text,
  report_markdown text,
  insights jsonb,
  status text not null default 'processing',
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analyses_user_created_idx
  on public.analyses (user_id, created_at desc);

create table if not exists public.analysis_messages (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists analysis_messages_analysis_idx
  on public.analysis_messages (analysis_id, created_at asc);

alter table public.analyses enable row level security;
alter table public.analysis_messages enable row level security;

drop policy if exists "users read own analyses" on public.analyses;
create policy "users read own analyses"
  on public.analyses for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own analyses" on public.analyses;
create policy "users insert own analyses"
  on public.analyses for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own analyses" on public.analyses;
create policy "users update own analyses"
  on public.analyses for update
  using (auth.uid() = user_id);

drop policy if exists "users delete own analyses" on public.analyses;
create policy "users delete own analyses"
  on public.analyses for delete
  using (auth.uid() = user_id);

drop policy if exists "users read own messages" on public.analysis_messages;
create policy "users read own messages"
  on public.analysis_messages for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own messages" on public.analysis_messages;
create policy "users insert own messages"
  on public.analysis_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "users delete own messages" on public.analysis_messages;
create policy "users delete own messages"
  on public.analysis_messages for delete
  using (auth.uid() = user_id);