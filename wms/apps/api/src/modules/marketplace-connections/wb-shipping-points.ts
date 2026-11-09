import { BadRequestException } from '@nestjs/common';

// FIX: shippingPointId is independent of destinationOfficeId. Russian WB API,
// official 03-orders-fbs.yaml, retrieved 2026-11-09. Sold installation stays off.
export const wbShippingEnabled = () => process.env.WMS_WB_SHIPPING_POINTS_ENABLED === 'true';
export type WbRequest = (path: string, init?: RequestInit) => Promise<Record<string, any>>;
export type WbShippingPoint = { id: string; name: string; address: string; city: string; officeType: string; available: boolean };

export function shippingDate(value: string | undefined) {
  const date = String(value ?? '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BadRequestException('Укажите корректную дату отгрузки.');
  }
  return date;
}

export async function shippingPoints(request: WbRequest, supplyId: string, city: string, date: string): Promise<WbShippingPoint[]> {
  if (!city?.trim() || city.length > 120) throw new BadRequestException('Укажите населённый пункт сдачи.');
  const query = new URLSearchParams({ city: city.trim(), officeType: 'sc,sw,pp,pfc,gpp', shippingDt: shippingDate(date) });
  const result = await request(`/api/marketplace/v3/fbs/supplies/${encodeURIComponent(supplyId)}/shipping-points?${query}`);
  if (!Array.isArray(result.shippingPoints)) throw new BadRequestException('WB не вернул список пунктов сдачи. Повторите проверку.');
  return result.shippingPoints.filter((point: any) => Number.isSafeInteger(Number(point.id)) && Number(point.id) > 0).map((point: any) => ({
    id: String(point.id), name: String(point.name ?? ''), address: String(point.address ?? ''),
    city: String(point.city ?? ''), officeType: String(point.officeType ?? ''), available: point.available === true,
  }));
}

export function availableShippingPoint<T extends { id: string; available: boolean }>(points: T[], id: string): T {
  const point = points.find((item) => item.id === id && item.available);
  if (!point) throw new BadRequestException('Выбранный пункт сдачи недоступен для этой поставки и даты. Обновите список пунктов.');
  return point;
}

export async function saveShippingMethod(request: WbRequest, supplyId: string, pointId: string, date: string) {
  const id = Number(pointId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('Некорректный пункт сдачи.');
  const result = await request('/api/marketplace/v3/fbs/supplies/shipping-method', {
    method: 'PATCH', body: JSON.stringify({ data: [{ supplyId, shippingPointId: id, shippingDt: shippingDate(date), shippingType: 'selfShipping' }] }),
  });
  const row = Array.isArray(result.results) ? result.results.find((item: any) => item.supplyId === supplyId) : null;
  if (!row || row.success !== true || row.error) throw new BadRequestException(`WB не сохранил пункт сдачи: ${row?.error?.detail || 'нет подтверждения для поставки'}`);
  const fresh = await request(`/api/v3/supplies/${encodeURIComponent(supplyId)}`);
  if (String(fresh.shippingPointId) !== pointId || fresh.shippingDt !== date || fresh.shippingType !== 'selfShipping') {
    throw new BadRequestException('WB не подтвердил сохранённые параметры. Обновите поставку перед передачей.');
  }
  return fresh;
}
