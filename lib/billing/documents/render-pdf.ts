import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { buildDocumentView, type DocumentView } from '@/lib/billing/documents/document-view.shared';
import type { BillingDocumentRow, OriginalDocumentReference } from '@/lib/billing/documents/types.shared';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B3): draws one A4 page from
 * buildDocumentView's pure output. Every value that could vary between two renders of the SAME row --
 * the current wall clock, a random internal PDF object name, a random file identifier -- is pinned
 * explicitly, so re-rendering an issued document (storage.ts's cache-miss path, or a future re-render
 * after a lost R2 object) reproduces the exact bytes already handed to a customer. See render-pdf.test.ts.
 *
 * Determinism traps found while writing this (kept here since they're invisible in the diff otherwise):
 * - `PDFDocument.create()` stamps CreationDate/ModDate/Producer from `new Date()` in its constructor;
 *   `updateMetadata: false` skips that so only the explicit setCreationDate/setModificationDate/
 *   setProducer calls below ever touch the info dict, and nothing else (no Title/Author/Keywords).
 * - `embedFont(bytes, { subset: true })` without a `customName` names the embedded font resource with
 *   `context.addRandomSuffix(...)` -- a fresh random suffix every render. Both fonts are embedded with
 *   a fixed `customName` to remove that.
 */

const FONTS_DIR = path.join(process.cwd(), 'lib/billing/documents/fonts');
const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

let cachedRegularBytes: Buffer | null = null;
let cachedBoldBytes: Buffer | null = null;

function readFontBytes(filename: string): Buffer {
  return fs.readFileSync(path.join(FONTS_DIR, filename));
}

function regularFontBytes(): Buffer {
  if (!cachedRegularBytes) cachedRegularBytes = readFontBytes('NotoSans-Regular.ttf');
  return cachedRegularBytes;
}

function boldFontBytes(): Buffer {
  if (!cachedBoldBytes) cachedBoldBytes = readFontBytes('NotoSans-Bold.ttf');
  return cachedBoldBytes;
}

const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const TEST_RED = rgb(0.72, 0.11, 0.11);

interface Cursor {
  page: PDFPage;
  y: number;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function money(view: DocumentView, minor: number): string {
  return formatCurrencyMinor(view.currencyCode, minor);
}

function text(
  cursor: Cursor,
  fonts: Fonts,
  value: string,
  opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; dy?: number } = {}
): void {
  const size = opts.size ?? 10;
  cursor.page.drawText(value, {
    x: opts.x ?? MARGIN,
    y: cursor.y,
    size,
    font: opts.bold ? fonts.bold : fonts.regular,
    color: opts.color ?? INK,
  });
  cursor.y -= opts.dy ?? size + 4;
}

function rightAlignedText(
  cursor: Cursor,
  fonts: Fonts,
  value: string,
  rightEdge: number,
  opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}
): void {
  const size = opts.size ?? 10;
  const font = opts.bold ? fonts.bold : fonts.regular;
  const width = font.widthOfTextAtSize(value, size);
  cursor.page.drawText(value, {
    x: rightEdge - width,
    y: cursor.y,
    size,
    font,
    color: opts.color ?? INK,
  });
}

function hr(cursor: Cursor, rightEdge: number): void {
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: rightEdge, y: cursor.y },
    thickness: 0.75,
    color: RULE,
  });
  cursor.y -= 12;
}

/**
 * Renders one `billing_documents` row to PDF bytes. `originalDoc` is the Rule 53 reference for a
 * credit note (see buildDocumentView) -- the caller (storage.ts / the download route) loads it.
 */
