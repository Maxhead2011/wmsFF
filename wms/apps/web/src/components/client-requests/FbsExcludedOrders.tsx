import type { TsdAssemblyPlan } from '../../lib/api';

// FIX: preserve terminal-order evidence without offering collection or KIZ replacement.
export function FbsExcludedOrders({ rows }: {
  rows: NonNullable<NonNullable<TsdAssemblyPlan['fbsAssembly']>['notForAssembly']>;
}) {
  if (!rows.length) return null;
  return <details className="online-execution-section">
    <summary>Не требуется собирать · {rows.length}</summary>
    <p>Заказы завершены или отменены на WB. Сканы и история сохранены. Возврат на склад автоматически не выполняется; учёт уже взятого товара проверяет менеджер.</p>
    {rows.map(row => <div key={row.id} style={{ padding: '12px 0', borderTop: '1px solid #dbe2ea', overflowWrap: 'anywhere' }}>
      <strong>№{row.orderId} · {row.productName}</strong>
      <div>WB: {row.wbStatus} · Короб: {row.sourceBoxCode || 'не указан'} · Сотрудник: {row.workerName || 'не указан'}</div>
      {row.productBarcode && <div>ШК: {row.productBarcode}</div>}
      {row.kiz && <div>Сохранённый КИЗ: {row.kiz}</div>}
      {row.syncIssue && <div>Историческое сообщение: {row.syncIssue}</div>}
    </div>)}
  </details>;
}
