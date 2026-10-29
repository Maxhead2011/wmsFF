// FIX: a typed server rejection survives outbox replay; neither text matching nor scanner metadata is authoritative.
export type TsdKizDuplicateDetails = {
  code: 'KIZ_DUPLICATE'; duplicate: true;
  duplicateInfo: Record<string, unknown>;
};
export function receiptConflictDetails(value: unknown): TsdKizDuplicateDetails | undefined {
  if (process.env.WMS_KIZ_CLIENT_GUARD_ENABLED !== 'true' || !value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  if (row.code !== 'KIZ_DUPLICATE' || row.duplicate !== true || !row.duplicateInfo ||
      typeof row.duplicateInfo !== 'object' || Array.isArray(row.duplicateInfo)) return;
  return { code: 'KIZ_DUPLICATE', duplicate: true, duplicateInfo: row.duplicateInfo as Record<string, unknown> };
}
export function receiptConflictFromError(error: unknown): TsdKizDuplicateDetails | undefined {
  const e = error as { getResponse?: () => unknown } | null;
  return typeof e?.getResponse === 'function' ? receiptConflictDetails(e.getResponse()) : undefined;
}
