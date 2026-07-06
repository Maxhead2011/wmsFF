import { Save, X } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import {
  previewClientRequestAvailability,
  updateClientRequest,
  type AuthSession,
  type ClientRequestAvailabilityPreview,
  type ClientRequestPriority,
  type ClientRequestStatus,
  type ClientRequestSummary,
  type ClientRequestType,
} from '../../lib/api';
import { ClientRequestItemsEditor } from './ClientRequestItemsEditor';
import { emptyClientRequestItem, normalizeClientRequestItems, type ClientRequestDraftItem } from './clientRequestItems';
import { requestPriorityOptions, requestTypeOptions } from './clientRequestMeta';
import { useLogisticsDestinationOptions } from './useLogisticsDestinationOptions';

type ClientRequestEditFormProps = {
  request: ClientRequestSummary;
  session: AuthSession;
  onCancel: () => void;
  onUpdated: (request: ClientRequestSummary) => void;
};

export function ClientRequestEditForm({ request, session, onCancel, onUpdated }: ClientRequestEditFormProps) {
  const [type, setType] = useState<ClientRequestType>(request.type);
  const [priority, setPriority] = useState<ClientRequestPriority>(request.priority);
  const [title, setTitle] = useState(request.title);
  const [comment, setComment] = useState(request.comment ?? '');
  const [desiredDate, setDesiredDate] = useState(dateInput(request.desiredDate));
  const [contactPhone, setContactPhone] = useState(request.contactPhone ?? '');
  const [destinationCity, setDestinationCity] = useState(request.destinationCity ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(request.deliveryAddress ?? '');
  const [items, setItems] = useState<ClientRequestDraftItem[]>(requestItemsToDraft(request));
  const [availability, setAvailability] = useState<ClientRequestAvailabilityPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isCheckingAvailability, setCheckingAvailability] = useState(false);
  const destinationOptions = useLogisticsDestinationOptions(session.accessToken);

  const checkAvailability = useCallback(async (nextItems = items) => {
    const requestItems = normalizeClientRequestItems(nextItems);
    if (requestItems.length === 0) {
      setAvailability(null);
      return null;
    }

    setCheckingAvailability(true);
    try {
      const nextAvailability = await previewClientRequestAvailability(session.accessToken, {
        clientId: request.clientId,
        type,
        excludeRequestId: request.id,
        items: requestItems,
      });
      setAvailability(nextAvailability);
      return nextAvailability;
    } finally {
      setCheckingAvailability(false);
    }
  }, [items, request.clientId, request.id, session.accessToken, type]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const requestItems = normalizeClientRequestItems(items);
      const nextAvailability = await checkAvailability(items);
      if (nextAvailability && !nextAvailability.canCommit) {
        setError('Исправьте красные позиции: удалите строку или уменьшите количество до доступного остатка.');
        return;
      }

      const updated = await updateClientRequest(session.accessToken, request.id, {
        type,
        priority,
        title,
        comment: comment || undefined,
        contactPhone: contactPhone || undefined,
        destinationCity,
        deliveryAddress: deliveryAddress || undefined,
        desiredDate: desiredDate || undefined,
        items: requestItems,
      });

      onUpdated(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить заявку.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="client-request-form client-request-edit-form" onSubmit={(event) => void submit(event)}>
      <div className="client-request-edit-form__head">
        <div>
          <p className="eyebrow">Редактирование заявки</p>
          <h3>{request.title}</h3>
          <span>{request.client.name}</span>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Закрыть">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="client-request-fields">
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

        <label>
          <span>Город поставки</span>
          <input
            list="client-request-edit-destination-options"
            required
            value={destinationCity}
            onFocus={(event) => destinationOptions.search(event.currentTarget.value)}
            onChange={(event) => {
              setDestinationCity(event.target.value);
              destinationOptions.search(event.target.value);
            }}
          />
          <datalist id="client-request-edit-destination-options">
            {destinationOptions.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.description}
              </option>
            ))}
          </datalist>
        </label>

        <label className="client-request-fields__wide">
          <span>Название</span>
          <input required value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          <span>Телефон</span>
          <input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
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
        clientId={request.clientId}
        availability={availability}
        onChange={setItems}
        onAvailabilityCheck={checkAvailability}
        onError={setError}
      />

      {isCheckingAvailability ? <p className="inline-status">Проверяю остатки.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="client-request-edit-form__actions">
        <button className="secondary-action" type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary-button" disabled={isSubmitting} type="submit">
          <Save size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Сохраняю' : 'Сохранить изменения'}</span>
        </button>
      </div>
    </form>
  );
}

export function canEditClientRequest(request: { status: ClientRequestStatus }) {
  return ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(request.status);
}

function requestItemsToDraft(request: ClientRequestSummary) {
  if (request.items.length === 0) {
    return [emptyClientRequestItem()];
  }

  return request.items.map((item) => ({
    skuId: item.skuId ?? item.sku?.id ?? '',
    internalSku: item.sku?.internalSku ?? '',
    clientSku: item.sku?.clientSku ?? '',
    article: item.sku?.article ?? '',
    color: item.sku?.color ?? '',
    size: item.sku?.size ?? '',
    barcode: item.barcode ?? '',
    name: item.name ?? item.sku?.name ?? '',
    quantity: String(item.quantity),
    comment: item.comment ?? '',
  }));
}

function dateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}
