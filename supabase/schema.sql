-- 올댓퀴즈(All-That-Quiz) Supabase 스키마 — 새 Supabase 프로젝트의 SQL Editor에서 한 번 실행한다.
-- CashQuiz는 대시보드에서 테이블을 수동으로 만들었기 때문에 원본 마이그레이션이 없다.
-- 이 파일은 운영 중인 CashQuiz DB의 실제 구조(information_schema/pg_constraint 조회, 2026-10-02)와
-- 똑같이 맞춘 것이다 — id 타입(uuid), used_questions 복합 기본키(같은 문제 중복 기록 방지) 등.
-- 2026-10-02 올댓퀴즈 Supabase 프로젝트(all-that-quiz, ap-northeast-1)에 이 내용 그대로 적용함.

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  topic text not null,                 -- 'basic' | 'money' | 'life' | 'invest'
  q text not null,
  choices jsonb not null,              -- 보기 4개 문자열 배열
  correct integer not null,
  explain text not null,
  difficulty text not null,            -- 'easy' | 'medium' | 'hard'
  created_at timestamptz not null default now()
);
create index if not exists questions_topic_difficulty_idx on questions (topic, difficulty);
-- 비슷한 문제 중복 방지(2026-10-17): 문구만 다른 같은 문제는 지우지 않고 active=false로 출제에서만 뺀다
-- (푼 기록·오답노트가 참조하므로 삭제하지 않는다. 되돌리려면 active=true). 유사도 계산용 pg_trgm 확장.
alter table questions add column if not exists active boolean not null default true;
-- 문제 고유번호(2026-10-18): 경제·영어 모든 문제에 만든 순서대로 1, 2, 3... 번호를 붙인다(기존 문제는 created_at 순으로 채움).
-- 풀이 기록(used_questions.question_no)에도 같은 번호를 남긴다. 기존 기록은 아래 update로 채우고, 새 기록은 서버가 넣는다.
create sequence if not exists questions_no_seq;
alter table questions add column if not exists no bigint;
update questions q set no = n.rn from (select id, row_number() over (order by created_at, id) rn from questions) n
  where q.id = n.id and q.no is null;
select setval('questions_no_seq', (select coalesce(max(no), 0) from questions) + 1, false);
alter table questions alter column no set default nextval('questions_no_seq');
alter table questions alter column no set not null;
alter sequence questions_no_seq owned by questions.no;
create unique index if not exists questions_no_idx on questions (no);
create index if not exists questions_topic_active_idx on questions (topic, difficulty) where active;
-- 영어 문제 일괄 재검사(2026-10-18)를 마친 시각 — 서버 recheckEnglishQuestions가 재시작 때 다시 검사하지 않게 하는 표시
alter table questions add column if not exists recheck_at timestamptz;
alter table questions add column if not exists recheck2_at timestamptz; -- 2차 재검사(독립 검증 2회 일치) 완료 표시
create extension if not exists pg_trgm with schema extensions;

create table if not exists used_questions (
  user_key text not null,
  question_id uuid not null references questions (id), -- 오답노트 조인(questions(...))에 필요
  topic text not null,
  correct boolean not null,
  answered_date date not null,         -- KST 기준 날짜
  answered_at timestamptz not null default now(),
  primary key (user_key, question_id)  -- 같은 사용자가 같은 문제를 두 번 기록하지 못하게 막는다(§13 원칙 7)
);
create index if not exists used_questions_date_idx on used_questions (answered_date);
-- 푼 문제의 고유번호(2026-10-18, questions.no). 기존 기록 채우기:
alter table used_questions add column if not exists question_no bigint;
update used_questions uq set question_no = q.no from questions q where q.id = uq.question_id and uq.question_no is null;

create table if not exists profiles (
  user_key text primary key,           -- upsert onConflict: 'user_key'
  nickname text not null,
  created_at timestamptz not null default now(),
  referred_by text,
  notify_agreed boolean,
  notify_time text,                    -- 'HH:MM', 동의 시에만
  notify_agreed_at timestamptz,
  notify_start_date date
);

create table if not exists ad_views (
  id uuid primary key default gen_random_uuid(),
  user_key text not null,
  viewed_date date not null,
  viewed_at timestamptz not null default now(),
  consumed boolean not null default false
);
create index if not exists ad_views_user_idx on ad_views (user_key, consumed, viewed_at);
create index if not exists ad_views_date_idx on ad_views (viewed_date);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  user_key text not null,
  checked_date date not null,
  checked_at timestamptz not null default now(),
  unique (user_key, checked_date)      -- 하루 1회 출석(중복 insert 시 23505를 서버가 무시)
);
create index if not exists attendance_date_idx on attendance (checked_date);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_key text not null,
  referred_key text not null,
  created_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on referrals (referrer_key);
