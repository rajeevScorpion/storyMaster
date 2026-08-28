import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Pure block/inline parser for managed-page body text. No `server-only`
 * import here on purpose — everything below operates on already-resolved
 * content (see render.tsx's resolveManagedPageTokens) and is unit-testable
 * without a server context, per this repo's `*.shared.ts` convention.
 *
 * Emits React elements/text nodes only. No `dangerouslySetInnerHTML`, no
 * markdown dependency, no sanitizer needed — that XSS-safe-by-construction
 * property is deliberate and must survive any future change here.
 */

export function formatManagedPageDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function slugifyManagedPageHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export interface ManagedPageHeading {
  id: string;
  title: string;
  level: 2 | 3;
}

/** `##`/`###` headings only — the table of contents for a legal document is section-level, not every h1/h4. */
export function extractManagedPageHeadingsFromContent(content: string): ManagedPageHeading[] {
  const headings: ManagedPageHeading[] = [];
  const seen = new Map<string, number>();

  content.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    const match = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!match) return;

    const level = match[1].length as 2 | 3;
    const title = match[2].trim();
    const baseId = slugifyManagedPageHeading(title) || 'section';
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}-${count}`;

    headings.push({ id, title, level });
  });

  return headings;
}

// Inline formatting: `code`, **bold**, [text](href). Code is matched first so
// ** or [] inside inline code is never re-parsed. Internal links (starting
// with `/`) render as next/link; everything else opens in a new tab.
export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em] text-emerald-200">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        const cls = 'text-emerald-300 underline underline-offset-2 hover:text-emerald-200';
        nodes.push(
          href.startsWith('/') ? (
            <Link key={key} href={href} className={cls}>
              {label}
            </Link>
          ) : (
            <a key={key} href={href} className={cls} target="_blank" rel="noreferrer">
              {label}
            </a>
          )
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function splitTableRow(row: string): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

function renderParagraph(lines: string[], key: string): ReactNode {
  return (
    <p key={key} className="max-w-[68ch] text-[17px] leading-8 text-neutral-300">
      {renderInline(lines.join(' '), key)}
    </p>
  );
}

function renderUnorderedList(items: string[], key: string): ReactNode {
  return (
    <ul key={key} className="max-w-[68ch] list-disc space-y-2 pl-5 text-[17px] leading-7 text-neutral-300 marker:text-emerald-400/60">
      {items.map((item, index) => (
        <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
      ))}
    </ul>
  );
}

function renderOrderedList(items: string[], key: string): ReactNode {
  return (
    <ol key={key} className="max-w-[68ch] list-decimal space-y-2 pl-5 text-[17px] leading-7 text-neutral-300 marker:text-emerald-400/60">
      {items.map((item, index) => (
        <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
      ))}
    </ol>
  );
}

function renderBlockquote(lines: string[], key: string): ReactNode {
  return (
    <blockquote
      key={key}
      className="max-w-[68ch] rounded-r-xl border-l-2 border-emerald-400/40 bg-emerald-500/[0.04] py-3 pl-5 text-[17px] leading-7 text-neutral-300"
    >
      {lines.map((line, index) => (
        <p key={`${key}-${index}`} className={index > 0 ? 'mt-2' : undefined}>
          {renderInline(line, `${key}-${index}`)}
        </p>
      ))}
    </blockquote>
  );
}

function renderTable(header: string[], rows: string[][], key: string): ReactNode {
  return (
    <div key={key} className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr>
            {header.map((cell, ci) => (
              <th
                key={ci}
                className="border-b border-white/15 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400"
              >
                {renderInline(cell, `${key}-th-${ci}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {header.map((_, ci) => (
                <td key={ci} className="border-b border-white/10 px-3 py-2 align-top text-neutral-300">
                  {renderInline(row[ci] ?? '', `${key}-td-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function renderManagedPageBlocksFromContent(content: string): ReactNode[] {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  const headingSlugCounts = new Map<string, number>();
  let i = 0;

  const nextHeadingId = (title: string): string => {
    const baseId = slugifyManagedPageHeading(title) || 'section';
    const count = headingSlugCounts.get(baseId) ?? 0;
    headingSlugCounts.set(baseId, count + 1);
    return count === 0 ? baseId : `${baseId}-${count}`;
  };

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      blocks.push(<hr key={`hr-${blocks.length}`} className="my-2 max-w-[68ch] border-white/10" />);
      i++;
      continue;
    }

    const h4 = /^####\s+(.*)$/.exec(line);
    if (h4) {
      blocks.push(
        <h4 key={`h4-${blocks.length}`} className="pt-6 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300/80">
          {renderInline(h4[1], `h4-${blocks.length}`)}
        </h4>
      );
      i++;
      continue;
    }

    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="mt-8 text-lg font-semibold text-neutral-100">
          {renderInline(h3[1], `h3-${blocks.length}`)}
        </h3>
      );
      i++;
      continue;
    }

    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      const title = h2[1];
      blocks.push(
        <h2
          key={`h2-${blocks.length}`}
          id={nextHeadingId(title)}
          className="mt-14 scroll-mt-24 border-t border-white/10 pt-8 text-2xl font-semibold text-white"
        >
          {renderInline(title, `h2-${blocks.length}`)}
        </h2>
      );
      i++;
      continue;
    }

    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-3xl font-semibold tracking-normal text-white">
          {renderInline(h1[1], `h1-${blocks.length}`)}
        </h1>
      );
      i++;
      continue;
    }

    // Pipe table (header row followed by a |---| separator).
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1].trim())) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(renderTable(header, rows, `table-${blocks.length}`));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(renderBlockquote(quoteLines, `quote-${blocks.length}`));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(renderOrderedList(items, `ol-${blocks.length}`));
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s+/, ''));
        i++;
      }
      blocks.push(renderUnorderedList(items, `ul-${blocks.length}`));
      continue;
    }

    // Paragraph — consumes contiguous plain lines.
    const paragraphLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^-{3,}$/.test(lines[i].trim()) &&
      !/^-\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !lines[i].includes('|')
    ) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    blocks.push(renderParagraph(paragraphLines, `paragraph-${blocks.length}`));
  }

  return blocks;
}
