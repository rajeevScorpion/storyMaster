import type { ReactNode } from 'react';

import { getSupportEmail } from '@/lib/managed-pages/service';
import type { ManagedPageType } from '@/lib/managed-pages/types';
import {
  extractManagedPageHeadingsFromContent,
  formatManagedPageDate,
  renderManagedPageBlocksFromContent,
  slugifyManagedPageHeading,
  type ManagedPageHeading,
} from '@/lib/managed-pages/render.shared';

export { formatManagedPageDate, slugifyManagedPageHeading };
export type { ManagedPageHeading };

export function resolveManagedPageTokens(content: string): string {
  const supportEmail = getSupportEmail() || '[Support email is not configured]';
  return content.replaceAll('{{SUPPORT_EMAIL}}', supportEmail);
}

export function extractManagedPageHeadings(content: string): ManagedPageHeading[] {
  return extractManagedPageHeadingsFromContent(resolveManagedPageTokens(content));
}

export function renderManagedPageBlocks(content: string): ReactNode[] {
  return renderManagedPageBlocksFromContent(resolveManagedPageTokens(content));
}

export function ManagedPageContent({
  content,
  pageType,
}: {
  content: string;
  pageType: ManagedPageType;
}) {
  const typeClass =
    pageType === 'faq'
      ? 'space-y-4'
      : pageType === 'blog_index'
        ? 'space-y-5'
        : 'space-y-5';

  return <div className={typeClass}>{renderManagedPageBlocks(content)}</div>;
}
