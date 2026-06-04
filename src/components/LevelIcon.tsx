'use client';

import { useState, useEffect } from 'react';
import type { LevelTier } from '@/lib/level';

// Shows the tier's icon image, falling back to its emoji until the PNG exists
// in /public/level/. Once you drop the artwork in, it switches automatically.
export default function LevelIcon({ tier, size }: { tier: LevelTier; size: number }) {
  const [err, setErr] = useState(false);
  // Reset the error state when the tier (icon path) changes.
  useEffect(() => { setErr(false); }, [tier.icon]);

  if (err) {
    return (
      <span style={{ fontSize: Math.round(size * 0.82), lineHeight: 1, display: 'inline-block' }}>
        {tier.emoji}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tier.icon}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setErr(true)}
      style={{ objectFit: 'contain', display: 'block' }}
    />
  );
}
