import { useCallback, useEffect, useState } from 'react';
import { fetchWbSyncHealth, type AuthSession, type WbSyncHealthResponse } from '../../lib/api';

const time = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'Нет данных';
// FIX: display the latest worker and the last successful verification separately.
export function WbSyncHealthPanel({ session }: { session: AuthSession }) {
  const [data, setData] = useState<WbSyncHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchWbSyncHealth(session.accessToken)); setError(''); }
    catch { setError('Не удалось обновить монитор. Показанные данные могут быть устаревшими.'); }
    finally { setLoading(false); }
  }, [session.accessToken]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  return <section className="wb-sync-health" aria-label="Синхронизация WB">
    <header><div><h2>Синхронизация WB</h2><p>Контроль раз в час. При проблеме — проверка следующего цикла. Время московское.</p></div>
      <button type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Обновление…' : 'Обновить экран'}</button></header>
    {error && <p role="alert">{error}</p>}
    {data && !data.enabled && <p>Контроль синхронизации ещё не включён на сервере.</p>}
    {data?.enabled && !data.items.length && <p>Ожидаем первый цикл. История начнёт накапливаться после включения контроля.</p>}
    {data?.items.map(item => <article key={item.clientId}>
      <h3>{item.clientName} — {!item.active ? 'Автоуправление выключено' : item.incidentAt ? 'Требуется проверка' : item.lastSuccessAt ? 'Последняя проверка успешна' : 'Ожидание проверки'}</h3>
      <p>Последняя успешная проверка: <strong>{time(item.lastSuccessAt)}</strong>. Следующая: {item.incidentAt ? 'после следующего цикла' : time(item.nextCheckAt)}.</p>
      {item.incidentAt && <p role="status">Проблема с {time(item.incidentAt)}. Проверок с ошибкой: {item.failures}.</p>}
      <div className="wb-sync-health__scroll"><table><thead><tr><th>Начало / завершение</th><th>Заказы</th><th>Биллинг</th><th>Подтверждение WB</th></tr></thead>
        <tbody>{item.cycles.map(cycle => <tr key={cycle.id}><td>{time(cycle.startedAt)}<br />{cycle.finishedAt ? time(cycle.finishedAt) : 'В работе / завершение не зафиксировано'}</td>
          <td>{cycle.orders}{cycle.error && <p>{cycle.error}</p>}</td><td>{cycle.billing}</td>
          <td>{!cycle.finishedAt ? 'Ожидание завершения' : !cycle.connections.length ? 'Нет доказательств синхронизации' : cycle.connections.map(connection => <div key={connection.id}>
            <strong>{connection.proof.success ? 'Подтверждено' : 'Не подтверждено полностью'}</strong>
            <p>Совпало: {connection.proof.confirmed} · Расхождения: {connection.proof.mismatch} · Не подтверждено: {connection.proof.unconfirmed} · Неизвестные: {connection.proof.unknown}</p>
            <details><summary>Запуск проверки</summary>{connection.proof.runIds.join(', ') || 'Свежих записей нет'}</details>
          </div>)}</td></tr>)}</tbody></table></div>
    </article>)}
  </section>;
}
