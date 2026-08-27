import { BadgeRussianRuble, Boxes, ClipboardList, HandCoins, PackageCheck, ReceiptText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  BillingInvoiceSummary,
  ClientRequestSummary,
  StockBalance,
} from '../../lib/api';
import { formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';

export type ClientCabinetMetricTarget = 'skus' | 'stock' | 'requests' | 'invoices';

type ClientCabinetMetricsProps = {
  stock: StockBalance[];
  requests: ClientRequestSummary[];
  invoices: BillingInvoiceSummary[];
  advanceRub: number;
  onNavigate: (target: ClientCabinetMetricTarget) => void;
  onOpenAdvance: () => void;
};

const closedRequestStatuses = ['DONE', 'CANCELLED', 'REJECTED'];

export function ClientCabinetMetrics({
  stock,
  requests,
  invoices,
  advanceRub,
  onNavigate,
  onOpenAdvance,
}: ClientCabinetMetricsProps) {
  const uniqueSkuCount = new Set(stock.map((balance) => balance.skuId)).size;
  const totalQuantity = stock.reduce((sum, balance) => sum + Number(balance.quantity), 0);
  const activeRequests = requests.filter((request) => !closedRequestStatuses.includes(request.status)).length;
  // «К оплате» — это долг только по уже выставленным счетам.
  // Черновики и ещё не выставленные начисления не являются задолженностью клиента.
  const invoiceGrossDebtRub = invoices
    .filter((invoice) => invoice.status === 'ISSUED')
    .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub)), 0);
  const debtRub = Math.max(0, invoiceGrossDebtRub - advanceRub);
  const fbsInvoicesRub = invoices
    .filter((invoice) => invoice.status === 'ISSUED' || invoice.status === 'PAID')
    .reduce(
      (sum, invoice) => sum + fbsInvoiceItemsRub(invoice),
      0,
    );

  return (
    <div className="client-cabinet-metrics" aria-label="Сводка клиента">
      <MetricTile icon={PackageCheck} label="SKU" value={formatCabinetNumber(uniqueSkuCount)} onClick={() => onNavigate('skus')} />
      <MetricTile
        icon={Boxes}
        label="Единиц на остатке"
        value={formatCabinetNumber(totalQuantity)}
        onClick={() => onNavigate('stock')}
      />
      <MetricTile
        icon={ClipboardList}
        label="Активные заявки"
        value={formatCabinetNumber(activeRequests)}
        onClick={() => onNavigate('requests')}
      />
      <MetricTile
        icon={ReceiptText}
        label="К оплате"
        value={`${formatCabinetMoney(debtRub)} ₽`}
        onClick={() => onNavigate('invoices')}
      />
      <MetricTile
        icon={HandCoins}
        label="Авансирование"
        value={`${formatCabinetMoney(advanceRub)} ₽`}
        onClick={onOpenAdvance}
      />
      <MetricTile
        icon={BadgeRussianRuble}
        label="Выставлено по FBS"
        value={`${formatCabinetMoney(fbsInvoicesRub)} ₽`}
        onClick={() => onNavigate('invoices')}
      />
    </div>
  );
}

function fbsInvoiceItemsRub(invoice: BillingInvoiceSummary) {
  const hasFbsMarker =
    isFbsSourceKey(invoice.sourceKey) ||
    invoice.items.some((item) => isFbsSourceKey(item.charge?.sourceKey) || /\bFBS\b/i.test(item.description));

  if (!hasFbsMarker) {
    return 0;
  }

  return invoice.items
    .filter((item) => {
      if (isFbsSourceKey(item.charge?.sourceKey) || /\bFBS\b/i.test(item.description)) {
        return true;
      }

      // В объединённых FBS-счетах строки первичной обработки и перемаркировки
      // могут не иметь chargeId, но относятся к тем же FBS-заказам.
      return /^(Первичная обработка|Перемаркировка)/i.test(item.description.trim());
    })
    .reduce((sum, item) => sum + Number(item.totalRub), 0);
}

function isFbsSourceKey(sourceKey: string | null | undefined) {
  return Boolean(sourceKey && (/^fbs[-:]/i.test(sourceKey) || /^fbs$/i.test(sourceKey)));
}

function MetricTile({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button className="client-cabinet-metric" type="button" onClick={onClick}>
      <Icon size={21} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </button>
  );
}
