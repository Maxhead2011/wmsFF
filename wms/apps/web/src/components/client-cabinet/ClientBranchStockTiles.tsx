import { Boxes, MapPinned, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchBranchStockSummary, type BranchStockSummary } from '../../lib/api';

export function ClientBranchStockTiles({
  accessToken,
  clientId,
}: {
  accessToken: string;
  clientId: string;
}) {
  const [rows, setRows] = useState<BranchStockSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await fetchBranchStockSummary(accessToken, clientId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [accessToken, clientId]);

  return (
    <section className="client-branch-stock">
      <div className="client-branch-stock__heading">
        <div>
          <p className="eyebrow">География хранения</p>
          <h3>Остатки по городам</h3>
          <span>Видно, сколько товара клиента находится в каждом подразделении ФФ.</span>
        </div>
        <button className="icon-button" type="button" onClick={() => void load()} aria-label="Обновить остатки по городам">
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="client-branch-stock__grid">
        {rows.map((row) => (
          <article key={row.warehouse.id}>
            <span className="client-branch-stock__icon"><MapPinned size={20} /></span>
            <div><strong>{row.warehouse.city}</strong><small>{row.warehouse.name}</small></div>
            <b>{row.totalQuantity.toLocaleString('ru-RU')} шт.</b>
            <span className="client-branch-stock__detail"><Boxes size={14} /> {row.skuCount} SKU · доступно {row.availableQuantity.toLocaleString('ru-RU')}</span>
            {row.incomingInTransitQuantity > 0 ? (
              <span className="client-branch-stock__detail">
                В пути в город: {row.incomingInTransitQuantity.toLocaleString('ru-RU')} шт.
              </span>
            ) : null}
            {row.outgoingInTransitQuantity > 0 ? (
              <span className="client-branch-stock__detail">
                Отправлено из города: {row.outgoingInTransitQuantity.toLocaleString('ru-RU')} шт.
              </span>
            ) : null}
          </article>
        ))}
        {!loading && rows.length === 0 ? <p className="muted">Товар пока не размещён ни в одном городе.</p> : null}
        {loading && rows.length === 0 ? <p className="muted">Загружаю остатки по филиалам…</p> : null}
      </div>
    </section>
  );
}
