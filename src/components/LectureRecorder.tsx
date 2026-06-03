'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Mic, Square, Pause, Play, GraduationCap, ChevronDown, ChevronUp } from 'lucide-react';
import { callGeminiChat } from '@/lib/gemini';
import type { ChatTurn } from '@/lib/gemini';
import { pickAudioMime, transcribeAudioBlob, isNoSpeech } from '@/lib/audioTranscribe';

interface LectureRecorderProps {
  apiKey: string;
  onClose: () => void;
  onComplete: (summary: string) => void;
}

type Phase = 'idle' | 'recording' | 'paused' | 'finalizing' | 'done';

interface Chunk {
  id: string;
  raw: string;
  clean: string;
  state: 'pending' | 'cleaning' | 'done' | 'error';
  label: string;
}

const CHUNK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes — when a chunk is sent for Gemini cleanup
const TRANSCRIBE_INTERVAL_MS = 40 * 1000; // 40 seconds — how often we rotate + transcribe audio

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function LectureRecorder({ apiKey, onClose, onComplete }: LectureRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [liveText, setLiveText] = useState('');
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [chunkElapsed, setChunkElapsed] = useState(0);
  const [finalSummary, setFinalSummary] = useState('');
  const [error, setError] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  // Refs so callbacks always see latest values
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const finishingRef = useRef(false);
  const pendingTranscriptionsRef = useRef<Promise<void>[]>([]);
  const startSegmentRecorderRef = useRef<() => void>(() => {});

  const chunkBufferRef = useRef('');
  const accumulatedRef = useRef('');
  const chunksRef = useRef<Chunk[]>([]);
  const phaseRef = useRef<Phase>('idle');
  const baseElapsedRef = useRef(0);
  const sessionStartRef = useRef(0);
  const chunkBaseElapsedRef = useRef(0);
  const chunkSessionStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const liveScrollRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync with state
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  const cleanChunk = useCallback(async (chunkId: string, raw: string) => {
    setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, state: 'cleaning' } : c));
    chunksRef.current = chunksRef.current.map(c => c.id === chunkId ? { ...c, state: 'cleaning' } : c);
    try {
      const prompt = `以下は授業の音声認識の生テキストです。誤認識を修正し、句読点を追加して、自然な日本語の文章に整形してください。内容は変えないでください。\n\n${raw}`;
      const history: ChatTurn[] = [{ role: 'user', text: prompt }];
      const clean = await callGeminiChat(history, '', apiKey, {
        models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
        maxOutputTokens: 8192,
      });
      setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, clean, state: 'done' } : c));
      chunksRef.current = chunksRef.current.map(c => c.id === chunkId ? { ...c, clean, state: 'done' } : c);
    } catch {
      setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, state: 'error' } : c));
      chunksRef.current = chunksRef.current.map(c => c.id === chunkId ? { ...c, state: 'error' } : c);
    }
  }, [apiKey]);

  const flushChunk = useCallback(() => {
    const raw = chunkBufferRef.current.trim();
    if (!raw) return;
    chunkBufferRef.current = '';

    const now = Date.now();
    const totalElapsed = baseElapsedRef.current + (now - sessionStartRef.current);
    const chunkNum = chunksRef.current.length + 1;
    const chunkEnd = formatDuration(totalElapsed);
    const chunkStart = formatDuration(
      Math.max(0, totalElapsed - (chunkBaseElapsedRef.current + (now - chunkSessionStartRef.current)))
    );
    const label = `チャンク${chunkNum} (${chunkStart}〜${chunkEnd})`;
    const id = crypto.randomUUID();
    const newChunk: Chunk = { id, raw, clean: '', state: 'pending', label };

    setChunks(prev => [...prev, newChunk]);
    chunksRef.current = [...chunksRef.current, newChunk];

    // Reset chunk timer
    chunkBaseElapsedRef.current = 0;
    chunkSessionStartRef.current = now;
    setChunkElapsed(0);

    void cleanChunk(id, raw);
  }, [cleanChunk]);

  // Transcribe one recorded audio segment with Gemini and append it to the transcript.
  const transcribeSegment = useCallback(async (blob: Blob) => {
    try {
      const text = await transcribeAudioBlob(blob, apiKey);
      if (isNoSpeech(text)) return;
      accumulatedRef.current += text + ' ';
      chunkBufferRef.current += text + ' ';
      setLiveText(accumulatedRef.current);
    } catch {
      /* ignore a single failed segment — keep recording */
    }
  }, [apiKey]);

  // Start a fresh MediaRecorder segment. On stop it transcribes the audio and,
  // unless we're pausing/finishing, immediately rolls over into the next segment.
  const startSegmentRecorder = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const mime = pickAudioMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      rec = new MediaRecorder(stream);
    }
    recChunksRef.current = [];
    rec.ondataavailable = e => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blobs = recChunksRef.current;
      recChunksRef.current = [];
      if (blobs.length > 0) {
        const blob = new Blob(blobs, { type: blobs[0].type || 'audio/webm' });
        pendingTranscriptionsRef.current.push(transcribeSegment(blob));
      }
      if (!finishingRef.current && phaseRef.current === 'recording') {
        startSegmentRecorderRef.current();
      }
    };
    recorderRef.current = rec;
    try { rec.start(); } catch { /* ignore */ }
  }, [transcribeSegment]);

  useEffect(() => { startSegmentRecorderRef.current = startSegmentRecorder; }, [startSegmentRecorder]);

  // Stop the current segment so onstop transcribes it and starts the next one.
  const rotateSegment = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* ignore */ }
    }
  }, []);

  const startIntervals = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
    if (transcribeTimerRef.current) clearInterval(transcribeTimerRef.current);

    timerRef.current = setInterval(() => {
      const e = baseElapsedRef.current + (Date.now() - sessionStartRef.current);
      elapsedRef.current = e;
      setElapsed(e);
    }, 500);

    chunkTimerRef.current = setInterval(() => {
      const ce = chunkBaseElapsedRef.current + (Date.now() - chunkSessionStartRef.current);
      setChunkElapsed(ce);
      if (ce >= CHUNK_INTERVAL_MS) {
        flushChunk();
      }
    }, 500);

    transcribeTimerRef.current = setInterval(() => {
      rotateSegment();
    }, TRANSCRIBE_INTERVAL_MS);
  }, [flushChunk, rotateSegment]);

  const stopIntervals = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    if (transcribeTimerRef.current) { clearInterval(transcribeTimerRef.current); transcribeTimerRef.current = null; }
  }, []);

  const startRecording = useCallback(async () => {
    accumulatedRef.current = '';
    chunkBufferRef.current = '';
    chunksRef.current = [];
    baseElapsedRef.current = 0;
    chunkBaseElapsedRef.current = 0;
    elapsedRef.current = 0;
    finishingRef.current = false;
    pendingTranscriptionsRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('マイクへのアクセスに失敗したよ。設定でマイクを許可してね。');
      return;
    }
    mediaStreamRef.current = stream;

    const now = Date.now();
    sessionStartRef.current = now;
    chunkSessionStartRef.current = now;

    setChunks([]);
    setLiveText('');
    setElapsed(0);
    setChunkElapsed(0);
    setError('');
    setPhase('recording');
    phaseRef.current = 'recording';

    startSegmentRecorder();
    startIntervals();
  }, [startSegmentRecorder, startIntervals]);

  const pauseRecording = useCallback(() => {
    const now = Date.now();
    baseElapsedRef.current += now - sessionStartRef.current;
    chunkBaseElapsedRef.current += now - chunkSessionStartRef.current;
    setPhase('paused');
    phaseRef.current = 'paused';
    stopIntervals();
    // Stop the recorder: onstop transcribes the partial segment and, since
    // phase is no longer 'recording', does not roll over.
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* ignore */ }
    }
  }, [stopIntervals]);

  const resumeRecording = useCallback(() => {
    const now = Date.now();
    sessionStartRef.current = now;
    chunkSessionStartRef.current = now;
    setPhase('recording');
    phaseRef.current = 'recording';
    startSegmentRecorder();
    startIntervals();
  }, [startSegmentRecorder, startIntervals]);

  const stopRecording = useCallback(async () => {
    finishingRef.current = true;
    stopIntervals();
    if (phaseRef.current === 'recording') {
      baseElapsedRef.current += Date.now() - sessionStartRef.current;
    }
    setPhase('finalizing');
    phaseRef.current = 'finalizing';

    // Stop the active recorder and wait for its onstop (which queues the final transcription)
    await new Promise<void>(resolve => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') { resolve(); return; }
      rec.addEventListener('stop', () => resolve(), { once: true });
      try { rec.stop(); } catch { resolve(); }
    });

    // Release the microphone
    mediaStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
    mediaStreamRef.current = null;

    // Wait for all in-flight transcriptions to land in the buffer
    await Promise.allSettled(pendingTranscriptionsRef.current);
    pendingTranscriptionsRef.current = [];

    flushChunk();

    // Wait up to 60s for all chunk cleanups to complete
    for (let i = 0; i < 30; i++) {
      const pending = chunksRef.current.filter(c => c.state === 'pending' || c.state === 'cleaning');
      if (pending.length === 0) break;
      await new Promise(r => setTimeout(r, 2000));
    }

    const allText = chunksRef.current
      .map((c, i) => `【第${i + 1}チャンク】\n${c.clean || c.raw}`)
      .join('\n\n---\n\n');

    if (!allText.trim()) {
      setError('文字起こしがありませんでした。もう一度試してね。');
      setPhase('idle');
      phaseRef.current = 'idle';
      return;
    }

    const totalMin = Math.round(elapsedRef.current / 60000);
    const summaryPrompt = `以下は${totalMin > 0 ? `約${totalMin}分` : ''}の授業の文字起こしです。以下の順で日本語で出力してください。

## 授業まとめ（コーネルノート形式）

**キーポイント（重要な概念・事実・主張を箇条書き）**
- （ここに重要ポイントを列挙）

**詳細メモ（各ポイントの補足・説明）**
（ここに詳細）

**サマリー（授業全体を3〜5文でまとめ）**
（ここにサマリー）

## 重要用語・概念

（用語とその説明を箇条書き）

## テスト対策問題

\`\`\`qa
Q1: （問題文）
A1: （答え）
Q2: （問題文）
A2: （答え）
Q3: （問題文）
A3: （答え）
Q4: （問題文）
A4: （答え）
Q5: （問題文）
A5: （答え）
Q6: （問題文）
A6: （答え）
Q7: （問題文）
A7: （答え）
Q8: （問題文）
A8: （答え）
Q9: （問題文）
A9: （答え）
Q10: （問題文）
A10: （答え）
\`\`\`

---

【授業の文字起こし】
${allText}`;

    try {
      const history: ChatTurn[] = [{ role: 'user', text: summaryPrompt }];
      const summary = await callGeminiChat(history, '', apiKey, {
        models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
        maxOutputTokens: 65536,
      });
      setFinalSummary(summary);
      setPhase('done');
    } catch (e) {
      setError(`まとめの生成に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
      setPhase('idle');
    }
  }, [stopIntervals, flushChunk, apiKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      finishingRef.current = true;
      try {
        const rec = recorderRef.current;
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch { /* ignore */ }
      mediaStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
      stopIntervals();
    };
  }, [stopIntervals]);

  // Auto-scroll live transcript
  useEffect(() => {
    if (liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [liveText]);

  const chunkProgressPct = Math.min(100, (chunkElapsed / CHUNK_INTERVAL_MS) * 100);
  const isRunning = phase === 'recording';
  const isPaused = phase === 'paused';
  const isDone = phase === 'done';
  const isFinalizing = phase === 'finalizing';

  return (
    <div className="lr-overlay">
      <div className="lr-modal">
        {/* Header */}
        <div className="lr-header">
          <div className="lr-header-left">
            <GraduationCap size={18} className="lr-header-icon" />
            <span className="lr-header-title">授業リアルタイム要約</span>
          </div>
          <button className="lr-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Timer */}
        <div className="lr-timer-area">
          <div className={`lr-timer${isRunning ? ' lr-timer--running' : ''}`}>
            {formatDuration(elapsed)}
          </div>
          {(isRunning || isPaused) && (
            <div className="lr-phase-label">
              {isRunning ? (
                <><span className="lr-rec-dot" />録音中</>
              ) : (
                <><span className="lr-pause-dot" />一時停止</>
              )}
            </div>
          )}
        </div>

        {/* Chunk progress bar */}
        {isRunning && (
          <div className="lr-chunk-area">
            <div className="lr-chunk-label">
              次のチャンクまで {formatDuration(Math.max(0, CHUNK_INTERVAL_MS - chunkElapsed))}
            </div>
            <div className="lr-chunk-bar">
              <div className="lr-chunk-fill" style={{ width: `${chunkProgressPct}%` }} />
            </div>
          </div>
        )}

        {/* Chunk pills */}
        {chunks.length > 0 && !isDone && (
          <div className="lr-chunks-row">
            {chunks.map((c, i) => (
              <span key={c.id} className={`lr-chunk-pill lr-chunk-pill--${c.state}`}>
                {c.state === 'cleaning' ? '🔄' : c.state === 'done' ? '✅' : c.state === 'error' ? '❌' : '⏳'}
                {' '}チャンク{i + 1}
              </span>
            ))}
          </div>
        )}

        {/* Live transcript */}
        {(isRunning || isPaused) && liveText && (
          <div className="lr-transcript-section">
            <button
              className="lr-transcript-toggle"
              onClick={() => setTranscriptOpen(o => !o)}
            >
              📝 文字起こし {transcriptOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {transcriptOpen && (
              <div className="lr-live-text" ref={liveScrollRef}>
                {liveText || '音声を待っています…'}
              </div>
            )}
          </div>
        )}
        {(isRunning || isPaused) && !liveText && (
          <div className="lr-waiting">
            <div className="lr-mic-pulse"><Mic size={28} /></div>
            <p className="lr-waiting-text">授業が始まったら話してください</p>
            <p className="lr-waiting-sub">マイク音声を Gemini が高精度で文字起こしします（数十秒ごとに反映）</p>
          </div>
        )}

        {/* Finalizing */}
        {isFinalizing && (
          <div className="lr-finalizing">
            <div className="lr-spinner" />
            <span className="lr-finalizing-text">授業をまとめています…</span>
            <span className="lr-finalizing-sub">Gemini が分析中（数十秒かかります）</span>
          </div>
        )}

        {/* Done */}
        {isDone && finalSummary && (
          <div className="lr-done">
            <div className="lr-done-badge">✅ まとめ完了</div>
            <div className="lr-done-preview">
              <pre className="lr-done-text">{finalSummary.slice(0, 500)}{finalSummary.length > 500 ? '\n\n…（チャットで全文表示）' : ''}</pre>
            </div>
            <button className="lr-send-btn" onClick={() => onComplete(finalSummary)}>
              🎉 チャットに送る
            </button>
          </div>
        )}

        {/* Idle: instructions */}
        {phase === 'idle' && !error && (
          <div className="lr-idle-info">
            <ul className="lr-info-list">
              <li>🎤 マイク音声を Gemini が高精度でリアルタイム文字起こし</li>
              <li>⏱️ 10分ごとに自動でチャンクを Gemini が整形</li>
              <li>📖 終了後に授業まとめ＋重要用語＋テスト問題を生成</li>
              <li>💡 約50分の授業で Gemini 使用料 ≈ ¥10 前後</li>
            </ul>
          </div>
        )}

        {error && <div className="lr-error">{error}</div>}

        {/* Controls */}
        {!isDone && (
          <div className="lr-controls">
            {phase === 'idle' && (
              <button className="lr-btn lr-btn--start" onClick={() => void startRecording()}>
                <Mic size={20} />
                録音開始
              </button>
            )}
            {isRunning && (
              <>
                <button className="lr-btn lr-btn--pause" onClick={pauseRecording}>
                  <Pause size={20} />
                  一時停止
                </button>
                <button className="lr-btn lr-btn--stop" onClick={() => void stopRecording()}>
                  <Square size={20} />
                  終了・まとめ
                </button>
              </>
            )}
            {isPaused && (
              <>
                <button className="lr-btn lr-btn--start" onClick={resumeRecording}>
                  <Play size={20} />
                  再開
                </button>
                <button className="lr-btn lr-btn--stop" onClick={() => void stopRecording()}>
                  <Square size={20} />
                  終了・まとめ
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .lr-overlay {
          position: fixed; inset: 0; z-index: 6000;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex; align-items: flex-end; justify-content: center;
          padding-bottom: env(safe-area-inset-bottom);
          animation: lr-fade 0.2s ease;
        }
        @keyframes lr-fade { from { opacity: 0; } to { opacity: 1; } }

        .lr-modal {
          width: 100%; max-width: 600px;
          background: #0f172a;
          border-radius: 20px 20px 0 0;
          color: #e2e8f0;
          display: flex; flex-direction: column;
          max-height: 90vh; overflow: hidden;
          animation: lr-up 0.24s cubic-bezier(0.32, 0.72, 0, 1);
          box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.5);
        }
        @keyframes lr-up { from { transform: translateY(100%); } to { transform: translateY(0); } }

        .lr-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 18px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          flex-shrink: 0;
        }
        .lr-header-left {
          display: flex; align-items: center; gap: 8px;
        }
        .lr-header-icon { color: #818cf8; flex-shrink: 0; }
        .lr-header-title { font-size: 0.95rem; font-weight: 700; color: #e2e8f0; }
        .lr-close-btn {
          width: 30px; height: 30px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.07); border: none; border-radius: 50%;
          color: #94a3b8; cursor: pointer; flex-shrink: 0;
        }
        .lr-close-btn:hover { background: rgba(255,255,255,0.14); color: #e2e8f0; }

        .lr-timer-area {
          display: flex; align-items: center; justify-content: center;
          gap: 14px; padding: 20px 18px 8px; flex-shrink: 0;
        }
        .lr-timer {
          font-size: 2.8rem; font-weight: 800; font-variant-numeric: tabular-nums;
          color: #475569; letter-spacing: -1px;
          font-family: 'Fira Code', 'Consolas', monospace;
        }
        .lr-timer--running { color: #f8fafc; }
        .lr-phase-label {
          display: flex; align-items: center; gap: 6px;
          font-size: 0.78rem; font-weight: 600; color: #94a3b8;
        }
        .lr-rec-dot {
          width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
          animation: blink 1.2s ease-in-out infinite;
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
        .lr-pause-dot {
          width: 8px; height: 8px; border-radius: 50%; background: #f59e0b;
        }

        .lr-chunk-area {
          padding: 0 18px 10px; flex-shrink: 0;
        }
        .lr-chunk-label {
          font-size: 0.72rem; color: #64748b; margin-bottom: 5px;
        }
        .lr-chunk-bar {
          height: 4px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;
        }
        .lr-chunk-fill {
          height: 100%; background: linear-gradient(90deg, #6366f1, #818cf8);
          border-radius: 99px; transition: width 0.5s linear;
        }

        .lr-chunks-row {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 0 18px 10px; flex-shrink: 0;
        }
        .lr-chunk-pill {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 0.72rem; font-weight: 600; padding: 3px 9px;
          border-radius: 99px; border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.05); color: #94a3b8;
        }
        .lr-chunk-pill--cleaning { color: #60a5fa; border-color: rgba(96,165,250,0.3); }
        .lr-chunk-pill--done { color: #34d399; border-color: rgba(52,211,153,0.3); }
        .lr-chunk-pill--error { color: #f87171; border-color: rgba(248,113,113,0.3); }

        .lr-transcript-section {
          flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 0 18px 8px;
        }
        .lr-transcript-toggle {
          display: flex; align-items: center; gap: 5px;
          background: transparent; border: none; color: #64748b;
          font-size: 0.75rem; cursor: pointer; margin-bottom: 6px;
          padding: 0; text-align: left;
        }
        .lr-live-text {
          flex: 1; min-height: 80px; max-height: 180px; overflow-y: auto;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 10px 12px;
          font-size: 0.82rem; line-height: 1.65; color: #cbd5e1;
          word-break: break-all; white-space: pre-wrap;
        }

        .lr-waiting {
          display: flex; flex-direction: column; align-items: center;
          gap: 8px; padding: 20px 18px; text-align: center;
        }
        .lr-mic-pulse {
          width: 64px; height: 64px; border-radius: 50%;
          background: rgba(99,102,241,0.15); border: 2px solid rgba(99,102,241,0.35);
          display: flex; align-items: center; justify-content: center; color: #818cf8;
          animation: micPulse 2s ease-in-out infinite;
        }
        @keyframes micPulse { 0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0.35)} 50%{box-shadow:0 0 0 12px rgba(99,102,241,0)} }
        .lr-waiting-text { font-size: 0.9rem; color: #e2e8f0; font-weight: 600; margin: 0; }
        .lr-waiting-sub { font-size: 0.75rem; color: #64748b; margin: 0; }

        .lr-finalizing {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; padding: 32px 18px;
        }
        .lr-spinner {
          width: 40px; height: 40px; border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.08);
          border-top-color: #6366f1;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .lr-finalizing-text { font-size: 1rem; font-weight: 700; color: #e2e8f0; }
        .lr-finalizing-sub { font-size: 0.8rem; color: #64748b; }

        .lr-done {
          flex: 1; display: flex; flex-direction: column;
          gap: 12px; padding: 16px 18px; min-height: 0; overflow: hidden;
        }
        .lr-done-badge {
          display: inline-flex; align-self: flex-start;
          background: rgba(52,211,153,0.15); border: 1px solid rgba(52,211,153,0.3);
          color: #34d399; border-radius: 99px; padding: 3px 12px; font-size: 0.78rem; font-weight: 700;
        }
        .lr-done-preview {
          flex: 1; overflow-y: auto; min-height: 0;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 12px;
        }
        .lr-done-text {
          font-size: 0.78rem; line-height: 1.6; color: #94a3b8;
          white-space: pre-wrap; word-break: break-word; margin: 0;
          font-family: inherit;
        }
        .lr-send-btn {
          flex-shrink: 0; background: linear-gradient(135deg, #6366f1, #818cf8);
          color: white; border: none; border-radius: 14px;
          padding: 14px; font-size: 1rem; font-weight: 800; cursor: pointer;
          transition: opacity 0.15s;
          box-shadow: 0 4px 16px rgba(99,102,241,0.4);
        }
        .lr-send-btn:hover { opacity: 0.88; }

        .lr-idle-info {
          padding: 12px 18px 4px; flex-shrink: 0;
        }
        .lr-info-list {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 7px;
        }
        .lr-info-list li {
          font-size: 0.82rem; color: #64748b; line-height: 1.5;
        }

        .lr-error {
          padding: 10px 18px; flex-shrink: 0;
          font-size: 0.82rem; color: #f87171;
          background: rgba(248,113,113,0.08); border-radius: 8px; margin: 0 18px;
        }

        .lr-controls {
          display: flex; gap: 10px; padding: 14px 18px;
          padding-bottom: calc(14px + env(safe-area-inset-bottom));
          border-top: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }
        .lr-btn {
          flex: 1; display: flex; align-items: center; justify-content: center;
          gap: 8px; padding: 13px 16px; border: none; border-radius: 12px;
          font-size: 0.92rem; font-weight: 700; cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .lr-btn:active { transform: scale(0.97); }
        .lr-btn--start {
          background: linear-gradient(135deg, #6366f1, #818cf8);
          color: white;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
        }
        .lr-btn--pause {
          background: rgba(245,158,11,0.15);
          border: 1.5px solid rgba(245,158,11,0.4);
          color: #fbbf24;
        }
        .lr-btn--stop {
          background: rgba(239,68,68,0.12);
          border: 1.5px solid rgba(239,68,68,0.35);
          color: #f87171;
        }
      `}</style>
    </div>
  );
}
