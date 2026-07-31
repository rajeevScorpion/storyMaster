import type { Option } from '@/lib/types/story';

export const MAX_CUSTOM_OPTIONS_PER_BEAT = 3;

export function countCustomOptions(options: readonly Option[] | undefined): number {
  return options?.filter((option) => option.source === 'user_custom').length ?? 0;
}
