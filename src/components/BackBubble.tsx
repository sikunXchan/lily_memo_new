'use client';

import { Home } from 'lucide-react';

interface BackBubbleProps {
  onGoHome: () => void;
}

export default function BackBubble({ onGoHome }: BackBubbleProps) {
  return (
    <button className="bb-wrap" onClick={onGoHome} aria-label="ホームに戻る">
      <span className="bb-icon-skin">
        <Home size={18} color="#ff8da1" strokeWidth={2.2} />
      </span>
      <span className="bb-label">ホーム</span>

      <style jsx>{`
        .bb-wrap {
          position: fixed;
          left: 16px;
          bottom: calc(20px + env(safe-area-inset-bottom));
          z-index: 3000;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 16px 9px 10px;
          border-radius: 999px;
          border: 1.5px solid rgba(255,255,255,.7);
          cursor: pointer;
          background:
            radial-gradient(circle at 30% 25%, rgba(255,255,255,.95), transparent 45%),
            linear-gradient(135deg, #fff0f5, #ffdbe6);
          box-shadow:
            0 8px 22px rgba(255,141,161,.4),
            inset 0 0 12px rgba(255,255,255,.6);
          animation: bb-floaty 5s ease-in-out infinite;
        }
        .bb-wrap:active { transform: scale(.94); }
        @keyframes bb-floaty {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }
        .bb-icon-skin {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 32% 26%, #fff, #ffd0dd);
          box-shadow:
            inset -3px -4px 8px rgba(255,141,161,.35),
            0 2px 6px rgba(255,141,161,.3);
          flex-shrink: 0;
        }
        .bb-label {
          font-size: 13px;
          font-weight: 800;
          color: #b06277;
        }
      `}</style>
    </button>
  );
}
