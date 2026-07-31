'use client';

import { useState } from 'react';
import Image from 'next/image';
import { UserRound } from 'lucide-react';

export default function UserAvatar({
  src,
  name,
  size = 44,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-emerald-500/10 text-emerald-300"
        style={{ width: size, height: size }}
        aria-label={name}
      >
        <UserRound style={{ width: size * 0.42, height: size * 0.42 }} />
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full border border-white/10 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
