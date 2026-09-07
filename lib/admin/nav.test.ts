import { describe, it, expect } from 'vitest';
import {
  ADMIN_NAV,
  SETTINGS_NAV_ITEMS,
  PRICING_NAV_ITEMS,
  findSettingsNavItem,
  findPricingNavItem,
} from './nav';

// The exact set of Global Settings destinations. This list doubles as the
// route contract — every href must correspond to an existing app/admin route.
const EXPECTED_SETTINGS_HREFS = [
  '/admin/settings',
  '/admin/settings/storyboard',
  '/admin/settings/reels',
  '/admin/settings/reader',
  '/admin/settings/authoring',
  '/admin/settings/beat-control',
  '/admin/settings/media',
  '/admin/settings/media-pipeline',
  '/admin/settings/image-batch',
  '/admin/settings/prompt-compiler',
  '/admin/settings/characters',
  '/admin/settings/character-universe',
  '/admin/settings/references',
  '/admin/settings/narration',
  '/admin/settings/video-export',
  '/admin/settings/generation',
  '/admin/settings/pages',
];

const EXPECTED_PRICING_HREFS = [
  '/admin/pricing',
  '/admin/pricing/plans',
  '/admin/pricing/top-up-packs',
  '/admin/pricing/promotions',
  '/admin/pricing/action-costs',
  '/admin/pricing/runtime-controls',
  '/admin/pricing/recovery-tools',
  '/admin/pricing/audit',
];

function collectAllHrefs(): string[] {
  const hrefs: string[] = [];
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      hrefs.push(item.href);
      for (const childGroup of item.childGroups ?? []) {
        for (const child of childGroup.items) {
          hrefs.push(child.href);
        }
      }
    }
  }
  return hrefs;
}

describe('admin nav config', () => {
  it('has no duplicate hrefs across the whole tree (ignoring hub self-links)', () => {
    // Parent hub items (Global Settings, Pricing and offers, Agents)
    // intentionally share an href with their overview child, so dedupe those
    // before checking.
    const hrefs = collectAllHrefs().filter(
      (href) => href !== '/admin/settings' && href !== '/admin/pricing' && href !== '/admin/agents'
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('exposes exactly the known settings destinations', () => {
    expect(SETTINGS_NAV_ITEMS.map((item) => item.href)).toEqual(EXPECTED_SETTINGS_HREFS);
  });

  it('exposes exactly the known pricing destinations', () => {
    expect(PRICING_NAV_ITEMS.map((item) => item.href)).toEqual(EXPECTED_PRICING_HREFS);
  });

  it('gives every settings and pricing item a defined icon', () => {
    for (const item of [...SETTINGS_NAV_ITEMS, ...PRICING_NAV_ITEMS]) {
      expect(item.icon, `icon for ${item.id}`).toBeTruthy();
    }
  });

  it('never reuses an icon within the settings list', () => {
    const icons = SETTINGS_NAV_ITEMS.map((item) => item.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('never reuses an icon within the pricing list', () => {
    const icons = PRICING_NAV_ITEMS.map((item) => item.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('includes the admin manual (help) as a top-level Configuration item', () => {
    const configuration = ADMIN_NAV.find((group) => group.id === 'configuration');
    const help = configuration?.items.find((item) => item.href === '/admin/help');
    expect(help).toBeDefined();
    // Help is not a Global Settings section, so it must not leak into the
    // settings destinations contract.
    expect(SETTINGS_NAV_ITEMS.some((item) => item.href === '/admin/help')).toBe(false);
  });

  it('includes operational policies as a top-level Configuration item', () => {
    const configuration = ADMIN_NAV.find((group) => group.id === 'configuration');
    expect(configuration?.items.find((item) => item.href === '/admin/policies')).toBeDefined();
  });

  it('includes user management as a top-level Operations item', () => {
    const operations = ADMIN_NAV.find((group) => group.id === 'operations');
    expect(operations?.items.find((item) => item.href === '/admin/users')).toBeDefined();
  });

  it('includes story visuals as a top-level Studio item', () => {
    const studio = ADMIN_NAV.find((group) => group.id === 'studio');
    expect(studio?.items.find((item) => item.href === '/admin/settings/story-visuals')).toBeDefined();
  });

  it('includes the task pool as an Agents child, after Personas', () => {
    const agentic = ADMIN_NAV.find((group) => group.id === 'agentic');
    const agents = agentic?.items.find((item) => item.href === '/admin/agents');
    const ids = agents?.childGroups?.flatMap((group) => group.items.map((item) => item.id)) ?? [];
    expect(ids.indexOf('tasks')).toBeGreaterThan(-1);
    expect(ids.indexOf('tasks')).toBeGreaterThan(ids.indexOf('personas'));
  });

  it('includes the run monitor and routing reference as Agents children, after the task pool', () => {
    const agentic = ADMIN_NAV.find((group) => group.id === 'agentic');
    const agents = agentic?.items.find((item) => item.href === '/admin/agents');
    const childItems = agents?.childGroups?.flatMap((group) => group.items) ?? [];
    const ids = childItems.map((item) => item.id);

    expect(ids.indexOf('runs')).toBeGreaterThan(-1);
    expect(ids.indexOf('routing')).toBeGreaterThan(-1);
    expect(ids.indexOf('runs')).toBeGreaterThan(ids.indexOf('tasks'));
    expect(ids.indexOf('routing')).toBeGreaterThan(ids.indexOf('tasks'));

    expect(childItems.find((item) => item.id === 'runs')?.href).toBe('/admin/agents/runs');
    expect(childItems.find((item) => item.id === 'routing')?.href).toBe('/admin/agents/routing');
  });

  it('resolves items by id', () => {
    expect(findSettingsNavItem('storyboard')?.href).toBe('/admin/settings/storyboard');
    expect(findSettingsNavItem('nonexistent')).toBeUndefined();
    expect(findPricingNavItem('plans')?.href).toBe('/admin/pricing/plans');
    expect(findPricingNavItem('nonexistent')).toBeUndefined();
  });
});
