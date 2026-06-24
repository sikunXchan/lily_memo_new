'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { setPlan } from '@/lib/points';
import type { Plan } from '@/lib/points';

const PLAN_LABEL: Record<string, string> = {
  plus: 'Plus', pro: 'Pro', max: 'Max', ultimate: 'Ultimate',
};

function PaymentSuccessContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [planLabel, setPlanLabel] = useState('');

  useEffect(() => {
    const plan = params.get('plan') as Plan | null;
    if (!plan || !PLAN_LABEL[plan]) {
      setStatus('error');
      return;
    }
    setPlan(plan);
    setPlanLabel(PLAN_LABEL[plan]);
    setStatus('done');
    const t = setTimeout(() => router.replace('/'), 3000);
    return () => clearTimeout(t);
  }, [params, router]);

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: '#fff8fa', fontFamily: 'sans-serif',
    }}>
      {status === 'loading' && <p style={{ color: '#888' }}>処理中...</p>}
      {status === 'done' && (
        <>
          <div style={{ fontSize: 48 }}>🎉</div>
          <h1 style={{ margin: 0, fontSize: 22, color: '#f06292' }}>
            {planLabel} プランにアップグレードしました！
          </h1>
          <p style={{ color: '#888', margin: 0 }}>3秒後にアプリに戻ります...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <p style={{ color: '#e53935' }}>プランの確認に失敗しました。</p>
          <a href="/" style={{ color: '#f06292' }}>ホームに戻る</a>
        </>
      )}
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#fff8fa',
      }}>
        <p style={{ color: '#888' }}>処理中...</p>
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  );
}
