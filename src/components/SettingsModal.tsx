'use client';

import { Download, Upload, Type, Sparkles, Wifi, User, Home, Gauge, Palette, Lock, Shirt } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { buildBackupJson, restoreBackupFromJson, buildSyncJson, restoreSyncFromJson } from '@/lib/backup';
import { useTheme } from './ThemeContext';
import { useCharacterSkin } from './CharacterSkinContext';
import { FONT_OPTIONS, THEME_LIST, THEMES, SEASONAL_SKINS } from '@/lib/themes';
import { CHARACTER_SKINS, SKIN_BASE_PATH } from '@/lib/characterSkins';
import { getUserName, setUserName } from '@/lib/appLang';
import { useT } from '@/lib/i18n';
import PlanModal from '@/components/PlanModal';
import { getPlan, getRemainingTokens, PLAN_LABEL, PLAN_DAILY_TOKENS, formatTokens } from '@/lib/points';

function randCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const t = useT();
  const [isPersisted, setIsPersisted] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planLabel, setPlanLabel] = useState('');
  const [planRemaining, setPlanRemaining] = useState(0);
  const [planDaily, setPlanDaily] = useState(0);
  const { fontId, setFontId, themeId, setThemeId, skinsUnlocked, unlockSkins, isSkinLocked } = useTheme();
  const [skinCode, setSkinCode] = useState('');
  const [skinCodeError, setSkinCodeError] = useState(false);
  const [showSkinUnlock, setShowSkinUnlock] = useState(false);
  const submitSkinCode = () => {
    if (unlockSkins(skinCode)) { setSkinCode(''); setSkinCodeError(false); setShowSkinUnlock(false); }
    else setSkinCodeError(true);
  };
  const { skinId: charSkinId, setSkinId: setCharSkinId } = useCharacterSkin();
  const [charSkinCode, setCharSkinCode] = useState('');
  const [charSkinCodeError, setCharSkinCodeError] = useState(false);
  const [showCharSkinUnlock, setShowCharSkinUnlock] = useState(false);
  const submitCharSkinCode = () => {
    if (unlockSkins(charSkinCode)) { setCharSkinCode(''); setCharSkinCodeError(false); setShowCharSkinUnlock(false); }
    else setCharSkinCodeError(true);
  };
  const [geminiKey, setGeminiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [defaultResponseMode, setDefaultResponseModeState] = useState<'lite' | 'stable'>('lite');
  const [sikunEnabled, setSikunEnabled] = useState(false);
  const [sikunTone, setSikunTone] = useState('tame');
  const [userName, setUserNameState] = useState('');
  const [nameSaved, setNameSaved] = useState(false);

  // Live sync state
  const [liveKey, setLiveKey]         = useState('');
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveSaved, setLiveSaved]     = useState(false);

  // Manual sync state
  const [syncMode, setSyncMode] = useState<'export' | 'import'>('export');
  const [syncCode, setSyncCode] = useState('');
  const [syncInput, setSyncInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(setIsPersisted);
    }
    setGeminiKey(localStorage.getItem('lily_gemini_api_key') || '');
    setUserNameState(getUserName());
    setLiveKey(localStorage.getItem('lily_livesync_key') || '');
    setLiveEnabled(localStorage.getItem('lily_livesync_enabled') === '1');
    setSikunEnabled(localStorage.getItem('lily_instance_sikun_enabled') === '1');
    setDefaultResponseModeState(localStorage.getItem('lily_economy_mode') === '0' ? 'stable' : 'lite');
    const plan = getPlan();
    setPlanLabel(PLAN_LABEL[plan]);
    setPlanRemaining(getRemainingTokens());
    setPlanDaily(PLAN_DAILY_TOKENS[plan]);
    // 武士モードは廃止。旧設定が残っていればタメ口に移行する。
    const savedTone = localStorage.getItem('lily_sikun_tone');
    if (savedTone && savedTone !== 'bushi') {
      setSikunTone(savedTone);
    } else {
      setSikunTone('tame');
      localStorage.setItem('lily_sikun_tone', 'tame');
    }
  }, []);

  const changeDefaultResponseMode = (mode: 'lite' | 'stable') => {
    setDefaultResponseModeState(mode);
    localStorage.setItem('lily_economy_mode', mode === 'lite' ? '1' : '0');
    window.dispatchEvent(new Event('lily-settings-changed'));
  };

  const toggleSikun = () => {
    const next = !sikunEnabled;
    setSikunEnabled(next);
    localStorage.setItem('lily_instance_sikun_enabled', next ? '1' : '0');
    window.dispatchEvent(new Event('lily-settings-changed'));
  };

  const changeTone = (tone: string) => {
    setSikunTone(tone);
    localStorage.setItem('lily_sikun_tone', tone);
  };

  const saveLiveSync = () => {
    const k = liveKey.trim();
    localStorage.setItem('lily_livesync_key', k);
    localStorage.setItem('lily_livesync_enabled', liveEnabled && k ? '1' : '0');
    window.dispatchEvent(new Event('lily-settings-changed'));
    setLiveSaved(true);
    setTimeout(() => setLiveSaved(false), 2000);
  };

  const toggleLiveSync = () => {
    const next = !liveEnabled;
    setLiveEnabled(next);
    localStorage.setItem('lily_livesync_enabled', next && liveKey.trim() ? '1' : '0');
    window.dispatchEvent(new Event('lily-settings-changed'));
  };

  const saveGeminiKey = () => {
    localStorage.setItem('lily_gemini_api_key', geminiKey.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const saveUserName = () => {
    setUserName(userName);
    setUserNameState(userName.trim());
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const doExport = useCallback(async () => {
    setSyncStatus('loading');
    setSyncMsg('');
    try {
      const code = randCode();
      const payload = await buildSyncJson();
      const res = await fetch(`/api/sync/${code}`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSyncCode(code);
      setSyncStatus('ok');
      setSyncMsg(t('コードを相手のデバイスに入力してください。5分間有効です。'));
    } catch (e) {
      setSyncStatus('error');
      setSyncMsg(e instanceof Error ? e.message : t('エラーが発生しました'));
    }
  }, [t]);

  const doImport = useCallback(async () => {
    const code = syncInput.trim().toUpperCase();
    if (!code) return;
    setSyncStatus('loading');
    setSyncMsg('');
    try {
      const res = await fetch(`/api/sync/${code}`);
      if (res.status === 404) throw new Error(t('コードが見つかりません。期限切れか間違いがあります。'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const jsonText = await res.text();
      await restoreSyncFromJson(jsonText);
      setSyncStatus('ok');
      setSyncMsg(t('同期完了！すべてのデータを取り込みました。'));
      setSyncInput('');
    } catch (e) {
      setSyncStatus('error');
      setSyncMsg(e instanceof Error ? e.message : t('エラーが発生しました'));
    }
  }, [syncInput, t]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(syncCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [syncCode]);

  const downloadBackup = async () => {
    const json = await buildBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lily-memo-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') throw new Error('Failed to read file content');
        if (!confirm(t('現在のデータを上書きしてバックアップを復元しますか？'))) return;
        await restoreBackupFromJson(text);
        alert(t('復元が完了しました。ページを再読み込みします。'));
        window.location.reload();
      } catch (err) {
        console.error('Backup restore error:', err);
        alert(t('バックアップファイルの読み込みに失敗しました。'));
      }
    };
    reader.onerror = () => alert(t('ファイルの読み込みに失敗しました。'));
    reader.readAsText(file, 'UTF-8');
  };

  return (
    <>
    <div className="settings-view">
      <header className="settings-header">
        <h2>{t('設定')}</h2>
        <button className="settings-home-btn" onClick={onClose} title={t('ホームに戻る')}>
          <Home size={16} />
          <span>{t('ホーム')}</span>
        </button>
      </header>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="section-title">
            <User size={20} />
            <h3>{t('あなたの名前')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('名前を設定すると、Lilyがチャット・日記・授業であなたの名前で呼びかけてくれます。')}</p>
            <div className="api-key-wrap">
              <input
                type="text"
                className="api-key-input"
                placeholder={t('例：さくら')}
                value={userName}
                maxLength={20}
                onChange={e => setUserNameState(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveUserName(); }}
              />
            </div>
            <button className={`btn-action ${nameSaved ? 'saved' : ''}`} onClick={saveUserName}>
              {nameSaved ? t('✓ 保存しました') : t('保存する')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Palette size={20} />
            <h3>{t('テーマ')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('アプリ全体の配色を選べます。🔒 のテーマは解放コードで開放できます。')}</p>
            <div className="skin-grid">
              {THEME_LIST.map(id => {
                const th = THEMES[id];
                const locked = isSkinLocked(id);
                const season = SEASONAL_SKINS[id];
                return (
                  <button
                    key={id}
                    className={`skin-card ${themeId === id ? 'selected' : ''} ${locked ? 'locked' : ''}`}
                    onClick={() => locked ? setShowSkinUnlock(true) : setThemeId(id)}
                  >
                    <span className="skin-swatch" style={{ background: th.bg, borderColor: th.border }}>
                      <span className="skin-dot" style={{ background: th.primary }} />
                      <span className="skin-dot" style={{ background: th.folders.blue }} />
                      <span className="skin-dot" style={{ background: th.folders.green }} />
                      {locked && <span className="skin-lock"><Lock size={13} /></span>}
                    </span>
                    <span className="skin-name">{t(th.name)}</span>
                    {season && <span className="skin-season">{t(season)}</span>}
                  </button>
                );
              })}
            </div>
            {!skinsUnlocked && (
              showSkinUnlock ? (
                <div className="skin-unlock">
                  <input
                    className="skin-code-input"
                    value={skinCode}
                    onChange={e => { setSkinCode(e.target.value); setSkinCodeError(false); }}
                    onKeyDown={e => { if (e.key === 'Enter') submitSkinCode(); }}
                    placeholder={t('解放コード')}
                  />
                  <button className="btn-action" onClick={submitSkinCode}>{t('解放')}</button>
                  {skinCodeError && <span className="skin-code-err">{t('コードが違うみたい')}</span>}
                </div>
              ) : (
                <button className="skin-unlock-open" onClick={() => setShowSkinUnlock(true)}>
                  <Lock size={13} /> {t('テーマを解放する')}
                </button>
              )
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Shirt size={20} />
            <h3>{t('キャラクタースキン')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('チャットや各画面のLilyの見た目を着せ替えられます。🔒 は解放コードで開放できます。')}</p>
            <div className="skin-grid">
              <button
                className={`skin-card charskin-card ${charSkinId === '' ? 'selected' : ''}`}
                onClick={() => setCharSkinId('')}
              >
                <span className="charskin-thumb-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png" alt="" className="charskin-thumb" />
                </span>
                <span className="skin-name">{t('デフォルト')}</span>
              </button>
              {CHARACTER_SKINS.map(sk => {
                const locked = !skinsUnlocked;
                return (
                  <button
                    key={sk.id}
                    className={`skin-card charskin-card ${charSkinId === sk.id ? 'selected' : ''} ${locked ? 'locked' : ''}`}
                    onClick={() => locked ? setShowCharSkinUnlock(true) : setCharSkinId(sk.id)}
                  >
                    <span className="charskin-thumb-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${SKIN_BASE_PATH}${sk.file}`} alt="" className="charskin-thumb" loading="lazy" />
                      {locked && <span className="skin-lock"><Lock size={13} /></span>}
                    </span>
                    <span className="skin-name">{t(sk.name)}</span>
                    {sk.seasonal && <span className="skin-season">{t(sk.seasonal)}</span>}
                  </button>
                );
              })}
            </div>
            {!skinsUnlocked && (
              showCharSkinUnlock ? (
                <div className="skin-unlock">
                  <input
                    className="skin-code-input"
                    value={charSkinCode}
                    onChange={e => { setCharSkinCode(e.target.value); setCharSkinCodeError(false); }}
                    onKeyDown={e => { if (e.key === 'Enter') submitCharSkinCode(); }}
                    placeholder={t('解放コード')}
                  />
                  <button className="btn-action" onClick={submitCharSkinCode}>{t('解放')}</button>
                  {charSkinCodeError && <span className="skin-code-err">{t('コードが違うみたい')}</span>}
                </div>
              ) : (
                <button className="skin-unlock-open" onClick={() => setShowCharSkinUnlock(true)}>
                  <Lock size={13} /> {t('スキンを解放する')}
                </button>
              )
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Type size={20} />
            <h3>{t('フォント')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('アプリ全体の文字の書体を選べます。')}</p>
            <div className="option-grid">
              {FONT_OPTIONS.map(f => (
                <button
                  key={f.id}
                  className={`option-card ${fontId === f.id ? 'selected' : ''}`}
                  onClick={() => setFontId(f.id)}
                >
                  <span
                    className="font-preview"
                    style={{ fontFamily: f.value || 'inherit' }}
                  >
                    あA
                  </span>
                  <span className="option-name">{t(f.name)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Gauge size={20} />
            <h3>{t('デフォルトの応答モード')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('チャットを開いたときの初期モードを選べます。軽量モードは速くて消費ポイントも少ない代わりに回答の品質が下がります。安定モードは以前までの通常モードと同じ品質です。')}</p>
            <div className="option-grid">
              <button
                className={`option-card ${defaultResponseMode === 'lite' ? 'selected' : ''}`}
                onClick={() => changeDefaultResponseMode('lite')}
              >
                <span className="option-name">{t('🪶 軽量モード')}</span>
                <span className="option-tag">{t('デフォルト・低コスト')}</span>
              </button>
              <button
                className={`option-card ${defaultResponseMode === 'stable' ? 'selected' : ''}`}
                onClick={() => changeDefaultResponseMode('stable')}
              >
                <span className="option-name">{t('🌸 安定モード')}</span>
                <span className="option-tag">{t('高品質・旧通常モード')}</span>
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Sparkles size={20} />
            <h3>{t('AIアシスタント (Lily)')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('Gemini APIキーを設定すると、Lilyがメモの分析・図の作成・問題作りをお手伝いします。')}</p>
            <div className="api-key-wrap">
              <input
                type="password"
                className="api-key-input"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveGeminiKey(); }}
                onContextMenu={e => e.preventDefault()}
                onCopy={e => e.preventDefault()}
              />
            </div>
            <button className={`btn-action ${keySaved ? 'saved' : ''}`} onClick={saveGeminiKey}>
              {keySaved ? t('✓ 保存しました') : t('保存する')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Sparkles size={20} />
            <h3>{t('sikun（常駐アシスタント）')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">
              {t('ONにすると、どの画面でも上部にsikunのアイコンが現れて、タップで話しかけられるよ。')}<br />
              {t('長押しでアイコンの位置を動かせる。会話パネルを開いてもメモ編集やタブ切り替えはそのままできるから、作業を止めなくていい。')}
            </p>
            <div className="toggle-row">
              <span className="toggle-state">{sikunEnabled ? t('有効') : t('無効')}</span>
              <button
                className={`toggle-switch ${sikunEnabled ? 'on' : ''}`}
                onClick={toggleSikun}
                role="switch"
                aria-checked={sikunEnabled}
                aria-label="sikun"
              >
                <span className="toggle-knob" />
              </button>
            </div>

            {sikunEnabled && (
              <>
                <p className="desc" style={{ marginTop: 20, marginBottom: 10 }}>{t('口調を選べるよ。')}</p>
                <div className="option-grid">
                  {[
                    { id: 'tame', name: 'タメ口', tag: 'デフォルト' },
                    { id: 'keigo', name: '敬語', tag: 'ていねい' },
                    { id: 'casual', name: 'カジュアル', tag: '絵文字あり' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      className={`option-card ${sikunTone === opt.id ? 'selected' : ''}`}
                      onClick={() => changeTone(opt.id)}
                    >
                      <span className="option-name">{t(opt.name)}</span>
                      <span className="option-tag">{t(opt.tag)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Wifi size={20} />
            <h3>{t('自動同期')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">
              {t('同じ共有キーを設定した端末間で、メモ・フォルダ・勉強記録・プランとトークン残量を自動で同期します。何も操作しなくても、変更から約30秒以内にもう一方の端末に反映されます。')}
            </p>
            <div className="toggle-row" style={{ marginBottom: 16 }}>
              <span className="toggle-state">{liveEnabled ? t('同期中') : t('停止中')}</span>
              <button
                className={`toggle-switch ${liveEnabled ? 'on' : ''}`}
                onClick={toggleLiveSync}
                role="switch"
                aria-checked={liveEnabled}
                aria-label={t('自動同期')}
              >
                <span className="toggle-knob" />
              </button>
              {liveEnabled && liveKey.trim() && (
                <span className="live-badge">● LIVE</span>
              )}
            </div>
            <div className="api-key-wrap">
              <input
                type="text"
                className="api-key-input"
                placeholder={t('共有キー（例: mystudy2024）')}
                value={liveKey}
                onChange={e => setLiveKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveLiveSync(); }}
              />
            </div>
            <p className="desc" style={{ marginBottom: 12, marginTop: -8 }}>
              {t('両方の端末で同じキーを入力して保存してください。英数字なら何でもOK。')}
            </p>
            <button className={`btn-action ${liveSaved ? 'saved' : ''}`} onClick={saveLiveSync}>
              {liveSaved ? t('✓ 保存しました') : t('保存する')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Sparkles size={20} />
            <h3>{t('プラン・ポイント')}</h3>
          </div>
          <div className="section-content">
            <p className="desc">{t('現在のプラン：')}<strong>{planLabel}</strong>　{t('残り：')}<strong>{formatTokens(planRemaining)} / {formatTokens(planDaily)} トークン</strong></p>
            <button className="btn-action" onClick={() => setShowPlanModal(true)}>
              {t('プランを変更・確認')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Download size={20} />
            <h3>{t('バックアップと復元')}</h3>
          </div>
          <div className="section-content">
            <div className="status-badge">
              <div className={`dot ${isPersisted ? 'persisted' : ''}`} />
              <span>{t('ストレージ永続化:')} {isPersisted ? t('有効（安全）') : t('標準')}</span>
            </div>
            <p className="desc">{t('手元にローカルコピーを残したい時にどうぞ。別の端末でもこのファイルを取り込めば同じ内容を見られます。')}</p>
            <div className="action-group">
              <button className="btn-action" onClick={downloadBackup}>
                <Download size={18} />
                {t('バックアップをダウンロード')}
              </button>
              <label className="btn-action outline">
                <Upload size={18} />
                {t('復元ファイルをアップロード')}
                <input type="file" hidden onChange={uploadBackup} accept=".json,application/json" />
              </label>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .settings-view {
          padding: 32px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          background: var(--background);
        }
        .settings-header {
          max-width: 600px;
          margin: 0 auto 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .settings-home-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 20px;
          border: 1.5px solid var(--border);
          background: var(--accent); color: var(--foreground);
          font-size: 0.85rem; font-weight: 700; cursor: pointer;
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .settings-home-btn:hover { background: var(--border); }
        .settings-header h2 {
          font-size: 1.8rem;
          color: var(--primary);
        }
        .settings-sections {
          max-width: 600px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 40px;
        }
        .settings-section {
          background: var(--accent);
          border: 1px solid var(--border);
          padding: 24px;
          border-radius: 16px;
        }
        .section-title {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--primary);
          margin-bottom: 20px;
        }
        .section-title h3 {
          margin: 0;
          font-size: 1.1rem;
        }
        .option-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 10px;
        }
        .option-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 12px;
          background: var(--surface, var(--background));
          border: 2px solid var(--border);
          border-radius: 12px;
          cursor: pointer;
          transition: border-color 0.15s, transform 0.15s;
          text-align: left;
        }
        .option-card:hover {
          transform: translateY(-1px);
        }
        .option-card.selected {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent);
        }
        .skin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; }
        .skin-card { display: flex; flex-direction: column; align-items: stretch; gap: 5px; padding: 6px; border: 1.5px solid var(--border); border-radius: 12px; background: var(--surface, var(--background)); cursor: pointer; font-family: inherit; transition: border-color 0.14s, box-shadow 0.14s; }
        .skin-card.selected { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent); }
        .skin-card.locked { opacity: 0.85; }
        .skin-swatch { position: relative; height: 44px; border-radius: 8px; border: 1px solid; display: flex; align-items: center; justify-content: center; gap: 5px; }
        .skin-dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
        .skin-lock { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.34); color: #fff; border-radius: 8px; }
        .charskin-thumb-wrap { position: relative; height: 96px; border-radius: 8px; overflow: hidden; background: var(--accent, #fff0f5); }
        .charskin-thumb { width: 100%; height: 100%; object-fit: contain; object-position: bottom center; }
        .skin-name { font-size: 0.76rem; font-weight: 700; color: var(--foreground); text-align: center; }
        .skin-season { font-size: 0.6rem; font-weight: 800; color: #d97706; background: color-mix(in srgb, #f59e0b 20%, transparent); border-radius: 999px; padding: 1px 6px; align-self: center; }
        .skin-unlock { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .skin-code-input { flex: 1; min-width: 140px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--background); color: var(--foreground); font-family: inherit; font-size: 0.9rem; outline: none; }
        .skin-code-input:focus { border-color: var(--primary); }
        .skin-code-err { font-size: 0.78rem; color: #dc2626; font-weight: 600; width: 100%; }
        .skin-unlock-open { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--fg-muted, #888); font-size: 0.82rem; font-weight: 700; cursor: pointer; font-family: inherit; }
        .skin-unlock-open:hover { border-color: var(--primary); color: var(--primary); }
        .swatch {
          width: 100%;
          height: 38px;
          border-radius: 8px;
          border: 1px solid;
          position: relative;
          margin-bottom: 4px;
        }
        .swatch-dot {
          position: absolute;
          right: 6px;
          bottom: 6px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        .font-preview {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground);
          margin-bottom: 2px;
        }
        .option-name {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--foreground);
        }
        .option-tag {
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--fg-faint);
        }
        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--fg-muted);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--fg-faint);
        }
        .dot.persisted {
          background: #22863a;
          box-shadow: 0 0 8px rgba(34, 134, 58, 0.4);
        }
        .desc {
          font-size: 0.85rem;
          color: var(--fg-muted);
          margin-bottom: 20px;
          line-height: 1.6;
        }
        .action-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .btn-action {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          background: var(--primary);
          color: white;
          font-weight: 600;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .btn-action.outline {
          background: transparent;
          border: 2px solid var(--primary);
          color: var(--primary);
          cursor: pointer;
        }
        .btn-action.saved {
          background: #22863a;
        }
        .api-key-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .api-key-input {
          flex: 1;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 0.9rem;
          color: var(--foreground);
          outline: none;
          font-family: monospace;
        }
        .api-key-input:focus { border-color: var(--primary); }
        .toggle-row {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .toggle-state {
          font-size: 0.88rem;
          font-weight: 700;
          color: var(--fg-muted);
        }
        .toggle-switch {
          position: relative;
          width: 52px;
          height: 30px;
          border-radius: 999px;
          background: var(--border);
          border: none;
          cursor: pointer;
          transition: background 0.18s;
        }
        .toggle-switch.on {
          background: var(--primary);
        }
        .toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: transform 0.18s;
        }
        .toggle-switch.on .toggle-knob {
          transform: translateX(22px);
        }

        .live-badge {
          font-size: 0.68rem;
          font-weight: 800;
          color: #10b981;
          letter-spacing: 0.08em;
          animation: live-pulse 2s ease-in-out infinite;
        }
        @keyframes live-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }

        .sync-mode-row {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
        }
        .sync-mode-btn {
          flex: 1;
          padding: 9px 12px;
          border-radius: 10px;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
          background: var(--background);
          border: 1.5px solid var(--border);
          color: var(--fg-muted);
          transition: all 0.15s;
          font-family: inherit;
        }
        .sync-mode-btn.active {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
        }
        .sync-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sync-code-display {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px;
        }
        .sync-code-label {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--fg-muted);
        }
        .sync-code-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .sync-code-val {
          font-size: 2rem;
          font-weight: 900;
          letter-spacing: 0.15em;
          color: var(--primary);
          font-variant-numeric: tabular-nums;
          flex: 1;
        }
        .sync-copy-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          color: var(--fg-muted);
          font-family: inherit;
        }
        .sync-input {
          width: 100%;
          background: var(--background);
          border: 1.5px solid var(--border);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 1.1rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: var(--foreground);
          outline: none;
          font-family: inherit;
          text-transform: uppercase;
          box-sizing: border-box;
        }
        .sync-input:focus { border-color: var(--primary); }
        .sync-msg {
          font-size: 0.8rem;
          font-weight: 600;
          padding: 8px 12px;
          border-radius: 8px;
        }
        .sync-warn {
          font-size: 0.75rem;
          font-weight: 600;
          color: #f59e0b;
          background: rgba(245,158,11,0.1);
          border: 1px solid rgba(245,158,11,0.3);
          border-radius: 8px;
          padding: 7px 10px;
        }
        .sync-msg.sync-ok { background: rgba(16,185,129,0.12); color: #10b981; }
        .sync-msg.sync-error { background: rgba(239,68,68,0.12); color: #ef4444; }

        @media (max-width: 768px) {
          .settings-view {
            padding: 24px 16px;
          }
          .settings-header h2 {
            font-size: 1.5rem;
          }
          .settings-section {
            padding: 16px;
          }
        }
      `}</style>
    </div>
    {showPlanModal && <PlanModal onClose={() => { setShowPlanModal(false); const p = getPlan(); setPlanLabel(PLAN_LABEL[p]); setPlanRemaining(getRemainingTokens()); setPlanDaily(PLAN_DAILY_TOKENS[p]); }} />}
  </>
  );
}
