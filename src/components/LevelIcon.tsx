'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { LevelTier } from '@/lib/level';
import { fxSpecFor } from '@/lib/level';

// トロフィーのアイコン（PNG が読めるまでは emoji）に、段位ごとの演出を重ねる。
// 演出は プラチナ（Tier 9 = 累計300時間）から付き、段が上がるほど強くなって
// キング（Tier 23）で全虹になる。
//
// 主役は「金属光沢」— トロフィーの PNG をそのまま CSS マスクに使い、その
// シルエットの中だけをハイライトの帯が斜めに走る。だから“カードの周りが
// 光る”のではなく、トロフィーの金属面そのものが光を返して見える。
// 重ねているレイヤー（下から順）:
//   1. lvi-aura   背後の発光（脈動）
//   2. lvi-ring   回転する光輪（ダイヤモンド以上）／逆回転の二枚目（エリート以上）
//   3. lvi-rays   王冠の放射光（チャンピオン Ⅲ 以上）
//   4. トロフィー本体（浮遊 + ゆっくり傾いて金属面が光を返す）
//   5. lvi-sheen  金属光沢の帯（マスク済み・段が上がると2本になる）
//   6. lvi-tint   金属に乗る色味（脈動）
//   7. lvi-spark  周囲を舞う光の粒（段が上がるほど増え、周回もする）

// Deterministic ring of motes (golden angle) — no Math.random in render.
const SPARK_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const ang = (i * 137.508 * Math.PI) / 180;
  const r = 46 + (i % 3) * 7;
  return {
    left: +(50 + r * Math.cos(ang)).toFixed(2),
    top: +(50 + r * Math.sin(ang)).toFixed(2),
    size: +(1.6 + ((i * 7) % 5) * 0.55).toFixed(2),
    delay: +(((i * 13) % 20) / 10).toFixed(2),
    dur: +(1.5 + ((i * 11) % 13) / 10).toFixed(2),
    white: i % 3 === 0,
  };
});

