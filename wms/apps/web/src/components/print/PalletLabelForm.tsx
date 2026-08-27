import { FileText, RefreshCw } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchPallets,
  previewPalletLabel,
  type AuthSession,
  type ClientSummary,
  type LabelPreview,
  type WarehousePalletSummary,
} from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';

type PalletLabelFormProps = {
  session: AuthSession;
};

export function PalletLabelForm({ session }: PalletLabelFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [pallets, setPallets] = useState<WarehousePalletSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [palletCode, setPalletCode] = useState('');
  const [boxesCount, setBoxesCount] = useState('0');
  const [preview, setPreview] = useState<LabelPreview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
  const selectedPallet = useMemo(() => pallets.find((pallet) => pallet.code === palletCode) ?? null, [palletCode, pallets]);

  useEffect(() => {
    void loadClients();
  }, [session.accessToken]);

  useEffect(() => {
    if (clientId) {
      void loadPallets(clientId);
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

  async function loadPallets(nextClientId = clientId) {
    if (!nextClientId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const list = await fetchPallets(session.accessToken, { clientId: nextClientId });
      setPallets(list);
      setPalletCode((current) => current || list[0]?.code || '');
      setBoxesCount((current) => (current === '0' && list[0] ? String(list[0].boxes.length) : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить паллеты.');
    } finally {
      setLoading(false);
    }
  }

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setPalletCode('');
    setBoxesCount('0');
    setPreview(null);
  }

  function changePallet(nextPalletCode: string) {
    setPalletCode(nextPalletCode);
    const pallet = pallets.find((item) => item.code === nextPalletCode);
    if (pallet) {
      setBoxesCount(String(pallet.boxes.length));
    }
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
      const parsedBoxes = Number(boxesCount);
      const nextPreview = await previewPalletLabel(session.accessToken, {
        palletCode: palletCode.trim(),
        clientName: selectedClient.name,
        zoneCode: selectedPallet?.zone?.code,
        boxesCount: Number.isFinite(parsedBoxes) && parsedBoxes >= 0 ? parsedBoxes : 0,
      });
      setPreview(nextPreview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось подготовить паллетную этикетку.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(selectedClient && palletCode.trim());
  const safeFileName = `${palletCode.trim() || 'pallet'}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');

  return (
    <form className="print-form" onSubmit={submit}>
      <div className="print-fields print-fields--pallet">
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
          <span>Паллета</span>
          <input list="print-pallets" value={palletCode} onChange={(event) => changePallet(event.target.value)} required />
          <datalist id="print-pallets">
            {pallets.map((pallet) => (
              <option key={pallet.id} value={pallet.code} />
            ))}
          </datalist>
        </label>

        <label>
          <span>Коробов</span>
          <input min="0" step="1" type="number" value={boxesCount} onChange={(event) => setBoxesCount(event.target.value)} />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="print-actions">
        <button className="primary-button" type="submit" disabled={!canSubmit || isSubmitting}>
          <FileText size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL'}</span>
        </button>
        <button className="primary-button print-secondary" type="button" onClick={() => void loadPallets()} disabled={!clientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить паллеты</span>
        </button>
      </div>

      {preview ? <TsplPreviewCard preview={preview} fileName={safeFileName} /> : null}
    </form>
  );
}
