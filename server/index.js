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
  correct: z.number().int().min(0).describe('정답 보기의 인덱스(0부터 시작)'),
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

async function generateQuizSet(topicId, count, difficulty, avoidQuestions) {
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
          '당신은 투자 입문자를 위한 경제/투자 퀴즈를 만드는 콘텐츠 작가입니다. 사실관계가 정확하고 검증 가능한 내용만 사용하며, 오해를 유발할 수 있는 문제나 선택지는 만들지 않습니다. 요청받은 문제 개수와 선택지 개수를 반드시 정확히 지킵니다.',
        messages: [{ role: 'user', content: userPrompt }],
      });
      if (response.parsed_output) {
        const normalized = normalizeQuizSet(response.parsed_output, count);
        if (normalized) return normalized;
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
const POOL_TARGET_PER_TOPIC = 34; // 3개 주제 * 34 ≈ 100문제
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
        const need = Math.min(5, POOL_TARGET_PER_TOPIC - current); // 한 번에 최대 5개씩만 채운다
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

async function computeUserStats(userKey) {
  const { data, error } = await supabase
    .from('used_questions')
    .select('answered_date, correct')
    .eq('user_key', userKey);
  if (error) throw error;
  const totalCorrect = data.filter(r => r.correct).length;
  const datesDesc = [...new Set(data.map(r => r.answered_date))].sort().reverse();
  const streak = computeStreak(datesDesc, todayKST());
  return { totalCorrect, streak, cash: totalCorrect * 20 };
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

  const generated = await generateQuizSet(topicId, 1, difficulty);
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

// 오늘 이미 풀었는지 + 현재 통계
app.get('/api/status', async (req, res) => {
  const userKey = String(req.query.userKey || 'guest');
  try {
    const today = todayKST();
    const { data: todayRows, error } = await supabase
      .from('used_questions')
      .select('question_id')
      .eq('user_key', userKey)
      .eq('answered_date', today);
    if (error) throw error;
    const stats = await computeUserStats(userKey);
    res.json({ answeredToday: todayRows.length > 0, ...stats });
  } catch (err) {
    console.error('status failed:', err);
    res.status(502).json({ error: 'status_failed' });
  }
});

// 오늘의 문제 하나 받기 (하루 1문제 제한)
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
    const today = todayKST();
    const { data: todayRows, error: checkErr } = await supabase
      .from('used_questions')
      .select('question_id')
      .eq('user_key', userKey)
      .eq('answered_date', today);
    if (checkErr) throw checkErr;
    if (todayRows.length > 0) {
      res.status(403).json({ error: 'daily_limit_reached' });
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

// 답변 기록 (오늘의 1문제 소비)
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
    const today = todayKST();
    const { data: todayRows, error: checkErr } = await supabase
      .from('used_questions')
      .select('question_id')
      .eq('user_key', userKey)
      .eq('answered_date', today);
    if (checkErr) throw checkErr;
    if (todayRows.length > 0) {
      res.status(403).json({ error: 'daily_limit_reached' });
      return;
    }

    const { error: insErr } = await supabase.from('used_questions').insert({
      user_key: userKey, question_id: questionId, topic: topicId, correct, answered_date: today,
    });
    if (insErr) throw insErr;

    const stats = await computeUserStats(userKey);
    res.json(stats);
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
app.post('/api/profile', async (req, res) => {
  const body = req.body || {};
  const userKey = String(body.userKey || 'guest');
  const nickname = String(body.nickname || '').trim().slice(0, 12);
  if (!nickname) {
    res.status(400).json({ error: 'invalid_nickname' });
    return;
  }
  try {
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_key: userKey, nickname }, { onConflict: 'user_key' });
    if (error) throw error;
    res.json({ nickname });
  } catch (err) {
    console.error('profile save failed:', err);
    res.status(502).json({ error: 'profile_save_failed' });
  }
});

// 랭킹 (일간/주간 실제 집계, 닉네임 표시)
app.get('/api/ranking', async (req, res) => {
  const period = req.query.period === 'weekly' ? 'weekly' : 'daily';
  const userKey = String(req.query.userKey || 'guest');
  try {
    const today = todayKST();
    let fromDate = today;
    if (period === 'weekly') {
      fromDate = new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    const { data, error } = await supabase
      .from('used_questions')
      .select('user_key, correct')
      .gte('answered_date', fromDate);
    if (error) throw error;

    const scores = {};
    for (const row of data) {
      if (!row.correct) continue;
      scores[row.user_key] = (scores[row.user_key] || 0) + 1;
    }
    const keys = Object.keys(scores);
    const nicknameMap = {};
    if (keys.length) {
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('user_key, nickname')
        .in('user_key', keys);
      if (profErr) throw profErr;
      for (const p of profiles) nicknameMap[p.user_key] = p.nickname;
    }

    const rows = keys
      .map(key => ({
        userKey: key,
        me: key === userKey,
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
