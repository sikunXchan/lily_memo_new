'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, Clock, FileText, Link as LinkIcon, ExternalLink } from 'lucide-react';

interface RecentPDF {
  url: string;
  label: string;
  timestamp: number;
}

const STORAGE_KEY = 'lily_recent_pdfs';
const MAX_RECENT = 10;

export default function PDFViewer() {
  const [currentUrl, setCurrentUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [recentPDFs, setRecentPDFs] = useState<RecentPDF[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string>('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setRecentPDFs(JSON.parse(stored));
    } catch {}
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const saveRecent = (url: string, label: string) => {
    const entry: RecentPDF = { url, label, timestamp: Date.now() };
    setRecentPDFs(prev => {
      const next = [entry, ...prev.filter(r => r.label !== label)].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const openUrl = (proxyUrl: string, label: string) => {
    setCurrentUrl(proxyUrl);
    saveRecent(proxyUrl, label);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(trimmed)}`;
    openUrl(proxyUrl, trimmed);
    setInputUrl('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    blobUrlRef.current = objectUrl;
    openUrl(objectUrl, file.name);
    e.target.value = '';
  };

  const closePDF = () => {
    setCurrentUrl('');
  };

  if (currentUrl) {
    return (
      <div className="pdf-fullscreen">
        <div className="pdf-top-bar">
          <button className="pdf-close-btn" onClick={closePDF}>
            <X size={18} />
            <span>閉じる</span>
          </button>
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pdf-newtab-btn"
          >
            <ExternalLink size={18} />
            <span>新しいタブで開く</span>
          </a>
        </div>
        <iframe
          src={currentUrl}
          className="pdf-frame"
          title="PDF Viewer"
          allow="fullscreen"
        />
        <style jsx>{`
          .pdf-fullscreen {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 3000;
            display: flex;
            flex-direction: column;
            background: #525659;
            height: 100dvh;
          }
          .pdf-top-bar {
            height: 48px;
            background: var(--background);
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 16px;
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
          }
          .pdf-close-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            background: transparent;
            color: var(--foreground);
            font-size: 0.9rem;
            font-weight: 600;
            padding: 6px 12px;
            border-radius: 8px;
            transition: background 0.2s;
          }
          .pdf-close-btn:hover {
            background: var(--accent);
          }
          .pdf-newtab-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            background: transparent;
            color: var(--primary);
            font-size: 0.85rem;
            font-weight: 600;
            padding: 6px 12px;
            border-radius: 8px;
            text-decoration: none;
            transition: background 0.2s;
            margin-left: auto;
          }
          .pdf-newtab-btn:hover {
            background: var(--accent);
          }
          .pdf-frame {
            flex: 1;
            width: 100%;
            height: 0;
            min-height: 0;
            border: none;
            display: block;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="pdf-home">
      <div className="pdf-home-inner">
        <div className="pdf-header">
          <FileText size={32} className="pdf-header-icon" />
          <h2>PDF ビューア</h2>
          <p className="pdf-desc">試験問題などのPDFを全画面で快適に閲覧できます</p>
        </div>

        <form onSubmit={handleUrlSubmit} className="url-form">
          <div className="url-input-row">
            <LinkIcon size={16} className="url-icon" />
            <input
              type="url"
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              placeholder="PDFのURLを入力..."
              className="url-input"
            />
          </div>
          <button type="submit" className="btn-open" disabled={!inputUrl.trim()}>
            開く
          </button>
        </form>

        <div className="upload-section">
          <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
            ファイルを選択して開く
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={handleFileUpload}
          />
        </div>

        {recentPDFs.length > 0 && (
          <div className="recent-section">
            <div className="recent-label">
              <Clock size={14} />
              最近開いたPDF
            </div>
            {recentPDFs.map((pdf, i) => (
              <button
                key={i}
                className="recent-item"
                onClick={() => openUrl(pdf.url, pdf.label)}
              >
                <FileText size={16} className="recent-icon" />
                <span className="recent-name">{pdf.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .pdf-home {
          flex: 1;
          overflow-y: auto;
          background: var(--background);
          display: flex;
          justify-content: center;
          padding: 40px 16px calc(60px + env(safe-area-inset-bottom) + 16px);
        }
        .pdf-home-inner {
          width: 100%;
          max-width: 560px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .pdf-header {
          text-align: center;
          padding: 24px 0 8px;
        }
        .pdf-header-icon {
          color: var(--primary);
          margin-bottom: 12px;
        }
        .pdf-header h2 {
          font-size: 1.6rem;
          color: var(--primary);
          margin-bottom: 8px;
        }
        .pdf-desc {
          font-size: 0.85rem;
          color: #888;
        }
        .url-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 20px;
        }
        .url-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .url-icon {
          color: #999;
          flex-shrink: 0;
        }
        .url-input {
          flex: 1;
          border: none;
          background: transparent;
          font-size: 0.95rem;
          color: var(--foreground);
          outline: none;
          min-width: 0;
        }
        .btn-open {
          padding: 12px;
          background: var(--primary);
          color: white;
          font-weight: 700;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          transition: opacity 0.2s;
        }
        .btn-open:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .upload-section {
          display: flex;
          justify-content: center;
        }
        .btn-upload {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          background: transparent;
          border: 2px solid var(--primary);
          color: var(--primary);
          font-weight: 600;
          border-radius: 12px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: background 0.2s;
        }
        .btn-upload:hover {
          background: var(--accent);
        }
        .recent-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .recent-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0 4px 8px;
        }
        .recent-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 12px;
          cursor: pointer;
          text-align: left;
          transition: background 0.2s;
          width: 100%;
        }
        .recent-item:hover {
          background: var(--border);
        }
        .recent-icon {
          color: var(--primary);
          flex-shrink: 0;
        }
        .recent-name {
          flex: 1;
          font-size: 0.85rem;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
