import { describe, expect, it } from 'vitest';
import { extractMentionQueryAtCursor, parseCharacterMentions } from './character-mentions';

const KNOWN = ['Milo', 'Tara', 'Captain Barnaby', 'Pip'];

describe('parseCharacterMentions', () => {
  it('parses the spec example with two valid mentions', () => {
    const result = parseCharacterMentions(
      '@Milo and @Tara climb the spiral staircase to see the city from above.',
      KNOWN
    );
    expect(result.mentions).toHaveLength(2);
    expect(result.mentions[0]).toMatchObject({ displayText: '@Milo', characterName: 'Milo', valid: true });
    expect(result.mentions[1]).toMatchObject({ displayText: '@Tara', characterName: 'Tara', valid: true });
    expect(result.unknownMentions).toEqual([]);
  });

  it('matches multi-word names longest-first', () => {
    const result = parseCharacterMentions('@Captain Barnaby waves.', ['Captain', 'Captain Barnaby']);
    expect(result.mentions[0]).toMatchObject({
      displayText: '@Captain Barnaby',
      characterName: 'Captain Barnaby',
      valid: true,
    });
  });

  it('is case-insensitive but returns the canonical name', () => {
    const result = parseCharacterMentions('@milo hides.', KNOWN);
    expect(result.mentions[0]).toMatchObject({ characterName: 'Milo', valid: true });
  });

  it('flags unknown mentions', () => {
    const result = parseCharacterMentions('@Milo follows @Zora into the cave.', KNOWN);
    expect(result.mentions).toHaveLength(2);
    expect(result.mentions[1]).toMatchObject({ displayText: '@Zora', valid: false });
    expect(result.unknownMentions).toEqual(['@Zora']);
  });

  it('does not match a known name inside a longer word', () => {
    const result = parseCharacterMentions('@Milos is not Milo.', ['Milo']);
    expect(result.mentions[0]).toMatchObject({ displayText: '@Milos', valid: false });
  });

  it('handles punctuation right after a mention', () => {
    const result = parseCharacterMentions('Hello @Pip, welcome!', KNOWN);
    expect(result.mentions[0]).toMatchObject({ displayText: '@Pip', characterName: 'Pip', valid: true });
  });

  it('ignores a bare @ at the end of the text', () => {
    const result = parseCharacterMentions('Look @', KNOWN);
    expect(result.mentions).toEqual([]);
  });

  it('records mention offsets', () => {
    const text = 'Then @Milo jumps.';
    const result = parseCharacterMentions(text, KNOWN);
    const mention = result.mentions[0];
    expect(text.slice(mention.start, mention.end)).toBe('@Milo');
  });
});

describe('extractMentionQueryAtCursor', () => {
  it('returns the query while typing a mention', () => {
    const text = 'Ask @Cap';
    expect(extractMentionQueryAtCursor(text, text.length)).toEqual({ query: 'Cap', start: 4 });
  });

  it('allows single spaces for multi-word names', () => {
    const text = 'Ask @Captain Ba';
    expect(extractMentionQueryAtCursor(text, text.length)).toEqual({ query: 'Captain Ba', start: 4 });
  });

  it('returns null when no @ is present', () => {
    expect(extractMentionQueryAtCursor('No mention here', 10)).toBeNull();
  });

  it('ends the mention context on a newline', () => {
    const text = 'Ask @Milo\nthen';
    expect(extractMentionQueryAtCursor(text, text.length)).toBeNull();
  });
});
