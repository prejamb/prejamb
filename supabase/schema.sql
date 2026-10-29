-- ============================================================================
-- PreJamb — Supabase schema
-- ----------------------------------------------------------------------------
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Requires: Postgres 13+ (Supabase default) and the `auth` schema (always
-- present on Supabase projects).
--
-- Contents
--   1. Extensions
--   2. Tables: subjects, topics, questions, exam_attempts
--   3. Indexes
--   4. Row Level Security + grants
--   5. Seed: JAMB UTME subjects
-- ============================================================================

begin;

-- ============================================================================
-- 1. Extensions
-- ============================================================================
-- gen_random_uuid() is built into PG13+, but enabling pgcrypto keeps this
-- script portable across older projects.
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;


-- ============================================================================
-- 2. Tables
-- ============================================================================

-- ---------------------------------------------------------------------------
-- subjects — one row per JAMB UTME subject (e.g. Use of English / ENG).
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,

  constraint subjects_name_key unique (name),
  constraint subjects_code_key unique (code),
  constraint subjects_name_not_blank check (length(btrim(name)) > 0),
  -- Short, uppercase, stable identifier used in URLs and subject combinations.
  constraint subjects_code_format check (code ~ '^[A-Z0-9]{2,10}$')
);

comment on table  public.subjects      is 'JAMB UTME subjects.';
comment on column public.subjects.code is 'Short uppercase code, e.g. ENG, MTH, PHY.';

-- ---------------------------------------------------------------------------
-- topics — syllabus topics belonging to a subject.
-- ---------------------------------------------------------------------------
create table if not exists public.topics (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  title      text not null,
  slug       text not null,

  -- Slugs only need to be unique inside a subject: /physics/kinematics.
  constraint topics_subject_slug_key unique (subject_id, slug),
  constraint topics_title_not_blank check (length(btrim(title)) > 0),
  constraint topics_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

comment on table public.topics is 'Syllabus topics, grouped under a subject.';

-- ---------------------------------------------------------------------------
-- Question option validator.
-- Must be IMMUTABLE to be usable inside a CHECK constraint. `set search_path`
-- keeps it safe against search_path hijacking.
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_question_options(options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(options) <> 'array' then false
    when jsonb_array_length(options) <> 4 then false
    else (
      select
        coalesce(bool_and(jsonb_typeof(opt) = 'object'), false)
        and array_agg(opt ->> 'label' order by opt ->> 'label') = array['A', 'B', 'C', 'D']
        and coalesce(
          bool_and(jsonb_typeof(opt -> 'text') = 'string' and length(btrim(opt ->> 'text')) > 0),
          false
        )
      from jsonb_array_elements(options) as opt
    )
  end;
$$;

comment on function public.is_valid_question_options(jsonb)
  is 'Validates the question options JSONB shape: exactly 4 objects with labels A-D and non-empty text.';

-- ---------------------------------------------------------------------------
-- questions — the question bank.
--
-- `options` is a JSONB array of exactly four objects, in display order:
--   [{"label":"A","text":"..."}, {"label":"B","text":"..."}, ...]
--
-- `correct_option` holds the label of the right answer ("A".."D"), which keeps
-- grading independent of option order.
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid not null references public.topics (id) on delete cascade,
  question_text   text not null,
  options         jsonb not null,
  correct_option  text not null,
  explanation     text,
  is_ai_modified  boolean not null default false,
  year            smallint,

  constraint questions_text_not_blank check (length(btrim(question_text)) > 0),
  constraint questions_options_valid check (public.is_valid_question_options(options)),
  constraint questions_correct_option_valid check (correct_option in ('A', 'B', 'C', 'D')),
  constraint questions_year_range check (year is null or year between 1978 and 2100)
);

comment on table  public.questions                 is 'JAMB-style multiple-choice question bank.';
comment on column public.questions.options        is 'Array of 4 objects: [{"label":"A","text":"..."} ...].';
comment on column public.questions.correct_option is 'Label of the correct option: A, B, C or D.';
comment on column public.questions.is_ai_modified is 'True when an AI pass has rewritten/cleaned this question.';
comment on column public.questions.year           is 'UTME year the question came from, if any. NULL for original questions.';

-- ---------------------------------------------------------------------------
-- exam_attempts — one row per completed practice/mock exam.
--
-- `topic_breakdown` shape (keys are topic UUIDs as text):
--   {"<topic_id>": {"correct": 3, "total": 5}, ...}
-- ---------------------------------------------------------------------------
create table if not exists public.exam_attempts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  score              integer not null,
  total_questions    integer not null,
  time_spent_seconds integer not null default 0,
  topic_breakdown    jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  constraint exam_attempts_total_positive check (total_questions > 0),
  constraint exam_attempts_score_range check (score >= 0 and score <= total_questions),
  constraint exam_attempts_time_non_negative check (time_spent_seconds >= 0),
  constraint exam_attempts_breakdown_is_object check (jsonb_typeof(topic_breakdown) = 'object')
);

