'use client';
import { useState, useEffect } from 'react';
import {
  getPlan, canUpgradeTo, tryUnlockWithPassword,
  getRemainingPoints, getPointsUsedToday,
  PLAN_ORDER, PLAN_DAILY_POINTS, PLAN_PRICE_YEN, PLAN_LABEL, PT,
  getTicketLimit, getTicketsLeft,
} from '@/lib/points';
import type { Plan } from '@/lib/points';

function ticketLimitText(limit: number): string {
  if (limit >= Number.MAX_SAFE_INTEGER) return '無制限';
  if (limit <= 0) return '利用不可';
  return `1日${limit}回`;
}

interface PlanModalProps {
  onClose: () => void;
}

function nextMonthFirstStr(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return `${d.getFullYear()}年${d.getMonth() + 1}月1日`;
}

export default function PlanModal({ onClose }: PlanModalProps) {
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [remaining, setRemaining] = useState(0);
  const [used, setUsed] = useState(0);
  const [expandedPlan, setExpandedPlan] = useState<Plan | null>(null);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    setCurrentPlan(getPlan());
    setRemaining(getRemainingPoints());
    setUsed(getPointsUsedToday());
  }, []);

  function handleUpgrade(plan: Plan) {
    setExpandedPlan(plan);
    setPassword('');
    setPwError('');
  }

  function handleConfirm(plan: Plan) {
    const ok = tryUnlockWithPassword(password, plan);
    if (ok) {
      setCurrentPlan(plan);
      setRemaining(getRemainingPoints());
      setExpandedPlan(null);
    } else {
      setPwError('パスワードが違います');
    }
  }

  const isDeveloper = currentPlan === 'developer';
  const daily = PLAN_DAILY_POINTS[currentPlan];
  const pct = isDeveloper ? 100 : Math.max(0, Math.min(100, (remaining / daily) * 100));

  return (
    <div className="pm-overlay" onClick={onClose}>
      <style>{`
        .pm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
        .pm-modal{background:var(--bg,#fff);border-radius:18px;padding:24px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;position:relative}
        .pm-close{position:absolute;top:12px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted,#888);line-height:1}
        .pm-title{font-size:18px;font-weight:700;margin:0 0 18px;color:var(--text,#333)}
        .pm-usage{margin-bottom:20px}
        .pm-usage-label{font-size:12px;color:var(--text-muted,#888);margin-bottom:6px}
        .pm-bar-wrap{height:8px;background:var(--border,#eee);border-radius:4px;overflow:hidden;margin-bottom:4px}
        .pm-bar{height:100%;background:var(--primary,#f06292);border-radius:4px;transition:width .3s}
        .pm-usage-nums{font-size:13px;color:var(--text,#333);font-weight:600}
        .pm-cards{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
        .pm-card{border:2px solid var(--border,#eee);border-radius:12px;padding:12px 14px}
        .pm-card.current{border-color:var(--primary,#f06292);background:var(--accent,#fff0f5)}
        .pm-card.locked{opacity:.5}
        .pm-card-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .pm-card-name{font-weight:700;font-size:14px;min-width:70px}
        .pm-card-pts{font-size:13px;color:var(--text-muted,#888)}
        .pm-card-price{font-size:13px;font-weight:600;margin-left:auto}
        .pm-card-badge{font-size:11px;background:var(--primary,#f06292);color:#fff;padding:2px 8px;border-radius:20px}
        .pm-card-btn{font-size:12px;background:var(--primary,#f06292);color:#fff;border:none;border-radius:20px;padding:4px 12px;cursor:pointer;margin-left:auto}
        .pm-card-btn:not(:disabled):hover{opacity:.85}
        .pm-pw-area{margin-top:10px;display:flex;flex-direction:column;gap:6px}
        .pm-pw-hint{font-size:12px;color:var(--text-muted,#888);margin:0}
        .pm-pw-input{border:1.5px solid var(--border,#ddd);border-radius:8px;padding:8px 10px;font-size:14px;width:100%;box-sizing:border-box}
        .pm-pw-error{font-size:12px;color:#e53935;margin:0}
        .pm-pw-btns{display:flex;gap:8px;flex-wrap:wrap}
        .pm-pw-confirm{background:var(--primary,#f06292);color:#fff;border:none;border-radius:8px;padding:7px 16px;cursor:pointer;font-size:13px}
        .pm-pw-cancel{background:none;border:1.5px solid var(--border,#ddd);border-radius:8px;padding:7px 16px;cursor:pointer;font-size:13px}
        .pm-costs{border-top:1px solid var(--border,#eee);padding-top:14px}
        .pm-costs-title{font-size:12px;font-weight:700;color:var(--text-muted,#888);margin-bottom:8px}
        .pm-cost-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--text,#333)}
        .pm-cost-pts{font-weight:700;color:var(--primary,#f06292)}
        .pm-plan-reset{font-size:12px;color:var(--text-muted,#888);background:var(--accent,#fff0f5);border-radius:8px;padding:8px 12px;margin-bottom:16px;line-height:1.5}
        .pm-plan-reset strong{color:var(--text,#333)}
      `}</style>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose}>✕</button>
        <h2 className="pm-title">プラン・利用状況</h2>

        <div className="pm-usage">
          <div className="pm-usage-label">本日の残りポイント（毎日0時リセット）</div>
          <div className="pm-bar-wrap"><div className="pm-bar" style={{ width: `${pct}%` }} /></div>
          <div className="pm-usage-nums">
            {isDeveloper ? '∞ / 無制限' : `${remaining.toLocaleString()} / ${daily.toLocaleString()} pt`}
            {!isDeveloper && `（使用済 ${used.toLocaleString()}pt）`}
          </div>
        </div>
        {currentPlan !== 'free' && !isDeveloper && (
          <div className="pm-plan-reset">
            🔄 プランは <strong>{nextMonthFirstStr()}</strong> に Free へリセットされます
          </div>
        )}

        <div className="pm-cards">
          {PLAN_ORDER.map(plan => {
            const isCurrent = plan === currentPlan;
            const canUp = canUpgradeTo(plan);
            return (
              <div key={plan} className={`pm-card${isCurrent ? ' current' : ''}${!canUp && !isCurrent ? ' locked' : ''}`}>
                <div className="pm-card-row">
                  <span className="pm-card-name">{PLAN_LABEL[plan]}</span>
                  <span className="pm-card-pts">{plan === 'developer' ? '無制限' : `${PLAN_DAILY_POINTS[plan].toLocaleString()}pt/日`}</span>
                  <span className="pm-card-price">{plan === 'developer' ? '開発者専用' : PLAN_PRICE_YEN[plan] === 0 ? '無料' : `¥${PLAN_PRICE_YEN[plan]}/月`}</span>
                  {isCurrent && <span className="pm-card-badge">現在</span>}
                  {canUp && !isCurrent && expandedPlan !== plan && (
                    <button className="pm-card-btn" onClick={() => handleUpgrade(plan)}>アップグレード</button>
                  )}
                </div>
                {expandedPlan === plan && (
                  <div className="pm-pw-area">
                    <p className="pm-pw-hint">パスワードを入力してください</p>
                    <input
                      className="pm-pw-input"
                      type="password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setPwError(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleConfirm(plan)}
                      placeholder="パスワード"
                      autoFocus
                    />
                    {pwError && <p className="pm-pw-error">{pwError}</p>}
                    <div className="pm-pw-btns">
                      <button className="pm-pw-confirm" onClick={() => handleConfirm(plan)}>確認</button>
                      <button className="pm-pw-cancel" onClick={() => setExpandedPlan(null)}>キャンセル</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pm-costs">
          <div className="pm-costs-title">消費ポイント（AIモード / 1回）</div>
          <div className="pm-cost-row"><span>🪶 軽量モード・sikun</span><span className="pm-cost-pts">{PT.lite}pt</span></div>
          <div className="pm-cost-row"><span>🌸 安定モード</span><span className="pm-cost-pts">{PT.flash}pt</span></div>
          <div className="pm-cost-row"><span>🧠 思考モード</span><span className="pm-cost-pts">{PT.thinking}pt</span></div>
          <div className="pm-cost-row"><span>⚡ Ultra思考モード</span><span className="pm-cost-pts">{PT.ultra}pt</span></div>
        </div>
        <div className="pm-costs" style={{ marginTop: '12px' }}>
          <div className="pm-costs-title">現在のプランの利用回数上限（毎日0時リセット）</div>
          <div className="pm-cost-row">
            <span>🌸 安定モード</span>
            <span className="pm-cost-pts">
              {ticketLimitText(getTicketLimit('stable'))}
              {getTicketLimit('stable') > 0 && getTicketLimit('stable') < Number.MAX_SAFE_INTEGER ? `（残り${getTicketsLeft('stable')}）` : ''}
            </span>
          </div>
          <div className="pm-cost-row">
            <span>🧠 思考モード</span>
            <span className="pm-cost-pts">
              {ticketLimitText(getTicketLimit('thinking'))}
              {getTicketLimit('thinking') > 0 && getTicketLimit('thinking') < Number.MAX_SAFE_INTEGER ? `（残り${getTicketsLeft('thinking')}）` : ''}
            </span>
          </div>
          <div className="pm-cost-row">
            <span>⚡ Ultra思考モード</span>
            <span className="pm-cost-pts">
              {ticketLimitText(getTicketLimit('ultra'))}
              {getTicketLimit('ultra') > 0 && getTicketLimit('ultra') < Number.MAX_SAFE_INTEGER ? `（残り${getTicketsLeft('ultra')}）` : ''}
            </span>
          </div>
        </div>
        <div className="pm-costs" style={{ marginTop: '12px' }}>
          <div className="pm-costs-title">消費ポイント（タスク別）</div>
          <div className="pm-cost-row"><span>📝 演習問題生成（/quiz, /qa など）</span><span className="pm-cost-pts">{PT.exercise}pt</span></div>
          <div className="pm-cost-row"><span>👹 鬼問題作成（/hard）</span><span className="pm-cost-pts">{PT.hardProblem}pt</span></div>
          <div className="pm-cost-row"><span>🎓 授業セッション（マイク録音）</span><span className="pm-cost-pts">{PT.lesson}pt</span></div>
        </div>
      </div>
    </div>
  );
}
