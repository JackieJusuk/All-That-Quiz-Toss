import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---- 날짜(KST) 유틸 — "하루"의 기준을 한국 시간으로 고정한다 ----
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 알림 동의일 기준 "다음날" 날짜(KST). 알림은 동의한 다음날부터 발송을 시작한다.
function nextDayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---- 문제 생성 (기존 로직 그대로) ----
const TOPIC_LABELS = { stock: '주식 투자', realestate: '부동산 투자', fund: '펀드 투자' };

const TOPIC_CONCEPTS = {
  stock: [
    'PER', 'PBR', 'ROE', '배당금', '배당수익률', '분산투자', '코스피', '코스닥',
    '시가총액', '유상증자', '무상증자', '액면분할', '우선주와 보통주', '공매도',
    '상한가와 하한가', '시장가 주문과 지정가 주문',
  ],
  realestate: [
    '전세와 월세', 'LTV', 'DTI', 'DSR', '청약통장', '청약 가점제', '등기부등본',
    '재건축과 재개발', '확정일자', '전입신고', '주택임대차보호법', '계약갱신청구권',
    '중개수수료', '취득세와 보유세', '분양가상한제', '갭투자',
  ],
  fund: [
    '펀드의 기본 개념', 'ETF', '운용보수와 총보수', '기준가', '액티브 펀드와 패시브 펀드',
    '인덱스펀드', '리츠(REITs)', '환매수수료', '펀드를 통한 분산투자',
    '주식형/채권형/혼합형 펀드', '배당펀드', '펀드 평가등급',
  ],
};

const QUESTION_STYLES = [
  '개념 정의를 묻는 문제',
  '실제 숫자를 넣어 계산하게 하는 문제',
  '실생활 사례에 적용해보는 문제',
  '흔한 오해를 바로잡는 문제',
  '두 개념을 비교하는 문제',
];

