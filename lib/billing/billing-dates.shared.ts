/**
 * Every date a customer sees about billing -- renewal, refill, cancellation, payment, invoice -- is shown
 * in India Standard Time. Razorpay closes each cycle at IST midnight, and invoices and billing emails are
 * already dated in IST, so a single zone is the only rule under which the billing page, the checkout
 * sheet, the emails and the documents can never disagree by a day. IST has no daylight saving, so a
 * fixed offset is exact and needs no Intl time-zone data.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The same instant, shifted so its UTC fields read as the IST wall clock. */
function istFields(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** "25 Oct 2026" -- the documents' and emails' style. */
export function formatBillingDateShort(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const ist = istFields(value);
  if (!ist) return null;
  return `${ist.getUTCDate()} ${SHORT_MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

/** "25 Oct" -- where the year is obvious, like the account menu's refill line. */
export function formatBillingDayMonth(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const ist = istFields(value);
  if (!ist) return null;
  return `${ist.getUTCDate()} ${SHORT_MONTHS[ist.getUTCMonth()]}`;
}

/**
 * The span a page of history covers, oldest first: "26 Sep 2026" for one day, "25 Sep – 26 Sep 2026"
 * within a year, "30 Dec 2025 – 2 Jan 2026" across one. Takes the two ends in either order.
 */
export function formatBillingDateRange(
  first: string | Date | null | undefined,
  second: string | Date | null | undefined
): string | null {
  const a = first ? istFields(first) : null;
  const b = second ? istFields(second) : null;
  if (!a || !b) return formatBillingDateShort(first ?? second);
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  const day = (d: Date) => `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;

  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    return `${day(from)} ${from.getUTCFullYear()} – ${day(to)} ${to.getUTCFullYear()}`;
  }
  if (day(from) === day(to)) return `${day(to)} ${to.getUTCFullYear()}`;
  return `${day(from)} – ${day(to)} ${to.getUTCFullYear()}`;
}

/** "October 25, 2026" -- the account pages' style. */
export function formatBillingDateLong(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const ist = istFields(value);
  if (!ist) return null;
  return `${LONG_MONTHS[ist.getUTCMonth()]} ${ist.getUTCDate()}, ${ist.getUTCFullYear()}`;
}

/** The IST day of the month, for "Renews monthly on the 25th". */
export function billingDayOfMonth(value: string | Date): number | null {
  const ist = istFields(value);
  return ist ? ist.getUTCDate() : null;
}

/**
 * One month or one year later on the IST calendar, clamped to the target month's last day (31 Jan +
 * 1 month is 28/29 Feb, never 3 Mar). Doing the arithmetic on IST fields keeps the day-of-month the
 * one Razorpay will actually bill on.
 */
export function addBillingMonths(value: Date, months: number): Date {
  const ist = new Date(value.getTime() + IST_OFFSET_MS);
  const targetMonthIndex = ist.getUTCMonth() + months;
  const targetYear = ist.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(ist.getUTCDate(), daysInTargetMonth);
  const shifted = Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    ist.getUTCHours(),
    ist.getUTCMinutes(),
    ist.getUTCSeconds(),
    ist.getUTCMilliseconds()
  );
  return new Date(shifted - IST_OFFSET_MS);
}
