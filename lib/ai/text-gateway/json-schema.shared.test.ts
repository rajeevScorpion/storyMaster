import { describe, it, expect } from 'vitest';
import {
  storyBibleGenerationSchema,
  storylineDiscoveryMetadataSchema,
  optionsRegenerationSchema,
  beatSchema,
  reelDraftSchema,
  seedPlanSchema,
  storyboardPlanSchema,
} from '@/lib/ai/generation-schemas';
import {
  geminiSchemaToJsonSchema,
  validateAgainstGeminiSchema,
  stripNullOptionals,
  extractJsonText,
  type GeminiSchemaNode,
} from './json-schema.shared';

const ALL_SCHEMAS: Record<string, GeminiSchemaNode> = {
  storyBibleGenerationSchema,
  storylineDiscoveryMetadataSchema,
  optionsRegenerationSchema,
  beatSchema,
  reelDraftSchema,
  seedPlanSchema,
  storyboardPlanSchema,
} as unknown as Record<string, GeminiSchemaNode>;

function collectObjectNodes(node: Record<string, unknown>, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node.type === 'object') {
    out.push(node);
    for (const child of Object.values((node.properties as Record<string, unknown>) ?? {})) {
      collectObjectNodes(child as Record<string, unknown>, out);
    }
  } else if (node.type === 'array' && node.items) {
    collectObjectNodes(node.items as Record<string, unknown>, out);
  }
  return out;
}

describe('geminiSchemaToJsonSchema', () => {
  it('converts every exported generation schema without throwing, strict and non-strict', () => {
    for (const schema of Object.values(ALL_SCHEMAS)) {
      expect(() => geminiSchemaToJsonSchema(schema, { strict: true })).not.toThrow();
      expect(() => geminiSchemaToJsonSchema(schema, { strict: false })).not.toThrow();
    }
  });

  it('makes storylineDiscoveryMetadataSchema.genre/ageFit nullable and required under strict', () => {
    const result = geminiSchemaToJsonSchema(storylineDiscoveryMetadataSchema, { strict: true });
    expect(result.required).toEqual(expect.arrayContaining(['intro', 'genre', 'ageFit']));
    const properties = result.properties as Record<string, { type: unknown }>;
    expect(properties.genre.type).toEqual(['string', 'null']);
    expect(properties.ageFit.type).toEqual(['string', 'null']);
    // intro was already required in the source schema -- it must stay plain 'string'.
    expect(properties.intro.type).toBe('string');
  });

  it('leaves genre/ageFit as plain optional strings when not strict', () => {
    const result = geminiSchemaToJsonSchema(storylineDiscoveryMetadataSchema, { strict: false });
    expect(result.required).toEqual(['intro']);
    const properties = result.properties as Record<string, { type: unknown }>;
    expect(properties.genre.type).toBe('string');
  });

  it('sets additionalProperties: false on every object node, for every schema, strict and non-strict', () => {
    for (const schema of Object.values(ALL_SCHEMAS)) {
      for (const strict of [true, false]) {
        const converted = geminiSchemaToJsonSchema(schema, { strict });
        const objectNodes = collectObjectNodes(converted);
        expect(objectNodes.length).toBeGreaterThan(0);
        for (const node of objectNodes) {
          expect(node.additionalProperties).toBe(false);
        }
      }
    }
  });

  it('throws on anyOf', () => {
    expect(() => geminiSchemaToJsonSchema({ anyOf: [{ type: 'STRING' }] }, { strict: true })).toThrow(/anyOf/);
  });
});

describe('validateAgainstGeminiSchema', () => {
  it('accepts a value matching optionsRegenerationSchema', () => {
    const value = { options: [{ label: 'Go north', intent: 'explore' }] };
    expect(validateAgainstGeminiSchema(value, optionsRegenerationSchema)).toEqual([]);
  });

  it('reports a missing required field', () => {
    const issues = validateAgainstGeminiSchema({ options: [{ intent: 'explore' }] }, optionsRegenerationSchema);
    expect(issues.some((i) => i.includes('label'))).toBe(true);
  });

  it('reports a wrong type', () => {
    const issues = validateAgainstGeminiSchema({ intro: 42 }, storylineDiscoveryMetadataSchema);
    expect(issues.some((i) => i.includes('expected string'))).toBe(true);
  });

  it('reports a non-integer where an integer is required', () => {
    const issues = validateAgainstGeminiSchema({ beatIndex: 1.5, title: 't', storyText: 's', sceneSummary: 's', imagePrompt: 'p' }, reelDraftSchema.properties.beats.items as GeminiSchemaNode);
    expect(issues.some((i) => i.includes('expected integer'))).toBe(true);
  });

  it('allows extra properties not in the schema', () => {
    const value = { options: [], somethingExtra: true };
    expect(validateAgainstGeminiSchema(value, optionsRegenerationSchema)).toEqual([]);
  });
});

describe('stripNullOptionals', () => {
  it('removes only optional fields whose value is null, keeps required fields', () => {
    const value = { intro: 'Hello', genre: null, ageFit: 'all' };
    const stripped = stripNullOptionals(value, storylineDiscoveryMetadataSchema) as Record<string, unknown>;
    expect(stripped).toEqual({ intro: 'Hello', ageFit: 'all' });
    expect('genre' in stripped).toBe(false);
  });

  it('keeps a null value on a field the original schema requires', () => {
    // intro is required in storylineDiscoveryMetadataSchema; a null there is left alone,
    // not silently dropped, since dropping a required field would break callers.
    const value = { intro: null, genre: null };
    const stripped = stripNullOptionals(value, storylineDiscoveryMetadataSchema) as Record<string, unknown>;
    expect(stripped.intro).toBeNull();
    expect('genre' in stripped).toBe(false);
  });
});

describe('extractJsonText', () => {
  it('strips a ```json fence', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a bare ``` fence', () => {
    expect(extractJsonText('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leaves unfenced text unchanged (trimmed)', () => {
    expect(extractJsonText('  {"a":1}  ')).toBe('{"a":1}');
  });
});