export default function LevelIcon({ tier, size }: { tier: LevelTier; size: number }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [tier.icon]);

  const fx = fxSpecFor(tier);
  const p = fx?.power ?? 0;
  const sparks = fx ? SPARK_SLOTS.slice(0, fx.sparks) : [];
  // 光沢はマスク（＝アイコン画像そのもの）が要るので、emoji フォールバック中は出さない。
  const glossy = !!fx && !err;

  const vars: CSSProperties | undefined = fx
    ? ({
        ['--lvi-icon']: `url("${tier.icon}")`,
        ['--lvi-metal']: fx.metal,
        ['--lvi-edge']: fx.metalEdge,
        ['--lvi-aura']: fx.aura,
        ['--lvi-aura2']: fx.aura2,
        ['--lvi-sheen-op']: `${fx.sheen}`,
        ['--lvi-sheen-dur']: `${fx.sheenDur}s`,
        // 段が上がるほど、オーラは広く濃く、動きは速く。
        ['--lvi-aura-inset']: `${-(12 + p * 18).toFixed(1)}%`,
        ['--lvi-aura-blur']: `${(2 + p * 11).toFixed(1)}px`,
        ['--lvi-glow']: `${(3 + p * 13).toFixed(1)}px`,
        ['--lvi-pulse-dur']: `${(3.1 - p * 1.1).toFixed(2)}s`,
        ['--lvi-float-dur']: `${(3.8 - p * 1.1).toFixed(2)}s`,
        ['--lvi-float-y']: `${-(3 + p * 5).toFixed(1)}%`,
        ['--lvi-spin-dur']: `${(11 - p * 6).toFixed(1)}s`,
        ['--lvi-spin2-dur']: `${(8 - p * 4).toFixed(1)}s`,
        ['--lvi-tilt-dur']: `${(7 - p * 2.4).toFixed(1)}s`,
        ['--lvi-tilt-deg']: `${(5 + p * 8).toFixed(1)}deg`,
      } as CSSProperties)
    : undefined;

  const cls = [
    'lvi',
    fx ? 'lvi-on' : '',
    fx?.tilt ? 'lvi-tilted' : '',
    fx?.rainbow ? 'lvi-king' : '',
    fx && fx.power >= 0.5 ? 'lvi-dual' : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={cls} style={{ width: size, height: size, ...vars }}>
      {fx && <span className="lvi-aura" />}
      {fx && fx.ring !== 'none' && <span className="lvi-ring" />}
      {fx && (fx.ring === 'orbit' || fx.ring === 'crown') && <span className="lvi-ring lvi-ring-b" />}
      {fx && fx.ring === 'crown' && <span className="lvi-rays" />}

      <span className="lvi-float">
        <span className="lvi-tilt">
          {err ? (
            <span className="lvi-emoji" style={{ fontSize: Math.round(size * 0.82) }}>{tier.emoji}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="lvi-img"
              src={tier.icon}
              alt=""
              width={size}
              height={size}
              draggable={false}
              onError={() => setErr(true)}
            />
          )}
          {glossy && <span className="lvi-tint" />}
          {glossy && <span className="lvi-sheen" />}
          {glossy && fx.power >= 0.5 && <span className="lvi-sheen lvi-sheen-b" />}
        </span>
      </span>

      {sparks.length > 0 && (
        <span className="lvi-sparks">
          {sparks.map((s, i) => (
            <i
              key={i}
              className="lvi-spark"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.size * (0.7 + p)}%`,
                height: `${s.size * (0.7 + p)}%`,
                background: s.white ? '#fff' : fx?.metalEdge,
                boxShadow: `0 0 ${4 + p * 6}px ${s.white ? '#fff' : fx?.metalEdge}`,
                animationDelay: `${s.delay}s`,
                animationDuration: `${s.dur}s`,
              }}
            />
          ))}
        </span>
      )}

      <style jsx>{`
        .lvi { position: relative; display: inline-flex; align-items: center; justify-content: center; }
        .lvi-float, .lvi-tilt {
          position: relative; width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center;
        }
        .lvi-img { object-fit: contain; display: block; width: 100%; height: 100%; }
        .lvi-emoji { line-height: 1; display: inline-block; }
        .lvi-float { z-index: 1; }
        /* 傾きは 3D。金属面が向きを変えるので、下の光沢の帯と噛み合って
           「光を返している」ように見える。 */
        .lvi-tilt { transform-style: preserve-3d; }

        /* ── 背後の発光 ───────────────────────────────────────────── */
        .lvi-on .lvi-aura {
          position: absolute; inset: var(--lvi-aura-inset); border-radius: 50%; z-index: 0;
          background: radial-gradient(circle, var(--lvi-aura), transparent 66%);
          filter: blur(var(--lvi-aura-blur));
          animation: lviBreathe var(--lvi-pulse-dur) ease-in-out infinite;
        }

        /* ── 回転する光輪 ─────────────────────────────────────────── */
        .lvi-on .lvi-ring {
          position: absolute; inset: calc(var(--lvi-aura-inset) * 0.72); border-radius: 50%; z-index: 0;
          background: conic-gradient(from 0deg, transparent, var(--lvi-aura2), transparent 34%, var(--lvi-aura) 58%, transparent 82%, var(--lvi-aura2));
          filter: blur(calc(var(--lvi-aura-blur) * 0.75)); opacity: 0.75;
          animation: lviSpin var(--lvi-spin-dur) linear infinite;
        }
        .lvi-on .lvi-ring-b {
          inset: calc(var(--lvi-aura-inset) * 0.45); opacity: 0.6;
          background: conic-gradient(from 180deg, transparent, #fff, transparent 26%, var(--lvi-edge) 52%, transparent 78%, #fff);
          animation: lviSpinR var(--lvi-spin2-dur) linear infinite;
        }
        /* 王冠の放射光（チャンピオン Ⅲ 以上） */
        .lvi-on .lvi-rays {
          position: absolute; inset: calc(var(--lvi-aura-inset) * 1.5); z-index: 0; border-radius: 50%;
          background: conic-gradient(from 0deg,
            transparent 0deg, var(--lvi-aura2) 3deg, transparent 8deg,
            transparent 42deg, var(--lvi-aura2) 45deg, transparent 50deg,
            transparent 84deg, var(--lvi-aura2) 87deg, transparent 92deg,
            transparent 126deg, var(--lvi-aura2) 129deg, transparent 134deg,
            transparent 168deg, var(--lvi-aura2) 171deg, transparent 176deg);
          filter: blur(1.5px); opacity: 0.55;
          animation: lviSpin calc(var(--lvi-spin-dur) * 1.8) linear infinite, lviFlicker calc(var(--lvi-pulse-dur) * 0.8) ease-in-out infinite;
        }

        /* ── 金属光沢（本体マスク）───────────────────────────────────
           トロフィーの PNG をマスクにして、その形の中だけをハイライトの帯が
           斜めに走る。走ったあとは少し止まって、また走る。 */
        .lvi-sheen, .lvi-tint {
          position: absolute; inset: 0; z-index: 2; pointer-events: none;
          -webkit-mask-image: var(--lvi-icon); mask-image: var(--lvi-icon);
          -webkit-mask-size: contain; mask-size: contain;
          -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
          -webkit-mask-position: center; mask-position: center;
          mix-blend-mode: screen;
        }
        .lvi-sheen {
          background: linear-gradient(102deg,
            transparent 38%, color-mix(in srgb, var(--lvi-edge) 70%, transparent) 45%,
            var(--lvi-metal) 50%,
            color-mix(in srgb, var(--lvi-edge) 70%, transparent) 55%, transparent 62%);
          background-size: 300% 100%; background-repeat: no-repeat;
          opacity: var(--lvi-sheen-op);
          animation: lviSheen var(--lvi-sheen-dur) cubic-bezier(.45,.05,.3,1) infinite;
        }
        .lvi-sheen-b {
          background: linear-gradient(72deg,
            transparent 42%, var(--lvi-metal) 50%, transparent 58%);
          background-size: 320% 100%;
          opacity: calc(var(--lvi-sheen-op) * 0.55);
          animation: lviSheen calc(var(--lvi-sheen-dur) * 1.45) cubic-bezier(.45,.05,.3,1) infinite reverse;
        }
        /* 金属に乗る色味。上下で色が違うので、金属が周りの光を拾って見える。 */
        .lvi-tint {
          background: linear-gradient(165deg, var(--lvi-aura2) 0%, transparent 42%, transparent 58%, var(--lvi-aura) 100%);
          opacity: 0; animation: lviTint var(--lvi-pulse-dur) ease-in-out infinite;
        }

        /* ── 舞う光の粒 ───────────────────────────────────────────── */
        .lvi-sparks { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
        .lvi-on.lvi-tilted .lvi-sparks { animation: lviSpin calc(var(--lvi-spin-dur) * 2.4) linear infinite; }
        .lvi-spark {
          position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
          animation-name: lviTwinkle; animation-timing-function: ease-in-out; animation-iteration-count: infinite;
        }

        /* ── 動き ─────────────────────────────────────────────────── */
        .lvi-on .lvi-float { animation: lviFloat var(--lvi-float-dur) ease-in-out infinite; }
        .lvi-on .lvi-img, .lvi-on .lvi-emoji {
          animation: lviGlow var(--lvi-pulse-dur) ease-in-out infinite;
        }
        .lvi-tilted .lvi-tilt { animation: lviTilt var(--lvi-tilt-dur) ease-in-out infinite; }

        /* ── キング（Tier 23）— 全部に虹の色相巡回を足す ───────────── */
        /* 虹は conic なので、そのままだと縁が切り立った円盤になって背景の
           文字まで潰す。中心から外へ抜けるマスクを掛けて“光”に戻す。 */
        .lvi-king .lvi-aura {
          background: conic-gradient(from 0deg, #ff5e5e, #ffd24d, #5eff8b, #5ec8ff, #b15eff, #ff5ec8, #ff5e5e);
          -webkit-mask-image: radial-gradient(circle, #000 18%, rgba(0,0,0,0.35) 46%, transparent 70%);
          mask-image: radial-gradient(circle, #000 18%, rgba(0,0,0,0.35) 46%, transparent 70%);
          animation: lviBreatheKing var(--lvi-pulse-dur) ease-in-out infinite, lviSpin 6s linear infinite;
        }
        .lvi-king .lvi-ring {
          background: conic-gradient(from 0deg, #ff5e5e, #ffd24d, #5eff8b, #5ec8ff, #b15eff, #ff5ec8, #ff5e5e);
        }
        .lvi-king .lvi-sheen { animation: lviSheen var(--lvi-sheen-dur) cubic-bezier(.45,.05,.3,1) infinite, lviHue 4s linear infinite; }
        .lvi-king .lvi-img, .lvi-king .lvi-emoji { animation: lviKingGlow 3.4s ease-in-out infinite; }

        /* ── keyframes ────────────────────────────────────────────── */
        @keyframes lviSheen {
          0%       { background-position: 190% 0; }
          58%,100% { background-position: -90% 0; }
        }
        @keyframes lviTint   { 0%,100% { opacity: 0; } 50% { opacity: calc(0.18 + var(--lvi-sheen-op) * 0.3); } }
        @keyframes lviBreathe{ 0%,100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 0.95; transform: scale(1.09); } }
        /* 虹オーラは lviSpin が transform を持っていくので、こちらは明るさだけ担当する。 */
        @keyframes lviBreatheKing { 0%,100% { opacity: 0.5; } 50% { opacity: 0.85; } }
        @keyframes lviSpin   { to { transform: rotate(360deg); } }
        @keyframes lviSpinR  { to { transform: rotate(-360deg); } }
        @keyframes lviFlicker{ 0%,100% { opacity: 0.3; } 50% { opacity: 0.75; } }
        @keyframes lviFloat  { 0%,100% { transform: translateY(0); } 50% { transform: translateY(var(--lvi-float-y)); } }
        @keyframes lviTilt   {
          0%,100% { transform: perspective(620px) rotateY(calc(var(--lvi-tilt-deg) * -1)) rotateZ(-1deg); }
          50%     { transform: perspective(620px) rotateY(var(--lvi-tilt-deg)) rotateZ(1deg); }
        }
        @keyframes lviTwinkle{
          0%,100% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
          50%     { opacity: 1; transform: translate(-50%, -50%) scale(1.25); }
        }
        @keyframes lviGlow   {
          0%,100% { filter: drop-shadow(0 0 calc(var(--lvi-glow) * 0.4) var(--lvi-aura)); }
          50%     { filter: drop-shadow(0 0 var(--lvi-glow) var(--lvi-aura)) drop-shadow(0 0 calc(var(--lvi-glow) * 1.6) var(--lvi-aura2)); }
        }
        @keyframes lviKingGlow {
          0%,100% { filter: drop-shadow(0 0 10px rgba(255,94,200,0.95)); }
          33%     { filter: drop-shadow(0 0 12px rgba(94,200,255,0.95)); }
          66%     { filter: drop-shadow(0 0 12px rgba(94,255,139,0.95)); }
        }
        @keyframes lviHue    { to { filter: hue-rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .lvi-float, .lvi-tilt, .lvi-img, .lvi-emoji, .lvi-aura, .lvi-ring,
          .lvi-rays, .lvi-sheen, .lvi-tint, .lvi-sparks, .lvi-spark {
            animation: none !important;
          }
          .lvi-sheen, .lvi-spark { opacity: 0.5; }
          .lvi-tilt { transform: none; }
        }
      `}</style>
    </span>
  );
}
