import { NextResponse } from 'next/server';
import { formatOpenAIError } from '../openai-errors';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

type SpeechRequest = { text?: string };

export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_SERVER_TTS !== 'true') {
      return NextResponse.json({ error: '서버 TTS가 꺼져 있습니다.' }, { status: 503 });
    }

    const body = (await request.json()) as SpeechRequest;
    const text = String(body.text || '').trim();
    if (!text) {
      return NextResponse.json({ error: '읽을 답변이 비어 있습니다.' }, { status: 400 });
    }

    const openai = getOpenAI();
    const response = await openai.audio.speech.create({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_TTS_VOICE || 'alloy',
      input: text.slice(0, 1200),
      response_format: 'mp3',
      speed: 0.92,
    });

    const audio = Buffer.from(await response.arrayBuffer());
    return new NextResponse(audio, {
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const { error, status } = formatOpenAIError(err, '음성 생성', '음성 생성 서버 오류가 발생했습니다.');
    return NextResponse.json({ error }, { status });
  }
}
