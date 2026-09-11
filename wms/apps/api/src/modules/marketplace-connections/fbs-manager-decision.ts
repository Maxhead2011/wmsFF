import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, type FbsOrderRequestLink, type FbsTsdAssembly, type PrismaClient } from '@prisma/client';
import { permanentStorageBoxesEnabled } from '../../common/boxes/box-code-policy.service';
import type { AuthUser } from '../auth/auth.types';
import { FbsPickedDisposition, type ResolveFbsSyncConflictDto } from './dto/resolve-fbs-sync-conflict.dto';

const shipmentStatus = 'MANAGER_CONFIRMED_SHIPMENT';
const returnStatus = 'MANAGER_CONFIRMED_RETURN';

// FIX: new outcomes are opt-in; sold installations keep their existing lifecycle.
export function fbsManagerDisposition(syncStatus?: string | null): FbsPickedDisposition | undefined {
  if (!permanentStorageBoxesEnabled()) return undefined;
  if (syncStatus === shipmentStatus) return FbsPickedDisposition.SHIP_WITH_WB_LABEL;
  if (syncStatus === returnStatus) return FbsPickedDisposition.AWAIT_RETURN_RECEIPT;
  return undefined;
}

export function fbsManagerDecisionMessage(disposition: FbsPickedDisposition) {
  return disposition === FbsPickedDisposition.SHIP_WITH_WB_LABEL
    ? 'Решение менеджера сохранено: этикетка WB уже наклеена, товар уезжает. Списание сохранено, остаток не восстановлен.'
    : 'Решение менеджера сохранено: товар отложен без этикетки WB. Списание сохранено; остаток появится только после приёмки в отдельный бокс по ШК и КИЗ.';
}

const snapshotFields = ['requestId', 'lastCategory', 'lastSupplierStatus', 'lastWbStatus', 'lastSupplyId', 'lastSkuId', 'lastItemCount'] as const;

