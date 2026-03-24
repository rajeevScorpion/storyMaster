'use client';

import { useState, useEffect } from 'react';
import { STORY_PROMPTS } from '@/lib/constants/story-prompts';

interface PromptCarouselProps {
  onSelect: (prompt: string) => void;
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const maskStyle = {
  maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
  WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
};

export default function PromptCarousel({ onSelect }: PromptCarouselProps) {
  const [rows, setRows] = useState<[string[], string[]]>([[], []]);

  useEffect(() => {
    const shuffled = shuffle(STORY_PROMPTS);
    const mid = Math.ceil(shuffled.length / 2);
    setRows([shuffled.slice(0, mid), shuffled.slice(mid)]);
  }, []);

  if (rows[0].length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Row 1 — scrolls left */}
      <div className="overflow-hidden" style={maskStyle}>
        <div className="flex w-fit [animation:marquee-left_180s_linear_infinite] hover:[animation-play-state:paused] motion-reduce:[animation:none]">
          {[...rows[0], ...rows[0]].map((prompt, i) => (
            <button
              key={i}
              onClick={() => onSelect(prompt)}
              className="shrink-0 px-4 py-2 mx-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-neutral-400 hover:bg-white/10 hover:border-emerald-500/30 hover:text-white transition-all duration-200 cursor-pointer whitespace-nowrap backdrop-blur-sm"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2 — scrolls right */}
      <div className="overflow-hidden" style={maskStyle}>
        <div className="flex w-fit [animation:marquee-right_200s_linear_infinite] hover:[animation-play-state:paused] motion-reduce:[animation:none]">
          {[...rows[1], ...rows[1]].map((prompt, i) => (
            <button
              key={i}
              onClick={() => onSelect(prompt)}
              className="shrink-0 px-4 py-2 mx-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-neutral-400 hover:bg-white/10 hover:border-emerald-500/30 hover:text-white transition-all duration-200 cursor-pointer whitespace-nowrap backdrop-blur-sm"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
