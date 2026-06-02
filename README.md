# GPT 음성비서 PWA

부모님이 아이폰/안드로이드에서 쉽게 GPT를 쓰도록 만든 음성 질문/답변 PWA다.

## 왜 Next.js인가

이 프로젝트는 React 단독 앱보다 Next.js가 낫다.

- PWA 화면과 서버 API를 한 repo에서 관리할 수 있다.
- OpenAI API key를 브라우저에 노출하지 않고 서버 route에만 둘 수 있다.
- iPhone/Android 모두 URL 접속 후 홈 화면 추가로 설치할 수 있다.
- 나중에 Vercel 같은 곳에 바로 배포하기 쉽다.

React 단독 Vite 앱도 가능하지만, STT/Chat 서버가 따로 필요해서 부모님용 MVP에는 Next.js가 더 단순하다.

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

사용 가능한 모델명을 확인하려면 OpenAI API key를 임시로 환경변수에 넣고 실행한다.

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

## 배포 메모

- HTTPS 환경에서만 마이크/PWA가 안정적으로 동작한다.
- iPhone Safari는 자동 음성 재생 제약이 있으므로 사용자가 버튼을 눌러 시작하는 UX를 유지한다.
- API key는 절대 프론트엔드에 넣지 않는다.
