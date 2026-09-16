import { createHash, randomUUID } from 'node:crypto';
import { wbOrderStockLifecycleEnabled } from '../../common/stock/wb-order-stock-lifecycle';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { runBillingMutation } from './billing-mutation';

// FIX: explicit rollout for our verified client; sold WMS and other clients keep their policy.
export const COMPLETED_WORK_POLICY = 'FBS_COMPLETED_WORK_V1';
export const COMPLETED_WORK_FROM = new Date('2026-08-31T21:00:00Z');
const CLIENT_ID = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
export function completedWorkBillingEnabled(clientId: string): boolean {
  return clientId === CLIENT_ID && process.env.WMS_FBS_COMPLETED_WORK_BILLING_ENABLED === 'true' &&
    process.env.WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED === 'true';
}
type Service = 'processing' | 'primary' | 'additional' | 'relabel';
const codes: Record<Service, string> = { processing: 'FBS_PROCESSING', primary: 'ITEM_PROCESSING',
  additional: 'NOM_ДОПОЛНИТЕЛЬНЫЕ_УСЛУГИ_ПО_УПАКОВКЕ', relabel: 'NOM_ПЕРЕМАРКИРОВКА' };
const names: Record<Service, string> = { processing: 'Обработка заказов по FBS', primary: 'Первичная обработка',
  additional: 'Дополнительные услуги', relabel: 'Перемаркировка' };
export type CompletedWork = {
  billingAttemptId?: string;
  id: string; clientId: string; marketplace: string; connectionId: string; orderId: string; requestId: string | null;
  itemCount: number; completedAt: Date | null; barcode: string | null; boxCode: string | null;
  workerUserId: string | null; deviceCode: string | null; relabelConfirmedAt: Date | null;
};
export type WorkCharge = { id: string; status: string; sourceKey: string | null; metadata: unknown;
  quantity: unknown; totalRub: unknown; unitPriceRub?: unknown; description?: string; requestId?: string | null; serviceDate?: Date;
  serviceId: string | null; invoiceItems: { invoice: { status: string } }[] };
export type WorkConfig = { processingPrice: number; primaryEnabled: boolean; relabelPrice: number;
  serviceIds: Record<Service, string | null> };
type WorkLine = { sourceKey: string; existingChargeId?: string; service: Service; serviceId: string; requestId: string | null; warehouseId: string;
  description: string; quantity: number; unitPriceRub: number; totalRub: number; serviceDate: Date;
  metadata: Prisma.InputJsonObject };
