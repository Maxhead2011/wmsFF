import { Boxes, CalendarDays, Download, PackageCheck, RefreshCw, Warehouse } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadFbsShipmentReportXlsx,
  downloadFbsStockMonitorWmsStocks,
  fetchBranches,
  fetchFbsBoxStockReport,
  fetchFbsShipmentReport,
  fetchWmsAvailabilityReport,
  type AuthSession,
  type BranchSummary,
  type ClientSummary,
  type FbsBoxStockReport,
  type FbsShipmentReport,
  type WmsAvailabilityReport,
} from '../../lib/api';
import './fbs-stock-reports.css';

type Props = {
  session: AuthSession;
  clients: ClientSummary[];
  clientId: string;
  onClientChange: (clientId: string) => void;
};

type QuickPeriod = 'today' | 'yesterday' | '7days' | '30days' | 'month';

export function FbsStockReportsPanel({ session, clients, clientId, onClientChange }: Props) {
  const initialPeriod = useMemo(() => reportPeriod('7days'), []);
  const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
  const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
  const [warehouseId, setWarehouseId] = useState('');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [shipment, setShipment] = useState<FbsShipmentReport | null>(null);
  const [boxes, setBoxes] = useState<FbsBoxStockReport | null>(null);
  const [availability, setAvailability] = useState<WmsAvailabilityReport | null>(null);
  const [shipmentPage, setShipmentPage] = useState(1);
  const [boxPage, setBoxPage] = useState(1);
  const [palletPage, setPalletPage] = useState(1);
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [loadingBoxes, setLoadingBoxes] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [downloadingStocks, setDownloadingStocks] = useState(false);
  const [downloadingShipments, setDownloadingShipments] = useState(false);
  const [error, setError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [shipmentError, setShipmentError] = useState('');
  const [boxesError, setBoxesError] = useState('');
  const availabilityRequest = useRef(0);
  const shipmentRequest = useRef(0);
  const boxesRequest = useRef(0);

  useEffect(() => {
    void fetchBranches(session.accessToken)
      .then((items) => setBranches(items.filter((item) => item.isActive)))
      .catch((caught) => setError(errorMessage(caught)));
  }, [session.accessToken]);

  useEffect(() => {
    if (!clientId) return;
    setShipmentPage(1);
    setBoxPage(1);
    setPalletPage(1);
    // FIX: clear data from the previous scope before loading the selected client/warehouse.
    setAvailability(null);
    setShipment(null);
    setBoxes(null);
    void refreshAll(1, 1, 1);
  }, [clientId, warehouseId]);

  async function loadAvailability() {
    if (!clientId) return;
    const requestId = ++availabilityRequest.current;
    setLoadingAvailability(true);
    setAvailability(null);
    setAvailabilityError('');
    try {
      const result = await fetchWmsAvailabilityReport(session.accessToken, {
        clientId,
        warehouseId: warehouseId || undefined,
      });
      if (requestId === availabilityRequest.current) setAvailability(result);
    } catch (caught) {
      if (requestId === availabilityRequest.current) setAvailabilityError(errorMessage(caught));
    } finally {
      if (requestId === availabilityRequest.current) setLoadingAvailability(false);
    }
  }

  async function loadShipments(page = shipmentPage, period = { dateFrom, dateTo }) {
    if (!clientId) return;
    const requestId = ++shipmentRequest.current;
    setLoadingShipments(true);
    setShipment(null);
    setShipmentError('');
    try {
      const result = await fetchFbsShipmentReport(session.accessToken, {
        clientId,
        warehouseId: warehouseId || undefined,
        ...period,
        page,
        pageSize: 20,
      });
      if (requestId === shipmentRequest.current) {
        setShipment(result);
        setShipmentPage(page);
      }
    } catch (caught) {
      if (requestId === shipmentRequest.current) setShipmentError(errorMessage(caught));
    } finally {
      if (requestId === shipmentRequest.current) setLoadingShipments(false);
    }
  }

  async function loadBoxes(page = boxPage, nextPalletPage = palletPage) {
    if (!clientId) return;
    const requestId = ++boxesRequest.current;
    setLoadingBoxes(true);
    setBoxes(null);
    setBoxesError('');
    try {
      const result = await fetchFbsBoxStockReport(session.accessToken, {
        clientId,
        warehouseId: warehouseId || undefined,
        page,
        pageSize: 50,
        palletPage: nextPalletPage,
        palletPageSize: 50,
      });
      if (requestId === boxesRequest.current) {
        setBoxes(result);
        setBoxPage(page);
        setPalletPage(nextPalletPage);
      }
    } catch (caught) {
      if (requestId === boxesRequest.current) setBoxesError(errorMessage(caught));
    } finally {
      if (requestId === boxesRequest.current) setLoadingBoxes(false);
    }
  }

  // FIX: one refresh now reloads every dataset shown on the page.
  async function refreshAll(nextShipmentPage = shipmentPage, nextBoxPage = boxPage, nextPalletPage = palletPage) {
    await Promise.all([
      loadAvailability(),
      loadShipments(nextShipmentPage),
      loadBoxes(nextBoxPage, nextPalletPage),
    ]);
  }

  function applyQuickPeriod(kind: QuickPeriod) {
    const period = reportPeriod(kind);
    setDateFrom(period.dateFrom);
    setDateTo(period.dateTo);
    setShipmentPage(1);
    void loadShipments(1, period);
  }

  async function exportStocks() {
    if (!clientId) return;
    setDownloadingStocks(true);
    setError('');
    try {
      const blob = await downloadFbsStockMonitorWmsStocks(session.accessToken, clientId, warehouseId || undefined);
      downloadBlob(blob, `wms_stocks_${fileDateTime()}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDownloadingStocks(false);
    }
  }

  async function exportShipments() {
    if (!clientId) return;
    setDownloadingShipments(true);
    setError('');
    try {
      const blob = await downloadFbsShipmentReportXlsx(session.accessToken, {
        clientId,
        dateFrom,
        dateTo,
        warehouseId: warehouseId || undefined,
      });
      downloadBlob(blob, `fbs_shipments_${dateFrom}_${dateTo}.xlsx`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDownloadingShipments(false);
    }
  }

  return (
    <div className="fbs-stock-reports">
      <section className="fbs-stock-reports__toolbar" aria-label="Фильтры отчётов">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => onClientChange(event.target.value)}>
            {clients.length === 0 ? <option value="">Клиенты не найдены</option> : null}
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Склад</span>
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Все доступные склады</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.city}</option>)}
          </select>
        </label>
        <div className="fbs-stock-reports__updated">
          <div>
            <RefreshCw size={15} aria-hidden="true" />
            <span>{freshnessLabel(availability, shipment, boxes)}</span>
          </div>
          <button className="secondary-button" type="button" disabled={!clientId || loadingAvailability || loadingShipments || loadingBoxes} onClick={() => void refreshAll()}>
            <RefreshCw size={16} className={loadingAvailability || loadingShipments || loadingBoxes ? 'is-spinning' : ''} />
            Обновить всё
          </button>
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="fbs-stock-reports__section" aria-labelledby="wms-stock-export-title">
        <header>
          <div>
            <h3 id="wms-stock-export-title">Доступные остатки WMS</h3>
            <p>Одна строка на штрихкод. Количество = фактический остаток WMS минус активный резерв, не ниже нуля.</p>
          </div>
          <button className="primary-button" type="button" disabled={!clientId || downloadingStocks} onClick={() => void exportStocks()}>
            <Download size={16} aria-hidden="true" />
            <span>{downloadingStocks ? 'Формирую Excel' : 'Выгрузить остатки в Excel'}</span>
          </button>
        </header>
        {availabilityError ? <p className="form-error">{availabilityError}</p> : null}
        <div className="fbs-stock-reports__facts" aria-label="Параметры выгрузки">
          <span><PackageCheck size={16} />Только «ШК» и «Количество»</span>
          <span><Boxes size={16} />Все товары, независимо от пагинации</span>
        </div>
        <div className="fbs-stock-reports__metrics fbs-stock-reports__metrics--four">
          <Metric icon={<Boxes size={18} />} label="Остаток WMS" value={reportValue(loadingAvailability, availability?.totals.total)} />
          <Metric icon={<PackageCheck size={18} />} label="Активный резерв" value={reportValue(loadingAvailability, availability?.totals.reserved)} />
          <Metric icon={<PackageCheck size={18} />} label="Доступно" value={reportValue(loadingAvailability, availability?.totals.available)} />
          <Metric icon={<PackageCheck size={18} />} label="Штрихкодов" value={reportValue(loadingAvailability, availability?.totals.barcodes)} />
        </div>
      </section>

      <section className="fbs-stock-reports__section" aria-labelledby="fbs-shipment-title">
        <header>
          <div>
            <h3 id="fbs-shipment-title">Отгруженные заказы FBS</h3>
            <p>Считаются уникальные заказы по фактической дате перехода заявки WMS в «Выполнено».</p>
          </div>
          <button className="secondary-button" type="button" disabled={!clientId || downloadingShipments} onClick={() => void exportShipments()}>
            <Download size={16} aria-hidden="true" />
            <span>{downloadingShipments ? 'Формирую Excel' : 'Скачать весь период'}</span>
          </button>
        </header>
        {shipmentError ? <p className="form-error">{shipmentError}</p> : null}

        <div className="fbs-stock-reports__period">
          <label><span>Дата начала</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>Дата окончания</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <button className="primary-button" type="button" disabled={!clientId || loadingShipments} onClick={() => void loadShipments(1)}>
            <CalendarDays size={16} />Показать
          </button>
        </div>
        <div className="fbs-stock-reports__quick-periods" aria-label="Быстрый выбор периода">
          <button className="secondary-button" type="button" onClick={() => applyQuickPeriod('today')}>Сегодня</button>
          <button className="secondary-button" type="button" onClick={() => applyQuickPeriod('yesterday')}>Вчера</button>
          <button className="secondary-button" type="button" onClick={() => applyQuickPeriod('7days')}>7 дней</button>
          <button className="secondary-button" type="button" onClick={() => applyQuickPeriod('30days')}>30 дней</button>
          <button className="secondary-button" type="button" onClick={() => applyQuickPeriod('month')}>Текущий месяц</button>
        </div>

        <div className="fbs-stock-reports__metrics">
          <Metric icon={<PackageCheck size={18} />} label="Отгружено заказов" value={reportValue(loadingShipments, shipment?.summary.orders)} />
          <Metric icon={<Boxes size={18} />} label="Отгружено единиц" value={reportValue(loadingShipments, shipment?.summary.units)} />
        </div>

        <div className="fbs-stock-reports__daily" aria-label="Отгрузки по дням">
          {(shipment?.daily ?? []).map((day) => (
            <div key={day.date}><strong>{formatDate(day.date)}</strong><span>{formatNumber(day.orders)} заказов · {formatNumber(day.units)} шт</span></div>
          ))}
          {!loadingShipments && shipment?.daily.length === 0 ? <p>За выбранный период отгрузок FBS нет.</p> : null}
        </div>

        <div className="turnover-table-wrap">
          <table className="turnover-table fbs-stock-reports__table">
            <thead><tr><th>Заказ</th><th>Дата отгрузки</th><th>Склад</th><th>Единиц</th></tr></thead>
            <tbody>
              {loadingShipments ? <tr><td colSpan={4}>Загружаю отгруженные заказы.</td></tr> : null}
              {!loadingShipments && shipment?.items.length === 0 ? <tr><td colSpan={4}>Заказы не найдены.</td></tr> : null}
              {(shipment?.items ?? []).map((item) => (
                <tr key={`${item.marketplace}-${item.orderId}`}><td><strong>{item.orderId}</strong><span>{item.marketplace} · заявка №{item.requestNumber}</span></td><td>{formatDateTime(item.shippedAt)}</td><td>{item.warehouse}</td><td>{formatNumber(item.units)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={shipmentPage} pages={shipment?.pagination.pages ?? 1} disabled={loadingShipments} onPage={(page) => void loadShipments(page)} />
      </section>

      <section className="fbs-stock-reports__section" aria-labelledby="box-report-title">
        <header>
          <div>
            <h3 id="box-report-title">Короба и паллетсорт</h3>
            <p>Группы взаимоисключающие: принадлежность определяется только фактической связью короба с паллетсортом.</p>
          </div>
        </header>
        {boxesError ? <p className="form-error">{boxesError}</p> : null}

        <div className="fbs-stock-reports__box-block">
          <div className="fbs-stock-reports__subheading"><div><Boxes size={19} /><h4>Короба без паллетсорта</h4></div><span>{loadingBoxes ? 'Загружаю…' : `${formatNumber(boxes?.withoutPallet.summary.boxes ?? 0)} коробов · ${formatNumber(boxes?.withoutPallet.summary.units ?? 0)} шт`}</span></div>
          <div className="turnover-table-wrap">
            <table className="turnover-table fbs-stock-reports__table fbs-stock-reports__table--boxes">
              <thead><tr><th>Короб</th><th>Склад / место</th><th>Статус</th><th>ШК</th><th>Артикул</th><th>Количество, шт</th><th>Всего в коробе</th></tr></thead>
              <tbody>
                {loadingBoxes ? <tr><td colSpan={7}>Загружаю короба без паллетсорта.</td></tr> : null}
                {!loadingBoxes && boxes?.withoutPallet.items.length === 0 ? <tr><td colSpan={7}>Актуальных коробов без паллетсорта нет.</td></tr> : null}
                {(boxes?.withoutPallet.items ?? []).map((item, index) => (
                  <tr key={`${item.boxCode}-${item.barcode}-${item.article}-${index}`}><td><strong>{item.boxCode}</strong></td><td>{item.warehouse}<span>{item.location}</span></td><td>{item.status}</td><td>{item.barcode || '—'}</td><td>{item.article || '—'}</td><td>{formatNumber(item.quantity)}</td><td><strong>{formatNumber(item.boxTotal)}</strong></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={boxPage} pages={boxes?.withoutPallet.pagination.pages ?? 1} disabled={loadingBoxes} onPage={(page) => void loadBoxes(page, palletPage)} />
        </div>

        <div className="fbs-stock-reports__box-block">
          <div className="fbs-stock-reports__subheading"><div><Warehouse size={19} /><h4>Остатки в коробах на паллетсорте</h4></div><span>{loadingBoxes ? 'Загружаю…' : `${formatNumber(boxes?.onPallet.summary.pallets ?? 0)} паллет · ${formatNumber(boxes?.onPallet.summary.boxes ?? 0)} коробов`}</span></div>
          <div className="fbs-stock-reports__metrics fbs-stock-reports__metrics--four">
            <Metric icon={<Warehouse size={18} />} label="Паллет" value={reportValue(loadingBoxes, boxes?.onPallet.summary.pallets)} />
            <Metric icon={<Boxes size={18} />} label="Коробов" value={reportValue(loadingBoxes, boxes?.onPallet.summary.boxes)} />
            <Metric icon={<PackageCheck size={18} />} label="Единиц" value={reportValue(loadingBoxes, boxes?.onPallet.summary.units)} />
            <Metric icon={<PackageCheck size={18} />} label="Уникальных ШК" value={reportValue(loadingBoxes, boxes?.onPallet.summary.barcodes)} />
          </div>
          <div className="turnover-table-wrap">
            <table className="turnover-table fbs-stock-reports__table">
              <thead><tr><th>Паллетсорт</th><th>ШК</th><th>Коробов</th><th>Единиц</th></tr></thead>
              <tbody>
                {loadingBoxes ? <tr><td colSpan={4}>Загружаю остатки на паллетсортах.</td></tr> : null}
                {!loadingBoxes && boxes?.onPallet.items.length === 0 ? <tr><td colSpan={4}>Остатков на паллетсортах нет.</td></tr> : null}
                {(boxes?.onPallet.items ?? []).map((item) => <tr key={`${item.palletCode}-${item.barcode}`}><td><strong>{item.palletCode}</strong></td><td>{item.barcode || 'Без ШК'}</td><td>{formatNumber(item.boxes)}</td><td><strong>{formatNumber(item.quantity)}</strong></td></tr>)}
              </tbody>
            </table>
          </div>
          <Pager page={palletPage} pages={boxes?.onPallet.pagination.pages ?? 1} disabled={loadingBoxes} onPage={(page) => void loadBoxes(boxPage, page)} />
        </div>
      </section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="fbs-stock-reports__metric"><span>{icon}{label}</span><strong>{value}</strong></div>;
}

function Pager({ page, pages, disabled, onPage }: { page: number; pages: number; disabled: boolean; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="fbs-stock-reports__pager"><button className="secondary-button" type="button" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Назад</button><span>Страница {page} из {pages}</span><button className="secondary-button" type="button" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Далее</button></div>;
}

// TEST: quick periods are built in the project timezone and include both date
// boundaries; this avoids UTC shifting the report by one day.
export function reportPeriod(kind: QuickPeriod, now = new Date()): { dateFrom: string; dateTo: string } {
  const today = new Date(now.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 10);
  const end = new Date(`${today}T00:00:00.000Z`);
  const start = new Date(end);
  if (kind === 'yesterday') { start.setUTCDate(start.getUTCDate() - 1); end.setUTCDate(end.getUTCDate() - 1); }
  if (kind === '7days') start.setUTCDate(start.getUTCDate() - 6);
  if (kind === '30days') start.setUTCDate(start.getUTCDate() - 29);
  if (kind === 'month') start.setUTCDate(1);
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}

// TEST: the page reports the freshness of every visible dataset, not boxes alone.
export function freshnessLabel(availability: WmsAvailabilityReport | null, shipment: FbsShipmentReport | null, boxes: FbsBoxStockReport | null) {
  const stamp = (value?: string) => value ? formatDateTime(value) : '—';
  return `WMS: ${stamp(availability?.generatedAt)} · FBS: ${stamp(shipment?.generatedAt)} · короба: ${stamp(boxes?.generatedAt)}`;
}

// TEST: loading and not-yet-loaded datasets must never look like factual zero stock.
export function reportValue(loading: boolean, value: number | undefined) {
  return loading || value === undefined ? '—' : formatNumber(value);
}

function formatNumber(value: number) { return new Intl.NumberFormat('ru-RU').format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00+03:00`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(value)); }
function fileDateTime() { return new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-'); }
function errorMessage(caught: unknown) { return caught instanceof Error ? caught.message : 'Не удалось загрузить отчёт. Повторите попытку.'; }
function downloadBlob(blob: Blob, fileName: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); }

