import { afterEach, describe, expect, it, vi } from 'vitest';

import { logTiming } from './timing.shared';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('logTiming', () => {
  it('stays silent on success when the flag is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_LOG_TIMING', undefined as unknown as string);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logTiming('story_runtime.generate_story_beat.attempt', { durationMs: 42, success: true });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent on success when the flag is set to something other than "1"', () => {
    vi.stubEnv('NEXT_PUBLIC_LOG_TIMING', 'true');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logTiming('story_runtime.generate_story_beat.attempt', { durationMs: 42, success: true });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs on success when NEXT_PUBLIC_LOG_TIMING is exactly "1"', () => {
    vi.stubEnv('NEXT_PUBLIC_LOG_TIMING', '1');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logTiming('story_runtime.generate_story_beat.attempt', { durationMs: 42, success: true, beatNumber: 3 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      '[timing:story_runtime.generate_story_beat.attempt]',
      { durationMs: 42, success: true, beatNumber: 3 }
    );
  });

  it('warns on success:false even without the flag', () => {
    vi.stubEnv('NEXT_PUBLIC_LOG_TIMING', undefined as unknown as string);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logTiming('text_gateway.story_generation', { durationMs: 7, success: false, message: 'timeout' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[timing:text_gateway.story_generation]',
      { durationMs: 7, success: false, message: 'timeout' }
    );
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('warns on success:false even when the flag is set', () => {
    vi.stubEnv('NEXT_PUBLIC_LOG_TIMING', '1');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logTiming('text_gateway.story_generation', { durationMs: 7, success: false, message: 'timeout' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
