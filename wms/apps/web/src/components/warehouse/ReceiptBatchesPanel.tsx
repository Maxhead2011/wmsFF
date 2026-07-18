import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  downloadTurnoverReceiptPeriodXlsx,
  fetchClients,
  fetchReceiptBatches,
  type AuthSession,
  type ClientSummary,
  type ReceiptBatchSummary,
} from '../../lib/api';

export function ReceiptBatchesPanel({ fixedClientId, session }: { fixedClientId?: string; session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [batches, setBatches] = useState<ReceiptBatchSummary[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (fixedClientId) return;
    void fetchClients(session.accessToken).then((rows) => {
      setClients(rows);
      setClientId((current) => current || rows[0]?.id || '');
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов.'));
  }, [fixedClientId, session.accessToken]);

  useEffect(() => {
    if (clientId) void load();
  }, [clientId]);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      setBatches(await fetchReceiptBatches(session.accessToken, clientId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить файлы приемки.');
    } finally {
      setLoading(false);
    }
  }

  async function download(batch: ReceiptBatchSummary) {
    setMessage('');
    try {
      const blob = await downloadTurnoverReceiptPeriodXlsx(session.accessToken, {
        clientId,
        dateFrom: batch.date,
        dateTo: batch.date,
      });
      downloadBlob(blob, `${batch.title}.xlsx`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось скачать приемку.');
    }
  }

  return (
    <div className="receipt-batches">
      <div className="warehouse-drafts__toolbar">
        {!fixedClientId ? (
          <label>
            <span>Клиент</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">Выберите клиента</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
        ) : null}
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={!clientId || loading}>
          <RefreshCw size={15} aria-hidden="true" />
          <span>{loading ? 'Обновление' : 'Обновить'}</span>
        </button>
      </div>
      {message ? <p className="form-error">{message}</p> : null}
      <div className="receipt-batches__list">
        {batches.map((batch) => (
          <div className="receipt-batches__row" key={batch.id}>
            <div>
              <strong>{batch.title}</strong>
              <span>{batch.boxes} коробов · {batch.quantity} шт · КИЗ {batch.kizCount}</span>
            </div>
            <button className="document-open-button" type="button" onClick={() => void download(batch)}>
              <Download size={15} aria-hidden="true" />
              <span>Excel</span>
            </button>
          </div>
        ))}
        {!loading && clientId && batches.length === 0 ? <p className="warehouse-inline">Файлов приемки пока нет.</p> : null}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
