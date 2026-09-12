import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient, type FbsTsdAssembly } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import type { ClientScopeService } from '../auth/client-scope.service';
import { FBS_WB_ACCOUNTED, FBS_WB_ACCOUNTED_ACTION, fbsWbAccountingEnabled, isFbsWbAccountingStatus, isFbsWbAccountingUntouched, isFbsWbKizShipmentCandidate } from '../../common/fbs-wb-accounting';
import { shipWbKiz } from './fbs-wb-kiz-shipment';

export class AccountFbsOrderByWbDto {
  @IsString()
  @Length(3, 1000)
  comment!: string;
}

type WbStatus = { supplierStatus: string; wbStatus: string; isTransferable?: boolean };

// FIX: no-pair accounting remains separate; a linked pair records an exact warehouse shipment.
export async function accountFbsOrderByWb(
  prisma: PrismaClient, scopes: ClientScopeService, requestId: string, taskId: string,
  dto: AccountFbsOrderByWbDto, user: AuthUser, readStatus: (task: FbsTsdAssembly) => Promise<WbStatus>,
  beforeShipment: () => Promise<void> = async () => {},
) {
  if (!fbsWbAccountingEnabled()) throw new ForbiddenException('Учёт по WB не включён для этой WMS.');
  if (user.isDemo || user.roleCodes?.includes('CLIENT') ||
    !user.permissionCodes?.some(code => ['system:admin', 'client-requests:write'].includes(code))) {
    throw new ForbiddenException('Решение доступно только сотруднику с правом изменения заявок.');
  }
  const comment = dto.comment?.trim();
  if (!comment || comment.length < 3 || comment.length > 1000) throw new BadRequestException('Укажите комментарий менеджера (3–1000 символов).');
  const task = await prisma.fbsTsdAssembly.findUnique({ where: { id: taskId } });
  if (!task || task.requestId !== requestId || task.marketplace !== 'WILDBERRIES') throw new NotFoundException('Заказ WB в этой заявке не найден.');
  scopes.requireClientAccess(user, task.clientId, 'write');
  // FIX: PACKED is eligible only for an exact-pair shipment (or its idempotent replay).
  const shipPair = isFbsWbKizShipmentCandidate(task);
  const packedShipment = shipPair || (task.status === FBS_WB_ACCOUNTED && task.itemCount === 1 && Boolean(task.kiz?.trim() && task.barcode?.trim()));
  const checkRequest = (request: { clientId: string; warehouseId: string | null; status: string } | null) => {
    if (!request?.warehouseId || request.clientId !== task.clientId || request.warehouseId !== user.activeWarehouseId ||
      (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(request.warehouseId))) {
      throw new ForbiddenException('Заявка находится в недоступном филиале.');
    }
    if (!['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK', ...(packedShipment ? ['PACKED'] : [])].includes(request.status)) throw new ConflictException('Заявка уже закрыта или упакована.');
  };
  const linkWhere = { marketplace_connectionId_orderId: { marketplace: task.marketplace, connectionId: task.connectionId, orderId: task.orderId } };
  const [request, link] = await Promise.all([
    prisma.clientRequest.findUnique({ where: { id: requestId }, select: { clientId: true, warehouseId: true, status: true } }),
    prisma.fbsOrderRequestLink.findUnique({ where: linkWhere }),
  ]);
  checkRequest(request);
  if (shipPair && !user.permissionCodes.some(code => ['stock:write', 'system:admin'].includes(code))) {
    throw new ForbiddenException('Списание по КИЗ требует права на складские операции.');
  }
  const originalPair = { kiz: task.kiz, barcode: task.barcode, boxId: task.boxId, updatedAt: task.updatedAt.getTime() };
  const response = { clientId: task.clientId, accounted: true, assemblyId: taskId, orderId: task.orderId, requestId,
    shipped: Boolean(task.kiz && task.barcode),
    message: task.kiz && task.barcode ? `Заказ №${task.orderId} отгружен со склада по WB. Пара КИЗ–ШК сохранена в истории.` :
      `Заказ №${task.orderId} учтён по статусу WB. Физическая сборка и списание не создавались.` };
  if (link?.requestId === requestId && link.clientId === task.clientId && link.syncStatus === FBS_WB_ACCOUNTED && task.status === FBS_WB_ACCOUNTED) return response;
  if (!link || link.requestId !== requestId || link.clientId !== task.clientId ||
    !['ACTIVE', ...(shipPair ? ['RETURN_REQUIRED'] : [])].includes(link.syncStatus) ||
    !(shipPair || isFbsWbAccountingUntouched(task))) {
    throw new ConflictException('Заказ изменён или содержит физические сканы. Требуется отдельное решение по товару.');
  }
  if (shipPair) await beforeShipment();
  const wb = await readStatus(task);
  if (!isFbsWbAccountingStatus(wb) || wb.isTransferable !== false) throw new ConflictException('WB не подтвердил обработку заказа и запрет переноса. Обновите данные.');
  const checkedAt = new Date();
  await prisma.$transaction(async tx => {
    // Serialize against packing/closing this request so the same unit cannot be deducted twice.
    if (shipPair) await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id = ${requestId} FOR UPDATE`;
    const [fresh, freshLink, freshRequest] = await Promise.all([
      tx.fbsTsdAssembly.findUnique({ where: { id: taskId } }),
      tx.fbsOrderRequestLink.findUnique({ where: linkWhere }),
      tx.clientRequest.findUnique({ where: { id: requestId }, select: { clientId: true, warehouseId: true, status: true } }),
    ]);
    checkRequest(freshRequest);
    if (fresh?.requestId === requestId && freshLink?.requestId === requestId && fresh.status === FBS_WB_ACCOUNTED && freshLink.syncStatus === FBS_WB_ACCOUNTED) return;
    if (!fresh || !freshLink || fresh.requestId !== requestId || fresh.clientId !== task.clientId || freshLink.requestId !== requestId ||
      fresh.updatedAt.getTime() !== originalPair.updatedAt || freshLink.updatedAt.getTime() !== link.updatedAt.getTime() ||
      freshLink.syncStatus !== link.syncStatus || fresh.kiz !== originalPair.kiz || fresh.barcode !== originalPair.barcode || fresh.boxId !== originalPair.boxId ||
      !(shipPair ? isFbsWbKizShipmentCandidate(fresh) : isFbsWbAccountingUntouched(fresh))) throw new ConflictException('Заказ изменился во время проверки WB. Повторите проверку.');
    const shipment = shipPair ? await shipWbKiz(tx, fresh, freshRequest!.warehouseId!, checkedAt) : null;
    const changed = await tx.fbsTsdAssembly.updateMany({ where: { id: taskId, updatedAt: fresh.updatedAt, requestId, status: fresh.status }, data: {
      status: FBS_WB_ACCOUNTED, reservedBoxId: null, reservedBoxCode: null, reservedAt: null,
      errorMessage: null,
      ...(shipment ? { sourceBoxPending: false, boxId: shipment.sourceBoxId, boxCode: shipment.sourceBoxCode } : {}),
    } });
    const linked = await tx.fbsOrderRequestLink.updateMany({ where: { id: freshLink.id, updatedAt: freshLink.updatedAt, requestId, syncStatus: freshLink.syncStatus }, data: {
      syncStatus: FBS_WB_ACCOUNTED, syncIssue: null, lastSupplierStatus: wb.supplierStatus, lastWbStatus: wb.wbStatus, lastSeenAt: checkedAt,
    } });
    if (changed.count !== 1 || linked.count !== 1) throw new ConflictException('Параллельное изменение заказа. Повторите проверку.');
    await tx.auditLog.create({ data: { userId: user.id, action: FBS_WB_ACCOUNTED_ACTION, entity: 'ClientRequest', entityId: requestId,
      payload: { assemblyId: taskId, orderId: task.orderId, connectionId: task.connectionId, clientId: task.clientId,
        supplyId: task.supplyId, previousStatus: task.status, confirmedByName: user.name, checkedAt: checkedAt.toISOString(),
        supplierStatus: wb.supplierStatus, wbStatus: wb.wbStatus, isTransferable: false, stockMutationPerformed: Boolean(shipment), comment,
        ...(shipment ? { ...shipment, kiz: fresh.kiz, barcode: fresh.barcode } : {}) } } });
    await tx.clientRequestEvent.create({ data: { requestId, clientId: task.clientId, eventType: 'COMMENT', title: 'Заказ учтён по статусу WB',
      body: `№${task.orderId}: WB ${wb.supplierStatus}/${wb.wbStatus}, перенос недоступен. ${shipment ? `Отгрузка КИЗ ${fresh.kiz}, ШК ${fresh.barcode}; источник: ${shipment.sourceBoxCode}.` : 'Физическая сборка и списание не создавались.'} ${comment}`, createdByUserId: user.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return response;
}
