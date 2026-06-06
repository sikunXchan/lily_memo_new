'use client';

import { useState, useRef } from 'react';
import { X, FileText, Link2, Type, Trash2, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { saveSkill, extractPdfText, fetchUrlText, type Skill, type SkillReference } from '@/lib/skills';

interface SkillBuilderProps {
  skill?: Skill;        // editing an existing skill (undefined = new)
  onClose: () => void;
  onSaved: () => void;
}

export default function SkillBuilder({ skill, onClose, onSaved }: SkillBuilderProps) {
  const t = useT();
  const [emoji, setEmoji] = useState(skill?.emoji ?? '🧩');
  const [name, setName] = useState(skill?.name ?? '');
  const [instructions, setInstructions] = useState(skill?.instructions ?? '');
  const [references, setReferences] = useState<SkillReference[]>(skill?.references ?? []);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [textName, setTextName] = useState('');
  const [textBody, setTextBody] = useState('');
  const [showTextAdd, setShowTextAdd] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addPdf = async (file: File) => {
    setError('');
    setBusy(t('PDFを読み込み中...'));
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const text = await extractPdfText(base64);
      if (text.length < 20) throw new Error(t('このPDFからは文字を取り出せなかったよ（画像PDFかも）'));
      setReferences(prev => [...prev, { type: 'pdf', name: file.name, content: text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const addUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setError('');
    setBusy(t('ページを読み込み中...'));
    try {
      const { title, text } = await fetchUrlText(url);
      setReferences(prev => [...prev, { type: 'url', name: title || url, content: text }]);
      setUrlInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const addText = () => {
    if (!textBody.trim()) return;
    setReferences(prev => [...prev, { type: 'text', name: textName.trim() || t('貼り付けテキスト'), content: textBody.trim() }]);
    setTextName('');
    setTextBody('');
    setShowTextAdd(false);
  };

  const removeRef = (i: number) => setReferences(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!name.trim() || !instructions.trim()) {
      setError(t('名前と指示は必須だよ'));
      return;
    }
    setBusy(t('保存中...'));
    try {
      await saveSkill({
        ...skill,
        emoji: emoji.trim() || '🧩',
        name: name.trim(),
        instructions: instructions.trim(),
        references,
        createdAt: skill?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  const refIcon = (type: SkillReference['type']) =>
    type === 'pdf' ? <FileText size={13} /> : type === 'url' ? <Link2 size={13} /> : <Type size={13} />;

  return (
    <div className="sb-overlay" onClick={onClose}>
      <div className="sb-modal" onClick={e => e.stopPropagation()}>
        <div className="sb-header">
          <span className="sb-title">{skill ? t('スキルを編集') : t('スキルを作成')}</span>
          <button className="sb-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sb-body">
          <label className="sb-label">{t('アイコンと名前')}</label>
          <div className="sb-name-row">
            <input className="sb-emoji" value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2} />
            <input
              className="sb-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('例: 応用情報モード')}
            />
          </div>

          <label className="sb-label">{t('Lilyへの指示（システムプロンプト）')}</label>
          <p className="sb-hint">{t('このスキルが有効な間、Lilyがどう振る舞うかを書いてね。役割・答え方の型・守るルールなど。')}</p>
          <textarea
            className="sb-textarea"
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder={t('例: あなたは応用情報技術者試験の講師です。専門用語は必ず噛み砕いて説明し、答えの根拠を明示してください。')}
            rows={5}
          />

          <label className="sb-label">{t('参考資料（任意）')}</label>
          <p className="sb-hint">{t('PDF・URL・テキストを読み込ませると、Lilyがその内容を根拠に答えるようになるよ。')}</p>

          {references.length > 0 && (
            <div className="sb-refs">
              {references.map((ref, i) => (
                <div key={i} className="sb-ref">
                  <span className="sb-ref-icon">{refIcon(ref.type)}</span>
                  <span className="sb-ref-name">{ref.name}</span>
                  <span className="sb-ref-size">{t('{n}字', { n: ref.content.length })}</span>
                  <button className="sb-ref-del" onClick={() => removeRef(i)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="sb-add-row">
            <button className="sb-add-btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <FileText size={14} />{t('PDF')}
            </button>
            <button className="sb-add-btn" onClick={() => setShowTextAdd(v => !v)} disabled={!!busy}>
              <Type size={14} />{t('テキスト')}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={e => {
            const f = e.target.files?.[0];
            if (f) addPdf(f);
            e.target.value = '';
          }} />

          <div className="sb-url-row">
            <Link2 size={14} className="sb-url-icon" />
            <input
              className="sb-input"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder={t('URLを貼り付け（静的ページのみ）')}
              onKeyDown={e => { if (e.key === 'Enter') addUrl(); }}
            />
            <button className="sb-url-add" onClick={addUrl} disabled={!!busy || !urlInput.trim()}>{t('読込')}</button>
          </div>

          {showTextAdd && (
            <div className="sb-text-add">
              <input
                className="sb-input"
                value={textName}
                onChange={e => setTextName(e.target.value)}
                placeholder={t('資料の名前（任意）')}
              />
              <textarea
                className="sb-textarea"
                value={textBody}
                onChange={e => setTextBody(e.target.value)}
                placeholder={t('参考にしたいテキストを貼り付け')}
                rows={4}
              />
              <button className="sb-text-save" onClick={addText} disabled={!textBody.trim()}>{t('この資料を追加')}</button>
            </div>
          )}

          {busy && <div className="sb-busy"><Loader2 size={14} className="sb-spin" />{busy}</div>}
          {error && <div className="sb-error">{error}</div>}
        </div>

        <div className="sb-footer">
          <button className="sb-cancel" onClick={onClose}>{t('キャンセル')}</button>
          <button className="sb-save" onClick={handleSave} disabled={!!busy}>{t('保存')}</button>
        </div>

        <style jsx>{`
          .sb-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center; padding:16px; }
          .sb-modal { background:var(--background); border-radius:16px; width:100%; max-width:520px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.2); }
          .sb-header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid var(--border); }
          .sb-title { font-size:1.02rem; font-weight:700; color:var(--primary); }
          .sb-close { background:none; border:none; cursor:pointer; color:var(--foreground); opacity:0.6; padding:4px; display:flex; }
          .sb-body { overflow-y:auto; padding:16px 18px; flex:1; }
          .sb-label { display:block; font-size:0.82rem; font-weight:700; color:var(--foreground); margin:14px 0 4px; }
          .sb-label:first-child { margin-top:0; }
          .sb-hint { font-size:0.72rem; color:var(--foreground); opacity:0.6; margin:0 0 6px; line-height:1.4; }
          .sb-name-row { display:flex; gap:8px; }
          .sb-emoji { width:52px; text-align:center; font-size:1.1rem; background:var(--accent); border:1px solid var(--border); border-radius:10px; padding:9px 0; color:var(--foreground); }
          .sb-input { flex:1; min-width:0; background:var(--accent); border:1px solid var(--border); border-radius:10px; padding:9px 12px; font-size:0.88rem; color:var(--foreground); outline:none; }
          .sb-input:focus { border-color:var(--primary); }
          .sb-textarea { width:100%; background:var(--accent); border:1px solid var(--border); border-radius:10px; padding:10px 12px; font-size:0.86rem; color:var(--foreground); outline:none; resize:vertical; line-height:1.5; font-family:inherit; }
          .sb-textarea:focus { border-color:var(--primary); }
          .sb-refs { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
          .sb-ref { display:flex; align-items:center; gap:8px; background:var(--accent); border:1px solid var(--border); border-radius:8px; padding:7px 10px; }
          .sb-ref-icon { color:var(--primary); flex-shrink:0; display:flex; }
          .sb-ref-name { flex:1; min-width:0; font-size:0.8rem; color:var(--foreground); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .sb-ref-size { font-size:0.7rem; opacity:0.55; flex-shrink:0; }
          .sb-ref-del { background:none; border:none; cursor:pointer; color:#e11d48; opacity:0.7; padding:2px; display:flex; }
          .sb-add-row { display:flex; gap:8px; margin-bottom:8px; }
          .sb-add-btn { display:flex; align-items:center; gap:5px; background:var(--background); border:1.5px solid var(--border); border-radius:10px; padding:7px 14px; font-size:0.8rem; font-weight:600; cursor:pointer; color:var(--foreground); }
          .sb-add-btn:hover:not(:disabled) { border-color:var(--primary); color:var(--primary); }
          .sb-add-btn:disabled { opacity:0.5; }
          .sb-url-row { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
          .sb-url-icon { color:var(--primary); flex-shrink:0; }
          .sb-url-add { flex-shrink:0; background:var(--primary); border:none; color:#fff; border-radius:8px; padding:8px 12px; font-size:0.78rem; font-weight:700; cursor:pointer; }
          .sb-url-add:disabled { opacity:0.5; cursor:default; }
          .sb-text-add { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; padding:10px; background:var(--accent); border-radius:10px; }
          .sb-text-save { align-self:flex-start; background:var(--primary); border:none; color:#fff; border-radius:8px; padding:6px 12px; font-size:0.76rem; font-weight:700; cursor:pointer; }
          .sb-text-save:disabled { opacity:0.5; }
          .sb-busy { display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--primary); margin-top:10px; }
          .sb-spin { animation:sbspin 1s linear infinite; }
          @keyframes sbspin { to { transform:rotate(360deg); } }
          .sb-error { font-size:0.8rem; color:#e11d48; margin-top:10px; line-height:1.4; }
          .sb-footer { display:flex; gap:10px; justify-content:flex-end; padding:14px 18px; border-top:1px solid var(--border); }
          .sb-cancel { background:none; border:1.5px solid var(--border); border-radius:10px; padding:8px 18px; font-size:0.85rem; font-weight:600; cursor:pointer; color:var(--foreground); }
          .sb-save { background:var(--primary); border:none; color:#fff; border-radius:10px; padding:8px 22px; font-size:0.85rem; font-weight:700; cursor:pointer; }
          .sb-save:disabled { opacity:0.5; cursor:default; }
        `}</style>
      </div>
    </div>
  );
}
