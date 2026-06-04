'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  ELEVENLABS_MODEL_OPTIONS,
  type ElevenLabsModelId,
  type ElevenLabsModelOption,
  isElevenLabsModelId,
} from './elevenlabs-models';

type Step = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
type HistoryTurn = { question: string; answer: string; at: number };
type HistorySession = { id: string; title: string; turns: HistoryTurn[]; updatedAt: number };
type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};
type BrowserSpeechRecognitionErrorEvent = { error?: string };
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type HealthResponse = {
  serverTts?: boolean;
  ttsModel?: string;
  ttsModels?: ElevenLabsModelOption[];
};
type ChatStreamEvent =
  | { type: 'delta'; delta: string }
  | { type: 'done'; answer: string }
  | { type: 'error'; error: string };

const SILENCE_LIMIT_MS = 2400;
const BROWSER_SPEECH_SILENCE_LIMIT_MS = 1600;
const BROWSER_SPEECH_FINAL_SILENCE_LIMIT_MS = 700;
const SILENCE_THRESHOLD = 0.018;
const HISTORY_KEY = 'gpt-stt-history-v1';
const SW_CLEANUP_KEY = 'gpt-stt-sw-cleaned-v1';
const TTS_MODEL_KEY = 'gpt-stt-elevenlabs-model-v1';
const MAX_HISTORY_SESSIONS = 8;
const MAX_CONTEXT_TURNS = 4;
const ENABLE_OPENAI_STT_FALLBACK = process.env.NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK === 'true';
const VOICE_PREVIEW_TEXT = '안녕하세요. 지금 선택한 목소리로 말하고 있어요.';
const TOPIC_STOP_WORDS = new Set([
  '가족',
  '가능',
  '관련',
  '그럼',
  '그건',
  '그거',
  '대해',
  '먹을',
  '무엇',
  '방법',
  '만드는',
  '만드는법',
  '설명',
  '알려줘',
  '자세히',
  '정도',
  '조금',
  '주제',
  '질문',
]);

function statusText(step: Step, autoStopReady: boolean) {
  switch (step) {
    case 'recording': return autoStopReady ? '듣는 중입니다. 잠시 멈추면 자동으로 끝납니다.' : '듣는 중입니다.';
    case 'transcribing': return '말씀하신 내용을 글자로 바꾸는 중입니다.';
    case 'thinking': return '답변을 생각하는 중입니다.';
    case 'speaking': return '답변을 읽는 중입니다.';
    default: return '';
  }
}

function getBrowserSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

async function streamChatAnswer(
  body: { message: string; history: { question?: string; answer?: string }[] },
  onDelta: (delta: string, answer: string) => void,
) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || '요청 처리에 실패했습니다.');
  }
  if (!response.body) throw new Error('답변 스트림을 열지 못했습니다.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const eventText of events) {
      const dataLine = eventText
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (!dataLine) continue;

      const event = JSON.parse(dataLine.slice(6)) as ChatStreamEvent;
      if (event.type === 'delta') {
        answer += event.delta;
        onDelta(event.delta, answer);
      }
      if (event.type === 'done') {
        return event.answer || answer;
      }
      if (event.type === 'error') throw new Error(event.error);
    }
  }

  return answer;
}

