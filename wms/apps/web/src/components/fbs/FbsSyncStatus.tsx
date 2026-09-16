import type { FbsDisplaySync } from '../../lib/api';

// FIX: show freshness independently of table contents, including an empty cold-start subset.
export function FbsSyncStatus({ sync }: { sync?: FbsDisplaySync }) {
  if (!sync || (!sync.partial && !sync.refreshing && !sync.error)) return null;
  return <div role="status" className="fbs-source-line">
    {sync.partial ? <span>Показаны только сохранённые активные заявки WMS. Полный список заказов ещё не загружен.</span> : null}
    {sync.refreshing ? <span>Обновляем данные в фоне…</span> : null}
    {sync.error ? <span role="alert">{sync.error}</span> : null}
  </div>;
}
