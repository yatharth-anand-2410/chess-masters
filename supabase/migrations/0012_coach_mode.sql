-- Coach mode: user roles, coach-managed student profiles, and public share links.
-- Run this in the Supabase SQL Editor after 0011_guest_trial.sql.

-- ---------------------------------------------------------------------------
-- One role per account, chosen once after the first sign-in. The role picks
-- the default experience (player home vs coach roster); it is not an access
-- boundary, and it can be changed at any time.
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('player', 'coach')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "users read own profile" on public.user_profiles;
create policy "users read own profile"
  on public.user_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own profile" on public.user_profiles;
create policy "users insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own profile" on public.user_profiles;
create policy "users update own profile"
  on public.user_profiles for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Student profiles are managed by their coach. Students never sign in: the
-- coach analyses their games and shares a read-only link when useful.
-- ---------------------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  lichess_username text,
  chesscom_username text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists students_coach_created_idx
  on public.students (coach_id, created_at desc);

alter table public.students enable row level security;

drop policy if exists "coaches read own students" on public.students;
create policy "coaches read own students"
  on public.students for select
  using (auth.uid() = coach_id);

drop policy if exists "coaches insert own students" on public.students;
create policy "coaches insert own students"
  on public.students for insert
  with check (auth.uid() = coach_id);

drop policy if exists "coaches update own students" on public.students;
create policy "coaches update own students"
  on public.students for update
  using (auth.uid() = coach_id);

drop policy if exists "coaches delete own students" on public.students;
create policy "coaches delete own students"
  on public.students for delete
  using (auth.uid() = coach_id);

-- ---------------------------------------------------------------------------
-- An analysis can carry the student it was run for. Null means the coach's own
-- game (or any regular player's game).
-- ---------------------------------------------------------------------------
alter table public.analyses
  add column if not exists student_id uuid references public.students(id) on delete set null;

create index if not exists analyses_student_idx
  on public.analyses (student_id);

-- ---------------------------------------------------------------------------
-- Share links give parents/students a read-only window onto one student's
-- reports. The token is the only credential; revoking it always ends access.
-- ---------------------------------------------------------------------------
create table if not exists public.share_links (
  token uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists share_links_student_idx
  on public.share_links (student_id);

create index if not exists share_links_coach_idx
  on public.share_links (coach_id);

alter table public.share_links enable row level security;

drop policy if exists "coaches read own share links" on public.share_links;
create policy "coaches read own share links"
  on public.share_links for select
  using (auth.uid() = coach_id);

drop policy if exists "coaches insert own share links" on public.share_links;
create policy "coaches insert own share links"
  on public.share_links for insert
  with check (auth.uid() = coach_id);

drop policy if exists "coaches update own share links" on public.share_links;
create policy "coaches update own share links"
  on public.share_links for update
  using (auth.uid() = coach_id);

drop policy if exists "coaches delete own share links" on public.share_links;
create policy "coaches delete own share links"
  on public.share_links for delete
  using (auth.uid() = coach_id);
