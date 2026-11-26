import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatDateTime,
  formatShortDateTime,
  isFuturePortalCalendarDate,
  parseCalendarDateInput,
  toCalendarDateInputValue,
  todayCalendarDateInPortalTz,
} from "./dates";

describe("calendar date helpers", () => {
  it("parses YYYY-MM-DD as UTC midnight of that day", () => {
    const d = parseCalendarDateInput("2026-11-14");
    expect(d?.toISOString()).toBe("2026-11-14T00:00:00.000Z");
  });

  it("rejects invalid calendar dates", () => {
    expect(parseCalendarDateInput("2026-02-31")).toBeNull();
    expect(parseCalendarDateInput("not-a-date")).toBeNull();
    expect(parseCalendarDateInput("")).toBeNull();
  });

  it("formats the same calendar day regardless of local offset", () => {
    // Stored UTC midnight — local IST would show 5:30 AM if formatted as DateTime.
    const stored = new Date("2026-11-14T00:00:00.000Z");
    expect(formatCalendarDate(stored)).toBe("Nov 14, 2026");
    expect(toCalendarDateInputValue(stored)).toBe("2026-11-14");
  });

  it("round-trips input → store → input/display", () => {
    const stored = parseCalendarDateInput("2026-11-14");
    expect(toCalendarDateInputValue(stored)).toBe("2026-11-14");
    expect(formatCalendarDate(stored)).toBe("Nov 14, 2026");
  });

  it("formats event timestamps in Asia/Colombo without mutating UTC storage", () => {
    // 05:00 UTC → 10:30 AM Sri Lanka
    const instant = new Date("2026-11-16T05:00:00.000Z");
    expect(instant.toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(formatDateTime(instant)).toBe("Nov 16, 2026, 10:30 AM");
  });

  it("formats another UTC morning instant to Colombo afternoon", () => {
    const instant = new Date("2026-11-16T04:57:00.000Z");
    expect(formatDateTime(instant)).toBe("Nov 16, 2026, 10:27 AM");
  });

  it("formats short event timestamps without year in the same calendar year", () => {
    const instant = new Date("2026-11-23T04:36:00.000Z");
    const now = new Date("2026-11-18T05:00:00.000Z");
    expect(formatShortDateTime(instant, "—", now)).toBe("Nov 23, 10:06 AM");
    expect(formatDateTime(instant)).toBe("Nov 23, 2026, 10:06 AM");
  });

  it("keeps the year on short timestamps when it differs", () => {
    const instant = new Date("2027-01-05T04:36:00.000Z");
    const now = new Date("2026-11-18T05:00:00.000Z");
    expect(formatShortDateTime(instant, "—", now)).toBe(
      "Jan 5, 2027, 10:06 AM",
    );
  });

  it("resolves portal calendar today and future checks in Asia/Colombo", () => {
    const beforeMidnightColombo = new Date("2026-11-16T18:29:00.000Z");
    expect(todayCalendarDateInPortalTz(beforeMidnightColombo)).toBe(
      "2026-11-16",
    );
    const afterMidnightColombo = new Date("2026-11-16T18:30:00.000Z");
    expect(todayCalendarDateInPortalTz(afterMidnightColombo)).toBe(
      "2026-11-17",
    );
    expect(
      isFuturePortalCalendarDate("2026-11-17", beforeMidnightColombo),
    ).toBe(true);
    expect(
      isFuturePortalCalendarDate("2026-11-16", beforeMidnightColombo),
    ).toBe(false);
  });
});

