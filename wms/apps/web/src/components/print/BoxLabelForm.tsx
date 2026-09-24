import { Printer, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchBoxes, fetchClients, fetchPrintAgentStations, fetchPrintPrinters,
  createPrintAgentCustomJob, createLabelTemplate, createPrintJobFromTemplate,
  type AuthSession, type ClientSummary, type PrintAgentStationSummary,
  type PrintPrinterSummary, type WarehouseBoxSummary,
} from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';
import { buildStickerTspl, type StickerCodeKind } from '../../lib/stickerLayout';
import { StickerCanvasEditor } from './StickerCanvasEditor';
import { renderStickerPng } from './niimbotBrowser';
import { BOX_LABEL_HEIGHT_MM, BOX_LABEL_WIDTH_MM, boxLabelBoxes, boxSticker, boxStickerLayout } from './boxSticker';
import { defaultSortReferenceText, renderSortReferencePng, sortReferenceTspl } from '../../lib/sortReferenceLabel';
import { SortReferenceLabelEditor } from './SortReferenceLabelEditor';
import { openLocalSkuPrint } from '../../lib/localSkuPrint';

export function BoxLabelForm({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [boxes, setBoxes] = useState<WarehouseBoxSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [boxCode, setBoxCode] = useState('');
  const [codeKind, setCodeKind] = useState<StickerCodeKind>('code128');
  const [style, setStyle] = useState<'regular' | 'reference'>('regular');
  const [referenceText, setReferenceText] = useState(() => defaultSortReferenceText(''));
  const [layoutBoxes, setLayoutBoxes] = useState(() => boxLabelBoxes('code128'));
  const [stations, setStations] = useState<PrintAgentStationSummary[]>([]);
  const [printers, setPrinters] = useState<PrintPrinterSummary[]>([]);
  const [destination, setDestination] = useState('');
  const [copies, setCopies] = useState('1');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const selectedClient = useMemo(() => clients.find(client => client.id === clientId) ?? null, [clients, clientId]);

  useEffect(() => {
    void loadClients();
    Promise.all([fetchPrintAgentStations(session.accessToken), fetchPrintPrinters(session.accessToken)])
      .then(([nextStations, nextPrinters]) => {
        setStations(nextStations);
        setPrinters(nextPrinters.filter(item => item.isActive && item.autoProcess && item.connectionType === 'tcp'));
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить принтеры.'));
  }, [session.accessToken]);

  useEffect(() => { if (clientId) void loadBoxes(clientId); }, [clientId]);

  async function loadClients() {
    setLoading(true); setError('');
    try {
      const list = await fetchClients(session.accessToken);
      setClients(list);
      setClientId(current => current || list[0]?.id || '');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.'); }
    finally { setLoading(false); }
  }

  async function loadBoxes(nextClientId = clientId) {
    if (!nextClientId) return;
    setLoading(true); setError('');
    try {
      const list = await fetchBoxes(session.accessToken, { clientId: nextClientId });
      setBoxes(list);
      if (!boxCode && list[0]) { setBoxCode(list[0].code); setReferenceText(defaultSortReferenceText(list[0].code)); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить короба.'); }
    finally { setLoading(false); }
  }

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setBoxCode('');
    setReferenceText(defaultSortReferenceText(''));
  }

  function changeBoxCode(code: string) { setBoxCode(code); setReferenceText(defaultSortReferenceText(code)); }

  function changeCodeKind(next: StickerCodeKind) {
    setCodeKind(next);
    setLayoutBoxes(boxLabelBoxes(next));
  }

  async function printBox() {
    if (!selectedClient || !boxCode.trim() || !destination) return;
    const count = Number(copies);
    if (!Number.isInteger(count) || count < 1 || count > 100) { setError('Укажите от 1 до 100 этикеток.'); return; }
    setSubmitting(true); setError(''); setMessage('');
    try {
      // FIX: preview, agent PNG and network TSPL share the operator's code kind and movable layout.
      const code = boxCode.trim();
      const tspl = style === 'reference' ? sortReferenceTspl(code, 'box', referenceText) : buildStickerTspl(boxStickerLayout(codeKind, layoutBoxes, code));
      if (destination === 'LOCAL_BROWSER') {
        const localWindow = window.open('', '_blank');
        if (!localWindow) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна для WMS.');
        const imageBase64 = style === 'reference' ? await renderSortReferencePng(code, 'box', referenceText) : await renderStickerPng(boxSticker(selectedClient.name, code, codeKind, layoutBoxes), BOX_LABEL_WIDTH_MM, BOX_LABEL_HEIGHT_MM);
        openLocalSkuPrint([{ imageBase64, copies: count }], BOX_LABEL_WIDTH_MM, BOX_LABEL_HEIGHT_MM, localWindow);
        setMessage(`Открыто окно печати: ${count} этикеток. Выберите местный принтер, масштаб 100% и поля «Нет».`);
        return;
      }
      if (destination.startsWith('AGENT:')) {
        const imageBase64 = style === 'reference' ? await renderSortReferencePng(code, 'box', referenceText) : await renderStickerPng(boxSticker(selectedClient.name, code, codeKind, layoutBoxes), BOX_LABEL_WIDTH_MM, BOX_LABEL_HEIGHT_MM);
        await createPrintAgentCustomJob(session.accessToken, {
          stationId: destination.slice(6), clientId: selectedClient.id, value: code,
          imageBase64, copies: count, widthMm: BOX_LABEL_WIDTH_MM, heightMm: BOX_LABEL_HEIGHT_MM,
        });
      } else {
        const template = await createLabelTemplate(session.accessToken, {
          code: `BOX_${Date.now().toString(36)}`, name: `Короб ${code}`.slice(0, 120),
          type: 'BOX', widthMm: BOX_LABEL_WIDTH_MM, heightMm: BOX_LABEL_HEIGHT_MM, tspl,
        });
        await createPrintJobFromTemplate(session.accessToken, template.id, {
          printerCode: destination, copies: count,
          variables: { clientName: selectedClient.name, barcodeValue: code, qrValue: code },
        });
      }
      setMessage(`${count} этикеток короба ${code} отправлено на выбранный принтер.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось отправить этикетку на принтер.'); }
    finally { setSubmitting(false); }
  }

  return <section className="print-form" aria-label="Печать этикетки короба">
    <p>Этикетка 60 × 40 мм: клиент и код FFL. Выберите ШК или QR и расположите подпись на макете.</p>
    <div className="print-fields">
      <label><span>Клиент</span><select value={clientId} onChange={event => changeClient(event.target.value)} disabled={isLoading}>
        {clients.length === 0 ? <option value="">Клиенты не найдены</option> : null}
        {clients.map(client => <option key={client.id} value={client.id}>{client.code} - {client.name}</option>)}
      </select></label>
      <label><span>Короб / код FFL</span><input list="print-boxes" value={boxCode} onChange={event => changeBoxCode(event.target.value)} required />
        <datalist id="print-boxes">{boxes.map(box => <option key={box.id} value={box.code} />)}</datalist>
      </label>
      <label><span>Макет этикетки</span><select value={style} onChange={event => setStyle(event.target.value as typeof style)}><option value="regular">Клиент + FFL · свободное расположение</option><option value="reference">Как образец WB · все коды = номер короба</option></select></label>
      <label><span>Вид кода</span><select value={codeKind} onChange={event => changeCodeKind(event.target.value as StickerCodeKind)}>
        <option value="code128">Штрихкод Code 128</option><option value="qr">QR-код</option><option value="both">QR + штрихкод</option>
      </select></label>
      <label><span>Куда печатать</span><select value={destination} onChange={event => setDestination(event.target.value)}>
        <option value="">Выберите принтер</option>
        <option value="LOCAL_BROWSER">Локальный принтер этого компьютера · выбрать в окне печати</option>
        <optgroup label="Станции FBS — печать через агент">{stations.map(station => <option key={station.id} value={`AGENT:${station.id}`}>{station.printerName} · {station.name}</option>)}</optgroup>
        <optgroup label="Сетевые принтеры WMS">{printers.map(printer => <option key={printer.code} value={printer.code}>{printer.name}</option>)}</optgroup>
      </select></label>
      <label><span>Сколько этикеток</span><input min="1" max="100" step="1" type="number" value={copies} onChange={event => setCopies(event.target.value)} /></label>
    </div>
    {style === 'regular' ? <StickerCanvasEditor width={BOX_LABEL_WIDTH_MM} height={BOX_LABEL_HEIGHT_MM} boxes={layoutBoxes} onChange={setLayoutBoxes}
      clientName={selectedClient?.name ?? ''} topText="" bottomText="" value={boxCode.trim()} codeKind={codeKind} qrLevel="M" font={4} valueLabel="Подпись с кодом FFL" />
      : <div><p>Все QR и штрихкоды содержат код короба: <strong>{boxCode || '—'}</strong>.</p><SortReferenceLabelEditor code={boxCode} kind="box" fields={referenceText} onChange={setReferenceText} /></div>}
    {error ? <p className="form-error">{error}</p> : null}
    {message ? <p className="inline-status">{message}</p> : null}
    <div className="print-actions">
      <button className="primary-button" type="button" disabled={!selectedClient || !boxCode.trim() || !destination || isSubmitting} onClick={() => void printBox()}>
        <Printer size={16} aria-hidden="true" /><span>{isSubmitting ? 'Отправляю…' : 'Напечатать'}</span>
      </button>
      <button className="primary-button print-secondary" type="button" onClick={() => void loadBoxes()} disabled={!clientId || isLoading}>
        <RefreshCw size={16} aria-hidden="true" /><span>Обновить короба</span>
      </button>
    </div>
  </section>;
}
