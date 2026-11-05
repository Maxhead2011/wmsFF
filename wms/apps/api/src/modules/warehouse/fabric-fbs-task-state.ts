import { ConflictException } from '@nestjs/common';
import { FabricOrderIdentity, FabricOrderLedger, fabricOrderKey } from './fabric-fbs-order';

export const FABRIC_TASK_MARKER = '__FABRIC_FBS__';
export interface FabricTaskIdentity extends FabricOrderIdentity { id: string; clientId: string; sourceArticle?: string | null }

// FIX: manufacture progress is separate from barcode/KIZ scan evidence.
export function fabricTaskLines(ledger: FabricOrderLedger, owner: FabricOrderIdentity) {
  const key = fabricOrderKey(owner), order = ledger.fbsOrders?.[key];
  if (!order) return null;
  if (fabricOrderKey(order.identity) !== key) throw new ConflictException('Владелец резерва ткани изменился.');
  return order.lines.map(line => {
    const reservation = ledger.fbsReservations?.find(r => r.key === JSON.stringify([key, line.lineId]));
    if (!reservation || reservation.skuId !== line.skuId || reservation.units !== line.units ||
        reservation.lengthMm !== line.lengthMm || reservation.warehouseId !== line.warehouseId ||
        reservation.material !== line.material || reservation.color !== line.color ||
        !Number.isSafeInteger(reservation.confirmedUnits) || reservation.confirmedUnits < 0 || reservation.confirmedUnits > line.units) {
      throw new ConflictException('Резерв нарезки требует сверки.');
    }
    if (reservation.released && reservation.confirmedUnits < line.units) {
      throw new ConflictException('Резерв нарезки освобождён. Обновите задание.');
    }
    return { lineId: line.lineId, skuId: line.skuId, material: line.material, color: line.color,
      lengthMm: line.lengthMm, quantity: line.units, confirmedUnits: reservation.confirmedUnits,
      remainingUnits: line.units - reservation.confirmedUnits };
  });
}

export async function readFabricTaskLines(db: any, task: FabricTaskIdentity,
  enabled = process.env.WMS_FBS_FABRIC_CUT_ENABLED === 'true') {
  if (!enabled) {
    if (task.sourceArticle === FABRIC_TASK_MARKER) throw new ConflictException('Нарезка временно отключена. Резерв и нарезанные отрезы сохранены; обратитесь к администратору.');
    return null;
  }
  const record = await db.systemSetting.findUnique({ where: { key: `fabric.rolls.v1:${task.clientId}` } });
  const lines = record?.value ? fabricTaskLines(record.value as FabricOrderLedger, task) : null;
  if (!lines && task.sourceArticle === FABRIC_TASK_MARKER) throw new ConflictException('Не найден резерв задания нарезки. Требуется сверка.');
  return lines;
}

export async function requireFabricCutComplete(db: any, task: FabricTaskIdentity) {
  const lines = await readFabricTaskLines(db, task);
  if (lines?.some(line => line.remainingUnits > 0)) {
    throw new ConflictException('Сначала отсканируйте все отрезы заказа. Метры учитываются при сканировании товара.');
  }
}
