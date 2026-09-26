import { describe, expect, it } from 'vitest';
import {
  isCrossOriginIsolationExemptPath,
  shouldReloadAcrossIsolationBoundary,
} from './cross-origin-isolation.shared';

describe('isCrossOriginIsolationExemptPath', () => {
  it('exempts the wallet and anything under it', () => {
    expect(isCrossOriginIsolationExemptPath('/wallet')).toBe(true);
    expect(isCrossOriginIsolationExemptPath('/wallet/')).toBe(true);
    expect(isCrossOriginIsolationExemptPath('/wallet/receipts')).toBe(true);
  });

  it('keeps isolation everywhere else, including look-alike paths', () => {
    for (const path of ['/', '/create', '/story/abc', '/explore/abc', '/admin/pricing', '/wallets', '/walletx']) {
      expect(isCrossOriginIsolationExemptPath(path)).toBe(false);
    }
  });
});

describe('shouldReloadAcrossIsolationBoundary', () => {
  it('does nothing while the route stays on the same side as the document', () => {
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/', routePath: '/story/abc', crossOriginIsolated: true })).toBe(false);
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/wallet', routePath: '/wallet', crossOriginIsolated: false })).toBe(false);
  });

  it('reloads on entering the wallet from an isolated document, so checkout can load', () => {
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/create', routePath: '/wallet', crossOriginIsolated: true })).toBe(true);
  });

  it('skips that reload where the browser never isolated', () => {
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/create', routePath: '/wallet', crossOriginIsolated: false })).toBe(false);
  });

  it('reloads on leaving the wallet, so video export gets isolation back', () => {
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/wallet', routePath: '/', crossOriginIsolated: false })).toBe(true);
  });

  it('cannot loop: after either reload the document path and route agree', () => {
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/wallet', routePath: '/wallet', crossOriginIsolated: true })).toBe(false);
    expect(shouldReloadAcrossIsolationBoundary({ documentPath: '/', routePath: '/', crossOriginIsolated: false })).toBe(false);
  });
});
