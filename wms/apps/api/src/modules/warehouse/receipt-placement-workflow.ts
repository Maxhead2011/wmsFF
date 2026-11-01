import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { placementStockSql } from "./receipt-placement-report";
export type PlacementReceipt = { clientId: string; document: string };
const key = (warehouse: string, r: PlacementReceipt) =>
  "receipt.placement.v1:" +
  createHash("sha256")
    .update(JSON.stringify([warehouse, r.clientId, r.document]))
    .digest("hex");
export async function placementReceipts(
  tx: any,
  warehouseId: string,
  clientIds?: string[],
  selected?: PlacementReceipt,
  includeRequests = false,
) {
  const rows =
    await tx.$queryRaw(Prisma.sql`${placementStockSql(warehouseId, clientIds)}
 SELECT b.*,i."receiptAt",
 ${
   includeRequests
     ? Prisma.sql`ARRAY(SELECT DISTINCT r.number FROM "ClientRequestBoxSelection" bs
   JOIN "ClientRequestItem" ri ON ri.id=bs."requestItemId" JOIN "ClientRequest" r ON r.id=ri."requestId"
   WHERE bs."boxId"=b.id AND r."clientId"=b."clientId" AND r."warehouseId"=${warehouseId}
     AND r.status NOT IN ('DONE','CANCELLED') AND NOT b.placed)`
     : Prisma.sql`ARRAY[]::int[]`
 } AS requests,
 CASE WHEN m.value->>'clientId'=b."clientId" AND m.value->>'warehouseId'=${warehouseId} THEN m.value->>'series'
   WHEN i."receiptAt" IS NOT NULL THEN 'SERIES:'||extract(year from i."receiptAt")::int||':'||regexp_replace(b.code,'_[0-9]+$','') ELSE NULL END AS document
 FROM stocked b LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=b.id
 LEFT JOIN "SystemSetting" m ON m.key='receipt.membership.v1:'||b."clientId"||':'||b.id
 WHERE b."needsPlacement"`);
  const groups = new Map<string, any>();
  for (const row of rows) {
    if (
      !row.document ||
      (selected &&
        (row.clientId !== selected.clientId ||
          row.document !== selected.document))
    )
      continue;
    const id = key(warehouseId, {
      clientId: row.clientId,
      document: row.document,
    });
    const group = groups.get(id) ?? {
      id,
      clientId: row.clientId,
      client: row.client,
      document: row.document,
      date: row.receiptAt,
      receiving: false,
      total: 0,
      placed: 0,
      remaining: [],
      boxes: [],
      requests: [],
    };
    group.receiving = group.receiving || row.status === "receiving";
    group.total++;
    if (row.placed) group.placed++;
    else group.remaining.push(row.code);
    group.boxes.push(row.code);
    group.requests = Array.from(new Set([...group.requests, ...row.requests]));
    groups.set(id, group);
  }
  const result = Array.from(groups.values());
  const saved = await tx.systemSetting.findMany({
    where: {
      key: { startsWith: "receipt.placement.v1:" },
      AND: [
        { value: { path: ["warehouseId"], equals: warehouseId } },
        ...(clientIds
          ? [
              {
                OR: clientIds.map((clientId) => ({
                  value: { path: ["clientId"], equals: clientId },
                })),
              },
            ]
          : []),
        ...(selected
          ? [
              { value: { path: ["clientId"], equals: selected.clientId } },
              { value: { path: ["document"], equals: selected.document } },
            ]
          : []),
      ],
    },
  });
  const relevant = saved.filter(
    (s: any) =>
      s.value?.warehouseId === warehouseId &&
      (!clientIds || clientIds.includes(s.value.clientId)) &&
      (!selected ||
        (s.value.clientId === selected.clientId &&
          s.value.document === selected.document)),
  );
  for (const s of relevant)
    if (!result.some((r) => r.id === s.key)) {
      result.push({
        id: s.key,
        clientId: s.value.clientId,
        client: s.value.client,
        document: s.value.document,
        date: s.value.date,
        total: 0,
        placed: 0,
        remaining: [],
        boxes: [],
        requests: [],
      });
    }
  for (const row of result) {
    const state = relevant.find((s: any) => s.key === row.id)?.value;
    row.status =
      row.remaining.length || row.receiving
        ? state?.status === "DEFERRED"
          ? "DEFERRED"
          : "OPEN"
        : "COMPLETED";
    row.history = state?.history ?? [];
    row.previouslyPlaced = row.remaining.filter((code: string) =>
      row.history.some(
        (h: any) =>
          h.boxCode === code && ["PLACED", "COMPLETED"].includes(h.action),
      ),
    );
    row.excluded = (state?.initialBoxes ?? []).filter(
      (b: string) => !row.boxes.includes(b),
    );
  }
  for (const row of result) {
    row.exclusions = [];
    if (!row.excluded.length) continue;
    const boxes = await tx.box.findMany({
      where: { clientId: row.clientId, code: { in: row.excluded } },
      select: {
        code: true,
        status: true,
        warehouseId: true,
        client: {
          select: { storesWithoutBoxes: true, stockBalanceMode: true },
        },
        balances: {
          where: { warehouseId, quantity: { gt: 0 } },
          select: { status: true, quantity: true },
        },
      },
    });
    row.exclusions = row.excluded.map((code: string) => {
      const box = boxes.find((b: any) => b.code === code);
      const reason = !box
        ? "Короб удалён"
        : box.warehouseId !== warehouseId
          ? "Перемещён в другой филиал"
          : ["archived", "deleted"].includes(box.status)
            ? "Короб архивирован или удалён"
            : box.client.storesWithoutBoxes
              ? "Хранение без коробов"
              : box.client.stockBalanceMode !== "PALLET_SORT"
                ? "Изменён способ хранения"
                : !box.balances.length
                  ? "В коробе больше нет остатка"
                  : box.balances.every((b: any) =>
                        ["PACKING", "SHIPPING", "IN_TRANSIT"].includes(
                          b.status,
                        ),
                      )
                    ? "Передан в упаковку, отгрузку или транзит"
                    : "Изменилось состояние хранения";
      return { boxCode: code, reason };
    });
  }
  return result
    .filter((r) => !r.receiving || relevant.some((s: any) => s.key === r.id))
    .sort(
      (a, b) =>
        (b.requests?.length ?? 0) - (a.requests?.length ?? 0) ||
        b.remaining.length - a.remaining.length,
    );
}
// FIX: one advisory lock serializes changes for the same receipt across both managers.
export async function lockPlacementReceipt(
  tx: any,
  warehouseId: string,
  r: PlacementReceipt,
) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key(warehouseId, r)},0))`,
  );
}
export async function recordPlacementAction(
  tx: any,
  warehouseId: string,
  r: PlacementReceipt,
  action: string,
  user: any,
  boxCode?: string,
) {
  const [current] = await placementReceipts(tx, warehouseId, [r.clientId], r);
  if (!current)
    throw new BadRequestException(
      "Приёмка не найдена среди коробов с остатком.",
    );
  const id = key(warehouseId, r),
    old = await tx.systemSetting.findUnique({ where: { key: id } });
  const state = old?.value ?? {};
  const completed = current.remaining.length === 0 && !current.receiving;
  const status = completed
    ? "COMPLETED"
    : action === "DEFER"
      ? "DEFERRED"
      : "OPEN";
  // TEST: a repeated completion does not add another closing event.
  if (!(completed && state.status === "COMPLETED")) {
    const event = {
      action: completed ? "COMPLETED" : action,
      at: new Date().toISOString(),
      worker: user.name,
      userId: user.id,
      boxCode: boxCode ?? null,
      remaining: current.remaining.length,
    };
    const value = {
      ...state,
      warehouseId,
      clientId: r.clientId,
      document: r.document,
      client: current.client,
      date: current.date,
      status,
      initialBoxes: Array.from(
        new Set([...(state.initialBoxes ?? []), ...current.boxes]),
      ),
      history: [...(state.history ?? []).slice(-199), event],
    };
    await tx.systemSetting.upsert({
      where: { key: id },
      create: { key: id, value },
      update: { value },
    });
    await tx.auditLog.create({
      data: {
        entity: "ReceiptPlacement",
        entityId: id,
        action: "RECEIPT_PLACEMENT_" + event.action,
        userId: user.id,
        payload: { ...event, warehouseId, ...r },
      },
    });
  }
  return { ...current, status, canFinish: completed };
}
export async function assertPlacementReceipt(
  tx: any,
  warehouseId: string,
  r: PlacementReceipt,
  boxCode: string,
) {
  const [current] = await placementReceipts(tx, warehouseId, [r.clientId], r);
  if (!current?.boxes.includes(boxCode))
    throw new ConflictException(
      "Этот короб не относится к выбранной приёмке или уже выбыл из хранения.",
    );
}

export async function receiptForPlacementBox(
  tx: any,
  warehouseId: string,
  clientId: string,
  boxCode: string,
): Promise<PlacementReceipt | null> {
  const rows = await tx.$queryRaw(Prisma.sql`SELECT
   CASE WHEN m.value->>'clientId'=b."clientId" AND m.value->>'warehouseId'=${warehouseId} THEN m.value->>'series'
     WHEN i."receiptAt" IS NOT NULL THEN 'SERIES:'||extract(year from i."receiptAt")::int||':'||regexp_replace(b.code,'_[0-9]+$','') ELSE NULL END AS document
   FROM "Box" b JOIN "Client" c ON c.id=b."clientId" LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=b.id
   LEFT JOIN "SystemSetting" m ON m.key='receipt.membership.v1:'||b."clientId"||':'||b.id
   WHERE b."warehouseId"=${warehouseId} AND b."clientId"=${clientId} AND b.code=${boxCode} AND b.status NOT IN ('archived','deleted')
     AND c."stockBalanceMode"='PALLET_SORT' AND NOT c."storesWithoutBoxes"
     AND EXISTS(SELECT 1 FROM "StockBalance" q WHERE q."boxId"=b.id AND q."warehouseId"=${warehouseId} AND q."clientId"=${clientId}
       AND q.quantity>0 AND q.status NOT IN ('PACKING','SHIPPING','IN_TRANSIT'))`);
  return rows[0]?.document ? { clientId, document: rows[0].document } : null;
}

// FIX: concurrent managers can retry a serialization rollback with the same box and receipt.
export async function placementTransaction<T>(
  db: any,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: any,
): Promise<T> {
  const attempts = process.env.WMS_RECEIPT_PLACEMENT_ENABLED === "true" ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await db.$transaction(operation, options);
    } catch (error) {
      if ((error as any)?.code !== "P2034" || attempt === attempts - 1)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new Error("Не удалось сохранить размещение.");
}
