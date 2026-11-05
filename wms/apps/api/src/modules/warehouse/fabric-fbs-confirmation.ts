import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { withLockedFabricLedger, FabricStoreTransaction } from './fabric-fbs-store';
import { FabricOrderIdentity, FabricOrderLedger, confirmFabricOrderCut, fabricOrderKey } from './fabric-fbs-order';

export interface FabricCutActor { userId: string; deviceCode: string }
export interface FabricCutCommand {
  clientId: string; taskId: string; owner: FabricOrderIdentity;
  lineId: string; confirmedUnits: number; operationId: string;
}
export interface FabricProductionProof {
  key: string; taskId: string; clientId: string; requestId: string;
  marketplace: string; connectionId: string; orderId: string;
  lineId: string; skuId: string; warehouseId: string;
  material: string; color: string;
  units: number; mm: number; userId: string; deviceCode: string; at: string;
}
interface ConfirmationTx extends FabricStoreTransaction {
  clientRequest: { findUnique(args: any): Promise<any> };
  fbsTsdAssembly: { findUnique(args: any): Promise<any> };
  clientRequestItem: { findUnique(args: any): Promise<any> };
}

// FIX: caller supplies its database transaction and writes PACKING + audit in that
// same transaction. No marketplace request or fictitious scanner event is emitted.
export async function confirmFabricProduction(
  tx: ConfirmationTx, command: FabricCutCommand, actor: FabricCutActor,
  writeProof: (tx: ConfirmationTx, proof: FabricProductionProof) => Promise<void>,
  now = new Date(),
) {
  if (!actor.userId?.trim() || !actor.deviceCode?.trim() || !command.operationId?.trim() ||
      command.operationId.length > 128 || !command.clientId?.trim() || !command.taskId?.trim()) {
    throw new ConflictException('Не указан сотрудник, устройство или идентификатор операции нарезки.');
  }
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${command.owner.requestId} FOR UPDATE`;
  const request = await tx.clientRequest.findUnique({ where: { id: command.owner.requestId } });
  if (!request || request.clientId !== command.clientId || ['DONE', 'CANCELLED', 'REJECTED'].includes(request.status)) {
    throw new ConflictException('Заявка закрыта или принадлежит другому клиенту.');
  }
  return withLockedFabricLedger(tx, command.clientId, async raw => {
    const ledger = raw as FabricOrderLedger;
    await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${command.taskId} FOR UPDATE`;
    const task = await tx.fbsTsdAssembly.findUnique({ where: { id: command.taskId } });
    if (!task || task.status !== 'IN_PROGRESS' || task.workerUserId !== actor.userId || task.deviceCode !== actor.deviceCode ||
        task.clientId !== command.clientId || task.requestId !== command.owner.requestId ||
        task.marketplace !== command.owner.marketplace || task.connectionId !== command.owner.connectionId || task.orderId !== command.owner.orderId) {
      throw new ConflictException('Задание нарезки изменилось или назначено другому сотруднику.');
    }
    const saved = ledger.fbsOrders?.[fabricOrderKey(command.owner)];
    const line = saved?.lines.find(l => l.lineId === command.lineId);
    if (!line || line.warehouseId !== request.warehouseId) throw new ConflictException('Изменился склад или состав нарезки.');
    const item = await tx.clientRequestItem.findUnique({ where: { id: line.lineId } });
    if (!item || item.requestId !== request.id || item.skuId !== line.skuId || item.quantity < line.units) {
      throw new ConflictException('Позиция нарезки больше не соответствует заявке.');
    }
    const result = confirmFabricOrderCut(ledger, command.owner, command.lineId, command.confirmedUnits, command.operationId);
    if (result.cutUnits) {
      const key = 'fabric-fbs-cut:' + createHash('sha256').update(JSON.stringify([
        command.clientId, fabricOrderKey(command.owner), command.lineId, command.operationId,
      ])).digest('hex');
      await writeProof(tx, {
        key, taskId: task.id, clientId: command.clientId, ...command.owner,
        lineId: line.lineId, skuId: line.skuId, warehouseId: line.warehouseId,
        material: line.material, color: line.color,
        units: result.cutUnits, mm: result.cutMm, userId: actor.userId, deviceCode: actor.deviceCode, at: now.toISOString(),
      });
    }
    return { ledger: result.state, result: { cutUnits: result.cutUnits, cutMm: result.cutMm, replay: result.replay } };
  });
}
