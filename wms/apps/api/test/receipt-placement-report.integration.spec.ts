import { expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { receiptPlacementReport } from "../src/modules/warehouse/receipt-placement-report";
const url = process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if (
  url &&
  !url.startsWith(
    "postgresql://codex_tests@127.0.0.1:55469/kiz_duplicate_tests",
  )
)
  throw Error("Dedicated test database required");
it.skipIf(!url)(
  "counts actual unplaced boxes and respects client, branch, deleted pallets and code-only placements",
  async () => {
    // TEST: all fixtures are rolled back, including on a failed assertion.
    const p = new PrismaClient({ datasources: { db: { url } } });
    const rollback = new Error("rollback fixtures");
    try {
      await p.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS "ReceiptStockIdentity" ("boxId" text PRIMARY KEY, "receiptAt" timestamptz)',
          );
          const client = randomUUID(),
            other = randomUUID(),
            warehouse = randomUUID(),
            foreign = randomUUID(),
            sku = randomUUID();
          for (const id of [client, other])
            await tx.client.create({ data: { id, code: id, name: id } });
          for (const id of [warehouse, foreign])
            await tx.warehouse.create({ data: { id, code: id, name: id } });
          await tx.sku.create({
            data: {
              id: sku,
              internalSku: sku,
              clientId: client,
              article: sku,
              name: "placement test",
            },
          });
          const boxes = [];
          for (let n = 0; n < 5; n++) {
            const id = randomUUID();
            boxes.push(id);
            await tx.box.create({
              data: {
                id,
                code: "FFL_TEST_0" + n,
                clientId: n === 4 ? other : client,
                warehouseId: n === 3 ? foreign : warehouse,
                status: n === 2 ? "archived" : "active",
              },
            });
            await tx.stockBalance.create({
              data: {
                balanceKey: id,
                clientId: n === 4 ? other : client,
                warehouseId: n === 3 ? foreign : warehouse,
                skuId: sku,
                boxId: id,
                status: "AVAILABLE",
                quantity: 1,
              },
            });
          }
          const pallet = randomUUID();
          await tx.storagePallet.create({
            data: {
              id: pallet,
              clientId: client,
              warehouseId: warehouse,
              code: pallet,
              status: "OPEN",
              source: "TEST",
            },
          });
          await tx.storagePalletBox.create({
            data: { palletId: pallet, boxCode: "FFL_TEST_00" },
          });
          const db = { $transaction: (fn: any) => fn(tx) };
          const report = await receiptPlacementReport(db, warehouse, [client]);
          expect(report.summary).toEqual({ boxes: 2, pallets: 1, awaiting: 1 });
          expect(report.items.map((b: any) => b.id)).toEqual([boxes[1]]);
          expect(report.items[0].receipt).toBeNull();
          await tx.$executeRawUnsafe(
            'INSERT INTO "ReceiptStockIdentity" ("boxId","receiptAt") VALUES ($1,$2)',
            boxes[1],
            new Date("2026-11-01T09:00:00Z"),
          );
          const key = "receipt.membership.v1:" + client + ":" + boxes[1];
          await tx.systemSetting.create({
            data: {
              key,
              value: {
                clientId: client,
                warehouseId: warehouse,
                series: "SERIES:2026:FFL_CONFIRMED",
              },
            },
          });
          expect(
            (await receiptPlacementReport(db, warehouse, [client])).items[0]
              .receipt,
          ).toBe("SERIES:2026:FFL_CONFIRMED");
          expect(
            (await receiptPlacementReport(db, warehouse, [client], boxes[1]))
              .items,
          ).toEqual([]);
          await tx.systemSetting.update({
            where: { key },
            data: {
              value: {
                clientId: client,
                warehouseId: foreign,
                series: "OTHER_BRANCH",
              },
            },
          });
          expect(
            (await receiptPlacementReport(db, warehouse, [client])).items[0]
              .receipt,
          ).toBe("SERIES:2026:FFL_TEST");
          const none = await receiptPlacementReport(db, warehouse, []);
          expect(none.summary.awaiting).toBe(0);
          expect(none.items).toEqual([]);
          await tx.storagePallet.update({
            where: { id: pallet },
            data: { status: "deleted" },
          });
          expect(
            (await receiptPlacementReport(db, warehouse, [client])).summary,
          ).toEqual({ boxes: 2, pallets: 0, awaiting: 2 });
          expect(
            (
              await receiptPlacementReport(
                db,
                warehouse,
                [client],
                undefined,
                true,
              )
            ).items,
          ).toEqual([]);
          await tx.stockBalance.updateMany({
            where: { boxId: boxes[0] },
            data: { status: "SHIPPING" },
          });
          expect(
            (await receiptPlacementReport(db, warehouse, [client])).summary,
          ).toEqual({ boxes: 2, pallets: 0, awaiting: 1 });
          await tx.client.update({
            where: { id: client },
            data: { storesWithoutBoxes: true },
          });
          expect(
            (await receiptPlacementReport(db, warehouse, [client])).summary
              .awaiting,
          ).toBe(0);
          throw rollback;
        },
        { timeout: 15000 },
      );
    } catch (e) {
      if (e !== rollback) throw e;
    } finally {
      await p.$disconnect();
    }
  },
);
