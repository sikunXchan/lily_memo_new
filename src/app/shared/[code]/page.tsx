import { notFound } from 'next/navigation';
import { serverDb, shares, notesServer } from '@/lib/server-db';
import { eq } from 'drizzle-orm';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function SharedNotePage({ params }: Props) {
  const { code } = await params;

  const share = await serverDb.select().from(shares)
    .where(eq(shares.shareCode, code))
    .get();

  if (!share) notFound();
  if (share.expiresAt && share.expiresAt < Date.now()) notFound();

  const note = await serverDb.select().from(notesServer)
    .where(eq(notesServer.id, share.noteId))
    .get();

  if (!note || note.deletedAt) notFound();

  return (
    <div className="shared-page">
      <header className="shared-header">
        <div className="shared-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Lily Memo" width={32} height={32} />
          <span>Lily Memo</span>
        </div>
        <span className="shared-badge">共有メモ</span>
      </header>

      <main className="shared-main">
        <h1 className="shared-title">{note.title}</h1>
        <div
          className="shared-content ProseMirror"
          dangerouslySetInnerHTML={{ __html: note.content }}
        />
      </main>

      <style>{`
        .shared-page {
          min-height: 100vh;
          background: var(--bg, #fff);
          color: var(--text, #333);
          font-family: var(--font-outfit, sans-serif);
        }
        .shared-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border, #eee);
        }
        .shared-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1.1rem;
          font-weight: 700;
        }
        .shared-brand img { border-radius: 8px; }
        .shared-badge {
          font-size: 0.75rem;
          padding: 3px 10px;
          border-radius: 999px;
          background: #ffb6c133;
          color: #c05080;
        }
        .shared-main {
          max-width: 780px;
          margin: 0 auto;
          padding: 40px 24px;
        }
        .shared-title {
          font-size: 1.8rem;
          font-weight: 700;
          margin-bottom: 24px;
        }
        .shared-content { line-height: 1.7; }
      `}</style>
    </div>
  );
}
