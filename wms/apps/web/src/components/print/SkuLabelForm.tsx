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
import { previewLamodaLabel, type LamodaPreview } from '../../lib/lamodaLabelPrint';

type SkuLabelFormProps = {
  session: AuthSession;
};

export function SkuLabelForm({ session }: SkuLabelFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [skus, setSkus] = useState<SkuSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [skuCode, setSkuCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<LabelPreview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [template,setTemplate]=useState('standard');
  const [lamodaPreview,setLamodaPreview]=useState<LamodaPreview|null>(null);

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
      const list = await fetchSkus(session.accessToken, { clientId: nextClientId, forPrint: true });
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
    setBarcode('');
    setName('');
    setPreview(null);
    setLamodaPreview(null);
  }

  function changeSku(nextSkuCode: string) {
    setLamodaPreview(null);
    setSkuCode(nextSkuCode);
    setBarcode('');
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
    setLamodaPreview(null);

    try {
      // FIX: the Lamoda preset uses the same complete server renderer as relabeling.
      if(template==='lamoda') {
        if(!selectedSku)throw new Error('Выберите товар клиента.');
        setLamodaPreview(await previewLamodaLabel(session.accessToken,clientId,selectedSku,barcode));
        return;
      }
      const nextPreview = await previewSkuLabel(session.accessToken, {
        skuCode: skuCode.trim(),
        name: (selectedSku?.name ?? name).trim(),
        barcode: barcode || selectedSku?.barcodes.find((barcode) => barcode.isPrimary)?.value || selectedSku?.barcodes[0]?.value,
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
        <label><span>Шаблон этикетки</span><select value={template} onChange={event=>{setTemplate(event.target.value);setPreview(null);setLamodaPreview(null);}}>
          <option value="standard">Обычная</option><option value="lamoda">Лукин · Lamoda · 58 × 40 мм</option>
        </select></label>
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

        {/* FIX: Lamoda is an explicit print option, never the warehouse default. */}
        {selectedSku ? <label><span>Штрихкод для печати</span>
          <select value={barcode || selectedSku.barcodes.find(b => b.isPrimary)?.value || selectedSku.barcodes[0]?.value || ''} onChange={event => setBarcode(event.target.value)}>
            {selectedSku.barcodes.map(b => <option key={b.id} value={b.value}>{b.value}{b.source === 'LAMODA' ? ' · Lamoda' : b.isPrimary ? ' · основной' : ''}</option>)}
          </select></label> : null}
        <label>
          <span>Название</span>
          <input value={selectedSku?.name ?? name} onChange={(event) => setName(event.target.value)} required />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="print-actions">
        <button className="primary-button" type="submit" disabled={!canSubmit || isSubmitting}>
          <FileText size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Готовлю' : template==='lamoda'?'Предпросмотр Lamoda':'Предпросмотр TSPL'}</span>
        </button>
        <button className="primary-button print-secondary" type="button" onClick={() => void loadSkus()} disabled={!clientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить SKU</span>
        </button>
      </div>

      {preview ? <TsplPreviewCard preview={preview} fileName={safeFileName} /> : null}
      {lamodaPreview?<section><img alt="Этикетка Lamoda 58 × 40 мм" src={'data:image/png;base64,'+lamodaPreview.imageBase64} style={{width:348,maxWidth:'100%'}}/><a className="secondary-button" download={lamodaPreview.barcode+'-lamoda-58x40.pdf'} href={'data:application/pdf;base64,'+lamodaPreview.pdfBase64}>Скачать PDF 58 × 40 мм</a></section>:null}
    </form>
  );
}
