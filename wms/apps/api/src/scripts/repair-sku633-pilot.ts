import { createHash } from 'node:crypto';
import { Prisma, PrismaClient, StockStatus } from '@prisma/client';
import { StockBalancesService } from '../modules/stock/stock-balances.service';

// FIX: one-time, fail-closed correction for Konstantin's confirmed seven physical units.
const requestId = '323223d3-d683-4727-a2ff-c733b93f0134';
const clientId = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
const warehouseId = 'afb244a1-50ae-4ae6-9111-afe85949fa58';
const skuId = 'd92fd9d0-1a92-425e-b84c-b3c861d79b09';
const targetId = 'ca0c9883-4169-41bc-9d8a-8013566a7f4d';
const targetCode = 'FFL__LKB0409_3';
const movedCodes = ['FFL_LKB1007_196', 'FFL_LKB1107_176', 'FFL_LKVOZ2208_06'];
const key = 'sku633-confirmed-seven-20260905';
const scope = { clientId, warehouseId, skuId };
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export function mutationBoxIds633(sources: Array<{ sourceBoxId: string; sourceBoxCode: string; plannedQuantity: number; pickedQuantity: number }>) {
  // FIX: old emptied sources change route metadata only, not their inventory or marks.
  return [...sources.filter(s => s.plannedQuantity > s.pickedQuantity && !movedCodes.includes(s.sourceBoxCode)).map(s => s.sourceBoxId), targetId];
}

export function validate633Facts(f: { available: number; reserved: number; moved: number[]; ownReserve: number; picked: number; received: number; totalPlan: number; blockers: number }) {
  if (f.available !== 7 || f.reserved !== 7 || JSON.stringify(f.moved) !== '[2,4,1]' ||
      f.ownReserve !== 31 || f.picked !== 17 || f.received !== 0 || f.totalPlan !== 55 || f.blockers !== 0) {
    throw new Error('Снимок №633 изменился или небезопасен. Коррекция не выполнена.');
  }
  return { correction: -7, release: 31, targetPlan: 7, totalPlan: 55 };
}