// FIX: a refreshed WB conflict must not release the same physical pick's plan twice.
export async function wasFbsDispatchSelectionReleased(tx: Prisma.TransactionClient, task: FbsTsdAssembly, link: FbsOrderRequestLink) {
  if (!permanentStorageBoxesEnabled()) return false;
  if (fbsManagerDisposition(link.syncStatus) === FbsPickedDisposition.AWAIT_RETURN_RECEIPT) return true;
  const event = await tx.auditLog.findFirst({
    where: { entity: 'FbsTsdAssembly', entityId: task.id, action: { in: [
      'FBS_SYNC_CONFLICT_MANAGER_CONFIRMED', 'FBS_SYNC_CONFLICT_RETURNED_TO_STOCK',
      'FBS_ASSEMBLY_ORDER_RESET', 'FBS_KIZ_SCAN_UNDONE',
    ] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true, payload: true },
  });
  const payload = event?.payload as Prisma.JsonObject | null;
  return event?.action === 'FBS_SYNC_CONFLICT_MANAGER_CONFIRMED' && payload?.dispatchSelectionReleased === true &&
    payload.requestId === task.requestId && payload.kiz === task.kiz && payload.barcode === task.barcode &&
    payload.completedAt === (task.completedAt?.toISOString() ?? null);
}

// FIX: manager acknowledgement changes workflow/audit only, never balances, marks or WB metadata.
export async function confirmFbsPickedManagerDecision(
  prisma: Pick<PrismaClient, '$transaction'>, task: FbsTsdAssembly, link: FbsOrderRequestLink,
  dto: ResolveFbsSyncConflictDto, user: AuthUser,
) {
  const disposition = dto.pickedDisposition;
  if (!permanentStorageBoxesEnabled() || !Object.values(FbsPickedDisposition).includes(disposition!)) {
    throw new BadRequestException('Выберите исход: этикетка WB наклеена — товар уезжает, либо товар отложен до повторной приёмки.');
  }
  const comment = dto.comment?.trim().slice(0, 1000);
  if (!comment) throw new BadRequestException('Укажите решение менеджера в комментарии.');
  if (dto.returnBoxCode || dto.returnBarcode || dto.returnKiz) {
    throw new BadRequestException('Решение менеджера и приёмка возврата выполняются отдельно.');
  }
  if (user.isDemo || user.roleCodes?.includes('CLIENT')) {
    throw new ForbiddenException('Решение по изъятому товару доступно только сотрудникам WMS.');
  }
  const message = fbsManagerDecisionMessage(disposition!);
  await prisma.$transaction(async tx => {
    const freshTask = await tx.fbsTsdAssembly.findUnique({ where: { id: task.id } });
    const freshLink = await tx.fbsOrderRequestLink.findUnique({ where: { id: link.id } });
    const request = await tx.clientRequest.findUnique({ where: { id: task.requestId }, select: { clientId: true, warehouseId: true, status: true } });
    if (!request?.warehouseId || request.clientId !== task.clientId || user.activeWarehouseId !== request.warehouseId ||
      (!user.permissionCodes?.includes('system:admin') && !user.writableWarehouseIds?.includes(request.warehouseId))) {
      throw new ForbiddenException('Решение разрешено только в доступном филиале заявки.');
    }
    if (!freshTask || !freshLink || freshTask.requestId !== task.requestId || freshTask.clientId !== task.clientId ||
      snapshotFields.some(field => freshLink[field] !== link[field])) {
      throw new BadRequestException('Состояние заказа изменилось. Обновите заявку и проверьте решение.');
    }
    const previous = fbsManagerDisposition(freshLink.syncStatus);
    const nextTaskStatus = disposition === FbsPickedDisposition.SHIP_WITH_WB_LABEL ? 'COMPLETED' : 'RETURN_REQUIRED';
    // FIX: retries after a lost response do not repeat audit or stock/planning operations.
    if (previous === disposition && freshTask.status === nextTaskStatus) return;
    if (previous || freshTask.status !== 'RETURN_REQUIRED' || freshLink.syncStatus !== 'RETURN_REQUIRED' ||
      freshTask.updatedAt.getTime() !== task.updatedAt.getTime() || request.status === 'DONE') {
      throw new BadRequestException('Решение уже принято или заказ изменился. Обновите заявку.');
    }
    if (disposition === FbsPickedDisposition.AWAIT_RETURN_RECEIPT && freshTask.cargoPackingId) {
      throw new BadRequestException('Товар уже включён в грузоместо. Сначала извлеките его из грузоместа перед откладыванием.');
    }
    // FIX: an unlabelled deferred unit is no longer planned for dispatch from the source box.
    // Its deducted stock and KIZ remain outside available stock until physical receipt.
    const selectionAlreadyReleased = await wasFbsDispatchSelectionReleased(tx, freshTask, freshLink);
    if (disposition === FbsPickedDisposition.AWAIT_RETURN_RECEIPT && freshTask.boxId && !selectionAlreadyReleased) {
      const selection = await tx.clientRequestBoxSelection.findUnique({
        where: { requestItemId_boxId: { requestItemId: freshTask.requestItemId, boxId: freshTask.boxId } },
      });
      if (selection) {
        if (selection.quantity <= Math.max(1, freshTask.itemCount)) {
          await tx.clientRequestBoxSelection.delete({ where: { id: selection.id } });
        } else {
          await tx.clientRequestBoxSelection.update({ where: { id: selection.id }, data: { quantity: { decrement: Math.max(1, freshTask.itemCount) } } });
        }
      }
    }
    await tx.fbsTsdAssembly.update({ where: { id: task.id }, data: { status: nextTaskStatus, errorMessage: `${message} ${comment}` } });
    await tx.fbsOrderRequestLink.update({ where: { id: link.id }, data: {
      syncStatus: disposition === FbsPickedDisposition.SHIP_WITH_WB_LABEL ? shipmentStatus : returnStatus,
      syncIssue: null,
    } });
    await tx.clientRequestEvent.create({ data: { requestId: task.requestId, clientId: task.clientId,
      eventType: 'COMMENT', title: 'Решение менеджера: списание сохранено',
      body: `Заказ №${task.orderId}. ${message} Комментарий: ${comment}`, createdByUserId: user.id,
    } });
    await tx.auditLog.create({ data: { userId: user.id, action: 'FBS_SYNC_CONFLICT_MANAGER_CONFIRMED',
      entity: 'FbsTsdAssembly', entityId: task.id,
      payload: { requestId: task.requestId, orderId: task.orderId, clientId: task.clientId,
        pickedDisposition: disposition!, stockRestored: false, quantity: Math.max(1, task.itemCount),
        dispatchSelectionReleased: selectionAlreadyReleased || disposition === FbsPickedDisposition.AWAIT_RETURN_RECEIPT,
        completedAt: freshTask.completedAt?.toISOString() ?? null,
        sourceBoxCode: task.boxCode, kiz: task.kiz, barcode: task.barcode, comment,
        previousStatus: freshTask.status, marketplaceCategory: freshLink.lastCategory,
      },
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { resolved: true, assemblyId: task.id, orderId: task.orderId, requestId: task.requestId, action: dto.action, message };
}