function pickRandom(list, n) {
  const pool = [...list];
  const picked = [];
  for (let i = 0; i < n && pool.length; i++) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

const DIFF_KO = { easy: '쉬움(easy)', medium: '보통(medium)', hard: '어려움(hard)' };

const questionSchema = z.object({
  q: z.string().describe('4지선다 퀴즈 질문'),
  choices: z.array(z.string()).min(4).describe('보기 4개 이상'),
  reasoning: z.string().describe(
    '정답을 구하는 과정을 단계별로 적으세요. 숫자가 들어간 계산 문제라면 반드시 실제 숫자를 대입해 계산식을 세우고, ' +
    '각 보기와 대조해 정답이 맞는지 검산한 뒤에만 correct를 채우세요.'
  ),
  correct: z.number().int().min(0).describe('정답 보기의 인덱스(0부터 시작). 위 reasoning에서 검산한 결과와 반드시 일치해야 함'),
  explain: z.string().describe('정답 해설, 존댓말 1~2문장'),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

function buildSchema(count) {
  return z.object({ questions: z.array(questionSchema).min(count) });
}

function normalizeQuizSet(raw, count) {
  const questions = raw.questions.slice(0, count).map(q => {
    if (q.choices.length < 4 || q.correct > q.choices.length - 1) return null;
    if (q.correct > 3) return null;
    const choices = q.choices.length > 4 ? q.choices.slice(0, 4) : q.choices;
    return { q: q.q, choices, correct: q.correct, explain: q.explain, difficulty: q.difficulty };
  });
  if (questions.length !== count || questions.some(q => q === null)) return null;
  return { questions };
}

// 문제 문구와 보기에 숫자가 여럿 등장하면 "계산 문제"로 간주한다(DSR/LTV 대출 한도 계산처럼
// 숫자를 대입해 산술을 틀리기 쉬운 유형). 개념 설명형 문제는 대상에서 제외해 검증 호출을 아낀다.
function looksLikeCalculation(q) {
  const numericChoices = q.choices.filter(c => /\d/.test(c)).length;
  return /\d/.test(q.q) && numericChoices >= 3;
}

// 원래 정답을 보여주지 않고 처음부터 다시 풀게 해서, 생성 단계의 계산 실수를 독립적으로 검증한다.
async function verifyCalculationAnswer(q) {
  const verifySchema = z.object({ correct: z.number().int().min(0).describe('직접 계산해서 구한 정답 인덱스(0부터 시작)') });
  const prompt = `아래 퀴즈를 처음부터 직접 풀어서 정답 인덱스를 구하세요. 반드시 실제 숫자를 대입해 계산식을 세우고 검산하세요.\n\n질문: ${q.q}\n보기:\n${q.choices.map((c, i) => `${i}: ${c}`).join('\n')}`;
  try {
    const response = await client.messages.parse({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      output_config: { effort: 'medium', format: zodOutputFormat(verifySchema) },
      system: '당신은 경제/투자 퀴즈의 정답을 검증하는 깐깐한 감수자입니다. 원래 제시된 정답은 참고하지 말고, 스스로 처음부터 계산해서 정답 인덱스를 구하세요.',
      messages: [{ role: 'user', content: prompt }],
    });
    return response.parsed_output ? response.parsed_output.correct : null;
  } catch (e) {
    console.error('answer verification call failed:', e);
    return null; // 검증 호출 자체가 실패한 경우는 통과시킨다(네트워크 오류로 정상 문제까지 계속 버려지는 걸 막기 위해)
  }
}

// 계산형 문제만 골라 독립적으로 재검산하고, 원래 정답과 다르면 걸러낸다.
async function verifyCalculationQuestions(questions) {
  const keep = await Promise.all(questions.map(async q => {
    if (!looksLikeCalculation(q)) return true;
    const verified = await verifyCalculationAnswer(q);
    if (verified === null) return true;
    return verified === q.correct;
  }));
  return questions.filter((_, i) => keep[i]);
}

// verify: 계산 문제 자기검증 호출 실행 여부. 백그라운드 풀 채우기(사용자가 기다리지 않음)는 true,
// 사용자가 화면에서 직접 기다리는 실시간 자가치유 생성은 false로 넘겨 응답 속도를 우선한다.
async function generateQuizSet(topicId, count, difficulty, avoidQuestions, { verify = true } = {}) {
  const label = TOPIC_LABELS[topicId];
  const concepts = pickRandom(TOPIC_CONCEPTS[topicId], Math.min(5, TOPIC_CONCEPTS[topicId].length));
  const style = QUESTION_STYLES[Math.floor(Math.random() * QUESTION_STYLES.length)];
  const diffInstruction = count === 1
    ? `난이도는 ${DIFF_KO[difficulty] || DIFF_KO.medium} 수준으로 만들고, difficulty 필드는 "${difficulty || 'medium'}"으로 표기하세요.`
    : '난이도는 easy/medium/hard를 골고루 섞어주세요.';
  const avoidBlock = avoidQuestions && avoidQuestions.length
    ? `\n\n아래 문제들은 이미 출제됐습니다. 절대 그대로 반복하지 말고, 다루는 소재와 문구가 겹치지 않는 새 문제를 만들어주세요:\n${avoidQuestions.map(q => `- ${q}`).join('\n')}`
    : '';

  const userPrompt = `주제: ${label}\n이번에 활용할 세부 개념 후보: ${concepts.join(', ')} (이 중 자유롭게 골라 문제를 구성하세요)\n문제 스타일: ${style}\n\n한국어 4지선다 퀴즈 문제를 정확히 ${count}개 만들어주세요. 각 문제는 선택지를 정확히 4개씩만 가져야 합니다. ${diffInstruction} 정답 해설은 존댓말 1~2문장으로 작성하세요.${avoidBlock}`;
  const schema = buildSchema(count);

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.messages.parse({
        model: 'claude-sonnet-5',
        max_tokens: 16000,
        output_config: { effort: 'medium', format: zodOutputFormat(schema) },
        system:
          '당신은 투자 입문자를 위한 경제/투자 퀴즈를 만드는 콘텐츠 작가입니다. 사실관계가 정확하고 검증 가능한 내용만 사용하며, 오해를 유발할 수 있는 문제나 선택지는 만들지 않습니다. ' +
          '요청받은 문제 개수와 선택지 개수를 반드시 정확히 지킵니다. 숫자가 들어간 계산 문제(대출 한도, 이자, 수익률 등)는 특히 실수가 잦으니, reasoning에 실제 숫자를 대입한 계산식을 쓰고 보기와 대조해 검산한 뒤에만 정답을 확정하세요.',
        messages: [{ role: 'user', content: userPrompt }],
      });
      if (response.parsed_output) {
        const normalized = normalizeQuizSet(response.parsed_output, count);
        if (normalized) {
          if (!verify) return normalized;
          const verified = await verifyCalculationQuestions(normalized.questions);
          if (verified.length === count) return { questions: verified };
          lastErr = new Error('calculation verification failed');
          continue;
        }
        lastErr = new Error('normalization failed');
        continue;
      }
      lastErr = new Error('no parsed_output');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// ---- 문제 풀 상시 유지(백그라운드 사전생성) ----
// 풀이 활발한 사용자는 개인별로 "안 푼 문제"가 이 숫자보다 먼저 바닥날 수 있고, 그러면
// pickQuestionForUser가 실시간 생성(자가치유)으로 빠지며 응답이 느려진다. 여유를 넉넉히 둬서
// 실시간 생성 자체가 거의 발생하지 않도록 한다.
const POOL_TARGET_PER_TOPIC = 80; // 3개 주제 * 80 = 240문제
let topupInFlight = false;

async function ensurePoolTopUp() {
  if (topupInFlight) return;
  topupInFlight = true;
  try {
    for (const topicId of Object.keys(TOPIC_LABELS)) {
      const { count, error } = await supabase
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('topic', topicId);
      if (error) { console.error('topup count error', topicId, error); continue; }
      const current = count ?? 0;
      if (current < POOL_TARGET_PER_TOPIC) {
        const need = Math.min(10, POOL_TARGET_PER_TOPIC - current); // 한 번에 최대 10개씩 채운다
        const generated = await generateQuizSet(topicId, need, 'medium');
        const rows = generated.questions.map(q => ({
          topic: topicId, q: q.q, choices: q.choices, correct: q.correct, explain: q.explain, difficulty: q.difficulty,
        }));
        const { error: insErr } = await supabase.from('questions').insert(rows);
        if (insErr) console.error('topup insert error', topicId, insErr);
        else console.log(`pool topup: +${rows.length} ${topicId} (was ${current})`);
      }
    }
  } catch (e) {
    console.error('pool topup failed', e);
  } finally {
    topupInFlight = false;
  }
}

// ---- 보상 정책: 출석 10P + 광고 시청 10P + 정답 10P + 오답 2P. 퀴즈 풀이 횟수 제한은 없다. ----
// 문제풀이권(광고 시청 기록)이 없어도 퀴즈는 풀 수 있다 — 광고 없이 풀면 광고 시청 포인트(10P)만 못 받을 뿐이다.
const POINTS_PER_EVENT = 10;
const POINTS_WRONG_EVENT = 2;
// 연속 학습(퀴즈를 푼 날짜 기준) 10일마다 100P 보너스. 끊기면 그 시점부터 다시 10일을 채워야 한다.
const STREAK_BONUS_DAYS = 10;
const STREAK_BONUS_POINTS = 100;

// 아직 소비하지 않은(=아직 그 광고로 문제를 안 받은) 광고 시청 기록이 있는지 확인한다.
async function hasUnconsumedAdTicket(userKey) {
  const { data, error } = await supabase
    .from('ad_views')
    .select('id')
    .eq('user_key', userKey)
    .eq('consumed', false)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

// 가장 오래된 미소비 광고 시청권 1장을 소비 처리한다. 소비에 성공하면 true.
async function consumeOneAdTicket(userKey) {
  const { data, error } = await supabase
    .from('ad_views')
    .select('id')
    .eq('user_key', userKey)
    .eq('consumed', false)
    .order('viewed_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  if (!data.length) return false;
  const { error: updErr } = await supabase.from('ad_views').update({ consumed: true }).eq('id', data[0].id);
  if (updErr) throw updErr;
  return true;
}

// 하루 1회 출석 기록. 이미 오늘 기록이 있으면(유니크 제약 위반) 조용히 무시한다.
async function ensureAttendanceToday(userKey) {
  const { error } = await supabase.from('attendance').insert({ user_key: userKey, checked_date: todayKST() });
  if (error && error.code !== '23505') throw error;
}

// ---- 사용자 진행 통계 ----
function computeStreak(datesDesc, todayStr) {
  if (!datesDesc.length) return 0;
  const oneDayMs = 24 * 60 * 60 * 1000;
  const todayDate = new Date(`${todayStr}T00:00:00Z`);
  const mostRecentDate = new Date(`${datesDesc[0]}T00:00:00Z`);
  const gapDays = Math.round((todayDate - mostRecentDate) / oneDayMs);
  if (gapDays > 1) return 0; // 하루 이상 걸렀으면 스트릭 끊김
  let streak = 1;
  let cursor = mostRecentDate;
  for (let i = 1; i < datesDesc.length; i++) {
    const expectedPrev = new Date(cursor.getTime() - oneDayMs).toISOString().slice(0, 10);
    if (datesDesc[i] === expectedPrev) {
      streak++;
      cursor = new Date(`${expectedPrev}T00:00:00Z`);
    } else break;
  }
  return streak;
}

// 연속된 날짜 구간(끊기면 새로 시작)마다 10일째, 20일째, ...에 보너스가 발생한 날짜를 모두 반환한다.
function computeStreakBonusDates(datesAsc) {
  const bonusDates = [];
  let runStart = 0;
  for (let i = 1; i <= datesAsc.length; i++) {
    const isBreak = i === datesAsc.length || Math.round(
      (new Date(`${datesAsc[i]}T00:00:00Z`) - new Date(`${datesAsc[i - 1]}T00:00:00Z`)) / (24 * 60 * 60 * 1000)
    ) !== 1;
    if (isBreak) {
      const runLen = i - runStart;
      const milestones = Math.floor(runLen / STREAK_BONUS_DAYS);
      for (let m = 1; m <= milestones; m++) {
        bonusDates.push(datesAsc[runStart + m * STREAK_BONUS_DAYS - 1]);
      }
      runStart = i;
    }
  }
  return bonusDates;
}

async function computeUserStats(userKey) {
  const [
    { data, error },
    { data: adData, error: adErr },
    { data: attData, error: attErr },
    { data: refAsReferrer, error: refErr1 },
    { data: refAsReferred, error: refErr2 },
  ] = await Promise.all([
    supabase.from('used_questions').select('answered_date, correct, topic').eq('user_key', userKey),
    supabase.from('ad_views').select('id').eq('user_key', userKey),
    supabase.from('attendance').select('id').eq('user_key', userKey),
    supabase.from('referrals').select('id').eq('referrer_key', userKey),
    supabase.from('referrals').select('id').eq('referred_key', userKey),
  ]);
  if (error) throw error;
  if (adErr) throw adErr;
  if (attErr) throw attErr;
  if (refErr1) throw refErr1;
  if (refErr2) throw refErr2;
  const totalCorrect = data.filter(r => r.correct).length;
  const totalWrong = data.length - totalCorrect;
  const datesAsc = [...new Set(data.map(r => r.answered_date))].sort();
  const datesDesc = [...datesAsc].reverse();
  const streak = computeStreak(datesDesc, todayKST());
  const streakBonusCount = computeStreakBonusDates(datesAsc).length;
  const rem = streak % STREAK_BONUS_DAYS;
  const daysToNextStreakBonus = rem === 0 ? STREAK_BONUS_DAYS : STREAK_BONUS_DAYS - rem;
  // 포인트 = (출석 + 광고 시청 + 정답 + 친구 초대(초대자/피초대자 모두)) * 10 + 오답 * 2 + 연속학습 10일 보너스 * 100.
  const points = (attData.length + adData.length + totalCorrect + refAsReferrer.length + refAsReferred.length) * POINTS_PER_EVENT
    + totalWrong * POINTS_WRONG_EVENT
    + streakBonusCount * STREAK_BONUS_POINTS;

  // 오늘 푼 퀴즈만 주제별로 묶어 결과 화면의 "오늘의 주제별 점수"에 쓴다.
  const todayRows = data.filter(r => r.answered_date === todayKST());
  const todayTopicScores = {};
  for (const topicId of Object.keys(TOPIC_LABELS)) {
    const rows = todayRows.filter(r => r.topic === topicId);
    const correct = rows.filter(r => r.correct).length;
    const wrong = rows.length - correct;
    todayTopicScores[topicId] = { correct, wrong, points: correct * POINTS_PER_EVENT + wrong * POINTS_WRONG_EVENT };
  }

  return {
    totalCorrect, streak, points, streakBonusDays: STREAK_BONUS_DAYS, daysToNextStreakBonus,
    referralCount: refAsReferrer.length, todayTopicScores,
  };
}

// ---- 문제 하나 뽑기: 안 쓴 문제 우선, 풀이 바닥나면 그때만 즉석 생성(자가치유) ----
async function pickQuestionForUser(topicId, difficulty, userKey) {
  const { data: usedRows, error: usedErr } = await supabase
    .from('used_questions')
    .select('question_id')
    .eq('user_key', userKey);
  if (usedErr) throw usedErr;
  const usedIds = usedRows.map(r => r.question_id);

  async function query(withDifficulty) {
    let q = supabase.from('questions').select('*').eq('topic', topicId).limit(30);
    if (withDifficulty) q = q.eq('difficulty', difficulty);
    if (usedIds.length) q = q.not('id', 'in', `(${usedIds.join(',')})`);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  let candidates = await query(true);
  if (!candidates.length) candidates = await query(false);
  if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];

  // 사용자가 화면에서 직접 기다리는 경로라 계산 문제 자기검증(추가 API 왕복)은 생략해 응답을 빠르게 한다.
  const generated = await generateQuizSet(topicId, 1, difficulty, undefined, { verify: false });
  const g = generated.questions[0];
  const { data: inserted, error: insErr } = await supabase
    .from('questions')
    .insert({ topic: topicId, q: g.q, choices: g.choices, correct: g.correct, explain: g.explain, difficulty: g.difficulty })
    .select()
    .single();
  if (insErr) throw insErr;
  return inserted;
}

// ---- 라우트 ----

// 출석 기록(자동, 1일 1회) + 현재 통계 + 문제풀이권 보유 여부
app.get('/api/status', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    // 출석 기록과 티켓 조회는 서로 무관하니 동시에 보내 왕복 횟수를 줄인다.
    const [, hasAdTicket] = await Promise.all([
      ensureAttendanceToday(userKey),
      hasUnconsumedAdTicket(userKey),
    ]);
    const stats = await computeUserStats(userKey); // 방금 기록한 출석을 집계해야 하므로 위 작업 이후에 실행
    res.json({ hasAdTicket, ...stats });
  } catch (err) {
    console.error('status failed:', err);
    res.status(502).json({ error: 'status_failed' });
  }
});

// 친구 초대 상세 — 프로모션 화면에서 "친구 초대" 카드를 눌렀을 때 보여줄 목록.
// 초대 링크로 들어온 사람이 닉네임을 저장(=접속을 마쳐야)해야 referrals에 기록되므로,
// 여기 뜨는 이름/횟수는 전부 "실제로 접속한 친구" 기준이다.
app.get('/api/referrals', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('referred_key, created_date')
      .eq('referrer_key', userKey)
      .order('created_date', { ascending: true });
    if (error) throw error;

    const referredKeys = [...new Set(data.map(r => r.referred_key))];
    let nicknameByKey = {};
    if (referredKeys.length) {
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('user_key, nickname')
        .in('user_key', referredKeys);
      if (profErr) throw profErr;
      nicknameByKey = Object.fromEntries(profiles.map(p => [p.user_key, p.nickname]));
    }

    const countByKey = {};
    for (const row of data) countByKey[row.referred_key] = (countByKey[row.referred_key] || 0) + 1;

    const friends = referredKeys
      .map(key => ({ nickname: nicknameByKey[key] || '알 수 없음', count: countByKey[key] }))
      .sort((a, b) => b.count - a.count);

    res.json({ totalCount: data.length, friends });
  } catch (err) {
    console.error('referrals fetch failed:', err);
    res.status(502).json({ error: 'referrals_fetch_failed' });
  }
});

// 앱 최초 진입용 — 닉네임 조회 + 출석 기록 + 통계 계산을 한 요청으로 묶는다.
// 클라이언트가 /api/profile과 /api/status를 순서대로 부르면 왕복이 두 번 걸려
// 콜드 스타트 등으로 응답이 느릴 때 초기 로딩이 특히 길어지므로, 필요한 조회를
// 최대한 병렬로 처리해 왕복을 하나로 줄인다.
app.get('/api/init', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    const [{ data: profile, error: profErr }, , hasAdTicket] = await Promise.all([
      supabase.from('profiles').select('nickname').eq('user_key', userKey).maybeSingle(),
      ensureAttendanceToday(userKey),
      hasUnconsumedAdTicket(userKey),
    ]);
    if (profErr) throw profErr;
    const stats = await computeUserStats(userKey); // 방금 기록한 출석을 집계해야 하므로 위 작업 이후에 실행
    res.json({ nickname: profile ? profile.nickname : null, hasAdTicket, ...stats });
  } catch (err) {
    console.error('init failed:', err);
    res.status(502).json({ error: 'init_failed' });
  }
});

