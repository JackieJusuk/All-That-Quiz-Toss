-- 경제퀴즈 Supabase 스키마 — 새 Supabase 프로젝트의 SQL Editor에서 한 번 실행한다.
-- CashQuiz는 대시보드에서 테이블을 수동으로 만들었기 때문에 원본 마이그레이션이 없다.
-- 이 파일은 server/index.js가 실제로 읽고 쓰는 컬럼/제약을 기준으로 역추적해 만든 것이다.

create table if not exists questions (
  id bigint generated always as identity primary key,
  topic text not null,                 -- 'basic' | 'money' | 'life'
  q text not null,
  choices jsonb not null,              -- 보기 4개 문자열 배열
  correct smallint not null,
  explain text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  created_at timestamptz not null default now()
);
create index if not exists questions_topic_difficulty_idx on questions (topic, difficulty);

create table if not exists used_questions (
  id bigint generated always as identity primary key,
  user_key text not null,
  question_id bigint not null references questions (id) on delete cascade, -- 오답노트 조인(questions(...))에 필요
  topic text not null,
  correct boolean not null,
  answered_date date not null,         -- KST 기준 날짜
  answered_at timestamptz not null default now()
);
create index if not exists used_questions_user_idx on used_questions (user_key);
create index if not exists used_questions_date_idx on used_questions (answered_date);

create table if not exists profiles (
  user_key text primary key,           -- upsert onConflict: 'user_key'
  nickname text not null,
  referred_by text,
  notify_agreed boolean,
  notify_time text,                    -- 'HH:MM', 동의 시에만
  notify_agreed_at timestamptz,
  notify_start_date date,
  created_at timestamptz not null default now()
);

create table if not exists ad_views (
  id bigint generated always as identity primary key,
  user_key text not null,
  viewed_date date not null,
  viewed_at timestamptz not null default now(),
  consumed boolean not null default false
);
create index if not exists ad_views_user_idx on ad_views (user_key, consumed, viewed_at);
create index if not exists ad_views_date_idx on ad_views (viewed_date);

create table if not exists attendance (
  id bigint generated always as identity primary key,
  user_key text not null,
  checked_date date not null,
  unique (user_key, checked_date)      -- 하루 1회 출석(중복 insert 시 23505를 서버가 무시)
);
create index if not exists attendance_date_idx on attendance (checked_date);

create table if not exists referrals (
  id bigint generated always as identity primary key,
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
