-- Batch (multi-game) reports can belong to a coach's student, so the overall
-- report shows up on the student page and the shared read-only page.
-- Run this in the Supabase SQL Editor after 0012_coach_mode.sql.

alter table public.analysis_batches
  add column if not exists student_id uuid references public.students(id) on delete set null;

create index if not exists analysis_batches_student_idx
  on public.analysis_batches (student_id);

-- Backfill: batches analysed before this column existed inherit the student
-- from their games, but only when every tagged game in the batch agrees on the
-- same student (the coach changed nobody mid-batch).
update public.analysis_batches b
   set student_id = sub.student_id
  from (
    select batch_id, (array_agg(distinct student_id))[1] as student_id
      from public.analyses
     where batch_id is not null
       and student_id is not null
     group by batch_id
    having count(distinct student_id) = 1
  ) sub
 where b.id = sub.batch_id
   and b.student_id is null;
