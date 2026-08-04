import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_STORY_VISUAL_CATALOG,
  findStoryVisualOption,
  getDefaultStoryVisualOption,
  normalizeStoryVisualCatalog,
  slugifyStoryVisualOption,
  type StoryVisualOption,
} from './story-visual-options.shared';

function option(overrides: Partial<StoryVisualOption>): StoryVisualOption {
  return {
    id: 'option-1',
    category: 'style',
    key: 'custom_style',
    label: 'Custom Style',
    description: 'A custom style.',
    visualPromptDefiner: 'Custom rendering direction.',
    narrativePromptDefiner: null,
    status: 'published',
    sortOrder: 10,
    isDefault: false,
    ...overrides,
  };
}

describe('story visual option catalog', () => {
  it('uses published database rows and fills missing categories with safe built-ins', () => {
    const catalog = normalizeStoryVisualCatalog([
      option({ id: 'style-2', key: 'second', label: 'Second', sortOrder: 20 }),
      option({ id: 'style-1', key: 'first', label: 'First', sortOrder: 10, isDefault: true }),
      option({ id: 'draft', key: 'hidden', status: 'draft' }),
    ]);

    expect(catalog.styles.map((entry) => entry.key)).toEqual(['first', 'second']);
    expect(catalog.styles.some((entry) => entry.key === 'hidden')).toBe(false);
    expect(catalog.moods).toEqual(BUILT_IN_STORY_VISUAL_CATALOG.moods);
    expect(getDefaultStoryVisualOption(catalog, 'style').key).toBe('first');
  });

  it('finds options by stable category and key', () => {
    expect(findStoryVisualOption(BUILT_IN_STORY_VISUAL_CATALOG, 'palette', 'neon')?.label).toBe('Neon Night');
    expect(findStoryVisualOption(BUILT_IN_STORY_VISUAL_CATALOG, 'mood', 'neon')).toBeUndefined();
  });

  it('creates stable underscore keys for admin-authored options', () => {
    expect(slugifyStoryVisualOption('  Paper & Ink / Dream  ')).toBe('paper_ink_dream');
  });
});
