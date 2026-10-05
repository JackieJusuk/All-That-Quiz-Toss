import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { readFileSync } from 'node:fs';

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
const TOPIC_LABELS = { basic: '시장 원리', money: '금융·금리', life: '세금·연금', invest: '재테크' };

const TOPIC_CONCEPTS = {
  basic: [
    '수요와 공급', '기회비용', '매몰비용', 'GDP', '인플레이션', '디플레이션', '스태그플레이션',
    '경기순환', '실업률', '가격탄력성', '한계효용', '비교우위', '독점과 과점', '시장실패',
    '외부효과', '공공재',
  ],
  money: [
    '기준금리', '단리와 복리', '72의 법칙', '명목금리와 실질금리', '고정금리와 변동금리',
    '예금자보호제도', '환율', '원화 강세와 약세', '채권 가격과 금리의 관계', '통화정책',
    '양적완화', '한국은행의 역할', '소비자물가지수(CPI)', '신용점수',
  ],
  life: [
    '연말정산', '소득세 누진세율', '4대 보험', '국민연금', '퇴직연금(DB/DC/IRP)', '부가가치세',
    '신용카드와 체크카드 소득공제', '비상금', '신용카드 리볼빙', '보장성 보험과 저축성 보험',
    '실손보험', '최저임금', 'ISA 계좌', '고정비와 변동비 관리',
  ],
  // 재테크(2026-10-04 추가): CashQuiz의 주식·펀드·부동산 문제 290개를 옮겨 와 하나로 묶은 주제.
  // 문제 풀이 부족할 때만 아래 개념으로 새 문제를 만든다(requirements.md §3.1).
  invest: [
    '주식과 채권의 차이', '시가총액', 'PER(주가수익비율)', 'PBR(주가순자산비율)', '배당금과 배당수익률',
    '보통주와 우선주', '액면분할', '상한가와 하한가', 'ETF', '펀드 기준가', '인덱스펀드와 액티브펀드',
    '펀드 보수와 수수료', '적립식 투자', '분산투자', '전세와 월세', '전입신고와 확정일자',
    '계약갱신청구권', 'LTV와 DSR', '주택청약통장', '재건축과 재개발', '취득세',
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

// 문제 문구와 보기에 숫자가 여럿 등장하면 "계산 문제"로 간주한다(복리 이자·실질금리 계산처럼
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
      system: '당신은 경제 상식 퀴즈의 정답을 검증하는 깐깐한 감수자입니다. 원래 제시된 정답은 참고하지 말고, 스스로 처음부터 계산해서 정답 인덱스를 구하세요.',
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
          '당신은 경제 상식을 쌓고 싶은 일반인을 위한 경제 퀴즈를 만드는 콘텐츠 작가입니다. 사실관계가 정확하고 검증 가능한 내용만 사용하며, 오해를 유발할 수 있는 문제나 선택지는 만들지 않습니다. ' +
          '요청받은 문제 개수와 선택지 개수를 반드시 정확히 지킵니다. 숫자가 들어간 계산 문제(이자, 물가상승률, 세금, 환율 환산 등)는 특히 실수가 잦으니, reasoning에 실제 숫자를 대입한 계산식을 쓰고 보기와 대조해 검산한 뒤에만 정답을 확정하세요.',
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
const POOL_TARGET_PER_TOPIC = 80; // 주제마다 최소 80문제(재테크는 CashQuiz에서 옮겨 온 290문제로 이미 넘음)
let topupInFlight = false;

// 재테크 주제의 초기 문제(CashQuiz의 주식·펀드·부동산 문제 290개, 같은 질문 중복 제거, 2026-10-04 이관).
// DB에 아직 없으면 서버 시작 시 채운다 — 새 Supabase 프로젝트로 옮길 때도 자동으로 들어간다.
// 이미 있는 문제(id 기준)는 건너뛰므로 여러 번 실행돼도 중복되지 않는다. AI 생성(ensurePoolTopUp)보다 먼저
// 실행해야 재테크 주제가 "문제 부족"으로 보여 불필요하게 새 문제를 만들지 않는다.
const INVEST_SEED = JSON.parse(readFileSync(new URL('./seed/invest_questions.json', import.meta.url), 'utf8'));

async function seedInvestQuestions() {
  const { count, error } = await supabase
    .from('questions').select('id', { count: 'exact', head: true }).eq('topic', 'invest');
  if (error) throw error;
  if ((count ?? 0) >= INVEST_SEED.length) return;
  const rows = INVEST_SEED.map(q => ({ ...q, topic: 'invest' }));
  const { error: upErr } = await supabase.from('questions').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (upErr) throw upErr;
  console.log(`invest seed: ${rows.length}문제 확인/추가 (기존 ${count ?? 0})`);
}
// 서버가 뜨자마자(콜드 스타트 직후 첫 요청과 동시에) 시작하고, ensurePoolTopUp은 이게 끝날 때까지 기다린다.
const investSeedReady = seedInvestQuestions().catch(e => console.error('invest seed error', e));

async function ensurePoolTopUp() {
  if (topupInFlight) return;
  topupInFlight = true;
  try {
    await investSeedReady;
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
// 주간 우등생 시상: 매주 일요일 0시~토요일 23:59:59(KST) 성적 1~3등에게 지급. 인덱스 0=1등.
const WEEKLY_AWARD_POINTS = [100, 50, 20];

// CashQuiz 종료(2026-11-06)에 따른 포인트 이관 — CashQuiz가 발급한 클레임 코드를 이 서버가
// 서버-서버로 검증받아 적립한다(requirements.md §3.X).
const CASHQUIZ_API_BASE = process.env.CASHQUIZ_API_BASE || 'https://cashquiz2-sg.onrender.com';
const MIGRATION_SHARED_SECRET = process.env.MIGRATION_SHARED_SECRET;

// KST 벽시계 값을 담은 Date(내부 필드는 UTC로 읽어야 KST 시/분/요일이 나옴) — todayKST()와 같은 트릭.
function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// dateStr(KST 날짜)이 속한 주(일요일~토요일)의 시작/끝 날짜.
function weekRangeKST(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=일 ... 6=토
  const sunday = new Date(d.getTime() - dow * 24 * 60 * 60 * 1000);
  const saturday = new Date(sunday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { sunday: sunday.toISOString().slice(0, 10), saturday: saturday.toISOString().slice(0, 10) };
}

// 다음 시상(이번 주 토요일 23:59:59 KST)까지 남은 일수. 오늘이 토요일이면 0.
function daysUntilNextWeeklyAwardKST() {
  const dow = nowKST().getUTCDay();
  return (6 - dow + 7) % 7;
}

// "이미 완전히 끝난" 가장 최근 토요일의 날짜(KST). 오늘이 토요일이고 23:59를 아직 안 지났다면
// 지난주 토요일을 가리킨다 — awardWeeklyTop3IfDue()가 "지급 대상 주"를 찾는 데 쓴다.
function lastCompletedSaturdayKST() {
  const now = nowKST();
  const dow = now.getUTCDay();
  const isSaturdayPastDeadline = dow === 6 && now.getUTCHours() === 23 && now.getUTCMinutes() >= 59;
  const daysAgo = isSaturdayPastDeadline ? 0 : dow + 1;
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

// 한 사용자의 누적·오늘 집계는 DB 함수 user_stats가 계산해 JSON 하나로 돌려준다(supabase/aggregates.sql).
// 예전처럼 기록을 통째로 가져와 더하면 Supabase의 1회 조회 최대 1,000행 제한에 걸려, 1,000문제 넘게 푼
// 사용자의 포인트가 조용히 덜 계산됐다(2026-10-04 수정).
async function computeUserStats(userKey) {
  const today = todayKST();
  const { data: agg, error } = await supabase.rpc('user_stats', { p_user_key: userKey, p_today: today });
  if (error) throw error;
  const n = key => Number(agg[key] || 0);
  const totalCorrect = n('total_correct');
  const totalWrong = n('total_wrong');
  const datesAsc = agg.quiz_dates || [];
  const datesDesc = [...datesAsc].reverse();
  const streak = computeStreak(datesDesc, todayKST());
  const streakBonusCount = computeStreakBonusDates(datesAsc).length;
  const rem = streak % STREAK_BONUS_DAYS;
  const daysToNextStreakBonus = rem === 0 ? STREAK_BONUS_DAYS : STREAK_BONUS_DAYS - rem;
  const weeklyAwardPoints = n('weekly_award_points');
  const migrationPoints = n('migration_points');
  // 포인트 = (출석 + 광고 시청 + 정답 + 친구 초대(초대자/피초대자 모두)) * 10 + 오답 * 2 + 연속학습 10일 보너스 * 100
  //        + 주간 우등생 시상(주간 1~3등에게 지급된 실제 포인트 합) + CashQuiz에서 이관받은 포인트 합(§3.X).
  const points = (n('attendance') + n('ads') + totalCorrect + n('ref_as_referrer') + n('ref_as_referred')) * POINTS_PER_EVENT
    + totalWrong * POINTS_WRONG_EVENT
    + streakBonusCount * STREAK_BONUS_POINTS
    + weeklyAwardPoints
    + migrationPoints;

  // 오늘 푼 퀴즈만 주제별로 묶어 결과 화면의 "오늘의 주제별 점수"에 쓴다.
  const todayTopics = agg.today_topics || {};
  const todayTopicScores = {};
  for (const topicId of Object.keys(TOPIC_LABELS)) {
    const correct = Number(todayTopics[topicId]?.correct || 0);
    const wrong = Number(todayTopics[topicId]?.wrong || 0);
    todayTopicScores[topicId] = { correct, wrong, points: correct * POINTS_PER_EVENT + wrong * POINTS_WRONG_EVENT };
  }

  // 퀴즈(주제별) 외에 오늘 포인트에 기여하는 나머지 항목(출석/광고 시청/친구 초대/연속학습 보너스).
  // 이 넷 + todayTopicScores의 합이 "오늘 실제로 적립된 포인트 총합"과 정확히 일치해야 한다 —
  // 위 points 계산식(전체 누적)과 항목이 완전히 같고, 여기서는 오늘 날짜로만 필터링하기 때문.
  const todayAttendanceCount = n('today_attendance');
  const todayAdCount = n('today_ads');
  const todayReferralCount = n('today_referrals');
  const todayStreakBonusCount = computeStreakBonusDates(datesAsc).includes(today) ? 1 : 0;
  // 주간 시상은 지급된 날(토요일, week_end_date)에만 "오늘" 항목으로 잡힌다 — 연속학습 보너스와 같은 방식.
  const todayOtherScores = {
    attendance: { count: todayAttendanceCount, points: todayAttendanceCount * POINTS_PER_EVENT },
    ad: { count: todayAdCount, points: todayAdCount * POINTS_PER_EVENT },
    referral: { count: todayReferralCount, points: todayReferralCount * POINTS_PER_EVENT },
    streakBonus: { count: todayStreakBonusCount, points: todayStreakBonusCount * STREAK_BONUS_POINTS },
    weeklyAward: { count: n('today_weekly_award_count'), points: n('today_weekly_award_points') },
    migration: { count: n('today_migration_count'), points: n('today_migration_points') },
  };
  const todayTotalPoints = Object.values(todayTopicScores).reduce((sum, t) => sum + t.points, 0)
    + Object.values(todayOtherScores).reduce((sum, o) => sum + o.points, 0);

  return {
    totalCorrect, streak, points, streakBonusDays: STREAK_BONUS_DAYS, daysToNextStreakBonus,
    referralCount: n('ref_as_referrer'), todayTopicScores, todayOtherScores, todayTotalPoints,
    daysToNextWeeklyAward: daysUntilNextWeeklyAwardKST(),
  };
}

// ---- 문제 하나 뽑기: 안 쓴 문제 우선, 풀이 바닥나면 그때만 즉석 생성(자가치유) ----
async function pickQuestionForUser(topicId, difficulty, userKey) {
  // "이 사용자가 아직 안 푼 문제"는 DB 함수 unused_questions가 직접 고른다(supabase/aggregates.sql).
  // 예전에는 푼 문제 ID를 전부 가져와(최대 1,000행 제한) not in 목록으로 다시 보냈기 때문에, 푼 문제가
  // 1,000개를 넘으면 목록이 잘려 같은 문제가 다시 나올 수 있었다(§13 원칙 7, 2026-10-04 수정).
  async function query(withDifficulty) {
    const { data, error } = await supabase.rpc('unused_questions', {
      p_user_key: userKey, p_topic: topicId, p_difficulty: withDifficulty ? difficulty : null, p_limit: 30,
    });
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

// 닉네임 등록/변경 (최초 접속 시 1회 입력, 이후에도 초대 링크로 재접속하면 호출됨)
// ref: 초대 링크(?ref=)로 들어온 경우의 초대자 user_key.
// - profiles.referred_by("친구" 배지 표시용)는 유효한 ref가 올 때마다 최신 값으로 갱신한다(이미 가입한
//   사용자여도 나중에 다른 사람의 초대 링크로 들어오면 그 사람의 "친구"로 갱신됨). 이번 접속에 ref가 없으면
//   기존 값을 그대로 유지한다. 유저 간 경쟁(랭킹의 "친구" 배지)을 위한 의도적 정책(사용자 확인, 2026-09-27,
//   requirements.md §3.7 참고) — "누가 나를 처음 초대했는가"가 아니라 "가장 최근에 누구의 초대를 받았는가"를 보여준다.
// - referrals(포인트 적립용)는 이전부터 유효한 ref가 올 때마다 매번 기록한다 — 어뷰징 방지 장치를
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
    const referredBy = (ref && ref !== userKey) ? ref : (existing ? existing.referred_by : null);

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

// ---- 주간 우등생 시상 ----
// 일요일 0시~토요일 23:59:59(KST) 구간의 점수를 /api/ranking과 동일한 산식(연속학습 보너스 포함)으로
// 계산해 상위 3명을 정한다. weekly_awards 자체(과거 시상분)는 이 구간 계산에 포함하지 않는다 —
// "그 주 동안 실제로 쌓은 활동 점수"만으로 순위를 매기기 위함(시상은 활동의 결과이지, 활동 자체가 아님).
// 점수 합산은 DB 함수 leaderboard가 한다(supabase/aggregates.sql) — 기록이 1,000행을 넘어도 정확하다.
async function computeWeeklyLeaderboard(sunday, saturday) {
  const { data, error } = await supabase.rpc('leaderboard', {
    p_from: sunday, p_to: saturday, p_include_awards: false, p_limit: 3,
  });
  if (error) throw error;
  return data.map(r => ({ userKey: r.user_key, score: Number(r.score) }));
}

// 정확히 토요일 23:59:59에 실행되기를 보장할 수 없으므로(서버 재시작 등), 1분마다 "아직 지급 안 된,
// 이미 끝난 주"가 있는지 확인해 뒤늦게라도 정확히 한 번만 지급한다. weekly_awards의
// (week_end_date, rank) 조합이 사실상의 잠금 역할을 한다.
async function awardWeeklyTop3IfDue() {
  const saturday = lastCompletedSaturdayKST();
  const { sunday } = weekRangeKST(saturday);
  const { data: existing, error: existErr } = await supabase
    .from('weekly_awards').select('id').eq('week_end_date', saturday).limit(1);
  if (existErr) {
    console.warn('주간 시상 확인 실패(테이블 미생성 가능):', existErr.message);
    return;
  }
  if (existing.length) return; // 이미 지급됨

  const leaderboard = await computeWeeklyLeaderboard(sunday, saturday);
  const top3 = leaderboard.slice(0, 3).filter(r => r.score > 0);
  if (!top3.length) return; // 그 주에 아무도 활동하지 않았으면 지급하지 않는다

  const rows = top3.map((r, i) => ({ user_key: r.userKey, week_end_date: saturday, rank: i + 1, points: WEEKLY_AWARD_POINTS[i] }));
  const { error: insErr } = await supabase.from('weekly_awards').insert(rows);
  if (insErr && insErr.code !== '23505') {
    console.error('주간 시상 지급 실패:', insErr);
    return;
  }
  console.log(`주간 우등생 시상 지급 완료 (${sunday}~${saturday}):`, rows);
}

setInterval(() => {
  awardWeeklyTop3IfDue().catch(e => console.error('weekly award check error', e));
}, 60 * 1000);

// 가장 최근에 시상한 주의 1~3등(프로모션 화면 "시상" 섹션). 아직 한 번도 시상하지 않았으면 weekEnd가 null.
app.get('/api/awards', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    const { data: latest, error: latestErr } = await supabase
      .from('weekly_awards').select('week_end_date').order('week_end_date', { ascending: false }).limit(1);
    if (latestErr) throw latestErr;
    if (!latest.length) return res.json({ weekStart: null, weekEnd: null, winners: [] });

    const weekEnd = latest[0].week_end_date;
    const { data: awards, error: awardsErr } = await supabase
      .from('weekly_awards').select('user_key, rank, points').eq('week_end_date', weekEnd).order('rank');
    if (awardsErr) throw awardsErr;
    const { data: profiles, error: profErr } = await supabase
      .from('profiles').select('user_key, nickname').in('user_key', awards.map(a => a.user_key));
    if (profErr) throw profErr;
    const nicknameMap = Object.fromEntries(profiles.map(p => [p.user_key, p.nickname]));

    res.json({
      weekStart: weekRangeKST(weekEnd).sunday,
      weekEnd,
      winners: awards.map(a => ({
        rank: a.rank,
        points: a.points,
        me: a.user_key === userKey,
        label: nicknameMap[a.user_key] || `사용자-${a.user_key.slice(-4)}`,
      })),
    });
  } catch (err) {
    console.error('awards failed:', err);
    res.status(502).json({ error: 'awards_failed' });
  }
});

// 랭킹 (일간/주간/전체 실제 집계, 닉네임 표시)
app.get('/api/ranking', async (req, res) => {
  const period = ['weekly', 'all'].includes(req.query.period) ? req.query.period : 'daily';
  const userKey = String(req.query.userKey || 'guest');
  try {
    const today = todayKST();
    // "주간"은 최근 7일 롤링이 아니라 주간 우등생 시상(§3.6.1)과 동일한 달력 기준 일~토(KST) 구간을
    // 쓴다 — 랭킹 화면에서 보는 주간 순위가 실제 시상 대상 주간과 일치해야 하므로(2026-09-27 통일).
    let fromDate = today;
    let toDate = today;
    if (period === 'weekly') {
      const range = weekRangeKST(today);
      fromDate = range.sunday;
      toDate = range.saturday;
    }
    // 점수 합산(출석/광고/정답·오답/친구 초대/받은 주간 시상/연속학습 보너스)은 DB 함수 leaderboard가
    // 상위 20명만 계산해 돌려준다(supabase/aggregates.sql). 예전처럼 기록을 통째로 가져와 더하면 Supabase의
    // 1회 조회 최대 1,000행 제한 때문에 기록이 쌓이면 점수가 조용히 덜 계산됐다(2026-10-04 수정).
    // 전체(누적) 랭킹은 기간 제한 없이(null) 처음부터 지금까지를 합산한다.
    const { data: board, error } = await supabase.rpc('leaderboard', {
      p_from: period === 'all' ? null : fromDate,
      p_to: period === 'all' ? null : toDate,
      p_include_awards: true,
      p_limit: 20,
    });
    if (error) throw error;
    const scores = {};
    for (const r of board) scores[r.user_key] = Number(r.score);
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
      // 프로필(닉네임)이 없는 user_key는 공개 랭킹에 안 보여준다 — 정상 흐름에서는 닉네임 등록이
      // 활동(퀴즈/출석/포인트 적립)보다 항상 먼저라 있을 수 없는 조합이고, 실제로는 테스트/검증용으로
      // 직접 끼워넣은 데이터(예: migration_credits에 수동으로 넣은 검증용 행)가 섞여 보이는 걸 막는
      // 용도다(2026-10-05, 실제로 테스트 유저가 공개 랭킹 2등으로 노출된 사례 발견).
      .filter(key => nicknameMap[key])
      .map(key => ({
        userKey: key,
        me: key === userKey,
        // 실명 식별 없이, "내가 초대한 사람"인지 여부만 배지로 알려준다.
        friend: referredByMap[key] === userKey,
        label: nicknameMap[key],
        score: scores[key],
      }))
      .sort((a, b) => b.score - a.score);

    res.json({ rows });
  } catch (err) {
    console.error('ranking failed:', err);
    res.status(502).json({ error: 'ranking_failed' });
  }
});

// ---- CashQuiz 포인트 이관 수신(§3.X) ----
// 사용자가 CashQuiz에서 발급받은 코드를 입력하면, 이 서버가 CashQuiz의 /api/migration/redeem을
// 서버-서버로 호출해 검증받고 포인트를 적립한다. 양쪽 Render에 같은 MIGRATION_SHARED_SECRET이
// 설정되어 있어야 한다.
app.post('/api/migration/import', async (req, res) => {
  if (!MIGRATION_SHARED_SECRET) {
    console.error('MIGRATION_SHARED_SECRET 환경변수가 설정되지 않았습니다.');
    res.status(500).json({ error: 'migration_not_configured' });
    return;
  }
  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'invalid_code' });
    return;
  }
  try {
    // 같은 코드를 이 서버에 두 번 보내도 source_code unique 제약으로 중복 적립은 막히지만,
    // CashQuiz 쪽을 매번 다시 호출하지 않도록 여기서도 먼저 확인한다.
    const { data: already, error: checkErr } = await supabase
      .from('migration_credits').select('points').eq('source_code', code).maybeSingle();
    if (checkErr) throw checkErr;
    if (already) { res.status(409).json({ error: 'already_imported' }); return; }

    const redeemRes = await fetch(`${CASHQUIZ_API_BASE}/api/migration/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-migration-secret': MIGRATION_SHARED_SECRET },
      body: JSON.stringify({ code, targetUserKey: userKey }),
    });
    if (!redeemRes.ok) {
      const errBody = await redeemRes.json().catch(() => ({}));
      const map = { 404: 'code_not_found', 409: 'already_redeemed', 410: 'expired', 403: 'invalid_secret' };
      res.status(redeemRes.status === 403 ? 502 : redeemRes.status)
        .json({ error: map[redeemRes.status] || errBody.error || 'redeem_failed' });
      return;
    }
    const { points, sourceUserKey } = await redeemRes.json();

    const { error: insErr } = await supabase
      .from('migration_credits')
      .insert({ user_key: userKey, points, source: 'cashquiz', source_code: code, claimed_date: todayKST() });
    if (insErr) {
      // source_code unique 위반(23505) = 동시에 두 번 호출된 race. CashQuiz 쪽은 이미 redeemed로
      // 바뀌었으니 포인트 자체는 안전하지만, 이 insert가 실패하면 적립이 반영되지 않으므로 그대로 알린다.
      console.error('migration_credits insert failed:', insErr);
      res.status(502).json({ error: 'credit_insert_failed' });
      return;
    }

    res.json({ points, sourceUserKey });
  } catch (err) {
    console.error('migration import failed:', err);
    res.status(502).json({ error: 'migration_import_failed' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`quiz question API listening on http://localhost:${port}`);
  ensurePoolTopUp().catch(e => console.error('startup topup error', e));
  // 재시작 사이에 토요일 23:59:59를 놓쳤을 수 있으므로 시작 시에도 한 번 확인한다.
  awardWeeklyTop3IfDue().catch(e => console.error('weekly award startup check error', e));
});
