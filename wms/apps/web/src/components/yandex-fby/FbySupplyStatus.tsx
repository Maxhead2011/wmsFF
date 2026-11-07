// FIX: distinguish the marketplace status from the WMS assembly stage and retain check time.
export function FbySupplyStatus({ status, checkedAt }: { status: string | null; checkedAt: string | null }) {
  const date = checkedAt ? new Date(checkedAt) : null;
  return <p>Статус Яндекса: <strong>{status || 'Ещё не проверен'}</strong>
    {date && Number.isFinite(date.getTime()) && <> · Проверено {date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</>}
    <small>Обновляется по кнопке «Сверить с Яндексом».</small>
  </p>;
}
