// Stable internal error codes + user-safe messages for Reference Personalization
// (pack doc 19). Server actions throw ReferenceError; the message is safe to show
// and the code is stable for the UI to branch on. Raw provider/stack details are
// never included.

export type ReferenceErrorCode =
  | 'REFERENCE_FEATURE_DISABLED'
  | 'REFERENCE_SIGN_IN_REQUIRED'
  | 'REFERENCE_TIER_NOT_ALLOWED'
  | 'REFERENCE_LIMIT_REACHED'
  | 'REFERENCE_INVALID_FILE'
  | 'REFERENCE_SUBJECT_UNCLEAR'
  | 'REFERENCE_WORLD_UNCLEAR'
  | 'REFERENCE_MODERATION_REJECTED'
  | 'REFERENCE_SOURCE_EXPIRED'
  | 'REFERENCE_SOURCE_NOT_FOUND'
  | 'REFERENCE_STYLE_MISMATCH'
  | 'REFERENCE_PROVIDER_UNAVAILABLE'
  | 'REFERENCE_ADOPTION_FAILED'
  | 'REFERENCE_INSUFFICIENT_COINS'
  | 'REFERENCE_NAME_CONFLICT'
  | 'REFERENCE_STORAGE_UNAVAILABLE';

const DEFAULT_MESSAGES: Record<ReferenceErrorCode, string> = {
  REFERENCE_FEATURE_DISABLED: 'Reference personalization is not available right now.',
  REFERENCE_SIGN_IN_REQUIRED: 'Please sign in to use reference personalization.',
  REFERENCE_TIER_NOT_ALLOWED: 'Your plan does not include this reference feature.',
  REFERENCE_LIMIT_REACHED: 'You have reached your reference limit for this story.',
  REFERENCE_INVALID_FILE: 'That image could not be used. Try a clear JPG, PNG, or WebP.',
  REFERENCE_SUBJECT_UNCLEAR: 'We could not find one clear character in that image.',
  REFERENCE_WORLD_UNCLEAR: 'We could not read a clear place or environment from that image.',
  REFERENCE_MODERATION_REJECTED: 'That image cannot be used for reference personalization.',
  REFERENCE_SOURCE_EXPIRED: 'This upload is no longer available. Please upload it again.',
  REFERENCE_SOURCE_NOT_FOUND: 'That reference could not be found.',
  REFERENCE_STYLE_MISMATCH: 'This reference does not match the story style. Re-adopt to continue.',
  REFERENCE_PROVIDER_UNAVAILABLE: 'Reference processing is temporarily unavailable. Please try again.',
  REFERENCE_ADOPTION_FAILED: 'We could not adopt this reference. Please try again or replace it.',
  REFERENCE_INSUFFICIENT_COINS: 'You do not have enough coins to adopt this reference.',
  REFERENCE_NAME_CONFLICT: 'That name is already used by another character in this story.',
  REFERENCE_STORAGE_UNAVAILABLE: 'Reference storage is unavailable right now. Please try again later.',
};

export class ReferenceError extends Error {
  code: ReferenceErrorCode;
  constructor(code: ReferenceErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'ReferenceError';
    this.code = code;
  }
}

export function referenceErrorMessage(code: ReferenceErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
