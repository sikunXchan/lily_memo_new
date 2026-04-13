import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const SYNC_FILE = path.join(process.cwd(), 'sync_data.json');

function getSyncData(): Record<string, unknown> {
  try {
    if (fs.existsSync(SYNC_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8')) as Record<string, unknown>;
    }
  } catch (e) {
    console.error('Error reading sync file:', e);
  }
  return {};
}

function saveSyncData(data: Record<string, unknown>) {
  try {
    fs.writeFileSync(SYNC_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error writing sync file:', e);
  }
}

export async function POST(req: Request) {
  try {
    const { action, code, payload } = await req.json();
    const db = getSyncData();

    if (action === 'push') {
      if (!code || !payload) return NextResponse.json({ success: false, error: 'Invalid data' }, { status: 400 });
      db[code] = payload;
      saveSyncData(db);
      return NextResponse.json({ success: true, message: 'Saved to cloud' });
    } 
    
    if (action === 'pull') {
      if (!code) return NextResponse.json({ success: false, error: 'Invalid code' }, { status: 400 });
      const data = db[code];
      if (data) {
        return NextResponse.json({ success: true, data });
      } else {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      }
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
  
  return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
}
