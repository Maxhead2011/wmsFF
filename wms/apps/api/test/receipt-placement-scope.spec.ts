import { afterEach, expect, it, vi } from "vitest";
import { StorageLocationsService } from "../src/modules/warehouse/storage-locations.service";
const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("../src/modules/warehouse/receipt-placement-report", () => ({
  receiptPlacementReport: report,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("does not query stock when the own-WMS feature is disabled", async () => {
  // TEST: sold installations do not activate the new stock query.
  vi.stubEnv("WMS_RECEIPT_PLACEMENT_ENABLED", "false");
  const s = new StorageLocationsService({} as any, {} as any, {} as any);
  expect((await s.placementReport({} as any)).enabled).toBe(false);
  expect(report).not.toHaveBeenCalled();
});
it("passes only authorized client and warehouse scope into the report", async () => {
  vi.stubEnv("WMS_RECEIPT_PLACEMENT_ENABLED", "true");
  const s = new StorageLocationsService({} as any, {} as any, {} as any);
  const user: any = {
    activeWarehouseId: "allowed",
    permissionCodes: [],
    warehouseIds: ["allowed"],
    roleCodes: ["CLIENT"],
    clientScopeMode: "ALL",
    clientIds: ["one"],
  };
  report.mockResolvedValue({
    summary: { awaiting: 1 },
    items: [],
    nextCursor: null,
  });
  await s.placementReport(user, "cursor", true);
  expect(report).toHaveBeenCalledWith(
    expect.anything(),
    "allowed",
    ["one"],
    "cursor",
    true,
  );
  await expect(
    s.placementReport({ ...user, activeWarehouseId: "other" }),
  ).rejects.toThrow("Выберите доступный филиал.");
  expect(report).toHaveBeenCalledTimes(1);
});
