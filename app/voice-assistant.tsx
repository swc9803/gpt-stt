'use client';

import { useEffect, useRef, useState } from 'react';

type Step = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

function statusText(step: Step) {
  switch (step) {
    case 'recording': return '듣는 중입니다. 말씀을 마치셨으면 버튼을 한 번 더 눌러 주세요.';
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
    } catch {
      setError('마이크 권한이 필요합니다. 브라우저 주소창 설정에서 마이크를 허용해 주세요.');
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
      if (audio.size < 1024) throw new Error('녹음이 너무 짧습니다. 버튼을 누르고 조금 더 길게 말씀해 주세요.');

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
      speak(chat.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리 중 문제가 발생했습니다.');
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
          {statusText(step) ? <div className="status" role="status">{statusText(step)}</div> : null}
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
            <button className="actionButton" onClick={() => speak(answer)} disabled={!answer || step === 'recording'}>다시 듣기</button>
            <button className="actionButton secondary" onClick={() => { setTranscript(''); setAnswer(''); setError(''); window.speechSynthesis?.cancel(); setStep('idle'); }}>초기화</button>
          </div>
        </section>
      </section>
    </main>
  );
}
