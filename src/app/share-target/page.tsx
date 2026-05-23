'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { db, newSyncId } from '@/lib/db';

// ── helpers ──────────────────────────────────────────────────────────────────

function buildTitle(title: string, text: string, filename?: string): string {
  if (title.trim()) return title.trim();
  if (filename) return filename.replace(/\.[^.]+$/, '');
  const first = text.trim().split('\n')[0].slice(0, 50);
  return first || '共有ノート';
}

function buildContent(text: string, url: string): string {
  const parts: string[] = [];
  if (text.trim()) {
    parts.push(text.trim().split('\n').map(l => `<p>${escHtml(l) || '<br>'}</p>`).join(''));
  }
  if (url.trim()) {
    const safeUrl = escHtml(url.trim());
    parts.push(`<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>`);
  }
  return parts.join('') || '<p></p>';
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// ── core logic ───────────────────────────────────────────────────────────────

async function createNoteFromShare(params: URLSearchParams): Promise<string> {
  const title   = params.get('title') ?? '';
  const text    = params.get('text')  ?? '';
  const url     = params.get('url')   ?? '';
  const hasFile = params.get('hasFile') === '1';

  const now = Date.now();

  if (hasFile) {
    const cache = await caches.open('share-target-temp');
    const resp  = await cache.match('/share-target-pending-file');

    if (resp) {
      const blob     = await resp.blob();
      const filename = decodeURIComponent(resp.headers.get('X-File-Name') ?? 'file');
      await cache.delete('/share-target-pending-file');

      const noteTitle = buildTitle(title, text, filename);

      if (blob.type.startsWith('image/')) {
        // Embed image inline as a data URL so it persists in IndexedDB HTML.
        const dataUrl = await blobToDataUrl(blob);
        const img = `<img src="${dataUrl}" alt="${escHtml(filename)}" style="max-width:100%">`;
        const extra = buildContent(text, url);
        const content = img + (extra !== '<p></p>' ? extra : '');
        await db.notes.add({ syncId: newSyncId(), title: noteTitle, content, createdAt: now, updatedAt: now });
        return noteTitle;
      }

      if (blob.type === 'text/plain' || blob.type === 'text/markdown') {
        const raw = await blob.text();
        const content = buildContent(raw, url);
        await db.notes.add({ syncId: newSyncId(), title: noteTitle, content, createdAt: now, updatedAt: now });
        return noteTitle;
      }

      // PDF or unknown: just record the filename with any text
      const content = `<p>📎 ${escHtml(filename)}</p>` + buildContent(text, url);
      await db.notes.add({ syncId: newSyncId(), title: noteTitle, content, createdAt: now, updatedAt: now });
      return noteTitle;
    }
  }

  // Text / URL only share
  const noteTitle = buildTitle(title, text);
  const content   = buildContent(text, url);
  await db.notes.add({ syncId: newSyncId(), title: noteTitle, content, createdAt: now, updatedAt: now });
  return noteTitle;
}

// ── UI ───────────────────────────────────────────────────────────────────────

type Phase = 'creating' | 'done' | 'error';

function ShareTargetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('creating');
  const [noteTitle, setNoteTitle] = useState('');

  useEffect(() => {
    // Bare navigation (no params + no file) → go home immediately.
    const hasContent = params.get('text') || params.get('url') || params.get('title') || params.get('hasFile');
    if (!hasContent) { router.replace('/'); return; }

    createNoteFromShare(params)
      .then(t => { setNoteTitle(t); setPhase('done'); })
      .catch(() => setPhase('error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'done') return;
    const t = window.setTimeout(() => router.replace('/'), 1600);
    return () => clearTimeout(t);
  }, [phase, router]);

  return (
    <div className="wrap">
      {phase === 'creating' && (
        <>
          <div className="spin" />
          <p className="label">ノートを作成中…</p>
        </>
      )}
      {phase === 'done' && (
        <>
          <div className="check">✓</div>
          <p className="label done">追加しました</p>
          <p className="sub">{noteTitle}</p>
        </>
      )}
      {phase === 'error' && (
        <>
          <p className="label">ノートの作成に失敗しました</p>
          <button className="btn" onClick={() => router.replace('/')}>ホームへ</button>
        </>
      )}

      <style jsx>{`
        .wrap {
          position: fixed; inset: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
          background: linear-gradient(160deg, #fff5fb 0%, #f0f5ff 60%, #fff8f0 100%);
          font-family: var(--font-body, sans-serif);
        }
        .spin {
          width: 52px; height: 52px; border-radius: 50%;
          border: 4px solid rgba(255,142,199,0.25);
          border-top-color: #ff8ec7;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .check {
          width: 64px; height: 64px; border-radius: 50%;
          background: linear-gradient(135deg, #ff8ec7, #c79bff);
          display: flex; align-items: center; justify-content: center;
          font-size: 32px; color: #fff;
          animation: pop 0.4s cubic-bezier(0.16,1.4,0.35,1);
        }
        @keyframes pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .label { margin: 0; font-size: 1rem; font-weight: 700; color: var(--foreground, #333); }
        .label.done { color: #c060a0; }
        .sub { margin: 0; font-size: 0.85rem; color: #999; max-width: 80vw; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .btn { padding: 10px 24px; border-radius: 99px; border: none; background: #ff8ec7; color: #fff; font-weight: 700; cursor: pointer; }
      `}</style>
    </div>
  );
}

export default function ShareTargetPage() {
  return (
    <Suspense>
      <ShareTargetInner />
    </Suspense>
  );
}
