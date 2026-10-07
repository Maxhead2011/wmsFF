import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// FIX: keep the original invoice and actual receipts immutable; calculate signed corrections in minor units.
export function billingMinor(value: unknown): number {
  const s = String(value);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new BadRequestException('Укажите сумму с точностью до копейки.');
  const [whole, fractional = ''] = s.replace(/^-/, '').split('.');
  const n = (Number(whole) * 100 + Number(fractional.padEnd(2, '0'))) * (s.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(n)) throw new BadRequestException('Сумма превышает допустимый предел.');
  return n;
}
export function correctedInvoiceBalance(total: unknown, paid: unknown, corrections: unknown[]) {
  const original = billingMinor(total), receipts = billingMinor(paid);
  const delta = corrections.reduce<number>((s, c) => { const n = s + billingMinor(c);
    if (!Number.isSafeInteger(n)) throw new BadRequestException('Сумма корректировок превышает допустимый предел.'); return n; }, 0), effective = original + delta;
  if (original < 0 || receipts < 0 || effective < 0 || !Number.isSafeInteger(effective)) throw new BadRequestException('Корректировка не может сделать итоговую стоимость счёта отрицательной.');
  return { originalTotalRub: original / 100, correctionRub: delta / 100, effectiveTotalRub: effective / 100,
    remainingRub: Math.max(0, effective - receipts) / 100, overpaymentRub: Math.max(0, receipts - effective) / 100 };
}
export async function invoiceCorrections(db: { $queryRaw: Function }, ids: string[]) {
  if (process.env.WMS_BILLING_PERIOD_CLOSE_ENABLED !== 'true' || !ids.length) return [] as Array<{ id: string; invoiceId: string; amountRub: unknown; reason: string; createdAt: Date; createdByUserId: string }>;
  return await db.$queryRaw(Prisma.sql`SELECT "id", "invoiceId", "amountRub", "reason", "createdAt", "createdByUserId" FROM "BillingInvoiceCorrection" WHERE "invoiceId" IN (${Prisma.join(ids)}) ORDER BY "createdAt", "id"`) as Array<{ id: string; invoiceId: string; amountRub: unknown; reason: string; createdAt: Date; createdByUserId: string }>;
}
export async function invoiceBalance(db: { $queryRaw: Function }, invoice: { id: string; totalRub: unknown; paidRub: unknown }) {
  if (process.env.WMS_BILLING_PERIOD_CLOSE_ENABLED !== 'true') {
    const total = Number(invoice.totalRub) || 0, paid = Number(invoice.paidRub) || 0;
    return { originalTotalRub: total, correctionRub: 0, effectiveTotalRub: total, remainingRub: Math.max(0, total - paid), overpaymentRub: Math.max(0, paid - total) };
  }
  return correctedInvoiceBalance(invoice.totalRub, invoice.paidRub, (await invoiceCorrections(db, [invoice.id])).map(c => c.amountRub));
}
