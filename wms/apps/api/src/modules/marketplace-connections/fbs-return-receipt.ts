import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { FbsTsdAssembly, Prisma } from '@prisma/client';
import { BoxCodePolicyService, permanentStorageBoxesEnabled } from '../../common/boxes/box-code-policy.service';
import type { AuthUser } from '../auth/auth.types';
import type { ResolveFbsSyncConflictDto } from './dto/resolve-fbs-sync-conflict.dto';
import { fbsManagerDisposition } from './fbs-manager-decision';

type ReturnTask = Pick<FbsTsdAssembly, 'completedAt' | 'status' | 'kiz' | 'barcode' | 'relabelConfirmedAt'>;
// FIX: a logical reservation is different from a physically scanned/completed pick.
export const requiresFbsReturnReceipt = (task: ReturnTask) => permanentStorageBoxesEnabled() && Boolean(
  task.completedAt || (task.status === 'RETURN_REQUIRED' && (task.kiz || task.barcode || task.relabelConfirmedAt)),
);

const normalizeKiz = (value: string) => value.replace(/<GS>/gi, '\u001d').replace(/^\]d2/i, '').trim();

export function requireFbsReturnScans(task: FbsTsdAssembly, dto: ResolveFbsSyncConflictDto) {
  if (!requiresFbsReturnReceipt(task)) return;
  // FIX: neither manager confirmation nor bulk requests without scans can manufacture a return.
  if (dto.action !== 'RETURN_TO_STOCK' || !dto.returnBoxCode?.trim() || !dto.returnBarcode?.trim() ||
      ((task.requiresKiz || task.kiz) && !dto.returnKiz?.trim())) {
    throw new BadRequestException('Товар уже изъят из короба. Нужна повторная приёмка: отсканируйте бокс назначения, ШК товара и его КИЗ.');
  }
  if (task.kiz && normalizeKiz(dto.returnKiz!) !== normalizeKiz(task.kiz)) {
    throw new BadRequestException('КИЗ не совпадает с отобранным товаром этого заказа. Остатки не изменены.');
  }
  if (Math.max(1, task.itemCount) !== 1 || task.marketplace !== 'WILDBERRIES') {
    throw new BadRequestException('Для этого заказа нужна отдельная поштучная приёмка возврата. Автоматический возврат в исходный короб запрещён.');
  }
}

export async function validateFbsReturnReceipt(
  tx: Prisma.TransactionClient, task: FbsTsdAssembly, dto: ResolveFbsSyncConflictDto,
  user: AuthUser, boxCodes?: BoxCodePolicyService,
) {
  requireFbsReturnScans(task, dto);
  if (!requiresFbsReturnReceipt(task)) return undefined;
  if (user.isDemo || user.roleCodes?.includes('CLIENT')) throw new ForbiddenException('Приёмка возврата доступна только сотрудникам WMS.');
  const request = await tx.clientRequest.findUnique({ where: { id: task.requestId }, select: { clientId: true, warehouseId: true, status: true } });
  // FIX: dispatch of the original request does not receive a separately deferred unit.
  const deferredLink = request?.status === 'DONE' ? await tx.fbsOrderRequestLink.findUnique({
    where: { marketplace_connectionId_orderId: { marketplace: task.marketplace, connectionId: task.connectionId, orderId: task.orderId } },
  }) : null;
  const deferredReceipt = deferredLink?.requestId === task.requestId && fbsManagerDisposition(deferredLink?.syncStatus) === 'AWAIT_RETURN_RECEIPT';
  if (!request?.warehouseId || request.clientId !== task.clientId || (request.status === 'DONE' && !deferredReceipt)) {
    throw new BadRequestException('Заявка уже отгружена или её склад не определён. Нужна проверка возврата после отгрузки.');
  }
  if (user.activeWarehouseId !== request.warehouseId ||
      (!user.permissionCodes?.includes('system:admin') && !user.writableWarehouseIds?.includes(request.warehouseId))) {
    throw new ForbiddenException('Приёмка возврата разрешена только в доступном филиале заявки.');
  }
  if (!boxCodes) throw new BadRequestException('Настройки боксов недоступны. Остатки не изменены.');
  const code = await boxCodes.requireStorageBox(dto.returnBoxCode!);
  const [box, sku] = await Promise.all([
    tx.box.findUnique({ where: { code } }),
    tx.sku.findUnique({ where: { id: task.skuId }, include: { barcodes: true } }),
  ]);
  if (!box || box.status !== 'active' || box.clientId !== task.clientId || box.warehouseId !== request.warehouseId) {
    throw new BadRequestException('Нужен действующий бокс того же клиента и филиала. Сначала создайте или откройте бокс.');
  }
  if (sku?.clientId !== task.clientId || !sku.barcodes.some(b => b.value === dto.returnBarcode!.trim())) {
    throw new BadRequestException('ШК не соответствует товару возвращаемого заказа.');
  }
  if (await tx.inventoryAuditBox.findFirst({ where: { boxId: box.id, status: 'COUNTING' }, select: { id: true } })) {
    throw new BadRequestException('Бокс назначения сейчас пересчитывается. Завершите проверку или выберите другой бокс.');
  }
  const mark = task.kiz ? await tx.productMark.findFirst({ where: { clientId: task.clientId, value: task.kiz } }) : null;
  if ((task.kiz || task.requiresKiz) && (!mark || mark.skuId !== task.skuId || mark.status !== 'PACKING' ||
      (mark.boxId !== null && mark.boxId !== task.boxId))) {
    throw new BadRequestException('КИЗ уже перемещён, отгружен или не относится к резерву этого товара. Повторная приёмка не выполнена.');
  }
  return { boxId: box.id, boxCode: box.code, palletId: box.palletId, warehouseId: request.warehouseId, mark };
}

export type FbsReturnReceipt = NonNullable<Awaited<ReturnType<typeof validateFbsReturnReceipt>>>;
