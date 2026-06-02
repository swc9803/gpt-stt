# GPT 음성비서 PWA

gpt-stt는 아이폰/안드로이드에서 쉽게 음성으로 질문하고 답변을 들을 수 있는 PWA다.

## 왜 Next.js인가

이 프로젝트는 React 단독 앱보다 Next.js가 낫다.

- PWA 화면과 서버 API를 한 repo에서 관리할 수 있다.
- OpenAI API key를 브라우저에 노출하지 않고 서버 route에만 둘 수 있다.
- iPhone/Android 모두 URL 접속 후 홈 화면 추가로 설치할 수 있다.
- 나중에 Vercel 같은 곳에 바로 배포하기 쉽다.

React 단독 Vite 앱도 가능하지만, STT/Chat 서버가 따로 필요해서 gpt-stt MVP에는 Next.js가 더 단순하다.

## 기능

- 큰 마이크 버튼으로 녹음 시작/종료
- 서버 STT로 음성 인식
- GPT가 짧고 쉬운 한국어 답변 생성
- 브라우저 내장 TTS로 답변 읽기
- PWA manifest/service worker 포함

## 실행

```bash
npm install
cp .env.example .env.local
# .env.local에 OPENAI_API_KEY 설정
npm run dev
```

기본 포트는 `3010`이다.
브라우저에서 `http://localhost:3010` 접속.

다른 포트로 열고 싶으면:

```bash
PORT=3020 npm run dev
```

## 환경변수

`.env.local` 파일을 만들고 아래처럼 넣는다.

```bash
OPENAI_API_KEY=sk-...
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_CHAT_MODEL=gpt-4o-mini
```

`OPENAI_STT_MODEL`, `OPENAI_CHAT_MODEL`은 생략 가능하다.

채팅 답변을 OpenAI API key 대신 Hermes의 OpenAI Codex OAuth로 호출하려면 서버 환경에서 Hermes 인증을 먼저 끝낸 뒤 아래를 추가한다.

```bash
hermes auth add openai-codex
```

```bash
CHAT_PROVIDER=hermes-codex
HERMES_CODEX_MODEL=gpt-5.5
# 필요할 때만 지정
# HERMES_BIN=hermes
# HERMES_CODEX_TIMEOUT_MS=90000
```

이 모드는 `/api/chat`만 Codex로 보낸다. `/api/transcribe`는 계속 `OPENAI_API_KEY`를 쓰므로 음성 인식용 OpenAI API key는 아직 필요하다. Codex 토큰은 브라우저로 보내지지 않고 서버의 Hermes CLI가 사용한다.

사용 가능한 OpenAI API 모델명을 확인하려면 OpenAI API key를 임시로 환경변수에 넣고 실행한다.

```bash
OPENAI_API_KEY=sk-... npm run models
OPENAI_API_KEY=sk-... npm run models gpt
OPENAI_API_KEY=sk-... npm run models transcribe
```

원하는 채팅 모델 ID가 보이면 `.env.local`의 `OPENAI_CHAT_MODEL`에 그대로 넣는다.
예를 들어 계정에서 `gpt-5.5`가 보이면:

```bash
OPENAI_CHAT_MODEL=gpt-5.5
```

모델명을 바꾼 뒤에는 dev 서버를 껐다가 다시 켠다.

## Firebase Hosting + Cloud Run 배포

Codex OAuth로 `gpt-5.5`를 쓰려면 Firebase Hosting 단독이 아니라 Cloud Run 컨테이너가 필요하다. 이 repo는 아래 구조로 배포할 수 있게 설정되어 있다.

```text
Firebase Hosting
→ 모든 요청을 Cloud Run service `gpt-stt`로 rewrite
→ Cloud Run 컨테이너 안에서 Next.js 서버 실행
→ /api/chat이 hermes CLI로 openai-codex gpt-5.5 호출
```

준비물:

- Google Cloud CLI (`gcloud`)
- Firebase CLI (`firebase`)

```bash
npm install -g firebase-tools
firebase login
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
firebase use --add YOUR_PROJECT_ID
```

필요 API 활성화:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com firebasehosting.googleapis.com
```

Secret Manager에 인증값 저장:

```bash
# Codex OAuth 인증 파일. 서버 시작 시 base64 decode되어 $HERMES_HOME/auth.json으로 들어간다.
base64 -i ~/.hermes/auth.json | gcloud secrets create hermes-auth-json-b64 --data-file=-

# 음성 인식용 OpenAI API key. /api/transcribe에서 계속 필요하다.
printf 'sk-...' | gcloud secrets create openai-api-key --data-file=-
```

이미 secret이 있으면 `create` 대신 새 버전을 추가한다.

```bash
base64 -i ~/.hermes/auth.json | gcloud secrets versions add hermes-auth-json-b64 --data-file=-
printf 'sk-...' | gcloud secrets versions add openai-api-key --data-file=-
```

Cloud Run 기본 서비스 계정에 secret 접근 권한을 준다.

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding hermes-auth-json-b64 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role='roles/secretmanager.secretAccessor'
gcloud secrets add-iam-policy-binding openai-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role='roles/secretmanager.secretAccessor'
```

Cloud Run 배포:

```bash
npm run deploy:cloudrun
```

Firebase Hosting 배포:

```bash
npm run deploy:firebase
```

기본 region은 `firebase.json`과 `cloudbuild.yaml` 둘 다 `asia-northeast3`로 맞춰놨다. 다른 region을 쓰려면 두 파일의 region을 같이 바꾼다.

주의:

- 무료/저렴하게 쓰려고 Cloud Run `min instances`는 0으로 둔다. 대신 첫 요청은 cold start 때문에 느릴 수 있다.
- 과금 폭주를 줄이려고 `cloudbuild.yaml`은 `--max-instances=1`, `--concurrency=1`로 배포한다. 소수 사용자가 쓰는 gpt-stt 용도에는 충분하고, 갑작스러운 확장 비용을 제한한다.
- gpt-stt의 첫 응답 지연을 줄이고 싶으면 Cloud Run 최소 인스턴스 1개를 켜야 하는데, 이러면 비용이 생길 수 있다.
- Codex OAuth는 공식 서버 앱용 API key가 아니라서, 세션 만료/재인증 문제가 생기면 `~/.hermes/auth.json`을 다시 secret에 올려야 한다.

## 배포 메모

- HTTPS 환경에서만 마이크/PWA가 안정적으로 동작한다.
- iPhone Safari는 자동 음성 재생 제약이 있으므로 사용자가 버튼을 눌러 시작하는 UX를 유지한다.
- API key와 Codex OAuth 파일은 절대 프론트엔드에 넣지 않는다.
