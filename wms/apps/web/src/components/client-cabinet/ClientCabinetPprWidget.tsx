import { useEffect, useState } from 'react';
import { fetchGoodsArrivalEstimate, type GoodsArrivalEstimate } from '../../lib/api';

export function ClientCabinetPprWidget({ accessToken, clientId }: { accessToken: string; clientId: string }) {
  const [data, setData] = useState<GoodsArrivalEstimate | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetchGoodsArrivalEstimate(accessToken, clientId)
      .then((value) => { if (active) { setData(value); setError(''); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать ППР.'); });
    return () => { active = false; };
  }, [accessToken, clientId]);

  return (
    <section className="client-cabinet-storage-widget" aria-label="Ориентировочная стоимость ППР">
      <div className="client-cabinet-storage-widget__heading">
        <div><p className="eyebrow">ППР</p><h3>Ориентировочная стоимость</h3></div>
        <strong>{money(data?.estimatedRub ?? 0)} ₽</strong>
      </div>
      {data ? <p>С {date(data.periodFrom)} по {date(data.periodTo)} · {data.bagCount} мешков · {data.boxCount} коробов</p> : null}
      {data && !data.pricesConfigured ? <p className="form-error">Для клиента не настроены цены ППР.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function date(value: string) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`)); }
function money(value: number) { return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
