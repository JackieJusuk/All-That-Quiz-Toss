-- 올댓퀴즈 집계 함수 — 점수/랭킹/통계를 DB 안에서 계산해 "결과 몇 줄"만 서버로 돌려준다.
--
-- 왜 필요한가(2026-10-04): Supabase(PostgREST)는 한 번의 조회에 최대 1,000행만 돌려준다(대시보드 API 설정의
-- Max rows 기본값). 예전 서버 코드는 used_questions 등 기록을 통째로 가져와 JS에서 더했기 때문에, 기록이
-- 1,000행을 넘는 순간 오류 없이 점수·랭킹이 덜 더해지고, 이미 푼 문제 목록이 잘려 같은 문제가 다시 나올 수
-- 있었다(requirements.md §12, §13 원칙 7). 아래 함수들은 행 수와 무관하게 정확하다.
--
-- 점수 산식은 server/index.js와 동일하다(오답 극복 1개당 1점 추가, 2026-10-13):
--   출석·광고 시청·정답·친구 초대(초대자/피초대자 각각) 10점, 오답 2점,
--   연속 학습(퀴즈 푼 날짜 기준) 10일째·20일째…마다 100점, 주간 우등생 시상으로 받은 포인트.
--
-- 서버만 service_role 키로 호출한다. 공개 키(anon/authenticated)로는 호출하지 못하게 권한을 막는다.
-- schema.sql 다음에 한 번 실행한다(다시 실행해도 안전 — create or replace).

-- 연속 학습 보너스가 발생한 날짜: 사용자별로 퀴즈를 푼 날짜가 하루도 빠짐없이 이어진 구간마다 10, 20, ...번째 날.
-- (날짜 - 순번)이 같은 날짜끼리 하나의 연속 구간이 되는 "gaps and islands" 방식. JS의 computeStreakBonusDates와 같은 결과.
create or replace function streak_bonus_dates()
returns table (user_key text, bonus_date date)
language sql stable
as $$
  with d as (
    select distinct uq.user_key, uq.answered_date from used_questions uq
  ), g as (
    select d.user_key, d.answered_date,
           d.answered_date - (row_number() over (partition by d.user_key order by d.answered_date))::int as grp
    from d
  ), r as (
    select g.user_key, g.answered_date,
           row_number() over (partition by g.user_key, g.grp order by g.answered_date) as pos
    from g
  )
  select r.user_key, r.answered_date from r where r.pos % 10 = 0;
$$;

-- 기간 점수 상위 p_limit명. p_from/p_to가 null이면 전체 기간(누적).
-- p_include_awards: 랭킹 화면은 true(받은 시상 포인트 포함), 주간 시상 순위 산정은 false(그 주 활동만).
create or replace function leaderboard(p_from date, p_to date, p_include_awards boolean, p_limit int)
returns table (user_key text, score bigint)
language sql stable
as $$
  with ev as (
    select uq.user_key, case when uq.correct then 10 else 2 end as pts from used_questions uq
      where (p_from is null or uq.answered_date >= p_from) and (p_to is null or uq.answered_date <= p_to)
    union all
    select av.user_key, 10 from ad_views av
      where (p_from is null or av.viewed_date >= p_from) and (p_to is null or av.viewed_date <= p_to)
    union all
    select a.user_key, 10 from attendance a
      where (p_from is null or a.checked_date >= p_from) and (p_to is null or a.checked_date <= p_to)
    union all
    select rf.referrer_key, 10 from referrals rf
      where (p_from is null or rf.created_date >= p_from) and (p_to is null or rf.created_date <= p_to)
    union all
    select rf.referred_key, 10 from referrals rf
      where (p_from is null or rf.created_date >= p_from) and (p_to is null or rf.created_date <= p_to)
    union all
    select wa.user_key, wa.points from weekly_awards wa
      where p_include_awards
        and (p_from is null or wa.week_end_date >= p_from) and (p_to is null or wa.week_end_date <= p_to)
    union all
    select sb.user_key, 100 from streak_bonus_dates() sb
      where (p_from is null or sb.bonus_date >= p_from) and (p_to is null or sb.bonus_date <= p_to)
    union all
    select mc.user_key, mc.points from migration_credits mc
      where (p_from is null or mc.claimed_date >= p_from) and (p_to is null or mc.claimed_date <= p_to)
    union all
    select wo.user_key, 1 from wrong_overcomes wo -- 오답 극복 1개당 1점(2026-10-13)
      where (p_from is null or wo.overcome_date >= p_from) and (p_to is null or wo.overcome_date <= p_to)
    union all
    select qr.user_key, qr.bonus_points from question_reports qr -- 인정된 오답 신고 보너스(2026-10-19)
      where qr.status = 'accepted'
        and (p_from is null or qr.reviewed_date >= p_from) and (p_to is null or qr.reviewed_date <= p_to)
  )
  select ev.user_key, sum(ev.pts)::bigint as score
  from ev
  group by ev.user_key
  order by score desc, ev.user_key
  limit p_limit;
