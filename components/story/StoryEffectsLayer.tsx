'use client';

import { useEffect, useRef } from 'react';

import { drawStoryEffectsOverlay } from '@/lib/story-effects/renderer';
import type { StoryEffectConfig } from '@/lib/story-effects/settings';

export default function StoryEffectsLayer({
  config,
  elapsedMs,
  playbackState,
  seed,
}: {
  config: StoryEffectConfig;
  elapsedMs: number;
  playbackState: 'idle' | 'playing' | 'paused';
  seed: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(elapsedMs);
  const boundsRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    elapsedRef.current = elapsedMs;
    if (playbackState === 'playing') return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (context) drawStoryEffectsOverlay(context, config, elapsedMs, seed);
  }, [config, elapsedMs, playbackState, seed]);

  // Track the canvas size outside the draw loop; getBoundingClientRect inside
  // requestAnimationFrame forces a layout on every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    boundsRef.current = { width: bounds.width, height: bounds.height };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      boundsRef.current = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame = 0;
    let start = performance.now();
    let baseElapsed = elapsedRef.current;

    const draw = (now: number) => {
      const bounds = boundsRef.current;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2);
      const width = Math.max(1, Math.round(bounds.width * pixelRatio));
      const height = Math.max(1, Math.round(bounds.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (context) {
        const time = playbackState === 'playing' ? baseElapsed + now - start : elapsedRef.current;
        drawStoryEffectsOverlay(context, config, time, seed);
      }
      if (playbackState === 'playing') animationFrame = requestAnimationFrame(draw);
    };

    baseElapsed = elapsedRef.current;
    start = performance.now();
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [config, playbackState, seed]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true" />;
}
