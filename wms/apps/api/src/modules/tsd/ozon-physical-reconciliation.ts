import {BadRequestException, ConflictException} from '@nestjs/common';
import {directionProgress} from './ozon-fbo-directions';
import {adjustmentHash, type AdjustmentRow} from './ozon-adjustment-policy';
import {supplyOrders, type SupplyIntegration} from '../client-requests/ozon-supply-policy';

export type ReconciliationMode = 'AVAILABLE' | 'PICKED';
export function reconciliationMode(value: unknown): ReconciliationMode {
  if (value !== 'AVAILABLE' && value !== 'PICKED') throw new BadRequestException('Выберите наличие или фактический отбор.');
  return value;
}

// FIX: derive physical quantities from persisted units, never from a route or stock balance.
export function physicalAdjustmentPlan(s: any) {
  const r = s.request, a = r.fboAssembly;
  const units = (a?.units ?? []).filter((u: any) => u.state !== 'RETURNED');
  if (!units.length) throw new ConflictException('Нет отобранного товара. Используйте расчёт по наличию.');
  const late = ['CONTROL', 'COMPLETED'].includes(a?.phase);
  if (late && (units.some((u: any) => u.state !== 'PACKED') || !a.boxes.length || a.boxes.some((b: any) => !b.closedAt)))
    throw new ConflictException('На контроле требуется весь упакованный товар и закрытые короба.');
  if (units.some((u: any) => !['PICKED', 'PACKED'].includes(u.state) || !r.items.some((i: any) => i.skuId === u.skuId)))
    throw new ConflictException('Отобранные единицы требуют сверки.');
  for (const u of units.filter((u: any) => u.state === 'PACKED')) {
    const box = a.boxes.find((b: any) => b.boxId === u.targetBoxId);
    if (!box || !s.directions.some((d: any) => d.name === box.direction && d.items.some((i: any) => i.skuId === u.skuId)))
      throw new ConflictException('Не определено направление упакованной единицы.');
  }
  const directions = directionProgress(s.directions, a.boxes, units);
  const lines = r.items.map((i: any) => ({...i, needed: i.quantity, picked: units.filter((u: any) => u.skuId === i.skuId).length}));
  if (lines.some((l: any) => l.picked > l.needed)) throw new ConflictException('Отобрано больше плана. Требуется сверка.');
  return {needed: r.items.reduce((n: number, i: any) => n + i.quantity, 0), lines, directions, route: [], pendingLocations: [], physicalBasis: late ? 'PACKED' : 'PICKED'};
}

export function reconciliationDirections(s: any, rows: AdjustmentRow[]) {
  return s.directions.map((d: any) => ({...d, items: d.items.map((i: any) => ({...i, quantity: rows.find(r => r.direction === d.name && r.skuId === i.skuId)!.after})).filter((i: any) => i.quantity > 0)}));
}

// FIX: pin both remote contents and identifiers; read timestamps do not invalidate a preview.
export function remoteComposition(link: SupplyIntegration) {
  return {connectionId: link.connectionId, mapping: link.mapping, orders: supplyOrders(link).map(o => ({orderId:o.orderId, state:o.state, supplies:o.supplies}))};
}

export async function reconciliationOperations(s: any, fresh: SupplyIntegration, directions: any[], resolve: (item: any) => Promise<any>) {
  const operations: any[] = [], comparison: any[] = [], used = new Set<string>();
  for (const d of directions) {
    const supply = fresh.supplies.find(v => v.id === fresh.mapping[d.name]);
    const order = supplyOrders(fresh).find(o => o.supplies.some(v => v.id === supply?.id));
    if (!supply || !order || used.has(supply.id)) throw new ConflictException('Нет однозначного соответствия направления Ozon.');
    used.add(supply.id);
    if (!d.items.length) throw new ConflictException('Направление стало пустым. Его отмена в Ozon требует отдельного решения.');
    const items = [];
    for (const i of d.items) {
      const matches = supply.items.filter(v => v.barcode === i.barcode);
      if (matches.length > 1) throw new ConflictException('Неоднозначный товар в Ozon.');
      const m = matches[0] ?? await resolve(i);
      if (!m?.offerId || !Number.isSafeInteger(Number(m.sku)) || Number(m.sku) <= 0) throw new ConflictException(`Не найден SKU Ozon для ШК ${i.barcode}.`);
      items.push({sku: Number(m.sku), quantity: i.quantity, quant: m.quant || 1});
    }
    if (new Set(items.map(i => i.sku)).size !== items.length) throw new ConflictException('Один SKU Ozon сопоставлен нескольким товарам.');
    let changed = false;
    for (const barcode of new Set([...supply.items.map(i => i.barcode), ...d.items.map((i: any) => i.barcode)])) {
      const before = s.directions.find((v: any) => v.name === d.name)?.items.filter((i: any) => i.barcode === barcode).reduce((n: number, i: any) => n + i.quantity, 0) ?? 0;
      const remote = supply.items.filter(i => i.barcode === barcode).reduce((n, i) => n + i.quantity, 0);
      const after = d.items.filter((i: any) => i.barcode === barcode).reduce((n: number, i: any) => n + i.quantity, 0);
      comparison.push({direction: d.name, barcode, before, remote, after});
      if (remote !== after) changed = true;
    }
    if (changed) operations.push({supplyId: supply.id, orderId: order.orderId, state: 'PENDING', items});
  }
  if (used.size !== fresh.supplies.length) throw new ConflictException('Есть поставка Ozon без направления ВМС.');
  return {operations, comparison, fingerprint: adjustmentHash(itemsIdentity(operations))};
}
const itemsIdentity = (operations: any[]) => operations.map(o => [o.supplyId, o.orderId, o.items]);
