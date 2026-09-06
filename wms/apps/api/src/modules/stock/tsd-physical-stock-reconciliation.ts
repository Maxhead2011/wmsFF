import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

// ADDED: opt-in only; sold installations retain their existing transfer policy.
export const physicalStockRecoveryEnabled = () => process.env.WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED === 'true';
type Db = Pick<Prisma.TransactionClient, 'productMark' | 'box' | 'stockBalance' | 'stockMovement' |
  'fbsTsdAssembly' | 'shippedKizHistory' | 'fbsWebKizStickerPrint' | 'fbsPrintJob' | 'fbsAssemblyAttemptHistory' | 'kizCirculationItem'>;
type Input = { source: { id: string; code: string; clientId: string; warehouseId: string | null; status: string; palletId: string | null }; skuId: string; scanCode: string };
type Parse = (value: string) => { gtin: string; serial: string } | null;

// FIX: a scan is proof of one physical unit, not permission to clear another unit's ownership/history.
export async function readPhysicalStockRecovery(db: Db, input: Input, parse: Parse) {
  const identity = parse(input.scanCode);
  if (!identity || !input.source.warehouseId || input.source.status === 'deleted') {
    throw new BadRequestException('Для сверки нужны существующий короб в вашем филиале, ШК и полный КИЗ.');
  }
  const { gtin, serial } = identity;
  const prefixes = [`01${gtin}21${serial}`, `]d201${gtin}21${serial}`, `(01)${gtin}(21)${serial}`,
    `01${gtin}\u001d21${serial}`, `]d201${gtin}\u001d21${serial}`, `01${gtin}<GS>21${serial}`];
  const rows = await db.productMark.findMany({ where: { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) }, take: 3,
    select: { id: true, clientId: true, skuId: true, boxId: true, status: true, value: true, updatedAt: true, stockMovementId: true } });
  if (rows.length > 1 || rows.some(row => { const parsed = parse(row.value); return !parsed || parsed.gtin !== gtin || parsed.serial !== serial; })) {
    throw new BadRequestException('Обнаружен конфликт записей КИЗ. Нужна сверка в WMS; остаток не изменён.');
  }
  const mark = rows[0] ?? null;
  if (mark && (mark.clientId !== input.source.clientId || mark.skuId !== input.skuId || mark.status !== 'AVAILABLE')) {
    throw new BadRequestException('КИЗ имеет другую принадлежность или недоступный статус. Автовосстановление остановлено.');
  }
  const restorationKey = 'tsd-physical-restore:' + createHash('sha256').update(JSON.stringify([input.source.clientId, gtin, serial])).digest('hex');
  if (await db.stockMovement.findUnique({ where: { idempotencyKey: restorationKey }, select: { id: true } })) {
    throw new BadRequestException('Эта единица уже восстановлена и перемещена. Обновите исходный короб; повторного начисления не будет.');
  }
  const kizWhere = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
  const conflicts = await Promise.all([
    db.fbsTsdAssembly.findFirst({ where: { OR: [kizWhere, { clientId: input.source.clientId,
      status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] }, AND: [
        { OR: [{ skuId: input.skuId }, { sourceSkuId: input.skuId }] },
        { OR: [{ boxId: input.source.id }, { reservedBoxId: input.source.id }] }] }] }, select: { id: true } }),
    db.shippedKizHistory.findFirst({ where: kizWhere, select: { id: true } }),
    db.fbsWebKizStickerPrint.findFirst({ where: kizWhere, select: { id: true } }),
    db.fbsPrintJob.findFirst({ where: kizWhere, select: { id: true } }),
    db.fbsAssemblyAttemptHistory.findFirst({ where: kizWhere, select: { id: true } }),
    db.kizCirculationItem.findFirst({ where: { OR: prefixes.map(prefix => ({ kizRaw: { startsWith: prefix } })) }, select: { id: true } }),
    db.stockBalance.findFirst({ where: { boxId: input.source.id, skuId: input.skuId, quantity: { not: 0 } }, select: { id: true } }),
  ]);
  if (conflicts.some(Boolean)) throw new BadRequestException('Есть остаток, сборка или история отгрузки этого товара/КИЗ. Автовосстановление остановлено; нужна сверка в WMS.');
  let previousBoxCode = input.source.code;
  if (mark && mark.boxId !== input.source.id) {
    const old = mark.boxId ? await db.box.findUnique({ where: { id: mark.boxId }, select: { id: true, code: true, clientId: true, warehouseId: true } }) : null;
    if (!old || old.clientId !== input.source.clientId || old.warehouseId !== input.source.warehouseId ||
        await db.stockBalance.findFirst({ where: { boxId: old.id, skuId: input.skuId, quantity: { not: 0 } }, select: { id: true } })) {
      throw new BadRequestException('Старая привязка КИЗ не подтверждена пустым коробом того же клиента и филиала. Нужна сверка в WMS.');
    }
    // FIX: zero stock alone does not release an active task's physical source.
    if (await db.fbsTsdAssembly.findFirst({ where: { clientId: input.source.clientId,
      status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] }, AND: [
        { OR: [{ skuId: input.skuId }, { sourceSkuId: input.skuId }] },
        { OR: [{ boxId: old.id }, { reservedBoxId: old.id }] }] }, select: { id: true } })) {
      throw new BadRequestException('Старый короб связан с незавершённой сборкой. Нужна сверка в WMS.');
    }
    previousBoxCode = old.code;
  }
  return { mark, restorationKey, restoreQuantity: 1 as const, previousBoxCode };
}
export type PhysicalStockRecovery = Awaited<ReturnType<typeof readPhysicalStockRecovery>>;
