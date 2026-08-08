import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, cachedMany, clearCache, invalidatePrefix } from './ttl-cache';

afterEach(() => {
  clearCache();
  vi.useRealTimers();
});

describe('cached', () => {
  it('serves the cached value until the TTL expires', async () => {
    const fill = vi.fn().mockResolvedValue('value');

    expect(await cached('k', 1000, fill)).toBe('value');
    expect(await cached('k', 1000, fill)).toBe('value');
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('refills once the entry is stale', async () => {
    vi.useFakeTimers();
    const fill = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    expect(await cached('k', 1000, fill)).toBe('first');
    vi.advanceTimersByTime(1001);
    expect(await cached('k', 1000, fill)).toBe('second');
  });

  it('collapses concurrent callers into a single fill', async () => {
    let resolveFill: (value: string) => void = () => {};
    const fill = vi.fn(() => new Promise<string>((resolve) => { resolveFill = resolve; }));

    const inFlight = [cached('k', 1000, fill), cached('k', 1000, fill), cached('k', 1000, fill)];
    resolveFill('once');

    expect(await Promise.all(inFlight)).toEqual(['once', 'once', 'once']);
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed fill', async () => {
    const fill = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    await expect(cached('k', 1000, fill)).rejects.toThrow('transient');
    // A cached rejection would keep the surface dead for the whole TTL.
    expect(await cached('k', 1000, fill)).toBe('recovered');
  });

  it('keeps separate values per key', async () => {
    expect(await cached('a', 1000, async () => 1)).toBe(1);
    expect(await cached('b', 1000, async () => 2)).toBe(2);
    expect(await cached('a', 1000, async () => 99)).toBe(1);
  });
});

describe('cachedMany', () => {
  it('only fills the keys that are missing', async () => {
    const fill = vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, key.length])));

    await cachedMany(['aa', 'bbb'], 1000, fill);
    const second = await cachedMany(['aa', 'bbb', 'cccc'], 1000, fill);

    expect(fill).toHaveBeenLastCalledWith(['cccc']);
    expect(second.get('aa')).toBe(2);
    expect(second.get('cccc')).toBe(4);
  });

  it('skips the fill entirely when everything is warm', async () => {
    const fill = vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, true])));

    await cachedMany(['x', 'y'], 1000, fill);
    await cachedMany(['x', 'y'], 1000, fill);

    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('omits keys the fill could not resolve rather than caching a blank', async () => {
    const fill = vi.fn(async () => new Map([['found', 1]]));

    const result = await cachedMany(['found', 'absent'], 1000, fill);

    expect(result.has('absent')).toBe(false);
    // The unresolved key was not cached, so it is retried next time.
    await cachedMany(['found', 'absent'], 1000, fill);
    expect(fill).toHaveBeenLastCalledWith(['absent']);
  });

  it('de-duplicates repeated keys in one call', async () => {
    const fill = vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, 1])));

    await cachedMany(['dup', 'dup', 'dup'], 1000, fill);

    expect(fill).toHaveBeenCalledWith(['dup']);
  });
});

describe('invalidatePrefix', () => {
  it('drops only the matching namespace', async () => {
    await cached('feed:one', 10_000, async () => 'a');
    await cached('other:one', 10_000, async () => 'b');

    invalidatePrefix('feed:');

    expect(await cached('feed:one', 10_000, async () => 'refilled')).toBe('refilled');
    expect(await cached('other:one', 10_000, async () => 'refilled')).toBe('b');
  });
});