export type WorkPlan = { lines: WorkLine[]; blocked: { orderId: string; service?: Service; reason: string; chargeId?: string }[] };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const key = (work: Pick<CompletedWork, 'marketplace' | 'connectionId' | 'orderId' | 'billingAttemptId'>) =>
  `${work.marketplace}:${work.connectionId}:${work.orderId}${work.billingAttemptId ? `:attempt:${work.billingAttemptId}` : ''}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function chargeIdentity(metadata: Record<string, unknown>): { marketplace: string; connectionId: string; billingAttemptId?: string } | null {
  if (typeof metadata.marketplace === 'string' && typeof metadata.connectionId === 'string') {
    return { marketplace: metadata.marketplace, connectionId: metadata.connectionId,
      ...(typeof metadata.billingAttemptId === 'string' ? { billingAttemptId: metadata.billingAttemptId } : {}) };
  }
  const match = typeof metadata.shipmentKey === 'string' && /^(WILDBERRIES|OZON):([^:]+):/.exec(metadata.shipmentKey);
  return match ? { marketplace: match[1], connectionId: match[2] } : null;
}
function processingIds(metadata: Record<string, unknown>): string[] {
  return strings(Object.hasOwn(metadata, 'processingOrderIds') ? metadata.processingOrderIds : metadata.orderIds);
}
// FIX: a smaller/replaced marketplace snapshot cannot erase already billed work.
export function preserveBilledComposition(metadata: unknown, incomingIds: string[]): boolean {
  const old = strings(record(metadata).orderIds);
  const incoming = new Set(incomingIds);
  return old.some(id => !incoming.has(id));
}
// FIX: credit processing charged in any other shipment, supplement, or consolidated invoice.
export function otherProcessingOrderKeys(charges: WorkCharge[], ownSourceKey: string): Set<string> {
  const result = new Set<string>();
  for (const charge of charges) {
    const metadata = record(charge.metadata);
    if (charge.status === 'CANCELLED' || charge.sourceKey === ownSourceKey || metadata.kind !== 'FBS') continue;
    const identity = chargeIdentity(metadata);
    if (identity) for (const orderId of processingIds(metadata)) result.add(key({ ...identity, orderId }));
  }
  return result;
}

// FIX: stable order/service identity, not current shipment membership. No logistics in this plan.
export function completedWorkPlan(input: { clientId: string; work: CompletedWork[]; charges: WorkCharge[];
  requests: { id: string; warehouseId: string | null }[]; config: WorkConfig }): WorkPlan {
  const plan: WorkPlan = { lines: [], blocked: [] };
  const warehouses = new Map(input.requests.map(r => [r.id, r.warehouseId]));
  const seen = new Set<string>();
  const sourceKeys = new Set(input.charges.map(c => c.sourceKey));
  const coverage = new Map<string, WorkCharge[]>();
  const ambiguous = new Map<string, WorkCharge[]>();
  for (const charge of input.charges) {
    if (charge.status === 'CANCELLED') continue;
    const metadata = record(charge.metadata);
    const service = (Object.keys(codes) as Service[]).find(s => s === 'processing'
      ? metadata.kind === 'FBS' : metadata.kind === 'FBS_PRIMARY_PROCESSING' &&
        (metadata.serviceCode === codes[s] || charge.serviceId === input.config.serviceIds[s]));
    if (!service) continue;
    const ids = service === 'processing' ? processingIds(metadata) : strings(metadata.orderIds);
    const identity = chargeIdentity(metadata);
    // A legacy relabel charge may name the entire shipment, not the relabeled subset.
    // Conservatively treat all listed orders as covered for that service, never charge twice.
    for (const orderId of ids) {
      const destination = identity ? coverage : ambiguous;
      const lookup = `${identity ? key({ ...identity, orderId }) : orderId}:${service}`;
      destination.set(lookup, [...(destination.get(lookup) ?? []), charge]);
    }
    if (!ids.length && !Object.hasOwn(metadata, 'processingOrderIds')) {
      ambiguous.set(`*:${service}`, [...(ambiguous.get(`*:${service}`) ?? []), charge]);
    }
  }
  const orderedWork = [...input.work].sort((a, b) => (a.completedAt?.getTime() ?? Infinity) - (b.completedAt?.getTime() ?? Infinity));
  for (const work of orderedWork) {
    if (work.clientId !== input.clientId) continue;
    if (!work.completedAt || work.completedAt < COMPLETED_WORK_FROM || !work.barcode || !work.boxCode ||
      !(work.workerUserId || work.deviceCode) || !Number.isSafeInteger(work.itemCount) || work.itemCount < 1 ||
      !work.connectionId || !work.marketplace || !work.orderId) {
      plan.blocked.push({ orderId: work.orderId, reason: 'PHYSICAL_WORK_NOT_PROVEN' });
      continue;
    }
    const warehouseId = work.requestId && warehouses.get(work.requestId);
    if (!warehouseId) { plan.blocked.push({ orderId: work.orderId, reason: 'REQUEST_WAREHOUSE_UNKNOWN' }); continue; }
    const services: Service[] = ['processing'];
    if (input.config.primaryEnabled) services.push('primary', 'additional');
    if (input.config.primaryEnabled && work.relabelConfirmedAt) services.push('relabel');
    for (const service of services) {
      const identity = `${key(work)}:${service}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const sourceKey = `fbs-work:${input.clientId}:${digest(identity)}`;
      const existing = coverage.get(identity) ?? [];
      const uncertain = [...(ambiguous.get(`${work.orderId}:${service}`) ?? []), ...(ambiguous.get(`*:${service}`) ?? [])];
      if (uncertain.length) { plan.blocked.push({ orderId: work.orderId, service, reason: 'AMBIGUOUS_BILLING_IDENTITY', chargeId: uncertain[0].id }); continue; }
      if (existing.length) {
        if (!existing.some(c => c.invoiceItems.some(i => i.invoice.status !== 'CANCELLED'))) {
          plan.blocked.push({ orderId: work.orderId, service, reason: 'CHARGE_WITHOUT_ACTIVE_INVOICE', chargeId: existing[0].id });
        }
        continue;
      }
      if (sourceKeys.has(sourceKey)) { plan.blocked.push({ orderId: work.orderId, service, reason: 'RECOVERY_PREVIOUSLY_CANCELLED' }); continue; }
      const serviceId = input.config.serviceIds[service];
      const price = service === 'processing' ? input.config.processingPrice : service === 'primary' ? 10.64 : service === 'additional' ? 4.26 : input.config.relabelPrice;
      if (!serviceId || !Number.isFinite(price) || price <= 0) { plan.blocked.push({ orderId: work.orderId, service, reason: 'SERVICE_TARIFF_MISSING' }); continue; }
      plan.lines.push({ sourceKey, service, serviceId, requestId: work.requestId!, warehouseId,
        description: `${names[service]} — ${work.billingAttemptId ? 'повторная обработка, ' : ''}заказ ${work.orderId}`, quantity: work.itemCount,
        unitPriceRub: money(price), totalRub: money(price * work.itemCount), serviceDate: work.completedAt,
        metadata: { kind: service === 'processing' ? 'FBS' : 'FBS_PRIMARY_PROCESSING', billingPolicy: COMPLETED_WORK_POLICY,
          processingOnly: true, marketplace: work.marketplace, connectionId: work.connectionId, orderIds: [work.orderId],
          processingOrderIds: service === 'processing' ? [work.orderId] : [], requestIds: [work.requestId!],
          shipmentKey: `${key(work)}:completed-work`, quantity: work.itemCount, lineQuantity: work.itemCount,
          serviceCode: codes[service], processingType: service === 'relabel' ? 'RELABEL' : `SERVICE:${serviceId}`,
          assemblyId: work.id, ...(work.billingAttemptId ? { billingAttemptId: work.billingAttemptId } : {}),
          completedAt: work.completedAt.toISOString(), taxMode: 'INCLUDED' } });
    }
  }
  return plan;
}