// 광고 시청 리워드 — userEarnedReward 이벤트가 발생했을 때만 클라이언트가 호출한다.
// 시청 1회 = 10포인트 + 문제풀이권 1장. 시청 횟수 제한은 없다.
app.post('/api/ads/reward', async (req, res) => {
  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  try {
    const { error: insErr } = await supabase
      .from('ad_views')
      .insert({ user_key: userKey, viewed_date: todayKST(), consumed: false });
    if (insErr) throw insErr;

    // 방금 넣은 광고 시청 기록을 각자 독립적으로 집계하므로 동시에 조회한다.
    const [hasAdTicket, stats] = await Promise.all([
      hasUnconsumedAdTicket(userKey),
      computeUserStats(userKey),
    ]);
    res.json({ hasAdTicket, ...stats });
  } catch (err) {
    console.error('ad reward failed:', err);
    res.status(502).json({ error: 'ad_reward_failed' });
  }
});

// 문제 미리보기 — 광고 시청 중에 화면에 보여줄 문제를 미리 받아둔다. 티켓을 쓰지도, 풀이 기록을
// 남기지도 않는 순수 조회라 광고 시청 여부와 무관하게 언제든 호출할 수 있다. 실제 소비/기록은
// 광고 보상이 확정된 뒤 /api/questions·/api/questions/answer가 그대로 담당한다.
app.post('/api/questions/peek', async (req, res) => {
  ensurePoolTopUp().catch(e => console.error('background topup error', e));

  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const topicId = String(body.topic || '');
  if (!TOPIC_LABELS[topicId]) {
    res.status(400).json({ error: 'invalid_topic' });
    return;
  }
  const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';

  try {
    const question = await pickQuestionForUser(topicId, difficulty, userKey);
    res.json({
      id: question.id,
      q: question.q,
      choices: question.choices,
      correct: question.correct,
      explain: question.explain,
      difficulty: question.difficulty,
    });
  } catch (err) {
    console.error('question peek failed:', err);
    res.status(502).json({ error: 'generation_failed' });
  }
});

