import type { ReactNode } from 'react';

import { getSupportEmail } from '@/lib/managed-pages/service';
import type { ManagedPageType } from '@/lib/managed-pages/types';

export function resolveManagedPageTokens(content: string): string {
  const supportEmail = getSupportEmail() || '[Support email is not configured]';
  return content.replaceAll('{{SUPPORT_EMAIL}}', supportEmail);
}

export function formatManagedPageDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function renderParagraph(lines: string[], key: string): ReactNode {
  return (
    <p key={key} className="text-base leading-8 text-neutral-300">
      {lines.map((line, index) => (
        <span key={`${key}-${index}`}>
          {index > 0 ? ' ' : null}
          {line}
        </span>
      ))}
    </p>
  );
}

function renderList(items: string[], key: string): ReactNode {
  return (
    <ul key={key} className="list-disc space-y-2 pl-5 text-base leading-7 text-neutral-300">
      {items.map((item, index) => (
        <li key={`${key}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

export function renderManagedPageBlocks(content: string): ReactNode[] {
  const lines = resolveManagedPageTokens(content).split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(renderParagraph(paragraph, `paragraph-${blocks.length}`));
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(renderList(list, `list-${blocks.length}`));
    list = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="pt-3 text-xl font-semibold text-white">
          {line.slice(4)}
        </h3>
      );
      return;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="pt-6 text-2xl font-semibold tracking-normal text-white">
          {line.slice(3)}
        </h2>
      );
      return;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-3xl font-semibold tracking-normal text-white">
          {line.slice(2)}
        </h1>
      );
      return;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      list.push(line.slice(2));
      return;
    }

    flushList();
    paragraph.push(line);
  });

  flushParagraph();
  flushList();

  return blocks;
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
