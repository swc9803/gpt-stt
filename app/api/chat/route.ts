import { NextResponse } from 'next/server';
import { createHermesCodexAnswer } from '../hermes-codex';
import { formatOpenAIError } from '../openai-errors';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

type ChatContextItem = { question?: string; answer?: string };
type ChatRequest = { message?: string; history?: ChatContextItem[]; stream?: boolean };

type ChatProvider = 'openai' | 'hermes-codex';
type ChatStreamEvent =
  | { type: 'delta'; delta: string }
  | { type: 'done'; answer: string }
  | { type: 'error'; error: string };

function getChatProvider(): ChatProvider {
  const provider = (process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai').toLowerCase();
  if (provider === 'hermes-codex' || provider === 'codex') return 'hermes-codex';
  return 'openai';
}

function buildMessageWithHistory(message: string, history: ChatContextItem[]) {
  const recent = history
    .slice(-4)
    .map((item, index) => {
      const question = String(item.question || '').trim();
      const answer = String(item.answer || '').trim();
      if (!question && !answer) return '';
      return [`[${index + 1}] 사용자: ${question}`, `답변: ${answer}`].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  if (!recent) return message;
  return [
    '아래는 현재 질문과 같은 주제의 최근 대화입니다.',
    '짧은 후속 질문이면 최근 대화를 이어서 이해하고, 새 지시가 있으면 현재 질문을 우선합니다.',
    '',
    recent,
    '',
    `현재 질문: ${message}`,
  ].join('\n');
}

function getAnswerInstructions() {
  return [
    '너는 gpt-stt라는 이름의 한국어 음성비서다.',
    '항상 정중한 존댓말로 답한다.',
    '답변은 성인에게 말하듯 자연스럽고 분명하게 한다.',
    '간단한 질문은 짧게 답하고, 설명이 필요한 질문은 적당히 자세하게 답한다.',
    '사용자가 자세히 알려 달라고 하면 이전 답을 반복하지 말고 필요한 재료, 순서, 주의점을 더 구체적으로 알려준다.',
    '최근 대화가 있으면 같은 주제의 후속 질문을 이해하는 데 사용하되, 새 주제는 이전 대화에 억지로 연결하지 않는다.',
    '불필요하게 유치하거나 과하게 쉬운 표현은 피하고, 전문 용어가 필요하면 짧게 풀어 설명한다.',
    '질문이 애매해서 확실한 답을 하면 틀릴 수 있을 때는 추측하지 말고, 애매한 부분만 짧게 다시 질문한다.',
    '명확한 부분은 반복해서 묻지 말고, 부족한 정보 1가지만 물어본다.',
    '의료, 금융, 법률처럼 중요한 결정은 가족이나 전문가에게 확인하라고 말한다.',
    '최신 정보, 가격, 상품, 쇼핑몰, 음식점, 여행지, 볼거리, 영업시간, 위치, 후기, 예약 가능성처럼 바뀔 수 있는 내용은 웹 검색을 사용해서 확인한다.',
    '상품을 찾을 때는 가능하면 여러 판매처나 쇼핑몰을 비교하고, 가격/배송/구매 링크를 함께 준다.',
    '음식점이나 볼거리를 찾을 때는 위치, 특징, 방문 팁, 공식 페이지나 지도/예약 링크를 함께 준다.',
    '링크는 화면에 볼 수 있도록 URL이나 Markdown 링크로 남기되, 답변 문장 자체는 링크를 읽어야 이해되는 식으로 만들지 않는다.',
  ].join('\n');
}

function getOpenAIChatModel() {
  return process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini';
}

async function createOpenAIAnswer(message: string) {
  const openai = getOpenAI();
  const response = await openai.responses.create({
    model: getOpenAIChatModel(),
    instructions: getAnswerInstructions(),
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    input: message,
    max_output_tokens: 450,
  });

  return response.output_text.trim();
}

async function createOpenAIAnswerStream(message: string, onDelta: (delta: string) => void) {
  const openai = getOpenAI();
  const stream = await openai.responses.create({
    model: getOpenAIChatModel(),
    instructions: getAnswerInstructions(),
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    input: message,
    max_output_tokens: 650,
    stream: true,
  });
  let answer = '';

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      const delta = event.delta || '';
      answer += delta;
      onDelta(delta);
    }

    if (event.type === 'error') {
      throw new Error(event.message || '답변 생성 중 오류가 발생했습니다.');
    }
  }

  return answer.trim();
}

function encodeChatStreamEvent(event: ChatStreamEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function createChatStream(message: string) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = '';

      try {
        if (getChatProvider() === 'hermes-codex') {
          answer = await createHermesCodexAnswer(message);
          controller.enqueue(encodeChatStreamEvent({ type: 'delta', delta: answer }));
        } else {
          answer = await createOpenAIAnswerStream(message, (delta) => {
            controller.enqueue(encodeChatStreamEvent({ type: 'delta', delta }));
          });
        }

        controller.enqueue(encodeChatStreamEvent({ type: 'done', answer }));
      } catch (err) {
        const { error } = formatOpenAIError(err, '답변 생성', '답변 생성 서버 오류가 발생했습니다.');
        controller.enqueue(encodeChatStreamEvent({ type: 'error', error }));
      } finally {
        controller.close();
      }
    },
  });
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
    if (body.stream) {
      return new Response(createChatStream(messageWithHistory), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    const answer = getChatProvider() === 'hermes-codex'
      ? await createHermesCodexAnswer(messageWithHistory)
      : await createOpenAIAnswer(messageWithHistory);

    return NextResponse.json({ answer });
  } catch (err) {
    const { error, status } = formatOpenAIError(err, '답변 생성', '답변 생성 서버 오류가 발생했습니다.');
    return NextResponse.json({ error }, { status });
  }
}
