import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: 'gpt-stt',
    chatProvider: process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai',
    codexModel: process.env.HERMES_CODEX_MODEL || null,
    sttModel: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
    ttsModel: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    ttsProvider: 'elevenlabs',
    ttsVoice: process.env.ELEVENLABS_VOICE_ID || null,
    serverTts: process.env.ENABLE_SERVER_TTS !== 'false',
  });
}
