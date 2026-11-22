// FIX: every inspected return is stored but never offered to picking before release.
export const RETURN_STORAGE_STATUS = 'QUARANTINE' as const;
export const RETURN_PROCESSING_SERVICE = 'RETURN_PROCESSING';
export const returnReceiptKey = (unitId: string) => `returns:receipt:${unitId}`;
export const returnChargeKey = (batchId: string) => `returns:processing:${batchId}`;
export const returnConditions: Record<string, string> = {
  NORMAL: 'Нормальное', INCOMPLETE: 'Разнопарка / неполный комплект',
  DAMAGED: 'Испачкан / повреждён', WRONG_ITEM: 'Неверное вложение',
};
