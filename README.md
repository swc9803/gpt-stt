# todo

목소리 모델 추가
ui 개선
css to scss 계층형태
word break

## Server TTS

TTS는 ElevenLabs만 사용합니다.

```bash
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

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
