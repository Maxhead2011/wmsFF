import { StorageLocationsService } from "../src/modules/warehouse/storage-locations.service";
import { expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { placementReceipts } from "../src/modules/warehouse/receipt-placement-workflow";
const url = process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if (
  url &&
  !url.startsWith(
    "postgresql://codex_tests@127.0.0.1:55469/kiz_duplicate_tests",
  )
)
  throw Error("Dedicated test database required");
it.skipIf(!url)(
  "two concurrent managers place separate boxes and close the same receipt once",
  async () => {
    // TEST: exercise real advisory locks and serialization retries on an isolated database.
    const p = new PrismaClient({ datasources: { db: { url } } }),
      client = randomUUID(),
      warehouse = randomUUID(),
      sku = randomUUID();
    const users = [randomUUID(), randomUUID()],
      boxes = [randomUUID(), randomUUID()],
      pallets = [randomUUID(), randomUUID()];
    const doc = "SERIES:2026:TEST_" + randomUUID();
    const receipt = { clientId: client, document: doc };
    vi.stubEnv("WMS_RECEIPT_PLACEMENT_ENABLED", "true");
    try {
      await p.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS "ReceiptStockIdentity" ("boxId" text PRIMARY KEY, "receiptAt" timestamptz)',
      );
      await p.client.create({
        data: { id: client, code: client, name: "Concurrent test" },
      });
      await p.warehouse.create({
        data: { id: warehouse, code: warehouse, name: "test" },
      });
      await p.sku.create({
        data: { id: sku, internalSku: sku, clientId: client, name: "test" },
      });
      for (let n = 0; n < 2; n++) {
        await p.user.create({
          data: {
            id: users[n],
            email: users[n] + "@test.invalid",
            name: "Manager " + n,
            passwordHash: "test",
          },
        });
        await p.box.create({
          data: {
            id: boxes[n],
            code: boxes[n].toUpperCase(),
            clientId: client,
            warehouseId: warehouse,
            status: "active",
          },
        });
        await p.stockBalance.create({
          data: {
            balanceKey: boxes[n],
            clientId: client,
            warehouseId: warehouse,
            boxId: boxes[n],
            skuId: sku,
            status: "AVAILABLE",
            quantity: 1,
          },
        });
        await p.storagePallet.create({
          data: {
            id: pallets[n],
            code: pallets[n],
            clientId: client,
            warehouseId: warehouse,
            status: "OPEN",
            source: "TEST",
          },
        });
        await p.systemSetting.create({
          data: {
            key: "receipt.membership.v1:" + client + ":" + boxes[n],
            value: { clientId: client, warehouseId: warehouse, series: doc },
          },
        });
      }
      const service = new StorageLocationsService(
        p as any,
        {} as any,
        {} as any,
      );
      await Promise.all(
        boxes.map((boxId, n) =>
          service.addBox(
            pallets[n],
            {
              boxCode: boxId.toUpperCase(),
              placementClientId: client,
              placementDocument: doc,
            },
            {
              id: users[n],
              name: "Manager " + n,
              permissionCodes: ["system:admin"],
              roleCodes: ["ADMIN"],
              clientScopeMode: "ALL",
              activeWarehouseId: warehouse,
              warehouseIds: [warehouse],
              writableWarehouseIds: [warehouse],
            } as any,
          ),
        ),
      );
      const [finished] = await placementReceipts(
        p,
        warehouse,
        [client],
        receipt,
      );
      expect(finished.placed).toBe(2);
      expect(finished.remaining).toEqual([]);
      expect(finished.status).toBe("COMPLETED");
      expect(
        await p.auditLog.count({
          where: {
            entity: "ReceiptPlacement",
            action: "RECEIPT_PLACEMENT_COMPLETED",
            userId: { in: users },
          },
        }),
      ).toBe(1);
    } finally {
      await p.auditLog.deleteMany({ where: { userId: { in: users } } });
      await p.systemSetting.deleteMany({
        where: {
          OR: [
            { key: { startsWith: "receipt.membership.v1:" + client + ":" } },
            { value: { path: ["clientId"], equals: client } },
          ],
        },
      });
      await p.storagePallet.deleteMany({ where: { id: { in: pallets } } });
      await p.stockBalance.deleteMany({ where: { clientId: client } });
      await p.box.deleteMany({ where: { id: { in: boxes } } });
      await p.sku.deleteMany({ where: { id: sku } });
      await p.user.deleteMany({ where: { id: { in: users } } });
      await p.client.deleteMany({ where: { id: client } });
      await p.warehouse.deleteMany({ where: { id: warehouse } });
      await p.$disconnect();
      vi.unstubAllEnvs();
    }
  },
);
