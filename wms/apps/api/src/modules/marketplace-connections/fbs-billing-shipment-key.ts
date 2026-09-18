import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { wbOrderStockLifecycleEnabled } from '../../common/stock/wb-order-stock-lifecycle';

type Order = {
  id: string; supplyId?: string | null; deliveryDate?: string | null;
  sellerDate?: string | null; createdAt?: string | null;
  request?: { warehouseId?: string | null } | null;
  reservation?: { warehouseId?: string | null } | null;
};
const isDateGroup = (order: Order) => !order.supplyId?.trim() &&
  Boolean(order.deliveryDate || order.sellerDate || order.createdAt);

// FIX: opt-in only; legacy order/service credits must remain enabled during rollout.
export async function loadFbsDateBillingBranches<T extends Order>(
  db: PrismaService, clientId: string, orders: T[], legacyKey: (order: T) => string,
): Promise<Map<string, string> | undefined> {
  if (process.env.WMS_FBS_DATE_BRANCH_BILLING_ENABLED !== 'true' || !wbOrderStockLifecycleEnabled()) return undefined;
  const keys = [...new Set(orders.filter(isDateGroup).map(order => legacyKey(order)))];
  const branches = new Map<string, string>();
  if (!keys.length) return branches;
  const invoiceKeys = new Map(keys.flatMap(key => [
    [`fbs-invoice:${clientId}:${key}`, key], [`fbs-primary-invoice:${clientId}:${key}`, key],
  ] as [string, string][]));
  const chargeKeys = new Map(keys.map(key => [`fbs-calculator:${clientId}:${key}`, key]));
  const primaryPrefixes = keys.map(key => ({ key, prefix: `fbs-primary:${clientId}:${key}:` }));
  const [invoices, charges] = await Promise.all([
    db.billingInvoice.findMany({ where: { clientId, sourceKey: { in: [...invoiceKeys.keys()] } },
      select: { sourceKey: true, warehouseId: true } }),
    db.billingCharge.findMany({ where: { clientId, OR: [
      { sourceKey: { in: [...chargeKeys.keys()] } },
      ...primaryPrefixes.map(p => ({ sourceKey: { startsWith: p.prefix } })),
    ] }, select: { sourceKey: true, metadata: true, request: { select: { warehouseId: true } },
      invoiceItems: { select: { invoice: { select: { warehouseId: true } } } } } }),
  ]);
  // FIX: old grouped charges stored several request IDs in their immutable FBS snapshot.
  // Resolve every saved request within the same client; partial evidence must not choose a branch.
  const savedRequestIds = (metadata: unknown): string[] => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
    const value = metadata as { kind?: unknown; requestIds?: unknown };
    if (value.kind !== 'FBS' || !Array.isArray(value.requestIds) ||
      !value.requestIds.length || value.requestIds.some(id => typeof id !== 'string' || !id.trim())) return [];
    return [...new Set(value.requestIds as string[])];
  };
  const fallbackCharges = charges.filter(charge => !charge.request?.warehouseId &&
    !charge.invoiceItems.some(item => item.invoice.warehouseId));
  const requestIds = [...new Set(fallbackCharges.flatMap(charge => savedRequestIds(charge.metadata)))];
  const requests = requestIds.length ? await db.clientRequest.findMany({
    where: { clientId, id: { in: requestIds } }, select: { id: true, warehouseId: true },
  }) : [];
  const requestBranches = new Map(requests.map(request => [request.id, request.warehouseId]));
  const incomplete = new Set<string>();
  const evidence = new Map<string, Set<string>>();
  const add = (key: string | undefined, ids: (string | null | undefined)[]) => {
    if (!key) return;
    const found = evidence.get(key) ?? new Set<string>();
    for (const id of ids) if (id?.trim()) found.add(id.trim());
    evidence.set(key, found);
  };
  for (const invoice of invoices) add(invoiceKeys.get(invoice.sourceKey ?? ''), [invoice.warehouseId]);
  for (const charge of charges) {
    const key = chargeKeys.get(charge.sourceKey ?? '') ??
      primaryPrefixes.find(p => charge.sourceKey?.startsWith(p.prefix) &&
        /^(SERVICE:.+|WHITE|GRAY|RETURN|RELABEL)$/.test(charge.sourceKey.slice(p.prefix.length)))?.key;
    add(key, [charge.request?.warehouseId, ...charge.invoiceItems.map(i => i.invoice.warehouseId)]);
    if (key && fallbackCharges.includes(charge)) {
      const saved = savedRequestIds(charge.metadata);
      if (saved.length) {
        if (saved.some(id => !requestBranches.get(id)?.trim())) incomplete.add(key);
        add(key, saved.map(id => requestBranches.get(id)));
      }
    }
  }
  // FIX: even cancelled/merged documents retain their keys; never guess a branch for old money.
  for (const [key, ids] of evidence) {
    if (ids.size !== 1 || incomplete.has(key)) throw new BadRequestException(
      `Не удалось однозначно определить филиал старого начисления FBS (${key}). Требуется проверка счёта; повторное начисление не выполнено.`,
    );
    branches.set(key, [...ids][0]);
  }
  return branches;
}

// FIX: date is not a supply identity. Keep the legacy key only for its proven original branch.
export function branchScopedFbsDateKey(legacyKey: string, order: Order, branches?: ReadonlyMap<string, string>) {
  if (!branches || !isDateGroup(order)) return legacyKey;
  const warehouseId = order.request?.warehouseId?.trim() || order.reservation?.warehouseId?.trim();
  const oldBranch = branches.get(legacyKey);
  if (!warehouseId) {
    if (oldBranch) throw new BadRequestException('Не определён филиал заказа для существующего счёта FBS. Повторное начисление не выполнено.');
    return legacyKey;
  }
  return oldBranch === warehouseId ? legacyKey : `${legacyKey}:warehouse:${warehouseId}`;
}
