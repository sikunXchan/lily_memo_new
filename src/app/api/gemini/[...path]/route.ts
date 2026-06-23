import type { NextRequest } from 'next/server';

// Server-side proxy to the Gemini API. The API key lives only in a server
// environment variable (GEMINI_API_KEY) — never in the client bundle or the
// repo. The English ("zero-config") mode of the app routes its Gemini calls
// through here so reviewers can try it without supplying their own key. The
// Japanese mode keeps calling Gemini directly with the user's own key.
//
// Set GEMINI_API_KEY in the deployment environment (e.g. Vercel project env).
// IMPORTANT: also cap usage with a Google Cloud budget / quota — anyone using
// the English mode spends against this key.

const GEMINI_HOST = 'https://generativelanguage.googleapis.com';
// Only forward the Gemini surfaces the app actually uses.
const ALLOWED_PREFIX = /^(v1|v1beta|v1alpha|upload\/v1beta)\//;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handle(req: NextRequest, pathParts: string[]): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return jsonError('server Gemini key not configured', 500);

  const path = pathParts.join('/');
  if (!ALLOWED_PREFIX.test(path)) return jsonError('path not allowed', 400);

  // Rebuild the query string with the server key (drop any client-sent key).
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete('key');
  params.set('key', key);
  const target = `${GEMINI_HOST}/${path}?${params.toString()}`;

  // Forward the content type and the File-API upload headers, nothing else.
  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  for (const h of [
    'x-goog-upload-protocol', 'x-goog-upload-command',
    'x-goog-upload-offset', 'x-goog-upload-header-content-length',
    'api-revision',
  ]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    return jsonError(`upstream fetch failed: ${(e as Error).message}`, 502);
  }

  // Stream the response body straight through (preserves SSE for streaming).
  const respHeaders = new Headers();
  const uct = upstream.headers.get('content-type');
  if (uct) respHeaders.set('Content-Type', uct);
  respHeaders.set('Cache-Control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handle(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handle(req, path);
}
