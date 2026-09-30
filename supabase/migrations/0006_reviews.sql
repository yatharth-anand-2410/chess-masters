-- AI Chess Game Analyzer: public product reviews + rating summary.
-- Run this in the Supabase SQL Editor after 0005_cancel_period.sql.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reviews_rank_idx
  on public.reviews (rating desc, created_at desc);

create or replace view public.review_stats as
  select
    count(*)::int as review_count,
    round(avg(rating)::numeric, 2)::float8 as average_rating
  from public.reviews;

alter table public.reviews enable row level security;

drop policy if exists "anyone reads reviews" on public.reviews;
create policy "anyone reads reviews"
  on public.reviews for select
  using (true);

drop policy if exists "users insert own review" on public.reviews;
create policy "users insert own review"
  on public.reviews for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own review" on public.reviews;
create policy "users update own review"
  on public.reviews for update
  using (auth.uid() = user_id);

drop policy if exists "users delete own review" on public.reviews;
create policy "users delete own review"
  on public.reviews for delete
  using (auth.uid() = user_id);
