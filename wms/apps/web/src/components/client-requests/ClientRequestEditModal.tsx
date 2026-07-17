import { Save, X } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import {
  previewClientRequestAvailability,
  updateClientRequest,
  type AuthSession,
  type ClientRequestAvailabilityPreview,
  type ClientRequestPriority,
  type ClientRequestSummary,
  type ClientRequestType,
} from '../../lib/api';
import { ClientRequestItemsEditor } from './ClientRequestItemsEditor';
import { emptyClientRequestItem, normalizeClientRequestItems, type ClientRequestDraftItem } from './clientRequestItems';
import { requestPriorityOptions, requestTypeOptions } from './clientRequestMeta';

type ClientRequestEditModalProps = {
  request: ClientRequestSummary;
  session: AuthSession;
  canBypassAvailability: boolean;
  onClose: () => void;
  onSaved: (request: ClientRequestSummary) => void;
};

export function ClientRequestEditModal({
  request,
  session,
  canBypassAvailability,
  onClose,
  onSaved,
}: ClientRequestEditModalProps) {
  const [type, setType] = useState<ClientRequestType>(request.type);
  const [priority, setPriority] = useState<ClientRequestPriority>(request.priority);
  const [title, setTitle] = useState(request.title);
  const [comment, setComment] = useState(request.comment ?? '');
  const [desiredDate, setDesiredDate] = useState(toDateInput(request.desiredDate));
  const [contactName, setContactName] = useState(request.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(request.contactPhone ?? '');
  const [destinationCity, setDestinationCity] = useState(request.destinationCity ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(request.deliveryAddress ?? '');
  const [items, setItems] = useState<ClientRequestDraftItem[]>(() => requestItemsToDraft(request));
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
        clientId: request.clientId,
        type,
        items: requestItems,
        excludeRequestId: request.id,
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

      if (nextAvailability && !nextAvailability.canCommit && !canBypassAvailability) {
        setError('Исправьте красные позиции: удалите строку или уменьшите количество до доступного остатка.');
        return;
      }

      const updated = await updateClientRequest(session.accessToken, request.id, {
        type,
        priority,
        title,
        comment,
        contactName,
        contactPhone,
        destinationCity,
        deliveryAddress,
        desiredDate,
        items: requestItems,
      });

      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить заявку.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="client-request-edit-modal" role="dialog" aria-modal="true" aria-label="Редактирование заявки">
      <form className="client-request-edit-modal__panel" onSubmit={(event) => void submit(event)}>
        <header className="client-request-edit-modal__header">
          <div>
            <span>Редактирование заявки</span>
            <h3>{request.title}</h3>
            <small>{request.client.name} · {request.status}</small>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="client-request-fields">
          <label>
            <span>Клиент</span>
            <input value={request.client.name} disabled />
          </label>
          <label>
            <span>Тип</span>
            <select value={type} onChange={(event) => setType(event.target.value as ClientRequestType)}>
              {requestTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Приоритет</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as ClientRequestPriority)}>
              {requestPriorityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
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
            <span>Контакт</span>
            <input value={contactName} onChange={(event) => setContactName(event.target.value)} />
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
          clientId={request.clientId}
          availability={availability}
          showQuickSearch
          showDatabasePicker
          onChange={setItems}
          onAvailabilityCheck={checkAvailability}
          onError={setError}
        />

        {isCheckingAvailability ? <p className="inline-status">Проверяю остатки.</p> : null}
        {availability && !availability.canCommit && canBypassAvailability ? (
          <p className="form-error">По части строк не хватает доступного остатка. У администратора сохранение разрешено.</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}

        <footer className="client-request-edit-modal__actions">
          <button className="secondary-action" type="button" onClick={onClose}>Отмена</button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            <Save size={16} aria-hidden="true" />
            <span>{isSubmitting ? 'Сохраняю' : 'Сохранить заявку'}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function requestItemsToDraft(request: ClientRequestSummary): ClientRequestDraftItem[] {
  const items = request.items.map((item) => ({
    ...emptyClientRequestItem(),
    skuId: item.skuId ?? item.sku?.id ?? '',
    barcode: item.barcode ?? '',
    name: item.name ?? item.sku?.name ?? '',
    quantity: String(item.quantity || 1),
    comment: item.comment ?? '',
    internalSku: item.sku?.internalSku ?? '',
    clientSku: item.sku?.clientSku ?? '',
    article: item.sku?.article ?? '',
    color: item.sku?.color ?? '',
    size: item.sku?.size ?? '',
  }));

  return items.length > 0 ? items : [emptyClientRequestItem()];
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : '';
}
