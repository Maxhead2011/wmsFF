import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { BillingSettlementsService } from './billing-settlements.service';
import { runBillingMutation } from './billing-mutation';
import { buildPeriodClosePlan } from './billing-period-close.policy';
import { parseBillingPeriod } from './billing-period-policy';
import { billingMinor, correctedInvoiceBalance, invoiceCorrections } from './billing-correction-balance';
import { BillingCloseQuery, CloseBillingPeriodDto, CreateInvoiceCorrectionDto, PreviewInvoiceCorrectionDto } from './dto/billing-period-close.dto';
type CloseRecord = { id: string; clientId: string; warehouseId: string; periodFrom: Date; periodTo: Date; invoiceIds: string[]; snapshot: unknown; reason: string; previewHash: string; createdAt: Date; createdByUserId: string };
// FIX: close and amendments are opt-in, scoped, previewed and serialized with all cooperating financial writers.
@Injectable()
export class BillingPeriodCloseService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly settlements: BillingSettlementsService) {}
  capabilities() { return { enabled: process.env.WMS_BILLING_PERIOD_CLOSE_ENABLED === 'true' && process.env.WMS_BILLING_SETTLEMENTS_ENABLED === 'true' }; }
  private scope(clientId: string, user: AuthUser, write: boolean) {
    if (!this.capabilities().enabled) throw new BadRequestException('Закрытие периодов пока не включено.');
    if (!user.permissionCodes.includes('system:admin') && !user.permissionCodes.includes(write ? 'billing:write' : 'billing:read')) throw new ForbiddenException('Нет доступа к расчётам.');
    this.scopes.requireClientAccess(user, clientId, write ? 'write' : 'read');
    const warehouse = user.activeWarehouseId;
    if (!warehouse || (!user.permissionCodes.includes('system:admin') && !(write ? user.writableWarehouseIds : user.warehouseIds)?.includes(warehouse)))
      throw new ForbiddenException('Выберите доступный филиал.');
    return warehouse;
  }
  private async closes(db: Prisma.TransactionClient, clientId: string, warehouseId: string, from: Date, to: Date) {
    return db.$queryRaw<CloseRecord[]>`SELECT * FROM "BillingPeriodClose" WHERE "clientId"=${clientId} AND "warehouseId"=${warehouseId} AND "periodFrom"<=${to} AND "periodTo">=${from} ORDER BY "periodFrom", "id"`;
  }
  private async checkClient(db: Prisma.TransactionClient, clientId: string, user: AuthUser) {
    const client = await db.client.findUnique({ where: { id: clientId }, select: { isDemo: true } });
    if (!client || client.isDemo !== (user.isDemo === true)) throw new ForbiddenException('Клиент недоступен в выбранном окружении.');
  }
  async list(query: BillingCloseQuery, user: AuthUser) {
    const warehouseId = this.scope(query.clientId, user, false), { from, to } = parseBillingPeriod(query.periodFrom, query.periodTo);
    return this.prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await this.checkClient(tx, query.clientId, user); return this.closes(tx, query.clientId, warehouseId, from, to); });
  }
  async preview(query: BillingCloseQuery, user: AuthUser) {
    const warehouseId = this.scope(query.clientId, user, true);
    return this.prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return this.plan(tx, query, warehouseId, user); }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  }
  async correctionHistory(query: BillingCloseQuery, user: AuthUser) {
    const warehouseId = this.scope(query.clientId, user, false);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return tx.$queryRaw`SELECT c."id",c."amountRub",c."kind",c."reason",c."createdAt",i."number" AS "invoiceNumber",u."name" AS "author"
        FROM "BillingInvoiceCorrection" c JOIN "BillingInvoice" i ON i.id=c."invoiceId" JOIN "User" u ON u.id=c."createdByUserId"
        JOIN "Client" client ON client.id=i."clientId" LEFT JOIN "ClientRequest" r ON r.id=i."requestId"
        WHERE i."clientId"=${query.clientId} AND COALESCE(i."warehouseId",r."warehouseId")=${warehouseId} AND client."isDemo"=${user.isDemo === true}
        ORDER BY c."createdAt" DESC,c.id DESC LIMIT 2000`;
    });
  }
  private async plan(tx: Prisma.TransactionClient, query: BillingCloseQuery, warehouseId: string, user: AuthUser) {
    await this.checkClient(tx, query.clientId, user);
    const { from, to } = parseBillingPeriod(query.periodFrom, query.periodTo);
    if (query.periodTo > new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })) throw new BadRequestException('Нельзя закрыть будущий период.');
    const [report, charges, invoices, previous] = await Promise.all([
      this.settlements.list(query, user, tx),
      tx.billingCharge.findMany({ where: { clientId: query.clientId, status: { not: 'CANCELLED' }, serviceDate: { gte: from, lte: to } }, take: 100001,
        include: { client: true, request: { select: { warehouseId: true } }, invoiceItems: { include: { invoice: { select: { id: true, status: true } } } } } }),
      tx.billingInvoice.findMany({ where: { clientId: query.clientId, status: { not: 'CANCELLED' },
        OR: [{ periodFrom: { lte: to }, periodTo: { gte: from } }, { items: { some: { serviceDate: { gte: from, lte: to } } } }] }, take: 20001,
        include: { client: true, payments: true, request: { select: { warehouseId: true } }, items: true } }),
      this.closes(tx, query.clientId, warehouseId, from, to),
    ]);
    if (!report.enabled || charges.length > 100000 || invoices.length > 20000) throw new BadRequestException('Не удалось получить полный расчёт периода.');
    const issues = report.issues.filter(i => i.clientId === query.clientId && (!i.warehouseId || i.warehouseId === warehouseId))
      .map(i => ({ sourceId: i.line.id, code: i.code, reason: i.reason }));
    if (previous.length) issues.push({ sourceId: previous[0].id, code: 'ALREADY_CLOSED', reason: 'Период пересекается с уже закрытым.' });
    return buildPeriodClosePlan({ clientId: query.clientId, periodFrom: query.periodFrom, periodTo: query.periodTo, warehouseId }, charges, invoices, issues);
  }
  async close(dto: CloseBillingPeriodDto, user: AuthUser) {
    const warehouseId = this.scope(dto.clientId, user, true), reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Укажите основание закрытия.');
    const { from, to } = parseBillingPeriod(dto.periodFrom, dto.periodTo);
    return runBillingMutation(this.prisma, async db => {
      await this.checkClient(db, dto.clientId, user);
      const previous = await this.closes(db, dto.clientId, warehouseId, from, to);
      const exact = previous.find(p => p.periodFrom.getTime() === from.getTime() && p.periodTo.getTime() === to.getTime());
      if (exact) { if (exact.previewHash !== dto.previewHash) throw new ConflictException('Этот период уже закрыт по другому расчёту.'); return { period: exact, replayed: true }; }
      const initial = await this.plan(db, dto, warehouseId, user), ids = initial.snapshots.map(i => i.id).sort();
      if (ids.length) {
        await db.$queryRaw`SELECT id FROM "BillingInvoice" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        // FIX: parent locks serialize line triggers; locking child rows here would invert an in-flight UPDATE lock order.
      }
      const current = await this.plan(db, dto, warehouseId, user);
      if (!current.canClose) throw new ConflictException('Есть незавершённые расчёты. Сначала устраните причины в предварительной проверке.');
      if (current.previewHash !== dto.previewHash) throw new ConflictException('Расчёт изменился. Повторите предварительную проверку.');
      const id = randomUUID(), snapshot = JSON.stringify(current.snapshots), invoiceIds = current.snapshots.map(i => i.id);
      const array = invoiceIds.length ? Prisma.sql`ARRAY[${Prisma.join(invoiceIds)}]::text[]` : Prisma.sql`ARRAY[]::text[]`;
      const periods = await db.$queryRaw<CloseRecord[]>(Prisma.sql`INSERT INTO "BillingPeriodClose" ("id","clientId","warehouseId","periodFrom","periodTo","invoiceIds","snapshot","previewHash","reason","createdByUserId") VALUES (${id},${dto.clientId},${warehouseId},${from},${to},${array},${snapshot}::jsonb,${dto.previewHash},${reason},${user.id}) RETURNING *`);
      await db.auditLog.create({ data: { userId: user.id, action: 'billing.period.close', entity: 'BillingPeriodClose', entityId: id,
        payload: { clientId: dto.clientId, warehouseId, periodFrom: dto.periodFrom, periodTo: dto.periodTo, previewHash: dto.previewHash, invoiceIds, reason } } });
      return { period: periods[0], replayed: false };
    });
  }
  private async correctionPlan(db: Prisma.TransactionClient, dto: PreviewInvoiceCorrectionDto, user: AuthUser) {
    const invoice = await db.billingInvoice.findUnique({ where: { id: dto.invoiceId }, include: { client: true, request: { select: { warehouseId: true } }, payments: { where: { status: 'RECORDED' } } } });
    if (!invoice) throw new NotFoundException('Счёт не найден.');
    const warehouseId = this.scope(invoice.clientId, user, true);
    if ((invoice.warehouseId ?? invoice.request?.warehouseId) !== warehouseId || invoice.client.isDemo !== (user.isDemo === true)) throw new ForbiddenException('Счёт недоступен в выбранном филиале.');
    const kind = dto.kind ?? 'ADJUSTMENT', delta = billingMinor(dto.amountRub), reason = dto.reason.trim();
    if (Math.abs(delta) > 99999999999999) throw new BadRequestException('Сумма корректировки превышает предел документа.');
    if (!reason || reason.length > 1000) throw new BadRequestException('Укажите причину корректировки.');
    if (kind === 'ADJUSTMENT' ? delta === 0 || !['ISSUED', 'PAID'].includes(invoice.status) : delta !== 0 || invoice.status !== 'DRAFT')
      throw new BadRequestException('Корректируется выставленный счёт; поздний черновик оформляется как отдельная работа.');
    if (kind === 'LATE_WORK') {
      const closed = await this.closes(db, invoice.clientId, warehouseId, invoice.periodFrom, invoice.periodTo);
      if (!closed.length || closed.some(p => p.invoiceIds.includes(invoice.id))) throw new BadRequestException('Этот черновик не является отдельной поздней работой за закрытый период.');
      if (billingMinor(invoice.totalRub) <= 0) throw new BadRequestException('Нельзя выставить поздний счёт с нулевой суммой.');
    }
    const corrections = await invoiceCorrections(db, [invoice.id]);
    if (invoice.payments.reduce((s, p) => s + billingMinor(p.amountRub), 0) !== billingMinor(invoice.paidRub))
      throw new ConflictException('Оплаченная сумма не подтверждается приходами. Сначала выполните сверку.');
    const before = correctedInvoiceBalance(invoice.totalRub, invoice.paidRub, corrections.map(c => c.amountRub));
    const after = correctedInvoiceBalance(invoice.totalRub, invoice.paidRub, [...corrections.map(c => c.amountRub), dto.amountRub]);
    const previewHash = createHash('sha256').update(JSON.stringify({ invoiceId: invoice.id, warehouseId, status: invoice.status,
      total: String(invoice.totalRub), paid: String(invoice.paidRub), previous: corrections.map(c => [c.id, String(c.amountRub)]), delta, reason, kind })).digest('hex');
    return { invoice, kind, reason, amountRub: delta / 100, before, after, previewHash };
  }
  async previewCorrection(dto: PreviewInvoiceCorrectionDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; const plan = await this.correctionPlan(tx, dto, user);
      return { invoiceId: plan.invoice.id, invoiceNumber: plan.invoice.number, kind: plan.kind, reason: plan.reason, amountRub: plan.amountRub, before: plan.before, after: plan.after, previewHash: plan.previewHash }; });
  }
  async createCorrection(dto: CreateInvoiceCorrectionDto, user: AuthUser) {
    return runBillingMutation(this.prisma, async db => {
      await db.$queryRaw`SELECT id FROM "BillingInvoice" WHERE id=${dto.invoiceId} FOR UPDATE`;
      const key = `${user.id}:${dto.operationKey}`;
      const saved = await db.$queryRaw<Array<{ id: string; invoiceId: string; amountRub: unknown; kind: string; reason: string }>>`SELECT * FROM "BillingInvoiceCorrection" WHERE "operationKey"=${key}`;
      if (saved.length) {
        const invoice = await db.billingInvoice.findUnique({ where: { id: dto.invoiceId }, include: { client: true, request: { select: { warehouseId: true } } } });
        if (!invoice) throw new NotFoundException('Счёт не найден.');
        const branch = this.scope(invoice.clientId, user, true);
        if ((invoice.warehouseId ?? invoice.request?.warehouseId) !== branch || invoice.client.isDemo !== (user.isDemo === true)) throw new ForbiddenException('Счёт недоступен в выбранном филиале.');
        if (saved[0].invoiceId !== dto.invoiceId || billingMinor(saved[0].amountRub) !== billingMinor(dto.amountRub) || saved[0].reason !== dto.reason.trim() || saved[0].kind !== (dto.kind ?? 'ADJUSTMENT'))
          throw new ConflictException('Ключ повторного запроса уже использован для другой корректировки.');
        return { correction: saved[0], replayed: true };
      }
      const plan = await this.correctionPlan(db, dto, user);
      if (plan.previewHash !== dto.previewHash) throw new ConflictException('Счёт или оплаты изменились. Повторите предварительный расчёт.');
      const id = randomUUID(), status = plan.after.remainingRub > 0 ? 'ISSUED' : 'PAID';
      const lastReceipt = plan.invoice.payments.map(p => p.paidAt).sort((a, b) => b.getTime() - a.getTime())[0];
      await db.billingInvoice.update({ where: { id: dto.invoiceId }, data: { status,
        // FIX: legacy snapshots may have no issue timestamp; only late draft issuance adds one.
        ...(plan.kind === 'LATE_WORK' ? { issuedAt: new Date() } : {}),
        paidAt: status === 'PAID' ? plan.invoice.paidAt ?? lastReceipt ?? null : null } });
      const rows = await db.$queryRaw(Prisma.sql`INSERT INTO "BillingInvoiceCorrection" ("id","invoiceId","amountRub","kind","reason","operationKey","createdByUserId") VALUES (${id},${dto.invoiceId},${dto.amountRub}::numeric,${plan.kind},${plan.reason},${key},${user.id}) RETURNING *`);
      await db.auditLog.create({ data: { userId: user.id, action: 'billing.invoice.correction', entity: 'BillingInvoiceCorrection', entityId: id,
        payload: { invoiceId: dto.invoiceId, amountRub: plan.amountRub, reason: plan.reason, kind: plan.kind, before: plan.before, after: plan.after } } });
      return { correction: (rows as unknown[])[0], balance: plan.after, replayed: false };
    });
  }
}
