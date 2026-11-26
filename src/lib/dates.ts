/**
 * Calendar-date helpers for fields that mean a day (e.g. delivery availableDate),
 * not an instant. Stored as DateTime at UTC midnight of that calendar day.
 *
 * Event timestamps (reservedAt, reserveExpiresAt, sentAt, …) should use
 * {@link formatDateTime} instead — those convert the stored UTC instant to
 * Asia/Colombo for display (database remains UTC).
 */

/** Portal display timezone for event timestamps (Sri Lanka). */
export const PORTAL_DISPLAY_TIMEZONE = "Asia/Colombo";

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

/**
 * Display an event instant in Asia/Colombo.
 * Does not mutate or re-store the UTC value — formatting only.
 * Example: `Nov 16, 2026, 10:30 AM`
 */
export function formatDateTime(
  value: Date | string | null | undefined,
  empty = "—",
): string {
  if (value == null || value === "") return empty;
  const d = asDate(value);
  if (!d) return empty;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Shorter event instant for supplier-facing copy.
 * Omits the year when it matches the current year in Asia/Colombo.
 * Example: `Nov 23, 10:06 AM` (same year) or `Nov 23, 2027, 10:06 AM`.
 */
export function formatShortDateTime(
  value: Date | string | null | undefined,
  empty = "—",
  now: Date = new Date(),
): string {
  if (value == null || value === "") return empty;
  const d = asDate(value);
  if (!d) return empty;

  const yearFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_DISPLAY_TIMEZONE,
    year: "numeric",
  });
  const includeYear = yearFmt.format(d) !== yearFmt.format(now);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_DISPLAY_TIMEZONE,
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Today's calendar date (`YYYY-MM-DD`) in the portal business timezone.
 * Used for actual-delivery date validation (not expected/planned dates).
 */
export function todayCalendarDateInPortalTz(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Could not resolve portal calendar date.");
  }
  return `${year}-${month}-${day}`;
}

/**
 * True when `YYYY-MM-DD` is after today in Asia/Colombo.
 * Invalid / empty strings are not treated as future (caller validates format).
 */
export function isFuturePortalCalendarDate(
  calendarDate: string,
  now: Date = new Date(),
): boolean {
  const trimmed = calendarDate.trim();
  if (!CALENDAR_DATE_RE.test(trimmed)) return false;
  return trimmed > todayCalendarDateInPortalTz(now);
}

/**
 * True when `YYYY-MM-DD` is before today in Asia/Colombo.
 * Invalid / empty strings are not treated as past.
 */
export function isPastPortalCalendarDate(
  calendarDate: string,
  now: Date = new Date(),
): boolean {
  const trimmed = calendarDate.trim();
  if (!CALENDAR_DATE_RE.test(trimmed)) return false;
  return trimmed < todayCalendarDateInPortalTz(now);
}
