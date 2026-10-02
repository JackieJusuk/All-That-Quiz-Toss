-- 올댓퀴즈(All-That-Quiz) Supabase 스키마 — 새 Supabase 프로젝트의 SQL Editor에서 한 번 실행한다.
-- CashQuiz는 대시보드에서 테이블을 수동으로 만들었기 때문에 원본 마이그레이션이 없다.
-- 이 파일은 운영 중인 CashQuiz DB의 실제 구조(information_schema/pg_constraint 조회, 2026-10-02)와
-- 똑같이 맞춘 것이다 — id 타입(uuid), used_questions 복합 기본키(같은 문제 중복 기록 방지) 등.
-- 2026-10-02 올댓퀴즈 Supabase 프로젝트(all-that-quiz, ap-northeast-1)에 이 내용 그대로 적용함.

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  topic text not null,                 -- 'basic' | 'money' | 'life'
  q text not null,
  choices jsonb not null,              -- 보기 4개 문자열 배열
  correct integer not null,
  explain text not null,
  difficulty text not null,            -- 'easy' | 'medium' | 'hard'
  created_at timestamptz not null default now()
);
create index if not exists questions_topic_difficulty_idx on questions (topic, difficulty);

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

-- 서버는 service_role 키로만 접근하므로(RLS 우회) 클라이언트용 정책은 만들지 않는다.
-- 대신 RLS를 켜서 anon 키로는 아무 테이블도 읽고 쓸 수 없게 막아둔다.
alter table questions enable row level security;
alter table used_questions enable row level security;
alter table profiles enable row level security;
alter table ad_views enable row level security;
alter table attendance enable row level security;
alter table referrals enable row level security;
alter table weekly_awards enable row level security;
