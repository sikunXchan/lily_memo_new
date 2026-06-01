'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, X, Camera, CameraOff, BookOpen, Coffee } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
const FOCUS_SECS = 25 * 60;
const BREAK_SECS = 5 * 60;
const MAX_ROUNDS_DISPLAY = 8;

const STUDY_FRAMES = [
  '/sikun-book-open.png',
  '/sikun-book-read.png',
  '/sikun-book-read.png',
  '/sikun-book-hand.png',
  '/sikun-book-read.png',
  '/sikun-book-hand.png',
  '/sikun-book-read.png',
  '/sikun-book-read.png',
];
const FRAME_MS = 1400;

// ── Audio helpers ─────────────────────────────────────────────────────────────
function playTone(freq: number, dur: number, vol = 0.25) {
  try {
    const AudioCtx = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch { /* ignore */ }
}
function playChime() {
  playTone(660, 0.4); setTimeout(() => playTone(880, 0.5), 350);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ResultScreen({ totalSecs, rounds, onClose }: { totalSecs: number; rounds: number; onClose: () => void }) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const label = totalSecs === 0 ? '0分' : h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`;
  const msg = totalSecs >= 3600 ? 'すごい！長時間集中できたね🔥' : totalSecs >= 1500 ? 'よく頑張りました！✨' : 'お疲れ様！少し休もう☕';

  return (
    <div className="fm-outer">
      <div className="fm-screen result-screen">
        <div className="rs-char">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sikun-character.png" alt="" className="rs-char-img" />
        </div>
        <div className="rs-content">
          <div className="rs-badge">📊 学習記録</div>
          <div className="rs-time">{label}</div>
          <p className="rs-msg">{msg}</p>
          <div className="rs-stats">
            <div className="rs-stat">
              <span className="rs-stat-val">{rounds}</span>
              <span className="rs-stat-lbl">ポモドーロ</span>
            </div>
            <div className="rs-stat">
              <span className="rs-stat-val">{h > 0 ? `${h}h` : `${m}m`}</span>
              <span className="rs-stat-lbl">集中時間</span>
            </div>
          </div>
          <button className="rs-close-btn" onClick={onClose}>閉じる</button>
        </div>
      </div>
      <style jsx>{`
        .fm-outer { position:fixed; inset:0; z-index:9500; background:#0f172a; }
        .fm-screen {
          position:absolute; inset:0;
          display:flex; align-items:center; justify-content:center;
          gap:40px; padding:32px;
        }
        @media (orientation:portrait) {
          .fm-screen {
            width:100svh; height:100svw;
            top:calc((100svh - 100svw) / 2);
            left:calc((100svw - 100svh) / 2);
            transform:rotate(90deg);
            transform-origin:center;
          }
        }
        .rs-char { flex-shrink:0; }
        .rs-char-img {
          width:clamp(120px,28vw,220px); height:auto;
          filter:drop-shadow(0 8px 24px rgba(99,102,241,0.5));
          animation:rsCharIn 0.65s cubic-bezier(.22,1.5,.5,1) both;
        }
        @keyframes rsCharIn { from{transform:scale(0.7) translateY(20px);opacity:0} to{transform:scale(1) translateY(0);opacity:1} }
        .rs-content {
          display:flex; flex-direction:column; align-items:flex-start; gap:14px;
          color:#e2e8f0;
        }
        .rs-badge {
          background:rgba(99,102,241,.18); border:1px solid rgba(99,102,241,.45);
          color:#a5b4fc; padding:4px 14px; border-radius:99px; font-size:.82rem; font-weight:700;
        }
        .rs-time {
          font-size:clamp(2.6rem,6.5vw,4.2rem); font-weight:800; line-height:1;
          background:linear-gradient(135deg,#a5b4fc,#6ee7b7);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
        }
        .rs-msg { font-size:.9rem; color:rgba(255,255,255,.6); margin:0; }
        .rs-stats { display:flex; gap:18px; }
        .rs-stat {
          display:flex; flex-direction:column; align-items:center;
          background:rgba(255,255,255,.06); padding:12px 20px;
          border-radius:12px; border:1px solid rgba(255,255,255,.1);
          gap:4px;
        }
        .rs-stat-val { font-size:1.5rem; font-weight:800; color:#a5b4fc; }
        .rs-stat-lbl { font-size:.7rem; color:rgba(255,255,255,.5); font-weight:600; }
        .rs-close-btn {
          padding:12px 36px; background:#6366f1; color:#fff;
          border:none; border-radius:50px; font-size:1rem; font-weight:700;
          cursor:pointer; transition:all .2s; margin-top:8px;
        }
        .rs-close-btn:hover { transform:scale(1.04); box-shadow:0 4px 24px rgba(99,102,241,.5); }
      `}</style>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface FocusModeProps { onClose: () => void }

export default function FocusMode({ onClose }: FocusModeProps) {
  const [phase, setPhase] = useState<'focus' | 'break'>('focus');
  const [remaining, setRemaining] = useState(FOCUS_SECS);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(1);
  const [doneRounds, setDoneRounds] = useState(0);
  const [totalFocusSecs, setTotalFocusSecs] = useState(0);
  const [charFrame, setCharFrame] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [camActive, setCamActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const accFocusRef = useRef(0);
  const phaseRef = useRef(phase);
  const remainingRef = useRef(remaining);
  phaseRef.current = phase;
  remainingRef.current = remaining;

  // Lock landscape orientation (best-effort; CSS fallback handles the rest)
  useEffect(() => {
    (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
    return () => { (screen.orientation as unknown as { unlock?: () => void })?.unlock?.(); };
  }, []);

  // Preload character images
  useEffect(() => {
    [...STUDY_FRAMES, '/sikun-character.png'].forEach(src => {
      const img = new Image(); img.src = src;
    });
  }, []);

  // Character frame animation (study phase only)
  useEffect(() => {
    if (phase !== 'focus' || !running) { setCharFrame(0); return; }
    const id = setInterval(() => setCharFrame(f => (f + 1) % STUDY_FRAMES.length), FRAME_MS);
    return () => clearInterval(id);
  }, [phase, running]);

  // Timer countdown
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          playChime();
          if (phaseRef.current === 'focus') {
            accFocusRef.current += FOCUS_SECS;
            setTotalFocusSecs(accFocusRef.current);
            setDoneRounds(d => d + 1);
            setPhase('break');
            return BREAK_SECS;
          } else {
            setPhase('focus');
            setRound(n => n + 1);
            return FOCUS_SECS;
          }
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // Camera helpers
  const startCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 160 } } });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      setCamActive(true);
    } catch { /* permission denied or not available */ }
  };
  const stopCam = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamActive(false);
  };

  // Cleanup on unmount
  useEffect(() => () => {
    stopCam();
    (screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
  }, []);

  const handleEnd = () => {
    // Credit partial current focus session
    if (phase === 'focus') {
      const elapsed = FOCUS_SECS - remainingRef.current;
      if (elapsed > 0) {
        accFocusRef.current += elapsed;
        setTotalFocusSecs(accFocusRef.current);
      }
    }
    setRunning(false);
    stopCam();
    setShowResult(true);
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const liveFocusSecs = totalFocusSecs + (running && phase === 'focus' ? FOCUS_SECS - remaining : 0);
  const liveFmtH = Math.floor(liveFocusSecs / 3600);
  const liveFmtM = Math.floor((liveFocusSecs % 3600) / 60);
  const liveLabel = liveFocusSecs === 0 ? '0m'
    : liveFmtH > 0 ? `${liveFmtH}h${liveFmtM > 0 ? liveFmtM + 'm' : ''}`
    : `${liveFmtM}m`;

  const charSrc = phase === 'focus' ? STUDY_FRAMES[charFrame] : '/sikun-character.png';
  const isFirstStart = !running && remaining === (phase === 'focus' ? FOCUS_SECS : BREAK_SECS);

  if (showResult) {
    return <ResultScreen totalSecs={totalFocusSecs} rounds={doneRounds} onClose={onClose} />;
  }

  return (
    <div className="fm-outer">
      <div className="fm-screen">

        {/* ── Left: Character area ── */}
        <div className="fm-char-area">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={charSrc}
            alt="キャラクター"
            className={`fm-char${phase === 'break' ? ' break' : ''}`}
          />
          <p className="fm-char-msg">
            {running && phase === 'focus' ? '一緒に頑張ろう！📖'
              : running && phase === 'break' ? 'お疲れ〜 少し休もう☕'
              : phase === 'break' ? '休憩の準備ができたよ'
              : 'さあ、始めよう！'}
          </p>
          {/* Subtle study desk glow */}
          <div className="fm-char-glow" />
        </div>

        {/* ── Right: Timer & controls ── */}
        <div className="fm-right">
          {/* Phase badge */}
          <div className={`fm-phase-badge ${phase}`}>
            {phase === 'focus'
              ? <><BookOpen size={13} />集中タイム — ラウンド {round}</>
              : <><Coffee size={13} />休憩タイム</>}
          </div>

          {/* Big timer */}
          <div className={`fm-timer ${phase}`}>{fmt(remaining)}</div>

          {/* Progress bar */}
          <div className="fm-progress-track">
            <div
              className={`fm-progress-fill ${phase}`}
              style={{
                width: `${((phase === 'focus' ? FOCUS_SECS : BREAK_SECS) - remaining)
                  / (phase === 'focus' ? FOCUS_SECS : BREAK_SECS) * 100}%`
              }}
            />
          </div>

          {/* Round dots */}
          <div className="fm-rounds">
            {Array.from({ length: Math.min(doneRounds + 1, MAX_ROUNDS_DISPLAY) }, (_, i) => (
              <span
                key={i}
                className={`fm-dot ${i < doneRounds ? 'done' : 'current'}`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="fm-controls">
            <button
              className={`fm-btn-main ${phase}`}
              onClick={() => setRunning(v => !v)}
            >
              {running ? <Pause size={18} /> : <Play size={18} />}
              {running ? '一時停止' : isFirstStart ? 'スタート！' : '再開'}
            </button>
            <button className="fm-btn-end" onClick={handleEnd}>
              <X size={15} />終了
            </button>
          </div>

          {/* Stats */}
          <div className="fm-stats-row">
            <span className="fm-stat">累計: {liveLabel}</span>
            <span className="fm-stat">{doneRounds} ポモドーロ完了</span>
          </div>

          {/* Camera toggle */}
          <button className="fm-cam-toggle" onClick={() => camActive ? stopCam() : startCam()}>
            {camActive ? <CameraOff size={12} /> : <Camera size={12} />}
            {camActive ? 'カメラOFF' : '集中確認カメラ'}
          </button>
        </div>

        {/* Camera preview (small, top-right) */}
        {camActive && (
          <div className="fm-cam-box">
            <video ref={videoRef} autoPlay muted playsInline className="fm-cam-video" />
            <div className="fm-cam-lbl">集中確認中 👀</div>
          </div>
        )}

      </div>

      <style jsx>{`
        /* ── Outer (full viewport, always visible) ── */
        .fm-outer {
          position: fixed;
          inset: 0;
          z-index: 9500;
          background: #0f172a;
          overflow: hidden;
        }

        /* ── Screen (landscape-sized, rotated when portrait) ── */
        .fm-screen {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: stretch;
          overflow: hidden;
        }

        /* Force landscape layout when the device is held in portrait */
        @media (orientation: portrait) {
          .fm-screen {
            width: 100svh;
            height: 100svw;
            top: calc((100svh - 100svw) / 2);
            left: calc((100svw - 100svh) / 2);
            transform: rotate(90deg);
            transform-origin: center;
          }
        }

        /* ── Character area (left 42%) ── */
        .fm-char-area {
          width: 42%;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 20px 16px 32px;
          overflow: hidden;
          background: radial-gradient(ellipse 80% 70% at 50% 80%, rgba(30,58,138,.45) 0%, transparent 70%);
        }

        .fm-char-glow {
          position: absolute;
          bottom: 0;
          width: 80%;
          height: 60px;
          background: radial-gradient(ellipse, rgba(99,102,241,.35) 0%, transparent 70%);
          pointer-events: none;
        }

        .fm-char {
          width: clamp(140px, 52%, 280px);
          height: auto;
          object-fit: contain;
          position: relative;
          z-index: 1;
          filter: drop-shadow(0 12px 32px rgba(99,102,241,.45));
          transition: filter .4s;
        }
        .fm-char.break {
          animation: breathe 3.5s ease-in-out infinite;
          filter: drop-shadow(0 12px 28px rgba(16,185,129,.45));
        }
        @keyframes breathe {
          0%,100% { transform: scale(1) translateY(0); }
          50% { transform: scale(1.035) translateY(-5px); }
        }

        .fm-char-msg {
          margin: 10px 0 0;
          font-size: .82rem;
          color: rgba(255,255,255,.65);
          font-weight: 600;
          text-align: center;
          z-index: 1;
          position: relative;
        }

        /* ── Right panel ── */
        .fm-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px 28px;
          gap: 14px;
          background: linear-gradient(160deg, rgba(15,23,42,0) 0%, rgba(30,27,75,.3) 100%);
        }

        /* Phase badge */
        .fm-phase-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 16px;
          border-radius: 99px;
          font-size: .82rem;
          font-weight: 700;
          background: rgba(255,255,255,.07);
          color: rgba(255,255,255,.7);
          border: 1px solid rgba(255,255,255,.12);
          letter-spacing: .04em;
        }
        .fm-phase-badge.break {
          background: rgba(16,185,129,.12);
          color: #6ee7b7;
          border-color: rgba(16,185,129,.3);
        }

        /* Big timer */
        .fm-timer {
          font-size: clamp(3.2rem, 9vw, 5.5rem);
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          letter-spacing: .04em;
          line-height: 1;
          color: #e2e8f0;
          text-shadow: 0 0 40px rgba(99,102,241,.45);
        }
        .fm-timer.break {
          color: #6ee7b7;
          text-shadow: 0 0 40px rgba(16,185,129,.45);
        }

        /* Progress bar */
        .fm-progress-track {
          width: 100%;
          max-width: 280px;
          height: 4px;
          background: rgba(255,255,255,.1);
          border-radius: 99px;
          overflow: hidden;
        }
        .fm-progress-fill {
          height: 100%;
          border-radius: 99px;
          background: #6366f1;
          transition: width .8s linear;
        }
        .fm-progress-fill.break { background: #10b981; }

        /* Round dots */
        .fm-rounds {
          display: flex;
          gap: 7px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
          max-width: 240px;
        }
        .fm-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: block;
          background: rgba(255,255,255,.18);
          border: 2px solid rgba(255,255,255,.25);
        }
        .fm-dot.done {
          background: #6366f1;
          border-color: #6366f1;
          box-shadow: 0 0 8px rgba(99,102,241,.65);
        }
        .fm-dot.current {
          background: rgba(255,255,255,.25);
          border-color: rgba(255,255,255,.6);
          animation: dotPulse 1.8s ease-in-out infinite;
        }
        @keyframes dotPulse {
          0%,100% { transform:scale(1); opacity:1; }
          50% { transform:scale(1.35); opacity:.65; }
        }

        /* Controls */
        .fm-controls {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .fm-btn-main {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 28px;
          border-radius: 50px;
          font-size: .95rem;
          font-weight: 700;
          cursor: pointer;
          background: #6366f1;
          color: #fff;
          border: none;
          transition: transform .15s, box-shadow .15s;
        }
        .fm-btn-main:hover { transform: scale(1.04); box-shadow: 0 4px 20px rgba(99,102,241,.5); }
        .fm-btn-main:active { transform: scale(.97); }
        .fm-btn-main.break { background: #059669; }
        .fm-btn-main.break:hover { box-shadow: 0 4px 20px rgba(5,150,105,.5); }

        .fm-btn-end {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 10px 18px;
          border-radius: 50px;
          font-size: .85rem;
          font-weight: 700;
          cursor: pointer;
          background: rgba(255,255,255,.07);
          color: rgba(255,255,255,.65);
          border: 1px solid rgba(255,255,255,.18);
          transition: all .15s;
        }
        .fm-btn-end:hover { background: rgba(255,255,255,.14); color: #fff; }

        /* Stats */
        .fm-stats-row {
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
        }
        .fm-stat {
          font-size: .73rem;
          color: rgba(255,255,255,.45);
          font-weight: 600;
        }

        /* Camera toggle button */
        .fm-cam-toggle {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 13px;
          border-radius: 20px;
          font-size: .68rem;
          font-weight: 600;
          cursor: pointer;
          background: rgba(255,255,255,.04);
          color: rgba(255,255,255,.38);
          border: 1px solid rgba(255,255,255,.12);
          transition: all .15s;
        }
        .fm-cam-toggle:hover { background: rgba(255,255,255,.1); color: rgba(255,255,255,.75); }

        /* Camera preview */
        .fm-cam-box {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 90px;
          border-radius: 10px;
          overflow: hidden;
          border: 2px solid rgba(99,102,241,.5);
          background: #000;
          z-index: 5;
        }
        .fm-cam-video {
          width: 100%;
          display: block;
          transform: scaleX(-1);
        }
        .fm-cam-lbl {
          font-size: .58rem;
          color: rgba(255,255,255,.6);
          text-align: center;
          padding: 2px 4px;
          background: rgba(0,0,0,.75);
        }

      `}</style>
    </div>
  );
}
