import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { recountHash } from './tsd-transfer-kiz-recount';

type Source = { id: string; code: string; clientId: string; warehouseId: string | null };
type Scan = { key: string; raw: string; gtin: string; serial: string };
// FIX: an administrator supplies the physical quantity in every previous box. No inferred zeroes.
export async function planAdminOldBoxes(db: Prisma.TransactionClient, source: Source, skuId: string,
  scans: Scan[], counts: unknown) {
  const prefixes = scans.flatMap(s => [s.key, ']d2' + s.key, `(01)${s.gtin}(21)${s.serial}`,
    `01${s.gtin}\u001d21${s.serial}`, `]d201${s.gtin}\u001d21${s.serial}`, `01${s.gtin}<GS>21${s.serial}`]);
  const marks = await db.productMark.findMany({ where: { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) }, take: 401 });
  const foreign = marks.filter(mark => mark.boxId && mark.boxId !== source.id).sort((a, b) => a.id.localeCompare(b.id));
  if (!foreign.length) {
    if (counts !== undefined && (!Array.isArray(counts) || counts.length)) throw new BadRequestException('Привязки изменились. Повторите сверку.');
    return null;
  }
  if (foreign.some(mark => mark.clientId !== source.clientId || mark.skuId !== skuId || mark.status !== 'AVAILABLE')) {
    throw new BadRequestException('Для этой привязки сначала требуется разбор сборки или повторная приёмка.');
  }
  const ids = [...new Set(foreign.map(mark => mark.boxId!))].sort();
  if (ids.length > 10) throw new BadRequestException('Проверяйте не более 10 старых коробов за одну сверку.');
  const supplied = new Map<string, number>();
  if (counts !== undefined) {
    if (!Array.isArray(counts) || counts.length !== ids.length) throw new BadRequestException('Укажите фактическое количество в каждом старом коробе.');
    for (const row of counts) {
      if (!row || typeof row.boxCode !== 'string' || !Number.isInteger(row.quantity) || row.quantity < 0 || row.quantity > 10000 || supplied.has(row.boxCode)) {
        throw new BadRequestException('Некорректное количество или повтор старого короба.');
      }
      supplied.set(row.boxCode, row.quantity);
    }
  }
  const boxes = [];
  for (const id of ids) {
    const box = await db.box.findUnique({ where: { id }, select: { id: true, code: true, clientId: true, warehouseId: true, palletId: true, status: true } });
    if (!box || box.clientId !== source.clientId || !source.warehouseId || box.warehouseId !== source.warehouseId) throw new ForbiddenException('Старый короб относится к другому клиенту или филиалу.');
    if (!['active', 'receiving', 'archived'].includes(box.status)) throw new BadRequestException('Старый короб удалён. Повторите проверку.');
    const balances = await db.stockBalance.findMany({ where: { boxId: id, skuId }, orderBy: { id: 'asc' } });
    if (balances.some(b => b.clientId !== source.clientId || b.warehouseId !== source.warehouseId || b.quantity < 0 || b.status !== 'AVAILABLE' && b.quantity !== 0)) throw new BadRequestException('В старом коробе есть недоступный остаток; сначала завершите разбор сборки.');
    const active = await db.fbsTsdAssembly.findFirst({ where: { clientId: source.clientId, completedAt: null,
      status: { notIn: ['COMPLETED', 'CANCELLED', 'SHIPPED', 'RETURNED'] }, AND: [
        { OR: [{ skuId }, { sourceSkuId: skuId }] }, { OR: [{ boxId: id }, { reservedBoxId: id }] }] }, select: { id: true } });
    if (active) throw new BadRequestException('Старый короб связан с незавершённой сборкой. Сначала подтвердите её разбор на ТСД.');
    const previousMarks = await db.productMark.findMany({ where: { boxId: id, skuId, status: 'AVAILABLE' }, orderBy: { id: 'asc' }, take: 201 });
    if (previousMarks.length > 200 || previousMarks.some(m => m.clientId !== source.clientId)) throw new BadRequestException('Некорректный состав старого короба.');
    const remaining = previousMarks.filter(m => !foreign.some(f => f.id === m.id));
    const quantity = counts === undefined ? null : supplied.get(box.code);
    if (counts !== undefined && quantity === undefined) throw new BadRequestException('Список старых коробов изменился. Повторите сверку.');
    if (quantity != null && quantity > 0 && quantity < remaining.length) throw new BadRequestException(`В ${box.code} нужно уточнить оставшиеся КИЗы: отсканируйте его полный состав в сверке.`);
    const previousQuantity = balances.filter(b => b.status === 'AVAILABLE').reduce((sum, b) => sum + b.quantity, 0);
    boxes.push({ ...box, boxCode: box.code, previousQuantity, quantity: quantity ?? null, balances, previousMarks,
      retired: quantity === 0 ? remaining : [] });
  }
  return { boxes, adopted: foreign, needsCounts: counts === undefined,
    snapshot: recountHash({ boxes, foreign, scans: scans.map(s => s.key) }) };
}
