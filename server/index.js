import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const app = express();
// 토스 미니앱 웹뷰(별도 오리진)에서 호출하는 공개 읽기 전용 API라 모든 오리진을 허용한다.
app.use(cors());
app.use(express.json());
// ID 연동(identity-linked) API 키는 요청마다 어느 워크스페이스에서 실행할지
// anthropic-workspace-id 헤더로 명시해야 한다 (Console > 조직 설정 > 워크스페이스에서 확인).
const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

// 로그인(앱 진입)마다, 그리고 "문제 더 풀기" 요청마다 다른 문제가 나오도록
// 퀴즈 화면은 기본 1문제만 생성해서 보여주고, 이어서 요청이 올 때마다 1문제씩 추가로 생성한다.
const TOPIC_LABELS = {
  stock: '주식 투자',
  realestate: '부동산 투자',
  fund: '펀드 투자',
};

// 개념 하나로만 프롬프트를 고정하면 AI가 매번 같은 대표 문제로 수렴하는 경향이 있어,
// 세부 개념 목록을 넉넉히 두고 요청마다 그중 일부만 무작위로 골라 제시한다.
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

// Sonnet은 이따금 문제/선택지를 요청보다 1개 더 만들어 정확한 길이 스키마를 어길 때가 있다.
// 검증은 느슨하게(최소 개수) 받고, 서버에서 초과분을 안전하게 다듬는다.
function buildSchema(count) {
  return z.object({ questions: z.array(questionSchema).min(count) });
}

// 초과 생성분을 정리한다. 정답이 잘려나가는 위치라 안전하게 다듬을 수 없으면 null을 반환해 재시도를 유도한다.
function normalizeQuizSet(raw, count) {
  const questions = raw.questions.slice(0, count).map(q => {
    if (q.choices.length < 4 || q.correct > q.choices.length - 1) return null;
    if (q.correct > 3) return null; // 정답이 잘려나가는 위치면 다듬지 않고 실패 처리
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

  // 형식이 끝내 정리되지 않는 경우를 대비해 최대 3회 재시도한다.
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

app.post('/api/questions', async (req, res) => {
  const body = req.body || {};
  const topicId = String(body.topic || '');
  if (!TOPIC_LABELS[topicId]) {
    res.status(400).json({ error: 'invalid_topic' });
    return;
  }
  const count = Math.min(5, Math.max(1, parseInt(body.count, 10) || 1));
  const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
  // 프롬프트가 지나치게 길어지지 않도록 최근 문제 20개까지만 반영한다.
  const avoidQuestions = Array.isArray(body.avoidQuestions)
    ? body.avoidQuestions.filter(q => typeof q === 'string').slice(-20)
    : [];

  try {
    const questions = await generateQuizSet(topicId, count, difficulty, avoidQuestions);
    res.json(questions);
  } catch (err) {
    console.error('question generation failed:', err);
    res.status(502).json({ error: 'generation_failed' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`quiz question API listening on http://localhost:${port}`);
});
