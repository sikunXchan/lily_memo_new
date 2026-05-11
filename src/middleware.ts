import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isApiSync = req.nextUrl.pathname.startsWith('/api/sync');

  if (isApiSync && !req.auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/api/sync/:path*'],
};
