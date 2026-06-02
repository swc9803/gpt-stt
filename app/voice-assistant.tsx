'use client';

import { useEffect, useRef, useState } from 'react';

type Step = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
type HistoryItem = { question: string; answer: string; at: number };

const SILENCE_LIMIT_MS = 2000;
const SILENCE_THRESHOLD = 0.018;
const HISTORY_KEY = 'gpt-stt-history-v1';

function statusText(step: Step, autoStopReady: boolean) {
  switch (step) {
    case 'recording': return autoStopReady ? '듣는 중입니다. 조용하면 자동으로 끝납니다.' : '듣는 중입니다.';
    case 'transcribing': return '말씀하신 내용을 글자로 바꾸는 중입니다.';
    case 'thinking': return '답변을 생각하는 중입니다.';
    case 'speaking': return '답변을 읽어드리는 중입니다.';
    default: return '';
  }
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

export default function VoiceAssistant() {
  const [step, setStep] = useState<Step>('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [autoStopReady, setAutoStopReady] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    const saved = window.localStorage.getItem(HISTORY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as HistoryItem[];
        setHistory(Array.isArray(parsed) ? parsed.slice(0, 10) : []);
      } catch {
        window.localStorage.removeItem(HISTORY_KEY);
      }
    }

    return () => {
      cleanupRecordingResources();
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
    };
  }, []);

  function saveHistory(next: HistoryItem[]) {
    setHistory(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 10)));
  }

  function addHistory(question: string, reply: string) {
    const next = [{ question, answer: reply, at: Date.now() }, ...history].slice(0, 10);
    saveHistory(next);
  }

  function clearHistory() {
    saveHistory([]);
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
    utterance.lang = 'ko-KR';
    utterance.rate = 0.92;
    utterance.pitch = 1;
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

  function stopRecording() {
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
      if (!text) throw new Error('말소리를 인식하지 못했습니다. 다시 한 번 또렷하게 말씀해 주세요.');
      setTranscript(text);

      setStep('thinking');
      const chat = await postJson<{ answer: string }>('/api/chat', { message: text });
      setAnswer(chat.answer);
      addHistory(text, chat.answer);
      await speak(chat.answer);
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
    else if (step === 'idle') void startRecording();
  }

  return (
    <main className="main">
      <section className="shell">
        <header className="header">
          <h1>gpt-stt</h1>
        </header>

        <section className="card controlCard">
          <button
            className={`micButton ${step === 'recording' ? 'recording' : ''}`}
            onClick={onMainButtonClick}
            disabled={!['idle', 'recording'].includes(step)}
            aria-label={step === 'recording' ? '말하기 끝내기' : '말하기 시작'}
          >
            <span className="micLabel">{step === 'recording' ? '끝' : '말하기'}</span>
          </button>
          {statusText(step, autoStopReady) ? <div className="status" role="status">{statusText(step, autoStopReady)}</div> : null}
          {['transcribing', 'thinking', 'speaking'].includes(step) ? <div className="loader" aria-hidden="true" /> : null}
        </section>

        {error ? <div className="error">{error}</div> : null}

        <section className="panel card">
          <h2>질문</h2>
          <div className={`bubble ${transcript ? '' : 'empty'}`}>{transcript || '아직 없습니다.'}</div>
        </section>

        <section className="panel card">
          <h2>답변</h2>
          <div className={`bubble ${answer ? '' : 'empty'}`}>{answer || '답변이 여기에 표시됩니다.'}</div>
          <div className="actions">
            <button className="actionButton" onClick={() => void speak(answer)} disabled={!answer || step === 'recording'}>다시 듣기</button>
            <button className="actionButton secondary" onClick={() => { setTranscript(''); setAnswer(''); setError(''); window.speechSynthesis?.cancel(); audioRef.current?.pause(); setStep('idle'); }}>초기화</button>
          </div>
        </section>

        {history.length > 0 ? (
          <details className="history card">
            <summary>최근 대화</summary>
            <div className="historyList">
              {history.slice(0, 5).map((item) => (
                <button key={item.at} className="historyItem" onClick={() => { setTranscript(item.question); setAnswer(item.answer); void speak(item.answer); }}>
                  <strong>{item.question}</strong>
                  <span>{item.answer}</span>
                </button>
              ))}
            </div>
            <button className="clearHistory" onClick={clearHistory}>기록 지우기</button>
          </details>
        ) : null}
      </section>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
