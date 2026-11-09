import { BadRequestException } from '@nestjs/common';
import { linkedOrderSku, productLinksEnabled, readProductLinks } from './marketplace-product-links';
import { FBS_UNLIMITED_CARGO_PLACE_CAPACITY } from './fbs.constants';

type Selection = { connectionId: string; id: string };
type Raw = Record<string, any>;
const text = (v: unknown) => String(v ?? '').trim();
const list = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.map(text).filter(Boolean))] : [];

// FIX: printing reads the selected WB orders, never the operational client refresh.
// Use marketplace metadata even after a cold restart; local links supply only the search date.
export async function wbLabelOrders(db: any, clientId: string, input: Selection[],
  history: (headers: Record<string, string>, selected: { dateFrom?: number; selectedIds: Set<string> }) => Promise<Raw[]>,
  json: (url: string, init: RequestInit) => Promise<any>) {
  const selections = [...new Map(input.map(s => [JSON.stringify([s.connectionId, s.id]), s])).values()];
  if (!selections.length) throw new BadRequestException('Выберите заказы.');
  const connections = await db.clientMarketplaceConnection.findMany({
    where: { clientId, isActive: true, id: { in: [...new Set(selections.map(s => s.connectionId))] } },
    select: { id: true, marketplace: true, apiKey: true, accountName: true },
  });
  if (connections.length !== new Set(selections.map(s => s.connectionId)).size)
    throw new BadRequestException('Подключение выбранного кабинета не найдено или отключено.');
  if (connections.some((c: Raw) => c.marketplace !== 'WILDBERRIES')) return null;
  if (selections.some(s => !/^\d+$/.test(s.id) || !Number.isSafeInteger(Number(s.id)) || Number(s.id) <= 0))
    throw new BadRequestException('Некорректный номер заказа WB.');
  const links = await db.fbsOrderRequestLink.findMany({
    where: { clientId, marketplace: 'WILDBERRIES', OR: selections.map(s => ({ connectionId: s.connectionId, orderId: s.id })) },
    select: { connectionId: true, orderId: true, orderPlacedAt: true },
  });
  const raw: Raw[] = [];
  for (const connection of connections) {
    const selected = selections.filter(s => s.connectionId === connection.id);
    const dates = selected.map(s => links.find((l: Raw) => l.connectionId === s.connectionId && l.orderId === s.id)?.orderPlacedAt);
    const dateFrom = dates.every(d => d instanceof Date && Number.isFinite(d.getTime()))
      ? Math.floor(Math.min(...dates.map(d => d.getTime())) / 86400000) * 86400 : undefined;
    const headers = { Authorization: connection.apiKey, 'Content-Type': 'application/json' };
    const metadata = await history(headers, { dateFrom, selectedIds: new Set(selected.map(s => s.id)) });
    for (let i = 0; i < selected.length; i += 1000) {
      const batch = selected.slice(i, i + 1000);
      const response = await json('https://marketplace-api.wildberries.ru/api/v3/orders/status', {
        method: 'POST', headers, body: JSON.stringify({ orders: batch.map(s => Number(s.id)) }),
      });
      for (const s of batch) {
        const order = metadata.find(o => text(o.id) === s.id);
        const statuses = (Array.isArray(response.orders) ? response.orders : []).filter((o: Raw) => text(o.id) === s.id);
        if (!order || statuses.length !== 1 || !statuses[0].supplierStatus || !statuses[0].wbStatus)
          throw new BadRequestException(`WB не вернул данные выбранного заказа ${s.id}. Обновите список и повторите скачивание.`);
        raw.push({ ...order, ...statuses[0], id: s.id, connectionId: connection.id, accountName: connection.accountName ?? null });
      }
    }
  }
  const productLinks = await readProductLinks(db, clientId);
  const catalog = await db.sku.findMany({ where: { clientId }, select: {
    id: true, name: true, internalSku: true, clientSku: true, article: true, size: true,
    needsChestnyZnak: true, isUnmarked: true, barcodes: { select: { value: true } },
  } });
  const plans = await db.fbsSupplyPlan.findMany({ where: { clientId, marketplace: 'WILDBERRIES',
    connectionId: { in: connections.map((c: Raw) => c.id) }, supplyId: { in: list(raw.map(o => o.supplyId || o.supplyID)) } } });
  return selections.map(s => {
    const o = raw.find(o => o.connectionId === s.connectionId && o.id === s.id)!;
    const barcodes = list(o.skus), supplyId = text(o.supplyId || o.supplyID) || null;
    const linkedId = linkedOrderSku(productLinks, s.connectionId, barcodes, o.nmId && o.chrtId ? `${o.nmId}:${o.chrtId}` : undefined);
    const matches = productLinksEnabled(clientId) ? catalog.filter((sku: Raw) => sku.id === linkedId)
      : catalog.filter((sku: Raw) => sku.barcodes.some((b: Raw) => barcodes.includes(b.value)));
    const product = matches.length === 1 ? matches[0] : null;
    const plan = plans.find((p: Raw) => p.connectionId === s.connectionId && p.supplyId === supplyId);
    const cancelled = ['cancel', 'cancel_carrier', 'cancelled', 'canceled'].includes(o.supplierStatus) ||
      ['canceled', 'canceled_by_client', 'declined_by_client', 'defect', 'canceled_by_carrier'].includes(o.wbStatus);
    return { ...s, marketplace: 'WILDBERRIES', accountName: o.accountName,
      supplierStatus: o.supplierStatus, wbStatus: o.wbStatus,
      // FIX: preserve destination/date when selected reads prepare shipping.
      officeId: text(o.officeId) || null, deliveryDate: text(o.deliveryDate) || null,
      category: cancelled ? 'cancelled' : o.wbStatus === 'sold' ? 'archive' : o.supplierStatus === 'complete' ? 'shipped' : 'active',
      barcodes, product, itemCount: 1, supplyId, crossBorderType: text(o.crossBorderType) || null,
      requiredMeta: list(o.requiredMeta), optionalMeta: list(o.optionalMeta),
      shipmentPlan: plan ? { destination: plan.deliveryDestination, itemsPerCargoPlace: FBS_UNLIMITED_CARGO_PLACE_CAPACITY,
        requiresCargoPlaces: plan.deliveryDestination === 'PICKUP_POINT', cargoPlaceCount: plan.cargoPlaceCount ?? 0,
        cargoPlaceIds: list(plan.cargoPlaceIds), sentToWbAt: plan.sentToWbAt?.toISOString() ?? null, sentToWbBy: null } : null,
    };
  });
}
