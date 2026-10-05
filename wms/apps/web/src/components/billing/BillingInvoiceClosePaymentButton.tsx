import { useRef, useState } from 'react';
import { updateBillingInvoiceStatus, type AuthSession, type BillingInvoiceSummary } from '../../lib/api';

// FIX: only the explicit payment action registers a receipt; closing the card does not.
export function BillingInvoiceClosePaymentButton({ invoiceId, session, onPaid }: {
  invoiceId: string;
  session: AuthSession;
  onPaid: (invoice: BillingInvoiceSummary) => void;
}) {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirmPayment() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const updated = await updateBillingInvoiceStatus(session.accessToken, invoiceId, { status: 'PAID' });
      onPaid(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось зарегистрировать полную оплату.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return <>
    <p>Подтверждая оплату, вы регистрируете весь остаток долга. Платёж появится в «Приходе ДС». Частичную оплату указывайте в «Приходе ДС».</p>
    <button type="button" disabled={pending} onClick={confirmPayment}>{pending ? 'Регистрируем оплату…' : 'Оплачен — закрыть счёт'}</button>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
