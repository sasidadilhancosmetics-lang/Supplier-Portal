/**
 * Calendar-date helpers for fields that mean a day (e.g. delivery availableDate),
 * not an instant. Stored as DateTime at UTC midnight of that calendar day.
 *
 * Event timestamps (reservedAt, reserveExpiresAt, sentAt, …) should use
 * {@link formatDateTime} instead — those keep local timezone display of the UTC instant.
 */

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function asDate(value: Date | string): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Parse `YYYY-MM-DD` from a date input into UTC midnight of that calendar day. */
export function parseCalendarDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = CALENDAR_DATE_RE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** Value for `<input type="date">` from a stored calendar DateTime (UTC day). */
export function toCalendarDateInputValue(
  value: Date | string | null | undefined,
): string {
  if (value == null || value === "") return "";
  const d = asDate(value);
  if (!d) return "";
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Display a calendar date the same for every viewer (no timezone day-shift).
 * Uses UTC calendar components of the stored DateTime.
 */
export function formatCalendarDate(
  value: Date | string | null | undefined,
  empty = "—",
): string {
  if (value == null || value === "") return empty;
  const d = asDate(value);
  if (!d) return empty;
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Display an event instant (local timezone of the viewer). */
export function formatDateTime(
  value: Date | string | null | undefined,
  empty = "—",
): string {
  if (value == null || value === "") return empty;
  const d = asDate(value);
  if (!d) return empty;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
