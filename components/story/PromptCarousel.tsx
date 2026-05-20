'use client';

import { STORY_PROMPTS } from '@/lib/constants/story-prompts';

interface PromptCarouselProps {
  onSelect: (prompt: string) => void;
}

function stableShuffle<T>(array: T[]): T[] {
  const arr = [...array];
  let seed = 0x5f3759df;
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const shuffledPrompts = stableShuffle(STORY_PROMPTS);
const rowSplitIndex = Math.ceil(shuffledPrompts.length / 2);
const PROMPT_ROWS: [string[], string[]] = [
  shuffledPrompts.slice(0, rowSplitIndex),
  shuffledPrompts.slice(rowSplitIndex),
];

const maskStyle = {
  maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
  WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
};

export default function PromptCarousel({ onSelect }: PromptCarouselProps) {
  return (
    <div className="space-y-3">
      {/* Row 1 — scrolls left */}
      <div className="overflow-hidden" style={maskStyle}>
        <div className="flex w-fit [animation:marquee-left_180s_linear_infinite] hover:[animation-play-state:paused] motion-reduce:[animation:none]">
          {[...PROMPT_ROWS[0], ...PROMPT_ROWS[0]].map((prompt, i) => (
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
          {[...PROMPT_ROWS[1], ...PROMPT_ROWS[1]].map((prompt, i) => (
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
