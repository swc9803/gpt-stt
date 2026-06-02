import { NextResponse } from 'next/server';
import { createHermesCodexAnswer } from '../hermes-codex';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

type ChatRequest = { message?: string };

type ChatProvider = 'openai' | 'hermes-codex';

function getChatProvider(): ChatProvider {
  const provider = (process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai').toLowerCase();
  if (provider === 'hermes-codex' || provider === 'codex') return 'hermes-codex';
  return 'openai';
}

async function createOpenAIAnswer(message: string) {
  const openai = getOpenAI();
  const response = await openai.responses.create({
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    instructions: [
      '너는 gpt-stt라는 이름의 한국어 음성비서다.',
      '항상 정중한 존댓말로 답한다.',
      '답변은 아주 쉽고 짧게 한다.',
      '가능하면 1~3문장으로 말한다.',
      '어려운 단어를 피하고, 단계가 필요하면 번호를 붙인다.',
      '의료, 금융, 법률처럼 중요한 결정은 가족이나 전문가에게 확인하라고 말한다.',
    ].join('\n'),
    input: message,
    max_output_tokens: 350,
  });

  return response.output_text.trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const message = String(body.message || '').trim();
    if (!message) {
      return NextResponse.json({ error: '질문이 비어 있습니다.' }, { status: 400 });
    }

    const answer = getChatProvider() === 'hermes-codex'
      ? await createHermesCodexAnswer(message)
      : await createOpenAIAnswer(message);

    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : '답변 생성 서버 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
