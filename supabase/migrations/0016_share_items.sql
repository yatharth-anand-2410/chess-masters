-- Share items: study / tactic homework a coach hands to a student, readable
-- with no sign-in behind /s/{token}. Mirrors 0012_coach_mode.sql: the token is
-- the only credential and revoking it always ends access. A share can be
-- attached to one student, or to nobody ("anyone with the link").
--
-- Run this in the Supabase SQL Editor after 0015_billing_plan_tier.sql.

create table if not exists public.share_items (
  token uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  kind text not null check (kind in ('study', 'tactic')),
  item_key text not null,
  title text not null,
  subtitle text,
  url text,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists share_items_coach_idx
  on public.share_items (coach_id);

create index if not exists share_items_student_idx
  on public.share_items (student_id);

alter table public.share_items enable row level security;

drop policy if exists "coaches read own share items" on public.share_items;
create policy "coaches read own share items"
  on public.share_items for select
  using (auth.uid() = coach_id);

drop policy if exists "coaches insert own share items" on public.share_items;
create policy "coaches insert own share items"
  on public.share_items for insert
  with check (auth.uid() = coach_id);

drop policy if exists "coaches update own share items" on public.share_items;
create policy "coaches update own share items"
  on public.share_items for update
  using (auth.uid() = coach_id);

drop policy if exists "coaches delete own share items" on public.share_items;
create policy "coaches delete own share items"
  on public.share_items for delete
  using (auth.uid() = coach_id);
