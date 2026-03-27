'use client';

import { useState, useEffect } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import type { PlaybackState } from '@/lib/hooks/useAudioPlayer';

interface NarrationButtonProps {
  isGeneratingAudio: boolean;
  isAudioReady: boolean;
  playbackState: PlaybackState;
  hasAudio: boolean;
  onTogglePlayPause: () => void;
  onGenerateNarration?: () => void;
  onClearGlow: () => void;
  storyMode: boolean;
  onToggleStoryMode: () => void;
}

function WaveformBars() {
  return (
    <div className="flex items-center gap-[3px] h-5 w-5 justify-center">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-emerald-400"
          style={{
            animation: 'waveform-bar 0.8s ease-in-out infinite',
            animationDelay: `${i * 0.15}s`,
            height: '4px',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes waveform-bar {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
      `}</style>
      <style jsx global>{`
        @keyframes emerald-glow-mild {
          0%, 100% {
            border-color: rgba(16, 185, 129, 0.15);
            box-shadow: 0 0 4px rgba(16, 185, 129, 0.05);
          }
          50% {
            border-color: rgba(16, 185, 129, 0.35);
            box-shadow: 0 0 8px rgba(16, 185, 129, 0.1);
          }
        }
        @keyframes emerald-glow-strong {
          0%, 100% {
            border-color: rgba(16, 185, 129, 0.3);
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.1), 0 0 16px rgba(16, 185, 129, 0.05);
          }
          50% {
            border-color: rgba(16, 185, 129, 0.7);
            box-shadow: 0 0 12px rgba(16, 185, 129, 0.35), 0 0 28px rgba(16, 185, 129, 0.15);
          }
        }
        .glow-pulse-mild {
          animation: emerald-glow-mild 3s ease-in-out infinite;
        }
        .glow-pulse-strong {
          animation: emerald-glow-strong 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default function NarrationButton({
  isGeneratingAudio,
  isAudioReady,
  playbackState,
  hasAudio,
  onTogglePlayPause,
  onGenerateNarration,
  onClearGlow,
  storyMode,
  onToggleStoryMode,
}: NarrationButtonProps) {
  const [showGlow, setShowGlow] = useState(false);

  useEffect(() => {
    if (isAudioReady) {
      setShowGlow(true);
      const timer = setTimeout(() => {
        setShowGlow(false);
        onClearGlow();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isAudioReady, onClearGlow]);

  const handleClick = () => {
    if (isGeneratingAudio && !hasAudio) return;
    if (showGlow) {
      setShowGlow(false);
      onClearGlow();
    }
    if (hasAudio) {
      onTogglePlayPause();
    } else if (onGenerateNarration) {
      onGenerateNarration();
    }
  };

  const isPlaying = playbackState === 'playing';

  let title = 'Generate narration';
  if (isGeneratingAudio && !hasAudio) title = 'Preparing narration...';
  else if (isPlaying) title = 'Pause narration (P)';
  else if (hasAudio) title = 'Play narration (P)';
  else if (onGenerateNarration) title = 'Generate narration (P)';

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleClick}
        disabled={isGeneratingAudio && !hasAudio}
        className={`p-2.5 backdrop-blur-md rounded-full transition-all duration-300 ${
          isGeneratingAudio && !hasAudio
            ? 'bg-neutral-900/60 border border-white/5 cursor-wait'
            : hasAudio
              ? `bg-neutral-900/60 border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-neutral-800 cursor-pointer ${isPlaying ? 'glow-pulse-strong' : ''}`
              : 'bg-neutral-900/60 border border-white/5 hover:border-white/20 hover:bg-neutral-800 cursor-pointer'
        } ${
          showGlow
            ? 'ring-2 ring-emerald-400/60 shadow-[0_0_12px_rgba(52,211,153,0.4)] animate-pulse'
            : ''
        }`}
        title={title}
      >
        {isGeneratingAudio && !hasAudio ? (
          <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
        ) : isPlaying ? (
          <WaveformBars />
        ) : (
          <Volume2 className={`w-5 h-5 ${showGlow ? 'text-emerald-400' : 'text-neutral-400 hover:text-neutral-200'} transition-colors`} />
        )}
      </button>

      {/* Story Mode toggle */}
      <button
        onClick={onToggleStoryMode}
        className={`px-2 py-1 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all duration-300 backdrop-blur-md border ${
          storyMode
            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
            : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300 hover:border-white/20'
        }`}
        title={storyMode ? 'Story Mode: ON — narration autoplays' : 'Story Mode: OFF — click to autoplay narration'}
      >
        {storyMode ? 'auto' : 'auto'}
      </button>
    </div>
  );
}