create index if not exists referrals_referred_idx on referrals (referred_key);
create index if not exists referrals_date_idx on referrals (created_date);

create table if not exists weekly_awards (
  id bigint generated always as identity primary key,
  user_key text not null,
  week_end_date date not null,
  rank smallint not null check (rank in (1, 2, 3)),
  points integer not null,
  created_at timestamptz not null default now(),
  unique (week_end_date, rank)
);

-- CashQuiz 종료(2026-11-04)에 따른 포인트 이관 적립 이력. CashQuiz의 /api/migration/redeem이
-- 발급한 클레임 코드 1개당 이 테이블에 행이 하나 생긴다(source_code unique로 같은 코드 중복 적립 방지).
-- 2026-10-04 추가, requirements.md §3.X 참고.
create table if not exists migration_credits (
  id uuid primary key default gen_random_uuid(),
  user_key text not null,
  points integer not null,
  source text not null default 'cashquiz',
  source_code text not null unique,
  claimed_date date not null,          -- KST 기준 날짜. "오늘 적립한 포인트"에 집계하는 용도
  claimed_at timestamptz not null default now()
);
create index if not exists migration_credits_user_idx on migration_credits (user_key);

-- 서버는 service_role 키로만 접근하므로(RLS 우회) 클라이언트용 정책은 만들지 않는다.
-- 대신 RLS를 켜서 anon 키로는 아무 테이블도 읽고 쓸 수 없게 막아둔다.
alter table questions enable row level security;
alter table used_questions enable row level security;
alter table profiles enable row level security;
alter table ad_views enable row level security;
alter table attendance enable row level security;
alter table referrals enable row level security;
alter table weekly_awards enable row level security;
alter table migration_credits enable row level security;

-- 오답 극복 기록(2026-10-12): 오답노트에서 틀렸던 문제를 다시 풀어 맞히면 남긴다. 이 기록이 있는 문제는
-- 오답노트에서 빠진다("졸업"). 극복 1개당 +1포인트(2026-10-13 사용자 결정, 하루 개수 제한 없음 —
-- 문제 하나는 한 번만 극복할 수 있으므로 같은 문제로 반복 적립은 안 된다).
create table if not exists wrong_overcomes (
  user_key text not null,
  question_id uuid not null references questions (id),
  overcome_at timestamptz not null default now(),
  overcome_date date not null default ((now() at time zone 'Asia/Seoul')::date), -- KST 날짜(랭킹 기간 집계용)
  primary key (user_key, question_id)
);
alter table wrong_overcomes enable row level security;

-- 오답 신고(2026-10-19, requirements.md §3.27). 사용자가 "오답 신고하기"를 누르면 서버가 그 자리에서 AI로 다시 검토해
-- status를 accepted(오류 맞음: 문제 출제 제외 + bonus_points 20점) / rejected(이상 없음)로 바꾼다.
-- 같은 사람이 같은 문제를 두 번 신고할 수 없다. 보너스는 reviewed_date 기준으로 포인트·랭킹에 합산된다(aggregates.sql).
create table if not exists question_reports (
  id bigint generated always as identity primary key,
  user_key text not null,
  question_id uuid not null references questions (id),
  question_no bigint,
  selected integer,                    -- 신고자가 고른 보기
  reason text,
  status text not null default 'pending', -- pending | accepted | rejected
  review_note text,                    -- AI 판정 유형과 이유
  bonus_points integer not null default 0,
  created_at timestamptz not null default now(),
  created_date date not null,          -- KST, 하루 신고 횟수 제한용
  reviewed_at timestamptz,
  reviewed_date date,                  -- KST, 보너스가 잡히는 날
  unique (user_key, question_id)
);
alter table question_reports enable row level security;
create index if not exists question_reports_user_idx on question_reports (user_key);
create index if not exists question_reports_question_idx on question_reports (question_id);

-- 영어 원어민 발음 듣기(2026-10-21, requirements.md §3.29). 문제마다 읽을 영어(speech_lines: [{speaker:'A'|'B'|'N', text}])와
-- Google Cloud TTS로 만든 MP3 주소(audio_url)를 저장한다. MP3 파일은 공개 Storage 버킷 question-audio에 q{번호}.mp3로 둔다.
alter table questions add column if not exists speech_lines jsonb;
alter table questions add column if not exists audio_url text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-audio', 'question-audio', true, 2097152, array['audio/mpeg'])
on conflict (id) do nothing;
