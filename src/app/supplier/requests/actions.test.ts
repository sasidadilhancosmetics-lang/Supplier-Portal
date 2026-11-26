import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redirect = vi.fn((url: string) => {
  const error = new Error(`NEXT_REDIRECT:${url}`);
  (error as { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
  throw error;
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/requests/availability", () => ({
  saveAvailabilityDraft: vi.fn(),
  submitAvailability: vi.fn(),
}));

import {
  saveAvailabilityDraft,
  submitAvailability,
} from "@/lib/requests/availability";
import { RequestDomainError } from "@/lib/requests/errors";

import {
  saveAvailabilityDraftAction,
  submitAvailabilityAction,
} from "./actions";

function form(lines: {
  supplierRequestId: string;
  requestItemId: string;
  quantity?: string;
  date?: string;
  notAvailable?: boolean;
}) {
  const fd = new FormData();
  fd.set("supplierRequestId", lines.supplierRequestId);
  fd.append("requestItemId", lines.requestItemId);
  fd.set(`quantityDeclared:${lines.requestItemId}`, lines.quantity ?? "");
  fd.set(`availableDate:${lines.requestItemId}`, lines.date ?? "");
  fd.set(
    `notAvailable:${lines.requestItemId}`,
    lines.notAvailable ? "true" : "false",
  );
  return fd;
}

describe("supplier availability actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to the requests list after successful submit", async () => {
    vi.mocked(submitAvailability).mockResolvedValue({
      id: "req_1",
      submittedCount: 1,
    });

    await expect(
      submitAvailabilityAction(
        undefined,
        form({
          supplierRequestId: "req_1",
          requestItemId: "item_1",
          quantity: "10",
          date: "2026-07-15",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirect).toHaveBeenCalledWith(
      "/supplier/requests?flash=availability-submitted",
    );
  });

  it("stays on the form when submit validation fails", async () => {
    vi.mocked(submitAvailability).mockRejectedValue(
      new RequestDomainError("VALIDATION", "Enter a delivery date.", {
        "item_1:date": "Enter a delivery date for this quantity.",
      }),
    );

    const result = await submitAvailabilityAction(
      undefined,
      form({
        supplierRequestId: "req_1",
        requestItemId: "item_1",
        quantity: "10",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Enter a delivery date.",
      fieldErrors: {
        "item_1:date": "Enter a delivery date for this quantity.",
      },
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("keeps Save draft on the current page after success", async () => {
    vi.mocked(saveAvailabilityDraft).mockResolvedValue({ id: "req_1" });

    const result = await saveAvailabilityDraftAction(
      undefined,
      form({
        supplierRequestId: "req_1",
        requestItemId: "item_1",
        quantity: "5",
        date: "2026-07-15",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(redirect).not.toHaveBeenCalled();
  });
});
