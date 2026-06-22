import {
  applyStoryEffectEasing,
  normalizeStoryEffectConfig,
  type StoryEffectConfig,
} from './settings';

export interface StoryMotionFrame {
  scale: number;
  translateXPercent: number;
  translateYPercent: number;
}

export interface StoryParticleSample {
  x: number;
  y: number;
  size: number;
  opacity: number;
  stretch: number;
  angle: number;
}

export function stableStoryEffectSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

export function getStoryMotionFrame(configInput: unknown, progressInput: number): StoryMotionFrame {
  const config = normalizeStoryEffectConfig(configInput);
  if (!config.enabled || !config.motion.enabled) return { scale: 1, translateXPercent: 0, translateYPercent: 0 };
  const progress = applyStoryEffectEasing(progressInput, config.motion.easing);
  const intensity = config.motion.intensity / 100;
  return {
    scale: 1 + ((config.motion.zoomStart - 1) + (config.motion.zoomEnd - config.motion.zoomStart) * progress) * intensity,
    translateXPercent: (config.motion.panX + config.motion.driftX * progress) * intensity,
    translateYPercent: (config.motion.panY + config.motion.driftY * progress) * intensity,
  };
}

export function buildStoryParticles(
  configInput: unknown,
  width: number,
  height: number,
  timeMs: number,
  seedText: string
): StoryParticleSample[] {
  const config = normalizeStoryEffectConfig(configInput);
  if (!config.enabled || !config.particles.enabled || width <= 0 || height <= 0) return [];
  const effect = config.particles;
  const count = Math.round(effect.amount * effect.density / 100);
  const baseSeed = stableStoryEffectSeed(seedText);
  const direction = effect.direction * Math.PI / 180;
  const elapsed = timeMs / 1000;
  const diagonal = Math.hypot(width, height);

  return Array.from({ length: count }, (_, index) => {
    const seed = baseSeed + Math.imul(index + 1, 2654435761);
    const spreadOffset = (random(seed + 4) - 0.5) * effect.spread * Math.PI / 180;
    const angle = direction + spreadOffset;
    const speed = (0.025 + random(seed + 5) * 0.06) * diagonal * effect.speed;
    const initialX = random(seed + 1) * width;
    const initialY = random(seed + 2) * height;
    const x = ((initialX + Math.cos(angle) * speed * elapsed) % width + width) % width;
    const y = ((initialY + Math.sin(angle) * speed * elapsed) % height + height) % height;
    const depth = 0.45 + random(seed + 3) * 0.85;
    return {
      x,
      y,
      size: effect.size * depth * Math.max(1, Math.min(width, height) / 420),
      opacity: effect.opacity * (0.45 + random(seed + 6) * 0.55),
      stretch: effect.type === 'rain' ? 5 + random(seed + 7) * 7 : 1,
      angle,
    };
  });
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function drawAtmosphere(
  context: CanvasRenderingContext2D,
  config: StoryEffectConfig,
  width: number,
  height: number,
  timeMs: number,
  seedText: string
) {
  if (!config.enabled || !config.atmosphere.enabled) return;
  const effect = config.atmosphere;
  const seed = stableStoryEffectSeed(seedText);
  const time = timeMs / 1000 * effect.speed;
  const alpha = effect.opacity * effect.intensity / 100;
  context.save();
  context.globalCompositeOperation = effect.type === 'glow' ? 'screen' : 'source-over';
  for (let index = 0; index < 4; index += 1) {
    const phase = random(seed + index * 19) * Math.PI * 2;
    const x = width * (0.15 + index * 0.25) + Math.cos(time * 0.35 + phase) * width * 0.14;
    const y = height * (0.25 + random(seed + index * 23) * 0.5) + Math.sin(time * 0.22 + phase) * height * 0.12;
    const radius = Math.max(width, height) * (0.22 + random(seed + index * 29) * 0.2) * effect.scale;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    if (effect.type === 'glow') {
      gradient.addColorStop(0, `rgba(255,229,170,${alpha * 0.55})`);
      gradient.addColorStop(1, 'rgba(255,229,170,0)');
    } else {
      gradient.addColorStop(0, `rgba(225,235,240,${alpha * 0.34})`);
      gradient.addColorStop(0.55, `rgba(210,225,232,${alpha * 0.16})`);
      gradient.addColorStop(1, 'rgba(210,225,232,0)');
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
  context.restore();
}

export function drawStoryEffectsOverlay(
  context: CanvasRenderingContext2D,
  configInput: unknown,
  timeMs: number,
  seedText: string,
  options: { clear?: boolean } = {}
) {
  const config = normalizeStoryEffectConfig(configInput);
  const width = context.canvas.width;
  const height = context.canvas.height;
  if (options.clear !== false) context.clearRect(0, 0, width, height);
  if (!config.enabled) return;
  drawAtmosphere(context, config, width, height, timeMs, seedText);
  const [red, green, blue] = hexToRgb(config.particles.color);
  const particles = buildStoryParticles(config, width, height, timeMs, seedText);
  context.save();
  context.lineCap = 'round';
  for (const particle of particles) {
    context.strokeStyle = `rgba(${red},${green},${blue},${particle.opacity})`;
    context.fillStyle = context.strokeStyle;
    if (config.particles.type === 'rain') {
      context.lineWidth = Math.max(0.6, particle.size * 0.55);
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(
        particle.x - Math.cos(particle.angle) * particle.size * particle.stretch,
        particle.y - Math.sin(particle.angle) * particle.size * particle.stretch
      );
      context.stroke();
    } else {
      context.beginPath();
      context.arc(particle.x, particle.y, Math.max(0.5, particle.size), 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}
