# todo

## Speech to Text

iPhone/iPad에서는 브라우저 내장 음성 인식이 권한 허용 후에도 실패할 수 있어, 서버 전사 fallback을 켜는 것을 권장합니다.

```bash
NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK=true
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
```

이 값이 켜져 있으면 iOS 계열 브라우저에서는 `SpeechRecognition` 대신 마이크 녹음 후 `/api/transcribe` 서버 전사를 사용합니다.

## Server TTS

TTS는 ElevenLabs만 사용합니다.

```bash
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_v3
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

목소리는 결제 없이 API에서 성공한 아래 음성만 사용합니다.

- `EXAVITQu4vr4xnSDxMaL`: Sarah
- `iP95p4xoKVk53GoZ742B`: Chris

모델은 속도/품질을 정하고, 남성/여성 같은 목소리 성격은 `ELEVENLABS_VOICE_ID`가 정합니다.

무료 플랜 포함 모델:

- `eleven_flash_v2_5`: 빠른 대화용
- `eleven_turbo_v2_5`: 속도와 품질 균형
- `eleven_multilingual_v2`: 자연스러운 한국어 음성
- `eleven_v3`: 표현력 높은 음성, 기본값

선택 조정값:

```bash
ELEVENLABS_LANGUAGE_CODE=ko
ELEVENLABS_STABILITY=0.42
ELEVENLABS_SIMILARITY_BOOST=0.82
ELEVENLABS_STYLE=0.18
ELEVENLABS_SPEED=0.94
ELEVENLABS_SPEAKER_BOOST=true
```

`ENABLE_SERVER_TTS=false`를 설정하면 ElevenLabs 음성 재생이 꺼집니다. 기본값은 켜짐입니다.
