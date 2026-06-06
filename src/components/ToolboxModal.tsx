'use client';

import { useState } from 'react';
import { X, Plus, Check } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { TONES, SKILLS, SHORTCUTS } from '@/lib/toolboxData';
import { useToolbox, toggleToolboxItem, type ToolboxCategory } from '@/lib/toolbox';

interface ToolboxModalProps {
  onClose: () => void;
}

const TABS: { id: ToolboxCategory; label: string }[] = [
  { id: 'tones', label: '🎚️ トーン' },
  { id: 'skills', label: '🧩 スキル' },
  { id: 'shortcuts', label: '⌨️ ショートカット' },
];

export default function ToolboxModal({ onClose }: ToolboxModalProps) {
  const t = useT();
  const [tab, setTab] = useState<ToolboxCategory>('tones');
  const toolbox = useToolbox();

  return (
    <div className="toolbox-overlay" onClick={onClose}>
      <div className="toolbox-modal" onClick={e => e.stopPropagation()}>
        <div className="toolbox-header">
          <span className="toolbox-title">{t('🧰 ツールボックス')}</span>
          <button className="toolbox-close" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="toolbox-desc">
          {t('使いたいものだけ「追加」してね。追加したものだけがチャット画面に表示されるよ。')}
        </p>
        <div className="toolbox-tabs">
          {TABS.map(tb => (
            <button key={tb.id} className={`toolbox-tab${tab === tb.id ? ' active' : ''}`} onClick={() => setTab(tb.id)}>
              {t(tb.label)}
            </button>
          ))}
        </div>
        <div className="toolbox-body">
          {tab === 'tones' && (
            <div className="toolbox-list">
              {TONES.map(tone => {
                const on = toolbox.tones.includes(tone.id);
                return (
                  <div key={tone.id} className="toolbox-item">
                    <div className="toolbox-item-main">
                      <div className="toolbox-item-label">{t(tone.label)}</div>
                      <div className="toolbox-item-desc">{t(tone.directive)}</div>
                    </div>
                    <button
                      className={`toolbox-toggle${on ? ' on' : ''}`}
                      onClick={() => toggleToolboxItem('tones', tone.id)}
                    >
                      {on ? <><Check size={13} />{t('追加済み')}</> : <><Plus size={13} />{t('追加')}</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'skills' && (
            <div className="toolbox-list">
              {SKILLS.map(skill => {
                const on = toolbox.skills.includes(skill.id);
                return (
                  <div key={skill.id} className="toolbox-item">
                    <div className="toolbox-item-main">
                      <div className="toolbox-item-label">{t(skill.label)}</div>
                      <div className="toolbox-item-desc">{t(skill.description)}</div>
                    </div>
                    <button
                      className={`toolbox-toggle${on ? ' on' : ''}`}
                      onClick={() => toggleToolboxItem('skills', skill.id)}
                    >
                      {on ? <><Check size={13} />{t('追加済み')}</> : <><Plus size={13} />{t('追加')}</>}
                    </button>
                  </div>
                );
              })}
              <p className="toolbox-hint">{t('💡 スキルは「答えの型」を指定するプロンプトです。タップで入力欄に挿入されるので、内容を編集してから送信できます。')}</p>
            </div>
          )}
          {tab === 'shortcuts' && (
            <div className="toolbox-list">
              {SHORTCUTS.map(sc => {
                const on = toolbox.shortcuts.includes(sc.id);
                return (
                  <div key={sc.id} className="toolbox-item">
                    <div className="toolbox-item-main">
                      <div className="toolbox-item-label toolbox-cmd">{sc.cmd}</div>
                      <div className="toolbox-item-desc">{t(sc.description)}</div>
                    </div>
                    <button
                      className={`toolbox-toggle${on ? ' on' : ''}`}
                      onClick={() => toggleToolboxItem('shortcuts', sc.id)}
                    >
                      {on ? <><Check size={13} />{t('追加済み')}</> : <><Plus size={13} />{t('追加')}</>}
                    </button>
                  </div>
                );
              })}
              <p className="toolbox-hint">{t('💡 入力欄で「/」を打つと、追加したコマンドの候補が出てくるよ。')}</p>
            </div>
          )}
        </div>
        <style jsx>{`
          .toolbox-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; }
          .toolbox-modal { background:var(--background); border-radius:16px; width:100%; max-width:540px; max-height:84vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.18); }
          .toolbox-header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px 0; }
          .toolbox-title { font-size:1.05rem; font-weight:700; color:var(--primary); }
          .toolbox-close { background:none; border:none; cursor:pointer; color:var(--foreground); opacity:0.6; padding:4px; display:flex; }
          .toolbox-close:hover { opacity:1; }
          .toolbox-desc { font-size:0.78rem; color:var(--foreground); opacity:0.65; padding:6px 18px 0; margin:0; }
          .toolbox-tabs { display:flex; gap:6px; padding:12px 18px 0; }
          .toolbox-tab { background:none; border:1.5px solid var(--border); border-radius:20px; padding:5px 14px; font-size:0.82rem; cursor:pointer; color:var(--foreground); opacity:0.65; transition:all 0.15s; }
          .toolbox-tab:hover { opacity:1; }
          .toolbox-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); opacity:1; }
          .toolbox-body { overflow-y:auto; padding:14px 18px 20px; flex:1; }
          .toolbox-list { display:flex; flex-direction:column; gap:8px; }
          .toolbox-item { display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--accent); border:1px solid var(--border); border-radius:10px; }
          .toolbox-item-main { flex:1; min-width:0; }
          .toolbox-item-label { font-size:0.86rem; font-weight:700; color:var(--foreground); }
          .toolbox-item-label.toolbox-cmd { font-family:monospace; color:var(--primary); }
          .toolbox-item-desc { font-size:0.74rem; color:var(--foreground); opacity:0.65; margin-top:2px; line-height:1.4; }
          .toolbox-toggle { display:flex; align-items:center; gap:4px; flex-shrink:0; background:var(--background); border:1.5px solid var(--border); border-radius:16px; padding:6px 12px; font-size:0.76rem; font-weight:700; cursor:pointer; color:var(--foreground); transition:all 0.15s; }
          .toolbox-toggle:hover { border-color:var(--primary); color:var(--primary); }
          .toolbox-toggle.on { background:var(--primary); border-color:var(--primary); color:#fff; }
          .toolbox-toggle.on:hover { opacity:0.85; color:#fff; }
          .toolbox-hint { font-size:0.74rem; color:var(--foreground); opacity:0.6; margin:4px 2px 0; line-height:1.5; }
        `}</style>
      </div>
    </div>
  );
}