export async function repair633(db: PrismaClient, applyHash?: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${requestId} FOR UPDATE`);
    if (await tx.auditLog.findUnique({ where: { id: key } })) return { alreadyApplied: true };
    const request = await tx.clientRequest.findUniqueOrThrow({ where: { id: requestId }, include: { skuCollectionSources: true, skuCollectionScans: true } });
    assert(request.number === 633 && request.clientId === clientId && request.warehouseId === warehouseId &&
      request.type === 'SKU_COLLECTION' && request.status === 'IN_WORK' && !request.comment?.includes('[SKU_SORTING_V2]'), 'Неверная заявка или режим');
    const sources = request.skuCollectionSources;
    assert(sources.length === 9 && sources.every(s => s.skuId === skuId && s.clientId === clientId && s.warehouseId === warehouseId), 'Изменился состав заявки');
    const affected = [...sources.filter(s => s.plannedQuantity > s.pickedQuantity).map(s => s.sourceBoxId), targetId];
    const stockWriteBoxes = mutationBoxIds633(sources);
    const balances = await tx.stockBalance.findMany({ where: { ...scope, boxId: { in: affected } }, orderBy: { id: 'asc' } });
    const marks = await tx.productMark.findMany({ where: { clientId, skuId, boxId: { in: affected } }, orderBy: { id: 'asc' } });
    const target = await tx.box.findUniqueOrThrow({ where: { id: targetId } });
    assert(target.code === targetCode && target.clientId === clientId && target.warehouseId === warehouseId && target.status === 'active', 'Изменился целевой короб');
    const [assemblies, counting, full] = await Promise.all([
      tx.fbsTsdAssembly.count({ where: { clientId, skuId, status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] },
        OR: [{ boxId: { in: affected } }, { reservedBoxId: { in: affected } }, { kiz: { in: marks.map(m => m.value) } }] } }),
      tx.inventoryAuditBox.count({ where: { boxId: { in: stockWriteBoxes }, status: 'COUNTING' } }),
      tx.inventorySession.count({ where: { type: 'FULL', status: { in: ['ACTIVE', 'REVIEW'] } } }),
    ]);
    const positiveTarget = balances.filter(b => b.boxId === targetId && b.quantity > 0);
    assert(positiveTarget.length === 2, 'Неожиданные статусы в целевом коробе');
    const available = positiveTarget.find(b => b.status === 'AVAILABLE');
    const duplicate = positiveTarget.find(b => b.status === 'RESERVED');
    assert(available && duplicate, 'Нет ожидаемой пары AVAILABLE/RESERVED');
    const relocated = movedCodes.map(code => sources.find(s => s.sourceBoxCode === code));
    assert(relocated.every(Boolean), 'Не найдены старые источники');
    const evidence: unknown[] = [];
    for (const s of relocated) {
      assert(s && s.pickedQuantity === 0 && s.receivedQuantity === 0 && !balances.some(b => b.boxId === s.sourceBoxId && b.quantity !== 0), 'Старый источник изменился');
      for (const status of [StockStatus.AVAILABLE, StockStatus.RESERVED]) {
        const moves = await tx.stockMovement.findMany({ where: { ...scope, boxId: { in: [s.sourceBoxId, targetId] },
          type: 'MOVE', status, sourceDocument: 'TSD-BOX-CONSOLIDATION', comment: `Объединение остатков после проверки короба ${s.sourceBoxCode}` }, orderBy: { createdAt: 'asc' } });
        assert(moves.length === 2 && moves.find(m => m.boxId === targetId)?.quantity === s.plannedQuantity &&
          moves.find(m => m.boxId === s.sourceBoxId)?.quantity === -s.plannedQuantity, 'Не подтверждён парный перенос');
        evidence.push(...moves);
      }
    }
    const own = sources.filter(s => s.plannedQuantity > s.pickedQuantity && !movedCodes.includes(s.sourceBoxCode));
    let ownReserve = 0;
    for (const s of own) {
      const rows = balances.filter(b => b.boxId === s.sourceBoxId && b.status === 'RESERVED' && b.quantity > 0);
      const proof = await tx.stockMovement.aggregate({ where: { ...scope, boxId: s.sourceBoxId, sourceDocument: requestId, type: 'RESERVE', status: 'RESERVED' }, _sum: { quantity: true } });
      assert(rows.length === 1 && rows[0].quantity === s.plannedQuantity - s.pickedQuantity &&
        (proof._sum.quantity ?? 0) - s.pickedQuantity === rows[0].quantity, 'Не подтверждён собственный резерв');
      ownReserve += rows[0].quantity;
    }
    const facts = { available: available.quantity, reserved: duplicate.quantity, moved: relocated.map(s => s!.plannedQuantity), ownReserve,
      picked: sources.reduce((n, s) => n + s.pickedQuantity, 0), received: sources.reduce((n, s) => n + s.receivedQuantity, 0),
      totalPlan: sources.reduce((n, s) => n + s.plannedQuantity, 0), blockers: assemblies + counting + full };
    const plan = validate633Facts(facts);
    assert(request.skuCollectionScans.length === 17 && request.skuCollectionScans.every(s => s.status === 'PICKED'), 'Изменились ранее отобранные единицы');
    const snapshot = { request, balances, marks, target, evidence };
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    if (!applyHash) return { dryRun: true, hash, facts, plan };
    assert(applyHash === hash, 'Снимок изменился после анализа');
    // FIX: remove the duplicated RESERVED seven, keeping the seven AVAILABLE physical units intact.
    const removed = await tx.stockBalance.deleteMany({ where: { id: duplicate.id, quantity: 7, status: 'RESERVED' } });
    assert(removed.count === 1, 'Остаток изменился параллельно');
    await tx.stockMovement.create({ data: { ...scope, boxId: targetId, palletId: duplicate.palletId, type: 'INVENTORY_ADJUSTMENT', status: 'RESERVED', quantity: -7,
      sourceDocument: requestId, idempotencyKey: key, comment: 'Константин подтвердил 7 физических единиц. Удалён дублирующий резерв после актуализации и переноса; доступные 7 сохранены.' } });
    const balanceKeys = new StockBalancesService(null as never, null as never);
    for (const s of own) {
      const row = balances.find(b => b.boxId === s.sourceBoxId && b.status === 'RESERVED' && b.quantity > 0)!;
      await tx.stockBalance.delete({ where: { id: row.id } });
      const input = { ...scope, boxId: row.boxId, palletId: row.palletId, status: StockStatus.AVAILABLE };
      const balanceKey = balanceKeys.balanceKey(input);
      await tx.stockBalance.upsert({ where: { balanceKey }, create: { ...input, balanceKey, quantity: row.quantity }, update: { quantity: { increment: row.quantity } } });
      await tx.stockMovement.createMany({ data: [
        { ...input, type: 'RESERVE', status: 'RESERVED', quantity: -row.quantity, sourceDocument: requestId, comment: 'Снятие собственного резерва №633 для пилотной сортировки' },
        { ...input, type: 'RESERVE', status: 'AVAILABLE', quantity: row.quantity, sourceDocument: requestId, comment: 'Снятие собственного резерва №633 для пилотной сортировки' },
      ] });
    }
    // FIX: only this SKU's own reserved marks; SHIPPING/PACKING and other SKUs are untouched.
    await tx.productMark.updateMany({ where: { id: { in: marks.filter(m => m.status === 'RESERVED' && m.boxId && stockWriteBoxes.includes(m.boxId)).map(m => m.id) }, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
    for (const s of relocated) await tx.skuCollectionSource.update({ where: { id: s!.id }, data: { plannedQuantity: 0 } });
    await tx.skuCollectionSource.create({ data: { ...scope, requestId, sourceBoxId: targetId, sourceBoxCode: targetCode, plannedQuantity: 7 } });
    await tx.clientRequest.update({ where: { id: requestId }, data: { comment: `${request.comment ?? ''}\n[SKU_SORTING_V2]\n[${key}] Факт 7 подтверждён Константином; маршрут восстановлен по переносам.` } });
    await tx.auditLog.create({ data: { id: key, action: 'SKU633_CONFIRMED_ACTUAL_REPAIR', entity: 'ClientRequest', entityId: requestId,
      payload: { authorizedBy: 'Константин, подтверждение в задаче Codex', snapshotHash: hash, facts, plan,
        before: JSON.parse(JSON.stringify(snapshot)), note: 'Другие SKU, PACKING и отгрузки не изменены.' } } });
    const afterTarget = await tx.stockBalance.aggregate({ where: { ...scope, boxId: targetId }, _sum: { quantity: true } });
    const afterTotal = await tx.stockBalance.aggregate({ where: { ...scope, boxId: { in: affected } }, _sum: { quantity: true } });
    assert(afterTarget._sum.quantity === 7 && afterTotal._sum.quantity === balances.reduce((n, b) => n + b.quantity, 0) - 7, 'Нарушен контроль количества');
    return { applied: true, hash, facts, plan, targetQuantity: afterTarget._sum.quantity };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

if (require.main === module) {
  const db = new PrismaClient();
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--apply-hash' && /^[a-f0-9]{64}$/.test(args[1]))) throw new Error('Используйте анализ без аргументов либо --apply-hash <свежий hash>');
  repair633(db, args[1]).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
