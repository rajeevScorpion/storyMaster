import { describe, expect, it } from 'vitest';
import { buildTestLabBrief, TEST_LAB_BRIEF_MAX_LENGTH, type TestLabBriefPersona } from './test-lab.shared';

function persona(overrides: Partial<TestLabBriefPersona> = {}): TestLabBriefPersona {
  return {
    displayName: 'Aria Nightweaver',
    speciality: 'Cozy mysteries for tweens',
    genres: ['mystery', 'friendship'],
    ageGroup: 'kids_5_8',
    language: 'english',
    ...overrides,
  };
}

describe('buildTestLabBrief', () => {
  it('includes the operator-supplied theme when present', () => {
    const brief = buildTestLabBrief(persona(), 'a lighthouse that hums at midnight');
    expect(brief).toContain('a lighthouse that hums at midnight');
    expect(brief).toContain('Operator-supplied theme for this test run');
  });

  it('falls back to a no-theme sentence when theme is absent', () => {
    const brief = buildTestLabBrief(persona(), undefined);
    expect(brief).toContain('No theme was supplied');
    expect(brief).not.toContain('undefined');
    expect(brief).not.toContain('null');
  });

  it('falls back to a no-theme sentence when theme is null', () => {
    const brief = buildTestLabBrief(persona(), null);
    expect(brief).toContain('No theme was supplied');
  });

  it('treats a whitespace-only theme as absent', () => {
    const brief = buildTestLabBrief(persona(), '   \n\t  ');
    expect(brief).toContain('No theme was supplied');
    expect(brief).not.toContain('Operator-supplied theme');
  });

  it('omits the speciality sentence for a persona with no speciality', () => {
    const brief = buildTestLabBrief(persona({ speciality: null }));
    expect(brief).not.toContain('Speciality:');
    expect(brief).not.toContain('null');
  });

  it('omits the genres sentence for a persona with no genres', () => {
    const brief = buildTestLabBrief(persona({ genres: [] }));
    expect(brief).not.toContain('Preferred genres:');
  });

  it('always names the persona, audience and language regardless of theme/speciality/genres', () => {
    const brief = buildTestLabBrief(persona({ speciality: null, genres: [] }), null);
    expect(brief).toContain('Aria Nightweaver');
    expect(brief).toContain('kids_5_8');
    expect(brief).toContain('english');
  });

  it('caps the result at TEST_LAB_BRIEF_MAX_LENGTH even for a very long theme', () => {
    const longTheme = 'x'.repeat(TEST_LAB_BRIEF_MAX_LENGTH * 2);
    const brief = buildTestLabBrief(persona(), longTheme);
    expect(brief.length).toBe(TEST_LAB_BRIEF_MAX_LENGTH);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const a = buildTestLabBrief(persona(), 'a recurring dream about the sea');
    const b = buildTestLabBrief(persona(), 'a recurring dream about the sea');
    expect(a).toBe(b);
  });
});