// 문제 하나 받기 — 문제풀이권(=미소비 광고 시청 기록)이 있어야 발급된다. 하루 개수 제한은 없다.
app.post('/api/questions', async (req, res) => {
  ensurePoolTopUp().catch(e => console.error('background topup error', e));

  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const topicId = String(body.topic || '');
  if (!TOPIC_LABELS[topicId]) {
    res.status(400).json({ error: 'invalid_topic' });
    return;
  }
  const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';

  try {
    const consumed = await consumeOneAdTicket(userKey);
    if (!consumed) {
      res.status(403).json({ error: 'ad_required' });
      return;
    }

    const question = await pickQuestionForUser(topicId, difficulty, userKey);
    res.json({
      id: question.id,
      q: question.q,
      choices: question.choices,
      correct: question.correct,
      explain: question.explain,
      difficulty: question.difficulty,
    });
  } catch (err) {
    console.error('question fetch failed:', err);
    res.status(502).json({ error: 'generation_failed' });
  }
});

// 답변 기록 — 문제풀이권은 이미 /api/questions에서 소비됐으므로 여기서는 결과만 기록한다.
app.post('/api/questions/answer', async (req, res) => {
  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const questionId = String(body.questionId || '');
  const topicId = String(body.topic || '');
  const correct = Boolean(body.correct);
  if (!questionId || !TOPIC_LABELS[topicId]) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  try {
    const { error: insErr } = await supabase.from('used_questions').insert({
      user_key: userKey, question_id: questionId, topic: topicId, correct, answered_date: todayKST(),
    });
    if (insErr) throw insErr;

    const [hasAdTicket, stats] = await Promise.all([
      hasUnconsumedAdTicket(userKey),
      computeUserStats(userKey),
    ]);
    res.json({ hasAdTicket, ...stats });
  } catch (err) {
    console.error('answer record failed:', err);
    res.status(502).json({ error: 'record_failed' });
  }
});

