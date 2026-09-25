import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { MANAGED_PAGE_DEFINITIONS } from './registry';
import { extractManagedPageHeadingsFromContent, renderManagedPageBlocksFromContent } from './render.shared';

/**
 * Guards the four Phase-7 legal documents: every bracketed placeholder must be
 * gone before publish (the pack's own rule — nothing with a bracket ships),
 * and the seed markdown must parse without throwing so a future edit can't
 * silently break the renderer.
 */
const LEGAL_DOC_KEYS = ['terms', 'privacy_policy', 'ai_disclosure', 'content_usage_policy'];

describe('legal document seed content', () => {
  const legalDocs = MANAGED_PAGE_DEFINITIONS.filter((page) => LEGAL_DOC_KEYS.includes(page.pageKey));

  it('covers all four Phase 7 documents', () => {
    expect(legalDocs.map((page) => page.pageKey).sort()).toEqual([...LEGAL_DOC_KEYS].sort());
  });

  it.each(legalDocs.map((page) => [page.pageKey, page] as const))(
    '%s has no leftover bracket placeholders',
    (_key, page) => {
      expect(page.content).not.toMatch(/\[[A-Z][A-Z0-9 _/-]*\]/);
    }
  );

  it.each(legalDocs.map((page) => [page.pageKey, page] as const))('%s renders without throwing', (_key, page) => {
    expect(() => extractManagedPageHeadingsFromContent(page.content)).not.toThrow();
    const headings = extractManagedPageHeadingsFromContent(page.content);
    expect(headings.length).toBeGreaterThan(3);

    const nodes = renderManagedPageBlocksFromContent(page.content);
    const html = renderToStaticMarkup(createElement('div', null, ...nodes));
    expect(html.length).toBeGreaterThan(500);
    // The renderer emits text nodes only -- confirm no raw markdown syntax leaks through unparsed.
    expect(html).not.toContain('##');
  });
});

describe('refund / cancellation policy seed (Payments Phase 7)', () => {
  const refundPolicy = MANAGED_PAGE_DEFINITIONS.find((page) => page.pageKey === 'refund_policy')!;

  it('is no longer a draft', () => {
    expect(refundPolicy.content).not.toContain('Starter Draft');
    expect(refundPolicy.metadata).not.toMatchObject({ policyPlaceholder: true });
  });

  it('states the rules the refund code enforces', () => {
    expect(refundPolicy.content).toContain('7 days');
    expect(refundPolicy.content).toContain('20%');
    expect(refundPolicy.content).toContain('two refunds per account');
  });

  it('covers customers outside India (Payments Phase 8): currency, LUT, refunds and IST dates', () => {
    expect(refundPolicy.content).toContain('## Customers outside India');
    expect(refundPolicy.content).toContain('Letter of Undertaking (LUT)');
    expect(refundPolicy.content).toContain('India Standard Time (IST)');
  });

  it('renders without leftover placeholders or raw markdown', () => {
    expect(refundPolicy.content).not.toMatch(/\[[A-Z][A-Z0-9 _/-]*\]/);
    const html = renderToStaticMarkup(createElement('div', null, ...renderManagedPageBlocksFromContent(refundPolicy.content)));
    expect(html).not.toContain('##');
  });
});