export async function loadWorkCharges(db: PrismaService, clientId: string): Promise<WorkCharge[]> {
  return db.billingCharge.findMany({ where: { clientId, OR: [
    { sourceKey: { startsWith: 'fbs-calculator:' } }, { sourceKey: { startsWith: 'fbs-primary:' } },
    { sourceKey: { startsWith: 'fbs-work:' } }, { metadata: { path: ['kind'], equals: 'FBS' } },
    { metadata: { path: ['kind'], equals: 'FBS_PRIMARY_PROCESSING' } },
  ] }, include: { invoiceItems: { include: { invoice: { select: { status: true } } } } } });
}

// FIX: preview does no writes (including upserts/audit). Apply joins the shared financial lock.
export async function recoverCompletedWork(db: PrismaService, clientId: string, options: { preview?: boolean } = {}): Promise<WorkPlan> {
  if (!completedWorkBillingEnabled(clientId)) return { lines: [], blocked: [] };
  if (!options.preview) return runBillingMutation(db, tx => recoverCompletedWorkLocked(tx, clientId, true));
  return recoverCompletedWorkLocked(db, clientId, false);
}
async function recoverCompletedWorkLocked(db: PrismaService, clientId: string, apply: boolean): Promise<WorkPlan> {
  const settings = await db.clientFbsBillingSettings.findUnique({ where: { clientId } });
  if (!settings?.fixedPlusLogisticsEnabled || settings.turnkeyEnabled) {
    throw new BadRequestException('Учёт завершённой обработки требует фиксированного тарифа FBS клиента.');
  }
  const services = await db.billingService.findMany({ where: { isActive: true, code: { in: Object.values(codes) } } });
  const tariffs = await db.clientBillingService.findMany({ where: { clientId, isActive: true, service: { code: codes.relabel } }, include: { service: true } });
  const relabel = tariffs[0];
  const config: WorkConfig = { processingPrice: Number(settings.fixedPlusLogisticsUnitPriceRub),
    primaryEnabled: settings.primaryProcessingEnabled,
    relabelPrice: relabel ? Number(relabel.priceRub) / (relabel.taxMode === 'ADD_6_PERCENT' ? 0.94 : 1) : 0,
    serviceIds: Object.fromEntries(Object.entries(codes).map(([name, code]) => [name, services.find(s => s.code === code)?.id ?? null])) as WorkConfig['serviceIds'] };
  // FIX: WB work comes from frozen shipment facts; never load historical labels/box catalogues here.
  const work: CompletedWork[] = await db.fbsTsdAssembly.findMany({ where: { clientId, completedAt: { gte: COMPLETED_WORK_FROM },
    ...(wbOrderStockLifecycleEnabled() ? { marketplace: { not: 'WILDBERRIES' as const } } : {}) },
    select: { id: true, clientId: true, marketplace: true, connectionId: true, orderId: true, requestId: true,
      itemCount: true, completedAt: true, barcode: true, boxCode: true, workerUserId: true, deviceCode: true, relabelConfirmedAt: true } });
  // FIX: picking is not shipment; only immutable local WB shipment facts trigger new charges.
  const shipments = wbOrderStockLifecycleEnabled();
  // Archived successful attempts are proof too; transfer/reset of the current task cannot erase them.
  const history = db.fbsAssemblyAttemptHistory ? await db.fbsAssemblyAttemptHistory.findMany({ where: { clientId, completedAt: { gte: COMPLETED_WORK_FROM } } }) : [];
  for (const attempt of history) {
    const snapshot = record(attempt.taskSnapshot);
    if (typeof snapshot.marketplace !== 'string' || typeof snapshot.connectionId !== 'string') continue;
    work.push({ id: attempt.id, clientId, marketplace: snapshot.marketplace, connectionId: snapshot.connectionId,
      orderId: attempt.orderId, requestId: attempt.requestId, itemCount: Number(snapshot.itemCount), completedAt: attempt.completedAt,
      workerUserId: attempt.workerUserId, deviceCode: typeof snapshot.deviceCode === 'string' ? snapshot.deviceCode : null,
      barcode: typeof snapshot.barcode === 'string' ? snapshot.barcode : null, boxCode: typeof snapshot.boxCode === 'string' ? snapshot.boxCode : null,
      relabelConfirmedAt: typeof snapshot.relabelConfirmedAt === 'string' ? new Date(snapshot.relabelConfirmedAt) : null });
  }
  if (shipments) {
    // FIX: later reassignment/reset cannot alter the identity, quantity or work date already shipped.
    for (let index = work.length - 1; index >= 0; index -= 1) {
      if (work[index].marketplace === 'WILDBERRIES') work.splice(index, 1);
    }
    // FIX: only billing evidence is needed; do not reload complete order snapshots.
    for (let skip = 0; ; skip += 1000) {
      // FIX: importing a historical shipment is not authorization to reprice its old work.
      const page = await db.wbOrderShipment.findMany({ where: { clientId, source: { not: 'LEGACY_WMS_SHIPMENT' } }, skip, take: 1000, orderBy: { id: 'asc' },
        select: { assemblyId: true, connectionId: true, orderId: true, requestId: true, quantity: true, shippedAt: true, assemblySnapshot: true } });
      for (const fact of page) {
      const snapshot = record(fact.assemblySnapshot);
      work.push({ id: fact.assemblyId, clientId, marketplace: 'WILDBERRIES', connectionId: fact.connectionId,
        ...(typeof snapshot.billingAttemptId === 'string' ? { billingAttemptId: snapshot.billingAttemptId } : {}),
        orderId: fact.orderId, completedAt: fact.shippedAt, requestId: fact.requestId, itemCount: fact.quantity,
        barcode: typeof snapshot.barcode === 'string' ? snapshot.barcode : null,
        boxCode: typeof snapshot.boxCode === 'string' ? snapshot.boxCode : null,
        workerUserId: typeof snapshot.workerUserId === 'string' ? snapshot.workerUserId : null,
        deviceCode: typeof snapshot.deviceCode === 'string' ? snapshot.deviceCode : null,
        relabelConfirmedAt: typeof snapshot.relabelConfirmedAt === 'string' ? new Date(snapshot.relabelConfirmedAt) : null });
      }
      if (page.length < 1000) break;
    }
  }
  const charges = await loadWorkCharges(db, clientId);
  const workKeys = new Set(work.map(key));
  const orphanCandidates = charges.filter(c => {
    const identity = chargeIdentity(record(c.metadata));
    return c.status === 'DRAFT' && c.invoiceItems.length === 0 && identity &&
      strings(record(c.metadata).orderIds).some(orderId => workKeys.has(key({ ...identity, orderId })));
  });
  const orphanOrderIds = [...new Set(orphanCandidates.flatMap(c => strings(record(c.metadata).orderIds)))];
  const links = orphanOrderIds.length && db.fbsOrderRequestLink
    ? await db.fbsOrderRequestLink.findMany({ where: { clientId, orderId: { in: orphanOrderIds } },
      select: { orderId: true, connectionId: true, marketplace: true, requestId: true } }) : [];
  const requestIds = [...new Set([...work.flatMap(w => w.requestId ? [w.requestId] : []),
    ...orphanCandidates.flatMap(c => [c.requestId ?? '', ...strings(record(c.metadata).requestIds)]), ...links.map(l => l.requestId)].filter(Boolean))];
  const requests = await db.clientRequest.findMany({ where: { clientId, id: { in: requestIds } }, select: { id: true, warehouseId: true } });
  const plan = completedWorkPlan({ clientId, config, work, requests, charges });
  const attached = new Set<string>();
  const warehouseByRequest = new Map(requests.map(r => [r.id, r.warehouseId]));
  for (const chargeId of new Set(plan.blocked.filter(b => b.reason === 'CHARGE_WITHOUT_ACTIVE_INVOICE').map(b => b.chargeId))) {
    const charge = orphanCandidates.find(c => c.id === chargeId);
    if (!charge?.sourceKey || !charge.serviceId || !charge.serviceDate || !Number.isFinite(charge.serviceDate.getTime()) ||
      !Number.isFinite(Number(charge.unitPriceRub)) || Number(charge.totalRub) <= 0 || Number(charge.quantity) <= 0) continue;
    const metadata = record(charge.metadata);
    const identity = chargeIdentity(metadata)!;
    const explicitRequests = [...new Set([charge.requestId ?? '', ...strings(metadata.requestIds)].filter(Boolean))];
    const orderLinks = strings(metadata.orderIds).map(orderId => links.filter(link => key(link) === key({ ...identity, orderId })));
    // No branch guesses for an orphan spanning accounts/branches or having incomplete links.
    if (!explicitRequests.length && orderLinks.some(matches => matches.length === 0)) continue;
    const candidateRequests = explicitRequests.length ? explicitRequests : [...new Set(orderLinks.flatMap(matches => matches.map(l => l.requestId)))];
    const warehouses = candidateRequests.map(id => warehouseByRequest.get(id));
    if (!warehouses.length || warehouses.some(id => !id) || new Set(warehouses).size !== 1) continue;
    const service = plan.blocked.find(b => b.chargeId === chargeId)?.service;
    if (!service) continue;
    plan.lines.push({ existingChargeId: charge.id, sourceKey: charge.sourceKey, service, serviceId: charge.serviceId,
      requestId: candidateRequests.length === 1 ? candidateRequests[0] : null, warehouseId: warehouses[0]!,
      description: charge.description ?? names[service], quantity: Number(charge.quantity), unitPriceRub: Number(charge.unitPriceRub),
      totalRub: Number(charge.totalRub), serviceDate: charge.serviceDate, metadata: metadata as Prisma.InputJsonObject });
    attached.add(charge.id);
  }
  plan.blocked = plan.blocked.filter(b => !b.chargeId || !attached.has(b.chargeId));
  if (!apply || !plan.lines.length) return plan;
  const groups = new Map<string, WorkLine[]>();
  for (const line of plan.lines) {
    const day = new Date(line.serviceDate.getTime() + 3 * 3600000).toISOString().slice(0, 10);
    const group = `${line.warehouseId}:${line.requestId}:${day}:${line.metadata.billingAttemptId ? 'repeat' : 'first'}`;
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  const invoices: Prisma.BillingInvoiceCreateManyInput[] = [];
  const newCharges: Prisma.BillingChargeCreateManyInput[] = [];
  const items: Prisma.BillingInvoiceItemCreateManyInput[] = [];
  for (const lines of groups.values()) {
    const invoiceId = randomUUID();
    const fingerprint = digest(lines.map(l => l.sourceKey).sort().join('|'));
    const prefix = lines.some(l => l.service === 'processing') ? 'fbs-invoice' : 'fbs-primary-invoice';
    const dates = lines.map(l => l.serviceDate.getTime());
    invoices.push({ id: invoiceId, number: `FBS-WORK-${fingerprint.slice(0, 24).toUpperCase()}`, clientId,
      source: 'MANUAL', sourceKey: `${prefix}:${clientId}:completed-work:${fingerprint}`, status: 'DRAFT',
      requestId: lines[0].requestId, warehouseId: lines[0].warehouseId, periodFrom: new Date(Math.min(...dates)),
      periodTo: new Date(Math.max(...dates)), totalRub: money(lines.reduce((sum, l) => sum + l.totalRub, 0)),
      comment: lines.some(l => l.existingChargeId)
        ? 'Прикрепление ранее не выставленных начислений FBS. Их суммы и даты сохранены. Новая логистика не начислена.'
        : 'Доначисление подтверждённой обработки FBS. Без логистики. Ранее выставленные счета сохранены.' });
    for (const line of lines) {
      const id = line.existingChargeId ?? randomUUID();
      const common = { description: line.description, quantity: line.quantity, unit: 'PIECE' as const,
        unitPriceRub: line.unitPriceRub, totalRub: line.totalRub, serviceDate: line.serviceDate };
      if (!line.existingChargeId) newCharges.push({ ...common, id, clientId, serviceId: line.serviceId, requestId: line.requestId,
        status: 'DRAFT', source: 'MANUAL', sourceKey: line.sourceKey, metadata: line.metadata });
      items.push({ ...common, invoiceId, chargeId: id });
    }
  }
  // Bounded SQL batches; unique source keys are a second guard behind the transaction lock.
  for (let i = 0; i < newCharges.length; i += 500) await db.billingCharge.createMany({ data: newCharges.slice(i, i + 500) });
  for (let i = 0; i < invoices.length; i += 500) await db.billingInvoice.createMany({ data: invoices.slice(i, i + 500) });
  for (let i = 0; i < items.length; i += 500) await db.billingInvoiceItem.createMany({ data: items.slice(i, i + 500) });
  await db.auditLog.create({ data: { action: 'billing.completed-fbs-work-recovered', entity: 'Client', entityId: clientId,
    payload: { policy: COMPLETED_WORK_POLICY, invoices: invoices.map(i => i.id!), chargeCount: newCharges.length,
      attachedChargeIds: [...attached],
      orderCount: new Set(plan.lines.flatMap(l => strings(l.metadata.orderIds).map(orderId => `${l.metadata.marketplace}:${l.metadata.connectionId}:${orderId}`))).size,
      totalRub: money(plan.lines.reduce((sum, l) => sum + l.totalRub, 0)), blockedCount: plan.blocked.length } } });
  return plan;
}
