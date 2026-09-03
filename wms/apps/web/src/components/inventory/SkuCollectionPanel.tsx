import { FormEvent, useEffect, useState } from 'react';
import { Boxes, Search } from 'lucide-react';
import {
  createSkuCollection,
  searchSkuCollectionCandidates,
  type AuthSession,
  type ClientSummary,
  type SkuCollectionCandidate,
} from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';

export function SkuCollectionPanel({ session, clients }: { session: AuthSession; clients: ClientSummary[] }) {
  const [clientId, setClientId] = useRememberedClientId(session.user.id, { initialClientId: clients[0]?.id ?? '' });
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SkuCollectionCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [creatingId, setCreatingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (clientId && clients.some((client) => client.id === clientId)) return;
    setClientId(clients[0]?.id ?? '');
  }, [clientId, clients, setClientId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clientId || !search.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setRows(await searchSkuCollectionCandidates(session.accessToken, clientId, search.trim()));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function create(row: SkuCollectionCandidate) {
    setCreatingId(row.id);
    setError('');
    setMessage('');
    try {
      const request = await createSkuCollection(session.accessToken, clientId, row.id);
      setMessage(`Заявка №${String(request.number).padStart(6, '0')} создана и выделена оранжевым в общем списке. На ТСД откройте «Инвентаризация → Сборка по SKU».`);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreatingId('');
    }
  }

  return (
    <div className="sku-collection">
      <div className="inventory-alert">
        <Boxes size={20} />
        <div>
          <strong>Внутренняя пересборка маркированного товара</strong>
          <span>Созданная заявка резервирует весь доступный остаток выбранного SKU. Сборщик сканирует исходный короб, ШК и КИЗ; затем принимает тот же КИЗ в новый короб.</span>
        </div>
      </div>
      <form className="sku-collection__search" onSubmit={submit}>
        <label className="inventory-field">
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label className="inventory-field">
          <span>ШК, название, артикул или SKU</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Введите часть названия или отсканируйте ШК" />
        </label>
        <button className="primary-button" type="submit" disabled={busy || !clientId || !search.trim()}>
          <Search size={16} /> {busy ? 'Ищу…' : 'Найти'}
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {rows.length ? (
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead><tr><th>Товар</th><th>ШК</th><th>В наличии</th><th>Короба</th><th /></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.name}</strong><small>{[row.article, row.color, row.size].filter(Boolean).join(' · ')}</small></td>
                <td>{row.barcodes[0] ?? row.internalSku}</td>
                <td><strong>{row.availableQuantity}</strong></td>
                <td>{row.boxes.map((box) => `${box.code} — ${box.quantity} шт.`).join(', ')}</td>
                <td><button className="primary-button" type="button" disabled={Boolean(creatingId)} onClick={() => void create(row)}>{creatingId === row.id ? 'Создаю…' : 'Собрать'}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : !busy && search ? <p className="muted">Подходящих доступных товаров в коробах не найдено.</p> : null}
    </div>
  );
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
