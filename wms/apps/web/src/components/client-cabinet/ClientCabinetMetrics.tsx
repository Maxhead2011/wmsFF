import { Boxes, ClipboardList, PackageCheck, ReceiptText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  BillingChargeSummary,
  BillingInvoiceSummary,
  BillingReconciliation,
  ClientRequestSummary,
  StockBalance,
} from '../../lib/api';
import { formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';

export type ClientCabinetMetricTarget = 'skus' | 'stock' | 'requests' | 'invoices';

type ClientCabinetMetricsProps = {
  stock: StockBalance[];
  requests: ClientRequestSummary[];
  invoices: BillingInvoiceSummary[];
  charges: BillingChargeSummary[];
  reconciliation: BillingReconciliation | null;
  onNavigate: (target: ClientCabinetMetricTarget) => void;
};

const closedRequestStatuses = ['DONE', 'CANCELLED', 'REJECTED'];

export function ClientCabinetMetrics({ stock, requests, invoices, charges, reconciliation, onNavigate }: ClientCabinetMetricsProps) {
  const uniqueSkuCount = new Set(stock.map((balance) => balance.skuId)).size;
  const totalQuantity = stock.reduce((sum, balance) => sum + Number(balance.quantity), 0);
  const activeRequests = requests.filter((request) => !closedRequestStatuses.includes(request.status)).length;
  const invoiceDebtRub =
    reconciliation?.totals.debtRub ??
    invoices
      .filter((invoice) => invoice.status !== 'CANCELLED')
      .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub)), 0);
  const debtRub = invoiceDebtRub + unbilledApprovedChargesRub(charges, invoices);

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
    </div>
  );
}

function unbilledApprovedChargesRub(charges: BillingChargeSummary[], invoices: BillingInvoiceSummary[]) {
  const invoicedChargeIds = new Set(
    invoices
      .filter((invoice) => invoice.status !== 'CANCELLED')
      .flatMap((invoice) => invoice.items.map((item) => item.chargeId).filter((chargeId): chargeId is string => Boolean(chargeId))),
  );

  return charges
    .filter((charge) => charge.status === 'APPROVED' && !invoicedChargeIds.has(charge.id))
    .reduce((sum, charge) => sum + Number(charge.totalRub), 0);
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
