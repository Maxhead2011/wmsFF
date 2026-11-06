import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FabricOrderIdentity, FabricOrderLine, FabricOrderLedger, reserveFabricOrder, fabricOrderKey } from './fabric-fbs-order';
import { withLockedFabricLedger } from './fabric-fbs-store';
import { identifyFabricSku } from './fabric-fbs-availability';

export interface FabricAssignmentCommand {
  clientId: string;
  owner: FabricOrderIdentity;
  lines: FabricOrderLine[];
  capability: boolean;
}

// FIX: reserve every fabric line and claim the task inside one transaction.
// The caller resolves the complete marketplace composition before opening it;
// claim must only write DB state, never call the marketplace or printer.
export async function assignFabricOrder<T>(
  tx: Prisma.TransactionClient, command: FabricAssignmentCommand,
  claim: (tx: Prisma.TransactionClient, ledger: FabricOrderLedger) => Promise<T>,
  enabled = process.env.WMS_FBS_FABRIC_CUT_ENABLED === 'true',
): Promise<T> {
  if (!enabled || command.capability !== true) throw new ConflictException('Нарезка ФБС не включена для этого ТСД.');
  await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${command.owner.requestId} FOR UPDATE`;
  const request = await tx.clientRequest.findUnique({ where: { id: command.owner.requestId } });
  if (!request || request.clientId !== command.clientId || !request.warehouseId ||
      ['DONE', 'CANCELLED', 'REJECTED'].includes(request.status)) throw new ConflictException('Заявка закрыта или изменена.');
  return withLockedFabricLedger(tx, command.clientId, async raw => {
    for (const prefix of ['fabric.rolls.enabled.v1:', 'fabric.fbs.enabled.v1:']) {
      const setting = await tx.systemSetting.findUnique({ where: { key: prefix + command.clientId } });
      if ((setting?.value as { enabled?: boolean } | null)?.enabled !== true) {
        throw new ConflictException('Нарезка ФБС не включена у клиента.');
      }
    }
    const items = await tx.clientRequestItem.findMany({ where: { requestId: request.id }, include: { sku: true } });
    const pending = (raw as FabricOrderLedger & { shipmentPending?: Array<{ key?: string; warehouseId: string; material: string; color: string; meters: number }> }).shipmentPending ?? [];
    const receivedAfter = new Map<string, number>();
    const currentKey = fabricOrderKey(command.owner);
    const orders = (raw as FabricOrderLedger).fbsOrders ?? {};
    for (const line of command.lines) {
      const item = items.find(i => i.id === line.lineId);
      if (!item || item.skuId !== line.skuId || item.sku?.clientId !== command.clientId ||
          line.warehouseId !== request.warehouseId || item.quantity < line.units) {
        throw new ConflictException('Состав нарезки не соответствует заявке.');
      }
      const identity = identifyFabricSku(item.sku);
      if (!identity || identity.material !== line.material || identity.color !== line.color || identity.lengthMm !== line.lengthMm) {
        throw new ConflictException('Длина или материал не соответствует артикулу.');
      }
      // FIX: several orders may share one request item. Its total is a ceiling,
      // not permission to manufacture that total separately for every order.
      let committed = 0;
      for (const [key, order] of Object.entries(orders)) {
        if (key === currentKey || order.identity.requestId !== request.id) continue;
        for (const other of order.lines.filter(l => l.lineId === line.lineId)) {
          const reservation = raw.fbsReservations?.find(r => r.key === JSON.stringify([key, other.lineId]));
          if (!reservation) throw new ConflictException('История резерва ткани требует сверки.');
          committed += reservation.released ? reservation.confirmedUnits : reservation.units;
        }
      }
      if (committed + line.units > item.quantity) throw new ConflictException('Количество позиции уже зарезервировано для других заказов.');
      const disputed = pending.filter(p => p.warehouseId === line.warehouseId && p.material === line.material && p.color === line.color && p.meters > 0);
      if (disputed.length) {
        // FIX: resolve immutable shipment dates under the same client ledger lock.
        // Unknown/FBO evidence fails closed; never spend new receipts to erase old debt.
        if (disputed.some(p => !p.key?.startsWith('wb:') || p.key.length <= 3)) {
          throw new ConflictException('По этому материалу требуется сверка предыдущего расхода.');
        }
        const ids = [...new Set(disputed.map(p => p.key!.slice(3)))];
        const shipments = await tx.wbOrderShipment.findMany({
          where: { clientId: command.clientId, warehouseId: line.warehouseId, id: { in: ids } },
          select: { id: true, shippedAt: true },
        });
        const dates = ids.map(id => shipments.find(s => s.id === id)?.shippedAt?.getTime());
        if (dates.some(date => date === undefined || !Number.isFinite(date))) {
          throw new ConflictException('По этому материалу требуется сверка предыдущего расхода.');
        }
        receivedAfter.set(line.lineId, Math.max(...dates as number[]));
      }
    }
    let ledger: FabricOrderLedger;
    try {
      ledger = reserveFabricOrder(raw as FabricOrderLedger, command.owner, command.lines, receivedAfter);
    } catch (error) {
      if (receivedAfter.size && error instanceof Error && ['Insufficient continuous fabric', 'Fabric reservation requires reconciliation'].includes(error.message)) {
        throw new ConflictException('Недостаточно свободной ткани из приходов после спорных отгрузок. Старый расход остаётся на сверке.');
      }
      throw error;
    }
    const result = await claim(tx, ledger);
    return { ledger, result };
  });
}