function getSpeechText(text: string) {
  return text
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getSafeHttpUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function getReadableUrlLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function renderLinkedText(text: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [raw, markdownLabel, markdownUrl, rawUrl] = match;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const url = getSafeHttpUrl(markdownUrl || rawUrl || '');
    if (url) {
      parts.push(
        <a key={`${url}-${match.index}`} href={url} target="_blank" rel="noreferrer">
          {markdownLabel || getReadableUrlLabel(url)}
        </a>,
      );
    } else {
      parts.push(raw);
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTopicToken(token: string) {
  return token
    .replace(/(으로는|로는|으로|에는|에서|에게|부터|까지|은|는|이|가|을|를|도|만|과|와|랑)$/u, '')
    .trim();
}

function getTopicTokens(text: string) {
  const tokens = text
    .toLowerCase()
    .replace(/[^0-9a-zㄱ-ㅎㅏ-ㅣ가-힣\s]/g, ' ')
    .split(/\s+/)
    .map(normalizeTopicToken)
    .filter((token) => token.length >= 2 && !TOPIC_STOP_WORDS.has(token))
    .flatMap((token) => {
      const related = [token];
      if (token.includes('현대')) related.push('현대');
      if (token.includes('모비스')) related.push('모비스');
      return related;
    });

  return Array.from(new Set(tokens));
}

function isRelatedToken(left: string, right: string) {
  if (left === right) return true;
  return left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left));
}

function isFollowUpMessage(message: string) {
  const compact = message.replace(/\s+/g, '');
  if (!compact) return false;
  if (/^(자세히|더자세히|좀더|구체적으로|계속|이어|그럼|그러면|그건|그거|이건|이거|저건|저거|아까|방금)/u.test(compact)) return true;
  if (compact.length <= 24 && /(로는|으로는|은안돼|는안돼|가능해|가능한가|괜찮아|왜|얼마나|몇|언제|어떻게)/u.test(compact)) return true;
  return compact.length <= 12 && /(은|는|도|만|돼|되나요|되나|어때)[?？]?$/u.test(compact);
}

function scoreSessionForMessage(message: string, session: HistorySession) {
  const messageTokens = getTopicTokens(message);
  if (messageTokens.length === 0) return 0;

  const sessionText = session.turns
    .map((turn) => `${turn.question} ${turn.answer}`)
    .join(' ');
  const sessionTokens = getTopicTokens(sessionText);

  return messageTokens.reduce((score, messageToken) => {
    const related = sessionTokens.find((sessionToken) => isRelatedToken(messageToken, sessionToken));
    if (!related) return score;
    return score + (messageToken === related ? 2 : 1);
  }, 0);
}

function findContextSession(message: string, sessions: HistorySession[], preferredSessionId: string) {
  if (sessions.length === 0) return undefined;

  const preferredSession = sessions.find((session) => session.id === preferredSessionId) || sessions[0];
  if (isFollowUpMessage(message)) return preferredSession;

  const [best] = sessions
    .map((session) => ({ session, score: scoreSessionForMessage(message, session) }))
    .sort((left, right) => right.score - left.score);

  return best && best.score > 0 ? best.session : undefined;
}

function splitMixedHistorySessions(sessions: HistorySession[]) {
  const normalized: HistorySession[] = [];

  sessions.forEach((session) => {
    const groups: HistorySession[] = [];
    let current: HistorySession | undefined;

    session.turns.forEach((turn) => {
      const updatedAt = turn.at || session.updatedAt || Date.now();
      const sameTopic = current
        ? isFollowUpMessage(turn.question) || scoreSessionForMessage(turn.question, current) > 0
        : false;

      if (!current || !sameTopic) {
        if (current) groups.push(current);
        current = {
          id: groups.length === 0 ? session.id : `${session.id}-topic-${groups.length + 1}`,
          title: turn.question || session.title || '새 대화',
          turns: [turn],
          updatedAt,
        };
        return;
      }

      current = {
        ...current,
        turns: [...current.turns, turn],
        updatedAt,
      };
    });

    if (current) groups.push(current);
    normalized.push(...groups);
  });

  return normalized
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_HISTORY_SESSIONS);
}

