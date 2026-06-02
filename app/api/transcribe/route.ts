import { NextResponse } from 'next/server';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'audio 파일이 없어.' }, { status: 400 });
    }
    if (audio.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: '음성 파일이 너무 커. 짧게 말해줘.' }, { status: 413 });
    }

    const openai = getOpenAI();
    const result = await openai.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      language: 'ko',
    });

    return NextResponse.json({ text: result.text || '' });
  } catch (err) {
    const message = err instanceof Error ? err.message : '음성 인식 서버 오류가 났어.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