export async function renderDocumentPdf(
  row: BillingDocumentRow,
  originalDoc?: OriginalDocumentReference | null
): Promise<Uint8Array> {
  const view = buildDocumentView(row, originalDoc ?? null);

  const pdfDoc = await PDFDocument.create({ updateMetadata: false });
  pdfDoc.registerFontkit(fontkit);

  const regular = await pdfDoc.embedFont(regularFontBytes(), { subset: true, customName: 'KissagoDocSans' });
  const bold = await pdfDoc.embedFont(boldFontBytes(), { subset: true, customName: 'KissagoDocSansBold' });
  const fonts: Fonts = { regular, bold };

  // The stored/emailed PDF must reproduce byte-for-byte on a later re-render (storage.ts's cache-miss
  // path), so every date on the page is pinned to the row's own issued_at -- never the real clock.
  const issuedAt = new Date(row.issued_at);
  pdfDoc.setCreationDate(issuedAt);
  pdfDoc.setModificationDate(issuedAt);
  pdfDoc.setProducer('Kissago');

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const rightEdge = PAGE_WIDTH - MARGIN;
  const cursor: Cursor = { page, y: PAGE_HEIGHT - MARGIN };

  if (view.testBanner) {
    page.drawRectangle({
      x: MARGIN,
      y: cursor.y - 18,
      width: rightEdge - MARGIN,
      height: 22,
      color: rgb(0.98, 0.92, 0.92),
      borderColor: TEST_RED,
      borderWidth: 1,
    });
    text(cursor, fonts, view.testBanner, { bold: true, color: TEST_RED, size: 11, dy: 30 });
  }

  text(cursor, fonts, view.title.toUpperCase(), { bold: true, size: 18, dy: 22 });
  rightAlignedText(
    { page, y: cursor.y + 22 },
    fonts,
    view.copyLabel,
    rightEdge,
    { size: 9, color: MUTED }
  );

  // Seller / buyer, side by side.
  const columnWidth = (rightEdge - MARGIN - 24) / 2;
  const sellerX = MARGIN;
  const buyerX = MARGIN + columnWidth + 24;
  const blockTop = cursor.y;

  text({ page, y: blockTop }, fonts, 'From', { x: sellerX, size: 9, color: MUTED, dy: 14 });
  let sellerY = blockTop - 14;
  const sellerLines = [
    view.seller.legalName ?? '',
    `GSTIN ${view.seller.gstin ?? '—'}`,
    ...view.seller.addressLines,
    [view.seller.city, view.seller.state, view.seller.postalCode].filter(Boolean).join(', '),
    view.seller.country ?? '',
  ].filter((line) => line.trim().length > 0);
  for (const [i, line] of sellerLines.entries()) {
    text({ page, y: sellerY }, fonts, line, { x: sellerX, size: 10, bold: i === 0, dy: 13 });
    sellerY -= 13;
  }

  let buyerY = blockTop;
  text({ page, y: buyerY }, fonts, 'Bill to', { x: buyerX, size: 9, color: MUTED, dy: 14 });
  buyerY -= 14;
  const buyerLines: string[] = [];
  if (view.buyerIdentityShown && view.buyer.legalName) buyerLines.push(view.buyer.legalName);
  if (view.buyer.gstin) buyerLines.push(`GSTIN ${view.buyer.gstin}`);
  if (view.buyerIdentityShown) {
    buyerLines.push(...view.buyer.addressLines);
    const cityLine = [view.buyer.city, view.buyer.postalCode].filter(Boolean).join(' ');
    if (cityLine) buyerLines.push(cityLine);
  }
  if (buyerLines.length === 0) buyerLines.push('Unregistered recipient');
  for (const [i, line] of buyerLines.entries()) {
    text({ page, y: buyerY }, fonts, line, { x: buyerX, size: 10, bold: i === 0, dy: 13 });
    buyerY -= 13;
  }

  cursor.y = Math.min(sellerY, buyerY) - 8;
  hr(cursor, rightEdge);

  // Document meta.
  const metaRows: Array<[string, string]> = [
    [`${view.title} No.`, view.documentNumber],
    ['Date', view.documentDate],
    ['Financial year', view.financialYear],
    ['Place of supply', view.placeOfSupply],
    ['Reverse charge', view.reverseCharge],
  ];
  if (view.originalReference) {
    metaRows.push(['Original invoice no.', view.originalReference.documentNumber]);
    metaRows.push(['Original invoice date', view.originalReference.issuedAt]);
  }
  if (view.reference) {
    metaRows.push([view.reference.kind === 'refund' ? 'Refund ref.' : 'Payment ref.', view.reference.id]);
  }
  for (const [label, value] of metaRows) {
    text(cursor, fonts, label, { size: 9.5, color: MUTED, dy: 0 });
    rightAlignedText(cursor, fonts, value, rightEdge, { size: 9.5 });
    cursor.y -= 14;
  }
  cursor.y -= 6;
  hr(cursor, rightEdge);

  // Line items table.
  const colDesc = MARGIN;
  const colSac = rightEdge - 220;
  const colQty = rightEdge - 150;
  const colValue = rightEdge;
  text(cursor, fonts, 'Description', { x: colDesc, size: 9, color: MUTED, dy: 0 });
  text(cursor, fonts, 'SAC', { x: colSac, size: 9, color: MUTED, dy: 0 });
  text(cursor, fonts, 'Qty', { x: colQty, size: 9, color: MUTED, dy: 0 });
  rightAlignedText(cursor, fonts, 'Taxable value', colValue, { size: 9, color: MUTED });
  cursor.y -= 16;
  hr(cursor, rightEdge);

  for (const item of view.lineItems) {
    text(cursor, fonts, item.description, { x: colDesc, size: 10, dy: 0 });
    text(cursor, fonts, item.sac ?? '—', { x: colSac, size: 10, dy: 0 });
    text(cursor, fonts, `${item.quantity} ${item.unit}`, { x: colQty, size: 10, dy: 0 });
    rightAlignedText(cursor, fonts, money(view, item.taxableValueMinor), colValue, { size: 10 });
    cursor.y -= 18;
  }
  hr(cursor, rightEdge);

  // Totals block, right-aligned.
  const totalsRows: Array<[string, string]> = [
    ['Taxable value', money(view, view.netMinor)],
    ...view.taxRows.map((row): [string, string] => [`${row.label} @ ${row.ratePercent}%`, money(view, row.amountMinor)]),
    ['Total', money(view, view.grossMinor)],
  ];
  for (const [label, value] of totalsRows) {
    const isTotal = label === 'Total';
    text(cursor, fonts, label, { x: rightEdge - 220, size: isTotal ? 11 : 10, bold: isTotal, dy: 0 });
    rightAlignedText(cursor, fonts, value, rightEdge, { size: isTotal ? 11 : 10, bold: isTotal });
    cursor.y -= isTotal ? 18 : 15;
  }
  cursor.y -= 6;

  text(cursor, fonts, `Amount in words: ${view.amountInWords}`, { size: 9.5, color: MUTED, dy: 20 });

  cursor.y = Math.max(cursor.y, MARGIN + 40);
  hr(cursor, rightEdge);
  text(cursor, fonts, view.footerNote, { size: 8.5, color: MUTED, dy: 12 });

  return pdfDoc.save();
}
