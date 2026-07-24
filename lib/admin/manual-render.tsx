import Link from 'next/link';
import { createElement, type ReactNode } from 'react';

// Small, dependency-free renderer for the admin manual markdown. Deliberately
// NOT the public managed-pages renderer (that serves user-facing pages). Handles
// the subset the manual uses: #–#### headings, `-` lists, paragraphs, fenced
// code blocks, pipe tables, and inline `code` / **bold** / [text](href).

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Code first so ** or [] inside inline code is not re-parsed.
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
        <code key={key} className="rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-emerald-200">
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
        <strong key={key} className="font-semibold text-neutral-100">
          {token.slice(2, -2)}
        </strong>
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function splitRow(row: string): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-2 mb-4 text-2xl font-serif text-neutral-100',
  2: 'mt-8 mb-3 border-b border-white/10 pb-2 text-xl font-serif text-neutral-100',
  3: 'mt-6 mb-2 text-lg font-medium text-neutral-100',
  4: 'mt-4 mb-2 text-sm font-semibold uppercase tracking-wider text-emerald-300/80',
};

function isPlainLine(line: string): boolean {
  return (
    line.trim() !== '' &&
    !/^(#{1,4})\s/.test(line) &&
    !/^\s*-\s+/.test(line) &&
    !line.trim().startsWith('```') &&
    !line.includes('|')
  );
}

export function renderAdminManual(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-neutral-900/80 p-4 text-xs text-neutral-200"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(
        createElement(
          `h${Math.min(level + 1, 6)}`,
          { key: key++, className: HEADING_CLASS[level] },
          renderInline(headingMatch[2], `h-${key}`)
        )
      );
      i++;
      continue;
    }

    // Pipe table (header row followed by a |---| separator)
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      lines[i + 1].includes('-') &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])
    ) {
      const header = splitRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th
                    key={ci}
                    className="border-b border-white/15 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400"
                  >
                    {renderInline(cell, `th-${key}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci} className="border-b border-white/10 px-3 py-2 align-top text-neutral-300">
                      {renderInline(row[ci] ?? '', `td-${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Unordered list
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-300">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `li-${key}-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Paragraph (always consumes at least the current line to guarantee progress)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && isPlainLine(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-3 text-sm leading-relaxed text-neutral-300">
        {renderInline(paraLines.join(' '), `p-${key}`)}
      </p>
    );
  }

  return <div>{blocks}</div>;
}
