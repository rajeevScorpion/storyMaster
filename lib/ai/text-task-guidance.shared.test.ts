import { describe, expect, it } from 'vitest';
import { TASK_DEFINITIONS } from '@/lib/ai/model-config.shared';
import { isTextModelTask } from '@/lib/ai/text-models.shared';
import { SUGGESTED_THINKING_STEPS, TEXT_TASK_GUIDANCE, compareToSuggestion, nearestOfferedLevel } from './text-task-guidance.shared';

describe('TEXT_TASK_GUIDANCE', () => {
  it('has exactly one entry per text task, and no entry for a non-text task', () => {
    const textTaskKeys = TASK_DEFINITIONS.filter((task) => isTextModelTask(task.key)).map((task) => task.key).sort();
    const guidanceKeys = Object.keys(TEXT_TASK_GUIDANCE).sort();
    expect(guidanceKeys).toEqual(textTaskKeys);
  });

  it('gives every entry a non-empty summary, cadence, why and a valid suggested level', () => {
    for (const [taskKey, guidance] of Object.entries(TEXT_TASK_GUIDANCE)) {
      expect(guidance.summary.length, `${taskKey}.summary`).toBeGreaterThan(0);
      expect(guidance.cadence.length, `${taskKey}.cadence`).toBeGreaterThan(0);
      expect(guidance.why.length, `${taskKey}.why`).toBeGreaterThan(0);
      expect(SUGGESTED_THINKING_STEPS, `${taskKey}.suggested`).toContain(guidance.suggested);
    }
  });
});

describe('nearestOfferedLevel', () => {
  it('returns an exact match when offered', () => {
    expect(nearestOfferedLevel('medium', ['low', 'medium', 'high'])).toBe('medium');
  });

  it('picks the nearest level when there is no exact match', () => {
    expect(nearestOfferedLevel('minimal', ['low', 'medium', 'high'])).toBe('low');
  });

  it('breaks a tie by picking the lower (cheaper) level', () => {
    expect(nearestOfferedLevel('low', ['minimal', 'medium'])).toBe('minimal');
  });

  it('returns null when nothing is offered', () => {
    expect(nearestOfferedLevel('medium', [])).toBeNull();
  });
});

describe('compareToSuggestion', () => {
  it('flags an effective level well above the suggestion', () => {
    expect(compareToSuggestion('high', 'low', ['none', 'minimal', 'low', 'medium', 'high'])).toBe('above');
  });

  it('does not flag a level only one step above the suggestion', () => {
    expect(compareToSuggestion('high', 'medium', ['none', 'minimal', 'low', 'medium', 'high'])).toBeNull();
  });

  it('flags an effective level well below the suggestion', () => {
    expect(compareToSuggestion('none', 'medium', ['none', 'minimal', 'low', 'medium', 'high'])).toBe('below');
  });

  it('returns null for a null (provider default) effective level', () => {
    expect(compareToSuggestion(null, 'medium', ['none', 'minimal', 'low', 'medium', 'high'])).toBeNull();
  });

  it('returns null when the model offers no thinking levels', () => {
    expect(compareToSuggestion('high', 'medium', [])).toBeNull();
  });

  it('compares against the nearest offered level, not the raw suggestion', () => {
    // Low-floor model: 'minimal' isn't offered, so 'low' is the nearest stand-in for it.
    // Effective 'low' matches that stand-in exactly, so no note.
    expect(compareToSuggestion('low', 'minimal', ['low', 'medium', 'high'])).toBeNull();
  });
});
