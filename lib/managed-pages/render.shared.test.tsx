import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  extractManagedPageHeadingsFromContent,
  renderManagedPageBlocksFromContent,
  slugifyManagedPageHeading,
} from './render.shared';

function renderHtml(content: string): string {
  return renderToStaticMarkup(<>{renderManagedPageBlocksFromContent(content)}</>);
}

describe('slugifyManagedPageHeading', () => {
  it('lowercases, strips punctuation, and hyphenates spaces', () => {
    expect(slugifyManagedPageHeading('Your Content & Rights!')).toBe('your-content-rights');
  });
});

describe('extractManagedPageHeadingsFromContent', () => {
  it('collects ## and ### headings with stable, deduped ids', () => {
    const content = ['# Title', '## Your account', 'text', '### Security', '## Your account'].join('\n');
    const headings = extractManagedPageHeadingsFromContent(content);

    expect(headings).toEqual([
      { id: 'your-account', title: 'Your account', level: 2 },
      { id: 'security', title: 'Security', level: 3 },
      { id: 'your-account-1', title: 'Your account', level: 2 },
    ]);
  });

  it('ignores h1 and h4', () => {
    const headings = extractManagedPageHeadingsFromContent('# Title\n#### Fine print');
    expect(headings).toHaveLength(0);
  });
});

describe('renderManagedPageBlocksFromContent', () => {
  it('renders bold, inline code, and internal/external links', () => {
    const html = renderHtml('This is **bold**, `code`, an [internal link](/terms) and an [external link](https://example.com).');
    expect(html).toContain('<strong');
    expect(html).toContain('bold');
    expect(html).toContain('<code');
    expect(html).toContain('code');
    expect(html).toMatch(/<a[^>]*href="\/terms"/);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com"[^>]*target="_blank"/);
  });

  it('assigns a heading id matching the slug for anchor navigation', () => {
    const html = renderHtml('## Your Content & Rights');
    expect(html).toContain('id="your-content-rights"');
  });

  it('renders an ordered list', () => {
    const html = renderHtml('1. First step\n2. Second step');
    expect(html).toContain('<ol');
    expect(html).toContain('First step');
    expect(html).toContain('Second step');
  });

  it('renders an unordered list', () => {
    const html = renderHtml('- One\n- Two');
    expect(html).toContain('<ul');
    expect(html).toContain('One');
  });

  it('renders a blockquote', () => {
    const html = renderHtml('> A quoted line\n> continued');
    expect(html).toContain('<blockquote');
    expect(html).toContain('A quoted line');
  });

  it('renders a horizontal rule', () => {
    const html = renderHtml('above\n\n---\n\nbelow');
    expect(html).toContain('<hr');
  });

  it('renders a pipe table with header and rows', () => {
    const content = ['| Name | Value |', '|---|---|', '| a | 1 |', '| b | 2 |'].join('\n');
    const html = renderHtml(content);
    expect(html).toContain('<table');
    expect(html).toContain('Name');
    expect(html).toContain('Value');
    expect(html).toContain('<td');
  });

  it('groups contiguous plain lines into a single paragraph', () => {
    const blocks = renderManagedPageBlocksFromContent('line one\nline two\n\nnext paragraph');
    // Two <p> blocks: the two-line paragraph collapses into one node.
    expect(blocks).toHaveLength(2);
  });

  it('never uses dangerouslySetInnerHTML — output is built from element/text nodes only', () => {
    const html = renderHtml('<script>alert(1)</script> and **bold**');
    // The literal angle brackets must come out escaped by React's own text-node
    // rendering, proving no raw HTML injection point exists in this renderer.
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
