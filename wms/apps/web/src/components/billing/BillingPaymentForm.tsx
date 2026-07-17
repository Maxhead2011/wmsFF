import { CreditCard } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createBillingPayment, type AuthSession, type BillingInvoiceSummary } from '../../lib/api';

type BillingPaymentFormProps = {
  invoices: BillingInvoiceSummary[];
  session: AuthSession;
  onPaid: (invoice: BillingInvoiceSummary) => void;
};

export function BillingPaymentForm({ invoices, session, onPaid }: BillingPaymentFormProps) {
  const payableInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoice.status !== 'CANCELLED' && invoice.status !== 'PAID' && remainingRub(invoice) > 0,
      ),
    [invoices],
  );
  const [invoiceId, setInvoiceId] = useState(payableInvoices[0]?.id ?? '');
  const selectedInvoice = payableInvoices.find((invoice) => invoice.id === invoiceId) ?? payableInvoices[0];
  const [amountRub, setAmountRub] = useState(selectedInvoice ? String(remainingRub(selectedInvoice)) : '');
  const [paidAt, setPaidAt] = useState(today());
  const [method, setMethod] = useState('Банк');
  const [reference, setReference] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedInvoice) {
      setInvoiceId('');
      setAmountRub('');
      return;
    }

    setInvoiceId(selectedInvoice.id);
    setAmountRub(String(remainingRub(selectedInvoice)));
  }, [selectedInvoice?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice) {
      setError('Нет счета для оплаты.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const invoice = await createBillingPayment(session.accessToken, {
        invoiceId: selectedInvoice.id,
        amountRub: Number(amountRub),
        paidAt,
        method: method || undefined,
        reference: reference || undefined,
        comment: comment || undefined,
      });
      onPaid(invoice);
      setReference('');
      setComment('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось принять оплату.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="billing-form" onSubmit={(event) => void submit(event)}>
      <div className="billing-fields billing-fields--payment">
        <label>
          <span>Счет</span>
          <select value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
            {payableInvoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.number} - {invoice.client.code}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Сумма</span>
          <input
            min="0.01"
            step="0.01"
            type="number"
            value={amountRub}
            onChange={(event) => setAmountRub(event.target.value)}
          />
        </label>

        <label>
          <span>Дата оплаты</span>
          <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </label>

        <label>
          <span>Способ</span>
          <input value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Банк" />
        </label>

        <label>
          <span>Номер платежа</span>
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="п/п или транзакция" />
        </label>

        <label className="billing-fields__wide">
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="к оплате" />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button billing-submit" disabled={isSubmitting || !selectedInvoice} type="submit">
        <CreditCard size={17} aria-hidden="true" />
        <span>{isSubmitting ? 'Провожу' : 'Принять оплату'}</span>
      </button>
    </form>
  );
}

function remainingRub(invoice: BillingInvoiceSummary) {
  return Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
