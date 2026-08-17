import { Barcode, FileText, Printer, QrCode, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createLabelTemplate,
  createPrintJobFromTemplate,
  fetchClients,
  fetchPrintPrinters,
  previewLabelTemplate,
  type AuthSession,
  type ClientSummary,
  type PrintPrinterSummary,
} from '../../lib/api';
import { printB1Stickers } from './niimbotBrowser';
import { TsplPreviewCard } from './TsplPreviewCard';

const NIIMBOT_BROWSER_CODE = 'NIIMBOT_B1_BROWSER';

export function StickerSetPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [printers, setPrinters] = useState<PrintPrinterSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('Короба с QR');
  const [prefix, setPrefix] = useState('FFL_LKB0101_');
  const [start, setStart] = useState('1');
  const [count, setCount] = useState('10');
  const [width, setWidth] = useState('50');
  const [height, setHeight] = useState('30');
  const [font, setFont] = useState('3');
  const [topText, setTopText] = useState('');
  const [bottomText, setBottomText] = useState('');
  const [barcodeEnabled, setBarcodeEnabled] = useState(true);
  const [qrEnabled, setQrEnabled] = useState(true);
  const [qrX, setQrX] = useState('20');
  const [qrY, setQrY] = useState('82');
  const [barcodeX, setBarcodeX] = useState('180');
  const [barcodeY, setBarcodeY] = useState('88');
  const [numberY, setNumberY] = useState('230');
  const [printerCode, setPrinterCode] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewLabelTemplate>> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isWorking, setWorking] = useState(false);

  const client = useMemo(() => clients.find((item) => item.id === clientId) ?? null, [clientId, clients]);
  const values = useMemo(() => sequence(prefix, start, count), [prefix, start, count]);
  const availablePrinters = useMemo(
    () => [{ id: NIIMBOT_BROWSER_CODE, code: NIIMBOT_BROWSER_CODE, name: 'NIIMBOT B1 · Bluetooth этого ноутбука' }, ...printers],
    [printers],
  );

  useEffect(() => {
    Promise.all([fetchClients(session.accessToken), fetchPrintPrinters(session.accessToken)])
      .then(([nextClients, nextPrinters]) => {
        setClients(nextClients);
        setPrinters(nextPrinters.filter((printer) => printer.isActive));
        setClientId((current) => current || nextClients[0]?.id || '');
        setPrinterCode((current) => current || NIIMBOT_BROWSER_CODE);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов или принтеры.'));
  }, [session.accessToken]);

  useEffect(() => {
    const printer = printers.find((item) => item.code === printerCode);
    if (!printer && printerCode !== NIIMBOT_BROWSER_CODE) return;
    const isNiimbot = printerCode === NIIMBOT_BROWSER_CODE || `${printer?.code ?? ''} ${printer?.name ?? ''}`.toUpperCase().includes('NIIMBOT');
    setWidth(isNiimbot ? '50' : '58');
    setHeight(isNiimbot ? '30' : '40');
  }, [printerCode, printers]);

  async function createSet(mode: 'preview' | 'print') {
    if (!client || values.length === 0) return;
    setWorking(true); setError(''); setMessage(''); setPreview(null);
    try {
      const template = await createLabelTemplate(session.accessToken, {
        code: `SET_${Date.now().toString(36)}`,
        name: `${client.name} · ${name}`.slice(0, 120),
        type: 'CUSTOM',
        description: `Набор стикеров клиента ${client.name}. Префикс: ${prefix}`,
        widthMm: positive(width, 50),
        heightMm: positive(height, 30),
        tspl: buildTspl({ width: positive(width, 50), height: positive(height, 30), font: positive(font, 3), barcodeEnabled, qrEnabled, topText, bottomText, qrX: coordinate(qrX, 20), qrY: coordinate(qrY, 82), barcodeX: coordinate(barcodeX, 180), barcodeY: coordinate(barcodeY, 88), numberY: coordinate(numberY, 230) }),
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
          })), setMessage);
          setMessage(`NIIMBOT B1 напечатал ${values.length} стикеров: от ${values[0]} до ${values[values.length - 1]}.`);
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
    <header><div><p className="eyebrow">Наборы стикеров</p><h3>Серийная печать коробов</h3><span>Набор сохраняется как шаблон клиента; каждый номер получает собственный ШК и QR.</span></div><Printer size={20} /></header>
    <div className="sticker-set__grid">
      <label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label><span>Название набора</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label><span>Префикс номера</span><input value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="FFL_LKB0101_" /></label>
      <label><span>Начать с</span><input min="0" type="number" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label><span>Сколько стикеров</span><input min="1" max="500" type="number" value={count} onChange={(event) => setCount(event.target.value)} /></label>
      <label><span>Принтер</span><select value={printerCode} onChange={(event) => setPrinterCode(event.target.value)}><option value="">Выберите принтер</option>{availablePrinters.map((item) => <option key={item.id} value={item.code}>{item.code === NIIMBOT_BROWSER_CODE ? item.name : `${item.code} · ${item.name}`}</option>)}</select></label>
    </div>
    {printerCode === NIIMBOT_BROWSER_CODE ? <p className="sticker-set__browser-note">Печать напрямую с этого ноутбука: включите NIIMBOT B1, откройте WMS в Chrome или Edge и нажмите «Напечатать». Браузер попросит выбрать принтер один раз.</p> : null}
    <div className="sticker-set__design"><label><span>Ширина, мм</span><input min="20" max="100" type="number" value={width} onChange={(event) => setWidth(event.target.value)} /></label><label><span>Высота, мм</span><input min="20" max="100" type="number" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label><span>Размер шрифта</span><input min="1" max="10" type="number" value={font} onChange={(event) => setFont(event.target.value)} /></label><label><span>Текст сверху</span><input value={topText} onChange={(event) => setTopText(event.target.value)} placeholder="Например: Короб клиента" /></label><label><span>Текст снизу</span><input value={bottomText} onChange={(event) => setBottomText(event.target.value)} placeholder="Например: Москва" /></label><label className="sticker-set__switch"><input type="checkbox" checked={barcodeEnabled} onChange={(event) => setBarcodeEnabled(event.target.checked)} /><Barcode size={16} />Штрихкод</label><label className="sticker-set__switch"><input type="checkbox" checked={qrEnabled} onChange={(event) => setQrEnabled(event.target.checked)} /><QrCode size={16} />QR-код</label></div>
    <div className="sticker-set__editor"><div className="sticker-set__canvas" style={{ aspectRatio: `${positive(width, 50)} / ${positive(height, 30)}` }}><small className="sticker-set__canvas-client">{client?.name ?? 'Клиент'}</small>{topText ? <b className="sticker-set__canvas-top">{topText}</b> : null}{qrEnabled ? <span className="sticker-set__canvas-qr" style={{ left: `${Math.min(76, coordinate(qrX, 20) / 5)}%`, top: `${Math.min(70, coordinate(qrY, 82) / 4)}%` }}>▦</span> : null}{barcodeEnabled ? <span className="sticker-set__canvas-barcode" style={{ left: `${Math.min(65, coordinate(barcodeX, 180) / 5)}%`, top: `${Math.min(70, coordinate(barcodeY, 88) / 4)}%` }}>|||||||||</span> : null}<strong className="sticker-set__canvas-number" style={{ top: `${Math.min(82, coordinate(numberY, 230) / 4)}%`, fontSize: `${Math.min(18, 7 + positive(font, 3) * 2)}px` }}>{values[0] ?? 'Номер'}</strong>{bottomText ? <em>{bottomText}</em> : null}</div><div className="sticker-set__positions"><b>Положение элементов, точки принтера</b><label>QR X<input type="number" value={qrX} onChange={(e) => setQrX(e.target.value)} /></label><label>QR Y<input type="number" value={qrY} onChange={(e) => setQrY(e.target.value)} /></label><label>ШК X<input type="number" value={barcodeX} onChange={(e) => setBarcodeX(e.target.value)} /></label><label>ШК Y<input type="number" value={barcodeY} onChange={(e) => setBarcodeY(e.target.value)} /></label><label>Номер Y<input type="number" value={numberY} onChange={(e) => setNumberY(e.target.value)} /></label></div></div>
    <div className="sticker-set__sequence"><b>Будет напечатано</b><span>{values.slice(0, 5).join(' · ')}{values.length > 5 ? ` · … · ${values[values.length - 1]}` : ''}</span></div>
    {error || message ? <p className={error ? 'form-error' : 'inline-status'}>{error || message}</p> : null}
    <footer><button className="secondary-button" type="button" disabled={isWorking || !client || values.length === 0} onClick={() => void createSet('preview')}><FileText size={16} />Предпросмотр</button><button className="primary-button" type="button" disabled={isWorking || !client || values.length === 0 || !printerCode} onClick={() => void createSet('print')}><Save size={16} />{isWorking ? 'Готовлю…' : `${printerCode === NIIMBOT_BROWSER_CODE ? 'Подключить и напечатать' : 'Напечатать'} ${values.length} шт.`}</button></footer>
    {preview ? <TsplPreviewCard preview={preview} fileName={`${prefix || 'stickers'}${values[0] ?? ''}.tspl`} /> : null}
  </section>;
}

function sequence(prefix: string, startText: string, countText: string) { const start = Math.max(0, Math.floor(Number(startText) || 0)); const count = Math.min(500, Math.max(0, Math.floor(Number(countText) || 0))); return Array.from({ length: count }, (_, index) => `${prefix.trim()}${start + index}`); }
function positive(value: string, fallback: number) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function coordinate(value: string, fallback: number) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function stickerVariables(clientName: string, value: string, topText: string, bottomText: string) { return { clientName, barcodeValue: value, qrValue: value, topText, bottomText }; }
function buildTspl(input: { width: number; height: number; font: number; barcodeEnabled: boolean; qrEnabled: boolean; topText: string; bottomText: string; qrX: number; qrY: number; barcodeX: number; barcodeY: number; numberY: number }) { const lines = [`SIZE ${input.width} mm,${input.height} mm`, 'GAP 2 mm,0', 'CLS', `TEXT 20,16,"${input.font}",0,1,1,"{{clientName}}"`]; if (input.topText) lines.push(`TEXT 20,48,"${input.font}",0,1,1,"{{topText}}"`); if (input.qrEnabled) lines.push(`QRCODE ${input.qrX},${input.qrY},L,4,A,0,"{{qrValue}}"`); if (input.barcodeEnabled) lines.push(`BARCODE ${input.barcodeX},${input.barcodeY},"128",70,1,0,2,2,"{{barcodeValue}}"`); lines.push(`TEXT 20,${input.numberY},"${input.font}",0,1,1,"{{barcodeValue}}"`); if (input.bottomText) lines.push(`TEXT 20,${input.numberY + 28},"${input.font}",0,1,1,"{{bottomText}}"`); lines.push('PRINT 1'); return lines.join('\n'); }
