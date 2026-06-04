'use client';

import { useEffect, useRef, useState } from 'react';

type Step = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
type HistoryTurn = { question: string; answer: string; at: number };
type HistorySession = { id: string; title: string; turns: HistoryTurn[]; updatedAt: number };
type VoiceOption = {
  id: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};
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

const SILENCE_LIMIT_MS = 2400;
const BROWSER_SPEECH_SILENCE_LIMIT_MS = 1600;
const BROWSER_SPEECH_FINAL_SILENCE_LIMIT_MS = 700;
const SILENCE_THRESHOLD = 0.018;
const HISTORY_KEY = 'gpt-stt-history-v1';
const VOICE_KEY = 'gpt-stt-voice-v1';
const SW_CLEANUP_KEY = 'gpt-stt-sw-cleaned-v1';
const MAX_HISTORY_SESSIONS = 8;
const MAX_CONTEXT_TURNS = 4;
const ENABLE_OPENAI_STT_FALLBACK = process.env.NEXT_PUBLIC_ENABLE_OPENAI_STT_FALLBACK === 'true';
const ENABLE_SERVER_TTS = process.env.NEXT_PUBLIC_ENABLE_SERVER_TTS === 'true';
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

function getVoiceId(voice: SpeechSynthesisVoice) {
  return `${voice.name}__${voice.lang}`;
}

function getVoiceScore(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang === 'ko-kr') score += 80;
  else if (lang.startsWith('ko')) score += 60;
  if (name.includes('korean') || name.includes('한국') || name.includes('대한민국')) score += 25;
  if (name.includes('natural') || name.includes('online') || name.includes('neural')) score += 35;
  if (name.includes('microsoft')) score += 24;
  if (name.includes('google')) score += 18;
  if (!voice.localService) score += 8;
  if (voice.default) score += 4;

  return score;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || '요청 처리에 실패했습니다.');
  return data as T;
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
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [typedQuestion, setTypedQuestion] = useState('');
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

    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = null;
      clearRecognitionFinishTimer();
      recognitionRef.current?.abort();
      cleanupRecordingResources();
      window.speechSynthesis?.cancel();
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

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;

    const availableVoices = window.speechSynthesis.getVoices();
    const options = availableVoices
      .filter((voice) => voice.lang.toLowerCase().startsWith('ko') || /korean|한국|대한민국/i.test(voice.name))
      .sort((a, b) => getVoiceScore(b) - getVoiceScore(a))
      .map((voice) => ({
        id: getVoiceId(voice),
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        default: voice.default,
      }));

    setVoices(options);
    setSelectedVoiceId((current) => {
      const saved = window.localStorage.getItem(VOICE_KEY) || '';
      const next = current || saved;
      if (next && options.some((voice) => voice.id === next)) return next;
      return options[0]?.id || '';
    });
  }

  function findSelectedVoice() {
    if (!('speechSynthesis' in window)) return undefined;

    const availableVoices = window.speechSynthesis.getVoices();
    const saved = window.localStorage.getItem(VOICE_KEY) || '';
    const preferredId = selectedVoiceId || saved;
    const selected = availableVoices.find((voice) => getVoiceId(voice) === preferredId);
    if (selected) return selected;

    return availableVoices
      .filter((voice) => voice.lang.toLowerCase().startsWith('ko') || /korean|한국|대한민국/i.test(voice.name))
      .sort((a, b) => getVoiceScore(b) - getVoiceScore(a))[0];
  }

  function changeVoice(voiceId: string) {
    setSelectedVoiceId(voiceId);
    window.localStorage.setItem(VOICE_KEY, voiceId);
  }

  function previewVoice() {
    speakWithBrowser(VOICE_PREVIEW_TEXT);
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
    setStep('thinking');
    const context = getContextForMessage(cleanText);
    const chat = await postJson<{ answer: string }>('/api/chat', {
      message: cleanText,
      history: context.turns,
    });
    setAnswer(chat.answer);
    addHistory(cleanText, chat.answer, context.sessionId);
    await speak(chat.answer);
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

  function speakWithBrowser(text: string) {
    if (!('speechSynthesis' in window)) {
      setStep('idle');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = findSelectedVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = 'ko-KR';
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.onend = () => setStep('idle');
    utterance.onerror = () => setStep('idle');
    window.speechSynthesis.speak(utterance);
  }

  async function speak(text: string) {
    if (!text) return;
    setStep('speaking');
    setError('');
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();

    if (!ENABLE_SERVER_TTS) {
      speakWithBrowser(text);
      return;
    }

    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error('server-tts-unavailable');
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
        speakWithBrowser(text);
      };
      await audio.play();
    } catch {
      speakWithBrowser(text);
    }
  }

  async function startRecording() {
    setError('');
    setTranscript('');
    setAnswer('');
    window.speechSynthesis?.cancel();
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
    window.speechSynthesis?.cancel();
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
          <div className={`bubble ${answer ? '' : 'empty'}`}>{answer || '답변이 여기에 표시됩니다.'}</div>
          {voices.length > 0 ? (
            <div className="voiceControls">
              <label className="voiceLabel" htmlFor="voice-select">목소리</label>
              <select
                id="voice-select"
                className="voiceSelect"
                value={selectedVoiceId}
                onChange={(event) => changeVoice(event.target.value)}
                disabled={step === 'recording'}
              >
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
              <button className="voicePreview" onClick={previewVoice} disabled={step === 'recording'}>미리듣기</button>
            </div>
          ) : null}
          <div className="actions">
            <button className="actionButton" onClick={() => void speak(answer)} disabled={!answer || step === 'recording'}>다시 듣기</button>
            <button className="actionButton secondary" onClick={() => { sessionIdRef.current = createSessionId(); setTranscript(''); setAnswer(''); setError(''); window.speechSynthesis?.cancel(); audioRef.current?.pause(); setStep('idle'); }}>초기화</button>
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
