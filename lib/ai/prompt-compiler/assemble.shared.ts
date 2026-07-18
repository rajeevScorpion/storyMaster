// Assembly decision: given the compiler mode + capability, decide whether to
// send the legacy prompt or the compiled prompt, and produce the diagnostics
// record persisted under beats.image_generation_metadata.promptCompiler.
//
// Pure and isomorphic. The legacy prompt is supplied as a closure so this stays
// decoupled from the (heavy) legacy assembler. Compilation is local text work —
// it never calls a provider — so shadow mode cannot double-charge by construction.

import {
  type CanonicalImageScene,
  type DiagnosticItem,
  SCENE_BUILDER_VERSION,
  validateCanonicalImageScene,
} from './scene-spec.shared';
import { compileImagePrompt, COMPILER_VERSION, type CompiledImagePrompt } from './compile.shared';
import type { PromptCompilerCapability } from './capability.shared';

export type ImagePromptCompilerMode = 'legacy' | 'shadow' | 'new' | 'new_with_legacy_fallback';

const KNOWN_MODES: readonly ImagePromptCompilerMode[] = ['legacy', 'shadow', 'new', 'new_with_legacy_fallback'];

export function normalizeImagePromptCompilerMode(raw: string | null | undefined): ImagePromptCompilerMode {
  return typeof raw === 'string' && (KNOWN_MODES as readonly string[]).includes(raw)
    ? (raw as ImagePromptCompilerMode)
    : 'legacy';
}

export interface ImagePromptCompilerRuntime {
  mode: ImagePromptCompilerMode;
  capability: PromptCompilerCapability;
}

export type CompilerEngine = 'legacy' | 'compiled' | 'compiled_fallback_legacy';

export interface PromptCompilerBeatMetadata {
  compilerVersion: string;
  sceneBuilderVersion: string;
  mode: ImagePromptCompilerMode;
  engine: CompilerEngine;
  legacyChars: number;
  compiledChars?: number;
  compressionLevel?: number;
  compressionActions?: DiagnosticItem[];
  removedInformation?: DiagnosticItem[];
  warnings?: string[];
  fallbackReason?: string;
  /** Shadow mode only: a truncated copy of the compiled prompt for comparison. */
  compiledPreview?: string;
}

export class ImagePromptCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePromptCompileError';
  }
}

export interface AssembleInput {
  runtime: ImagePromptCompilerRuntime | null;
  scene: CanonicalImageScene | null;
  legacyBuild: () => string;
}

export interface AssembleResult {
  finalPrompt: string;
  engine: CompilerEngine;
  compiler?: PromptCompilerBeatMetadata;
}

export const PROMPT_PREVIEW_MAX_CHARS = 4000;

function truncatePreview(text: string): string {
  return text.length > PROMPT_PREVIEW_MAX_CHARS ? `${text.slice(0, PROMPT_PREVIEW_MAX_CHARS)}…` : text;
}

function metaFromCompiled(
  base: Pick<PromptCompilerBeatMetadata, 'compilerVersion' | 'sceneBuilderVersion' | 'mode' | 'legacyChars'>,
  engine: CompilerEngine,
  compiled: CompiledImagePrompt,
  includePreview: boolean
): PromptCompilerBeatMetadata {
  return {
    ...base,
    engine,
    compiledChars: compiled.characterCount,
    compressionLevel: compiled.compressionLevel,
    compressionActions: compiled.compressionActions,
    removedInformation: compiled.removedInformation,
    warnings: compiled.warnings,
    ...(includePreview ? { compiledPreview: truncatePreview(compiled.fullPrompt) } : {}),
  };
}

/**
 * Decide the final prompt for one image generation.
 * - legacy / disabled capability / no scene  -> legacy prompt, no metadata.
 * - shadow                                    -> legacy prompt sent + compiled diagnostics.
 * - new                                       -> compiled prompt; throws on compile failure.
 * - new_with_legacy_fallback                  -> compiled prompt; legacy fallback on failure.
 */
export function assembleFinalImagePrompt(input: AssembleInput): AssembleResult {
  const { runtime, scene, legacyBuild } = input;
  const mode = runtime?.mode ?? 'legacy';
  const capability = runtime?.capability;

  if (!runtime || mode === 'legacy' || !capability?.enabled || !scene) {
    return { finalPrompt: legacyBuild(), engine: 'legacy' };
  }

  const legacyPrompt = legacyBuild();
  const base = {
    compilerVersion: COMPILER_VERSION,
    sceneBuilderVersion: SCENE_BUILDER_VERSION,
    mode,
    legacyChars: legacyPrompt.length,
  };

  let compiled: CompiledImagePrompt | null = null;
  let compileError: string | null = null;
  try {
    const validation = validateCanonicalImageScene(scene);
    if (!validation.ok) throw new ImagePromptCompileError(`invalid scene: ${validation.errors.join('; ')}`);
    compiled = compileImagePrompt(scene, capability);
  } catch (err) {
    compileError = err instanceof Error ? err.message : 'compile failed';
  }

  if (mode === 'shadow') {
    // Never changes what is sent; records the comparison only.
    const compiler: PromptCompilerBeatMetadata = compiled
      ? metaFromCompiled(base, 'legacy', compiled, true)
      : { ...base, engine: 'legacy', fallbackReason: compileError ?? 'compile failed', warnings: compileError ? [compileError] : [] };
    return { finalPrompt: legacyPrompt, engine: 'legacy', compiler };
  }

  if (!compiled) {
    if (mode === 'new') {
      throw new ImagePromptCompileError(compileError ?? 'compile failed');
    }
    // new_with_legacy_fallback
    return {
      finalPrompt: legacyPrompt,
      engine: 'compiled_fallback_legacy',
      compiler: {
        ...base,
        engine: 'compiled_fallback_legacy',
        fallbackReason: compileError ?? 'compile failed',
        warnings: compileError ? [compileError] : [],
      },
    };
  }

  return {
    finalPrompt: compiled.fullPrompt,
    engine: 'compiled',
    compiler: metaFromCompiled(base, 'compiled', compiled, false),
  };
}
