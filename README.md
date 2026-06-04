# todo

## Server TTS

TTS는 ElevenLabs만 사용합니다.

```bash
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

무료 플랜 포함 모델:

- `eleven_flash_v2_5`: 빠른 대화용 기본값
- `eleven_turbo_v2_5`: 속도와 품질 균형
- `eleven_multilingual_v2`: 자연스러운 한국어 음성
- `eleven_v3`: 표현력 높은 음성

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
