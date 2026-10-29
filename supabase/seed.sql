-- ============================================================================
-- PreJamb — sample content seed
-- ----------------------------------------------------------------------------
-- Run AFTER supabase/schema.sql and
-- supabase/migrations/20261029_exam_attempt_answers.sql.
--
-- Creates just enough content to exercise the full CBT flow:
--   1 subject (Use of English / ENG)
--   2 topics  (Comprehension, Lexis and Structure)
--   5 questions with 4 options, answer keys and step-by-step explanations.
--
-- Safe to re-run: content is matched on natural keys, and questions are only
-- inserted when the same text does not already exist under the topic.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Subject
-- ---------------------------------------------------------------------------
insert into public.subjects (name, code)
values ('Use of English', 'ENG')
on conflict (code) do update set name = excluded.name;

-- ---------------------------------------------------------------------------
-- Topics
-- ---------------------------------------------------------------------------
insert into public.topics (subject_id, title, slug)
select s.id, t.title, t.slug
from public.subjects s
cross join (
  values
    ('Comprehension', 'comprehension'),
    ('Lexis and Structure', 'lexis-and-structure')
) as t(title, slug)
where s.code = 'ENG'
on conflict (subject_id, slug) do update set title = excluded.title;

-- ---------------------------------------------------------------------------
-- Questions
--
-- `options` must be exactly four objects: {"label":"A".."D","text":"..."}.
-- Explanations use one line per step; the results screen numbers them.
-- ---------------------------------------------------------------------------
insert into public.questions (
  topic_id,
  question_text,
  options,
  correct_option,
  explanation,
  is_ai_modified,
  year
)
select
  t.id,
  q.question_text,
  q.options,
  q.correct_option,
  q.explanation,
  false,
  q.year
from public.topics t
join public.subjects s on s.id = t.subject_id
join (
  values
    (
      'comprehension',
      $q$Read the passage and answer the question.

When Musa arrived in Lagos, he had only enough money for one week's rent. Rather than despair, he took a job as a bus conductor and saved a little every day. Within two years, he had opened a small provisions shop.

According to the passage, how did Musa respond to his financial difficulty?$q$,
      $j$[
        {"label":"A","text":"He borrowed money from friends."},
        {"label":"B","text":"He returned to his village."},
        {"label":"C","text":"He took a job and saved gradually."},
        {"label":"D","text":"He opened a provisions shop immediately."}
      ]$j$::jsonb,
      'C',
      $e$The passage says Musa had only enough money for one week's rent.
Instead of despairing, he took a job as a bus conductor.
He saved a little every day, and opened a shop only after two years.
Option C captures all three facts; option D confuses the final outcome with his first step.$e$,
      2024
    ),
    (
      'comprehension',
      $q$Read the passage and answer the question.

The harmattan wind swept through the market, lifting dust into the eyes of traders and forcing many to tie wrappers around their faces. By noon, only the most determined buyers remained.

The passage suggests that the harmattan made trading$q$,
      $j$[
        {"label":"A","text":"more profitable."},
        {"label":"B","text":"uncomfortable."},
        {"label":"C","text":"impossible."},
        {"label":"D","text":"noisier."}
      ]$j$::jsonb,
      'B',
      $e$Dust blowing into traders' eyes shows physical discomfort.
Many traders tied wrappers around their faces to protect themselves.
The fact that only the most determined buyers remained shows trade continued, so "impossible" is too strong.
Therefore the passage presents trading as uncomfortable, not impossible.$e$,
      2023
    ),
    (
      'lexis-and-structure',
      $q$Choose the option nearest in meaning to the word in quotation marks.

The chairman's speech was "terse" and to the point.$q$,
      $j$[
        {"label":"A","text":"lengthy"},
        {"label":"B","text":"concise"},
        {"label":"C","text":"confusing"},
        {"label":"D","text":"rude"}
      ]$j$::jsonb,
      'B',
      $e$"Terse" describes speech that uses few words while still being clear.
The phrase "and to the point" is a clue that the speech was brief and direct.
"Concise" means exactly that: short and clear.
"Lengthy" is the opposite, while "confusing" and "rude" are unrelated in meaning.$e$,
      2024
    ),
    (
      'lexis-and-structure',
      $q$Choose the option that best completes the sentence.

Neither the teacher nor the students ______ ready for the inspection.$q$,
      $j$[
        {"label":"A","text":"was"},
        {"label":"B","text":"were"},
        {"label":"C","text":"is"},
        {"label":"D","text":"has been"}
      ]$j$::jsonb,
      'B',
      $e$The correlative conjunction "neither ... nor" joins two subjects.
The rule of proximity says the verb agrees with the subject nearer to it.
The nearer subject is "students", which is plural.
A plural subject takes the plural past verb "were", so B is correct.$e$,
      2022
    ),
    (
      'lexis-and-structure',
      $q$Choose the option opposite in meaning to the word in quotation marks.

The businessman was remarkably "generous" with his time.$q$,
      $j$[
        {"label":"A","text":"kind"},
        {"label":"B","text":"stingy"},
        {"label":"C","text":"wealthy"},
        {"label":"D","text":"careless"}
      ]$j$::jsonb,
      'B',
      $e$"Generous" means willing to give freely, including one's time.
An antonym must mean the opposite: unwilling to give.
"Stingy" means unwilling to give or spend, so it is the opposite.
"Kind" is a synonym, while "wealthy" and "careless" are unrelated.$e$,
      2023
    )
) as q(topic_slug, question_text, options, correct_option, explanation, year)
  on q.topic_slug = t.slug
where s.code = 'ENG'
  and not exists (
    select 1
    from public.questions existing
    where existing.topic_id = t.id
      and existing.question_text = q.question_text
  );

commit;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
select
  s.name  as subject,
  t.title as topic,
  count(q.id) as questions
from public.subjects s
left join public.topics t on t.subject_id = s.id
left join public.questions q on q.topic_id = t.id
where s.code = 'ENG'
group by s.name, t.title
order by t.title;