// 오답노트
app.get('/api/wrongnote', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    const { data, error } = await supabase
      .from('used_questions')
      .select('topic, answered_at, questions(q, choices, correct, explain, difficulty)')
      .eq('user_key', userKey)
      .eq('correct', false)
      .order('answered_at', { ascending: false });
    if (error) throw error;
    res.json({
      items: data.map(r => ({ topic: TOPIC_LABELS[r.topic] || r.topic, q: r.questions })),
    });
  } catch (err) {
    console.error('wrongnote failed:', err);
    res.status(502).json({ error: 'wrongnote_failed' });
  }
});

// 닉네임 조회
app.get('/api/profile', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('user_key', userKey)
      .maybeSingle();
    if (error) throw error;
    res.json({ nickname: data ? data.nickname : null });
  } catch (err) {
    console.error('profile fetch failed:', err);
    res.status(502).json({ error: 'profile_fetch_failed' });
  }
});

// 닉네임 등록/변경 (최초 접속 시 1회 입력)
// ref: 초대 링크(?ref=)로 들어온 경우의 초대자 user_key.
// - profiles.referred_by("친구" 배지 표시용)는 최초 가입 시점 값을 그대로 유지한다(1회만 귀속, 덮어쓰지 않음).
// - referrals(포인트 적립용)는 반대로, 유효한 ref가 올 때마다 매번 기록한다 — 어뷰징 방지 장치를
//   의도적으로 넣지 않은 프로모션 단계 정책(사용자 확인, requirements.md §9 참고). 같은 두 사람이어도
//   초대 링크로 다시 들어올 때마다 양쪽 모두 +10포인트가 반복 적립된다.
app.post('/api/profile', async (req, res) => {
  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const nickname = String(body.nickname || '').trim().slice(0, 12);
  const ref = body.ref ? String(body.ref) : null;
  if (!nickname) {
    res.status(400).json({ error: 'invalid_nickname' });
    return;
  }
  try {
    const { data: existing, error: findErr } = await supabase
      .from('profiles')
      .select('referred_by')
      .eq('user_key', userKey)
      .maybeSingle();
    if (findErr) throw findErr;
    const referredBy = existing ? existing.referred_by : (ref && ref !== userKey ? ref : null);

    const { error } = await supabase
      .from('profiles')
      .upsert({ user_key: userKey, nickname, referred_by: referredBy }, { onConflict: 'user_key' });
    if (error) throw error;

    if (ref && ref !== userKey) {
      const { error: refInsErr } = await supabase
        .from('referrals')
        .insert({ referrer_key: ref, referred_key: userKey, created_date: todayKST() });
      // 실패해도 닉네임 저장 자체는 이미 끝났으니 무시하고 넘어간다.
      if (refInsErr) console.error('referral insert failed:', refInsErr);
    }

    res.json({ nickname });
  } catch (err) {
    console.error('profile save failed:', err);
    res.status(502).json({ error: 'profile_save_failed' });
  }
});

