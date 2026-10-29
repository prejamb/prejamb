-- ============================================================================
-- PreJamb — migration: per-question answers for diagnostic reports
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor on top of supabase/schema.sql.
-- Adds the child table that records what each candidate picked, so
-- /exam/results/[id] can show a question-by-question review.
--
-- Safe to re-run.
-- ============================================================================

begin;

create table if not exists public.exam_attempt_answers (
  attempt_id      uuid not null references public.exam_attempts (id) on delete cascade,
  question_id     uuid not null references public.questions (id) on delete cascade,
  position        smallint not null,
  selected_option text,
  is_correct      boolean not null,

  primary key (attempt_id, question_id),
  constraint exam_attempt_answers_position_non_negative check (position >= 0),
  constraint exam_attempt_answers_selected_option_valid
    check (selected_option is null or selected_option in ('A', 'B', 'C', 'D'))
);

comment on table public.exam_attempt_answers is
  'One row per question in an attempt. Written by the server at submission time.';
comment on column public.exam_attempt_answers.selected_option is
  'NULL when the candidate left the question unanswered.';
comment on column public.exam_attempt_answers.position is
  'Question order in the paper (0-based), used to render the review in order.';

create index if not exists exam_attempt_answers_question_idx
  on public.exam_attempt_answers (question_id);

-- RLS on with no policies: anon/authenticated cannot read or write this table
-- directly. The results page reads it with the service-role client after
-- verifying ownership of the parent attempt through RLS.
alter table public.exam_attempt_answers enable row level security;

revoke all on public.exam_attempt_answers from anon, authenticated;
grant all  on public.exam_attempt_answers to service_role;

commit;
