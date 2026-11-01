-- 일본어회화 지원 — 운영 DB(Supabase 프로젝트 all-that-quiz)에 1회 적용하는 SQL (2026-10-31)
-- SQL Editor에 통째로 붙여 넣고 Run. 모두 `create or replace`/`drop ... if exists`라 다시 실행해도 안전하다.
-- 같은 내용이 supabase/aggregates.sql에도 들어 있다(새 프로젝트를 만들 때 쓰는 원본).

-- ① 보조 함수 2개 ------------------------------------------------------------------------------
-- 질문에서 일본어 부분만 남긴다: 괄호 속 한글 발음을 지우고 가나·한자·장음(ー)만 남김. 중복 문제 판정용.
create or replace function question_core_ja(p_q text) returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(coalesce(p_q, ''), '\([^)]*\)', ' ', 'g'), '[^ぁ-んァ-ヶー一-龥]+', ' ', 'g'));
$$;
-- 정답 보기를 비교용으로: 괄호(한글 발음)를 지우고 가나·한자만 남긴다.
create or replace function answer_ja(p_a text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p_a, ''), '\([^)]*\)', '', 'g'), '[^ぁ-んァ-ヶー一-龥]', '', 'g');
$$;

-- ② similar_question: 새 문제를 넣기 전 "비슷한 문제가 이미 있나" 판정 ------------------------------
-- jp_ 주제는 ⓐ 정답이 같거나 ⓑ 한쪽 정답이 다른 쪽을 포함(4자 이상)하거나 ⓒ 질문의 일본어 부분이 0.6 이상 비슷하면 중복.
-- eng_ 분기와 경제(else) 분기는 현재 운영 중인 정의 그대로다(바뀐 것은 맨 위 jp_ 분기뿐).
create or replace function similar_question(p_topic text, p_q text, p_threshold real, p_answer text)
returns table (id uuid, q text, sim real) language sql stable as $$
  select s.id, s.q, s.sim from (
    select qq.id, qq.q,
      case when p_topic like 'jp\_%' then
        greatest(
          case when length(answer_ja(p_answer)) >= 2
                and answer_ja(qq.choices->>qq.correct) = answer_ja(p_answer)
               then 1.0 else 0 end,
          case when length(answer_ja(p_answer)) >= 4 and length(answer_ja(qq.choices->>qq.correct)) >= 4
                and (position(answer_ja(p_answer) in answer_ja(qq.choices->>qq.correct)) > 0
                  or position(answer_ja(qq.choices->>qq.correct) in answer_ja(p_answer)) > 0)
               then 1.0 else 0 end,
          case when length(question_core_ja(p_q)) >= 3
                and extensions.similarity(question_core_ja(qq.q), question_core_ja(p_q)) >= 0.6 then 1.0 else 0 end
        )::real
      when p_topic like 'eng\_%' then
        greatest(
          case when p_answer is not null
                and regexp_replace(lower(qq.choices->>qq.correct), '[^a-z0-9가-힣]', '', 'g') = regexp_replace(lower(p_answer), '[^a-z0-9가-힣]', '', 'g')
               then 1.0 else 0 end,
          case when p_answer is not null
                and length(answer_words(p_answer)) >= 4 and length(answer_words(qq.choices->>qq.correct)) >= 4
                and (position(' ' || answer_words(p_answer) || ' ' in ' ' || answer_words(qq.choices->>qq.correct) || ' ') > 0
                  or position(' ' || answer_words(qq.choices->>qq.correct) || ' ' in ' ' || answer_words(p_answer) || ' ') > 0)
               then 1.0 else 0 end,
          case when length(question_core_en(p_q)) >= 3
                and extensions.similarity(question_core_en(qq.q), question_core_en(p_q)) >= 0.6 then 1.0 else 0 end,
          case when length(question_core_en(p_q)) < 3 and length(question_core_en(qq.q)) < 3
                and extensions.similarity(question_core(qq.q), question_core(p_q)) >= 0.8 then 1.0 else 0 end
        )::real
      else extensions.similarity(question_core(qq.q), question_core(p_q)) end as sim
    from questions qq
    where qq.topic = p_topic and qq.active
  ) s
  where s.sim >= p_threshold
  order by s.sim desc limit 1;
$$;

-- ③ category_quiz_points: 랭킹의 분야별 점수 — 반환 열이 늘어나므로 지우고 다시 만든다 -------------
drop function if exists category_quiz_points(text[], date, date);
create or replace function category_quiz_points(p_user_keys text[], p_from date, p_to date)
returns table (user_key text, economy bigint, english bigint, japanese bigint)
language sql stable
as $$
  select uq.user_key,
         coalesce(sum(case when uq.correct then 10 else 2 end) filter (where uq.topic not like 'eng\_%' and uq.topic not like 'jp\_%'), 0)::bigint,
         coalesce(sum(case when uq.correct then 10 else 2 end) filter (where uq.topic like 'eng\_%'), 0)::bigint,
         coalesce(sum(case when uq.correct then 10 else 2 end) filter (where uq.topic like 'jp\_%'), 0)::bigint
  from used_questions uq
  where uq.user_key = any(p_user_keys)
    and (p_from is null or uq.answered_date >= p_from) and (p_to is null or uq.answered_date <= p_to)
  group by uq.user_key;
$$;

-- ④ 권한·보안 설정: 서버(service_role)만 호출. ③을 지우고 만들면서 권한이 초기화되므로 반드시 함께 실행 ----
revoke all on function question_core_ja(text) from public, anon, authenticated;
revoke all on function answer_ja(text) from public, anon, authenticated;
revoke all on function category_quiz_points(text[], date, date) from public, anon, authenticated;
revoke all on function similar_question(text, text, real, text) from public, anon, authenticated;
grant execute on function question_core_ja(text) to service_role;
grant execute on function answer_ja(text) to service_role;
grant execute on function category_quiz_points(text[], date, date) to service_role;
grant execute on function similar_question(text, text, real, text) to service_role;
alter function question_core_ja(text) set search_path = public;
alter function answer_ja(text) set search_path = public;
alter function category_quiz_points(text[], date, date) set search_path = public;
alter function similar_question(text, text, real, text) set search_path = public, extensions;

-- ⑤ 적용 확인(읽기 전용) — 아래를 따로 실행해 결과를 확인한다 -------------------------------------
-- (a) 반환 열에 japanese가 있어야 한다:
--   select pg_get_function_result('category_quiz_points(text[],date,date)'::regprocedure);
--   → TABLE(user_key text, economy bigint, english bigint, japanese bigint)
-- (b) 일본어 정답 비교 함수가 괄호 속 한글 발음을 무시하는지:
--   select answer_ja('すみません (스미마셍)');   → すみません
-- (c) 기존 영어·경제 판정이 그대로인지(영어 'hit the sack' 같은 새 표현은 빈 결과여야 정상):
--   select * from similar_question('eng_daily', 'Thanks for your help!', 0.55, 'You''re welcome.');
