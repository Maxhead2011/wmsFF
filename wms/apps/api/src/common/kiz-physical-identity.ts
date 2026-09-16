import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const kizIdentityTransferEnabled = () => process.env.WMS_KIZ_IDENTITY_TRANSFER_ENABLED === 'true';

// FIX: apparel identity is GTIN + the case-sensitive 13-character serial.
// Only the known 91/92 suffix may omit GS; arbitrary longer serials are not truncated.
export function physicalKizIdentity(value: string): string {
  const normalized = value.trim().replace(/^\]d2/i, '').replace(/<GS>/gi, '\u001d');
  return /^(01\d{14}21[^\u0000-\u001f]{13})(?=$|\u001d|91[^\u0000-\u001f]{4}(?:\u001d)?92)/.exec(normalized)?.[1] ?? '';
}

export async function findPhysicalKizId(db: Prisma.TransactionClient, value: string): Promise<string | null | undefined> {
  if (!kizIdentityTransferEnabled()) return undefined;
  const identity = physicalKizIdentity(value);
  if (!identity) return undefined;
  const rows = await db.productMark.findMany({ where: { OR: [identity, ']d2' + identity, ']D2' + identity]
    .map(prefix => ({ value: { startsWith: prefix } })) }, select: { id: true, value: true } });
  const matching = rows.filter(row => physicalKizIdentity(row.value) === identity);
  if (matching.length > 1) throw new ConflictException('В WMS несколько записей одного КИЗ. Нужен разбор дублей администратором; товар не списан.');
  return matching[0]?.id ?? null;
}

// FIX: retain the caller's historical matching mode when our opt-in flag is off.
export async function physicalKizLookup(db: Prisma.TransactionClient, value: string, insensitive = true): Promise<Prisma.ProductMarkWhereInput> {
  const id = await findPhysicalKizId(db, value);
  return id === undefined ? { value: insensitive ? { equals: value, mode: 'insensitive' } : value }
    : id === null ? { id: { in: [] } } : { id };
}

// FIX: the same format-independent identity must also protect active orders and WB history.
export function physicalKizHistoryFilter(value: string): { kiz: Prisma.StringFilter } | { OR: Array<{ kiz: Prisma.StringFilter }> } {
  const identity = kizIdentityTransferEnabled() ? physicalKizIdentity(value) : '';
  return identity ? { OR: [identity, ']d2' + identity, ']D2' + identity].map(prefix => ({ kiz: { startsWith: prefix } })) }
    : { kiz: { equals: value, mode: 'insensitive' } };
}
