import { FileText, Printer, RefreshCw } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchPallets,
  fetchPrintAgentStations,
  fetchPrintPrinters,
  createPrintAgentCustomJob,
  createLabelTemplate,
  createPrintJobFromTemplate,
  previewPalletLabel,
  type AuthSession,
  type ClientSummary,
  type LabelPreview,
  type WarehousePalletSummary,
  type PrintAgentStationSummary,
  type PrintPrinterSummary,
} from '../../lib/api';
import { TsplPreviewCard } from './TsplPreviewCard';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { renderSortReferencePng, sortReferenceTspl } from '../../lib/sortReferenceLabel';

type PalletLabelFormProps = {
  session: AuthSession;
};

export function PalletLabelForm({ session }: PalletLabelFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [pallets, setPallets] = useState<WarehousePalletSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [palletCode, setPalletCode] = useState('');
  const [style, setStyle] = useState<'regular' | 'reference'>('regular');
  const [stations, setStations] = useState<PrintAgentStationSummary[]>([]);
  const [printers, setPrinters] = useState<PrintPrinterSummary[]>([]);
  const [destination, setDestination] = useState('');
  const [copies, setCopies] = useState('1');
  const [referencePreview, setReferencePreview] = useState('');
  const [message, setMessage] = useState('');
  const [boxesCount, setBoxesCount] = useState('0');
  const [preview, setPreview] = useState<LabelPreview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
  const selectedPallet = useMemo(() => pallets.find((pallet) => pallet.code === palletCode) ?? null, [palletCode, pallets]);

  useEffect(() => {
    void loadClients();
    Promise.all([fetchPrintAgentStations(session.accessToken), fetchPrintPrinters(session.accessToken)])
      .then(([nextStations, nextPrinters]) => { setStations(nextStations); setPrinters(nextPrinters.filter(item => item.isActive && item.autoProcess && item.connectionType === 'tcp')); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить принтеры.'));
  }, [session.accessToken]);

  useEffect(() => {
    if (style !== 'reference' || !palletCode.trim()) { setReferencePreview(''); return; }
    let active = true;
    renderSortReferencePng(palletCode, 'pallet').then(image => { if (active) setReferencePreview(image); }).catch(() => setReferencePreview(''));
    return () => { active = false; };
  }, [style, palletCode]);

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

  async function printReference() {
    if (!selectedClient || !palletCode.trim() || !destination) return;
    const count = Number(copies);
    if (!Number.isInteger(count) || count < 1 || count > 100) { setError('Укажите от 1 до 100 этикеток.'); return; }
    setSubmitting(true); setError(''); setMessage('');
    try {
      const code = palletCode.trim();
      const tspl = sortReferenceTspl(code, 'pallet');
      if (destination.startsWith('AGENT:')) {
        await createPrintAgentCustomJob(session.accessToken, { stationId: destination.slice(6), clientId: selectedClient.id,
          value: code, imageBase64: await renderSortReferencePng(code, 'pallet'), copies: count, widthMm: 60, heightMm: 40 });
      } else {
        const template = await createLabelTemplate(session.accessToken, { code: `PALET_SORT_${Date.now().toString(36)}`,
          name: `Палет-сорт ${code}`.slice(0, 120), type: 'PALLET', widthMm: 60, heightMm: 40, tspl });
        await createPrintJobFromTemplate(session.accessToken, template.id, { printerCode: destination, copies: count, variables: {} });
      }
      setMessage(`${count} этикеток палет-сорта ${code} отправлено на выбранный принтер.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось напечатать этикетку палет-сорта.'); }
    finally { setSubmitting(false); }
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

        <label><span>Макет этикетки</span><select value={style} onChange={event => setStyle(event.target.value as typeof style)}><option value="regular">Обычная паллета · предпросмотр TSPL</option><option value="reference">Как образец WB · все коды = палет-сорт</option></select></label>
        <label><span>Куда печатать</span><select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Выберите принтер</option><optgroup label="Станции FBS — печать через агент">{stations.map(station => <option key={station.id} value={`AGENT:${station.id}`}>{station.printerName} · {station.name}</option>)}</optgroup><optgroup label="Сетевые принтеры WMS">{printers.map(printer => <option key={printer.code} value={printer.code}>{printer.name}</option>)}</optgroup></select></label>
        <label><span>Сколько этикеток</span><input min="1" max="100" step="1" type="number" value={copies} onChange={event => setCopies(event.target.value)} /></label>

        <label>
          <span>Коробов</span>
          <input min="0" step="1" type="number" value={boxesCount} onChange={(event) => setBoxesCount(event.target.value)} />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="inline-status">{message}</p> : null}

      {style === 'reference' ? <div><p>Каждый QR и штрихкод содержит код палет-сорта: <strong>{palletCode || '—'}</strong>.</p>{referencePreview ? <img src={`data:image/png;base64,${referencePreview}`} alt="Предпросмотр этикетки палет-сорта" style={{ width: 'min(100%, 600px)', aspectRatio: '3 / 2' }} /> : null}</div> : null}

      <div className="print-actions">
        <button className="primary-button" type="submit" disabled={!canSubmit || isSubmitting}>
          <FileText size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Готовлю' : 'Предпросмотр TSPL'}</span>
        </button>
        <button className="primary-button print-secondary" type="button" onClick={() => void loadPallets()} disabled={!clientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить паллеты</span>
        </button>
        {style === 'reference' ? <button className="primary-button" type="button" disabled={!canSubmit || !destination || isSubmitting} onClick={() => void printReference()}><Printer size={16} /><span>{isSubmitting ? 'Отправляю…' : 'Напечатать'}</span></button> : null}
      </div>

      {preview ? <TsplPreviewCard preview={preview} fileName={safeFileName} /> : null}
    </form>
  );
}
