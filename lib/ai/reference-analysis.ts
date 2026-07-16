import 'server-only';

import { callGeminiReferenceAnalysis, type InlineImagePart } from '@/app/actions/gemini-proxy';
import { getModelConfig } from '@/lib/ai/model-config';
import { buildCharacterAnalysisPrompt, buildWorldAnalysisPrompt } from '@/lib/ai/reference-adoption-prompts';
import {
  CHARACTER_DESCRIPTION_SCHEMA_VERSION,
  WORLD_DESCRIPTION_SCHEMA_VERSION,
  type CharacterReferenceDescription,
  type WorldReferenceDescription,
} from '@/lib/types/references';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
}

function toStringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toUnusableReason(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 && text.toLowerCase() !== 'null' ? text : undefined;
}

/** Lenient JSON extraction: providers occasionally wrap JSON in prose/markdown. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const direct = JSON.parse(raw);
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
  } catch {
    // fall through to brace extraction
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return null;
}

export async function analyzeCharacterReference(input: {
  referencePart: InlineImagePart;
  telemetry?: CostTelemetryContext;
}): Promise<CharacterReferenceDescription> {
  const { model, temperature } = await getModelConfig('reference_character_analysis');
  const raw = await callGeminiReferenceAnalysis({
    task: 'reference_character_analysis',
    model,
    prompt: buildCharacterAnalysisPrompt(),
    referenceParts: [input.referencePart],
    temperature: temperature ?? 0.2,
    telemetry: input.telemetry,
  });

  const obj = parseJsonObject(raw);
  if (!obj) {
    return {
      schemaVersion: CHARACTER_DESCRIPTION_SCHEMA_VERSION,
      summary: '',
      subjectType: 'unknown',
      stableTraits: { face: [], hair: [], silhouette: [], marks: [], stableAccessories: [] },
      changeable: { clothing: [], pose: [], expression: [] },
      continuityAnchors: [],
      prohibitedDrift: [],
      unusableReason: 'We could not read a clear character from that image.',
    };
  }

  const stable = (obj.stableTraits ?? {}) as Record<string, unknown>;
  const changeable = (obj.changeable ?? {}) as Record<string, unknown>;
  return {
    schemaVersion: CHARACTER_DESCRIPTION_SCHEMA_VERSION,
    summary: toStringField(obj.summary),
    subjectType: toStringField(obj.subjectType) || 'unknown',
    stableTraits: {
      face: toStringArray(stable.face),
      hair: toStringArray(stable.hair),
      silhouette: toStringArray(stable.silhouette),
      marks: toStringArray(stable.marks),
      stableAccessories: toStringArray(stable.stableAccessories),
    },
    changeable: {
      clothing: toStringArray(changeable.clothing),
      pose: toStringArray(changeable.pose),
      expression: toStringArray(changeable.expression),
    },
    continuityAnchors: toStringArray(obj.continuityAnchors),
    prohibitedDrift: toStringArray(obj.prohibitedDrift),
    ...(toUnusableReason(obj.unusableReason) ? { unusableReason: toUnusableReason(obj.unusableReason) } : {}),
  };
}

export async function analyzeWorldReference(input: {
  referencePart: InlineImagePart;
  telemetry?: CostTelemetryContext;
}): Promise<WorldReferenceDescription> {
  const { model, temperature } = await getModelConfig('reference_world_analysis');
  const raw = await callGeminiReferenceAnalysis({
    task: 'reference_world_analysis',
    model,
    prompt: buildWorldAnalysisPrompt(),
    referenceParts: [input.referencePart],
    temperature: temperature ?? 0.2,
    telemetry: input.telemetry,
  });

  const obj = parseJsonObject(raw);
  if (!obj) {
    return {
      schemaVersion: WORLD_DESCRIPTION_SCHEMA_VERSION,
      summary: '',
      worldType: 'unknown',
      architecture: [],
      geography: [],
      spatialLayout: [],
      materials: [],
      lighting: [],
      atmosphere: [],
      recurringObjects: [],
      continuityAnchors: [],
      keywords: [],
      incidentalElements: [],
      prohibitedDrift: [],
      unusableReason: 'We could not read a clear place from that image.',
    };
  }

  return {
    schemaVersion: WORLD_DESCRIPTION_SCHEMA_VERSION,
    summary: toStringField(obj.summary),
    worldType: toStringField(obj.worldType) || 'unknown',
    architecture: toStringArray(obj.architecture),
    geography: toStringArray(obj.geography),
    spatialLayout: toStringArray(obj.spatialLayout),
    materials: toStringArray(obj.materials),
    lighting: toStringArray(obj.lighting),
    atmosphere: toStringArray(obj.atmosphere),
    recurringObjects: toStringArray(obj.recurringObjects),
    continuityAnchors: toStringArray(obj.continuityAnchors),
    keywords: toStringArray(obj.keywords),
    incidentalElements: toStringArray(obj.incidentalElements),
    prohibitedDrift: toStringArray(obj.prohibitedDrift),
    ...(toUnusableReason(obj.unusableReason) ? { unusableReason: toUnusableReason(obj.unusableReason) } : {}),
  };
}
