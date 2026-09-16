import type { BillingInvoiceSummary } from '../../lib/api';
import { billingUnitLabel } from './billingMeta';

type Item = BillingInvoiceSummary['items'][number];
type SummaryRow = {
  key: string; description: string; unit: Item['unit']; quantity: number;
  unitPriceRub: number; totalRub: number; dateFrom: string; dateTo: string;
};
const round = (value: number, scale: number) => Math.round((value + Number.EPSILON) * scale) / scale;

// FIX: presentation only. Preserve original IDs, charges and rounded amounts for editing/payment.
export function summarizeInvoiceItems(items: Item[]): SummaryRow[] {
  const groups = new Map<string, SummaryRow>();
  for (const item of items) {
    const description = item.description.trim().replace(/\s+/g, ' ');
    const price = round(Number(item.unitPriceRub), 100);
    const key = JSON.stringify([description.toLocaleLowerCase('ru-RU'), item.unit, price]);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { key, description, unit: item.unit, quantity: Number(item.quantity),
        unitPriceRub: price, totalRub: round(Number(item.totalRub), 100),
        dateFrom: item.serviceDate, dateTo: item.serviceDate });
    } else {
      current.quantity = round(current.quantity + Number(item.quantity), 1000);
      current.totalRub = round(current.totalRub + Number(item.totalRub), 100);
      if (item.serviceDate < current.dateFrom) current.dateFrom = item.serviceDate;
      if (item.serviceDate > current.dateTo) current.dateTo = item.serviceDate;
    }
  }
  return [...groups.values()];
}

const date = (value: string) => new Date(value).toLocaleDateString('ru-RU');
const money = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function BillingInvoiceServiceSummary({ items }: { items: Item[] }) {
  const rows = summarizeInvoiceItems(items);
  return <section aria-label="Сводка услуг счёта">
    <h4>Услуги — суммарно</h4>
    <div className="billing-table-wrap"><table className="data-table billing-table">
      <thead><tr><th>Услуга</th><th>Период оказания</th><th>Ед.</th><th>Количество</th><th>Тариф, ₽</th><th>Сумма, ₽</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>
        <td>{row.description}</td><td>{date(row.dateFrom)}{date(row.dateFrom) !== date(row.dateTo) ? ` — ${date(row.dateTo)}` : ''}</td>
        <td>{billingUnitLabel(row.unit)}</td><td>{row.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
        <td>{money(row.unitPriceRub)}</td><td>{money(row.totalRub)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
