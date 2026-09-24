import { FileText, Printer, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createLabelTemplate,
  createPrintAgentCustomJob,
  createPrintJobFromTemplate,
  fetchClients,
  fetchPrintPrinters,
  fetchPrintAgentStations,
  previewLabelTemplate,
  type AuthSession,
  type ClientSummary,
  type PrintPrinterSummary,
  type PrintAgentStationSummary,
} from '../../lib/api';
import { printB1Stickers, renderStickerPng } from './niimbotBrowser';
import { StickerCanvasEditor } from './StickerCanvasEditor';
import { TsplPreviewCard } from './TsplPreviewCard';
import { stickerSequence, type StickerSequence } from '../../lib/stickerSequence';
import { buildStickerTspl, fitStickerText, type StickerBoxes, type StickerCodeKind, type StickerLayout } from '../../lib/stickerLayout';

const NIIMBOT_BROWSER_CODE = 'NIIMBOT_B1_BROWSER';

// FIX: retain only a printer explicitly selected by the operator.
export function chooseStickerDestination(current: string, stations: PrintAgentStationSummary[], printers: PrintPrinterSummary[]) {
  if (current === NIIMBOT_BROWSER_CODE) return current;
  if (current.startsWith('AGENT:') && stations.some((station) => station.id === current.slice(6))) return current;
  if (printers.some((printer) => printer.code === current && printer.isActive)) return current;
  return '';
}

// FIX: compute positions from the actual paper size, including the movable FFL caption.
export function serialBoxLayout(width: number, height: number, codeKind: StickerCodeKind): StickerLayout {
  const w = width * 8;
  const h = height * 8;
  const qrSide = Math.max(50, Math.floor(Math.min(125, h - 110, codeKind === 'both' ? w * .25 : w - 48) / 25) * 25);
  const qrY = Math.max(44, Math.round((h - qrSide - 40) / 2));
  const qrX = codeKind === 'both' ? 24 : Math.round((w - qrSide) / 2);
  const barcodeY = codeKind === 'both' ? qrY + 10 : Math.max(66, Math.round(h * .27));
  const barcodeX = codeKind === 'both' ? qrX + qrSide + 16 : 24;
  const barcodeHeight = codeKind === 'both' ? Math.min(70, h - barcodeY - 65) : Math.min(100, h - barcodeY - 65);
  const numberY = Math.min(h - 43, Math.max(qrY + qrSide, barcodeY + barcodeHeight) + 12);
  return {
    width, height, font: 3, codeKind, qrLevel: 'M', qrModule: 4, barcodeHeight,
    topText: '', bottomText: '', qrX, qrY, barcodeX, barcodeY, numberY,
    boxes: {
      client: { x: 16, y: 12, width: w - 32, height: 32 },
      top: { x: 16, y: 48, width: w - 32, height: 28 },
      qr: { x: qrX, y: qrY, width: qrSide, height: qrSide },
      barcode: { x: barcodeX, y: barcodeY, width: w - barcodeX - 24, height: barcodeHeight },
      number: { x: 16, y: numberY, width: w - 32, height: 34 },
      bottom: { x: 16, y: h - 34, width: w - 32, height: 24 },
    },
  };
}