$$;

-- 한 사용자의 누적·오늘 집계를 JSON 하나로 돌려준다(computeUserStats가 사용). p_today는 서버가 계산한 KST 날짜.
-- quiz_dates는 퀴즈를 푼 날짜 목록(중복 제거, 오름차순) — 연속 학습 일수 계산용. 배열 하나로 오므로 행 수 제한과 무관.
create or replace function user_stats(p_user_key text, p_today date)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'total_correct', (select count(*) from used_questions where user_key = p_user_key and correct),
    'total_wrong', (select count(*) from used_questions where user_key = p_user_key and not correct),
    'attendance', (select count(*) from attendance where user_key = p_user_key),
    'ads', (select count(*) from ad_views where user_key = p_user_key),
    'ref_as_referrer', (select count(*) from referrals where referrer_key = p_user_key),
    'ref_as_referred', (select count(*) from referrals where referred_key = p_user_key),
    'weekly_award_points', (select coalesce(sum(points), 0) from weekly_awards where user_key = p_user_key),
    'migration_points', (select coalesce(sum(points), 0) from migration_credits where user_key = p_user_key),
    'overcome_count', (select count(*) from wrong_overcomes where user_key = p_user_key),
    -- 인정된 오답 신고 보너스(2026-10-19)
    'report_points', (select coalesce(sum(bonus_points), 0) from question_reports where user_key = p_user_key and status = 'accepted'),
    'today_report_count', (select count(*) from question_reports where user_key = p_user_key and status = 'accepted' and reviewed_date = p_today),
    'today_report_points', (select coalesce(sum(bonus_points), 0) from question_reports where user_key = p_user_key and status = 'accepted' and reviewed_date = p_today),
    -- 배지용(2026-10-13): 주제별 누적 정답 수, 어려움 난이도 누적 정답 수
    'topic_correct', (select coalesce(jsonb_object_agg(topic, c), '{}'::jsonb)
                      from (select topic, count(*) as c from used_questions
                            where user_key = p_user_key and correct group by topic) tc),
    'topic_wrong', (select coalesce(jsonb_object_agg(topic, c), '{}'::jsonb) -- 분야별 점수용(2026-10-18)
                    from (select topic, count(*) as c from used_questions
                          where user_key = p_user_key and not correct group by topic) tw),
    'hard_correct', (select count(*) from used_questions uq join questions q on q.id = uq.question_id
                     where uq.user_key = p_user_key and uq.correct and q.difficulty = 'hard'),
    'quiz_dates', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                   from (select distinct answered_date as d from used_questions where user_key = p_user_key) x),
    'today_topics', (select coalesce(jsonb_object_agg(topic, jsonb_build_object('correct', c, 'wrong', w)), '{}'::jsonb)
                     from (select topic, count(*) filter (where correct) as c, count(*) filter (where not correct) as w
                           from used_questions where user_key = p_user_key and answered_date = p_today
                           group by topic) t),
    'today_attendance', (select count(*) from attendance where user_key = p_user_key and checked_date = p_today),
    'today_ads', (select count(*) from ad_views where user_key = p_user_key and viewed_date = p_today),
    'today_referrals', (select count(*) from referrals where referrer_key = p_user_key and created_date = p_today)
                     + (select count(*) from referrals where referred_key = p_user_key and created_date = p_today),
    'today_weekly_award_count', (select count(*) from weekly_awards where user_key = p_user_key and week_end_date = p_today),
    'today_weekly_award_points', (select coalesce(sum(points), 0) from weekly_awards where user_key = p_user_key and week_end_date = p_today),
    'today_migration_count', (select count(*) from migration_credits where user_key = p_user_key and claimed_date = p_today),
    'today_migration_points', (select coalesce(sum(points), 0) from migration_credits where user_key = p_user_key and claimed_date = p_today),
    'today_overcome_count', (select count(*) from wrong_overcomes where user_key = p_user_key and overcome_date = p_today)
  );
