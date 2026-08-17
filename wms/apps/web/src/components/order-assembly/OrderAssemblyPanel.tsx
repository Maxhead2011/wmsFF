import { FormEvent, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Monitor, Printer, RotateCcw, ScanLine, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import {
  deleteWebOrderAssemblyHistory, fetchWebOrderAssemblyHistory, reprintWebOrderAssemblyHistory,
  scanWebOrderAssembly, type AuthSession, type WebOrderAssemblyHistoryItem, type WebOrderAssemblyResult,
} from '../../lib/api';

function printLabels(result: WebOrderAssemblyResult) {
  const win = window.open('', '_blank', 'width=700,height=600');
  if (!win) throw new Error('Разрешите всплывающие окна для WMS.');
  win.document.write(`<html><head><title>WB ${result.orderId}</title><style>
    @page{size:58mm 40mm;margin:0}*{box-sizing:border-box}html,body{margin:0}
    .label{width:58mm;height:40mm;break-after:page;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .label:last-of-type{break-after:auto}.label img{width:58mm;height:40mm;object-fit:contain}
    .sorting{padding:2mm;flex-direction:column;text-align:center;font-family:Arial,sans-serif;border:1px solid #000}
    .sorting small{font-size:8pt}.sorting b{font-size:17pt;line-height:1.05;margin:.7mm 0}.sorting strong{font-size:13pt;line-height:1.05;text-transform:uppercase}
  </style></head><body><section class="label"><img src="data:${result.contentType};base64,${result.imageBase64}"></section>
  <section class="label sorting"><small>ЗАЯВКА WMS</small><b>№${String(result.requestNumber || '—').padStart(6, '0')}</b>
  <small>ЗАКАЗ WB</small><b>${result.orderId}</b><small>СКЛАД</small><strong>${result.warehouseName}</strong></section>
  <script>window.onload=()=>setTimeout(()=>{print();close()},180)</script></body></html>`);
  win.document.close();
}

export function OrderAssemblyPanel({ session }: { session: AuthSession }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Поле готово. Сканируйте КИЗ.');
  const [last, setLast] = useState<WebOrderAssemblyResult | null>(null);
  const [history, setHistory] = useState<WebOrderAssemblyHistoryItem[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [printer, setPrinter] = useState(() => localStorage.getItem('web-order-printer') || 'XP-365B');
  const input = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<number | undefined>(undefined);
  const submittedCode = useRef('');
  const reload = () => fetchWebOrderAssemblyHistory(session.accessToken).then(setHistory).catch(() => undefined);
  const filteredHistory = history.filter((row) => {
    const value = new Date(row.printedAt).getTime();
    return (!dateFrom || value >= new Date(`${dateFrom}T00:00:00`).getTime()) && (!dateTo || value <= new Date(`${dateTo}T23:59:59.999`).getTime());
  });
  const groupedHistory = Array.from(filteredHistory.reduce((supplies, row) => {
    const supply = row.supplyId || 'Без поставки';
    const request = row.requestNumber == null ? 'Без заявки' : String(row.requestNumber).padStart(6, '0');
    if (!supplies.has(supply)) supplies.set(supply, new Map());
    const requests = supplies.get(supply)!;
    requests.set(request, [...(requests.get(request) || []), row]);
    return supplies;
  }, new Map<string, Map<string, WebOrderAssemblyHistoryItem[]>>()).entries());
  function downloadExcel() {
    const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = filteredHistory.map((row) => `<tr><td>${esc(new Date(row.printedAt).toLocaleString('ru-RU'))}</td><td>${esc(row.supplyId || 'Без поставки')}</td><td>${esc(row.requestNumber == null ? '—' : String(row.requestNumber).padStart(6, '0'))}</td><td>${esc(row.kiz)}</td><td>${esc(row.productName)}</td><td>${esc(row.article)}</td><td>${esc(row.size)}</td><td>${esc(row.color)}</td><td>${esc(row.orderId)}</td><td>${esc(row.stickerCode)}</td><td>${esc(row.printedBy)}</td></tr>`).join('');
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>Время</th><th>Поставка WB</th><th>Заявка WMS</th><th>КИЗ</th><th>Товар</th><th>Артикул</th><th>Размер</th><th>Цвет</th><th>Заказ WB</th><th>Номер стикера</th><th>Сотрудник</th></tr>${rows}</table></body></html>`;
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })); link.download = `fbs-assembly-${dateFrom || 'all'}-${dateTo || 'all'}.xls`; link.click(); URL.revokeObjectURL(link.href);
  }

  useEffect(() => { input.current?.focus(); void reload(); }, [session.accessToken]);
  useEffect(() => {
    window.clearTimeout(scanTimer.current);
    if (busy || code.trim().length < 8 || code.trim() === submittedCode.current) return;
    scanTimer.current = window.setTimeout(() => void processScan(code.trim()), 180);
    return () => window.clearTimeout(scanTimer.current);
  }, [code, busy]);

  async function processScan(scanned: string) {
    if (busy || !scanned || scanned === submittedCode.current) return;
    submittedCode.current = scanned; setBusy(true); setMessage('Ищу заказ и получаю стикер WB…');
    try {
      const result = await scanWebOrderAssembly(session.accessToken, scanned);
      setLast(result); setCode(''); submittedCode.current = ''; printLabels(result);
      setMessage(`Выдано ровно 2 стикера для заказа №${result.orderId} · ${printer}`); await reload();
    } catch (error) {
      setCode(''); setMessage(error instanceof Error ? error.message : 'Ошибка обработки КИЗ.');
      window.setTimeout(() => { submittedCode.current = ''; input.current?.focus(); }, 250);
    } finally { setBusy(false); window.setTimeout(() => input.current?.focus(), 0); }
  }

  async function submit(event: FormEvent) { event.preventDefault(); await processScan(code.trim()); }

  return <section className="order-assembly">
    <header><span><ScanLine /></span><div><small>WILDBERRIES · ПОТОКОВАЯ СБОРКА</small><h2>Сборка заказов</h2><p>Один скан КИЗ — один заказ — два физических стикера.</p></div></header>
    <section className="order-assembly__apps">
      <a className="order-assembly__app-tile is-sos" href="/downloads/logoff-sos-wb.apk" download><span><Smartphone /></span><div><small>АВАРИЙНОЕ ПРИЛОЖЕНИЕ ДЛЯ ТСД</small><h3>SOS WB 2</h3><p>Четыре режима: по заявке, по всем заявкам, печать WB и «Короб + товар». Работает одновременно у нескольких сборщиков; факт и КИЗ записываются в WMS.</p></div><Download /></a>
      <a className="order-assembly__app-tile is-red" href="/downloads/logoff-fbs-assembly.apk" download><span><Smartphone /></span><div><small>ПРИЛОЖЕНИЕ ДЛЯ ТСД</small><h3>Сборка FBS</h3><p>Сканирование КИЗ, просмотр WB-стикера и отправка двух этикеток на выбранную станцию.</p></div><Download /></a>
      <a className="order-assembly__app-tile is-blue" href="/downloads/LOGOFF-FBS-Print-Agent.zip" download><span><Monitor /></span><div><small>ПРОГРАММА ДЛЯ WINDOWS</small><h3>Агент тихой печати</h3><p>Работает в фоне и без диалоговых окон печатает WB-стикер и сортировочную наклейку.</p></div><Download /></a>
      <article className="order-assembly__app-tile is-green"><span><Printer /></span><div><small>ПЕЧАТНАЯ СТАНЦИЯ</small><h3>Подключение принтера</h3><p>Скачайте агент, распакуйте архив и один раз запустите Install-Agent.cmd.</p></div><ShieldCheck /></article>
    </section>
    <form onSubmit={submit}><label htmlFor="order-kiz">Сканируйте КИЗ</label><div className="order-assembly__printer"><span>Принтер</span><select value={printer} onChange={(e) => { setPrinter(e.target.value); localStorage.setItem('web-order-printer', e.target.value); }}><option>XP-365B</option><option>TSC TE-200</option><option>NIIMBOT B1</option><option>DETONGER P2</option></select></div><input id="order-kiz" ref={input} autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/[\r\n]+$/g, ''))} placeholder="Курсор уже здесь — пикните QR товара" disabled={busy}/><button disabled={busy || !code.trim()}><Printer />{busy ? 'Обрабатываю…' : 'Найти и напечатать'}</button></form>
    <div className={`order-assembly__status ${message.includes('Выдано') ? 'is-ok' : ''}`}><ShieldCheck /><b>{message}</b></div>
    {last && <article><CheckCircle2 /><div><small>ПОСЛЕДНИЙ СТИКЕР</small><h3>Заказ №{last.orderId}</h3><p>{last.productName}{last.article ? ` · ${last.article}` : ''}</p><span>Короб: {last.boxCode || 'без короба'}</span></div></article>}
    <p className="order-assembly__rule">Повтор КИЗ и повтор стикера блокируются сервером на всех компьютерах.</p>
    <section className="order-assembly__history"><div className="order-assembly__history-head"><h3>Отсканированные КИЗ и выданные стикеры</h3><label>С <input type="date" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)}/></label><label>По <input type="date" value={dateTo} onChange={(e)=>setDateTo(e.target.value)}/></label><button type="button" onClick={downloadExcel}><Download size={16}/> Скачать Excel</button></div><div className="table-scroll"><table>
      <thead><tr><th>Время</th><th>КИЗ</th><th>Костюм / название</th><th>Артикул</th><th>Размер</th><th>Цвет</th><th>Заказ WB</th><th>Номер стикера</th><th>Сотрудник</th><th>Действия</th></tr></thead>
      <tbody>{filteredHistory.map((row) => <tr key={row.id}><td>{new Date(row.printedAt).toLocaleString('ru-RU')}</td><td title={row.kiz} style={{ maxWidth: 300, whiteSpace: 'normal', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>{row.kiz}</td><td>{row.productName || '—'}</td><td>{row.article || '—'}</td><td>{row.size || '—'}</td><td>{row.color || '—'}</td><td>{row.orderId}</td><td>{row.stickerCode || '—'}</td><td>{row.printedBy}</td><td><button title="Повторная печать" onClick={async () => { try { const result = await reprintWebOrderAssemblyHistory(session.accessToken, row.id); setLast(result); printLabels(result); setMessage(`Повторно напечатан заказ №${result.orderId}`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка повторной печати.'); } finally { input.current?.focus(); } }}><RotateCcw size={16}/></button><button title="Удалить и разрешить повторную печать" onClick={async () => { if (!confirm(`Удалить запись заказа №${row.orderId} и разрешить повторную печать?`)) return; await deleteWebOrderAssemblyHistory(session.accessToken, row.id); await reload(); input.current?.focus(); }}><Trash2 size={16}/></button></td></tr>)}</tbody>
    </table></div></section>
  </section>;
}
