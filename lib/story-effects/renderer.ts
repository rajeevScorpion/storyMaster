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

// Full-avalanche 32-bit integer hash (Wellons' triple32). A single xorshift
// round produced visible lattice/line artifacts when fed arithmetically-spaced
// seeds; this decorrelates every channel so particle fields scatter naturally.
function hashU32(input: number): number {
  let x = input >>> 0;
  x ^= x >>> 17;
  x = Math.imul(x, 0xed5ad4bb);
  x ^= x >>> 11;
  x = Math.imul(x, 0xac4c1b51);
  x ^= x >>> 15;
  x = Math.imul(x, 0x31848bab);
  x ^= x >>> 14;
  return x >>> 0;
}

// Deterministic pseudo-random in [0, 1) for a (seed, channel) pair. Distinct
// channels are independent, so x/y/size/etc. never correlate with each other.
function rand(seed: number, channel: number): number {
  return hashU32(Math.imul(seed, 0x9e3779b1) ^ Math.imul(channel + 0x6d2b79f5, 0x85ebca77)) / 4294967296;
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
  const turbulence = effect.randomness / 100;

  // Rain is modelled separately: gravity is fixed (drops always fall from the
  // top), `direction` is reinterpreted as a wind slant from vertical, and the
  // streak is aligned to velocity and stretched by speed for a motion-blur look.
  if (effect.type === 'rain') {
    return buildRainParticles(effect, baseSeed, width, height, diagonal, elapsed, turbulence, count);
  }

  const wanderAmp = turbulence * Math.min(width, height) * 0.07;

  return Array.from({ length: count }, (_, index) => {
    const seed = baseSeed ^ Math.imul(index + 1, 0x9e3779b1);
    const spreadOffset = (rand(seed, 1) - 0.5) * effect.spread * Math.PI / 180;
    const angle = direction + spreadOffset;
    // Randomness widens the speed spread so the field stops moving as one sheet.
    const speedJitter = 1 + (rand(seed, 4) - 0.5) * turbulence * 1.4;
    const speed = (0.025 + rand(seed, 5) * 0.06) * diagonal * effect.speed * speedJitter;
    const initialX = rand(seed, 2) * width;
    const initialY = rand(seed, 3) * height;
    // Smooth per-particle wander (independent phase + frequency) layered on top
    // of the directional drift, so particles meander instead of marching in step.
    const wanderPhaseX = rand(seed, 8) * Math.PI * 2;
    const wanderPhaseY = rand(seed, 9) * Math.PI * 2;
    const wanderFreq = 0.35 + rand(seed, 10) * 0.8;
    const wanderX = Math.sin(elapsed * wanderFreq + wanderPhaseX) * wanderAmp;
    const wanderY = Math.cos(elapsed * wanderFreq * 0.9 + wanderPhaseY) * wanderAmp;
    const x = ((initialX + Math.cos(angle) * speed * elapsed + wanderX) % width + width) % width;
    const y = ((initialY + Math.sin(angle) * speed * elapsed + wanderY) % height + height) % height;
    const depth = 0.45 + rand(seed, 6) * 0.85;
    return {
      x,
      y,
      size: effect.size * depth * Math.max(1, Math.min(width, height) / 420),
      opacity: effect.opacity * (0.45 + rand(seed, 7) * 0.55),
      stretch: effect.type === 'rain' ? 5 + rand(seed, 11) * 7 : 1,
      angle,
    };
  });
}

