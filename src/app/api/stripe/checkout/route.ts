import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PLAN_PRICES: Record<string, { name: string; amount: number }> = {
  plus:     { name: 'Lily Memo Plus',     amount: 100 },
  pro:      { name: 'Lily Memo Pro',      amount: 200 },
  max:      { name: 'Lily Memo Max',      amount: 500 },
  ultimate: { name: 'Lily Memo Ultimate', amount: 750 },
};

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  let body: { plan?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const plan = body.plan ?? '';
  const price = PLAN_PRICES[plan];
  if (!price) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
  }

  const origin = req.headers.get('origin') ?? `https://${req.headers.get('host')}`;
  const stripe = new Stripe(secretKey);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'jpy',
        product_data: { name: price.name },
        unit_amount: price.amount,
      },
      quantity: 1,
    }],
    metadata: { plan },
    success_url: `${origin}/payment/success?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}/`,
  });

  return NextResponse.json({ url: session.url });
}
