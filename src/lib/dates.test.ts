import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatDateTime,
  parseCalendarDateInput,
  toCalendarDateInputValue,
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

  it("keeps event timestamps as date+time display", () => {
    const instant = new Date("2026-11-14T00:00:00.000Z");
    const formatted = formatDateTime(instant);
    expect(formatted).not.toBe("—");
    // Must include a time component (locale-dependent separator).
    expect(/[0-9].*[AP]M|[0-9]{1,2}:[0-9]{2}/i.test(formatted)).toBe(true);
  });
});
