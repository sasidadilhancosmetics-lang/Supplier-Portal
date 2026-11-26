import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/requirements/access", () => ({ requireRequirementReadAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { osfImportLine: { findFirst: vi.fn() }, $queryRaw: vi.fn() } }));

import { AuthorizationError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import { historyQuerySchema, lookupPurchaseHistory } from "@/lib/integrations/cosmo/purchase-history";
import { getOsfPurchaseHistory } from "@/lib/osf-imports/purchase-history";
import { requireRequirementReadAccess } from "@/lib/requirements/access";

const company = "portal-company";
const origin = "https://cosmo.example.invalid";
const input = { instanceId: "erp-one", sku: "SKU-1", itemCode: "SKU-1", from: "2026-01-01", to: "2026-06-01", offset: 0 };
function setup(binding = { origin, approvedOrigin: origin, companyId: "cosmo-company", token: "x".repeat(40) }) {
  vi.stubEnv("PORTAL_COSMO_PURCHASE_HISTORY_JSON", JSON.stringify({ [company]: binding }));
}
function reply(patch: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (inputUrl) => {
    const url = new URL(String(inputUrl));
    return Response.json({
      contractVersion: "cosmo-purchase-history.v1", requestId: url.searchParams.get("requestId"),
      companyId: "cosmo-company", ...input, status: "OK", instanceLabel: "ERP1",
      retrievedAt: "2026-06-01T10:00:00Z", records: [], latest: [], lowest: [], nextOffset: null,
      truncated: false, hasUnusableRows: false, ...patch,
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("Cosmo purchase history client", () => {
  it("treats a cleared ERP company selector as no company choice", () => {
    expect(historyQuerySchema.parse({ instanceId: input.instanceId, from: input.from, to: input.to, erpCompany: "" }).erpCompany).toBeUndefined();
  });

  it("requires a company choice for multi-company ERP history and checks the selected source", async () => {
    setup();
    const options = reply({ instanceId: "erp-two", status: "SELECT_COMPANY", companies: ["Company B", "Company C"] });
    expect(await lookupPurchaseHistory(company, { ...input, instanceId: "erp-two" }, options)).toMatchObject({
      status: "SELECT_COMPANY", companies: ["Company B", "Company C"],
    });
    const selected = { ...input, instanceId: "erp-two", erpCompany: "Company C" };
    const transport = reply({ instanceId: "erp-two", erpCompany: "Company C", companies: ["Company B", "Company C"] });
    expect(await lookupPurchaseHistory(company, selected, transport)).toMatchObject({ status: "OK", erpCompany: "Company C" });
    expect(new URL(String(transport.mock.calls[0][0])).searchParams.get("erpCompany")).toBe("Company C");
    expect(await lookupPurchaseHistory(company, selected, reply({ instanceId: "erp-two", erpCompany: "Company B" }))).toEqual({ status: "UNAVAILABLE" });
    expect(await lookupPurchaseHistory(company, selected, reply({ instanceId: "erp-two", erpCompany: "Company C", records: [{
      erpCompany: "Company B", reference: "INV-1", line: "1", documentType: "Purchase Invoice",
      purchaseOrder: null, purchaseReceipt: null, supplierId: "SUP-1", supplierName: "Supplier One",
      date: "2026-05-10", postingTime: null, quantity: "1", unitPrice: "10",
      priceBasis: "UNVERIFIED", currency: "LKR", uom: "Each", stockUom: "Each",
      conversionFactor: "1", invoiceTaxTotal: null, taxTemplate: null,
      lineDiscountPercent: null, invoiceDiscount: null,
    }] }))).toEqual({ status: "UNAVAILABLE" });
  });

  it("uses the fixed path, sends the destination binding and validates the response", async () => {
    setup();
    const transport = reply();
    expect(await lookupPurchaseHistory(company, input, transport)).toMatchObject({ status: "OK", records: [] });
    const url = new URL(String(transport.mock.calls[0][0]));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/api/integrations/supplier-portal/v1/purchase-history");
    expect(url.searchParams.get("itemCode")).toBe("SKU-1");
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", headers: { "X-Portal-Company-Id": company } });
    expect(await lookupPurchaseHistory(company, input, reply({ companyId: "foreign" }))).toEqual({ status: "UNAVAILABLE" });
    expect(await lookupPurchaseHistory(company, input, reply({ instanceId: "erp-two" }))).toEqual({ status: "UNAVAILABLE" });
    expect(await lookupPurchaseHistory(company, input, reply({ requestId: "9f6d680a-eaf8-4943-98de-a762608ac765" }))).toEqual({ status: "UNAVAILABLE" });
  });

  it("fails closed for other company bindings, unexpected origins and provider failure", async () => {
    setup({ origin: "https://127.0.0.1", approvedOrigin: origin, companyId: "cosmo-company", token: "x".repeat(40) });
    const transport = reply();
    expect(await lookupPurchaseHistory("foreign", input, transport)).toEqual({ status: "UNCONFIGURED" });
    expect(await lookupPurchaseHistory(company, input, transport)).toEqual({ status: "UNAVAILABLE" });
    expect(transport).not.toHaveBeenCalled();
    setup();
    expect(await lookupPurchaseHistory(company, input, vi.fn().mockRejectedValue(Error("offline")))).toEqual({ status: "UNAVAILABLE" });
  });
});

const scope = { id: "admin", role: "ADMIN" as const, companyId: company, supplierId: null, name: null, email: "fixture@example.invalid", isActive: true };
const line = {
  sku: "SKU-1", lineKey: "line", sourceIndex: 0,
  product: { id: "product", name: "Synthetic", sku: "SKU-1", companyId: company },
  osfImport: { payload: { items: [{ lineKey: "line", sku: "SKU-1",
    snapshot: { columns: [{ columnKey: "primary", erpInstanceId: "erp-one", itemCode: "SKU-1", warehouses: ["Main"] }] },
  }] } },
};
const query = { instanceId: "erp-one", from: input.from, to: input.to };

describe("OSF purchase history page data", () => {
  it("denies unauthorized Staff before reading data", async () => {
    vi.mocked(requireRequirementReadAccess).mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(getOsfPurchaseHistory("import", "line", query)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.osfImportLine.findFirst).not.toHaveBeenCalled();
  });

  it("enforces the company boundary on the import line and product", async () => {
    vi.mocked(requireRequirementReadAccess).mockResolvedValue(scope);
    vi.mocked(prisma.osfImportLine.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...line, product: { ...line.product, companyId: "foreign" } } as never);
    await expect(getOsfPurchaseHistory("import", "line", query)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getOsfPurchaseHistory("import", "line", query)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.osfImportLine.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "line", osfImportId: "import", companyId: company },
    }));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("requires imported provenance and keeps company-scoped catalogue prices separate", async () => {
    setup();
    vi.mocked(requireRequirementReadAccess).mockResolvedValue({ ...scope, role: "STAFF" });
    vi.mocked(prisma.osfImportLine.findFirst).mockResolvedValue(line as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ supplierId: "portal-supplier", unitPrice: "123.50" }]);
    const transport = reply();
    vi.stubGlobal("fetch", transport);

    expect((await getOsfPurchaseHistory("import", "line", { ...query, instanceId: "erp-two" })).result.status).toBe("MAPPING_UNAVAILABLE");
    expect((await getOsfPurchaseHistory("import", "line", { ...query, to: "2028-06-01" })).result.status).toBe("INVALID_FILTER");
    expect(transport).not.toHaveBeenCalled();
    const model = await getOsfPurchaseHistory("import", "line", query);
    expect(model.result).toMatchObject({ status: "OK", records: [] });
    expect(model.prices).toEqual([{ supplierId: "portal-supplier", unitPrice: "123.50" }]);
    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), company, "product");
    vi.mocked(prisma.osfImportLine.findFirst).mockResolvedValueOnce({ ...line, osfImport: { payload: {} } } as never);
    expect((await getOsfPurchaseHistory("import", "line", query)).result.status).toBe("MAPPING_UNAVAILABLE");
  });
});