export function StickerSetPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [printers, setPrinters] = useState<PrintPrinterSummary[]>([]);
  const [stations, setStations] = useState<PrintAgentStationSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('Короба с QR');
  const [prefix, setPrefix] = useState('');
  const [start, setStart] = useState('1');
  const [count, setCount] = useState('10');
  const [step, setStep] = useState('1');
  const [repeat, setRepeat] = useState('1');
  const [digits, setDigits] = useState('3');
  const [direction, setDirection] = useState<StickerSequence['direction']>('up');
  const [width, setWidth] = useState('60');
  const [height, setHeight] = useState('40');
  const [font, setFont] = useState('3');
  const [topText, setTopText] = useState('');
  const [bottomText, setBottomText] = useState('');
  const [codeKind, setCodeKind] = useState<StickerCodeKind>('qr');
  const [qrLevel, setQrLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [qrModule, setQrModule] = useState('4');
  const [barcodeHeight, setBarcodeHeight] = useState('70');
  const qrEnabled = codeKind !== 'code128';
  const barcodeEnabled = codeKind !== 'qr';
  const [qrX, setQrX] = useState('20');
  const [qrY, setQrY] = useState('82');
  const [barcodeX, setBarcodeX] = useState('16');
  const [barcodeY, setBarcodeY] = useState('175');
  const [numberY, setNumberY] = useState('280');
  const [boxes, setBoxes] = useState<StickerBoxes>(() => serialBoxLayout(60, 40, 'qr').boxes!);
  const [printerCode, setPrinterCode] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewLabelTemplate>> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isWorking, setWorking] = useState(false);

  const client = useMemo(() => clients.find((item) => item.id === clientId) ?? null, [clientId, clients]);
  // FIX: preview and both print paths use the same validated counter.
  const sequenceResult = useMemo(() => {
    try { return { values: stickerSequence({ prefix, start, count, step, repeat, digits, direction }), error: '' }; }
    catch (caught) { return { values: [] as string[], error: caught instanceof Error ? caught.message : 'Проверьте счётчик.' }; }
  }, [prefix, start, count, step, repeat, digits, direction]);
  const values = sequenceResult.values;
  const availablePrinters = useMemo(
    () => [...stations.map((station) => ({ id: station.id, code: `AGENT:${station.id}`, name: `${station.printerName} · станция ${station.name}${station.lastSeenAt ? ` · связь ${new Date(station.lastSeenAt).toLocaleString('ru-RU')}` : ' · нет связи'}` })), ...printers, { id: NIIMBOT_BROWSER_CODE, code: NIIMBOT_BROWSER_CODE, name: 'NIIMBOT B1 · Bluetooth этого ноутбука' }],
    [printers, stations],
  );

  useEffect(() => {
    Promise.all([fetchClients(session.accessToken), fetchPrintPrinters(session.accessToken), fetchPrintAgentStations(session.accessToken)])
      .then(([nextClients, nextPrinters, nextStations]) => {
        setClients(nextClients);
        setPrinters(nextPrinters.filter((printer) => printer.isActive));
        setStations(nextStations);
        setClientId((current) => current || nextClients[0]?.id || '');
        setPrinterCode((current) => chooseStickerDestination(current, nextStations, nextPrinters));
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов или принтеры.'));
  }, [session.accessToken]);

  useEffect(() => {
    const printer = printers.find((item) => item.code === printerCode);
    if (!printer && printerCode !== NIIMBOT_BROWSER_CODE && !printerCode.startsWith('AGENT:')) return;
    const isNiimbot = printerCode === NIIMBOT_BROWSER_CODE || `${printer?.code ?? ''} ${printer?.name ?? ''}`.toUpperCase().includes('NIIMBOT');
    setWidth(isNiimbot ? '50' : '60');
    setHeight(isNiimbot ? '30' : '40');
    const compact = isNiimbot;
    const next = serialBoxLayout(compact ? 50 : 60, compact ? 30 : 40, codeKind);
    setQrY(String(next.qrY));
    setQrModule(compact && codeKind === 'both' ? '3' : '4');
    setBarcodeY(String(next.barcodeY));
    setBarcodeHeight(String(next.barcodeHeight));
    setNumberY(String(next.numberY));
    setBoxes(next.boxes!);
  }, [printerCode, printers]);

  function changePaperSize(nextWidth: string, nextHeight: string) {
    setWidth(nextWidth);
    setHeight(nextHeight);
    const parsedWidth = Number(nextWidth);
    const parsedHeight = Number(nextHeight);
    if (parsedWidth >= 20 && parsedHeight >= 20) setBoxes(serialBoxLayout(parsedWidth, parsedHeight, codeKind).boxes!);
  }

  async function createSet(mode: 'preview' | 'print') {
    if (!client || values.length === 0) return;
    setWorking(true); setError(''); setMessage(''); setPreview(null);
    try {
      const layout: StickerLayout = { width: positive(width, 50), height: positive(height, 30), font: positive(font, 3), codeKind, qrLevel, qrModule: positive(qrModule, 4), barcodeHeight: positive(barcodeHeight, 70), topText, bottomText, qrX: boxes.qr.x, qrY: boxes.qr.y, barcodeX: boxes.barcode.x, barcodeY: boxes.barcode.y, numberY: boxes.number.y, boxes };
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const measure = (line: string, size: number) => { if (!context) return line.length * size * .65; context.font = `700 ${size}px Arial`; return context.measureText(line).width; };
      for (const [key, text] of [['client', client.name], ['top', topText], ['bottom', bottomText]] as const) if (text.trim()) fitStickerText(text, boxes[key], Math.max(18, layout.font * 6), measure);
      for (const value of values) fitStickerText(value, boxes.number, Math.max(18, layout.font * 6), measure);
      const template = await createLabelTemplate(session.accessToken, {
        code: `SET_${Date.now().toString(36)}`,
        name: `${client.name} · ${name}`.slice(0, 120),
        type: 'CUSTOM',
        description: `Набор стикеров клиента ${client.name}. Префикс: ${prefix}`,
        widthMm: positive(width, 50),
        heightMm: positive(height, 30),
        tspl: buildStickerTspl(layout),
        isActive: true,
      });
      const firstVariables = stickerVariables(client.name, values[0], topText, bottomText);
      if (mode === 'preview') {
        setPreview(await previewLabelTemplate(session.accessToken, template.id, { variables: firstVariables }));
        setMessage(`Набор сохранён. Предпросмотр первого стикера: ${values[0]}.`);
      } else {
        if (!printerCode) throw new Error('Выберите принтер.');
        if (printerCode === NIIMBOT_BROWSER_CODE) {
          await printB1Stickers(values.map((value) => ({
            clientName: client.name,
            value,
            topText,
            bottomText,
            fontSize: positive(font, 3),
            barcodeEnabled,
            qrEnabled,
            qrX: coordinate(qrX, 20),
            qrY: coordinate(qrY, 82),
            barcodeX: coordinate(barcodeX, 180),
            barcodeY: coordinate(barcodeY, 88),
            numberY: coordinate(numberY, 190),
            qrLevel,
            qrSize: codeKind === 'both' ? 75 : 102,
            boxes,
          })), setMessage);
          setMessage(`NIIMBOT B1 напечатал ${values.length} стикеров: от ${values[0]} до ${values[values.length - 1]}.`);
          return;
        }
        if (printerCode.startsWith('AGENT:')) {
          for (const value of values) {
            const sticker = { clientName: client.name, value, topText, bottomText, fontSize: layout.font, barcodeEnabled, qrEnabled, qrX: boxes.qr.x, qrY: boxes.qr.y, barcodeX: boxes.barcode.x, barcodeY: boxes.barcode.y, numberY: boxes.number.y, qrLevel, boxes };
            await createPrintAgentCustomJob(session.accessToken, { stationId: printerCode.slice(6), clientId: client.id, value, imageBase64: await renderStickerPng(sticker, layout.width, layout.height), copies: 1, widthMm: layout.width, heightMm: layout.height });
          }
          setMessage(`В агент печати отправлено ${values.length} стикеров: от ${values[0]} до ${values[values.length - 1]}.`);
          return;
        }
        for (const value of values) {
          await createPrintJobFromTemplate(session.accessToken, template.id, { printerCode, variables: stickerVariables(client.name, value, topText, bottomText), copies: 1 });
        }
        setMessage(`В очередь отправлено ${values.length} стикеров: от ${values[0]} до ${values[values.length - 1]}.`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось создать набор стикеров.'); }
    finally { setWorking(false); }
  }

  return <section className="sticker-set" aria-label="Набор стикеров">
    <header><div><p className="eyebrow">Наборы стикеров</p><h3>Серийная печать коробов</h3><span>Введите префикс FFL_код клиента+дата_ и счётчик либо точный текст для дубля. Выберите вид кода и принтер.</span></div><Printer size={20} /></header>
    <div className="sticker-set__grid">
      <label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label><span>Название набора</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label><span>{direction === 'fixed' ? 'Точный текст этикетки' : 'Текст перед номером'}</span><input value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="FFL_LKB20260923_" /></label>
      <label><span>Режим счётчика</span><select value={direction} onChange={(event) => setDirection(event.target.value as StickerSequence['direction'])}><option value="up">Увеличение</option><option value="down">Уменьшение</option><option value="fixed">Ручной текст / дубль этикетки</option></select></label>
      <label><span>Начать с</span><input disabled={direction === 'fixed'} min="0" step="1" type="number" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label><span>Шаг счётчика</span><input disabled={direction === 'fixed'} min="1" step="1" type="number" value={step} onChange={(event) => setStep(event.target.value)} /></label>
      <label><span>Повторений каждого номера</span><input min="1" max="500" step="1" type="number" value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>
      <label><span>Минимум цифр (3 → 001)</span><input disabled={direction === 'fixed'} min="1" max="16" step="1" type="number" value={digits} onChange={(event) => setDigits(event.target.value)} /></label>
      <label><span>Количество номеров</span><input min="1" max="500" step="1" type="number" value={count} onChange={(event) => setCount(event.target.value)} /></label>
      <label><span>Куда печатать</span><select value={printerCode} onChange={(event) => setPrinterCode(event.target.value)}><option value="">Выберите принтер</option>{availablePrinters.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
    </div>
    {printerCode === NIIMBOT_BROWSER_CODE ? <p className="sticker-set__browser-note">Печать напрямую с этого ноутбука: включите NIIMBOT B1, откройте WMS в Chrome или Edge и нажмите «Напечатать». Браузер попросит выбрать принтер один раз.</p> : null}
    <div className="sticker-set__design"><label><span>Ширина, мм</span><input min="20" max="100" type="number" value={width} onChange={(event) => changePaperSize(event.target.value, height)} /></label><label><span>Высота, мм</span><input min="20" max="100" type="number" value={height} onChange={(event) => changePaperSize(width, event.target.value)} /></label><label><span>Размер шрифта</span><input min="1" max="10" type="number" value={font} onChange={(event) => setFont(event.target.value)} /></label><label><span>Текст сверху</span><input value={topText} onChange={(event) => setTopText(event.target.value)} placeholder="Например: Короб клиента" /></label><label><span>Текст снизу</span><input value={bottomText} onChange={(event) => setBottomText(event.target.value)} placeholder="Например: Москва" /></label><label><span>Вид кода</span><select value={codeKind} onChange={(event) => { const next = event.target.value as StickerCodeKind; setCodeKind(next); setBoxes(serialBoxLayout(positive(width, 60), positive(height, 40), next).boxes!); }}><option value="qr">QR-код</option><option value="code128">Штрихкод Code 128</option><option value="both">QR + Code 128</option></select></label><label><span>Читаемость QR</span><select disabled={!qrEnabled} value={qrLevel} onChange={(event) => setQrLevel(event.target.value as typeof qrLevel)}><option value="L">L · больше данных</option><option value="M">M · стандарт</option><option value="Q">Q · устойчивый</option><option value="H">H · максимальная</option></select></label></div>
    <StickerCanvasEditor width={positive(width, 50)} height={positive(height, 30)} boxes={boxes} onChange={setBoxes} clientName={client?.name ?? ''} topText={topText} bottomText={bottomText} value={values[0] ?? ''} valueLabel="Подпись FFL под кодом" codeKind={codeKind} qrLevel={qrLevel} font={positive(font, 3)} />
    <div className="sticker-set__sequence"><b>Будет напечатано: {values.length} этикеток</b><span>{values.slice(0, 5).join(' · ')}{values.length > 5 ? ` · … · ${values[values.length - 1]}` : ''}</span></div>
    {sequenceResult.error ? <p className="form-error" role="alert">{sequenceResult.error}</p> : null}
    {error || message ? <p className={error ? 'form-error' : 'inline-status'}>{error || message}</p> : null}
    <footer><button className="secondary-button" type="button" disabled={isWorking || !client || values.length === 0} onClick={() => void createSet('preview')}><FileText size={16} />Предпросмотр</button><button className="primary-button" type="button" disabled={isWorking || !client || values.length === 0 || !printerCode} onClick={() => void createSet('print')}><Save size={16} />{isWorking ? 'Готовлю…' : `${printerCode === NIIMBOT_BROWSER_CODE ? 'Подключить и напечатать' : 'Напечатать'} ${values.length} шт.`}</button></footer>
    {preview ? <TsplPreviewCard preview={preview} fileName={`${prefix || 'stickers'}${values[0] ?? ''}.tspl`} /> : null}
  </section>;
}

function positive(value: string, fallback: number) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function coordinate(value: string, fallback: number) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function stickerVariables(clientName: string, value: string, topText: string, bottomText: string) { return { clientName, barcodeValue: value, qrValue: value, topText, bottomText }; }
