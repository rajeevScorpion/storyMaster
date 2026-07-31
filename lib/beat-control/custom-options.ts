import type { Option } from '@/lib/types/story';

export const MAX_CUSTOM_OPTIONS_PER_BEAT = 3;

export function countCustomOptions(options: readonly Option[] | undefined): number {
  return options?.filter((option) => option.source === 'user_custom').length ?? 0;
}

export function canDeleteCustomOption(option: Option, hasBeenExplored: boolean): boolean {
  return option.source === 'user_custom' && !hasBeenExplored;
}
