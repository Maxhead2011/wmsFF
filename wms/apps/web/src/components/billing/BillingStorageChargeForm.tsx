import { Warehouse } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { generateStorageCharge, type AuthSession, type BillingChargeSummary, type ClientSummary } from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';

type BillingStorageChargeFormProps = {
  clients: ClientSummary[];
  session: AuthSession;
  onCreated: (charge: BillingChargeSummary) => void;
};

export function BillingStorageChargeForm({ clients, session, onCreated }: BillingStorageChargeFormProps) {
  const [clientId, setClientId] = useRememberedClientId(session.user.id, {
    initialClientId: clients[0]?.id ?? '',
  });
  const [periodFrom, setPeriodFrom] = useState(monthStart());
  const [periodTo, setPeriodTo] = useState(today());
  const [unitPriceRub, setUnitPriceRub] = useState('');
  const [approve, setApprove] = useState(false);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) {
      setError('Выберите клиента.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const charge = await generateStorageCharge(session.accessToken, {
        clientId,
        periodFrom,
        periodTo,
        unitPriceRub: unitPriceRub ? Number(unitPriceRub) : undefined,
        approve,
        comment: comment || undefined,
      });
      onCreated(charge);
      setComment('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось начислить хранение.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="billing-form" onSubmit={(event) => void submit(event)}>
      <div className="billing-fields billing-fields--storage">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} - {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Период с</span>
          <input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
        </label>

        <label>
          <span>Период по</span>
          <input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
        </label>

        <label>
          <span>₽ / литро-день</span>
          <input
            min="0"
            step="0.01"
            type="number"
            value={unitPriceRub}
            onChange={(event) => setUnitPriceRub(event.target.value)}
            placeholder="например 0.05"
          />
        </label>

        <label className="billing-checkbox">
          <input checked={approve} type="checkbox" onChange={(event) => setApprove(event.target.checked)} />
          <span>Сразу утвердить</span>
        </label>

        <label className="billing-fields__wide">
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="к начислению хранения" />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button billing-submit" disabled={isSubmitting || clients.length === 0} type="submit">
        <Warehouse size={17} aria-hidden="true" />
        <span>{isSubmitting ? 'Считаю' : 'Начислить хранение'}</span>
      </button>
    </form>
  );
}

function today() {
  return formatDateInput(new Date());
}

function monthStart() {
  const date = new Date();
  date.setDate(1);
  return formatDateInput(date);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
