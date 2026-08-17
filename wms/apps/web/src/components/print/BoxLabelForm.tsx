import { FileText, RefreshCw } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchBoxes,
  fetchClients,
  previewBoxLabel,
  type AuthSession,
  type BoxLabelPreview,
  type ClientSummary,
  type WarehouseBoxSummary,
} from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';

type BoxLabelFormProps = {
  session: AuthSession;
};

export function BoxLabelForm({ session }: BoxLabelFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [boxes, setBoxes] = useState<WarehouseBoxSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [boxCode, setBoxCode] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [preview, setPreview] = useState<BoxLabelPreview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) ?? null,
    [clientId, clients],
  );

  useEffect(() => {
    void loadClients();
  }, [session.accessToken]);

  useEffect(() => {
    if (clientId) {
      void loadBoxes(clientId);
    }
  }, [clientId]);

  async function loadClients() {
    setLoading(true);
    setError('');

    try {
      const list = await fetchClients(session.accessToken);
      setClients(list);
      setClientId((current) => current || list[0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
    } finally {
      setLoading(false);
    }
  }

  async function loadBoxes(nextClientId = clientId) {
    if (!nextClientId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const list = await fetchBoxes(session.accessToken, { clientId: nextClientId });
      setBoxes(list);
      setBoxCode((current) => current || list[0]?.code || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить короба.');
    } finally {
      setLoading(false);
    }
  }

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setBoxCode('');
    setPreview(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient) {
      return;
    }

    setSubmitting(true);
    setError('');
    setPreview(null);

    try {
      const parsedQuantity = Number(quantity);
      const nextPreview = await previewBoxLabel(session.accessToken, {
        boxCode: boxCode.trim(),
        clientName: selectedClient.name,
        // Русский комментарий: quantity в шаблоне означает количество строк внутри короба, а не остаток SKU.
        quantity: Number.isFinite(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : 0,
      });
      setPreview(nextPreview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось подготовить этикетку.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(selectedClient && boxCode.trim());
  const safeFileName = `${boxCode.trim() || 'box'}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');

  return (
    <form className="print-form" onSubmit={submit}>
      <div className="print-fields">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => changeClient(event.target.value)} disabled={isLoading}>
            {clients.length === 0 ? <option value="">Клиенты не найдены</option> : null}
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} - {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Короб</span>
          <input list="print-boxes" value={boxCode} onChange={(event) => setBoxCode(event.target.value)} required />
          <datalist id="print-boxes">
            {boxes.map((box) => (
              <option key={box.id} value={box.code} />
            ))}
          </datalist>
        </label>

        <label>
          <span>Кол-во строк</span>
          <input min="0" step="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="print-actions">
        <button className="primary-button" type="submit" disabled={!canSubmit || isSubmitting}>
          <FileText size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL'}</span>
        </button>
        <button className="primary-button print-secondary" type="button" onClick={() => void loadBoxes()} disabled={!clientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить короба</span>
        </button>
      </div>

      {preview ? <TsplPreviewCard preview={preview} fileName={safeFileName} /> : null}
    </form>
  );
}
