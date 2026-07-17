import { Send } from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import {
  createClientRequest,
  previewClientRequestAvailability,
  type AuthSession,
  type ClientRequestAvailabilityPreview,
  type ClientRequestPriority,
  type ClientRequestSummary,
  type ClientRequestType,
  type ClientSummary,
} from '../../lib/api';
import { ClientRequestItemsEditor } from './ClientRequestItemsEditor';
import { emptyClientRequestItem, normalizeClientRequestItems, type ClientRequestDraftItem } from './clientRequestItems';
import { requestPriorityOptions, requestTypeOptions } from './clientRequestMeta';

type ClientRequestCreateFormProps = {
  clients: ClientSummary[];
  session: AuthSession;
  onCreated: (request: ClientRequestSummary) => void;
};

export function ClientRequestCreateForm({ clients, session, onCreated }: ClientRequestCreateFormProps) {
  const writableClientIds = useMemo(() => {
    if (session.user.permissionCodes.includes('system:admin') || session.user.clientScopeMode === 'ALL') {
      return new Set(clients.map((client) => client.id));
    }

    return new Set(session.user.writableClientIds);
  }, [clients, session.user]);
  const writableClients = clients.filter((client) => writableClientIds.has(client.id));
  const [clientId, setClientId] = useState(writableClients[0]?.id ?? '');
  const [type, setType] = useState<ClientRequestType>('OUTBOUND');
  const [priority, setPriority] = useState<ClientRequestPriority>('NORMAL');
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [desiredDate, setDesiredDate] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [items, setItems] = useState<ClientRequestDraftItem[]>([emptyClientRequestItem()]);
  const [availability, setAvailability] = useState<ClientRequestAvailabilityPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isCheckingAvailability, setCheckingAvailability] = useState(false);

  const checkAvailability = useCallback(async (nextItems = items) => {
    const requestItems = normalizeClientRequestItems(nextItems);
    if (requestItems.length === 0) {
      setAvailability(null);
      return null;
    }

    setCheckingAvailability(true);
    try {
      const nextAvailability = await previewClientRequestAvailability(session.accessToken, {
        clientId,
        type,
        items: requestItems,
      });
      setAvailability(nextAvailability);
      return nextAvailability;
    } finally {
      setCheckingAvailability(false);
    }
  }, [clientId, items, session.accessToken, type]);

  if (writableClients.length === 0) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const requestItems = normalizeClientRequestItems(items);
      const nextAvailability = await checkAvailability(items);

      if (nextAvailability && !nextAvailability.canCommit) {
        setError('Исправьте красные позиции: удалите строку крестиком или уменьшите количество до доступного остатка.');
        return;
      }

      const request = await createClientRequest(session.accessToken, {
        clientId,
        type,
        priority,
        title,
        comment: comment || undefined,
        contactPhone: contactPhone || undefined,
        destinationCity,
        deliveryAddress: deliveryAddress || undefined,
        desiredDate: desiredDate || undefined,
        items: requestItems.length > 0 ? requestItems : undefined,
      });

      onCreated(request);
      setTitle('');
      setComment('');
      setDesiredDate('');
      setContactPhone('');
      setDestinationCity('');
      setDeliveryAddress('');
      setItems([emptyClientRequestItem()]);
      setAvailability(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать заявку.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="client-request-form" onSubmit={(event) => void submit(event)}>
      <div className="client-request-fields">
        <label>
          <span>Клиент</span>
          <select
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setAvailability(null);
            }}
          >
            {writableClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} · {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Тип</span>
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as ClientRequestType);
              setAvailability(null);
            }}
          >
            {requestTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Приоритет</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as ClientRequestPriority)}>
            {requestPriorityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Желаемая дата</span>
          <input type="date" value={desiredDate} onChange={(event) => setDesiredDate(event.target.value)} />
        </label>

        <label className="client-request-fields__wide">
          <span>Название</span>
          <input required value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          <span>Телефон</span>
          <input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
        </label>

        <label>
          <span>Город поставки</span>
          <input required value={destinationCity} onChange={(event) => setDestinationCity(event.target.value)} />
        </label>

        <label className="client-request-fields__wide">
          <span>Адрес</span>
          <input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} />
        </label>

        <label className="client-request-fields__wide">
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
      </div>

      <ClientRequestItemsEditor
        items={items}
        accessToken={session.accessToken}
        clientId={clientId}
        availability={availability}
        onChange={(nextItems) => {
          setItems(nextItems);
        }}
        onAvailabilityCheck={checkAvailability}
        onError={setError}
      />
      {isCheckingAvailability ? <p className="inline-status">Проверяю остатки.</p> : null}

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button client-request-submit" disabled={isSubmitting} type="submit">
        <Send size={16} aria-hidden="true" />
        <span>{isSubmitting ? 'Создаю' : 'Создать заявку'}</span>
      </button>
    </form>
  );
}
