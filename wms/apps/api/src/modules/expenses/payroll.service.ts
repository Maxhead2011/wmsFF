import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { PayrollConditionDto, PayrollEmployeeDto, PayrollHandlingDto, PayrollShiftDto, PayrollStatusDto, PayrollHistoryEditDto } from './payroll.dto';
import { calculateHandling, calculateWorkDay, payrollRateAt, workDate } from './payroll-calculation';
import { appendFbsAttemptHistory } from '../../common/shipment-history/fbs-attempt-history';
import { Prisma } from '@prisma/client';
import { previewPayrollWorkbook } from './payroll-import';

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
    const data = { ...dto, name: dto.name.trim(), userId: dto.userId || null, isDemo: Boolean(user.isDemo),
      paymentPhone: dto.paymentMethod === 'TRANSFER' ? dto.paymentPhone!.trim() : null,
      paymentBank: dto.paymentMethod === 'TRANSFER' ? dto.paymentBank!.trim() : null };
    return this.prisma.$transaction(async tx => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${id} FOR UPDATE`;
        const previous = await tx.payrollEmployee.findUniqueOrThrow({ where: { id } });
        if (previous.warehouseId !== dto.warehouseId) throw new BadRequestException('Перенос сотрудника между филиалами требует отдельного переноса истории.');
      }
      const row = id ? await tx.payrollEmployee.update({ where: { id }, data }) : await tx.payrollEmployee.create({ data });
      await tx.payrollAudit.create({ data: { warehouseId: row.warehouseId, actorId: user.id, entityId: row.id, action: id ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED', details: { paymentMethod: row.paymentMethod } } });
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
      const overlap = await tx.payrollShift.findFirst({ where: { employeeId, startsAt: { lt: endsAt ?? new Date('9999-01-01') }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] } });
      if (overlap) throw new BadRequestException('Смена пересекается с существующей.');
      const row = await tx.payrollShift.create({ data: { employeeId, startsAt, endsAt, workDate: workDate(dto.startsAt), source: 'MANUAL', createdById: user.id, reason: dto.reason } });
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: row.id, action: 'SHIFT_CREATED', details: { employeeId, reason: dto.reason } } });
      return row;
    });
  }

  async shifts(employeeId: string, user: AuthUser) {
    await this.employee(employeeId, user);
    return this.prisma.payrollShift.findMany({ where: { employeeId }, orderBy: { startsAt: 'desc' }, take: 1000 });
  }

  async updateShift(employeeId: string, id: string, dto: PayrollShiftDto, user: AuthUser) {
    const employee = await this.employee(employeeId, user, true);
    const startsAt = this.timestamp(dto.startsAt), endsAt = dto.endsAt ? this.timestamp(dto.endsAt) : null;
    if ((endsAt && endsAt <= startsAt) || !dto.reason.trim()) throw new BadRequestException('Проверьте время и причину.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${employeeId} FOR UPDATE`;
      const previous = await tx.payrollShift.findFirst({ where: { id, employeeId } });
      if (!previous) throw new NotFoundException('Смена не найдена.');
      const date = workDate(dto.startsAt);
      if (await tx.payrollHistorical.findFirst({ where: { employeeId, workDate: date } })) throw new BadRequestException('День уже перенесён из табеля.');
      if (await tx.payrollSettlement.findFirst({ where: { employeeId, workDate: { in: [date, previous.workDate] }, status: 'PAID', key: { startsWith: 'WORK:' } } })) throw new BadRequestException('День уже оплачен. Сначала пересмотрите выплату.');
      if (await tx.payrollShift.findFirst({ where: { employeeId, id: { not: id }, startsAt: { lt: endsAt ?? new Date('9999-01-01') }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] } })) throw new BadRequestException('Смены пересекаются.');
      const row = await tx.payrollShift.update({ where: { id }, data: { startsAt, endsAt, workDate: date, reason: dto.reason, version: { increment: 1 } } });
      await tx.payrollAudit.create({ data: { warehouseId: employee.warehouseId, actorId: user.id, entityId: id, action: 'SHIFT_UPDATED', details: { before: { start: previous.startsAt.toISOString(), end: previous.endsAt?.toISOString() ?? null }, after: { start: startsAt.toISOString(), end: endsAt?.toISOString() ?? null }, reason: dto.reason } } });
      return row;
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
    return this.prisma.payrollHandling.create({ data: { warehouseId: dto.warehouseId, startsAt: this.timestamp(dto.startsAt), operation: dto.operation,
      palletCount: dto.palletCount, reason: dto.reason, createdById: user.id, shares: { create: dto.employeeIds.map(employeeId => ({ employeeId })) } } });
  }

  async confirmHandling(id: string, user: AuthUser) {
    this.scope(user, true);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollHandling" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.payrollHandling.findUnique({ where: { id }, include: { shares: { include: { employee: { include: { rates: true } } } } } });
      if (!row) throw new NotFoundException('Работа не найдена.');
      for (const share of row.shares) await this.employee(share.employeeId, user, true);
      if (row.status === 'CONFIRMED') return row;
      const result = calculateHandling(row.startsAt.toISOString(), Number(row.palletCount), row.shares.map(s => ({ employeeId: s.employeeId,
        rates: s.employee.rates.filter(r => r.kind === 'PALLET').map(r => ({ from: r.startsAt.toISOString(), to: r.endsAt?.toISOString(), kopecks: r.rateKopecks, temporary: r.temporary })) })));
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
    const [rates, shifts, shares, settlements, history] = await Promise.all([
      this.prisma.payrollCondition.findMany({ where: { employeeId } }),
      this.prisma.payrollShift.findMany({ where: { employeeId, workDate: { gte: from, lte: to } }, orderBy: { startsAt: 'asc' } }),
      this.prisma.payrollHandlingShare.findMany({ where: { employeeId, operation: { startsAt: { gte: period.start, lt: period.end } } }, include: { operation: true } }),
      this.prisma.payrollSettlement.findMany({ where: { employeeId, workDate: { gte: from, lte: to } } }),
      this.prisma.payrollHistorical.findMany({ where: { employeeId, workDate: { gte: from, lte: to } } }),
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
        const calculated = calculateWorkDay(day.map(s => ({ start: s.startsAt.toISOString(), end: s.endsAt!.toISOString() })), schedule('HOURLY'));
        rows.push({ key: `WORK:${employeeId}:${date}`, employeeId, date, kind: 'HOURLY', amountKopecks: calculated.amountKopecks,
          workedMs: calculated.workedMs, lunchMs: calculated.lunchMs, status: 'UNPAID', detail: { ...calculated, shifts: day.map(s => ({ id: s.id, start: s.startsAt.toISOString(), end: s.endsAt!.toISOString() })) } });
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
      rows.push({ key: `HANDLING:${op.id}:${employeeId}`, employeeId, date: workDate(op.startsAt.toISOString()), kind: 'PALLET',
        amountKopecks: share.amountKopecks ?? 0, status: op.status === 'CONFIRMED' ? 'UNPAID' : 'REVIEW', detail: { ...op, palletCount: Number(op.palletCount) } });
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