// 매일 출석 알림 동의 여부 저장 (동의/비동의 모두 기록해서 구별한다).
// 동의한 경우 time(HH:MM)도 함께 저장하고, 다음날부터 그 시간대에 알림을 보낼 수 있도록
// notify_agreed_at(동의 시각)을 기준으로 "발송 시작일 = 동의한 날의 다음날"을 서버가 계산한다.
app.post('/api/notification-preference', async (req, res) => {
  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const agreed = Boolean(body.agreed);
  const time = agreed && /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(body.time || '')) ? String(body.time) : null;
  try {
    // profiles.nickname은 NOT NULL이라 upsert로 새 행을 만들 수는 없다 — 온보딩상
    // 닉네임 저장이 알림 동의보다 항상 먼저 일어나므로, 여기서는 기존 행을 업데이트만 한다.
    const { data, error } = await supabase
      .from('profiles')
      .update({
        notify_agreed: agreed,
        notify_time: time,
        notify_agreed_at: new Date().toISOString(),
        notify_start_date: agreed ? nextDayKST() : null,
      })
      .eq('user_key', userKey)
      .select('user_key');
    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(409).json({ error: 'profile_not_found' });
      return;
    }
    res.json({ agreed, time });
  } catch (err) {
    console.error('notification preference save failed:', err);
    res.status(502).json({ error: 'notification_preference_save_failed' });
  }
});

