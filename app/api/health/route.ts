import { NextResponse } from 'next/server';
import { DEFAULT_ELEVENLABS_MODEL_ID, ELEVENLABS_MODEL_OPTIONS, isElevenLabsModelId } from '../../elevenlabs-models';

export const runtime = 'nodejs';

const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export async function GET() {
  const envTtsModel = process.env.ELEVENLABS_MODEL_ID || '';
  const ttsModel = isElevenLabsModelId(envTtsModel) ? envTtsModel : DEFAULT_ELEVENLABS_MODEL_ID;

  return NextResponse.json({
    ok: true,
    app: 'gpt-stt',
    chatProvider: process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai',
    codexModel: process.env.HERMES_CODEX_MODEL || null,
    sttModel: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
    ttsModel,
    ttsModels: ELEVENLABS_MODEL_OPTIONS,
    ttsProvider: 'elevenlabs',
    ttsVoice: process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID,
    serverTts: process.env.ENABLE_SERVER_TTS !== 'false',
  });
}
