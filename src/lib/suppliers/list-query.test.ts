import { describe, expect, it } from "vitest";

import { supplierListQuerySchema } from "./schema";

describe("supplierListQuerySchema", () => {
  it("accepts q=test", () => {
    const result = supplierListQuerySchema.safeParse({ q: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("test");
      expect(result.data.status).toBeUndefined();
      expect(result.data.page).toBe(1);
    }
  });

  it("treats empty status as no filter (q=test&status=)", () => {
    const result = supplierListQuerySchema.safeParse({
      q: "test",
      status: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("test");
      expect(result.data.status).toBeUndefined();
      expect(result.data.page).toBe(1);
    }
  });

  it("accepts combined search and status", () => {
    const result = supplierListQuerySchema.safeParse({
      q: "test",
      status: "ACTIVE",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("test");
      expect(result.data.status).toBe("ACTIVE");
    }
  });

  it("accepts status-only filter", () => {
    const result = supplierListQuerySchema.safeParse({ status: "ACTIVE" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("");
      expect(result.data.status).toBe("ACTIVE");
    }
  });

  it("rejects invalid status values", () => {
    const result = supplierListQuerySchema.safeParse({
      q: "test",
      status: "ACTIVE_NOW",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty search", () => {
    const result = supplierListQuerySchema.safeParse({ q: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("");
      expect(result.data.page).toBe(1);
    }
  });

  it("accepts omitted filters as defaults", () => {
    const result = supplierListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("");
      expect(result.data.status).toBeUndefined();
      expect(result.data.page).toBe(1);
    }
  });

  it("parses page changes", () => {
    const result = supplierListQuerySchema.safeParse({
      q: "test",
      page: "3",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
    }
  });

  it("resets blank page to 1", () => {
    const result = supplierListQuerySchema.safeParse({
      q: "test",
      status: "",
      page: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
    }
  });

  it("uses the first value when Next.js provides string arrays", () => {
    const result = supplierListQuerySchema.safeParse({
      q: ["test"],
      status: [""],
      page: ["2"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("test");
      expect(result.data.status).toBeUndefined();
      expect(result.data.page).toBe(2);
    }
  });
});
