'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Mic, MicOff, Volume2, Send } from 'lucide-react';
import { callGeminiChat } from '@/lib/gemini';
import type { ChatTurn } from '@/lib/gemini';
import { pickAudioMime, transcribeAudioBlob, isNoSpeech } from '@/lib/audioTranscribe';
import { useT } from '@/lib/i18n';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting';

interface VoiceChatProps {
  apiKey: string;
  systemPrompt: string;
  modeLabel?: string;
  onClose: () => void;
}

// Voice activity detection tuning (RMS of the time-domain waveform, 0..1).
const SPEAK_RMS = 0.018;        // above this counts as speech
const SILENCE_RMS = 0.012;      // below this counts as silence
const SILENCE_HANG_MS = 1300;   // stop after this much trailing silence
const NO_SPEECH_TIMEOUT_MS = 8000; // give up if the user never speaks
const MAX_UTTERANCE_MS = 30000; // hard cap on a single turn

// Strip markdown symbols so TTS doesn't read them aloud
function toSpeakText(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/[_~>]/g, '')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '、')
    .trim()
    .slice(0, 600);
}

export default function VoiceChat({ apiKey, systemPrompt, modeLabel, onClose }: VoiceChatProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [userText, setUserText] = useState('');
  const [aiText, setAiText] = useState('');
  const [error, setError] = useState('');
  const [turnCount, setTurnCount] = useState(0);

  const messagesRef = useRef<ChatTurn[]>([]);
  const activeRef = useRef(false);

  // Recording state
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const spokeRef = useRef(false);
  const stoppingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audioCtxRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef(0);
  const listenStartRef = useRef(0);
  const runVadRef = useRef<() => void>(() => {});

  // startListening is defined below; store in ref so callbacks can reach it
  const startListeningRef = useRef<() => void>(() => {});

  const teardownAudio = useCallback(() => {
    if (vadRafRef.current != null) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null; }
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
    streamRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    stoppingRef.current = true;
    try {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch { /* ignore */ }
    recorderRef.current = null;
    teardownAudio();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }, [teardownAudio]);

  const handleClose = useCallback(() => {
    stopAll();
    onClose();
  }, [stopAll, onClose]);

  // Speak text via browser TTS, resolve when done.
  // On iOS Safari the audio session is suspended after any async gap (e.g.
  // after `await callGeminiChat`), so we must call synth.resume() before
  // speak() and add a short delay after cancel() to let the engine reset.
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      if (!synth) { resolve(); return; }
      synth.cancel();
      const doSpeak = () => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'ja-JP';
        utter.rate = 1.05;
        const voices = synth.getVoices();
        const jaVoice = voices.find(v => v.lang.startsWith('ja')) ?? voices.find(v => v.lang.includes('JP'));
        if (jaVoice) utter.voice = jaVoice;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        synth.resume();
        synth.speak(utter);
      };
      setTimeout(doSpeak, 80);
    });
  }, []);

  // Called once recording for a turn has stopped: transcribe + run the chat turn.
  const finishUtterance = useCallback(async () => {
    teardownAudio();
    const parts = chunksRef.current;
    chunksRef.current = [];

    if (!activeRef.current) return;

    if (!spokeRef.current || parts.length === 0) {
      setPhase('waiting');
      return;
    }

    setPhase('thinking');
    const blob = new Blob(parts, { type: parts[0]?.type || 'audio/webm' });

    let text = '';
    try {
      text = await transcribeAudioBlob(blob, apiKey);
    } catch {
      text = '';
    }

    if (!activeRef.current) return;

    if (isNoSpeech(text)) {
      setPhase('waiting');
      setUserText('');
      return;
    }

    setUserText(text);
    messagesRef.current = [...messagesRef.current, { role: 'user', text }];

    try {
      const voiceSystemPrompt =
        systemPrompt +
        '\n\n【音声対話モード】答えは音声で読み上げるので、必ず2〜3文程度の簡潔な日本語で答えてください。長文・箇条書き・マークダウンは使わないこと。';

      const response = await callGeminiChat(messagesRef.current, voiceSystemPrompt, apiKey);
      messagesRef.current = [...messagesRef.current, { role: 'model', text: response }];
      setAiText(response);
      setTurnCount(c => c + 1);
      setPhase('speaking');
      await speak(toSpeakText(response));
      if (activeRef.current) setPhase('waiting');
    } catch {
      setError(t('通信エラーが発生したよ。もう一度試してね。'));
      setPhase('waiting');
    }
  }, [apiKey, systemPrompt, speak, teardownAudio]);

  // Stop the current recording (triggers MediaRecorder.onstop -> finishUtterance)
  const stopRecording = useCallback(() => {
    if (vadRafRef.current != null) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* ignore */ }
    }
  }, []);

  // Monitor the mic level and auto-stop on trailing silence.
  const runVad = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !activeRef.current) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();

    if (rms > SPEAK_RMS) {
      spokeRef.current = true;
      lastVoiceAtRef.current = now;
    }

    const elapsed = now - listenStartRef.current;
    const silenceFor = now - lastVoiceAtRef.current;

    if (spokeRef.current && rms < SILENCE_RMS && silenceFor > SILENCE_HANG_MS) {
      stopRecording();
      return;
    }
    if (!spokeRef.current && elapsed > NO_SPEECH_TIMEOUT_MS) {
      stopRecording();
      return;
    }
    if (elapsed > MAX_UTTERANCE_MS) {
      stopRecording();
      return;
    }
    vadRafRef.current = requestAnimationFrame(() => runVadRef.current());
  }, [stopRecording]);

  useEffect(() => { runVadRef.current = runVad; }, [runVad]);

  const startListening = useCallback(async () => {
    if (!activeRef.current) return;
    setError('');
    setUserText('');
    spokeRef.current = false;
    stoppingRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t('マイクにアクセスできなかったよ。設定でマイクを許可してね。'));
      setPhase('waiting');
      return;
    }
    if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
    streamRef.current = stream;

    // Level meter for voice activity detection
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
    } catch {
      /* VAD optional — manual send still works */
    }

    const mime = pickAudioMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      rec = new MediaRecorder(stream);
    }
    recorderRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => { void finishUtterance(); };

    listenStartRef.current = Date.now();
    lastVoiceAtRef.current = Date.now();
    setPhase('listening');
    try { rec.start(); } catch { /* ignore */ }
    vadRafRef.current = requestAnimationFrame(() => runVadRef.current());
  }, [finishUtterance]);

  // Keep ref in sync so async closures always reach the latest version
  useEffect(() => { startListeningRef.current = () => { void startListening(); }; }, [startListening]);

  const handleStart = useCallback(() => {
    setError('');
    setUserText('');
    setAiText('');
    messagesRef.current = [];
    setTurnCount(0);
    activeRef.current = true;
    startListeningRef.current();
  }, []);

  const handleStop = useCallback(() => {
    stopAll();
    setPhase('idle');
  }, [stopAll]);

  // Load TTS voices early (Safari needs a warm-up call)
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    const onChanged = () => window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', onChanged);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', onChanged);
      stopAll();
    };
  }, [stopAll]);

  const phaseConfig: Record<Phase, { label: string; color: string }> = {
    idle:      { label: '',               color: 'var(--primary)' },
    listening: { label: t('聞いてるよ...'),   color: 'var(--primary)' },
    thinking:  { label: t('考え中...'),       color: '#f59e0b' },
    speaking:  { label: t('話し中...'),       color: '#10b981' },
    waiting:   { label: t('あなたの番だよ'), color: 'var(--primary)' },
  };
  const { label: phaseLabel, color: phaseColor } = phaseConfig[phase];
  const isActive = phase !== 'idle';

  return (
    <div className="vc-overlay">
      <div className="vc-container">
        {/* Header */}
        <div className="vc-header">
          <span className="vc-title">
            🎙️ {t('音声対話')}{modeLabel ? <span className="vc-mode-badge">{modeLabel}</span> : null}
          </span>
          <button className="vc-close" onClick={handleClose} title={t('閉じる')}>
            <X size={20} />
          </button>
        </div>

        {/* Main */}
        <div className="vc-main">
          {/* Animated orb */}
          <div className={`vc-orb ${phase}`}>
            {phase === 'speaking'
              ? <Volume2 size={38} className="vc-orb-icon" />
              : phase === 'thinking'
              ? <span className="vc-orb-dots"><span /><span /><span /></span>
              : <Mic size={38} className={`vc-orb-icon${phase === 'idle' ? ' idle' : ''}`} />
            }
          </div>

          <p className="vc-phase-label">{phaseLabel}</p>

          {/* Exchange bubbles */}
          {userText && (
            <div className="vc-bubble user">
              <span className="vc-bubble-who">{t('あなた')}</span>
              <p>{userText}</p>
            </div>
          )}
          {aiText && (
            <div className="vc-bubble ai">
              <span className="vc-bubble-who">Lily</span>
              <p>{aiText}</p>
            </div>
          )}

          {turnCount > 0 && !userText && !isActive && (
            <p className="vc-turn-count">{t('{n} ターン', { n: turnCount })}</p>
          )}

          {error && <p className="vc-error">{error}</p>}
        </div>

        {/* Footer */}
        <div className="vc-footer">
          {!isActive ? (
            <button className="vc-btn start" onClick={handleStart}>
              <Mic size={18} /> {t('会話を始める')}
            </button>
          ) : phase === 'listening' ? (
            <div className="vc-footer-row">
              <button className="vc-btn speak" onClick={stopRecording}>
                <Send size={18} /> {t('話し終えた（送信）')}
              </button>
              <button className="vc-btn stop icon-only" onClick={handleStop} title={t('終了')}>
                <MicOff size={18} />
              </button>
            </div>
          ) : phase === 'waiting' ? (
            <div className="vc-footer-row">
              <button className="vc-btn speak" onClick={() => startListeningRef.current()}>
                <Mic size={18} /> {t('タップして話す')}
              </button>
              <button className="vc-btn stop icon-only" onClick={handleStop} title={t('終了')}>
                <MicOff size={18} />
              </button>
            </div>
          ) : (
            <button className="vc-btn stop" onClick={handleStop}>
              <MicOff size={18} /> {t('終了')}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .vc-overlay {
          position: fixed; inset: 0; z-index: 6000;
          background: rgba(0,0,0,0.65); backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        .vc-container {
          background: var(--background); border: 1px solid var(--border);
          border-radius: 24px; width: 100%; max-width: 400px;
          display: flex; flex-direction: column; overflow: hidden; max-height: 90vh;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .vc-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .vc-title { font-weight: 800; font-size: 0.95rem; color: var(--foreground); display: flex; align-items: center; gap: 8px; }
        .vc-mode-badge { font-size: 0.72rem; font-weight: 700; background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); border-radius: 10px; padding: 2px 8px; }
        .vc-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--fg-muted); cursor: pointer; }
        .vc-close:hover { background: var(--accent); }

        .vc-main {
          flex: 1; overflow-y: auto; padding: 28px 20px 20px;
          display: flex; flex-direction: column; align-items: center; gap: 16px;
          min-height: 260px;
        }

        /* Orb */
        .vc-orb {
          width: 128px; height: 128px; border-radius: 50%;
          background: color-mix(in srgb, ${phaseColor} 12%, transparent);
          border: 2.5px solid color-mix(in srgb, ${phaseColor} 35%, transparent);
          display: flex; align-items: center; justify-content: center;
          transition: background 0.4s, border-color 0.4s;
          flex-shrink: 0;
        }
        .vc-orb.listening { animation: orb-pulse 1.6s ease-in-out infinite; }
        .vc-orb.speaking  { animation: orb-speak 0.75s ease-in-out infinite; }
        .vc-orb.thinking  { animation: orb-glow 2s linear infinite; }
        .vc-orb.waiting   { animation: orb-wait 2.4s ease-in-out infinite; }
        @keyframes orb-wait { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.05);opacity:0.7} }
        @keyframes orb-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.07)} }
        @keyframes orb-speak  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes orb-glow   {
          0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,#f59e0b 0%,transparent)}
          50%{box-shadow:0 0 0 14px color-mix(in srgb,#f59e0b 0%,transparent)}
        }
        .vc-orb-icon { color: ${phaseColor}; transition: color 0.4s; }
        .vc-orb-icon.idle { opacity: 0.5; }
        .vc-orb-dots { display: flex; gap: 6px; align-items: center; }
        .vc-orb-dots span { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; animation: dot-bounce 1.2s infinite ease-in-out; }
        .vc-orb-dots span:nth-child(2) { animation-delay: 0.2s; }
        .vc-orb-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dot-bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-7px);opacity:1} }

        .vc-phase-label { font-size: 1rem; font-weight: 700; color: var(--fg-muted); min-height: 1.4em; text-align: center; }

        .vc-bubble { width: 100%; background: var(--accent); border: 1px solid var(--border); border-radius: 12px; padding: 11px 14px; }
        .vc-bubble.user { border-color: color-mix(in srgb, var(--primary) 40%, transparent); }
        .vc-bubble-who { font-size: 0.68rem; font-weight: 800; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px; }
        .vc-bubble p { font-size: 0.87rem; line-height: 1.65; margin: 0; color: var(--foreground); }

        .vc-turn-count { font-size: 0.78rem; color: var(--fg-muted); }
        .vc-error { color: #ef4444; font-size: 0.84rem; text-align: center; line-height: 1.5; }

        .vc-footer {
          padding: 14px 20px; border-top: 1px solid var(--border);
          display: flex; justify-content: center; flex-shrink: 0;
        }
        .vc-footer-row { display: flex; align-items: center; gap: 10px; width: 100%; }
        .vc-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 30px; border-radius: 14px;
          font-size: 0.94rem; font-weight: 800; cursor: pointer; transition: opacity 0.15s;
        }
        .vc-btn.start { background: var(--primary); color: #fff; }
        .vc-btn.stop  { background: #ef4444; color: #fff; }
        .vc-btn.speak { background: var(--primary); color: #fff; flex: 1; justify-content: center; }
        .vc-btn.icon-only { padding: 12px 14px; flex-shrink: 0; }
        .vc-btn:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}
