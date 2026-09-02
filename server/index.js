import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const app = express();
// ID 연동(identity-linked) API 키는 요청마다 어느 워크스페이스에서 실행할지
// anthropic-workspace-id 헤더로 명시해야 한다 (Console > 조직 설정 > 워크스페이스에서 확인).
const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

// 로그인(앱 진입)마다, 그리고 "문제 더 풀기" 요청마다 다른 문제가 나오도록
// 퀴즈 화면은 기본 1문제만 생성해서 보여주고, 이어서 요청이 올 때마다 1문제씩 추가로 생성한다.
const TOPIC_BRIEFS = {
  stock: '주식 투자 기초 (PER, 배당, 분산투자, 코스피, 시가총액 등 개념)',
  realestate: '부동산 투자 기초 (전월세, LTV, 청약, 등기부등본, 재건축/재개발 등 개념)',
  fund: '펀드 투자 기초 (ETF, 운용보수, 기준가, 액티브/패시브 펀드 등 개념)',
};

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
function buildSchema(count){
  return z.object({ questions: z.array(questionSchema).min(count) });
}

// 초과 생성분을 정리한다. 정답이 잘려나가는 위치라 안전하게 다듬을 수 없으면 null을 반환해 재시도를 유도한다.
function normalizeQuizSet(raw, count){
  const questions = raw.questions.slice(0, count).map(q => {
    if(q.choices.length < 4 || q.correct > q.choices.length - 1) return null;
    if(q.correct > 3) return null; // 정답이 잘려나가는 위치면 다듬지 않고 실패 처리
    const choices = q.choices.length > 4 ? q.choices.slice(0, 4) : q.choices;
    return { q: q.q, choices, correct: q.correct, explain: q.explain, difficulty: q.difficulty };
  });
  if(questions.length !== count || questions.some(q => q === null)) return null;
  return { questions };
}

async function generateQuizSet(brief, count, difficulty){
  const diffInstruction = count === 1
    ? `난이도는 ${DIFF_KO[difficulty] || DIFF_KO.medium} 수준으로 만들고, difficulty 필드는 "${difficulty || 'medium'}"으로 표기하세요.`
    : '난이도는 easy/medium/hard를 골고루 섞어주세요.';
  const userPrompt = `주제: ${brief}\n\n이 주제로 한국어 4지선다 퀴즈 문제를 정확히 ${count}개 만들어주세요. 각 문제는 선택지를 정확히 4개씩만 가져야 합니다. 매번 다른 세부 소재와 문구를 사용해서 이전 출제와 겹치지 않게 하세요. ${diffInstruction} 정답 해설은 존댓말 1~2문장으로 작성하세요.`;
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

app.get('/api/questions', async (req, res) => {
  const topicId = String(req.query.topic || '');
  const brief = TOPIC_BRIEFS[topicId];
  if (!brief) {
    res.status(400).json({ error: 'invalid_topic' });
    return;
  }
  const count = Math.min(5, Math.max(1, parseInt(req.query.count, 10) || 1));
  const difficulty = ['easy', 'medium', 'hard'].includes(req.query.difficulty)
    ? req.query.difficulty
    : 'medium';

  try {
    const questions = await generateQuizSet(brief, count, difficulty);
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