// Realistic rain. Drops always travel downward and recycle at the top, so the
// user never has to think about "direction" pointing up. `direction` is clamped
// to a wind slant from vertical; depth varies near/far drops; randomness only
// jitters speed, length, and spawn position (never sideways meander, which would
// read as drifting dust rather than falling rain).
function buildRainParticles(
  effect: StoryEffectConfig['particles'],
  baseSeed: number,
  width: number,
  height: number,
  diagonal: number,
  elapsed: number,
  turbulence: number,
  count: number
): StoryParticleSample[] {
  const slant = Math.max(-70, Math.min(70, effect.direction)) * Math.PI / 180;
  const tanSlant = Math.tan(slant);
  const velocityAngle = Math.PI / 2 - slant; // canvas: down is +y, slant tilts x
  const pixelScale = Math.max(1, Math.min(width, height) / 420);
  const margin = Math.abs(tanSlant) * height + 48;
  const span = width + margin * 2;
  const travelSpan = height + margin * 2;
  const fallSpeed = (0.55 + effect.speed * 0.95) * diagonal;

  return Array.from({ length: count }, (_, index) => {
    const seed = baseSeed ^ Math.imul(index + 1, 0x9e3779b1);
    const depth = 0.5 + rand(seed, 6) * 0.7;
    const speedJitter = 1 + (rand(seed, 4) - 0.5) * turbulence * 0.9;
    const dropSpeed = fallSpeed * depth * speedJitter;
    const phase = rand(seed, 3);
    const cycle = ((dropSpeed * elapsed) / travelSpan + phase) % 1;
    const y = -margin + cycle * travelSpan;
    const startX = -margin + rand(seed, 2) * span;
    const x = ((startX + tanSlant * (y + margin)) % span + span) % span - margin;
    const size = Math.max(0.5, effect.size * (0.7 + depth * 0.5) * pixelScale);
    const streakPx = (10 + effect.speed * 14) * depth * pixelScale * (1 + (rand(seed, 11) - 0.5) * turbulence);
    return {
      x,
      y,
      size,
      opacity: effect.opacity * (0.4 + depth * 0.6) * (0.75 + rand(seed, 7) * 0.25),
      stretch: Math.max(2, streakPx) / size,
      angle: velocityAngle,
    };
  });
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// Angled volumetric light shafts ("god rays"). The shafts are rotated to the
// configured direction, sway and pulse independently, and blend additively so
// they read as light pushing through the scene.
function drawLightRays(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  seed: number,
  alpha: number,
  rgb: [number, number, number],
  angle: number,
  scale: number
) {
  const [red, green, blue] = rgb;
  const span = Math.hypot(width, height);
  const rayCount = 7;
  const bandWidth = span / rayCount;
  context.save();
  context.globalCompositeOperation = 'screen';
  context.translate(width / 2, height / 2);
  context.rotate(angle);
  for (let index = 0; index < rayCount; index += 1) {
    const seedAt = seed + index * 53;
    const sway = Math.sin(time * 0.4 + rand(seedAt, 0) * Math.PI * 2) * bandWidth * 0.7;
    const centerX = (index - (rayCount - 1) / 2) * bandWidth * 1.5 + sway;
    const halfWidth = bandWidth * (0.3 + rand(seedAt, 1) * 0.6) * scale;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.5 + rand(seedAt, 2) * Math.PI * 2);
    const rayAlpha = alpha * (0.3 + rand(seedAt, 3) * 0.45) * (0.4 + pulse * 0.6);
    const gradient = context.createLinearGradient(centerX - halfWidth, 0, centerX + halfWidth, 0);
    gradient.addColorStop(0, `rgba(${red},${green},${blue},0)`);
    gradient.addColorStop(0.5, `rgba(${red},${green},${blue},${rayAlpha})`);
    gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
    context.fillStyle = gradient;
    context.fillRect(centerX - halfWidth, -span, halfWidth * 2, span * 2);
  }
  context.restore();
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
  const rgb = hexToRgb(effect.color);
  const angle = effect.direction * Math.PI / 180;

  if (effect.type === 'rays') {
    drawLightRays(context, width, height, time, seed, alpha, rgb, angle, effect.scale);
    return;
  }

  const [red, green, blue] = rgb;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  context.save();
  context.globalCompositeOperation = effect.type === 'glow' ? 'screen' : 'source-over';
  // Three parallax depth layers: nearer layers are larger and sway further so
  // the volume reads as stacked planes rather than a few flat blobs.
  const layerCount = 3;
  const blobsPerLayer = 3;
  for (let layer = 0; layer < layerCount; layer += 1) {
    const depth = (layer + 1) / layerCount;
    const layerScale = effect.scale * (0.6 + depth * 0.8);
    const parallax = 0.5 + depth * 1.1;
    const layerAlpha = alpha * (0.5 + depth * 0.5) * (2 / layerCount);
    for (let index = 0; index < blobsPerLayer; index += 1) {
      const seedAt = seed + layer * 101 + index * 19;
      const phase = rand(seedAt, 0) * Math.PI * 2;
      const driftAmp = 0.08 + rand(seedAt, 3) * 0.08;
      const x = width * (0.15 + rand(seedAt, 1) * 0.7)
        + Math.cos(time * 0.35 + phase) * width * driftAmp
        + directionX * Math.sin(time * 0.18 * parallax + phase) * width * 0.12;
      const y = height * (0.2 + rand(seedAt, 2) * 0.6)
        + Math.sin(time * 0.22 + phase) * height * driftAmp
        + directionY * Math.sin(time * 0.18 * parallax + phase) * height * 0.12;
      const radius = Math.max(width, height) * (0.18 + rand(seedAt, 4) * 0.2) * layerScale;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      if (effect.type === 'glow') {
        gradient.addColorStop(0, `rgba(${red},${green},${blue},${layerAlpha * 0.55})`);
        gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
      } else {
        gradient.addColorStop(0, `rgba(${red},${green},${blue},${layerAlpha * 0.4})`);
        gradient.addColorStop(0.55, `rgba(${red},${green},${blue},${layerAlpha * 0.18})`);
        gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
      }
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
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
