/**
 * Google Drive sync via the appDataFolder space.
 * Uses Google Identity Services (GIS) for OAuth (implicit / token client) — no SDK dependency.
 *
 * Setup:
 *  1. In Google Cloud Console, create an OAuth client (Web) with the deployed origin in
 *     "Authorized JavaScript origins" (also http://localhost:3000 for dev).
 *  2. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env.local.
 *  3. Add the `https://www.googleapis.com/auth/drive.appdata` scope on the consent screen.
 */

export const DRIVE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const BACKUP_FILENAME = 'lily_memo_backup.json';
const TOKEN_KEY = 'drive:accessToken';
const TOKEN_EXP_KEY = 'drive:tokenExpiresAt';

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: GoogleTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => GoogleTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Identity Services failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.dataset.gisLoader = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Identity Services failed to load'));
    document.head.appendChild(s);
  });
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expAt = Number(sessionStorage.getItem(TOKEN_EXP_KEY) ?? '0');
  if (!token) return null;
  if (Date.now() >= expAt - 30_000) return null;
  return token;
}

function storeToken(token: string, expiresInSec: number) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + expiresInSec * 1000));
}

function clearStoredToken() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXP_KEY);
}

export function driveHasToken(): boolean {
  return readStoredToken() != null;
}

async function requestToken({ silent }: { silent: boolean }): Promise<string> {
  if (!DRIVE_CLIENT_ID) {
    throw new Error('NEXT_PUBLIC_GOOGLE_CLIENT_ID が未設定です');
  }
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services が利用できません');

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        if (!resp.access_token) {
          reject(new Error('アクセストークンを取得できませんでした'));
          return;
        }
        storeToken(resp.access_token, resp.expires_in ?? 3600);
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || 'OAuth エラー'));
      },
    });
    client.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}

async function getToken(): Promise<string> {
  const cached = readStoredToken();
  if (cached) return cached;
  return requestToken({ silent: true });
}

export async function driveSignIn(): Promise<void> {
  await requestToken({ silent: false });
}

export function driveSignOut(): void {
  const token = readStoredToken();
  if (token && typeof window !== 'undefined') {
    window.google?.accounts?.oauth2?.revoke?.(token);
  }
  clearStoredToken();
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

async function driveFetch(url: string, init: RequestInit, token: string): Promise<Response> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (resp.status === 401) {
    clearStoredToken();
    throw new Error('認証の有効期限が切れました。再度ログインしてください');
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Drive API error (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp;
}

async function findBackupFile(token: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${BACKUP_FILENAME}' and trashed=false`,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '5',
  });
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    { method: 'GET' },
    token,
  );
  const data = await resp.json() as { files?: DriveFile[] };
  if (!data.files || data.files.length === 0) return null;
  // Pick the most recently modified
  const sorted = [...data.files].sort((a, b) =>
    (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''),
  );
  return sorted[0];
}

export async function driveUploadBackup(jsonContent: string): Promise<void> {
  const token = await getToken();
  const existing = await findBackupFile(token);

  const blob = new Blob([jsonContent], { type: 'application/json' });

  if (existing) {
    // Update existing file's content
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: blob,
      },
      token,
    );
  } else {
    // Create new in appDataFolder via multipart upload
    const boundary = `lily_${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name: BACKUP_FILENAME,
      parents: ['appDataFolder'],
    };
    const body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      'Content-Type: application/json\r\n\r\n' +
      jsonContent +
      `\r\n--${boundary}--`;
    await driveFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
      token,
    );
  }
}

export async function driveDownloadBackup(): Promise<string | null> {
  const token = await getToken();
  const existing = await findBackupFile(token);
  if (!existing) return null;
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`,
    { method: 'GET' },
    token,
  );
  return resp.text();
}
