import { NextResponse } from 'next/server';
import { DEFAULT_ELEVENLABS_MODEL_ID, isElevenLabsModelId } from '../../elevenlabs-models';

export const runtime = 'nodejs';

const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

type SpeechRequest = { text?: string; modelId?: string };

function getNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true';
}

function getErrorStatus(err: unknown) {
  if (typeof err === 'object' && err && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function getElevenLabsError(err: unknown) {
  const status = getErrorStatus(err);
  const message = err instanceof Error ? err.message : '';

  if (message.includes('ELEVENLABS_API_KEY')) {
    return {
      error: 'ELEVENLABS_API_KEY가 서버에 설정되어 있지 않습니다.',
      status: 500,
    };
  }

  if (message.includes('ELEVENLABS_VOICE_ID')) {
    return {
      error: 'ELEVENLABS_VOICE_ID가 서버에 설정되어 있지 않습니다.',
      status: 500,
    };
  }

  if (status === 401) {
    return {
      error: 'ElevenLabs API 키가 유효하지 않습니다. 서버 환경변수 ELEVENLABS_API_KEY를 확인해 주세요.',
      status,
    };
  }

  if (status === 429) {
    return {
      error: 'ElevenLabs 사용량 한도 또는 결제 한도를 확인해 주세요.',
      status,
    };
  }

  return {
    error: message || '음성 생성 서버 오류가 발생했습니다.',
    status: status && status >= 400 ? status : 500,
  };
}

async function createElevenLabsSpeech(text: string, modelId: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured.');

  if (modelId && !isElevenLabsModelId(modelId)) {
    const error = new Error('지원하지 않는 ElevenLabs 모델입니다.');
    (error as Error & { status: number }).status = 400;
    throw error;
  }

  const requestedModelId = modelId || process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL_ID;
  const safeModelId = isElevenLabsModelId(requestedModelId)
    ? requestedModelId
    : DEFAULT_ELEVENLABS_MODEL_ID;
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set('output_format', outputFormat);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text.slice(0, 1200),
      model_id: safeModelId,
      language_code: process.env.ELEVENLABS_LANGUAGE_CODE || 'ko',
      voice_settings: {
        stability: getNumberEnv('ELEVENLABS_STABILITY', 0.42),
        similarity_boost: getNumberEnv('ELEVENLABS_SIMILARITY_BOOST', 0.82),
        style: getNumberEnv('ELEVENLABS_STYLE', 0.18),
        speed: getNumberEnv('ELEVENLABS_SPEED', 0.94),
        use_speaker_boost: getBooleanEnv('ELEVENLABS_SPEAKER_BOOST', true),
      },
      apply_text_normalization: 'auto',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail = typeof errorBody?.detail === 'string'
      ? errorBody.detail
      : errorBody?.detail?.message || errorBody?.message;
    const error = new Error(detail || `ElevenLabs 음성 생성에 실패했습니다. (${response.status})`);
    (error as Error & { status: number }).status = response.status;
    throw error;
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_SERVER_TTS === 'false') {
      return NextResponse.json({ error: 'ElevenLabs TTS가 꺼져 있습니다.' }, { status: 503 });
    }

    const body = (await request.json()) as SpeechRequest;
    const text = String(body.text || '').trim();
    const modelId = String(body.modelId || '').trim();
    if (!text) {
      return NextResponse.json({ error: '읽을 답변이 비어 있습니다.' }, { status: 400 });
    }

    const audio = await createElevenLabsSpeech(text, modelId);
    return new NextResponse(audio, {
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const { error, status } = getElevenLabsError(err);
    return NextResponse.json({ error }, { status });
  }
}
