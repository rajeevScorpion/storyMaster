const REDACTED_KEYS = new Set(['email', 'contact', 'vpa', 'card', 'bank_account', 'wallet', 'address']);
const REDACTED_VALUE = '[redacted]';

/** Deep-copies `value`, replacing PII-bearing keys at any depth before a Razorpay payload is stored. */
export function redactRazorpayPayload<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEYS.has(key) ? REDACTED_VALUE : redactValue(entry);
    }
    return result;
  }

  return value;
}
