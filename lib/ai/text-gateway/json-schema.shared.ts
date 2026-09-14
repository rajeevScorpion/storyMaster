// Converts and validates against the Gemini `Type`-based schemas in lib/ai/generation-schemas.ts.
// Deliberately does not import '@google/genai': Type's members are plain strings at runtime
// ('OBJECT', 'ARRAY', ...), so schema.type is typed as `string` here and every existing schema
// is structurally compatible without a dependency.

export interface GeminiSchemaNode {
  type?: string;
  properties?: Record<string, GeminiSchemaNode>;
  items?: GeminiSchemaNode;
  required?: string[];
  enum?: string[];
  nullable?: boolean;
  description?: string;
  // Present only to detect and reject it -- Gemini schemas in this codebase never use it.
  anyOf?: unknown;
}

const JSON_SCHEMA_TYPE_BY_GEMINI_TYPE: Record<string, string> = {
  OBJECT: 'object',
  ARRAY: 'array',
  STRING: 'string',
  INTEGER: 'integer',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  NULL: 'null',
};

function toNullableType(type: unknown): unknown {
  if (Array.isArray(type)) return type.includes('null') ? type : [...type, 'null'];
  return [type, 'null'];
}

/**
 * strict: true makes every property required (optional ones become nullable+required, since
 * OpenAI/OpenRouter strict json_schema mode requires every key in `required`) and sets
 * additionalProperties: false on every object, recursively. strict: false produces a plain
 * descriptive schema (used to describe the shape in a prompt for JSON-mode-only models).
 */
export function geminiSchemaToJsonSchema(schema: GeminiSchemaNode, options: { strict: boolean }): Record<string, unknown> {
  if (schema.anyOf !== undefined) {
    throw new Error('geminiSchemaToJsonSchema: anyOf is not supported');
  }

  const node: Record<string, unknown> = {};

  if (schema.type === 'OBJECT') {
    const properties = schema.properties ?? {};
    const propNames = Object.keys(properties);
    const originalRequired = new Set(schema.required ?? []);
    const convertedProps: Record<string, unknown> = {};
    for (const name of propNames) {
      const converted = geminiSchemaToJsonSchema(properties[name], options);
      convertedProps[name] = options.strict && !originalRequired.has(name)
        ? { ...converted, type: toNullableType(converted.type) }
        : converted;
    }
    node.type = 'object';
    node.properties = convertedProps;
    node.required = options.strict ? propNames : [...originalRequired];
    node.additionalProperties = false;
  } else if (schema.type === 'ARRAY') {
    node.type = 'array';
    node.items = schema.items ? geminiSchemaToJsonSchema(schema.items, options) : {};
  } else {
    node.type = JSON_SCHEMA_TYPE_BY_GEMINI_TYPE[schema.type ?? ''] ?? 'string';
    if (schema.enum) node.enum = schema.enum;
  }

  if (schema.nullable) node.type = toNullableType(node.type);
  if (schema.description) node.description = schema.description;
  return node;
}

/** Types, required fields, integer-ness, array items. Extra properties are allowed --
 * this mirrors what Gemini's own structured output already tolerates, not a strict contract. */
export function validateAgainstGeminiSchema(value: unknown, schema: GeminiSchemaNode, path = '$'): string[] {
  if (schema.nullable && value === null) return [];

  switch (schema.type) {
    case 'OBJECT': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [`${path}: expected object`];
      }
      const obj = value as Record<string, unknown>;
      const issues: string[] = [];
      for (const key of schema.required ?? []) {
        if (!(key in obj)) issues.push(`${path}.${key}: missing required field`);
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (key in obj) issues.push(...validateAgainstGeminiSchema(obj[key], childSchema, `${path}.${key}`));
      }
      return issues;
    }
    case 'ARRAY': {
      if (!Array.isArray(value)) return [`${path}: expected array`];
      if (!schema.items) return [];
      return value.flatMap((item, index) => validateAgainstGeminiSchema(item, schema.items!, `${path}[${index}]`));
    }
    case 'INTEGER':
      return typeof value === 'number' && Number.isInteger(value) ? [] : [`${path}: expected integer`];
    case 'NUMBER':
      return typeof value === 'number' ? [] : [`${path}: expected number`];
    case 'STRING':
      return typeof value === 'string' ? [] : [`${path}: expected string`];
    case 'BOOLEAN':
      return typeof value === 'boolean' ? [] : [`${path}: expected boolean`];
    default:
      return [];
  }
}

/** Removes optional (per the ORIGINAL, non-strict schema) fields whose value is null --
 * undoes the nullable-required widening geminiSchemaToJsonSchema's strict mode requires,
 * so callers get back the shape they would have gotten from Gemini. */
export function stripNullOptionals(value: unknown, schema: GeminiSchemaNode): unknown {
  if (schema.type === 'OBJECT' && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = new Set(schema.required ?? []);
    const result: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(obj)) {
      if (!required.has(key) && fieldValue === null) continue;
      const childSchema = schema.properties?.[key];
      result[key] = childSchema ? stripNullOptionals(fieldValue, childSchema) : fieldValue;
    }
    return result;
  }
  if (schema.type === 'ARRAY' && Array.isArray(value) && schema.items) {
    return value.map((item) => stripNullOptionals(item, schema.items!));
  }
  return value;
}

/** Strips a ```json fence (or bare ```) wrapping a model's JSON response. */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}
