import { NextResponse } from 'next/server';
import { createHermesCodexAnswer } from '../hermes-codex';
import { formatOpenAIError } from '../openai-errors';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

type ChatContextItem = { question?: string; answer?: string };
type ChatRequest = { message?: string; history?: ChatContextItem[] };

type ChatProvider = 'openai' | 'hermes-codex';

function getChatProvider(): ChatProvider {
  const provider = (process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai').toLowerCase();
  if (provider === 'hermes-codex' || provider === 'codex') return 'hermes-codex';
  return 'openai';
}

function buildMessageWithHistory(message: string, history: ChatContextItem[]) {
  const recent = history
    .slice(0, 6)
    .reverse()
    .map((item, index) => {
      const question = String(item.question || '').trim();
      const answer = String(item.answer || '').trim();
      if (!question && !answer) return '';
      return [`[${index + 1}] 사용자: ${question}`, `답변: ${answer}`].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  if (!recent) return message;
  return ['최근 대화:', recent, '', `현재 질문: ${message}`].join('\n');
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
      '질문이 애매해서 확실한 답을 하면 틀릴 수 있을 때는 추측하지 말고, 애매한 부분만 짧게 다시 질문한다.',
      '명확한 부분은 반복해서 묻지 말고, 부족한 정보 1가지만 물어본다.',
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
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) {
      return NextResponse.json({ error: '질문이 비어 있습니다.' }, { status: 400 });
    }

    const messageWithHistory = buildMessageWithHistory(message, history);
    const answer = getChatProvider() === 'hermes-codex'
      ? await createHermesCodexAnswer(messageWithHistory)
      : await createOpenAIAnswer(messageWithHistory);

    return NextResponse.json({ answer });
  } catch (err) {
    const { error, status } = formatOpenAIError(err, '답변 생성', '답변 생성 서버 오류가 발생했습니다.');
    return NextResponse.json({ error }, { status });
  }
}