$$;

-- 사용자가 아직 안 푼 문제 후보(최대 p_limit개). p_difficulty가 null이면 난이도 무관.
-- 예전처럼 푼 문제 ID 목록을 통째로 보내 not in으로 거르지 않으므로, 푼 문제가 아무리 많아도 정확하다.
create or replace function unused_questions(p_user_key text, p_topic text, p_difficulty text, p_limit int)
returns setof questions
language sql stable
as $$
  select q.* from questions q
  where q.topic = p_topic
    and q.active -- 비슷한 문제로 비활성화된 것은 내지 않는다(2026-10-17)
    and (p_difficulty is null or q.difficulty = p_difficulty)
    and not exists (select 1 from used_questions uq where uq.user_key = p_user_key and uq.question_id = q.id)
  limit p_limit;
$$;

-- 비슷한 문제 판별(2026-10-17, requirements.md §3.21). 문구만 다른 같은 문제가 ID가 달라 "이미 푼 문제" 제외에
-- 걸리지 않고 반복 출제되던 문제를 막는다. "~에 대한 설명으로 옳은 것은?" 같은 상투적 문구를 지운 핵심 문장끼리
-- pg_trgm 유사도를 비교한다(원문 그대로 비교하면 상투구 때문에 서로 다른 문제도 비슷하게 나옴).
-- 0.55 이상이면 같은 문제로 본다 — 실제 데이터로 확인한 경계(0.50~0.52는 같은 문제/다른 문제가 섞임).
create or replace function question_core(p_q text) returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(p_q,
    '(에 대한|에 대해|설명으로|설명 중|설명한|설명은|가장|옳은|올바른|옳게|적절한|정확한|타당한|바로잡은|것은|것을|고르면|무엇일까요|무엇인가요|무엇인가|무엇이라|하는가|일까요|얼마인가요|얼마인가|얼마일까요|얼마인지|흔히|오해하는|오해하기 쉬운|내용 중|다음 중|사례로|의미로|특징으로|어떻게|있는|해당하는)', ' ', 'g'),
    '[^가-힣A-Za-z0-9%,.]+', ' ', 'g'));
$$;

-- 영어 질문에서 영어 부분만 뽑은 것(소문자). 영어 문제 중복 판별용(2026-10-18).
create or replace function question_core_en(p_q text) returns text language sql immutable as $$
  select trim(lower(regexp_replace(p_q, '[^A-Za-z'' ]+', ' ', 'g')));
$$;

