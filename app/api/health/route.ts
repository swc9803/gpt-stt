import { NextResponse } from 'next/server';
import { DEFAULT_ELEVENLABS_MODEL_ID } from '../../elevenlabs-models';
import { DEFAULT_ELEVENLABS_VOICE_ID, ELEVENLABS_VOICE_OPTIONS, isElevenLabsVoiceId } from '../../elevenlabs-voices';

export const runtime = 'nodejs';

export async function GET() {
  const envTtsVoice = process.env.ELEVENLABS_VOICE_ID || '';
  const ttsVoice = isElevenLabsVoiceId(envTtsVoice) ? envTtsVoice : DEFAULT_ELEVENLABS_VOICE_ID;

  return NextResponse.json({
    ok: true,
    app: 'gpt-stt',
    chatProvider: process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai',
    codexModel: process.env.HERMES_CODEX_MODEL || null,
    sttModel: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
    ttsModel: DEFAULT_ELEVENLABS_MODEL_ID,
    ttsProvider: 'elevenlabs',
    ttsVoice,
    ttsVoices: ELEVENLABS_VOICE_OPTIONS,
    serverTts: process.env.ENABLE_SERVER_TTS !== 'false',
  });
}
