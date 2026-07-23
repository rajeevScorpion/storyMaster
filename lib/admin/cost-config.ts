/**
 * Shared constants for the admin cost dashboard. Kept out of the `'use server'`
 * action file because those may only export async functions — this plain module
 * lets both the server action and the page import the same option list.
 */

/** Selectable "show last N beats" options for the cost dashboard filter. */
export const RECENT_BEAT_LIMIT_OPTIONS = [5, 10, 20] as const;
export const DEFAULT_RECENT_BEAT_LIMIT = RECENT_BEAT_LIMIT_OPTIONS[0];
