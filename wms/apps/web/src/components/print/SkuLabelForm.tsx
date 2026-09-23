import { Printer, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createLabelTemplate, createPrintAgentSkuJob, createPrintJobFromTemplate, fetchClients, fetchPrintAgentStations, fetchPrintPrinters, fetchSkus,
  type AuthSession, type ClientSummary, type PrintAgentStationSummary, type PrintPrinterSummary, type SkuSummary,
} from '../../lib/api';
import { PRODUCT_LABEL_TSPL, productLabelBatch, productLabelVariables } from '../../lib/productLabel';
import { renderProductLabelPng } from '../../lib/productLabelImage';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { TsplPreviewCard } from './TsplPreviewCard';
import './print.css';

export function SkuLabelForm({ session, initialSearch = '' }: { session: AuthSession; initialSearch?: string }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [printers, setPrinters] = useState<PrintPrinterSummary[]>([]);
  const [stations, setStations] = useState<PrintAgentStationSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [printerCode, setPrinterCode] = useState('');
  const [search, setSearch] = useState(initialSearch);
  const [results, setResults] = useState<SkuSummary[]>([]);
  const [selected, setSelected] = useState<SkuSummary[]>([]);
  const [chosenBarcodes, setChosenBarcodes] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const searchRevision = useRef(0);
  const client = useMemo(() => clients.find(item => item.id === clientId), [clients, clientId]);
  const usablePrinters = printers.filter(item => item.isActive && item.autoProcess && item.connectionType === 'tcp');
  const destinations = [
    ...stations.map(item => ({ code: `AGENT:${item.id}`, name: `${item.printerName} · ${item.name}${item.lastSeenAt ? ` · связь ${new Date(item.lastSeenAt).toLocaleString('ru-RU')}` : ' · нет связи'}` })),
    ...usablePrinters.map(item => ({ code: item.code, name: item.name })),
  ];

  useEffect(() => {
    Promise.all([fetchClients(session.accessToken), fetchPrintPrinters(session.accessToken), fetchPrintAgentStations(session.accessToken)])
      .then(([nextClients, nextPrinters, nextStations]) => { setClients(nextClients); setPrinters(nextPrinters); setStations(nextStations); setClientId(current => current || nextClients[0]?.id || ''); })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить настройки печати.'));
  }, [session.accessToken]);
  useEffect(() => { setSearch(initialSearch); }, [initialSearch]);
  useEffect(() => { searchRevision.current++; setResults([]); setSelected([]); setChosenBarcodes({}); setQuantities({}); setBusy(false); }, [clientId]);
  useEffect(() => {
    if (!initialSearch.trim() || !clientId) return;
    const revision = ++searchRevision.current;
    fetchSkus(session.accessToken, { clientId, search: initialSearch.trim() })
      .then(rows => { if (revision === searchRevision.current) setResults(rows); })
      .catch(caught => { if (revision === searchRevision.current) setError(caught instanceof Error ? caught.message : 'Не удалось найти товар.'); });
  }, [clientId, initialSearch, session.accessToken]);

  async function find() {
    if (!clientId || !search.trim()) return;
    const revision = ++searchRevision.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const rows = await fetchSkus(session.accessToken, { clientId, search: search.trim() });
      if (revision !== searchRevision.current) return;
      setResults(rows); setMessage(rows.length ? `${rows.length === 100 ? 'Показаны первые 100 товаров — уточните поиск при необходимости.' : `Найдено: ${rows.length}.`} Отметьте товары для печати.` : 'Товары не найдены.');
    } catch (caught) { if (revision === searchRevision.current) setError(caught instanceof Error ? caught.message : 'Не удалось найти товары.'); }
    finally { if (revision === searchRevision.current) setBusy(false); }
  }

  function toggle(sku: SkuSummary) {
    setSelected(current => current.some(item => item.id === sku.id) ? current.filter(item => item.id !== sku.id) : [...current, sku]);
  }

  async function print() {
    if (!client || !printerCode || !selected.length) return;
    setBusy(true); setError(''); setMessage('');
    let queued = 0;
    try {
      // Validate the whole selection before creating any print jobs.
      const labels = productLabelBatch(selected, client.name, quantities, chosenBarcodes);
      if (printerCode.startsWith('AGENT:')) {
        const stationId = printerCode.slice('AGENT:'.length);
        for (const label of labels) {
          await createPrintAgentSkuJob(session.accessToken, { stationId, skuId: label.skuId, barcode: label.variables.barcode, imageBase64: renderProductLabelPng(label.variables), copies: label.copies, widthMm: 40, heightMm: 60 });
          queued++;
        }
      } else {
        const template = await createLabelTemplate(session.accessToken, {
          code: `SKU40X60_${Date.now().toString(36)}`,
          name: `Товары ${client.name} · 40×60`, type: 'SKU', widthMm: 40, heightMm: 60,
          description: 'Печать штрихкодов по синхронизированным карточкам клиента', tspl: PRODUCT_LABEL_TSPL,
        });
        for (const label of labels) {
          await createPrintJobFromTemplate(session.accessToken, template.id, { printerCode, variables: label.variables, copies: label.copies });
          queued++;
        }
      }
      setMessage(`В очередь отправлено ${queued} товаров, всего ${labels.reduce((sum, label) => sum + label.copies, 0)} этикеток.`);
    } catch (caught) {
      setError(`${caught instanceof Error ? caught.message : 'Ошибка печати.'}${queued ? ` Уже отправлено ${queued} товаров — проверьте очередь перед повтором.` : ''}`);
    } finally { setBusy(false); }
  }

  const first = selected[0];
  const preview = first && client ? (() => {
    try {
      const variables = productLabelVariables(first, client.name, chosenBarcodes[first.id]);
      return { printerLanguage: 'TSPL' as const, tspl: PRODUCT_LABEL_TSPL.replace(/{{(\w+)}}/g, (_, key: keyof typeof variables) => variables[key].replace(/["\r\n\t]/g, ' ')) };
    } catch { return null; }
  })() : null;

  return <section className="sku-label-flow" aria-label="Печать ШК товара">
    <p>Введите часть названия, артикула или штрихкода. Отметьте нужные товары и укажите количество этикеток для каждого. Формат — 40 × 60 мм.</p>
    <div className="sku-label-flow__filters">
      <label>Клиент<select value={clientId} onChange={event => setClientId(event.target.value)}>{clients.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label>Поиск<input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void find(); }} placeholder="Часть ШК, артикула или названия" /></label>
      <button className="secondary-button" type="button" onClick={() => void find()} disabled={!clientId || !search.trim() || busy}><Search size={16} />Найти</button>
    </div>
    <div className="sku-label-flow__results" aria-label="Найденные товары">
      {results.map(sku => <div className="sku-label-flow__result" key={sku.id}><label><input type="checkbox" checked={selected.some(item => item.id === sku.id)} onChange={() => toggle(sku)} />
        <span><strong>{sku.name}</strong><small>{sku.marketplace || 'WMS'} · {sku.article || sku.internalSku} · {sku.color || '—'} · {sku.size || '—'}</small></span>
      </label>{sku.barcodes.length > 1 ? <select aria-label={`Штрихкод товара ${sku.name}`} value={chosenBarcodes[sku.id] || sku.barcodes.find(item => item.isPrimary)?.value || sku.barcodes[0]?.value} onChange={event => setChosenBarcodes(current => ({ ...current, [sku.id]: event.target.value }))}>{sku.barcodes.map(item => <option key={item.id} value={item.value}>{item.value}{item.isPrimary ? ' · основной' : ''}</option>)}</select> : <small>ШК {sku.barcodes[0]?.value || 'не указан'}</small>}{selected.some(item => item.id === sku.id) ? <label className="sku-label-flow__quantity">Этикеток<input aria-label={`Количество этикеток для ${sku.name}`} type="number" min="1" max="100" value={quantities[sku.id] ?? '1'} onChange={event => setQuantities(current => ({ ...current, [sku.id]: event.target.value }))} /></label> : null}</div>)}
    </div>
    {selected.some(item => !results.some(result => result.id === item.id)) ? <div className="sku-label-flow__selected"><strong>Отмечены из предыдущего поиска</strong>{selected.filter(item => !results.some(result => result.id === item.id)).map(item => <div key={item.id} className="sku-label-flow__selected-row"><span>{item.name} · {item.article || item.internalSku}</span><label>Этикеток<input aria-label={`Количество этикеток для ${item.name}`} type="number" min="1" max="100" value={quantities[item.id] ?? '1'} onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))} /></label><button type="button" className="secondary-button" onClick={() => toggle(item)}>Убрать</button></div>)}</div> : null}
    <div className="sku-label-flow__filters">
      <label>Принтер<select value={printerCode} onChange={event => setPrinterCode(event.target.value)}><option value="">Выберите подключённый принтер</option>{destinations.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <span>Выбрано товаров: {selected.length}</span>
    </div>
    {destinations.length === 0 ? <p className="form-error">Нет подключённых печатных станций или сетевых принтеров.</p> : null}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="inline-status">{message}</p>}
    <div className="print-actions">
      <button className="primary-button" type="button" disabled={busy || !selected.length || !printerCode || !client} onClick={() => void print()}><Printer size={16} />{busy ? 'Отправляю…' : `Напечатать ${selected.length} товаров`}</button>
      <button className="secondary-button" type="button" disabled={!search.trim() || busy} onClick={() => void find()}><RefreshCw size={16} />Обновить поиск</button>
    </div>
    {preview && <><p>Предпросмотр первого выбранного товара · {first.name}</p><TsplPreviewCard preview={preview} fileName={`${first.internalSku}-40x60.tspl`} /></>}
  </section>;
}
