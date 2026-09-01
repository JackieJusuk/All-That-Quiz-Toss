import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const app = express();
const client = new Anthropic();

// 로그인(앱 진입)마다 다른 문제가 나오도록, 퀴즈 시작 시 서버가 매번 새 문항을 생성한다.
const TOPIC_BRIEFS = {
  stock: '주식 투자 기초 (PER, 배당, 분산투자, 코스피, 시가총액 등 개념)',
  realestate: '부동산 투자 기초 (전월세, LTV, 청약, 등기부등본, 재건축/재개발 등 개념)',
  fund: '펀드 투자 기초 (ETF, 운용보수, 기준가, 액티브/패시브 펀드 등 개념)',
};

const QuizSetSchema = z.object({
  questions: z
    .array(
      z.object({
        q: z.string().describe('4지선다 퀴즈 질문'),
        choices: z.array(z.string()).length(4).describe('보기 4개'),
        correct: z.number().int().min(0).max(3).describe('정답 보기의 인덱스(0~3)'),
        explain: z.string().describe('정답 해설, 존댓말 1~2문장'),
        difficulty: z.enum(['easy', 'medium', 'hard']),
      }),
    )
    .length(5),
});

app.get('/api/questions', async (req, res) => {
  const topicId = String(req.query.topic || '');
  const brief = TOPIC_BRIEFS[topicId];
  if (!brief) {
    res.status(400).json({ error: 'invalid_topic' });
    return;
  }

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(QuizSetSchema) },
      system:
        '당신은 투자 입문자를 위한 경제/투자 퀴즈를 만드는 콘텐츠 작가입니다. 사실관계가 정확하고 검증 가능한 내용만 사용하며, 오해를 유발할 수 있는 문제나 선택지는 만들지 않습니다.',
      messages: [
        {
          role: 'user',
          content: `주제: ${brief}\n\n이 주제로 한국어 4지선다 퀴즈 문제 5개를 새로 만들어주세요. 매번 다른 세부 소재와 문구를 사용해서 이전 출제와 겹치지 않게 하세요. 난이도는 easy 2개, medium 2개, hard 1개로 섞고, 정답 해설은 존댓말 1~2문장으로 작성하세요.`,
        },
      ],
    });

    if (!response.parsed_output) throw new Error('no parsed_output');
    res.json(response.parsed_output);
  } catch (err) {
    console.error('question generation failed:', err);
    res.status(502).json({ error: 'generation_failed' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`quiz question API listening on http://localhost:${port}`);
});
