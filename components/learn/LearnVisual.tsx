'use client';

import Image from 'next/image';
import {
  ArrowRight,
  AudioLines,
  BookOpenText,
  Captions,
  Check,
  CircleUserRound,
  Clapperboard,
  Feather,
  GraduationCap,
  Heart,
  Image as ImageIcon,
  Layers3,
  MessageCircleQuestion,
  Mic2,
  Move3D,
  Palette,
  Pause,
  PenLine,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  Timer,
  WandSparkles,
} from 'lucide-react';

import {
  LEARN_SCREENSHOT_ASSETS,
  type LearnScreenshotAsset,
  type LearnSlide,
} from '@/lib/learn/content';

interface LearnVisualProps {
  slide: LearnSlide;
}

const toolIcons = [PenLine, ImageIcon, Mic2, Timer, Captions, Move3D, Sparkles, Share2];
const audienceIcons = [Sparkles, Heart, GraduationCap, Palette];
const equationIcons = [BookOpenText, ImageIcon, Mic2, Captions, Move3D, Sparkles];
const controlIcons = [PenLine, Timer, RefreshCw, AudioLines];

function Frame({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950/55 p-4 shadow-2xl shadow-black/30 backdrop-blur-md sm:p-6 ${className}`}>
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.26em] text-neutral-500">
          {label}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-emerald-300/70">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Kissago flow
        </span>
      </div>
      {children}
    </div>
  );
}

function AuthenticScreenshot({ asset }: { asset: LearnScreenshotAsset }) {
  return (
    <Frame label={asset.caption}>
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/70">
        <Image
          src={asset.src}
          alt={asset.alt}
          fill
          sizes="(max-width: 900px) 92vw, 52vw"
          className="object-contain"
        />
      </div>
      <p className="mt-3 text-xs text-neutral-500">Authentic Kissago product capture</p>
    </Frame>
  );
}

function StatementVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[30rem]">
      <div className="absolute inset-[8%] rounded-full border border-emerald-300/10 shadow-[0_0_120px_rgba(16,185,129,0.13)]" />
      <div className="absolute inset-[18%] rotate-12 rounded-[38%] border border-amber-300/15 bg-neutral-950/45 backdrop-blur-sm" />
      <div className="absolute inset-[29%] -rotate-6 rounded-[32%] border border-emerald-300/25 bg-emerald-950/30 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <Feather className="h-10 w-10 text-emerald-300" strokeWidth={1.4} />
          <span className="font-serif text-xl text-neutral-100">Your idea</span>
          <span className="text-[10px] uppercase tracking-[0.25em] text-amber-200/70">
            becomes a story
          </span>
        </div>
      </div>
      {[0, 1, 2, 3].map((item) => (
        <span
          key={item}
          className="absolute h-2 w-2 rounded-full bg-amber-300/80 shadow-[0_0_18px_rgba(251,191,36,0.7)]"
          style={{
            left: `${20 + item * 19}%`,
            top: item % 2 === 0 ? '17%' : '78%',
          }}
        />
      ))}
    </div>
  );
}

function AudienceVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="relative mx-auto grid w-full max-w-2xl grid-cols-2 gap-3 sm:gap-4">
      {points.map((point, index) => {
        const Icon = audienceIcons[index] ?? Sparkles;
        return (
          <div
            key={point}
            className={`rounded-2xl border p-4 backdrop-blur-md sm:p-5 ${
              index % 2 === 0
                ? 'border-amber-300/15 bg-amber-400/[0.06]'
                : 'border-white/10 bg-white/[0.04]'
            }`}
          >
            <Icon className="mb-5 h-5 w-5 text-amber-200/80" strokeWidth={1.6} />
            <p className="max-w-40 text-sm leading-5 text-neutral-200">{point}</p>
          </div>
        );
      })}
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-300/30 bg-neutral-950 shadow-[0_0_55px_rgba(16,185,129,0.25)]">
        <Feather className="h-7 w-7 text-emerald-300" />
      </div>
    </div>
  );
}

function FragmentationVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {points.map((point, index) => {
        const Icon = toolIcons[index] ?? Layers3;
        const transforms = ['sm:-translate-y-2', 'sm:translate-y-5', 'sm:-translate-y-5', 'sm:translate-y-1'];
        return (
          <div
            key={point}
            className={`flex min-h-28 flex-col justify-between rounded-2xl border border-white/10 bg-neutral-950/60 p-4 shadow-xl shadow-black/20 ${transforms[index % transforms.length]}`}
          >
            <Icon
              className={index % 3 === 0 ? 'h-5 w-5 text-amber-300/80' : 'h-5 w-5 text-neutral-500'}
              strokeWidth={1.5}
            />
            <span className="text-sm text-neutral-300">{point}</span>
          </div>
        );
      })}
    </div>
  );
}

function LearningCurveVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="relative mx-auto flex min-h-80 w-full max-w-xl items-center justify-center">
      <div className="absolute left-2 top-4 z-10 w-44 rotate-[-6deg] rounded-2xl border border-amber-300/25 bg-amber-950/30 p-5 shadow-2xl sm:left-5">
        <Feather className="mb-8 h-6 w-6 text-amber-300" />
        <p className="font-serif text-xl text-neutral-100">Once upon an idea...</p>
      </div>
      <div className="absolute bottom-4 right-2 z-20 grid w-[74%] gap-2 sm:right-5">
        {points.map((point, index) => (
          <div
            key={point}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-900/95 px-4 py-3 shadow-xl"
            style={{ transform: `translateX(${index * 7}px)` }}
          >
            <span className="font-mono text-[10px] text-amber-300/60">0{index + 1}</span>
            <span className="text-sm text-neutral-300">{point}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuidedComparisonVisual() {
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <div className="rounded-[1.5rem] border border-amber-300/15 bg-amber-500/[0.04] p-5">
        <div className="mb-6 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-amber-200/70">
          <Sparkles className="h-4 w-4" />
          Generation alone
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="aspect-square rounded-xl border border-white/10 bg-white/[0.04]"
              style={{ transform: `rotate(${(item % 3 - 1) * 3}deg)` }}
            />
          ))}
        </div>
        <p className="mt-5 text-sm text-neutral-500">Fast output, uncertain flow</p>
      </div>
      <div className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-500/[0.06] p-5">
        <div className="mb-6 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-200/80">
          <WandSparkles className="h-4 w-4" />
          Guided creation
        </div>
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex min-w-0 flex-1 items-center gap-2">
              <div className="aspect-[4/5] flex-1 rounded-xl border border-emerald-300/15 bg-emerald-400/[0.06]" />
              {item < 2 ? <ArrowRight className="h-3 w-3 shrink-0 text-emerald-400/50" /> : null}
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-emerald-100/70">Intent, continuity, progression</p>
      </div>
    </div>
  );
}

function CalmVisual() {
  return (
    <div className="grid w-full gap-3 sm:grid-cols-[0.8fr_1.2fr]">
      <div className="relative min-h-72 overflow-hidden rounded-[1.5rem] border border-amber-300/15 bg-neutral-900/65 p-4">
        <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">More stimulation</span>
        {[...Array(14)].map((_, index) => (
          <span
            key={index}
            className={`absolute rounded-lg border border-white/10 ${
              index % 4 === 0 ? 'bg-amber-400/10' : 'bg-white/[0.04]'
            }`}
            style={{
              width: `${22 + (index % 4) * 9}px`,
              height: `${18 + (index % 3) * 8}px`,
              left: `${8 + ((index * 23) % 78)}%`,
              top: `${17 + ((index * 31) % 72)}%`,
              transform: `rotate(${(index % 5) * 9 - 18}deg)`,
            }}
          />
        ))}
      </div>
      <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-[1.5rem] border border-emerald-300/20 bg-emerald-950/35 p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.16),transparent_65%)]" />
        <div className="relative flex aspect-[4/3] w-full max-w-xs items-center justify-center rounded-2xl border border-emerald-200/20 bg-neutral-950/60">
          <BookOpenText className="h-11 w-11 text-emerald-200/80" strokeWidth={1.2} />
          <span className="absolute bottom-4 text-xs text-neutral-400">Story, pace, attention</span>
        </div>
      </div>
    </div>
  );
}

function GuidedSpaceVisual() {
  return (
    <div className="relative mx-auto flex min-h-80 w-full max-w-2xl items-center justify-center">
      <div className="absolute h-64 w-64 rounded-full border border-emerald-300/10 shadow-[0_0_100px_rgba(16,185,129,0.14)]" />
      <div className="relative grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="space-y-2">
          {['Idea', 'Voice', 'Visual'].map((label) => (
            <div key={label} className="rounded-xl border border-white/10 bg-neutral-950/60 px-4 py-3 text-sm text-neutral-400">
              {label}
            </div>
          ))}
        </div>
        <ArrowRight className="h-5 w-5 text-emerald-400/60" />
        <div className="rounded-[1.75rem] border border-emerald-300/25 bg-emerald-950/40 p-6 text-center shadow-[0_0_70px_rgba(16,185,129,0.12)]">
          <WandSparkles className="mx-auto mb-4 h-8 w-8 text-emerald-300" />
          <p className="font-serif text-lg text-neutral-100">One guided space</p>
          <p className="mt-2 text-xs leading-5 text-neutral-500">Shape · review · decide</p>
        </div>
      </div>
    </div>
  );
}

function EquationVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="relative grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {points.map((point, index) => {
        const Icon = equationIcons[index] ?? Layers3;
        return (
          <div key={point} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-neutral-950/65 p-4">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              index === 2 || index === 3 ? 'bg-amber-400/10 text-amber-200' : 'bg-emerald-400/10 text-emerald-200'
            }`}>
              <Icon className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <span className="text-sm text-neutral-200">{point}</span>
          </div>
        );
      })}
      <div className="col-span-2 mt-2 flex items-center justify-center gap-3 sm:col-span-3">
        <span className="h-px w-16 bg-gradient-to-r from-transparent to-emerald-400/50" />
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400 text-neutral-950 shadow-[0_0_35px_rgba(52,211,153,0.35)]">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </span>
        <span className="h-px w-16 bg-gradient-to-l from-transparent to-amber-300/50" />
      </div>
    </div>
  );
}

function TimelineVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="w-full">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <span className="font-serif text-5xl text-emerald-200 sm:text-6xl">5–10</span>
          <span className="ml-2 text-sm text-neutral-400">minutes</span>
        </div>
        <span className="max-w-28 text-right text-[10px] uppercase leading-4 tracking-[0.2em] text-neutral-500">
          Approximate first version
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {points.map((point, index) => (
          <div key={point} className="relative rounded-xl border border-white/10 bg-neutral-950/55 p-3">
            <span className="mb-6 block font-mono text-[10px] text-emerald-300/60">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-xs leading-4 text-neutral-300">{point}</span>
            {index < points.length - 1 ? (
              <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-emerald-400/50 sm:block" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function IdeaEntryVisual({ points }: { points: readonly string[] }) {
  return (
    <Frame label="Story idea entry">
      <div className="mb-4 flex flex-wrap gap-2">
        {points.map((point, index) => (
          <span
            key={point}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              index === 0
                ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200'
                : 'border-white/10 bg-white/[0.03] text-neutral-400'
            }`}
          >
            {point}
          </span>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 bg-neutral-900/75 p-4 sm:p-5">
        <p className="font-serif text-lg leading-7 text-neutral-200 sm:text-xl">
          “A young mapmaker discovers that one quiet path changes every night...”
        </p>
        <div className="mt-8 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs text-neutral-500">
            <Mic2 className="h-4 w-4" />
            Speak or type
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-neutral-950">
            <ArrowRight className="h-5 w-5" />
          </span>
        </div>
      </div>
    </Frame>
  );
}

function StoryBeatsVisual({ points }: { points: readonly string[] }) {
  return (
    <Frame label="Story structure">
      <div className="grid gap-2 sm:grid-cols-2">
        {points.map((point, index) => (
          <div
            key={point}
            className={`relative rounded-2xl border p-4 ${
              index === 1
                ? 'border-emerald-300/30 bg-emerald-400/[0.08]'
                : 'border-white/10 bg-white/[0.025]'
            }`}
          >
            <span className="mb-7 block font-mono text-[10px] text-emerald-300/60">
              BEAT {String(index + 1).padStart(2, '0')}
            </span>
            <p className="font-serif text-base text-neutral-200">{point}</p>
            {index === 1 ? (
              <span className="absolute right-3 top-3 rounded-full bg-emerald-300/10 px-2 py-1 text-[9px] uppercase tracking-widest text-emerald-200">
                Selected
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function CharacterWorldVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="relative mx-auto min-h-[22rem] w-full max-w-2xl">
      <div className="absolute left-1/2 top-1/2 z-20 flex h-40 w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[2rem] border border-amber-300/30 bg-neutral-950/80 shadow-[0_0_70px_rgba(245,158,11,0.15)] backdrop-blur-md">
        <CircleUserRound className="mb-4 h-10 w-10 text-amber-200" strokeWidth={1.3} />
        <span className="font-serif text-lg text-neutral-100">The mapmaker</span>
        <span className="mt-2 text-[9px] uppercase tracking-[0.2em] text-amber-200/60">stays recognisable</span>
      </div>
      {points.map((point, index) => {
        const positions = [
          'left-0 top-3',
          'right-0 top-8',
          'bottom-3 left-4',
          'bottom-0 right-3',
        ];
        return (
          <div
            key={point}
            className={`absolute ${positions[index]} w-36 rounded-2xl border border-emerald-300/15 bg-emerald-950/45 p-4 backdrop-blur-sm sm:w-44`}
          >
            <div className="mb-8 aspect-[16/7] rounded-lg bg-gradient-to-br from-emerald-400/15 to-neutral-950" />
            <span className="text-xs text-neutral-300">{point}</span>
          </div>
        );
      })}
    </div>
  );
}

function PlaybackVisual({ points }: { points: readonly string[] }) {
  return (
    <Frame label="Story playback">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_60%_30%,rgba(16,185,129,0.25),transparent_38%),linear-gradient(135deg,#171717,#052e26)]">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/10" />
        <span className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] uppercase tracking-widest text-neutral-300 backdrop-blur-md">
          Scene 04
        </span>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white backdrop-blur-md">
            <Play className="ml-1 h-6 w-6 fill-current" />
          </span>
        </div>
        <div className="absolute inset-x-5 bottom-5">
          <p className="mx-auto max-w-md text-center font-serif text-sm leading-6 text-white sm:text-lg">
            “The path was not lost. It was waiting to be noticed.”
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Pause className="h-3 w-3 text-neutral-300" />
            <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-[58%] bg-emerald-300" />
            </div>
            <span className="text-[9px] text-neutral-400">0:28</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {points.map((point, index) => (
          <span
            key={point}
            className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
              index === 0 ? 'border-amber-300/20 text-amber-200/80' : 'border-white/10 text-neutral-500'
            }`}
          >
            {point}
          </span>
        ))}
      </div>
    </Frame>
  );
}

function ControlsVisual({ points }: { points: readonly string[] }) {
  return (
    <Frame label="Scene refinement">
      <div className="grid gap-3 sm:grid-cols-[1.25fr_0.75fr]">
        <div className="relative min-h-64 overflow-hidden rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-950 to-neutral-900">
          <span className="absolute left-4 top-4 rounded-full bg-emerald-300/10 px-3 py-1 text-[9px] uppercase tracking-widest text-emerald-200">
            Scene 03 selected
          </span>
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/10 bg-black/35 p-3 backdrop-blur-md">
            <p className="font-serif text-sm text-neutral-200">The map opens beneath a quiet green sky.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
          {points.map((point, index) => {
            const Icon = controlIcons[index] ?? PenLine;
            return (
              <div key={point} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <Icon className="h-4 w-4 shrink-0 text-emerald-300/75" />
                <span className="text-xs text-neutral-300">{point}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}

function PracticeVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      {points.map((point, index) => (
        <div
          key={point}
          className="flex items-start gap-3 rounded-xl border border-white/10 bg-neutral-950/55 p-3.5"
        >
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            index < 4 ? 'bg-emerald-300 text-neutral-950' : 'bg-emerald-300/10 text-emerald-200'
          }`}>
            <Check className="h-3 w-3" strokeWidth={2.5} />
          </span>
          <span className="text-xs leading-5 text-neutral-300">{point}</span>
        </div>
      ))}
    </div>
  );
}

function UseCasesVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="relative grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
      {points.map((point, index) => (
        <div
          key={point}
          className={`flex min-h-28 items-end rounded-2xl border p-4 ${
            index === 0 || index === 5
              ? 'border-amber-300/15 bg-amber-400/[0.06]'
              : 'border-emerald-300/10 bg-emerald-400/[0.04]'
          }`}
          style={{ transform: `translateY(${index % 3 === 1 ? 10 : 0}px)` }}
        >
          <span className="text-xs leading-5 text-neutral-300">{point}</span>
        </div>
      ))}
    </div>
  );
}

function StoryUniverseVisual({ points }: { points: readonly string[] }) {
  return (
    <div className="relative mx-auto flex min-h-[22rem] w-full max-w-2xl items-center justify-center">
      <div className="absolute inset-x-[8%] top-1/2 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      <div className="relative grid w-full grid-cols-2 items-center gap-5 sm:grid-cols-4">
        {points.map((point, index) => (
          <div key={point} className="relative flex flex-col items-center">
            <div className={`flex aspect-square w-full max-w-28 items-center justify-center rounded-full border backdrop-blur-md ${
              index === 0
                ? 'border-amber-300/30 bg-amber-950/45 text-amber-200'
                : 'border-emerald-300/20 bg-emerald-950/50 text-emerald-200'
            }`}>
              {index === 0 ? (
                <CircleUserRound className="h-8 w-8" strokeWidth={1.3} />
              ) : index === points.length - 1 ? (
                <Layers3 className="h-8 w-8" strokeWidth={1.3} />
              ) : (
                <span className="font-serif text-xl">0{index}</span>
              )}
            </div>
            <span className="mt-3 text-center text-xs text-neutral-300">{point}</span>
            {index < points.length - 1 ? (
              <ArrowRight className="absolute -right-4 top-[34%] hidden h-4 w-4 text-emerald-300/50 sm:block" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CtaVisual() {
  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-[29rem] items-center justify-center">
      <div className="absolute inset-[7%] rounded-full border border-emerald-300/10 shadow-[0_0_120px_rgba(16,185,129,0.14)]" />
      <div className="absolute inset-[22%] rounded-full border border-amber-300/15 bg-neutral-950/45 backdrop-blur-sm" />
      <div className="relative flex h-40 w-40 items-center justify-center rounded-[2.5rem] border border-emerald-300/25 bg-emerald-950/45 shadow-2xl shadow-black/40">
        <Feather className="h-14 w-14 text-emerald-200" strokeWidth={1.2} />
        <span className="absolute -bottom-9 text-[10px] uppercase tracking-[0.25em] text-amber-200/70">
          Begin with an idea
        </span>
      </div>
    </div>
  );
}

export default function LearnVisual({ slide }: LearnVisualProps) {
  const points = slide.supportingPoints ?? [];
  const screenshot = slide.screenshotKey
    ? LEARN_SCREENSHOT_ASSETS[slide.screenshotKey]
    : undefined;

  if (screenshot) {
    return <AuthenticScreenshot asset={screenshot} />;
  }

  switch (slide.visualType) {
    case 'statement':
      return <StatementVisual />;
    case 'audiences':
      return <AudienceVisual points={points} />;
    case 'tool-fragmentation':
      return <FragmentationVisual points={points} />;
    case 'learning-curve':
      return <LearningCurveVisual points={points} />;
    case 'guided-comparison':
      return <GuidedComparisonVisual />;
    case 'calm-content':
      return <CalmVisual />;
    case 'guided-space':
      return <GuidedSpaceVisual />;
    case 'story-equation':
      return <EquationVisual points={points} />;
    case 'timeline':
      return <TimelineVisual points={points} />;
    case 'idea-entry':
      return <IdeaEntryVisual points={points} />;
    case 'story-beats':
      return <StoryBeatsVisual points={points} />;
    case 'character-world':
      return <CharacterWorldVisual points={points} />;
    case 'story-playback':
      return <PlaybackVisual points={points} />;
    case 'story-controls':
      return <ControlsVisual points={points} />;
    case 'best-practices':
      return <PracticeVisual points={points} />;
    case 'use-cases':
      return <UseCasesVisual points={points} />;
    case 'story-universe':
      return <StoryUniverseVisual points={points} />;
    case 'cta':
      return <CtaVisual />;
    default:
      return <StatementVisual />;
  }
}
