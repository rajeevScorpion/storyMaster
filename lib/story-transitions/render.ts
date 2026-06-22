import {
  applyStoryTransitionEasing,
  normalizeStoryTransitionSettings,
  type StoryTransitionSettings,
} from './settings';

export type StoryTransitionLayerStyle = Record<string, string | number | undefined>;

function directionalInset(direction: StoryTransitionSettings['direction'], progress: number): string {
  const remaining = (1 - progress) * 100;
  if (direction === 'right') return `inset(0 0 0 ${remaining}%)`;
  if (direction === 'up') return `inset(0 0 ${remaining}% 0)`;
  if (direction === 'down') return `inset(${remaining}% 0 0 0)`;
  return `inset(0 ${remaining}% 0 0)`;
}

function pushTransform(direction: StoryTransitionSettings['direction'], incoming: boolean, progress: number, strength: number): string {
  const incomingOffset = (1 - progress) * strength;
  const outgoingOffset = progress * strength;
  const value = incoming ? incomingOffset : -outgoingOffset;
  if (direction === 'right') return `translateX(${-value}%)`;
  if (direction === 'up') return `translateY(${value}%)`;
  if (direction === 'down') return `translateY(${-value}%)`;
  return `translateX(${value}%)`;
}

function inkPolygon(progress: number): string {
  const edge = Math.max(0, Math.min(100, progress * 112));
  const offsets = [0, -5, 4, -3, 6, -4, 3, -2, 0];
  return `polygon(0 0, ${Math.max(0, edge + offsets[0])}% 0, ${offsets.slice(1).map((offset, index) => `${Math.max(0, Math.min(100, edge + offset))}% ${(index + 1) * 12.5}%`).join(', ')}, 0 100%)`;
}

export function getStoryTransitionLayerStyle(
  settingsInput: unknown,
  progressInput: number,
  layer: 'from' | 'to'
): StoryTransitionLayerStyle {
  const settings = normalizeStoryTransitionSettings(settingsInput);
  const progress = applyStoryTransitionEasing(progressInput, settings.easing);
  const incoming = layer === 'to';
  const intensity = (settings.intensity ?? 50) / 100;

  if (settings.type === 'fade-black') {
    return { opacity: incoming ? (progress < 0.5 ? 0 : (progress - 0.5) * 2) : (progress < 0.5 ? 1 - progress * 2 : 0) };
  }
  if (settings.type === 'soft-fade' || settings.type === 'blur-dissolve') {
    const blur = (incoming ? 1 - progress : progress) * (4 + intensity * 12);
    return { opacity: incoming ? progress : 1 - progress, filter: `blur(${blur}px)` };
  }
  if (settings.type === 'directional-wipe') {
    return incoming ? { opacity: 1, clipPath: directionalInset(settings.direction, progress) } : { opacity: 1 };
  }
  if (settings.type === 'gentle-push') {
    return { opacity: incoming ? progress : 1 - progress * 0.35, transform: pushTransform(settings.direction, incoming, progress, 8 + intensity * 14) };
  }
  if (settings.type === 'soft-light-flash') {
    return { opacity: incoming ? progress : 1 - progress };
  }
  if (settings.type === 'atmosphere-fade') {
    const distance = incoming ? 1 - progress : progress;
    return { opacity: incoming ? progress : 1 - progress, filter: `blur(${distance * (8 + intensity * 18)}px) brightness(${1 + Math.sin(progress * Math.PI) * intensity * 0.55})` };
  }
  if (settings.type === 'ink-reveal') {
    return incoming ? { opacity: 1, clipPath: inkPolygon(progress) } : { opacity: 1 - progress * 0.3 };
  }
  if (settings.type === 'smoke-reveal') {
    return incoming
      ? { opacity: Math.min(1, progress * 1.35), clipPath: `circle(${progress * 78}% at 50% 50%)`, filter: `blur(${(1 - progress) * (8 + intensity * 14)}px)` }
      : { opacity: 1 - progress * 0.65, filter: `blur(${progress * intensity * 8}px)` };
  }
  return { opacity: incoming ? progress : 1 - progress };
}

export function getStoryTransitionFlashOpacity(settingsInput: unknown, progressInput: number): number {
  const settings = normalizeStoryTransitionSettings(settingsInput);
  if (settings.type !== 'soft-light-flash' && settings.type !== 'atmosphere-fade') return 0;
  return Math.sin(Math.max(0, Math.min(1, progressInput)) * Math.PI) * (settings.intensity ?? 50) / 100 * (settings.type === 'soft-light-flash' ? 0.85 : 0.32);
}

