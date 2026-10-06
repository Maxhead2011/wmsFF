import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, PayrollShift, PayrollHandling, PayrollHandlingShare, PayrollSettlement } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import type { PayrollHandlingDto, PayrollShiftDto } from './payroll.dto';
import { handlingQuantities } from './handling-quantities';
import { workDate } from './payroll-calculation';

type Tx = Prisma.TransactionClient;
type Scope = Prisma.PayrollEmployeeWhereInput;
type Json<T> = T extends Date ? string : T extends Array<infer U> ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
const plain = <T>(v: T): Json<T> => JSON.parse(JSON.stringify(v));
function ordered(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordered);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, ordered(value)]));
  return v;
}
export const correctionHash = (v: unknown) => createHash('sha256').update(JSON.stringify(ordered(plain(v)))).digest('hex');
type Day = { employeeId: string; workDate: string; lunchMinutes: number | null; exists: boolean };
type Snapshot = {
  kind: 'SHIFT' | 'HANDLING'; id: string; employeeIds: string[]; dates: string[];
  shift?: Json<PayrollShift>; handling?: Json<Omit<PayrollHandling, 'palletCount'>> & { palletCount: string; shares: PayrollHandlingShare[] };
  days: Day[]; settlements: Json<PayrollSettlement>[]; contextHash: string;
};
type Correction = { schema: 1; before: Snapshot; after: Snapshot; reason: string; names: Record<string, string> };
const reasonRequired = (reason: string) => { if (!reason?.trim() || reason.length > 1000) throw new BadRequestException('Укажите причину изменения (до 1000 символов).'); };
export function requireCorrections() {
  if (process.env.WMS_PAYROLL_CORRECTIONS_ENABLED !== 'true') throw new NotFoundException('История исправлений не включена.');
}
const timestamp = (v: string) => { const d = new Date(v); if (!Number.isFinite(d.getTime())) throw new BadRequestException('Некорректное время.'); return d; };