export default function VoiceAssistant() {
  const [step, setStep] = useState<Step>('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState('');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [isHistoryDeleteMode, setIsHistoryDeleteMode] = useState(false);
  const [autoStopReady, setAutoStopReady] = useState(false);
  const [typedQuestion, setTypedQuestion] = useState('');
  const [serverTtsEnabled, setServerTtsEnabled] = useState(true);
  const [ttsModels, setTtsModels] = useState<ElevenLabsModelOption[]>(ELEVENLABS_MODEL_OPTIONS);
  const [selectedTtsModel, setSelectedTtsModel] = useState<ElevenLabsModelId>(DEFAULT_ELEVENLABS_MODEL_ID);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recognitionFinalTextRef = useRef('');
  const recognitionLiveTextRef = useRef('');
  const recognitionHadErrorRef = useRef(false);
  const recognitionFinishTimerRef = useRef<number | null>(null);
  const recognitionFinishingRef = useRef(false);
  const sessionIdRef = useRef(createSessionId());

  useEffect(() => {
    void cleanupServiceWorker();

    const saved = window.localStorage.getItem(HISTORY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed)) {
          if (parsed.some((item) => Array.isArray((item as HistorySession).turns))) {
            const normalized = splitMixedHistorySessions(parsed as HistorySession[]);
            setHistory(normalized);
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
          } else {
            const turns = (parsed as HistoryTurn[]).filter((item) => item.question && item.answer);
            const normalized = splitMixedHistorySessions(turns.length ? [{
              id: 'legacy-history',
              title: turns[0].question,
              turns,
              updatedAt: turns[0].at || Date.now(),
            }] : []);
            setHistory(normalized);
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
          }
        }
      } catch {
        window.localStorage.removeItem(HISTORY_KEY);
      }
    }

    void loadTtsConfig();

    return () => {
      clearRecognitionFinishTimer();
      recognitionRef.current?.abort();
      cleanupRecordingResources();
      audioRef.current?.pause();
    };
  }, []);

  async function cleanupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const cacheKeys = 'caches' in window ? await window.caches.keys() : [];
      await Promise.all([
        ...registrations.map((registration) => registration.unregister()),
        ...cacheKeys.filter((key) => key.startsWith('gpt-stt-')).map((key) => window.caches.delete(key)),
      ]);

      if (navigator.serviceWorker.controller && window.sessionStorage.getItem(SW_CLEANUP_KEY) !== 'done') {
        window.sessionStorage.setItem(SW_CLEANUP_KEY, 'done');
        window.location.reload();
      }
    } catch {
      // A failed cleanup should not block the voice assistant.
    }
  }

  async function loadTtsConfig() {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) return;
      const data = await response.json() as HealthResponse;
      setServerTtsEnabled(data.serverTts !== false);
      if (Array.isArray(data.ttsModels) && data.ttsModels.length > 0) {
        setTtsModels(data.ttsModels.filter((model) => isElevenLabsModelId(model.id)));
      }
      const savedModelId = window.localStorage.getItem(TTS_MODEL_KEY);
      const nextModelId = savedModelId || data.ttsModel || DEFAULT_ELEVENLABS_MODEL_ID;
      if (isElevenLabsModelId(nextModelId)) setSelectedTtsModel(nextModelId);
    } catch {
      setServerTtsEnabled(true);
    }
  }

  function selectTtsModel(modelId: string) {
    if (!isElevenLabsModelId(modelId)) return;
    setSelectedTtsModel(modelId);
    window.localStorage.setItem(TTS_MODEL_KEY, modelId);
  }

  function previewVoice() {
    void speak(VOICE_PREVIEW_TEXT);
  }

  function clearRecognitionFinishTimer() {
    if (recognitionFinishTimerRef.current !== null) {
      window.clearTimeout(recognitionFinishTimerRef.current);
      recognitionFinishTimerRef.current = null;
    }
  }

  function scheduleRecognitionFinish(delayMs = BROWSER_SPEECH_SILENCE_LIMIT_MS) {
    clearRecognitionFinishTimer();
    recognitionFinishTimerRef.current = window.setTimeout(() => {
      finishBrowserSpeechRecognition();
    }, delayMs);
  }

  function finishBrowserSpeechRecognition() {
    clearRecognitionFinishTimer();
    const text = recognitionFinalTextRef.current || recognitionLiveTextRef.current;
    const recognition = recognitionRef.current;
    recognitionFinishingRef.current = true;
    recognitionRef.current = null;
    setAutoStopReady(false);
    setStep('transcribing');

    try {
      recognition?.stop();
    } catch {
      recognition?.abort();
    }

    void answerFromText(text).catch((err) => {
      setError(err instanceof Error ? err.message : '처리 중 문제가 발생했습니다.');
      setStep('idle');
    });
  }

  function saveHistory(next: HistorySession[]) {
    setHistory(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, MAX_HISTORY_SESSIONS)));
  }

  function addHistory(question: string, reply: string, sessionId: string) {
    const now = Date.now();
    const turn = { question, answer: reply, at: now };
    setHistory((current) => {
      const existing = current.find((session) => session.id === sessionId);
      const rest = current.filter((session) => session.id !== sessionId);
      const session = existing
        ? {
            ...existing,
            title: existing.title || question,
            turns: [...existing.turns, turn],
            updatedAt: now,
          }
        : {
            id: sessionId,
            title: question,
            turns: [turn],
            updatedAt: now,
          };
      const next = [session, ...rest].slice(0, MAX_HISTORY_SESSIONS);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearHistory() {
    saveHistory([]);
    sessionIdRef.current = createSessionId();
    setExpandedHistoryId('');
    setSelectedHistoryIds([]);
    setIsHistoryDeleteMode(false);
  }

  function toggleHistorySelection(sessionId: string) {
    setSelectedHistoryIds((current) => (
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    ));
  }

  function deleteSelectedHistory() {
    if (selectedHistoryIds.length === 0) return;
    const selected = new Set(selectedHistoryIds);
    saveHistory(history.filter((session) => !selected.has(session.id)));
    if (selected.has(expandedHistoryId)) setExpandedHistoryId('');
    setSelectedHistoryIds([]);
    setIsHistoryDeleteMode(false);
  }

  function getContextForMessage(message: string) {
    const contextSession = findContextSession(message, history, sessionIdRef.current);
    const sessionId = contextSession?.id || createSessionId();
    sessionIdRef.current = sessionId;

    return {
      sessionId,
      turns: (contextSession?.turns || [])
        .slice(-MAX_CONTEXT_TURNS)
        .map((item) => ({ question: item.question, answer: item.answer })),
    };
  }

  function stopSilenceMonitor() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    silenceSinceRef.current = null;
    setAutoStopReady(false);
  }

  function cleanupRecordingResources() {
    stopSilenceMonitor();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function answerFromText(text: string) {
    const cleanText = text.trim();
    if (!cleanText) throw new Error('말소리를 인식하지 못했습니다. 다시 한 번 또렷하게 말씀해 주세요.');

    setTranscript(cleanText);
    setAnswer('');
    setStep('thinking');
    const context = getContextForMessage(cleanText);
    const reply = await streamChatAnswer({
      message: cleanText,
      history: context.turns,
    }, (_delta, nextAnswer) => {
      setAnswer(nextAnswer);
    });
    const finalReply = reply.trim();
    if (!finalReply) throw new Error('답변이 비어 있습니다. 다시 한 번 질문해 주세요.');

    setAnswer(finalReply);
    addHistory(cleanText, finalReply, context.sessionId);
    void speak(finalReply);
  }

  function startSilenceMonitor(stream: MediaStream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    audioContextRef.current = audioContext;
    setAutoStopReady(true);

    const tick = () => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== 'recording') return;

      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const volume = Math.sqrt(sum / samples.length);
      const now = performance.now();

      if (volume < SILENCE_THRESHOLD) {
        silenceSinceRef.current ??= now;
        if (now - silenceSinceRef.current >= SILENCE_LIMIT_MS) {
          stopRecording();
          return;
        }
      } else {
        silenceSinceRef.current = null;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  async function speak(text: string) {
    const speechText = getSpeechText(text);
    if (!speechText) return;
    setStep('speaking');
    setError('');
    audioRef.current?.pause();

    if (!serverTtsEnabled) {
      setError('ElevenLabs TTS가 꺼져 있습니다.');
      setStep('idle');
      return;
    }

    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: speechText, modelId: selectedTtsModel }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'ElevenLabs 음성 생성에 실패했습니다.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setStep('idle');
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setError('ElevenLabs 음성을 재생하지 못했습니다.');
        setStep('idle');
      };
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ElevenLabs 음성 생성에 실패했습니다.');
      setStep('idle');
    }
  }

  async function startRecording() {
    setError('');
    setTranscript('');
    setAnswer('');
    audioRef.current?.pause();
    clearRecognitionFinishTimer();
    recognitionFinishingRef.current = false;

    const SpeechRecognitionCtor = getBrowserSpeechRecognition();
    if (SpeechRecognitionCtor) {
      startBrowserSpeechRecognition(SpeechRecognitionCtor);
      return;
    }

    if (!ENABLE_OPENAI_STT_FALLBACK) {
      setError('이 브라우저는 브라우저 음성 인식을 지원하지 않습니다. Chrome 최신 버전으로 열어 주세요.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저는 녹음을 지원하지 않습니다. Chrome이나 Safari 최신 버전으로 열어 주세요.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => void handleRecordingStopped(mimeType || recorder.mimeType || 'audio/webm');
      recorder.start();
      setStep('recording');
      startSilenceMonitor(stream);
    } catch {
      setError('마이크 권한이 필요합니다. 브라우저 주소창 설정에서 마이크를 허용해 주세요.');
      setStep('idle');
      cleanupRecordingResources();
    }
  }

  function startBrowserSpeechRecognition(SpeechRecognitionCtor: BrowserSpeechRecognitionConstructor) {
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionFinalTextRef.current = '';
    recognitionLiveTextRef.current = '';
    recognitionHadErrorRef.current = false;
    recognitionFinishingRef.current = false;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let finalText = '';
      let liveText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcriptText = result[0]?.transcript || '';
        liveText += transcriptText;
        if (result.isFinal) finalText += transcriptText;
      }

      recognitionLiveTextRef.current = liveText.trim();
      if (finalText.trim()) recognitionFinalTextRef.current = finalText.trim();
      if (recognitionLiveTextRef.current) setTranscript(recognitionLiveTextRef.current);
      if (recognitionLiveTextRef.current || recognitionFinalTextRef.current) {
        scheduleRecognitionFinish(finalText.trim() ? BROWSER_SPEECH_FINAL_SILENCE_LIMIT_MS : undefined);
      }
    };

    recognition.onerror = (event) => {
      clearRecognitionFinishTimer();
      recognitionHadErrorRef.current = true;
      recognitionRef.current = null;
      setAutoStopReady(false);
      setStep('idle');
      const error = event.error === 'not-allowed'
        ? '마이크 권한이 필요합니다. 브라우저 주소창 설정에서 마이크를 허용해 주세요.'
        : '브라우저 음성 인식에 실패했습니다. 다시 한 번 말씀해 주세요.';
      setError(error);
    };

    recognition.onend = () => {
      if (recognitionHadErrorRef.current) return;
      if (recognitionFinishingRef.current) return;
      if (!recognitionFinishingRef.current) {
        window.setTimeout(() => {
          if (recognitionFinishingRef.current || recognitionHadErrorRef.current || recognitionRef.current !== recognition) return;
          try {
            recognition.start();
          } catch {
            finishBrowserSpeechRecognition();
          }
        }, 180);
        return;
      }

      const text = recognitionFinalTextRef.current || recognitionLiveTextRef.current;
      recognitionRef.current = null;
      setAutoStopReady(false);
      setStep('transcribing');

      void answerFromText(text).catch((err) => {
        setError(err instanceof Error ? err.message : '처리 중 문제가 발생했습니다.');
        setStep('idle');
      });
    };

    try {
      recognition.start();
      setStep('recording');
      setAutoStopReady(true);
    } catch {
      recognitionRef.current = null;
      setAutoStopReady(false);
      setStep('idle');
      setError('브라우저 음성 인식을 시작하지 못했습니다. 잠시 후 다시 눌러 주세요.');
    }
  }

  function stopRecording() {
    const recognition = recognitionRef.current;
    if (recognition) {
      finishBrowserSpeechRecognition();
      return;
    }

    const recorder = recorderRef.current;
    stopSilenceMonitor();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }

  async function handleRecordingStopped(mimeType: string) {
    setStep('transcribing');
    try {
      const audio = new Blob(chunksRef.current, { type: mimeType });
      if (audio.size < 1024) throw new Error('녹음이 너무 짧습니다. 다시 한 번 말씀해 주세요.');

      const form = new FormData();
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      form.append('audio', audio, `voice.${ext}`);

      const transcribeResponse = await fetch('/api/transcribe', { method: 'POST', body: form });
      const transcribeData = await transcribeResponse.json().catch(() => ({}));
      if (!transcribeResponse.ok) throw new Error(transcribeData?.error || '음성 인식에 실패했습니다.');

      const text = String(transcribeData.text || '').trim();
      await answerFromText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리 중 문제가 발생했습니다.');
      setStep('idle');
    } finally {
      recorderRef.current = null;
      chunksRef.current = [];
      cleanupRecordingResources();
    }
  }

  function onMainButtonClick() {
    if (step === 'recording') stopRecording();
    else if (step === 'idle' || step === 'speaking') void startRecording();
  }

  function submitTypedQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typedQuestion.trim();
    if (!text || !['idle', 'speaking'].includes(step)) return;

    setError('');
    setAnswer('');
    setTypedQuestion('');
    audioRef.current?.pause();

    void answerFromText(text).catch((err) => {
      setError(err instanceof Error ? err.message : '처리 중 문제가 발생했습니다.');
      setStep('idle');
    });
  }

  return (
    <main className="main">
      <section className="shell">
        <section className="card controlCard">
          <button
            className={`micButton ${step === 'recording' ? 'recording' : ''}`}
            onClick={onMainButtonClick}
            disabled={!['idle', 'recording', 'speaking'].includes(step)}
            aria-label={step === 'recording' ? '끝' : '말하기'}
          >
            <span className="micLabel">{step === 'recording' ? '끝' : '말하기'}</span>
          </button>
          {statusText(step, autoStopReady) ? <div className="status" role="status">{statusText(step, autoStopReady)}</div> : null}
          {['transcribing', 'thinking', 'speaking'].includes(step) ? <div className="loader" aria-hidden="true" /> : null}
        </section>

        {error ? <div className="error">{error}</div> : null}

        <section className="card composerCard">
          <h2>직접 입력</h2>
          <form className="textQuestionForm" onSubmit={submitTypedQuestion}>
            <label className="composerLabel" htmlFor="question-input">질문하세요</label>
            <div className="composerRow">
              <div className="textQuestionBox">
                <textarea
                  id="question-input"
                  className="textQuestionInput"
                  value={typedQuestion}
                  onChange={(event) => setTypedQuestion(event.target.value)}
                  placeholder="무엇이든 질문하세요"
                  rows={3}
                  disabled={!['idle', 'speaking'].includes(step)}
                />
                <button className="insideSubmitButton" type="submit" disabled={!typedQuestion.trim() || !['idle', 'speaking'].includes(step)}>
                  질문하기
                </button>
              </div>
              <button
                className={`smallMicButton ${step === 'recording' ? 'recording' : ''}`}
                type="button"
                onClick={onMainButtonClick}
                disabled={!['idle', 'recording', 'speaking'].includes(step)}
                aria-label={step === 'recording' ? '끝' : '말하기'}
              >
                {step === 'recording' ? '끝' : '말하기'}
              </button>
            </div>
            {statusText(step, autoStopReady) ? <div className="status compactStatus" role="status">{statusText(step, autoStopReady)}</div> : null}
            {['transcribing', 'thinking', 'speaking'].includes(step) ? <div className="loader" aria-hidden="true" /> : null}
          </form>
        </section>

        <section className="panel card">
          <h2>질문</h2>
          <div className={`bubble ${transcript ? '' : 'empty'}`}>{transcript}</div>
        </section>

        <section className="panel card">
          <h2>답변</h2>
          <div className={`bubble answerBubble ${answer ? '' : 'empty'}`}>
            {answer ? renderLinkedText(answer) : '답변이 여기에 표시됩니다.'}
          </div>
          <div className="voiceControls">
            <div className="voiceRow">
              <span className="voiceLabel">목소리</span>
              <span className="serverVoiceBadge">ElevenLabs</span>
              <button className="voicePreview" onClick={previewVoice} disabled={step === 'recording' || !serverTtsEnabled}>미리듣기</button>
            </div>
            <label className="voiceRow modelRow" htmlFor="tts-model-select">
              <span className="voiceLabel">모델</span>
              <select
                id="tts-model-select"
                className="ttsModelSelect"
                value={selectedTtsModel}
                onChange={(event) => selectTtsModel(event.target.value)}
                disabled={step === 'recording' || !serverTtsEnabled}
              >
                {ttsModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} - {model.detail}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="actionButton" onClick={() => void speak(answer)} disabled={!answer || step === 'recording'}>다시 듣기</button>
            <button className="actionButton secondary" onClick={() => { sessionIdRef.current = createSessionId(); setTranscript(''); setAnswer(''); setError(''); audioRef.current?.pause(); setStep('idle'); }}>초기화</button>
          </div>
        </section>

        {history.length > 0 ? (
          <section className="history card">
            <div className="historyHeader">
              <h2>최근 대화</h2>
              {isHistoryDeleteMode ? (
                <div className="historyActions">
                  <button className="clearHistory" onClick={deleteSelectedHistory} disabled={selectedHistoryIds.length === 0}>
                    선택 삭제
                  </button>
                  <button
                    className="clearHistory secondary"
                    onClick={() => {
                      setIsHistoryDeleteMode(false);
                      setSelectedHistoryIds([]);
                    }}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  className="clearHistory"
                  onClick={() => {
                    setIsHistoryDeleteMode(true);
                    setSelectedHistoryIds([]);
                  }}
                >
                  기록 삭제
                </button>
              )}
            </div>
            <div className="historyList">
              {history.map((session) => (
                <div
                  key={session.id}
                  className={`historyItem ${expandedHistoryId === session.id ? 'expanded' : ''} ${isHistoryDeleteMode ? 'selecting' : ''}`}
                >
                  {isHistoryDeleteMode ? (
                    <input
                      className="historyCheckbox"
                      type="checkbox"
                      checked={selectedHistoryIds.includes(session.id)}
                      onChange={() => toggleHistorySelection(session.id)}
                      aria-label={`${session.title || '새 대화'} 선택`}
                    />
                  ) : null}
                  <button
                    className="historyTitleButton"
                    onClick={() => {
                      const lastTurn = session.turns[session.turns.length - 1];
                      sessionIdRef.current = session.id;
                      setExpandedHistoryId(expandedHistoryId === session.id ? '' : session.id);
                      if (lastTurn) {
                        setTranscript(lastTurn.question);
                        setAnswer(lastTurn.answer);
                      }
                    }}
                  >
                    <strong>{session.title || '새 대화'}</strong>
                  </button>
                  {expandedHistoryId === session.id ? (
                    <span>{session.turns.map((item) => `${item.question}\n${item.answer}`).join('\n\n')}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}
