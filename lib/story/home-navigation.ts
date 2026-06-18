const HOME_RESET_REQUEST_KEY = 'kissago-reset-story-on-home';

export function requestHomeStoryReset(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(HOME_RESET_REQUEST_KEY, '1');
  } catch {}
}

export function hasHomeStoryResetRequest(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(HOME_RESET_REQUEST_KEY) === '1';
  } catch {
    return false;
  }
}

export function consumeHomeStoryResetRequest(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const requested = window.sessionStorage.getItem(HOME_RESET_REQUEST_KEY) === '1';
    if (requested) {
      window.sessionStorage.removeItem(HOME_RESET_REQUEST_KEY);
    }
    return requested;
  } catch {
    return false;
  }
}
