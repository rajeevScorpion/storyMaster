'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clapperboard, Library, Loader2, type LucideIcon } from 'lucide-react';
import type { OpenFlowKind, OpenFlowNavMeta } from '@/lib/story/open-flow-nav';

interface OpenFlowLoaderProps extends Partial<OpenFlowNavMeta> {
  kind: OpenFlowKind;
  activePhaseIndex?: number;
  statusText?: string;
  className?: string;
}

type VariantConfig = {
  eyebrow: string;
  fallbackTitle: string;
  fallbackPrompt: string;
  frameLabel: string;
  readyLabel: string;
  phases: string[];
  details: string[];
  icon: LucideIcon;
  accentClass: string;
};

const VARIANTS: Record<OpenFlowKind, VariantConfig> = {
  story: {
    eyebrow: 'Opening story',
    fallbackTitle: 'Opening your story',
    fallbackPrompt: 'Restoring the place you left off.',
    frameLabel: 'Reader',
    readyLabel: 'Opening reader',
    phases: ['Finding story', 'Restoring progress', 'Preparing media', 'Opening reader'],
    details: [
      'Looking up your saved story.',
      'Restoring the last active branch.',
      'Preparing images, narration, and local cache.',
      'Bringing the reader back into focus.',
    ],
    icon: BookOpen,
    accentClass: 'text-emerald-200',
  },
  reel: {
    eyebrow: 'Opening reel',
    fallbackTitle: 'Opening your reel',
    fallbackPrompt: 'Restoring the reel panels and editor.',
    frameLabel: 'Reel',
    readyLabel: 'Opening editor',
    phases: ['Finding reel', 'Restoring panels', 'Preparing visuals', 'Opening editor'],
    details: [
      'Looking up your saved reel.',
      'Restoring the panel sequence.',
      'Preparing visuals and captions.',
      'Opening the reel editor.',
    ],
    icon: Clapperboard,
    accentClass: 'text-cyan-200',
  },
  storyline: {
    eyebrow: 'Opening storyline',
    fallbackTitle: 'Opening storyline',
    fallbackPrompt: 'Preparing the published experience.',
    frameLabel: 'Player',
    readyLabel: 'Opening player',
    phases: ['Checking saved copy', 'Loading latest', 'Preparing media', 'Opening player'],
    details: [
      'Checking for a saved local copy.',
      'Loading the latest published version.',
      'Preparing scenes and narration.',
      'Opening the storyline player.',
    ],
    icon: Library,
    accentClass: 'text-violet-200',
  },
};

function useGentlePhaseProgress(phaseCount: number, activePhaseIndex?: number) {
  const [timedIndex, setTimedIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimedIndex((current) => Math.min(phaseCount - 1, current + 1));
    }, 2300);
    return () => window.clearInterval(interval);
  }, [phaseCount]);

  return Math.min(phaseCount - 1, Math.max(activePhaseIndex ?? 0, timedIndex));
}

export default function OpenFlowLoader({
  kind,
  title,
  coverImageUrl,
  coverIsStoryboard,
  status,
  beatCount,
  userPrompt,
  activePhaseIndex,
  statusText,
  className = '',
}: OpenFlowLoaderProps) {
  const config = VARIANTS[kind];
  const currentPhaseIndex = useGentlePhaseProgress(config.phases.length, activePhaseIndex);
  const Icon = config.icon;
  const displayTitle = title?.trim() || config.fallbackTitle;
  const displayPrompt = userPrompt?.trim() || config.fallbackPrompt;
  const currentDetail = statusText || config.details[currentPhaseIndex] || config.details[0];
  const backgroundImageClass = coverIsStoryboard
    ? 'absolute left-0 top-0 h-[200%] w-[200%] max-w-none object-cover object-left-top blur-sm'
    : 'h-full w-full scale-[1.03] object-cover blur-sm';

  const metaLine = useMemo(() => {
    const parts = [
      status?.trim(),
      typeof beatCount === 'number' && beatCount > 0 ? `${beatCount} beats` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : config.readyLabel;
  }, [beatCount, config.readyLabel, status]);

  return (
    <div className={`relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-100 ${className}`}>
      {coverImageUrl ? (
        <div className="absolute inset-0 opacity-45">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverImageUrl} alt="" className={backgroundImageClass} />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(6,18,18,0.92),rgba(10,10,10,0.98)_44%,rgba(24,18,34,0.9))]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.54),rgba(10,10,10,0.88)_56%,rgba(10,10,10,0.98))]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-10 md:px-10">
        <div className="mx-auto grid w-full max-w-3xl items-center gap-8 text-center">
          <div className="min-w-0">
            <div className="flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.28em] text-neutral-400">
              <Icon className={`h-4 w-4 ${config.accentClass}`} />
              <span>{config.eyebrow}</span>
            </div>
            <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-serif leading-tight text-white md:text-5xl">
              {displayTitle}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-neutral-300 md:text-base">
              {displayPrompt}
            </p>
            <p className="mt-4 text-xs uppercase tracking-[0.22em] text-neutral-500">
              {metaLine}
            </p>

            <div className="mt-8">
              <div className="flex items-center justify-center gap-2 text-sm text-neutral-300">
                <Loader2 className={`h-4 w-4 animate-spin ${config.accentClass}`} />
                <span>{currentDetail}</span>
              </div>
              <div className="mt-5 grid grid-cols-4 gap-2">
                {config.phases.map((phase, index) => {
                  const isComplete = index < currentPhaseIndex;
                  const isActive = index === currentPhaseIndex;
                  return (
                    <div key={phase} className="min-w-0">
                      <div className={`h-1.5 rounded-full transition-colors ${
                        isComplete || isActive ? 'bg-white/80' : 'bg-white/14'
                      }`} />
                      <p className={`mt-2 text-[10px] uppercase leading-snug tracking-[0.13em] ${
                        isActive ? 'text-neutral-100' : isComplete ? 'text-neutral-300' : 'text-neutral-500'
                      }`}>
                        {phase}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
