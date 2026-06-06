'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Plus, Check, Pencil, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { TONES } from '@/lib/toolboxData';
import { useEnabledTones, toggleTone } from '@/lib/toolbox';
import { db } from '@/lib/db';
import { ensureSkillsSeeded, deleteSkill, type Skill } from '@/lib/skills';
import { useShortcuts, saveShortcut, deleteShortcut, type Shortcut } from '@/lib/shortcuts';
import SkillBuilder from '@/components/SkillBuilder';
import { OVERLAY_STYLE } from '@/lib/overlayStyle';

interface ToolboxModalProps {
  onClose: () => void;
}

type Tab = 'tones' | 'skills' | 'shortcuts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'skills', label: '🧩 スキル' },
  { id: 'tones', label: '🎚️ トーン' },
  { id: 'shortcuts', label: '⌨️ ショートカット' },
];

export default function ToolboxModal({ onClose }: ToolboxModalProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('skills');
  const enabledTones = useEnabledTones();
  const shortcuts = useShortcuts();

  ensureSkillsSeeded();
  const skills = useLiveQuery(() => db.skills.orderBy('createdAt').toArray(), []) ?? [];

  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [showSkillBuilder, setShowSkillBuilder] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);

  return (
    <>
    <div className="tb-overlay" onClick={onClose} style={{ ...OVERLAY_STYLE, zIndex: 9998 }}>
      <div className="tb-modal" onClick={e => e.stopPropagation()}>
        <div className="tb-header">
          <span className="tb-title">{t('🧰 ツールボックス')}</span>
          <button className="tb-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="tb-tabs">
          {TABS.map(tb => (
            <button key={tb.id} className={`tb-tab${tab === tb.id ? ' active' : ''}`} onClick={() => setTab(tb.id)}>
              {t(tb.label)}
            </button>
          ))}
        </div>
        <div className="tb-body">
          {tab === 'skills' && (
            <div className="tb-list">
              <p className="tb-desc">{t('スキルは、有効化するとLilyの振る舞い自体が変わる「役割＋参考資料」だよ。PDFやURLを読み込ませることもできる。')}</p>
              <button className="tb-create" onClick={() => { setEditingSkill(null); setShowSkillBuilder(true); }}>
                <Plus size={15} />{t('新しいスキルを作る')}
              </button>
              {skills.map(skill => (
                <div key={skill.id} className="tb-item">
                  <div className="tb-item-main">
                    <div className="tb-item-label">{skill.emoji} {skill.name}</div>
                    <div className="tb-item-desc">
                      {skill.instructions.slice(0, 60)}{skill.instructions.length > 60 ? '…' : ''}
                      {skill.references.length > 0 && <span className="tb-ref-badge">{t('📎 資料{n}件', { n: skill.references.length })}</span>}
                    </div>
                  </div>
                  <button className="tb-icon-btn" onClick={() => { setEditingSkill(skill); setShowSkillBuilder(true); }} title={t('編集')}>
                    <Pencil size={14} />
                  </button>
                  <button className="tb-icon-btn danger" onClick={() => { if (confirm(t('「{name}」を削除する？', { name: skill.name }))) deleteSkill(skill.id!); }} title={t('削除')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'tones' && (
            <div className="tb-list">
              <p className="tb-desc">{t('トーンは「話し方」だけを変えるよ。追加したものがチャットのトーン欄に並ぶ。')}</p>
              {TONES.map(tone => {
                const on = enabledTones.includes(tone.id);
                return (
                  <div key={tone.id} className="tb-item">
                    <div className="tb-item-main">
                      <div className="tb-item-label">{t(tone.label)}</div>
                      <div className="tb-item-desc">{t(tone.directive)}</div>
                    </div>
                    <button className={`tb-toggle${on ? ' on' : ''}`} onClick={() => toggleTone(tone.id)}>
                      {on ? <><Check size={13} />{t('追加済み')}</> : <><Plus size={13} />{t('追加')}</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="tb-list">
              <p className="tb-desc">{t('ショートカットは「続きを書いて」みたいなワンタップ定型文だよ。タップで入力欄に入る。')}</p>
              <button className="tb-create" onClick={() => setEditingShortcut({ id: `sc_${Date.now()}`, label: '', prompt: '' })}>
                <Plus size={15} />{t('新しいショートカットを作る')}
              </button>
              {shortcuts.map(sc => (
                <div key={sc.id} className="tb-item">
                  <div className="tb-item-main">
                    <div className="tb-item-label">{sc.label || t('(名前なし)')}</div>
                    <div className="tb-item-desc">{sc.prompt.slice(0, 60)}{sc.prompt.length > 60 ? '…' : ''}</div>
                  </div>
                  <button className="tb-icon-btn" onClick={() => setEditingShortcut(sc)} title={t('編集')}>
                    <Pencil size={14} />
                  </button>
                  <button className="tb-icon-btn danger" onClick={() => { if (confirm(t('「{name}」を削除する？', { name: sc.label }))) deleteShortcut(sc.id); }} title={t('削除')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <style jsx>{`
          .tb-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9999; display:flex; align-items:center; justify-content:center; }
          .tb-modal { background:var(--background); width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden; }
          @media (min-width: 640px) {
            .tb-overlay { padding:16px; }
            .tb-modal { border-radius:16px; max-width:560px; height:auto; max-height:86vh; box-shadow:0 8px 32px rgba(0,0,0,0.18); }
          }
          .tb-header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px 0; padding-top:calc(16px + env(safe-area-inset-top)); flex-shrink:0; }
          .tb-title { font-size:1.05rem; font-weight:700; color:var(--primary); }
          .tb-close { background:none; border:none; cursor:pointer; color:var(--foreground); opacity:0.6; padding:4px; display:flex; }
          .tb-close:hover { opacity:1; }
          .tb-tabs { display:flex; gap:6px; padding:12px 18px 0; }
          .tb-tab { background:none; border:1.5px solid var(--border); border-radius:20px; padding:5px 14px; font-size:0.82rem; cursor:pointer; color:var(--foreground); opacity:0.65; transition:all 0.15s; }
          .tb-tab:hover { opacity:1; }
          .tb-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); opacity:1; }
          .tb-body { overflow-y:auto; padding:14px 18px 20px; flex:1; }
          .tb-list { display:flex; flex-direction:column; gap:8px; }
          .tb-desc { font-size:0.76rem; color:var(--foreground); opacity:0.65; margin:0 2px 4px; line-height:1.5; }
          .tb-create { display:flex; align-items:center; justify-content:center; gap:6px; background:color-mix(in srgb, var(--primary) 12%, transparent); border:1.5px dashed var(--primary); color:var(--primary); border-radius:10px; padding:10px; font-size:0.84rem; font-weight:700; cursor:pointer; }
          .tb-create:hover { background:color-mix(in srgb, var(--primary) 20%, transparent); }
          .tb-item { display:flex; align-items:center; gap:8px; padding:10px 12px; background:var(--accent); border:1px solid var(--border); border-radius:10px; }
          .tb-item-main { flex:1; min-width:0; }
          .tb-item-label { font-size:0.86rem; font-weight:700; color:var(--foreground); }
          .tb-item-desc { font-size:0.74rem; color:var(--foreground); opacity:0.65; margin-top:2px; line-height:1.4; overflow:hidden; text-overflow:ellipsis; }
          .tb-ref-badge { display:inline-block; margin-left:6px; font-size:0.68rem; color:var(--primary); opacity:0.9; }
          .tb-toggle { display:flex; align-items:center; gap:4px; flex-shrink:0; background:var(--background); border:1.5px solid var(--border); border-radius:16px; padding:6px 12px; font-size:0.76rem; font-weight:700; cursor:pointer; color:var(--foreground); transition:all 0.15s; }
          .tb-toggle:hover { border-color:var(--primary); color:var(--primary); }
          .tb-toggle.on { background:var(--primary); border-color:var(--primary); color:#fff; }
          .tb-icon-btn { flex-shrink:0; background:var(--background); border:1px solid var(--border); border-radius:8px; padding:7px; cursor:pointer; color:var(--foreground); display:flex; }
          .tb-icon-btn:hover { border-color:var(--primary); color:var(--primary); }
          .tb-icon-btn.danger:hover { border-color:#e11d48; color:#e11d48; }
        `}</style>
      </div>
    </div>

    {showSkillBuilder && (
      <SkillBuilder
        skill={editingSkill ?? undefined}
        onClose={() => setShowSkillBuilder(false)}
        onSaved={() => setShowSkillBuilder(false)}
      />
    )}
    {editingShortcut && (
      <ShortcutEditor
        shortcut={editingShortcut}
        onClose={() => setEditingShortcut(null)}
      />
    )}
    </>
  );
}

function ShortcutEditor({ shortcut, onClose }: { shortcut: Shortcut; onClose: () => void }) {
  const t = useT();
  const [label, setLabel] = useState(shortcut.label);
  const [prompt, setPrompt] = useState(shortcut.prompt);

  const handleSave = () => {
    if (!label.trim() || !prompt.trim()) return;
    saveShortcut({ id: shortcut.id, label: label.trim(), prompt: prompt.trim() });
    onClose();
  };

  return (
    <div className="se-overlay" onClick={onClose} style={{ ...OVERLAY_STYLE, zIndex: 10001 }}>
      <div className="se-modal" onClick={e => e.stopPropagation()}>
        <div className="se-header">
          <span className="se-title">{t('ショートカット')}</span>
          <button className="se-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="se-body">
          <label className="se-label">{t('ボタンの名前')}</label>
          <input className="se-input" value={label} onChange={e => setLabel(e.target.value)} placeholder={t('例: ▶ 続きを書いて')} />
          <label className="se-label">{t('入力される文章')}</label>
          <textarea className="se-textarea" value={prompt} onChange={e => setPrompt(e.target.value)} rows={5} placeholder={t('タップしたときに入力欄に入る文章')} />
        </div>
        <div className="se-footer">
          <button className="se-cancel" onClick={onClose}>{t('キャンセル')}</button>
          <button className="se-save" onClick={handleSave} disabled={!label.trim() || !prompt.trim()}>{t('保存')}</button>
        </div>
        <style jsx>{`
          .se-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10001; display:flex; align-items:center; justify-content:center; }
          .se-modal { background:var(--background); width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden; }
          @media (min-width: 640px) {
            .se-overlay { padding:16px; }
            .se-modal { border-radius:16px; max-width:480px; height:auto; max-height:90vh; box-shadow:0 8px 32px rgba(0,0,0,0.2); }
          }
          .se-header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; padding-top:calc(16px + env(safe-area-inset-top)); border-bottom:1px solid var(--border); flex-shrink:0; }
          .se-body { flex:1; overflow-y:auto; }
          .se-title { font-size:1.02rem; font-weight:700; color:var(--primary); }
          .se-close { background:none; border:none; cursor:pointer; color:var(--foreground); opacity:0.6; padding:4px; display:flex; }
          .se-body { padding:16px 18px; }
          .se-label { display:block; font-size:0.82rem; font-weight:700; color:var(--foreground); margin:12px 0 4px; }
          .se-label:first-child { margin-top:0; }
          .se-input { width:100%; background:var(--accent); border:1px solid var(--border); border-radius:10px; padding:9px 12px; font-size:0.88rem; color:var(--foreground); outline:none; }
          .se-input:focus { border-color:var(--primary); }
          .se-textarea { width:100%; background:var(--accent); border:1px solid var(--border); border-radius:10px; padding:10px 12px; font-size:0.86rem; color:var(--foreground); outline:none; resize:vertical; line-height:1.5; font-family:inherit; }
          .se-textarea:focus { border-color:var(--primary); }
          .se-footer { display:flex; gap:10px; justify-content:flex-end; padding:14px 18px; padding-bottom:calc(14px + env(safe-area-inset-bottom)); border-top:1px solid var(--border); flex-shrink:0; }
          .se-cancel { background:none; border:1.5px solid var(--border); border-radius:10px; padding:8px 18px; font-size:0.85rem; font-weight:600; cursor:pointer; color:var(--foreground); }
          .se-save { background:var(--primary); border:none; color:#fff; border-radius:10px; padding:8px 22px; font-size:0.85rem; font-weight:700; cursor:pointer; }
          .se-save:disabled { opacity:0.5; cursor:default; }
        `}</style>
      </div>
    </div>
  );
}
