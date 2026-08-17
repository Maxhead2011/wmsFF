import { ReceiptText } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createBillingCharge,
  type AuthSession,
  type BillingChargeSummary,
  type BillingServiceSummary,
  type BillingUnit,
  type ClientRequestSummary,
  type ClientSummary,
} from '../../lib/api';
import { billingUnitOptions } from './billingMeta';
import { useRememberedClientId } from '../../lib/rememberedClient';

type BillingChargeFormProps = {
  clients: ClientSummary[];
  requests: ClientRequestSummary[];
  services: BillingServiceSummary[];
  session: AuthSession;
  onCreated: (charge: BillingChargeSummary) => void;
};

export function BillingChargeForm({ clients, requests, services, session, onCreated }: BillingChargeFormProps) {
  const writableClientIds = useMemo(() => {
    if (session.user.permissionCodes.includes('system:admin') || session.user.clientScopeMode === 'ALL') {
      return new Set(clients.map((client) => client.id));
    }

    return new Set(session.user.writableClientIds);
  }, [clients, session.user]);
  const writableClients = clients.filter((client) => writableClientIds.has(client.id));
  const [clientId, setClientId] = useRememberedClientId(session.user.id, {
    initialClientId: writableClients[0]?.id ?? '',
  });
  const [serviceId, setServiceId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<BillingUnit>('SERVICE');
  const [quantity, setQuantity] = useState('1');
  const [unitPriceRub, setUnitPriceRub] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const selectedService = services.find((service) => service.id === serviceId);
  const clientRequests = requests.filter((request) => request.clientId === clientId);

  useEffect(() => {
    if (!selectedService) {
      return;
    }

    setUnit(selectedService.unit);
    setDescription((current) => current || selectedService.name);
    setUnitPriceRub((current) => current || priceInput(selectedService.defaultPriceRub));
  }, [selectedService?.id]);

  if (writableClients.length === 0) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const charge = await createBillingCharge(session.accessToken, {
        clientId,
        serviceId: serviceId || undefined,
        requestId: requestId || undefined,
        description: description || undefined,
        unit,
        quantity: Number(quantity),
        unitPriceRub: unitPriceRub ? Number(unitPriceRub) : undefined,
        serviceDate: serviceDate || undefined,
        comment: comment || undefined,
      });
      onCreated(charge);
      setDescription('');
      setRequestId('');
      setQuantity('1');
      setComment('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать начисление.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="billing-form" onSubmit={(event) => void submit(event)}>
      <div className="billing-fields billing-fields--charge">
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            {writableClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} · {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Услуга</span>
          <select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            <option value="">Ручное начисление</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.code} · {service.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Заявка</span>
          <select value={requestId} onChange={(event) => setRequestId(event.target.value)}>
            <option value="">Без заявки</option>
            {clientRequests.map((request) => (
              <option key={request.id} value={request.id}>
                {request.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Дата услуги</span>
          <input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
        </label>

        <label className="billing-fields__wide">
          <span>Описание</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>

        <label>
          <span>Единица</span>
          <select value={unit} onChange={(event) => setUnit(event.target.value as BillingUnit)}>
            {billingUnitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Количество</span>
          <input
            min="0.001"
            step="0.001"
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        <label>
          <span>Цена, ₽</span>
          <input
            min="0"
            step="0.01"
            type="number"
            value={unitPriceRub}
            onChange={(event) => setUnitPriceRub(event.target.value)}
          />
        </label>

        <label className="billing-fields__wide">
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button billing-submit" disabled={isSubmitting} type="submit">
        <ReceiptText size={16} aria-hidden="true" />
        <span>{isSubmitting ? 'Создаю' : 'Создать начисление'}</span>
      </button>
    </form>
  );
}

function priceInput(value: string | number | null) {
  return value == null ? '' : String(value);
}
