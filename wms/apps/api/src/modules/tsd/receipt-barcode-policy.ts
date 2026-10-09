import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
export const receiptBarcodeReviewEnabled = () => process.env.WMS_RECEIPT_BARCODE_REVIEW_ENABLED === 'true';
// FIX: an existing approved card may intentionally use an internal barcode.
export function receiptBarcodeRisk(code: string, known: boolean): string | null {
  if (known) return null;
  if (!/^\d{12,14}$/.test(code)) return 'Необычная длина или формат неизвестного ШК';
  let total = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) total += Number(code[i]) * weight;
  return (10 - total % 10) % 10 === Number(code.at(-1)) ? null : 'Контрольная цифра неизвестного ШК не совпадает';
}
export function requireReceiptReviewer(user: AuthUser) {
  if (user.isDemo || !user.roleCodes.some(r => r === 'ADMIN' || r === 'OWNER')) throw new ForbiddenException('Разбор доступен администратору и собственнику.');
}
export function isBarcodeReview(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && (payload as Record<string, unknown>).barcodeReview === 'PENDING';
}
