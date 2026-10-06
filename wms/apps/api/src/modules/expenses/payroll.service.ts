import { handlingQuantities, equivalentPallets, HANDLING_PALLET_RATE } from './handling-quantities';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { PayrollIdentityDto, PayrollStatusBatchDto, PayrollConditionDto, PayrollEmployeeDto, PayrollHandlingDto, PayrollShiftDto, PayrollStatusDto, PayrollHistoryEditDto } from './payroll.dto';
import { calculateHandling, calculateWorkDay, payrollRateAt, workDate } from './payroll-calculation';
import { appendFbsAttemptHistory } from '../../common/shipment-history/fbs-attempt-history';
import { Prisma } from '@prisma/client';
import { previewPayrollWorkbook } from './payroll-import';
import { PayrollCorrections, correctionHash, requireCorrections } from './payroll-corrections';

type PayrollRow = { key: string; employeeId: string; date: string; kind: string; amountKopecks: number; status: string; comment?: string; workedMs?: number; lunchMs?: number; units?: number; detail: unknown };

// FIX: a role alone never gives a branch administrator network-wide payroll access.
export function payrollWarehouses(user: AuthUser, write = false): string[] | undefined {
  if (user.roleCodes.includes('OWNER')) return undefined;
  if (!user.roleCodes.includes('ADMIN')) throw new ForbiddenException('ФОТ доступен администратору и собственнику.');
  return write ? user.writableWarehouseIds ?? [] : user.warehouseIds ?? [];
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser, write = false) {
    if (process.env.WMS_PAYROLL_ATTENDANCE_ENABLED !== 'true') throw new NotFoundException('Новый ФОТ не включён.');
    const ids = payrollWarehouses(user, write);
    return { isDemo: Boolean(user.isDemo), ...(ids ? { warehouseId: { in: ids } } : {}) };
  }

  async employees(user: AuthUser) {
    const where = this.scope(user);
    return this.prisma.payrollEmployee.findMany({ where, orderBy: { name: 'asc' }, include: { rates: { orderBy: { startsAt: 'desc' } } } });
  }

  private async employee(id: string, user: AuthUser, write = false) {
    const row = await this.prisma.payrollEmployee.findFirst({ where: { id, ...this.scope(user, write) } });
    if (!row) throw new NotFoundException('Сотрудник не найден.');
    return row;
  }

  // FIX: keep source identities, rates and paid snapshots intact; only link their presentation.
  async setIdentity(id: string, dto: PayrollIdentityDto, user: AuthUser) {
    const primary = await this.employee(id, user, true);
    const ids = [...new Set(dto.memberIds)];
    if (ids.length !== dto.memberIds.length || ids.includes(id) || ids.length > 100) throw new BadRequestException('Проверьте список карточек.');
    return this.prisma.$transaction(async tx => {
      // Lock the branch in stable order so concurrent links cannot create chains/cycles.
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE "warehouseId" = ${primary.warehouseId} AND "isDemo" = ${primary.isDemo} ORDER BY id FOR UPDATE`;
      const people = await tx.payrollEmployee.findMany({ where: { warehouseId: primary.warehouseId, isDemo: primary.isDemo } });
      const root = people.find(p => p.id === id);
      if (!root || root.payrollPrimaryId) throw new BadRequestException('Откройте основную карточку сотрудника.');
      for (const memberId of ids) {
        const member = people.find(p => p.id === memberId);
        if (!member || (member.payrollPrimaryId && member.payrollPrimaryId !== id) || people.some(p => p.payrollPrimaryId === memberId)) throw new BadRequestException('Карточка недоступна или уже связана с другим сотрудником.');
      }
      const previous = people.filter(p => p.payrollPrimaryId === id).map(p => p.id);
      await tx.payrollEmployee.updateMany({ where: { payrollPrimaryId: id }, data: { payrollPrimaryId: null } });
      await tx.payrollEmployee.updateMany({ where: { id: { in: ids } }, data: { payrollPrimaryId: id } });
      await tx.payrollAudit.create({ data: { warehouseId: primary.warehouseId, actorId: user.id, entityId: id, action: 'EMPLOYEE_IDENTITY_LINKED', details: { previous, memberIds: ids } } });
      return { primaryId: id, memberIds: ids };
    });
  }

  // FIX: all selected people are validated and paid within one transaction, never partially.
  async setStatusBatch(dto: PayrollStatusBatchDto, user: AuthUser) {
    this.scope(user, true); this.period(dto.dateFrom, dto.dateTo);
    const ids = dto.entries.map(e => e.employeeId);
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || dto.entries.some(e => !e.keys.length || e.keys.length > 2000 || new Set(e.keys).size !== e.keys.length)) throw new BadRequestException('Проверьте выбранные начисления.');
    return this.prisma.$transaction(async tx => {
      for (const id of [...ids].sort()) await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${id} FOR UPDATE`;
      const scoped = new PayrollService(tx as unknown as PrismaService);
      const selected: Array<{ row: PayrollRow; warehouseId: string }> = [];
      for (const entry of dto.entries) {
        const employee = await scoped.employee(entry.employeeId, user, true);
        const report = await scoped.report(entry.employeeId, dto.dateFrom, dto.dateTo, user);
        if (dto.status === 'PAID' && report.issues.length) throw new BadRequestException('Сначала исправьте ошибки расчёта за период.');
        for (const key of entry.keys) {
          const row = report.rows.find(r => r.key === key);
          if (!row) throw new BadRequestException('Начисление не найдено. Обновите отчёт.');
          if (dto.status === 'PAID' && (row.status !== 'UNPAID' || (row.kind === 'PALLET' && (row.detail as {status:string}).status !== 'CONFIRMED'))) throw new BadRequestException('Выберите только неоплаченные подтверждённые начисления. Обновите отчёт.');
          selected.push({ row, warehouseId: employee.warehouseId });
        }
      }
      const amountKopecks = selected.reduce((sum, s) => sum + s.row.amountKopecks, 0);
      if (!Number.isSafeInteger(amountKopecks) || amountKopecks !== dto.expectedAmountKopecks) throw new BadRequestException('Сумма изменилась. Обновите отчёт и проверьте выбор.');
      for (const { row, warehouseId } of selected) {
        const data = { employeeId: row.employeeId, warehouseId, workDate: row.date, status: dto.status, snapshot: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue, comment: dto.comment, updatedById: user.id, paidAt: dto.status === 'PAID' ? new Date() : null };
        await tx.payrollSettlement.upsert({ where: { key: row.key }, create: { key: row.key, ...data }, update: data });
        await tx.payrollAudit.create({ data: { warehouseId, actorId: user.id, entityId: row.key, action: 'PAYMENT_STATUS', details: { from: row.status, to: dto.status, comment: dto.comment, amountKopecks: row.amountKopecks, batch: true } } });
      }
      return { updated: selected.length, amountKopecks };
    }, { timeout: 60000 });
  }

  async saveEmployee(id: string | undefined, dto: PayrollEmployeeDto, user: AuthUser) {
    this.scope(user, true);
    if (id) await this.employee(id, user, true);
    const allowed = payrollWarehouses(user, true);
    if (allowed && !allowed.includes(dto.warehouseId)) throw new ForbiddenException('Нет доступа к филиалу.');
    if (!await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } })) throw new BadRequestException('Филиал не найден.');
    if (!dto.name.trim()) throw new BadRequestException('Укажите имя.');
    if (dto.paymentMethod === 'TRANSFER' && (!dto.paymentPhone?.trim() || !dto.paymentBank?.trim())) {
      throw new BadRequestException('Для перевода укажите телефон и банк.');
    }
    if (dto.userId && !await this.prisma.user.findFirst({ where: { id: dto.userId, isDemo: Boolean(user.isDemo), warehouseScopes: { some: { warehouseId: dto.warehouseId } } } })) {
      throw new BadRequestException('Пользователь не относится к филиалу.');
    }
    const { initialConditions: requestedConditions, ...employeeData } = dto;
    const initialConditions = requestedConditions ?? [];
    if (id && initialConditions.length) throw new BadRequestException('Изменяйте ставки через условия оплаты.');
    if (initialConditions.length > 2 || initialConditions.filter(r => r.kind !== 'PALLET').length > 1 || initialConditions.filter(r => r.kind === 'PALLET').length > 1) throw new BadRequestException('Укажите одну основную ставку и один тариф за паллету.');
    const initialRates = initialConditions.map(r => {
      if (!['HOURLY', 'PIECE', 'PALLET'].includes(r.kind) || !Number.isSafeInteger(r.rateKopecks) || r.rateKopecks < 0 || r.rateKopecks > 2147483647 || (r.kind === 'PALLET' && !dto.loader)) throw new BadRequestException('Проверьте первоначальный тариф.');
      return { kind: r.kind, rateKopecks: r.rateKopecks, startsAt: this.timestamp(r.startsAt), temporary: false, reason: 'Первоначальный тариф при создании сотрудника', createdById: user.id };
    });
    const data = { ...employeeData, name: dto.name.trim(), userId: dto.userId || null, isDemo: Boolean(user.isDemo),
      paymentPhone: dto.paymentMethod === 'TRANSFER' ? dto.paymentPhone!.trim() : null,
      paymentBank: dto.paymentMethod === 'TRANSFER' ? dto.paymentBank!.trim() : null };
    return this.prisma.$transaction(async tx => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${id} FOR UPDATE`;
        const previous = await tx.payrollEmployee.findUniqueOrThrow({ where: { id } });
        if (previous.warehouseId !== dto.warehouseId) throw new BadRequestException('Перенос сотрудника между филиалами требует отдельного переноса истории.');
      }
      const row = id ? await tx.payrollEmployee.update({ where: { id }, data }) : await tx.payrollEmployee.create({ data: { ...data, rates: { create: initialRates } } });
      await tx.payrollAudit.create({ data: { warehouseId: row.warehouseId, actorId: user.id, entityId: row.id, action: id ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED', details: { paymentMethod: row.paymentMethod, initialConditions: initialConditions.map(r => ({ ...r })) } } });
      return row;
    });
  }

  async addCondition(employeeId: string, dto: PayrollConditionDto, user: AuthUser) {
    const employee = await this.employee(employeeId, user, true);
    const startsAt = this.timestamp(dto.startsAt), endsAt = dto.endsAt ? this.timestamp(dto.endsAt) : null;
    if ((endsAt && endsAt <= startsAt) || (dto.temporary && !endsAt) || !dto.reason.trim()) throw new BadRequestException('Проверьте период и причину ставки.');
    return this.prisma.$transaction(async tx => {
      // Serialize changes for this employee across both tablets/admin sessions.
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employeeId} FOR UPDATE`;
      const conditions = await tx.payrollCondition.findMany({ where: { employeeId } });
      if (dto.temporary && dto.kind !== 'PALLET' && conditions.some(r => !r.temporary && r.kind !== 'PALLET' && r.kind !== dto.kind && r.startsAt < endsAt! && (!r.endsAt || r.endsAt > startsAt))) {
        throw new BadRequestException('Временная ставка должна сохранять тип оплаты.');
      }
      const group = (kind: string) => kind === 'PALLET' ? 'PALLET' : 'WORK';
      // A new permanent rate closes the preceding open base condition, preserving its history.
      const preceding = conditions.find(r => !dto.temporary && !r.temporary && group(r.kind) === group(dto.kind) && !r.endsAt && r.startsAt < startsAt);
      if (conditions.some(r => r.id !== preceding?.id && group(r.kind) === group(dto.kind) && r.temporary === dto.temporary && r.startsAt < (endsAt ?? new Date('9999-01-01')) && (!r.endsAt || r.endsAt > startsAt))) {
        throw new BadRequestException('Периоды условий пересекаются.');
      }
      if (preceding) await tx.payrollCondition.update({ where: { id: preceding.id }, data: { endsAt: startsAt } });
      const row = await tx.payrollCondition.create({ data: { ...dto, employeeId, startsAt, endsAt, createdById: user.id } });
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: row.id, action: 'CONDITION_CREATED', details: { employeeId, kind: dto.kind, reason: dto.reason } } });
      return row;
    });
  }

  async addShift(employeeId: string, dto: PayrollShiftDto, user: AuthUser) {
    const employee = await this.employee(employeeId, user, true);
    const startsAt = this.timestamp(dto.startsAt), endsAt = dto.endsAt ? this.timestamp(dto.endsAt) : null;
    if ((endsAt && endsAt <= startsAt) || !dto.reason.trim()) throw new BadRequestException('Проверьте время и причину.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employeeId} FOR UPDATE`;
      if (await tx.payrollSettlement.findFirst({ where: { employeeId, workDate: workDate(dto.startsAt), status: 'PAID', key: { startsWith: 'WORK:' } } })) {
        throw new BadRequestException('День уже оплачен. Сначала пересмотрите выплату.');
      }
      if (await tx.payrollHistorical.findFirst({ where: { employeeId, workDate: workDate(dto.startsAt) } })) throw new BadRequestException('День уже перенесён из табеля; новая смена может задвоить начисление.');
      const overlap = await tx.payrollShift.findFirst({ where: { employeeId, cancelledAt: null, startsAt: { lt: endsAt ?? new Date('9999-01-01') }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] } });
      if (overlap) throw new BadRequestException('Смена пересекается с существующей.');
      const row = await tx.payrollShift.create({ data: { employeeId, startsAt, endsAt, workDate: workDate(dto.startsAt), source: 'MANUAL', createdById: user.id, reason: dto.reason } });
      const lunchCorrection = await this.correctLunch(tx, employeeId, row.workDate, dto.lunchMinutes);
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: row.id, action: 'SHIFT_CREATED', details: { employeeId, reason: dto.reason, lunchCorrection } } });
      return row;
    });
  }

  async shifts(employeeId: string, user: AuthUser) {
    await this.employee(employeeId, user);
    return this.prisma.payrollShift.findMany({ where: { employeeId, cancelledAt: null }, orderBy: { startsAt: 'desc' }, take: 1000 });
  }

  async updateShift(employeeId: string, id: string, dto: PayrollShiftDto, user: AuthUser) {
    // FIX: old deployments retain their workflow; reversible corrections are explicitly enabled on our WMS.
    if (process.env.WMS_PAYROLL_CORRECTIONS_ENABLED === 'true') return new PayrollCorrections(this.prisma, user, this.scope(user, true)).shift(employeeId, id, dto);
    if (dto.employeeId && dto.employeeId !== employeeId) throw new BadRequestException('Перенос смен пока не включён.');
    const employee = await this.employee(employeeId, user, true);
    const startsAt = this.timestamp(dto.startsAt), endsAt = dto.endsAt ? this.timestamp(dto.endsAt) : null;
    if ((endsAt && endsAt <= startsAt) || !dto.reason.trim()) throw new BadRequestException('Проверьте время и причину.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employeeId} FOR UPDATE`;
      const previous = await tx.payrollShift.findFirst({ where: { id, employeeId, cancelledAt: null } });
      if (!previous) throw new NotFoundException('Смена не найдена.');
      const date = workDate(dto.startsAt);
      if (await tx.payrollHistorical.findFirst({ where: { employeeId, workDate: date } })) throw new BadRequestException('День уже перенесён из табеля.');
      if (await tx.payrollSettlement.findFirst({ where: { employeeId, workDate: { in: [date, previous.workDate] }, status: 'PAID', key: { startsWith: 'WORK:' } } })) throw new BadRequestException('День уже оплачен. Сначала пересмотрите выплату.');
      if (await tx.payrollShift.findFirst({ where: { employeeId, cancelledAt: null, id: { not: id }, startsAt: { lt: endsAt ?? new Date('9999-01-01') }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] } })) throw new BadRequestException('Смены пересекаются.');
      const row = await tx.payrollShift.update({ where: { id }, data: { startsAt, endsAt, workDate: date, reason: dto.reason, version: { increment: 1 } } });
      const lunchCorrections = [await this.correctLunch(tx, employeeId, date, dto.lunchMinutes)];
      if (previous.workDate !== date) lunchCorrections.push(await this.correctLunch(tx, employeeId, previous.workDate, undefined));
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: id, action: 'SHIFT_UPDATED', details: { lunchCorrections, before: { start: previous.startsAt.toISOString(), end: previous.endsAt?.toISOString() ?? null }, after: { start: startsAt.toISOString(), end: endsAt?.toISOString() ?? null, lunchMinutes: dto.lunchMinutes ?? null }, reason: dto.reason } } });
      return row;
    });
  }

  // FIX: validate the aggregate under the employee lock, including removal/moving of a visit.
  private async correctLunch(tx: Prisma.TransactionClient, employeeId: string, date: string, requested: number | null | undefined) {
    const key = { employeeId, workDate: date };
    const previous = await tx.payrollWorkDay.findUnique({ where: { employeeId_workDate: key } });
    const lunch = requested === undefined ? previous?.lunchMinutes ?? null : requested;
    if (lunch != null && (!Number.isSafeInteger(lunch) || lunch < 0)) throw new BadRequestException('Укажите корректное время обеда.');
    const shifts = await tx.payrollShift.findMany({ where: { ...key, cancelledAt: null } });
    if (!shifts.length) { await tx.payrollWorkDay.deleteMany({ where: key }); return { date, before: previous?.lunchMinutes ?? null, after: null }; }
    if (lunch != null && !shifts.some(s => !s.endsAt) && lunch * 60000 > shifts.reduce((n, s) => n + s.endsAt!.getTime() - s.startsAt.getTime(), 0)) {
      throw new BadRequestException('Обед превышает рабочее время за день. Сначала исправьте обед.');
    }
    if (requested !== undefined) await tx.payrollWorkDay.upsert({ where: { employeeId_workDate: key }, create: { ...key, lunchMinutes: lunch }, update: { lunchMinutes: lunch } });
    return { date, before: previous?.lunchMinutes ?? null, after: lunch };
  }

  // FIX: cancellation retains original timestamps/photos and is serialized with tablet marks/payments.
  async cancelShift(employeeId: string, id: string, reason: string, user: AuthUser) {
    const employee = await this.employee(employeeId, user, true);
    if (!reason.trim()) throw new BadRequestException('Укажите причину удаления.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employeeId} FOR UPDATE`;
      const row = await tx.payrollShift.findFirst({ where: { id, employeeId } });
      if (!row) throw new NotFoundException('Смена не найдена.');
      if (row.cancelledAt) return row;
      if (await tx.payrollSettlement.findFirst({ where: { employeeId, workDate: row.workDate, status: 'PAID', key: { startsWith: 'WORK:' } } })) throw new BadRequestException('День уже оплачен. Сначала пересмотрите выплату.');
      const updated = await tx.payrollShift.update({ where: { id }, data: { cancelledAt: new Date(), reason, version: { increment: 1 } } });
      const lunchCorrection = await this.correctLunch(tx, employeeId, row.workDate, undefined);
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: id, action: 'SHIFT_CANCELLED', details: JSON.parse(JSON.stringify({ before: row, reason, lunchCorrection })) } });
      return updated;
    });
  }

  async pickingUsers(user: AuthUser) {
    this.scope(user);
    const ids = payrollWarehouses(user);
    return this.prisma.user.findMany({ where: { isDemo: Boolean(user.isDemo), ...(ids ? { warehouseScopes: { some: { warehouseId: { in: ids } } } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  // FIX: corrections of imported times require explicit lunch, rate, reason and payment review.
  async updateHistory(employeeId: string, key: string, dto: PayrollHistoryEditDto, user: AuthUser) {
    const employee = await this.employee(employeeId, user, true);
    const minutes = (s: string) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new BadRequestException('Укажите время ЧЧ:ММ.');
      const [h, m] = s.split(':').map(Number); return h * 60 + m;
    };
    const start = minutes(dto.startTime), end = minutes(dto.endTime);
    const worked = end > start ? end - start : end < start ? end + 1440 - start : 0;
    if (!dto.reason.trim() || !worked || !Number.isSafeInteger(dto.lunchMinutes) || dto.lunchMinutes < 0 || dto.lunchMinutes > worked || !Number.isSafeInteger(dto.rateKopecks) || dto.rateKopecks < 0) throw new BadRequestException('Проверьте время, обед, ставку и причину.');
    const amountKopecks = Math.round((worked - dto.lunchMinutes) * dto.rateKopecks / 60);
    if (!Number.isSafeInteger(amountKopecks) || amountKopecks > 2147483647) throw new BadRequestException('Сумма слишком велика.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employeeId} FOR UPDATE`;
      const before = await tx.payrollHistorical.findFirst({ where: { key, employeeId, warehouseId: employee.warehouseId } });
      if (!before) throw new NotFoundException('Запись не найдена.');
      const settlement = await tx.payrollSettlement.findUnique({ where: { key: `HISTORY:${key}` } });
      if ((settlement?.status ?? before.status) === 'PAID') throw new BadRequestException('Запись оплачена. Сначала переведите её в статус «На проверке».');
      const data = { ...(before.data as Prisma.JsonObject), start: start / 1440, end: end / 1440, lunch: dto.lunchMinutes / 1440, paidTime: (worked - dto.lunchMinutes) / 1440, rate: dto.rateKopecks / 100, amountKopecks };
      const row = await tx.payrollHistorical.update({ where: { key }, data: { data, amountKopecks, status: 'REVIEW' } });
      if (settlement) await tx.payrollSettlement.update({ where: { key: settlement.key ?? `HISTORY:${key}` }, data: { status: 'REVIEW', comment: dto.reason, updatedById: user.id } });
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: key, action: 'HISTORY_UPDATED', details: { before: { data: before.data, amountKopecks: before.amountKopecks, status: before.status }, after: { data, amountKopecks, status: 'REVIEW' }, reason: dto.reason } } });
      return row;
    });
  }

  async addHandling(dto: PayrollHandlingDto, user: AuthUser) {
    this.scope(user, true);
    for (const id of dto.employeeIds) {
      const employee = await this.employee(id, user, true);
      if (employee.warehouseId !== dto.warehouseId) throw new BadRequestException('Участники должны относиться к выбранному филиалу.');
    }
    let quantities;
    try { quantities = handlingQuantities({ pallets: dto.palletCount, boxes: dto.boxCount, bags: dto.bagCount, rolls: dto.rollCount }); } catch (e) { throw new BadRequestException((e as Error).message); }
    return this.prisma.payrollHandling.create({ data: { warehouseId: dto.warehouseId, startsAt: this.timestamp(dto.startsAt), operation: dto.operation,
      ...quantities, unitRateKopecks: HANDLING_PALLET_RATE, reason: dto.reason, createdById: user.id, shares: { create: dto.employeeIds.map(employeeId => ({ employeeId })) } } });
  }

  // FIX: review operations can be corrected or cancelled, never silently removed from audit history.
  async changeHandling(id: string, dto: PayrollHandlingDto | { reason: string }, user: AuthUser, cancel = false) {
    if (!cancel && process.env.WMS_PAYROLL_CORRECTIONS_ENABLED === 'true') return new PayrollCorrections(this.prisma, user, this.scope(user, true)).handling(id, dto as PayrollHandlingDto);
    this.scope(user, true);
    if (!dto.reason.trim()) throw new BadRequestException('Укажите причину изменения.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollHandling" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.payrollHandling.findUnique({ where: { id }, include: { shares: true } });
      if (!row) throw new NotFoundException('Работа не найдена.');
      for (const share of row.shares) await this.employee(share.employeeId, user, true);
      if (row.status !== 'REVIEW') throw new BadRequestException('Изменять можно только неподтверждённую работу.');
      let data: Prisma.PayrollHandlingUpdateInput = { status: 'CANCELLED' };
      if (!cancel) {
        const edit = dto as PayrollHandlingDto;
        if (edit.warehouseId !== row.warehouseId) throw new BadRequestException('Нельзя менять филиал работы.');
        for (const employeeId of edit.employeeIds) {
          const employee = await this.employee(employeeId, user, true);
          if (employee.warehouseId !== row.warehouseId) throw new BadRequestException('Участники должны относиться к выбранному филиалу.');
        }
        let quantities;
        try { quantities = handlingQuantities({ pallets: edit.palletCount, boxes: edit.boxCount ?? row.boxCount, bags: edit.bagCount ?? row.bagCount, rolls: edit.rollCount ?? row.rollCount }); } catch (e) { throw new BadRequestException((e as Error).message); }
        data = { startsAt: this.timestamp(edit.startsAt), operation: edit.operation, ...quantities,
          reason: edit.reason, shares: { deleteMany: {}, create: edit.employeeIds.map(employeeId => ({ employeeId })) } };
      }
      const updated = await tx.payrollHandling.update({ where: { id }, data });
      await tx.payrollAudit.create({ data: { warehouseId: row.warehouseId, actorId: user.id, entityId: id,
        action: cancel ? 'HANDLING_CANCELLED' : 'HANDLING_UPDATED',
        details: JSON.parse(JSON.stringify({ before: row, after: updated, reason: dto.reason })) } });
      return updated;
    });
  }

  async confirmHandling(id: string, user: AuthUser, rateKopecks?: number) {
    this.scope(user, true);
    if (rateKopecks !== undefined && (!Number.isSafeInteger(rateKopecks) || rateKopecks < 0 || rateKopecks > 2147483647)) throw new BadRequestException('Укажите корректный тариф за паллету.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollHandling" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.payrollHandling.findUnique({ where: { id }, include: { shares: { include: { employee: { include: { rates: true } } } } } });
      if (!row) throw new NotFoundException('Работа не найдена.');
      for (const share of row.shares) await this.employee(share.employeeId, user, true);
      if (row.status === 'CONFIRMED') return row;
      if (row.status !== 'REVIEW') throw new BadRequestException('Отменённую работу нельзя подтвердить.');
      // FIX: new tablet work uses the agreed 500 RUB per pallet equivalent.
      rateKopecks ??= row.unitRateKopecks ?? undefined;
      if (rateKopecks === undefined) for (const share of row.shares) {
        try { payrollRateAt(share.employee.rates.filter(r => r.kind === 'PALLET').map(r => ({ from: r.startsAt.toISOString(), to: r.endsAt?.toISOString(), kopecks: r.rateKopecks, temporary: r.temporary })), row.startsAt.toISOString()); }
        catch { throw new BadRequestException(`Нет действующего тарифа за паллету: ${share.employee.name}. Введите разовый тариф рядом с работой или настройте ставку сотрудника.`); }
      }
      const result = calculateHandling(row.startsAt.toISOString(), equivalentPallets({ palletCount: Number(row.palletCount), boxCount: row.boxCount ?? 0, bagCount: row.bagCount ?? 0, rollCount: row.rollCount ?? 0 }), row.shares.map(s => ({ employeeId: s.employeeId,
        rates: rateKopecks !== undefined ? [{ from: row.startsAt.toISOString(), kopecks: rateKopecks }] : s.employee.rates.filter(r => r.kind === 'PALLET').map(r => ({ from: r.startsAt.toISOString(), to: r.endsAt?.toISOString(), kopecks: r.rateKopecks, temporary: r.temporary })) })));
      if (result.participants.some(p => p.amountKopecks > 2147483647)) throw new BadRequestException('Сумма слишком велика.');
      for (const p of result.participants) await tx.payrollHandlingShare.update({ where: { operationId_employeeId: { operationId: id, employeeId: p.employeeId } }, data: { amountKopecks: p.amountKopecks } });
      await tx.payrollAudit.create({ data: { warehouseId: row.warehouseId, actorId: user.id, entityId: id, action: 'HANDLING_CONFIRMED', details: result } });
      return tx.payrollHandling.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: user.id } });
    });
  }

  private period(from: string, to: string) {
    if (![from, to].every(v => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v) || from > to) {
      throw new BadRequestException('Укажите корректный период.');
    }
    const start = new Date(`${from}T00:00:00+03:00`), end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86400000);
    if (end.getTime() - start.getTime() > 366 * 86400000) throw new BadRequestException('Выберите период не больше года.');
    return { start, end };
  }

  async report(employeeId: string, from: string, to: string, user: AuthUser) {
    const employee = await this.employee(employeeId, user);
    const period = this.period(from, to);
    const [rates, shifts, shares, settlements, history, workDays] = await Promise.all([
      this.prisma.payrollCondition.findMany({ where: { employeeId } }),
      this.prisma.payrollShift.findMany({ where: { employeeId, cancelledAt: null, workDate: { gte: from, lte: to } }, include: { breaks: true }, orderBy: { startsAt: 'asc' } }),
      this.prisma.payrollHandlingShare.findMany({ where: { employeeId, operation: { startsAt: { gte: period.start, lt: period.end } } }, include: { operation: { include: { shares: { orderBy: { employeeId: 'asc' } } } } } }),
      this.prisma.payrollSettlement.findMany({ where: { employeeId, workDate: { gte: from, lte: to } } }),
      this.prisma.payrollHistorical.findMany({ where: { employeeId, workDate: { gte: from, lte: to } } }),
      this.prisma.payrollWorkDay.findMany({ where: { employeeId, workDate: { gte: from, lte: to } } }),
    ]);
    const schedule = (kind: string) => rates.filter(r => r.kind === kind).map(r => ({ from: r.startsAt.toISOString(), to: r.endsAt?.toISOString(), kopecks: r.rateKopecks, temporary: r.temporary }));
    const rows: PayrollRow[] = [], issues: string[] = [];
    const dates = [...new Set(shifts.map(s => s.workDate))];
    for (const date of dates) {
      const day = shifts.filter(s => s.workDate === date);
      if (day.some(s => !s.endsAt)) { issues.push(`${date}: смена не закрыта`); continue; }
      try {
        const applicable = rates.filter(r => r.kind !== 'PALLET' && r.startsAt <= day[0].startsAt && (!r.endsAt || r.endsAt > day[0].startsAt));
        const kind = applicable.find(r => r.temporary)?.kind ?? applicable.find(r => !r.temporary)?.kind;
        if (kind === 'PIECE') continue;
        if (rates.some(r => r.kind === 'PIECE' && day.some(s => r.startsAt < s.endsAt! && (!r.endsAt || r.endsAt > s.startsAt)))) {
          issues.push(`${date}: тип оплаты менялся внутри смены; требуется проверка`); continue;
        }
        const lunches = day.flatMap(s => s.breaks ?? []);
        if (lunches.some(b => !b.endsAt)) throw new Error('Lunch is still open');
        const calculated = calculateWorkDay(day.map(s => ({ start: s.startsAt.toISOString(), end: s.endsAt!.toISOString() })), schedule('HOURLY'), 'Europe/Moscow', workDays.find(d => d.workDate === date)?.lunchMinutes, lunches.length ? lunches.map(b => ({ start: b.startsAt.toISOString(), end: b.endsAt!.toISOString() })) : undefined);
        rows.push({ key: `WORK:${employeeId}:${date}`, employeeId, date, kind: 'HOURLY', amountKopecks: calculated.amountKopecks,
          workedMs: calculated.workedMs, lunchMs: calculated.lunchMs, status: 'UNPAID', detail: { ...calculated, lunchOverride: workDays.find(d => d.workDate === date)?.lunchMinutes ?? null, shifts: day.map(s => ({ id: s.id, start: s.startsAt.toISOString(), end: s.endsAt!.toISOString(), version: s.version })) } });
      } catch (e) { issues.push(`${date}: проверьте ставки и интервалы смены`); }
    }
    if (employee.userId) {
      const taskWhere = { workerUserId: employee.userId, status: 'COMPLETED' as const, completedAt: { gte: period.start, lt: period.end } };
      const tasks = await this.prisma.fbsTsdAssembly.findMany({ where: taskWhere, select: { id: true, orderId: true, stockWarehouseId: true, workerUserId: true, workerName: true, deviceCode: true, itemCount: true, startedAt: true, completedAt: true } });
      await appendFbsAttemptHistory(this.prisma, tasks, { workerUserId: employee.userId, completedAt: { gte: period.start, lt: period.end } });
      const seen = new Set<string>();
      for (const task of tasks) {
        if (!task.completedAt) continue;
        const identity = task.id;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const t = task.completedAt;
        const applicable = rates.filter(r => r.kind !== 'PALLET' && r.startsAt <= t && (!r.endsAt || r.endsAt > t));
        const kind = applicable.find(r => r.temporary)?.kind ?? applicable.find(r => !r.temporary)?.kind;
        if (kind !== 'PIECE') continue;
        if (!task.stockWarehouseId) { issues.push(`${workDate(t.toISOString())}: у задания сборки не определён филиал; требуется проверка`); continue; }
        if (task.stockWarehouseId !== employee.warehouseId) continue;
        const date = workDate(t.toISOString()), key = `WORK:${employeeId}:${date}`;
        if (rows.some(r => r.key === key && r.kind !== 'PIECE')) { issues.push(`${date}: тип оплаты менялся внутри рабочего дня; требуется проверка`); continue; }
        if (!Number.isSafeInteger(task.itemCount) || task.itemCount <= 0) { issues.push(`${date}: некорректное количество собранных единиц`); continue; }
        const units = task.itemCount;
        const amount = units * payrollRateAt(schedule('PIECE'), t.toISOString());
        const row = rows.find(r => r.key === key);
        if (row) { row.units = (row.units ?? 0) + units; row.amountKopecks += amount; }
        else rows.push({ key, employeeId, date, kind: 'PIECE', units, amountKopecks: amount, status: 'UNPAID', detail: { source: 'FBS_COMPLETED' } });
      }
    }
    for (const share of shares) {
      const op = share.operation;
      if (op.status === 'CANCELLED') continue;
      rows.push({ key: `HANDLING:${op.id}:${employeeId}`, employeeId, date: workDate(op.startsAt.toISOString()), kind: 'PALLET',
        amountKopecks: share.amountKopecks ?? 0, status: op.status === 'CONFIRMED' ? 'UNPAID' : 'REVIEW', detail: { ...op, correctionToken: correctionHash(op), palletCount: Number(op.palletCount) } });
    }
    for (const old of history) {
      const data = old.data as { paidTime: number; lunch: number };
      rows.push({ key: `HISTORY:${old.key}`, employeeId, date: old.workDate, kind: 'HISTORY', amountKopecks: old.amountKopecks,
        status: old.status, workedMs: (data.paidTime + data.lunch) * 86400000, lunchMs: data.lunch * 86400000, detail: data });
    }
    for (const state of settlements) {
      const index = rows.findIndex(r => r.key === state.key);
      if (state.status === 'PAID') {
        const frozen = { ...(state.snapshot as unknown as PayrollRow), status: 'PAID', comment: state.comment };
        if (index >= 0) rows[index] = frozen; else rows.push(frozen);
      } else if (index >= 0) rows[index] = { ...rows[index], status: state.status, comment: state.comment };
    }
    return { employee, from, to, rows: rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)), issues,
      totals: { amountKopecks: rows.reduce((s, r) => s + r.amountKopecks, 0), paidKopecks: rows.filter(r => r.status === 'PAID').reduce((s, r) => s + r.amountKopecks, 0) } };
  }

  async undoCorrection(id: string, reason: string, user: AuthUser) {
    return new PayrollCorrections(this.prisma, user, this.scope(user, true)).undo(id, reason);
  }

  // FIX: audit visibility follows both warehouse permissions and demo ownership, not just an audit warehouse ID.
  async correctionHistory(from: string, to: string, cursor: string | undefined, user: AuthUser) {
    requireCorrections();
    const scope = this.scope(user), period = this.period(from, to);
    const people = await this.prisma.payrollEmployee.findMany({ where: scope, select: { id: true, warehouseId: true } });
    const ids = people.map(p => p.id), owned = new Set(ids);
    if (!ids.length) return { entries: [], nextCursor: null };
    const entries = await this.prisma.payrollAudit.findMany({ where: { warehouseId: { in: [...new Set(people.map(p => p.warehouseId))] }, createdAt: { gte: period.start, lt: period.end } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const entities = entries.map(e => e.entityId);
    const [shifts, conditions, handling, historical, settlements] = await Promise.all([
      this.prisma.payrollShift.findMany({ where: { id: { in: entities }, employeeId: { in: ids } }, select: { id: true } }),
      this.prisma.payrollCondition.findMany({ where: { id: { in: entities }, employeeId: { in: ids } }, select: { id: true } }),
      this.prisma.payrollHandling.findMany({ where: { id: { in: entities }, shares: { some: {}, every: { employeeId: { in: ids } } } }, select: { id: true } }),
      this.prisma.payrollHistorical.findMany({ where: { key: { in: entities }, employeeId: { in: ids } }, select: { key: true } }),
      this.prisma.payrollSettlement.findMany({ where: { key: { in: entities }, employeeId: { in: ids } }, select: { key: true } }),
    ]);
    const allowed = new Set([...ids, ...shifts.map(e => e.id), ...conditions.map(e => e.id), ...handling.map(e => e.id), ...historical.map(e => e.key), ...settlements.map(e => e.key)]);
    const visible = entries.filter(e => {
      const d = e.details as { employeeIds?: string[] };
      return allowed.has(e.entityId) || (e.action === 'CORRECTION_UNDONE' && !!d.employeeIds?.length && d.employeeIds.every(id => owned.has(id)));
    });
    const undone = await this.prisma.payrollAudit.findMany({ where: { action: 'CORRECTION_UNDONE', entityId: { in: visible.map(e => e.id) } }, select: { entityId: true } });
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(visible.map(e => e.actorId))] } }, select: { id: true, name: true } });
    return { entries: visible.map(e => ({ ...e, actorName: actors.find(a => a.id === e.actorId)?.name || e.actorId, canUndo: ['SHIFT_CORRECTED', 'HANDLING_CORRECTED'].includes(e.action) && (e.details as { schema?: number }).schema === 1 && !undone.some(u => u.entityId === e.id), undone: undone.some(u => u.entityId === e.id) })), nextCursor: entries.length === 100 ? entries[entries.length - 1].id : null };
  }

  async setStatus(dto: PayrollStatusDto, user: AuthUser) {
    const employee = await this.employee(dto.employeeId, user, true);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${dto.employeeId} FOR UPDATE`;
      const report = await this.report(dto.employeeId, dto.dateFrom, dto.dateTo, user);
      const rows = dto.keys.map(key => report.rows.find(r => r.key === key));
      if (rows.some(r => !r)) throw new BadRequestException('Начисление не найдено.');
      if (dto.status === 'PAID' && report.issues.length) throw new BadRequestException('Сначала исправьте ошибки расчёта за период.');
      for (const row of rows as PayrollRow[]) {
        if (dto.status === 'PAID' && row.kind === 'PALLET' && (row.detail as { status: string }).status !== 'CONFIRMED') throw new BadRequestException('Сначала подтвердите погрузку.');
        if (row.status === 'PAID' && dto.status === 'PAID') continue;
        const data = { employeeId: employee.id, warehouseId: employee.warehouseId, workDate: row.date, status: dto.status,
          snapshot: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue, comment: dto.comment, updatedById: user.id, paidAt: dto.status === 'PAID' ? new Date() : null };
        await tx.payrollSettlement.upsert({ where: { key: row.key }, create: { key: row.key, ...data }, update: data });
        await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: row.key, action: 'PAYMENT_STATUS', details: { from: row.status, to: dto.status, comment: dto.comment, amountKopecks: row.amountKopecks } } });
      }
      return { updated: rows.length };
    }, { timeout: 30000 });
  }

  previewImport(buffer: Buffer, user: AuthUser) {
    this.scope(user, true);
    return previewPayrollWorkbook(buffer);
  }

  async importHistory(buffer: Buffer, mapping: Record<string, string>, user: AuthUser) {
    const preview = this.previewImport(buffer, user);
    if (preview.issues.length) throw new BadRequestException('Исправьте строки с ошибками перед импортом.');
    const employees = new Map<string, Awaited<ReturnType<PayrollService['employee']>>>();
    for (const name of preview.employees) {
      if (!Object.hasOwn(mapping, name) || typeof mapping[name] !== 'string') throw new BadRequestException(`Не выбран сотрудник: ${name}`);
      employees.set(name, await this.employee(mapping[name], user, true));
    }
    return this.prisma.$transaction(async tx => {
      let added = 0;
      for (const [name, employee] of employees) {
        await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employee.id} FOR UPDATE`;
        const rows = preview.rows.filter(r => r.name === name);
        const dates = [...new Set(rows.map(r => r.date))];
        if (await tx.payrollShift.findFirst({ where: { employeeId: employee.id, workDate: { in: dates } } })) throw new BadRequestException(`${name}: за эти даты уже есть смены WMS; требуется сверка до импорта.`);
        const existing = await tx.payrollHistorical.findMany({ where: { key: { in: rows.map(r => `${employee.id}:${r.key}`) } } });
        for (const old of existing) {
          const source = rows.find(r => `${employee.id}:${r.key}` === old.key)!;
          const data = old.data as { paidTime: number; rate: number; lunch: number };
          if (old.amountKopecks !== source.amountKopecks || data.paidTime !== source.paidTime || data.rate !== source.rate || data.lunch !== source.lunch || old.status !== source.status) {
            throw new BadRequestException(`${source.sheet}, строка ${source.row}: отличается от ранее перенесённой записи. Нужна ручная проверка.`);
          }
        }
        const result = await tx.payrollHistorical.createMany({ data: rows.map(r => ({ key: `${employee.id}:${r.key}`, employeeId: employee.id, warehouseId: employee.warehouseId,
          workDate: r.date, amountKopecks: r.amountKopecks, status: r.status, data: r, sourceHash: preview.sourceHash, createdById: user.id })), skipDuplicates: true });
        added += result.count;
        await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: employee.id, action: 'HISTORY_IMPORTED', details: { sourceHash: preview.sourceHash, added: result.count } } });
      }
      return { added, skipped: preview.rows.length - added };
    }, { timeout: 60000 });
  }

  private timestamp(value: string) {
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new BadRequestException('Дата должна содержать часовой пояс.');
    return new Date(value);
  }
}