-- 같은 주제의 활성 문제 중 p_q와 비슷한 1개(p_threshold 이상일 때만). 서버가 새 문제를 넣기 전에 호출.
-- 경제: 상투구를 지운 핵심 문장끼리 pg_trgm 유사도.
-- 영어(eng_ 주제, 2026-10-18): "다음 영어 표현의 뜻으로 알맞은 것은?"처럼 한국어 지시문이 유형마다 똑같아서 경제 방식으로는
--   서로 다른 문제가 모두 비슷하게 나온다. 대신 ① 정답 표현이 같거나(대소문자·문장부호 무시) ② 질문의 영어 부분끼리
--   유사도 0.6 이상이거나 ③ 영어가 없는 질문끼리 한국어 핵심 문장 유사도 0.8 이상이면 중복(1.0)으로 본다.
create or replace function similar_question(p_topic text, p_q text, p_threshold real, p_answer text)
returns table (id uuid, q text, sim real) language sql stable as $$
  select s.id, s.q, s.sim from (
    select qq.id, qq.q,
      case when p_topic like 'eng\_%' then
        greatest(
          case when p_answer is not null
                and regexp_replace(lower(qq.choices->>qq.correct), '[^a-z0-9가-힣]', '', 'g') = regexp_replace(lower(p_answer), '[^a-z0-9가-힣]', '', 'g')
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

-- 이미 쌓인 비슷한 문제 정리(2026-10-17에 1회 실행, 74개 비활성화): 주제별로 오래된 문제부터 남기고,
-- 먼저 남긴 문제와 비슷한 나중 문제를 active=false로 바꾼다. 다시 실행해도 안전(이미 정리된 것은 건너뜀).
-- do $$
-- declare r record; dropped uuid[] := '{}';
-- begin
--   for r in
--     with c as materialized (select id, topic, created_at, question_core(q) core from questions where active)
--     select a.id aid, b.id bid from c a join c b on a.topic = b.topic and (a.created_at, a.id) < (b.created_at, b.id)
--     where extensions.similarity(a.core, b.core) >= 0.55
--     order by b.created_at, b.id, a.created_at
--   loop
--     if not (r.bid = any(dropped)) and not (r.aid = any(dropped)) then dropped := dropped || r.bid; end if;
--   end loop;
--   update questions set active = false where id = any(dropped);
-- end $$;

-- 랭킹에 함께 보여줄 사용자별 분야별 퀴즈 점수(2026-10-18, requirements.md §3.22). 정답 10·오답 2점.
-- 주제 이름이 eng_로 시작하면 영어, 나머지는 경제. p_from/p_to가 null이면 전체 기간.
create or replace function category_quiz_points(p_user_keys text[], p_from date, p_to date)
returns table (user_key text, economy bigint, english bigint)
language sql stable
as $$
  select uq.user_key,
         coalesce(sum(case when uq.correct then 10 else 2 end) filter (where uq.topic not like 'eng\_%'), 0)::bigint,
         coalesce(sum(case when uq.correct then 10 else 2 end) filter (where uq.topic like 'eng\_%'), 0)::bigint
  from used_questions uq
  where uq.user_key = any(p_user_keys)
    and (p_from is null or uq.answered_date >= p_from) and (p_to is null or uq.answered_date <= p_to)
  group by uq.user_key;
$$;

-- 문제 하나의 전체 풀이 수와 정답 수(2026-10-12, 퀴즈 화면의 "이 문제 정답률" 표시용).
create or replace function question_stats(p_question_id uuid)
returns table (total bigint, correct bigint)
language sql stable
as $$
  select count(*)::bigint, count(*) filter (where uq.correct)::bigint
  from used_questions uq where uq.question_id = p_question_id;
$$;

-- 서버(service_role)만 호출할 수 있게 한다. 함수는 기본적으로 모두에게 실행 권한이 열려 있으므로 명시적으로 막는다.
revoke all on function streak_bonus_dates() from public, anon, authenticated;
revoke all on function leaderboard(date, date, boolean, int) from public, anon, authenticated;
revoke all on function user_stats(text, date) from public, anon, authenticated;
revoke all on function unused_questions(text, text, text, int) from public, anon, authenticated;
revoke all on function question_stats(uuid) from public, anon, authenticated;
revoke all on function question_core(text) from public, anon, authenticated;
revoke all on function question_core_en(text) from public, anon, authenticated;
revoke all on function category_quiz_points(text[], date, date) from public, anon, authenticated;
revoke all on function similar_question(text, text, real, text) from public, anon, authenticated;
grant execute on function streak_bonus_dates() to service_role;
grant execute on function leaderboard(date, date, boolean, int) to service_role;
grant execute on function user_stats(text, date) to service_role;
grant execute on function unused_questions(text, text, text, int) to service_role;
grant execute on function question_stats(uuid) to service_role;
grant execute on function question_core(text) to service_role;
grant execute on function question_core_en(text) to service_role;
grant execute on function category_quiz_points(text[], date, date) to service_role;
grant execute on function similar_question(text, text, real, text) to service_role;

-- 함수 안에서 테이블 이름이 항상 public 스키마를 가리키게 고정(Supabase 보안 점검 권고: function_search_path_mutable)
alter function streak_bonus_dates() set search_path = public;
alter function leaderboard(date, date, boolean, int) set search_path = public;
alter function user_stats(text, date) set search_path = public;
alter function unused_questions(text, text, text, int) set search_path = public;
alter function question_stats(uuid) set search_path = public;
alter function question_core(text) set search_path = public;
alter function question_core_en(text) set search_path = public;
alter function category_quiz_points(text[], date, date) set search_path = public;
alter function similar_question(text, text, real, text) set search_path = public, extensions;

-- 집계 속도용 인덱스(사용자별·날짜별 조회)
create index if not exists used_questions_user_date_idx on used_questions (user_key, answered_date);
create index if not exists attendance_user_idx on attendance (user_key);
create index if not exists weekly_awards_user_idx on weekly_awards (user_key);
create index if not exists used_questions_question_idx on used_questions (question_id); -- question_stats용
