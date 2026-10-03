-- 올댓퀴즈 집계 함수 — 점수/랭킹/통계를 DB 안에서 계산해 "결과 몇 줄"만 서버로 돌려준다.
--
-- 왜 필요한가(2026-10-04): Supabase(PostgREST)는 한 번의 조회에 최대 1,000행만 돌려준다(대시보드 API 설정의
-- Max rows 기본값). 예전 서버 코드는 used_questions 등 기록을 통째로 가져와 JS에서 더했기 때문에, 기록이
-- 1,000행을 넘는 순간 오류 없이 점수·랭킹이 덜 더해지고, 이미 푼 문제 목록이 잘려 같은 문제가 다시 나올 수
-- 있었다(requirements.md §12, §13 원칙 7). 아래 함수들은 행 수와 무관하게 정확하다.
--
-- 점수 산식은 server/index.js와 동일하다:
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
    'today_weekly_award_points', (select coalesce(sum(points), 0) from weekly_awards where user_key = p_user_key and week_end_date = p_today)
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
    and (p_difficulty is null or q.difficulty = p_difficulty)
    and not exists (select 1 from used_questions uq where uq.user_key = p_user_key and uq.question_id = q.id)
  limit p_limit;
$$;

-- 서버(service_role)만 호출할 수 있게 한다. 함수는 기본적으로 모두에게 실행 권한이 열려 있으므로 명시적으로 막는다.
revoke all on function streak_bonus_dates() from public, anon, authenticated;
revoke all on function leaderboard(date, date, boolean, int) from public, anon, authenticated;
revoke all on function user_stats(text, date) from public, anon, authenticated;
revoke all on function unused_questions(text, text, text, int) from public, anon, authenticated;
grant execute on function streak_bonus_dates() to service_role;
grant execute on function leaderboard(date, date, boolean, int) to service_role;
grant execute on function user_stats(text, date) to service_role;
grant execute on function unused_questions(text, text, text, int) to service_role;

-- 함수 안에서 테이블 이름이 항상 public 스키마를 가리키게 고정(Supabase 보안 점검 권고: function_search_path_mutable)
alter function streak_bonus_dates() set search_path = public;
alter function leaderboard(date, date, boolean, int) set search_path = public;
alter function user_stats(text, date) set search_path = public;
alter function unused_questions(text, text, text, int) set search_path = public;

-- 집계 속도용 인덱스(사용자별·날짜별 조회)
create index if not exists used_questions_user_date_idx on used_questions (user_key, answered_date);
create index if not exists attendance_user_idx on attendance (user_key);
create index if not exists weekly_awards_user_idx on weekly_awards (user_key);
