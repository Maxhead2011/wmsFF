import { Ban, HandCoins, Landmark, PlusCircle } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  cancelBillingAdvance,
  createBillingAdvance,
  type BillingAdvancesOverview,
  type ClientSummary,
} from '../../lib/api';
import { formatCabinetDate, formatCabinetMoney } from './clientCabinetFormat';

type ClientCabinetAdvanceWidgetProps = {
  accessToken: string;
  client: ClientSummary;
  overview: BillingAdvancesOverview;
  canManage: boolean;
  onChanged: () => Promise<void>;
};

type AdvanceForm = {
  amountRub: string;
  paidAt: string;
  method: string;
  reference: string;
  comment: string;
};

function emptyForm(): AdvanceForm {
  return {
    amountRub: '',
    paidAt: new Date().toISOString().slice(0, 10),
    method: 'Банковский перевод',
    reference: '',
    comment: '',
  };
}

export function ClientCabinetAdvanceWidget({
  accessToken,
  client,
  overview,
  canManage,
  onChanged,
}: ClientCabinetAdvanceWidgetProps) {
  const [form, setForm] = useState<AdvanceForm>(emptyForm);
  const [isSubmitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const summary = overview.clients.find((item) => item.client.id === client.id);
  const entries = useMemo(
    () => overview.entries.filter((entry) => entry.clientId === client.id).slice(0, 20),
    [client.id, overview.entries],
  );
  const balanceRub = Number(summary?.balanceRub ?? 0);

  async function submitAdvance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountRub = Number(form.amountRub.replace(',', '.'));
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      setError('Укажите сумму аванса больше нуля.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    setError('');
    try {
      await createBillingAdvance(accessToken, {
        clientId: client.id,
        amountRub,
        paidAt: form.paidAt || undefined,
        method: form.method.trim() || undefined,
        reference: form.reference.trim() || undefined,
        comment: form.comment.trim() || undefined,
      });
      setForm(emptyForm());
      setMessage(`Аванс ${formatCabinetMoney(amountRub)} ₽ зачислен.`);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось зачислить аванс.');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelAdvance(id: string) {
    setCancellingId(id);
    setMessage('');
    setError('');
    try {
      await cancelBillingAdvance(accessToken, id);
      setMessage('Ошибочная запись аванса отменена.');
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отменить аванс.');
    } finally {
      setCancellingId('');
    }
  }

  return (
    <section className="client-advance-widget" id="client-cabinet-advance" aria-label="Авансирование клиента">
      <header className="client-advance-widget__heading">
        <div>
          <span><HandCoins size={20} aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">Финансы клиента</p>
            <h3>Авансирование</h3>
            <small>Поступления без счёта уменьшают общий долг клиента.</small>
          </div>
        </div>
        <div className="client-advance-widget__balance">
          <span>Текущий аванс</span>
          <strong>{formatCabinetMoney(balanceRub)} ₽</strong>
        </div>
      </header>

      {canManage ? (
        <form className="client-advance-form" onSubmit={submitAdvance}>
          <label>
            <span>Сумма, ₽</span>
            <input
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={form.amountRub}
              onChange={(event) => setForm((current) => ({ ...current, amountRub: event.target.value }))}
              placeholder="0,00"
              required
            />
          </label>
          <label>
            <span>Дата поступления</span>
            <input
              type="date"
              value={form.paidAt}
              onChange={(event) => setForm((current) => ({ ...current, paidAt: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Способ</span>
            <input
              value={form.method}
              onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
              placeholder="Банковский перевод"
            />
          </label>
          <label>
            <span>Номер платежа</span>
            <input
              value={form.reference}
              onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
              placeholder="Необязательно"
            />
          </label>
          <label className="client-advance-form__comment">
            <span>Комментарий</span>
            <input
              value={form.comment}
              onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
              placeholder="Назначение платежа или примечание"
            />
          </label>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            <PlusCircle size={16} aria-hidden="true" />
            {isSubmitting ? 'Зачисляю' : 'Зачислить аванс'}
          </button>
        </form>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="client-advance-history">
        <div className="client-advance-history__title">
          <Landmark size={17} aria-hidden="true" />
          <strong>История поступлений</strong>
          <span>{entries.length}</span>
        </div>
        {entries.length === 0 ? (
          <p className="panel-message">Авансовых поступлений пока нет.</p>
        ) : (
          <div className="client-advance-history__list">
            {entries.map((entry) => (
              <article className={entry.status === 'CANCELLED' ? 'is-cancelled' : undefined} key={entry.id}>
                <div>
                  <strong>{formatCabinetMoney(Number(entry.amountRub))} ₽</strong>
                  <span>{formatCabinetDate(entry.paidAt)} · {entry.method || 'Способ не указан'}</span>
                  {entry.reference ? <small>Платёж: {entry.reference}</small> : null}
                  {entry.comment ? <small>{entry.comment}</small> : null}
                </div>
                <div>
                  <span className={`status status--${entry.status === 'RECORDED' ? 'done' : 'cancelled'}`}>
                    {entry.status === 'RECORDED' ? 'Зачислен' : 'Отменён'}
                  </span>
                  {canManage && entry.status === 'RECORDED' ? (
                    <button
                      className="icon-text-button client-advance-cancel"
                      type="button"
                      disabled={cancellingId === entry.id}
                      onClick={() => void cancelAdvance(entry.id)}
                    >
                      <Ban size={14} aria-hidden="true" />
                      {cancellingId === entry.id ? 'Отменяю' : 'Отменить запись'}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