comment on table  public.exam_attempts                 is 'Completed exam attempts, owned by auth.users.';
comment on column public.exam_attempts.topic_breakdown is 'JSONB map: {"<topic_id>": {"correct": n, "total": m}}.';

-- ---------------------------------------------------------------------------
-- exam_attempt_answers — one row per question in an attempt.
-- Written by the server at submission time; drives the diagnostic report.
-- ---------------------------------------------------------------------------
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

comment on table  public.exam_attempt_answers                 is 'One row per question in an attempt.';
comment on column public.exam_attempt_answers.selected_option is 'NULL when the question was left unanswered.';
comment on column public.exam_attempt_answers.position        is 'Question order in the paper (0-based).';


-- ============================================================================
-- 3. Indexes
-- ============================================================================
create index if not exists topics_subject_id_idx
  on public.topics (subject_id);

create index if not exists questions_topic_id_idx
  on public.questions (topic_id);

create index if not exists exam_attempts_user_created_idx
  on public.exam_attempts (user_id, created_at desc);

create index if not exists exam_attempt_answers_question_idx
  on public.exam_attempt_answers (question_id);


-- ============================================================================
-- 4. Row Level Security
-- ============================================================================
alter table public.subjects      enable row level security;
alter table public.topics        enable row level security;
alter table public.questions     enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_attempt_answers enable row level security;

-- --- Content tables: public read, write only via service_role --------------
drop policy if exists "subjects are publicly readable" on public.subjects;
create policy "subjects are publicly readable"
  on public.subjects for select
  to anon, authenticated
  using (true);

drop policy if exists "topics are publicly readable" on public.topics;
create policy "topics are publicly readable"
  on public.topics for select
  to anon, authenticated
  using (true);

drop policy if exists "questions are publicly readable" on public.questions;
create policy "questions are publicly readable"
  on public.questions for select
  to anon, authenticated
  using (true);

-- Hide the answer key from the browser. RLS decides *which rows* a client can
-- see; column privileges decide *which columns*. Clients may read everything
-- except `correct_option` and `explanation`, so `select *` will intentionally
-- fail and the app must list its columns explicitly, e.g.
--   supabase.from("questions").select("id, topic_id, question_text, options, year")
-- Grading happens server-side with the service-role client (lib/supabase/admin.ts).
revoke select on public.questions from anon, authenticated;
grant  select (id, topic_id, question_text, options, year, is_ai_modified)
  on public.questions to anon, authenticated;

grant select on public.subjects, public.topics to anon, authenticated;
grant all    on public.subjects, public.topics, public.questions to service_role;

-- --- exam_attempts: strictly per-user --------------------------------------
drop policy if exists "users can read their own attempts" on public.exam_attempts;
create policy "users can read their own attempts"
  on public.exam_attempts for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- NOTE: these policies trust the client to send a truthful `score`, so a
-- determined user could write a fake attempt straight from the browser. For
-- leaderboards/high-stakes modes, grade on the server and insert with
-- lib/supabase/admin.ts instead (then drop the insert/update policies below).

drop policy if exists "users can insert their own attempts" on public.exam_attempts;
create policy "users can insert their own attempts"
  on public.exam_attempts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "users can update their own attempts" on public.exam_attempts;
create policy "users can update their own attempts"
  on public.exam_attempts for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users can delete their own attempts" on public.exam_attempts;
create policy "users can delete their own attempts"
  on public.exam_attempts for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.exam_attempts to authenticated;
grant all on public.exam_attempts to service_role;

-- --- exam_attempt_answers: server-only ------------------------------------
-- No policies on purpose. Candidates read their review through the server
-- route, which verifies ownership of the parent attempt first.
revoke all on public.exam_attempt_answers from anon, authenticated;
grant all  on public.exam_attempt_answers to service_role;


-- ============================================================================
-- 5. Seed — JAMB UTME subjects
-- ============================================================================
insert into public.subjects (name, code) values
  ('Use of English',                  'ENG'),
  ('Mathematics',                     'MTH'),
  ('Physics',                         'PHY'),
  ('Chemistry',                       'CHM'),
  ('Biology',                         'BIO'),
  ('Agricultural Science',            'AGR'),
  ('Economics',                       'ECO'),
  ('Government',                      'GOV'),
  ('Commerce',                        'COM'),
  ('Accounting',                      'ACC'),
  ('Literature in English',           'LIT'),
  ('Christian Religious Studies',     'CRS'),
  ('Islamic Religious Studies',       'IRS'),
  ('Geography',                       'GEO'),
  ('History',                         'HIS'),
  ('Fine Arts',                       'FAR'),
  ('Music',                           'MUS'),
  ('French',                          'FRE'),
  ('Yoruba',                          'YOR'),
  ('Igbo',                            'IGB'),
  ('Hausa',                           'HAU'),
  ('Arabic',                          'ARA'),
  ('Home Economics',                  'HEC'),
  ('Computer Studies',                'CMP')
on conflict (code) do nothing;

commit;
