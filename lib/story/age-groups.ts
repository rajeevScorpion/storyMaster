import type { AgeGroup } from '@/lib/types/story';

export const STORY_AGE_GROUPS = [
  { value: 'all_ages', label: 'All ages' },
  { value: 'kids_3_5', label: 'Kids 3-5' },
  { value: 'kids_5_8', label: 'Kids 5-8' },
  { value: 'kids_8_12', label: 'Kids 8-12' },
  { value: 'teens', label: 'Teens' },
  { value: 'adults', label: 'Adults' },
] as const satisfies readonly { value: AgeGroup; label: string }[];

export const AGE_GROUP_VALUES: readonly AgeGroup[] = STORY_AGE_GROUPS.map((g) => g.value);

/** The five concrete groups a reviewer may claim coverage of. Excludes 'all_ages' per D16. */
export const ROUTABLE_AGE_GROUPS: readonly AgeGroup[] =
  AGE_GROUP_VALUES.filter((v) => v !== 'all_ages');

export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === 'string' && (AGE_GROUP_VALUES as readonly string[]).includes(value);
}
