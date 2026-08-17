import { ArrowDownToLine, CheckCircle2, CircleDollarSign, Eraser, WandSparkles } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useRememberedClientId } from '../../lib/rememberedClient';
import {
  createIncomingPayment,
  type AuthSession,
  type BillingInvoiceSummary,
  type ClientSummary,
} from '../../lib/api';

type BillingCashReceiptPanelProps = {
  clients: ClientSummary[];
  invoices: BillingInvoiceSummary[];
  session: AuthSession;
  onPaid: (invoices: BillingInvoiceSummary[]) => void;
};

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});

export function BillingCashReceiptPanel({ clients, invoices, session, onPaid }: BillingCashReceiptPanelProps) {
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [statusFilter, setStatusFilter] = useState<'all' | 'DRAFT' | 'ISSUED' | 'OVERDUE'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'unpaid' | 'partial'>('all');
  const [totalRub, setTotalRub] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [paidAt, setPaidAt] = useState(today());
  const [method, setMethod] = useState('Банк');
  const [reference, setReference] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const clientPayableInvoices = useMemo(
    () =>
      invoices
        .filter(
          (invoice) =>
            invoice.clientId === clientId &&
            invoice.status !== 'CANCELLED' &&
            invoice.status !== 'PAID' &&
            !isMergedSourceInvoice(invoice) &&
            remainingRub(invoice) > 0,
        )
        .sort(
          (left, right) =>
            new Date(left.dueDate ?? left.periodTo).getTime() - new Date(right.dueDate ?? right.periodTo).getTime() ||
            left.number.localeCompare(right.number, 'ru-RU', { numeric: true }),
        ),
    [clientId, invoices],
  );
  const payableInvoices = useMemo(
    () => clientPayableInvoices.filter((invoice) => {
      if (statusFilter === 'OVERDUE' && !isInvoiceOverdue(invoice)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'OVERDUE' && invoice.status !== statusFilter) return false;
      const paidRub = Number(invoice.paidRub);
      if (paymentFilter === 'unpaid' && paidRub > 0.009) return false;
      if (paymentFilter === 'partial' && paidRub <= 0.009) return false;
      return true;
    }),
    [clientPayableInvoices, paymentFilter, statusFilter],
  );
  const clientDebt = clientPayableInvoices.reduce((sum, invoice) => sum + remainingRub(invoice), 0);
  const allocatedRub = roundMoney(
    Object.values(allocations).reduce((sum, value) => sum + positiveNumber(value), 0),
  );
  const incomingRub = positiveNumber(totalRub);
  const undistributedRub = roundMoney(incomingRub - allocatedRub);
  const isBalanced = incomingRub > 0 && Math.abs(undistributedRub) < 0.01;

  function selectClient(nextClientId: string) {
    setClientId(nextClientId);
    setTotalRub('');
    setAllocations({});
    clearFeedback();
  }

  function distributeAutomatically() {
    clearFeedback();
    if (!clientId) {
      setError('Сначала выберите клиента.');
      return;
    }
    if (incomingRub <= 0) {
      setError('Укажите сумму поступления.');
      return;
    }
    if (incomingRub > clientDebt + 0.009) {
      setError(`Сумма поступления превышает долг по счетам на ${money(incomingRub - clientDebt)}.`);
      return;
    }

    let left = incomingRub;
    const next: Record<string, string> = {};
    for (const invoice of payableInvoices) {
      if (left <= 0.009) break;
      const amount = roundMoney(Math.min(left, remainingRub(invoice)));
      if (amount > 0) {
        next[invoice.id] = amount.toFixed(2);
        left = roundMoney(left - amount);
      }
    }
    setAllocations(next);
  }

  function toggleInvoice(invoice: BillingInvoiceSummary) {
    clearFeedback();
    setAllocations((current) => {
      const next = { ...current };
      if (next[invoice.id] !== undefined) {
        delete next[invoice.id];
      } else {
        next[invoice.id] = remainingRub(invoice).toFixed(2);
      }
      setTotalRub(
        roundMoney(Object.values(next).reduce((sum, value) => sum + positiveNumber(value), 0)).toFixed(2),
      );
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    if (!clientId || !selectedClient) {
      setError('Выберите клиента.');
      return;
    }
    if (!isBalanced) {
      setError('Распределите всю сумму поступления по счетам клиента.');
      return;
    }
    const paymentAllocations = payableInvoices
      .map((invoice) => ({ invoiceId: invoice.id, amountRub: positiveNumber(allocations[invoice.id] ?? '') }))
      .filter((allocation) => allocation.amountRub > 0);
    if (paymentAllocations.length === 0) {
      setError('Выберите хотя бы один счёт для оплаты.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createIncomingPayment(session.accessToken, {
        clientId,
        totalRub: incomingRub,
        allocations: paymentAllocations,
        paidAt,
        method: method || undefined,
        reference: reference || undefined,
        comment: comment || undefined,
      });
      onPaid(result.invoices);
      setMessage(`Приход ${money(result.totalRub)} проведён по ${result.invoices.length} счёт(ам).`);
      setTotalRub('');
      setAllocations({});
      setReference('');
      setComment('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось провести приход денежных средств.');
    } finally {
      setSubmitting(false);
    }
  }

  function clearFeedback() {
    setError('');
    setMessage('');
  }

  return (
    <form className="billing-cash-receipt" onSubmit={(event) => void submit(event)}>
      <header className="billing-cash-receipt__heading">
        <div className="billing-cash-receipt__icon"><ArrowDownToLine size={22} /></div>
        <div>
          <span>Банковские и прочие поступления</span>
          <h3>Приход денежных средств</h3>
          <p>Выберите клиента и распределите поступившую сумму по его неоплаченным счетам.</p>
        </div>
      </header>

      <div className="billing-cash-receipt__fields">
        <label className="billing-cash-receipt__client">
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => selectClient(event.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Сумма поступления</span>
          <input min="0.01" step="0.01" type="number" value={totalRub} onChange={(event) => { setTotalRub(event.target.value); clearFeedback(); }} placeholder="0,00" />
        </label>
        <label>
          <span>Дата поступления</span>
          <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </label>
        <label>
          <span>Способ</span>
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="Банк">Банк</option>
            <option value="СБП">СБП</option>
            <option value="Касса">Касса</option>
            <option value="Взаимозачёт">Взаимозачёт</option>
          </select>
        </label>
        <label>
          <span>Номер платежа</span>
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Платёжное поручение" />
        </label>
        <label className="billing-cash-receipt__comment">
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Необязательно" />
        </label>
      </div>

      {selectedClient ? (
        <>
          <div className="billing-cash-receipt__filters">
            <label>
              <span>Статус счёта</span>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setAllocations({}); }}>
                <option value="all">Все статусы</option>
                <option value="DRAFT">Черновики</option>
                <option value="ISSUED">Выставленные</option>
                <option value="OVERDUE">Просроченные</option>
              </select>
            </label>
            <label>
              <span>Состояние оплаты</span>
              <select value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value as typeof paymentFilter); setAllocations({}); }}>
                <option value="all">Все неоплаченные</option>
                <option value="unpaid">Оплат ещё не было</option>
                <option value="partial">Частично оплаченные</option>
              </select>
            </label>
            <small>
              Показано счетов: <strong>{payableInvoices.length}</strong> из {clientPayableInvoices.length}.
              Исходные счета, уже вошедшие в объединённый, скрыты.
            </small>
          </div>

          <div className="billing-cash-receipt__summary">
            <article><small>Клиент</small><strong>{selectedClient.name}</strong><span>{selectedClient.code}</span></article>
            <article><small>Долг по счетам</small><strong>{money(clientDebt)}</strong><span>{payableInvoices.length} неоплаченных</span></article>
            <article><small>Сумма прихода</small><strong>{money(incomingRub)}</strong><span>по документу</span></article>
            <article className={isBalanced ? 'is-ok' : undistributedRub < 0 ? 'is-error' : ''}>
              <small>Распределено</small><strong>{money(allocatedRub)}</strong><span>{isBalanced ? 'суммы совпадают' : `осталось ${money(undistributedRub)}`}</span>
            </article>
          </div>

          <div className="billing-cash-receipt__toolbar">
            <button className="secondary-button" type="button" onClick={distributeAutomatically} disabled={incomingRub <= 0 || payableInvoices.length === 0}>
              <WandSparkles size={16} /><span>Распределить автоматически</span>
            </button>
            <button className="secondary-button" type="button" onClick={() => { setAllocations({}); setTotalRub(''); clearFeedback(); }} disabled={allocatedRub === 0 && incomingRub === 0}>
              <Eraser size={16} /><span>Очистить</span>
            </button>
          </div>

          <div className="billing-cash-receipt__table-wrap">
            <table className="billing-cash-receipt__table">
              <thead><tr><th aria-label="Выбор" /><th>Счёт</th><th>Статус</th><th>Оплатить до</th><th>Сумма</th><th>Оплачено</th><th>Остаток</th><th>Зачесть</th></tr></thead>
              <tbody>
                {payableInvoices.map((invoice) => {
                  const selected = allocations[invoice.id] !== undefined;
                  return (
                    <tr className={selected ? 'is-selected' : ''} key={invoice.id}>
                      <td><input aria-label={`Выбрать счёт ${invoice.number}`} checked={selected} type="checkbox" onChange={() => toggleInvoice(invoice)} /></td>
                      <td><strong>{invoice.number}</strong><small>{formatDate(invoice.periodFrom)} — {formatDate(invoice.periodTo)}</small></td>
                      <td><span className={`billing-cash-receipt__status is-${invoice.status.toLowerCase()}`}>{invoice.status === 'DRAFT' ? 'Черновик' : 'Выставлен'}</span></td>
                      <td>{invoice.dueDate ? formatDate(invoice.dueDate) : 'не указан'}</td>
                      <td>{money(Number(invoice.totalRub))}</td>
                      <td>{money(Number(invoice.paidRub))}</td>
                      <td><strong>{money(remainingRub(invoice))}</strong></td>
                      <td>
                        <input
                          aria-label={`Сумма оплаты счета ${invoice.number}`}
                          disabled={!selected}
                          max={remainingRub(invoice)}
                          min="0.01"
                          step="0.01"
                          type="number"
                          value={allocations[invoice.id] ?? ''}
                          onChange={(event) => setAllocations((current) => ({ ...current, [invoice.id]: event.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
                {payableInvoices.length === 0 ? <tr><td colSpan={8} className="billing-cash-receipt__empty">У клиента нет неоплаченных счетов.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="billing-cash-receipt__prompt"><CircleDollarSign size={24} /><span>Выберите клиента — появятся его неоплаченные счета.</span></div>
      )}

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="billing-cash-receipt__message"><CheckCircle2 size={17} />{message}</p> : null}

      <button className="primary-button billing-cash-receipt__submit" disabled={isSubmitting || !selectedClient || !isBalanced} type="submit">
        <ArrowDownToLine size={17} />
        <span>{isSubmitting ? 'Провожу…' : `Провести приход ${incomingRub > 0 ? money(incomingRub) : ''}`}</span>
      </button>
    </form>
  );
}

function remainingRub(invoice: BillingInvoiceSummary) {
  return roundMoney(Math.max(0, Number(invoice.totalRub) - Number(invoice.paidRub)));
}

function isMergedSourceInvoice(invoice: BillingInvoiceSummary) {
  const comment = invoice.comment?.trim() ?? '';
  return comment.startsWith('Объединено в FBS-счёт') || comment.startsWith('Объединено в счёт');
}

function isInvoiceOverdue(invoice: BillingInvoiceSummary) {
  if (!invoice.dueDate || invoice.status !== 'ISSUED') return false;
  const dueAt = new Date(invoice.dueDate);
  dueAt.setHours(23, 59, 59, 999);
  return dueAt.getTime() < Date.now();
}

function positiveNumber(value: string) {
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
