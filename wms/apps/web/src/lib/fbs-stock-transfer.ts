import type { RoutedFbsStockTransferResult } from './api';

// FIX: a successful group must never hide an unresolved WB operation in another group.
export function describeStockTransfer(result: RoutedFbsStockTransferResult): string {
  const messages = result.transfers.map(run => run.status === 'CREATED'
    ? `Перенесено ${run.orderCount}: «${run.supplyName}» (${run.supplyId}), заявка №${String(run.requestNumber).padStart(6, '0')}.${run.errorMessage ? ` ${run.errorMessage}. Продолжите сверку в журнале повторной отгрузки.` : ''}`
    : `Перенос ${run.orderCount} заказов требует сверки. Операция ${run.runId}: ${run.errorMessage || 'WB ещё не подтвердил перенос'}. Откройте журнал повторной отгрузки.`);
  if (result.regularTransfer) messages.push(`Перенесено с остатком: ${result.regularTransfer.moved}, поставка ${result.regularTransfer.targetSupply.id}, заявка №${String(result.regularTransfer.targetRequest.number).padStart(6, '0')}.`);
  const skipped = [...result.skippedOrders, ...(result.regularTransfer?.skippedOrders ?? [])];
  if (skipped.length) messages.push(`Не перенесены: ${skipped.map(row => `${row.id} — ${row.reason}`).join('; ')}.`);
  messages.push(...result.errors);
  return messages.join(' ');
}
