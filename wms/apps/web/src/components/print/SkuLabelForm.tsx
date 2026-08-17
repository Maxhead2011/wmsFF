import { FileText, RefreshCw } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchSkus,
  previewSkuLabel,
  type AuthSession,
  type ClientSummary,
  type LabelPreview,
  type SkuSummary,
} from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';

type SkuLabelFormProps = {
  session: AuthSession;
};

export function SkuLabelForm({ session }: SkuLabelFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [skus, setSkus] = useState<SkuSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [skuCode, setSkuCode] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<LabelPreview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
  const selectedSku = useMemo(() => skus.find((sku) => sku.internalSku === skuCode) ?? null, [skuCode, skus]);

  useEffect(() => {
    void loadClients();
  }, [session.accessToken]);

  useEffect(() => {
    if (clientId) {
      void loadSkus(clientId);
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

  async function loadSkus(nextClientId = clientId) {
    if (!nextClientId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const list = await fetchSkus(session.accessToken, { clientId: nextClientId });
      setSkus(list);
      setSkuCode((current) => current || list[0]?.internalSku || '');
      setName((current) => current || list[0]?.name || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить SKU.');
    } finally {
      setLoading(false);
    }
  }

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setSkuCode('');
    setName('');
    setPreview(null);
  }

  function changeSku(nextSkuCode: string) {
    setSkuCode(nextSkuCode);
    const sku = skus.find((item) => item.internalSku === nextSkuCode);
    if (sku) {
      setName(sku.name);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setPreview(null);

    try {
      const nextPreview = await previewSkuLabel(session.accessToken, {
        skuCode: skuCode.trim(),
        name: (selectedSku?.name ?? name).trim(),
        barcode: selectedSku?.barcodes.find((barcode) => barcode.isPrimary)?.value ?? selectedSku?.barcodes[0]?.value,
        clientName: selectedClient?.name,
        article: selectedSku?.article ?? undefined,
        color: selectedSku?.color ?? undefined,
        size: selectedSku?.size ?? undefined,
      });
      setPreview(nextPreview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось подготовить SKU-этикетку.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(skuCode.trim() && (selectedSku?.name || name.trim()));
  const safeFileName = `${skuCode.trim() || 'sku'}-label.tspl`.replace(/[\\/:*?"<>|]/g, '_');

  return (
    <form className="print-form" onSubmit={submit}>
      <div className="print-fields print-fields--sku">
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
          <span>SKU</span>
          <input list="print-skus" value={skuCode} onChange={(event) => changeSku(event.target.value)} required />
          <datalist id="print-skus">
            {skus.map((sku) => (
              <option key={sku.id} value={sku.internalSku}>
                {sku.name}
              </option>
            ))}
          </datalist>
        </label>

        <label>
          <span>Название</span>
          <input value={selectedSku?.name ?? name} onChange={(event) => setName(event.target.value)} required />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="print-actions">
        <button className="primary-button" type="submit" disabled={!canSubmit || isSubmitting}>
          <FileText size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL'}</span>
        </button>
        <button className="primary-button print-secondary" type="button" onClick={() => void loadSkus()} disabled={!clientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить SKU</span>
        </button>
      </div>

      {preview ? <TsplPreviewCard preview={preview} fileName={safeFileName} /> : null}
    </form>
  );
}
