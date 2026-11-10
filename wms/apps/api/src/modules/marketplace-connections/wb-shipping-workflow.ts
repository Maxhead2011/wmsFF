import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { availableShippingPoint, saveShippingMethod, shippingDate, shippingPoints, wbShippingEnabled, WbRequest } from './wb-shipping-points';

const PENDING = 'WB_CARGO_CREATE_PENDING';
const RESOLVED = 'WB_CARGO_CREATE_CONFIRMED';
const cargoIds = (value: any): string[] => {
  if (!Array.isArray(value?.trbxes) || value.trbxes.some((item: any) => !item?.id)) throw new BadRequestException('WB не подтвердил список грузомест. Создание остановлено.');
  const ids = value.trbxes.map((item: any) => String(item.id));
  if (new Set(ids).size !== ids.length) throw new BadRequestException('WB вернул повторяющиеся грузоместа. Нужна сверка.');
  return ids;
};

export async function withWbShippingLock<T>(host: any, connectionId: string, supplyId: string, operation: () => Promise<T>): Promise<T> {
  if (!wbShippingEnabled()) return operation();
  return host.prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`wb-shipping:${connectionId}:${supplyId}`}))`);
    return operation();
  }, { timeout: 60000, maxWait: 5000 });
}

export async function assertShippingBeforeDelivery(host: any, planId: string | undefined, supplyId: string, date: string, request: WbRequest) {
  if (!wbShippingEnabled()) return;
  const saved = planId ? await host.prisma.auditLog.findFirst({ where: { entity: 'FbsSupplyPlan', entityId: planId, action: 'WB_SHIPPING_POINT_SAVED' }, orderBy: { createdAt: 'desc' } }) : null;
  if (!saved?.payload?.city) throw new BadRequestException('Сначала сохраните пункт сдачи и дату в настройках поставки.');
  const current = await request(`/api/v3/supplies/${encodeURIComponent(supplyId)}`);
  if (current.done || current.scanDt || current.shippingDt !== date || current.shippingType !== 'selfShipping' || String(current.shippingPointId) !== saved.payload.shippingPointId) {
    throw new BadRequestException('Параметры сдачи WB изменились. Обновите окно и сохраните пункт сдачи повторно.');
  }
  const point = availableShippingPoint(await shippingPoints(request, supplyId, saved.payload.city, date), String(current.shippingPointId));
  if (['pp', 'pfc', 'gpp'].includes(point.officeType)) {
    const plan = await host.prisma.fbsSupplyPlan.findUnique({ where: { id: planId } });
    const ids = cargoIds(await request(`/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`));
    const localIds: string[] = Array.isArray(plan?.cargoPlaceIds) ? plan.cargoPlaceIds : [];
    if (!ids.length || ids.length !== localIds.length || ids.some((id) => !localIds.includes(id))) throw new BadRequestException('Грузоместа WB и WMS не совпадают. Сверьте их перед передачей.');
    const closed = await host.prisma.fbsCargoPlacePacking.findMany({ where: { clientId: plan.clientId, connectionId: plan.connectionId, supplyId, cargoPlaceId: { in: ids }, status: 'CLOSED' }, select: { id: true, cargoPlaceId: true } });
    if (ids.some((id) => !closed.some((row: any) => row.cargoPlaceId === id))) throw new BadRequestException('Закройте все грузоместа на ТСД перед передачей.');
    const wbOrders = await request(`/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/order-ids`);
    if (!Array.isArray(wbOrders.orderIds) || !wbOrders.orderIds.length) throw new BadRequestException('WB не подтвердил состав поставки.');
    const packed = await host.prisma.fbsTsdAssembly.findMany({ where: { clientId: plan.clientId, connectionId: plan.connectionId, supplyId, status: 'COMPLETED', cargoPackingId: { in: closed.map((row: any) => row.id) } }, select: { orderId: true } });
    if (wbOrders.orderIds.some((id: unknown) => !packed.some((row: any) => row.orderId === String(id)))) throw new BadRequestException('Не все заказы WB распределены по грузоместам.');
  }
}

// FIX: authorization and selected-order resolution remain in the owning service.
// No stock/billing writes. Unknown cargo POST outcome is never blindly retried.
export async function wbShippingWorkflow(host: any, dto: any, user: any, mode: 'points' | 'save' | 'cargo', json: (url: string, init: RequestInit) => Promise<any>) {
  if (!wbShippingEnabled()) throw new BadRequestException('Настройка пункта сдачи отключена.');
  host.clientScopes.requireClientAccess(user, dto.clientId, 'write');
  // FIX: no full-client refresh for each point/cargo operation.
  const orders = await host.resolveFbsShippingOrders(dto.clientId, dto.orders);
  if (!orders.length || orders.some((o: any) => o.marketplace !== 'WILDBERRIES' || o.supplierStatus !== 'confirm' || !o.supplyId)) {
    throw new BadRequestException('Выберите открытую поставку WB на сборке.');
  }
  const first = orders[0];
  if (orders.some((o: any) => o.connectionId !== first.connectionId || o.supplyId !== first.supplyId)) {
    throw new BadRequestException('Настраивайте каждую поставку отдельно.');
  }
  const connections = await host.loadSelectedConnections(dto.clientId, orders);
  const connection = connections.find((c: any) => c.id === first.connectionId);
  if (!connection) throw new BadRequestException('Подключение WB не найдено.');
  const request: WbRequest = (path, init = {}) => json(`https://marketplace-api.wildberries.ru${path}`, {
    ...init, method: init.method ?? 'GET', headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json' },
  });
  const supplyId = first.supplyId as string;
  const path = `/api/v3/supplies/${encodeURIComponent(supplyId)}`;
  const date = shippingDate(dto.plannedDeliveryDate);
  if (mode === 'points') return { points: await shippingPoints(request, supplyId, dto.shippingCity, date) };
  // Serialize configuration/cargo changes across API instances, not just one browser.
  return withWbShippingLock(host, first.connectionId, supplyId, async () => {
    const details = await request(path);
    if (details.done || details.scanDt) throw new BadRequestException('Поставка уже закрыта или принята WB.');
    const plan = await host.prisma.fbsSupplyPlan.findFirst({ where: { clientId: dto.clientId, connectionId: first.connectionId, supplyId, marketplace: 'WILDBERRIES' } });
    if (!plan) throw new BadRequestException('План поставки WMS не найден. Обновите заявки.');
    const points = await shippingPoints(request, supplyId, dto.shippingCity, date);
    const point = availableShippingPoint(points, mode === 'cargo' ? String(details.shippingPointId ?? '') : String(dto.shippingPointId ?? ''));
    const pickup = ['pp', 'pfc', 'gpp'].includes(point.officeType);
    if (mode === 'save') {
      if (!pickup && Array.isArray(plan.cargoPlaceIds) && plan.cargoPlaceIds.length) {
        throw new BadRequestException('В поставке есть грузоместа. Для смены на склад используйте отдельное изменение направления.');
      }
      await saveShippingMethod(request, supplyId, point.id, date);
      await host.prisma.fbsSupplyPlan.update({ where: { id: plan.id }, data: {
        deliveryDestination: pickup ? 'PICKUP_POINT' : 'VNUKOVO_SORTING_CENTER', plannedDeliveryDate: new Date(`${date}T00:00:00Z`),
      } });
      await host.prisma.auditLog.create({ data: { userId: user.id, action: 'WB_SHIPPING_POINT_SAVED', entity: 'FbsSupplyPlan', entityId: plan.id,
        payload: { supplyId, shippingPointId: point.id, address: point.address, city: dto.shippingCity, shippingDt: date, shippingType: 'selfShipping' } } });
      return { saved: true, point, shippingDt: date };
    }
    if (!pickup || details.shippingDt !== date) throw new BadRequestException('Сначала сохраните ПВЗ и дату отгрузки в WB.');
    const target = Number(dto.cargoPlaceTotal);
    const orderIds = await request(`/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/order-ids`);
    if (!Array.isArray(orderIds.orderIds)) throw new BadRequestException('WB не подтвердил состав поставки.');
    if (!Number.isInteger(target) || target < 1 || target > Math.floor(orderIds.orderIds.length / 2)) {
      throw new BadRequestException(`Для ${orderIds.orderIds.length} заказов WB разрешает не больше ${Math.floor(orderIds.orderIds.length / 2)} грузомест.`);
    }
    let ids = cargoIds(await request(`${path}/trbx`));
    const pending = await host.prisma.auditLog.findFirst({ where: { entity: 'FbsSupplyPlan', entityId: plan.id, action: PENDING }, orderBy: { createdAt: 'desc' } });
    const confirmed = pending ? await host.prisma.auditLog.findFirst({ where: { entity: 'FbsSupplyPlan', entityId: plan.id, action: RESOLVED, createdAt: { gte: pending.createdAt } } }) : null;
    if (pending && !confirmed && ids.length < Number(pending.payload?.target)) {
      throw new BadRequestException('Результат предыдущего добавления грузомест не подтверждён. Повторное создание остановлено до сверки WB.');
    }
    if (target < ids.length) throw new BadRequestException('Удаление грузомест здесь недоступно. Укажите текущее или большее количество.');
    if (target > ids.length) {
      await host.prisma.auditLog.create({ data: { userId: user.id, action: PENDING, entity: 'FbsSupplyPlan', entityId: plan.id, payload: { target, previousIds: ids, supplyId } } });
      // A durable marker survives timeouts/restarts; retry starts with WB reconciliation.
      await request(`${path}/trbx`, { method: 'POST', body: JSON.stringify({ amount: target - ids.length }) });
      ids = cargoIds(await request(`${path}/trbx`));
      if (ids.length !== target) throw new BadRequestException('WB не подтвердил итоговое количество грузомест. Повторное создание заблокировано до сверки.');
    }
    await host.prisma.fbsSupplyPlan.update({ where: { id: plan.id }, data: { cargoPlaceCount: ids.length, cargoPlaceIds: ids, deliveryDestination: 'PICKUP_POINT' } });
    await host.prisma.auditLog.create({ data: { userId: user.id, action: RESOLVED, entity: 'FbsSupplyPlan', entityId: plan.id, payload: { supplyId, cargoPlaceIds: ids } } });
    return { saved: true, cargoPlaceIds: ids };
  });
}
