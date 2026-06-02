import { NextResponse } from 'next/server';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

type ChatRequest = { message?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const message = String(body.message || '').trim();
    if (!message) {
      return NextResponse.json({ error: '질문이 비어 있어.' }, { status: 400 });
    }

    const openai = getOpenAI();
    const response = await openai.responses.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      instructions: [
        '너는 한국어로 답하는 부모님용 음성비서다.',
        '답변은 아주 쉽고 짧게 한다.',
        '가능하면 1~3문장으로 말한다.',
        '어려운 단어를 피하고, 단계가 필요하면 번호를 붙인다.',
        '의료, 금융, 법률처럼 중요한 결정은 가족이나 전문가에게 확인하라고 말한다.',
      ].join('\n'),
      input: message,
      max_output_tokens: 350,
    });

    return NextResponse.json({ answer: response.output_text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : '답변 생성 서버 오류가 났어.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