// FIX: corrections and undo share employee locks with payments/tablets; snapshots are committed in the same transaction.
export class PayrollCorrections {
  constructor(private readonly db: PrismaService, private readonly user: AuthUser, private readonly scope: Scope) {}
  private transaction<T>(fn: (tx: Tx) => Promise<T>) {
    requireCorrections();
    return this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 }).catch((e: unknown) => {
      if ((e as { code?: string }).code === 'P2034') throw new ConflictException('Запись изменяется одновременно. Обновите табель и повторите.');
      throw e;
    });
  }
  private async people(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    for (const id of unique) await tx.$queryRaw`SELECT id FROM "PayrollEmployee" WHERE id = ${id} FOR UPDATE`;
    const people = await tx.payrollEmployee.findMany({ where: { AND: [this.scope, { id: { in: unique } }] } });
    if (people.length !== unique.length || new Set(people.map(p => p.warehouseId)).size !== 1) throw new BadRequestException('Сотрудники недоступны или относятся к разным филиалам.');
    return people;
  }
  private async snapshot(tx: Tx, kind: Snapshot['kind'], id: string, employeeIds: string[], dates: string[]): Promise<Snapshot> {
    const s: Snapshot = { kind, id, employeeIds: [...employeeIds].sort(), dates: [...dates].sort(), days: [], settlements: [], contextHash: '' };
    let keys: string[];
    if (kind === 'SHIFT') {
      const shift = await tx.payrollShift.findUniqueOrThrow({ where: { id } }); s.shift = plain(shift);
      for (const employeeId of s.employeeIds) for (const workDate of s.dates) {
        const day = await tx.payrollWorkDay.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
        s.days.push({ employeeId, workDate, exists: !!day, lunchMinutes: day?.lunchMinutes ?? null });
      }
      const surrounding = await tx.payrollShift.findMany({ where: { employeeId: { in: employeeIds }, workDate: { in: dates } }, include: { breaks: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
      // Include the target's breaks but its row is already captured above.
      s.contextHash = correctionHash(surrounding.map(row => row.id === id ? { id, breaks: row.breaks } : row));
      keys = s.days.map(d => `WORK:${d.employeeId}:${d.workDate}`);
    } else {
      const row = await tx.payrollHandling.findUniqueOrThrow({ where: { id }, include: { shares: { orderBy: { employeeId: 'asc' } } } });
      s.handling = { ...plain(row), palletCount: row.palletCount.toString() };
      keys = employeeIds.map(employeeId => `HANDLING:${id}:${employeeId}`);
    }
    s.settlements = plain(await tx.payrollSettlement.findMany({ where: { key: { in: keys } }, orderBy: { key: 'asc' } }));
    return s;
  }
  private unpaid(s: Snapshot) { if (s.settlements.some(r => r.status === 'PAID')) throw new BadRequestException('Запись уже оплачена. Сначала пересмотрите выплату.'); }
  private async review(tx: Tx, keys: Array<{ key: string; employeeId: string; workDate: string }>, warehouseId: string, reason: string) {
    for (const row of keys) {
      const data = { ...row, warehouseId, status: 'REVIEW', comment: reason, updatedById: this.user.id, paidAt: null, snapshot: {} };
      await tx.payrollSettlement.upsert({ where: { key: row.key }, create: data, update: data });
    }
  }
  private async audit(tx: Tx, before: Snapshot, after: Snapshot, warehouseId: string, reason: string, names: Record<string, string>) {
    const details: Correction = { schema: 1, before, after, reason, names };
    await tx.payrollAudit.create({ data: { warehouseId, actorId: this.user.id, entityId: before.id, action: `${before.kind}_CORRECTED`, details: plain(details) as unknown as Prisma.InputJsonValue } });
  }
  async shift(employeeId: string, id: string, dto: PayrollShiftDto) {
    reasonRequired(dto.reason);
    const target = dto.employeeId || employeeId, startsAt = timestamp(dto.startsAt), endsAt = dto.endsAt ? timestamp(dto.endsAt) : null;
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('Окончание должно быть позже начала.');
    return this.transaction(async tx => {
      const ids = [...new Set([employeeId, target])], people = await this.people(tx, ids);
      const previous = await tx.payrollShift.findFirst({ where: { id, employeeId, cancelledAt: null }, include: { breaks: true } });
      if (!previous) throw new NotFoundException('Смена не найдена. Обновите табель.');
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== previous.version) throw new ConflictException('Смена уже изменена. Обновите табель.');
      if (target !== employeeId && (!previous.endsAt || !endsAt || !people.find(p => p.id === target)?.isActive)) throw new BadRequestException('Перенести можно закрытую смену активному сотруднику.');
      if (previous.breaks.some(b => b.startsAt < startsAt || (endsAt && (!b.endsAt || b.endsAt > endsAt)))) throw new BadRequestException('Интервал смены должен включать все отметки обеда.');
      const date = workDate(startsAt.toISOString()), dates = [...new Set([date, previous.workDate])];
      const before = await this.snapshot(tx, 'SHIFT', id, ids, dates); this.unpaid(before);
      if (await tx.payrollHistorical.findFirst({ where: { employeeId: target, workDate: date } })) throw new BadRequestException('У сотрудника за этот день уже есть импортированный табель.');
      if (await tx.payrollShift.findFirst({ where: { employeeId: target, id: { not: id }, cancelledAt: null, startsAt: { lt: endsAt ?? new Date('9999-01-01') }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] } })) throw new BadRequestException('Смена пересекается со сменой получателя.');
      let lunch = dto.lunchMinutes;
      const sourceDay = before.days.find(d => d.employeeId === employeeId && d.workDate === previous.workDate)!;
      if (target !== employeeId) {
        const others = await tx.payrollShift.count({ where: { id: { not: id }, cancelledAt: null, OR: [{ employeeId, workDate: previous.workDate }, { employeeId: target, workDate: date }] } });
        const targetDay = before.days.find(d => d.employeeId === target && d.workDate === date)!;
        if (others && (sourceDay.lunchMinutes !== null || targetDay.lunchMinutes !== null || lunch != null)) throw new BadRequestException('Обед задан на весь день с несколькими сменами. Сначала уберите ручную корректировку обеда или исправьте смены отдельно.');
        if (lunch === undefined) lunch = sourceDay.lunchMinutes;
      }
      const row = await tx.payrollShift.update({ where: { id }, data: { employeeId: target, startsAt, endsAt, workDate: date, reason: dto.reason, version: { increment: 1 } } });
      for (const day of before.days) {
        const shifts = await tx.payrollShift.findMany({ where: { employeeId: day.employeeId, workDate: day.workDate, cancelledAt: null } });
        const key = { employeeId: day.employeeId, workDate: day.workDate };
        if (!shifts.length) { await tx.payrollWorkDay.deleteMany({ where: key }); continue; }
        const requested = day.employeeId === target && day.workDate === date && lunch !== undefined ? lunch : day.lunchMinutes;
        if (requested != null && (!Number.isSafeInteger(requested) || requested < 0 || (!shifts.some(s => !s.endsAt) && requested * 60000 > shifts.reduce((sum, s) => sum + s.endsAt!.getTime() - s.startsAt.getTime(), 0)))) throw new BadRequestException('Обед превышает время смен или указан неверно.');
        if (day.exists || requested !== null) await tx.payrollWorkDay.upsert({ where: { employeeId_workDate: key }, create: { ...key, lunchMinutes: requested }, update: { lunchMinutes: requested } });
      }
      const affected = [{ employeeId, workDate: previous.workDate }, { employeeId: target, workDate: date }];
      await this.review(tx, affected.map(d => ({ ...d, key: `WORK:${d.employeeId}:${d.workDate}` })), people[0].warehouseId, dto.reason);
      await this.audit(tx, before, await this.snapshot(tx, 'SHIFT', id, ids, dates), people[0].warehouseId, dto.reason, Object.fromEntries(people.map(p => [p.id, p.name])));
      return row;
    });
  }
  async handling(id: string, dto: PayrollHandlingDto) {
    reasonRequired(dto.reason);
    if (!dto.employeeIds.length || new Set(dto.employeeIds).size !== dto.employeeIds.length) throw new BadRequestException('Выберите разных участников.');
    const startsAt = timestamp(dto.startsAt);
    return this.transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollHandling" WHERE id = ${id} FOR UPDATE`;
      const previous = await tx.payrollHandling.findUnique({ where: { id }, include: { shares: { orderBy: { employeeId: 'asc' } } } });
      if (!previous) throw new NotFoundException('Работа не найдена.');
      const ids = [...new Set([...previous.shares.map(s => s.employeeId), ...dto.employeeIds])], people = await this.people(tx, ids);
      if (previous.warehouseId !== dto.warehouseId || people.some(p => p.warehouseId !== previous.warehouseId)) throw new BadRequestException('Нельзя менять филиал работы.');
      if (previous.status === 'CANCELLED') throw new BadRequestException('Работа отменена.');
      if (people.some(p => dto.employeeIds.includes(p.id) && !p.isActive && !previous.shares.some(s => s.employeeId === p.id))) throw new BadRequestException('Новый участник должен быть активным.');
      if (dto.expectedState && dto.expectedState !== correctionHash(previous)) throw new ConflictException('Работа уже изменена. Обновите табель.');
      const before = await this.snapshot(tx, 'HANDLING', id, ids, []); this.unpaid(before);
      let quantities;
      try { quantities = handlingQuantities({ pallets: dto.palletCount, boxes: dto.boxCount ?? previous.boxCount, bags: dto.bagCount ?? previous.bagCount, rolls: dto.rollCount ?? previous.rollCount }); } catch (e) { throw new BadRequestException((e as Error).message); }
      const row = await tx.payrollHandling.update({ where: { id }, data: { startsAt, operation: dto.operation, ...quantities, reason: dto.reason, status: 'REVIEW', confirmedAt: null, confirmedById: null,
        shares: { deleteMany: {}, create: dto.employeeIds.map(employeeId => ({ employeeId })) } } });
      // All previous amounts are invalid until the corrected work has been confirmed again.
      await tx.payrollSettlement.deleteMany({ where: { key: { in: ids.map(employeeId => `HANDLING:${id}:${employeeId}`) } } });
      await this.audit(tx, before, await this.snapshot(tx, 'HANDLING', id, ids, []), previous.warehouseId, dto.reason, Object.fromEntries(people.map(p => [p.id, p.name])));
      return row;
    });
  }
  async undo(id: string, reason: string) {
    reasonRequired(reason);
    return this.transaction(async tx => {
      const entry = await tx.payrollAudit.findUnique({ where: { id } });
      const details = entry?.details as unknown as Correction;
      if (!entry || !['SHIFT_CORRECTED', 'HANDLING_CORRECTED'].includes(entry.action) || details?.schema !== 1) throw new BadRequestException('Для этой старой записи нет полного снимка отката.');
      const { before, after } = details;
      if (before.kind === 'HANDLING') await tx.$queryRaw`SELECT id FROM "PayrollHandling" WHERE id = ${before.id} FOR UPDATE`;
      const people = await this.people(tx, before.employeeIds);
      if (people.some(p => p.warehouseId !== entry.warehouseId)) throw new NotFoundException('Изменение недоступно.');
      if (await tx.payrollAudit.findFirst({ where: { entityId: entry.id, action: 'CORRECTION_UNDONE' } })) throw new ConflictException('Это изменение уже отменено.');
      const current = await this.snapshot(tx, before.kind, before.id, before.employeeIds, before.dates); this.unpaid(current);
      if (correctionHash(current) !== correctionHash(after)) throw new ConflictException('После этого исправления данные изменились. Отмена затронула бы более поздние изменения.');
      if (before.kind === 'SHIFT') {
        const old = before.shift!;
        if (await tx.payrollHistorical.findFirst({ where: { employeeId: old.employeeId, workDate: old.workDate } })) throw new ConflictException('За этот день появился импортированный табель.');
        if (await tx.payrollShift.findFirst({ where: { employeeId: old.employeeId, id: { not: old.id }, cancelledAt: null, startsAt: { lt: old.endsAt ? new Date(old.endsAt) : new Date('9999-01-01') }, OR: [{ endsAt: null }, { endsAt: { gt: new Date(old.startsAt) } }] } })) throw new ConflictException('Возвращаемая смена пересекается с другой сменой.');
        await tx.payrollShift.update({ where: { id: old.id }, data: { employeeId: old.employeeId, startsAt: new Date(old.startsAt), endsAt: old.endsAt ? new Date(old.endsAt) : null, workDate: old.workDate, reason: old.reason, version: { increment: 1 } } });
        for (const d of before.days) {
          const key = { employeeId: d.employeeId, workDate: d.workDate };
          if (d.exists) await tx.payrollWorkDay.upsert({ where: { employeeId_workDate: key }, create: { ...key, lunchMinutes: d.lunchMinutes }, update: { lunchMinutes: d.lunchMinutes } });
          else await tx.payrollWorkDay.deleteMany({ where: key });
        }
      } else {
        const old = before.handling!;
        await tx.payrollHandling.update({ where: { id: old.id }, data: { startsAt: new Date(old.startsAt), operation: old.operation, palletCount: old.palletCount, boxCount: old.boxCount, bagCount: old.bagCount, rollCount: old.rollCount, unitRateKopecks: old.unitRateKopecks, status: old.status, reason: old.reason, confirmedAt: old.confirmedAt ? new Date(old.confirmedAt) : null, confirmedById: old.confirmedById,
          shares: { deleteMany: {}, create: old.shares.map(s => ({ employeeId: s.employeeId, amountKopecks: s.amountKopecks })) } } });
      }
      const keys = before.kind === 'SHIFT' ? before.days.map(d => `WORK:${d.employeeId}:${d.workDate}`) : before.employeeIds.map(p => `HANDLING:${before.id}:${p}`);
      await tx.payrollSettlement.deleteMany({ where: { key: { in: keys } } });
      for (const s of before.settlements) await tx.payrollSettlement.create({ data: { ...s, paidAt: s.paidAt ? new Date(s.paidAt) : null, updatedAt: new Date(s.updatedAt), snapshot: s.snapshot as Prisma.InputJsonValue } });
      await tx.payrollAudit.create({ data: { warehouseId: entry.warehouseId, actorId: this.user.id, entityId: entry.id, action: 'CORRECTION_UNDONE', details: { reason, originalId: entry.id, entityId: before.id, employeeIds: before.employeeIds } } });
      return { undone: entry.id };
    });
  }
}
