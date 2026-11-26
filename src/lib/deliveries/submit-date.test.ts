import { describe, expect, it } from "vitest";

import {
  isFuturePortalCalendarDate,
  todayCalendarDateInPortalTz,
} from "@/lib/dates";

describe("actual delivery date (Asia/Colombo)", () => {
  it("rejects future calendar dates relative to portal today", () => {
    // Fixed instant: 2026-11-16 18:30 UTC = 2026-11-17 00:00 Asia/Colombo
    const now = new Date("2026-11-16T18:30:00.000Z");
    expect(todayCalendarDateInPortalTz(now)).toBe("2026-11-17");
    expect(isFuturePortalCalendarDate("2026-11-18", now)).toBe(true);
    expect(isFuturePortalCalendarDate("2026-11-17", now)).toBe(false);
    expect(isFuturePortalCalendarDate("2026-11-16", now)).toBe(false);
  });

  it("allows earlier valid delivery dates", () => {
    const now = new Date("2026-11-17T04:00:00.000Z"); // still 17th in Colombo
    expect(isFuturePortalCalendarDate("2026-11-10", now)).toBe(false);
    expect(isFuturePortalCalendarDate("2020-01-01", now)).toBe(false);
  });
});