// 랭킹 (일간/주간/전체 실제 집계, 닉네임 표시)
app.get('/api/ranking', async (req, res) => {
  const period = ['weekly', 'all'].includes(req.query.period) ? req.query.period : 'daily';
  const userKey = String(req.query.userKey || 'guest');
  try {
    const today = todayKST();
    let fromDate = today;
    if (period === 'weekly') {
      fromDate = new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    // 전체(누적) 랭킹은 기간 제한 없이 처음부터 지금까지의 기록을 모두 합산한다.
    const withDateFilter = (q, col) => (period === 'all' ? q : q.gte(col, fromDate));

    const [
      { data, error },
      { data: adData, error: adErr },
      { data: attData, error: attErr },
      { data: refAsReferrerData, error: refErr1 },
      { data: refAsReferredData, error: refErr2 },
      { data: allQuizDates, error: quizDatesErr },
    ] = await Promise.all([
      withDateFilter(supabase.from('used_questions').select('user_key, correct'), 'answered_date'),
      withDateFilter(supabase.from('ad_views').select('user_key'), 'viewed_date'),
      withDateFilter(supabase.from('attendance').select('user_key'), 'checked_date'),
      withDateFilter(supabase.from('referrals').select('referrer_key'), 'created_date'),
      withDateFilter(supabase.from('referrals').select('referred_key'), 'created_date'),
      // 연속학습 보너스는 구간이 기간 밖에서 시작됐을 수도 있어 전체 날짜를 따로 조회해 직접 계산한다.
      supabase.from('used_questions').select('user_key, answered_date'),
    ]);
    if (error) throw error;
    if (adErr) throw adErr;
    if (attErr) throw attErr;
    if (refErr1) throw refErr1;
    if (refErr2) throw refErr2;
    if (quizDatesErr) throw quizDatesErr;

    // 포인트와 동일한 계산: 출석/광고 시청/정답/친구 초대(양쪽 모두) 각각 10포인트, 오답은 2포인트.
    const scores = {};
    for (const row of data) {
      scores[row.user_key] = (scores[row.user_key] || 0) + (row.correct ? POINTS_PER_EVENT : POINTS_WRONG_EVENT);
    }
    for (const row of adData) {
      scores[row.user_key] = (scores[row.user_key] || 0) + POINTS_PER_EVENT;
    }
    for (const row of attData) {
      scores[row.user_key] = (scores[row.user_key] || 0) + POINTS_PER_EVENT;
    }
    for (const row of refAsReferrerData) {
      scores[row.referrer_key] = (scores[row.referrer_key] || 0) + POINTS_PER_EVENT;
    }
    for (const row of refAsReferredData) {
      scores[row.referred_key] = (scores[row.referred_key] || 0) + POINTS_PER_EVENT;
    }
    const datesByUser = {};
    for (const row of allQuizDates) {
      if (!datesByUser[row.user_key]) datesByUser[row.user_key] = new Set();
      datesByUser[row.user_key].add(row.answered_date);
    }
    for (const key of Object.keys(datesByUser)) {
      const bonusDates = computeStreakBonusDates([...datesByUser[key]].sort());
      const inRange = period === 'all' ? bonusDates : bonusDates.filter(d => d >= fromDate);
      if (inRange.length) {
        scores[key] = (scores[key] || 0) + inRange.length * STREAK_BONUS_POINTS;
      }
    }
    const keys = Object.keys(scores);
    const nicknameMap = {};
    const referredByMap = {};
    if (keys.length) {
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('user_key, nickname, referred_by')
        .in('user_key', keys);
      if (profErr) throw profErr;
      for (const p of profiles) {
        nicknameMap[p.user_key] = p.nickname;
        referredByMap[p.user_key] = p.referred_by;
      }
    }

    const rows = keys
      .map(key => ({
        userKey: key,
        me: key === userKey,
        // 실명 식별 없이, "내가 초대한 사람"인지 여부만 배지로 알려준다.
        friend: referredByMap[key] === userKey,
        label: nicknameMap[key] || `사용자-${key.slice(-4)}`,
        score: scores[key],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    res.json({ rows });
  } catch (err) {
    console.error('ranking failed:', err);
    res.status(502).json({ error: 'ranking_failed' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`quiz question API listening on http://localhost:${port}`);
  ensurePoolTopUp().catch(e => console.error('startup topup error', e));
});
