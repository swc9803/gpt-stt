# gpt-stt

한국어 음성 질문/답변 PWA입니다. Vercel에 배포하거나, 개발 중에는 이 컴퓨터에서 Next.js 프로세스로 실행할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

기본 주소:

```text
http://localhost:3010
```

`npm run dev`는 `0.0.0.0:3010`으로 열리므로 같은 Wi-Fi의 다른 기기에서도 접속할 수 있습니다.

서버를 끄려면 `npm run dev`를 실행한 터미널에서 `Ctrl+C`를 누르면 됩니다.

## Vercel 배포

Next.js API route가 필요하므로 정적 호스팅이 아니라 Next.js 서버 함수를 지원하는 Vercel로 배포합니다.

처음 한 번 Vercel 계정에 로그인한 뒤 프로젝트를 연결합니다.

```bash
npx vercel
```

Vercel 프로젝트 환경변수에 아래 값을 등록합니다.

```text
CHAT_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-4.1-mini
NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK=true
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_v3
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

이후 배포:

```bash
npm run deploy
```

주의:

- Vercel 배포에서는 `CHAT_PROVIDER=openai`를 사용합니다. `hermes-codex`는 이 컴퓨터의 Hermes CLI 인증에 의존하므로 로컬 실행 전용입니다.
- 호스팅은 Vercel Hobby 무료 한도 안에서 쓸 수 있지만, OpenAI와 ElevenLabs API 사용료는 각 서비스에서 별도로 발생할 수 있습니다.
- 공개 URL은 `npm run deploy` 완료 후 Vercel CLI 출력에서 확인합니다.

## macOS 백그라운드 자동 시작

회사 Mac에서 로그인할 때 로컬 서버를 백그라운드로 자동 시작하려면 한 번만 등록합니다.

```bash
npm run startup:install
```

등록되는 LaunchAgent 이름은 `com.user.gpt-stt-local-server`입니다. 이후 Mac에 로그인하면 Terminal 창 없이 `npm run dev`가 백그라운드에서 실행되고 `http://localhost:3010`으로 열립니다.

로그:

```text
.local-server/launchd.out.log
.local-server/launchd.err.log
```

자동 시작을 끄려면:

```bash
npm run startup:remove
```

집 Windows에서는 자동 시작을 등록하지 않습니다. 예전에 Windows 작업 스케줄러에 등록해 둔 작업이 있으면 Windows에서 아래 명령으로 한 번 지웁니다.

```powershell
npm run startup:remove:win
```

## Hermes/Codex 채팅

채팅 답변은 로컬 서버가 `hermes` CLI를 실행해서 Codex로 보낼 수 있습니다. 이 방식은 Google Cloud secret이나 Cloud Run이 필요 없고, 이 컴퓨터의 Hermes 인증을 그대로 사용합니다.

처음 한 번:

```bash
hermes auth add openai-codex
```

`.env.local`:

```bash
CHAT_PROVIDER=hermes-codex
HERMES_CODEX_MODEL=gpt-5.5
# 필요할 때만 지정
# HERMES_BIN=hermes
# HERMES_CODEX_TIMEOUT_MS=90000
# HERMES_CODEX_MAX_TURNS=3
```

이 모드는 `/api/chat`에만 적용됩니다. 음성 전사 fallback은 여전히 OpenAI API key를 사용합니다.

## Speech To Text

iPhone/iPad에서는 브라우저 내장 음성 인식이 권한 허용 후에도 실패할 수 있어, 서버 전사 fallback을 켜는 것을 권장합니다.

```bash
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK=true
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
```

OpenAI STT 크레딧이 없으면 `NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK`을 끄거나 제거합니다.

## Server TTS

TTS는 ElevenLabs를 사용합니다.

```bash
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_v3
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

목소리 옵션:

- `EXAVITQu4vr4xnSDxMaL`: Sarah
- `iP95p4xoKVk53GoZ742B`: Chris

`ENABLE_SERVER_TTS=false`를 설정하면 ElevenLabs 음성 재생이 꺼집니다. 기본값은 켜짐입니다.

## 참고

- 이 repo의 Google Cloud Run/Firebase Hosting 배포 설정은 제거했습니다.
- 휴대폰에서 마이크/PWA가 브라우저 정책 때문에 막히면 HTTPS가 필요할 수 있습니다. 그 경우에도 앱 서버는 이 컴퓨터에서 계속 열어두고, 별도 터널 도구만 `http://localhost:3010`으로 연결하면 됩니다.
