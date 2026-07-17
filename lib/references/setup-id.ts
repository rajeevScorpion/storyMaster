// Client-side reference setup-id lifecycle, shared by the v1 adoption panel and
// the v2 direct-input strip. The setup id groups a user's uploads before a story
// row exists; persisting it to localStorage lets a closed browser resume the
// same setup.

export const SETUP_ID_STORAGE_KEY = 'kissago_reference_setup_id';

export function newSetupId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `setup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Read the stored setup id, creating + persisting one if absent. */
export function readOrCreateSetupId(): string {
  let stored = '';
  try {
    stored = window.localStorage.getItem(SETUP_ID_STORAGE_KEY) ?? '';
  } catch {
    /* ignore */
  }
  const id = stored || newSetupId();
  try {
    window.localStorage.setItem(SETUP_ID_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function clearStoredSetupId(): void {
  try {
    window.localStorage.removeItem(SETUP_ID_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
