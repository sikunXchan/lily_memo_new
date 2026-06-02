'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, X, Camera, CameraOff, BookOpen, Coffee, Volume2, VolumeX } from 'lucide-react';
import { db } from '@/lib/db';

// ── Constants ─────────────────────────────────────────────────────────────────
const FOCUS_SECS = 25 * 60;
const BREAK_SECS = 5 * 60;
const MAX_ROUNDS_DISPLAY = 8;

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

// ── Brown noise generator (Web Audio API) ─────────────────────────────────────
function createBrownNoise(vol: number): { ctx: AudioContext; stop: () => void } | null {
  try {
    const AudioCtx = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5; // amplify
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    source.connect(gain); gain.connect(ctx.destination);
    source.start();
    return { ctx, stop: () => { try { source.stop(); ctx.close(); } catch {} } };
  } catch { return null; }
}

// ── Nature canvas (animated rain) ────────────────────────────────────────────
type RainDrop = { x: number; y: number; speed: number; length: number; opacity: number };

function initRain(w: number, h: number, count = 120): RainDrop[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    speed: 4 + Math.random() * 6,
    length: 12 + Math.random() * 22,
    opacity: 0.08 + Math.random() * 0.22,
  }));
}

function drawNature(ctx: CanvasRenderingContext2D, w: number, h: number, drops: RainDrop[], t: number) {
  // Sky gradient (dark forest night)
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b1a2e');
  sky.addColorStop(0.55, '#0d2b1e');
  sky.addColorStop(1, '#071a0f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Moon glow
  const mx = w * 0.78; const my = h * 0.18;
  const moonGlow = ctx.createRadialGradient(mx, my, 0, mx, my, h * 0.28);
  moonGlow.addColorStop(0, 'rgba(200,220,255,0.13)');
  moonGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = moonGlow;
  ctx.fillRect(0, 0, w, h);

  // Moon disc
  ctx.beginPath();
  ctx.arc(mx, my, h * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(230,240,255,0.82)';
  ctx.fill();

  // Stars (twinkle with time)
  const seed = 42;
  for (let i = 0; i < 60; i++) {
    const sx = ((seed * (i * 7 + 3)) % 997 / 997) * w;
    const sy = ((seed * (i * 13 + 5)) % 991 / 991) * h * 0.55;
    const tw = Math.sin(t * 0.001 + i) * 0.5 + 0.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.8 + tw * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,215,255,${0.3 + tw * 0.55})`;
    ctx.fill();
  }

  // Forest silhouette
  const treeCount = 14;
  for (let i = 0; i < treeCount; i++) {
    const tx = (i / (treeCount - 1)) * w;
    const th = h * (0.35 + Math.sin(i * 2.3) * 0.12 + Math.cos(i * 1.7) * 0.08);
    const tw2 = w / treeCount * 0.7;
    ctx.fillStyle = '#061209';
    ctx.beginPath();
    // triangle tree
    ctx.moveTo(tx, h - h * 0.05);
    ctx.lineTo(tx - tw2 / 2, h - h * 0.05);
    ctx.lineTo(tx - tw2 * 0.1, h - h * 0.05 - th * 0.5);
    ctx.lineTo(tx - tw2 * 0.3, h - h * 0.05 - th * 0.5);
    ctx.lineTo(tx, h - h * 0.05 - th);
    ctx.lineTo(tx + tw2 * 0.3, h - h * 0.05 - th * 0.5);
    ctx.lineTo(tx + tw2 * 0.1, h - h * 0.05 - th * 0.5);
    ctx.lineTo(tx + tw2 / 2, h - h * 0.05);
    ctx.closePath();
    ctx.fill();
  }

  // Ground
  ctx.fillStyle = '#050e07';
  ctx.fillRect(0, h * 0.95, w, h * 0.05);

  // Rain drops
  ctx.lineCap = 'round';
  for (const d of drops) {
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 1, d.y + d.length);
    ctx.strokeStyle = `rgba(160,200,255,${d.opacity})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    d.y += d.speed;
    if (d.y > h + d.length) { d.y = -d.length; d.x = Math.random() * w; }
  }
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
  const [showResult, setShowResult] = useState(false);
  const [camActive, setCamActive] = useState(false);

  const [soundOn, setSoundOn] = useState(true);
  const [soundVol, setSoundVol] = useState(0.18);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const rainRef = useRef<RainDrop[]>([]);
  const bgRafRef = useRef<number>(0);
  const noiseRef = useRef<{ ctx: AudioContext; stop: () => void } | null>(null);
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

  // Nature background canvas animation
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      rainRef.current = initRain(canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    let t = 0;
    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 0) {
        drawNature(ctx, canvas.width, canvas.height, rainRef.current, t++);
      }
      bgRafRef.current = requestAnimationFrame(loop);
    };
    bgRafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(bgRafRef.current); ro.disconnect(); };
  }, []);

  // White noise — start/stop based on soundOn + running
  const stopNoise = useCallback(() => {
    noiseRef.current?.stop();
    noiseRef.current = null;
  }, []);

  useEffect(() => {
    if (soundOn && running && phase === 'focus') {
      if (!noiseRef.current) noiseRef.current = createBrownNoise(soundVol);
    } else {
      stopNoise();
    }
    return stopNoise;
  }, [soundOn, running, phase, soundVol, stopNoise]);

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
    stopNoise();
    cancelAnimationFrame(bgRafRef.current);
    (screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
  }, [stopNoise]);

  const handleEnd = async () => {
    if (phase === 'focus') {
      const elapsed = FOCUS_SECS - remainingRef.current;
      if (elapsed > 0) {
        accFocusRef.current += elapsed;
        setTotalFocusSecs(accFocusRef.current);
      }
    }
    setRunning(false);
    stopCam();

    // Save focus session to study tracker
    const focusDuration = accFocusRef.current;
    if (focusDuration >= 60) {
      try {
        const catIdStr = localStorage.getItem('study_selected_category_id');
        const catId = catIdStr && catIdStr !== 'null' ? parseInt(catIdStr, 10) : null;
        const catName = localStorage.getItem('study_cat_name') || null;
        const catColor = localStorage.getItem('study_cat_color') || null;
        const endTime = Date.now();
        const startTime = endTime - focusDuration * 1000;
        const d = new Date(startTime);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        await db.studySessions.add({
          date: dateStr, startTime, endTime, duration: focusDuration,
          categoryId: catId, categoryName: catName || null, categoryColor: catColor || null,
          source: 'pomodoro',
        });
      } catch { /* non-fatal */ }
    }

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

  const isFirstStart = !running && remaining === (phase === 'focus' ? FOCUS_SECS : BREAK_SECS);

  if (showResult) {
    return <ResultScreen totalSecs={totalFocusSecs} rounds={doneRounds} onClose={onClose} />;
  }

  return (
    <div className="fm-outer">
      {/* Nature background canvas — fills fm-outer */}
      <canvas ref={bgCanvasRef} className="fm-bg-canvas" aria-hidden />

      <div className="fm-screen">

        {/* ── Timer & controls (centered) ── */}
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
            <button className="fm-btn-end" onClick={() => void handleEnd()}>
              <X size={15} />終了
            </button>
          </div>

          {/* Stats */}
          <div className="fm-stats-row">
            <span className="fm-stat">累計: {liveLabel}</span>
            <span className="fm-stat">{doneRounds} ポモドーロ完了</span>
          </div>

          {/* Sound & Camera controls row */}
          <div className="fm-extra-controls">
            <button className="fm-cam-toggle" onClick={() => { setSoundOn(v => !v); }}>
              {soundOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
              {soundOn ? 'ノイズON' : 'ノイズOFF'}
            </button>
            {soundOn && (
              <input
                type="range" min="0.02" max="0.5" step="0.02"
                value={soundVol}
                onChange={e => setSoundVol(Number(e.target.value))}
                className="fm-vol-slider"
                aria-label="音量"
              />
            )}
            <button className="fm-cam-toggle" onClick={() => camActive ? stopCam() : startCam()}>
              {camActive ? <CameraOff size={12} /> : <Camera size={12} />}
              {camActive ? 'カメラOFF' : '集中確認カメラ'}
            </button>
          </div>
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
          background: #0b1a2e;
          overflow: hidden;
        }

        /* Nature background canvas */
        .fm-bg-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
        }

        /* ── Screen (landscape-sized, rotated when portrait) ── */
        .fm-screen {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: stretch;
          overflow: hidden;
          z-index: 1;
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

        /* ── Timer panel (centered, full width) ── */
        .fm-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px 40px;
          gap: 16px;
          backdrop-filter: blur(2px);
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

        /* Extra controls (sound + camera) */
        .fm-extra-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
        }

        /* Volume slider */
        .fm-vol-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 72px;
          height: 4px;
          border-radius: 99px;
          background: rgba(255,255,255,.18);
          outline: none;
          cursor: pointer;
        }
        .fm-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #6366f1;
          cursor: pointer;
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
