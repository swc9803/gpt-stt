'use client';

import { useEffect, useRef, useState } from 'react';

type Step = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

function statusText(step: Step) {
  switch (step) {
    case 'recording': return '듣는 중이야. 다 말했으면 버튼을 한 번 더 눌러.';
    case 'transcribing': return '말한 내용을 글자로 바꾸는 중.';
    case 'thinking': return '답변 생각 중.';
    case 'speaking': return '읽어주는 중.';
    default: return '큰 버튼을 누르고 말하면 돼.';
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || '요청 처리에 실패했어.');
  return data as T;
}

export default function VoiceAssistant() {
  const [step, setStep] = useState<Step>('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      window.speechSynthesis?.cancel();
    };
  }, []);

  function speak(text: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.onend = () => setStep('idle');
    utterance.onerror = () => setStep('idle');
    setStep('speaking');
    window.speechSynthesis.speak(utterance);
  }

  async function startRecording() {
    setError('');
    setTranscript('');
    setAnswer('');
    window.speechSynthesis?.cancel();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저는 녹음을 지원하지 않아. Chrome이나 Safari 최신 버전으로 열어봐.');
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
    } catch {
      setError('마이크 권한이 필요해. 브라우저 주소창 설정에서 마이크를 허용해줘.');
      setStep('idle');
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }

  async function handleRecordingStopped(mimeType: string) {
    setStep('transcribing');
    try {
      const audio = new Blob(chunksRef.current, { type: mimeType });
      if (audio.size < 1024) throw new Error('녹음이 너무 짧아. 버튼을 누르고 조금 더 길게 말해봐.');

      const form = new FormData();
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      form.append('audio', audio, `voice.${ext}`);

      const transcribeResponse = await fetch('/api/transcribe', { method: 'POST', body: form });
      const transcribeData = await transcribeResponse.json().catch(() => ({}));
      if (!transcribeResponse.ok) throw new Error(transcribeData?.error || '음성 인식에 실패했어.');

      const text = String(transcribeData.text || '').trim();
      if (!text) throw new Error('말소리를 인식하지 못했어. 다시 한 번 또렷하게 말해줘.');
      setTranscript(text);

      setStep('thinking');
      const chat = await postJson<{ answer: string }>('/api/chat', { message: text });
      setAnswer(chat.answer);
      speak(chat.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리 중 문제가 생겼어.');
      setStep('idle');
    } finally {
      recorderRef.current = null;
      chunksRef.current = [];
      streamRef.current = null;
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
          <h1>GPT 음성비서</h1>
          <p>누르고 말하면, 쉽게 답하고 읽어줘.</p>
        </header>

        <section className="card">
          <button
            className={`micButton ${step === 'recording' ? 'recording' : ''}`}
            onClick={onMainButtonClick}
            disabled={!['idle', 'recording'].includes(step)}
            aria-label={step === 'recording' ? '말하기 끝내기' : '말하기 시작'}
          >
            <span className="micIcon" aria-hidden="true">🎙️</span>
            <span className="micLabel">{step === 'recording' ? '끝' : '말하기'}</span>
            <span className="micHint">{step === 'recording' ? '한 번 더 누르기' : '크게 누르기'}</span>
          </button>
          <div className="status" role="status">{statusText(step)}</div>
        </section>

        {error ? <div className="error">{error}</div> : null}

        <section className="panel card">
          <h2>내가 말한 내용</h2>
          <div className={`bubble ${transcript ? '' : 'empty'}`}>{transcript || '아직 없어.'}</div>
        </section>

        <section className="panel card">
          <h2>답변</h2>
          <div className={`bubble ${answer ? '' : 'empty'}`}>{answer || '답변이 여기에 나와.'}</div>
          <div className="actions">
            <button className="actionButton" onClick={() => speak(answer)} disabled={!answer || step === 'recording'}>다시 듣기</button>
            <button className="actionButton secondary" onClick={() => { setTranscript(''); setAnswer(''); setError(''); window.speechSynthesis?.cancel(); setStep('idle'); }}>초기화</button>
          </div>
        </section>

        <footer className="footer">
          부모님용으로 짧고 쉽게 답하도록 설정돼 있어. 의료, 금융, 법률 결정은 가족이나 전문가에게 다시 확인해야 해.
        </footer>
      </section>
    </main>
  );
}
