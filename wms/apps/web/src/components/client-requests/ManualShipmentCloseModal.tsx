import { Truck, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { type ClientRequestSummary } from '../../lib/api';

type ManualShipmentCloseModalProps = {
  request: ClientRequestSummary;
  isSubmitting: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: ManualShipmentClosePayload) => void;
};

export type ManualShipmentClosePayload = {
  boxes: number;
  pallets: number;
  packedUnits: number;
  managerComment: string;
  packages: Array<{
    packageCode: string;
    packageType: string;
    comment?: string;
    items: Array<{
      requestItemId: string;
      quantity: number;
    }>;
  }>;
};

export function ManualShipmentCloseModal({
  request,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: ManualShipmentCloseModalProps) {
  const totalUnits = useMemo(() => request.items.reduce((sum, item) => sum + item.quantity, 0), [request.items]);
  const [boxes, setBoxes] = useState(Math.max(1, request.packages.filter((pack) => !isPalletPackage(pack.packageType)).length || Math.ceil(totalUnits / 15)));
  const [pallets, setPallets] = useState(request.packages.filter((pack) => isPalletPackage(pack.packageType)).length);
  const [comment, setComment] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const placesCount = boxes + pallets;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (placesCount <= 0) {
      setLocalError('Укажите хотя бы один короб или одну паллету.');
      return;
    }

    if (placesCount > totalUnits) {
      setLocalError('Упаковочных мест не может быть больше, чем единиц товара в заявке.');
      return;
    }

    const managerComment =
      comment.trim() || `Ручное закрытие отгрузки: ${boxes} кор., ${pallets} пал., ${totalUnits} ед.`;

    onSubmit({
      boxes,
      pallets,
      packedUnits: totalUnits,
      managerComment,
      packages: buildPackages(request, boxes, pallets, managerComment),
    });
  }

  return (
    <div className="client-request-edit-modal" role="dialog" aria-modal="true" aria-label="Закрыть отгрузку вручную">
      <div className="client-request-edit-modal__content client-request-manual-close">
        <form onSubmit={(event) => void submit(event)}>
          <div className="client-request-edit-form__head">
            <div>
              <p className="eyebrow">Ручное закрытие отгрузки</p>
              <h3>{request.title}</h3>
              <span>{request.client.name}</span>
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="client-request-manual-close__summary">
            <span>Товаров в заявке</span>
            <strong>{totalUnits}</strong>
            <span>Упаковочных мест</span>
            <strong>{placesCount}</strong>
          </div>

          <div className="client-request-fields client-request-manual-close__fields">
            <label>
              <span>Коробов</span>
              <input
                min="0"
                type="number"
                value={boxes}
                onChange={(event) => setBoxes(normalizeCount(event.target.value))}
              />
            </label>
            <label>
              <span>Паллет</span>
              <input
                min="0"
                type="number"
                value={pallets}
                onChange={(event) => setPallets(normalizeCount(event.target.value))}
              />
            </label>
            <label>
              <span>Упаковано единиц</span>
              <input readOnly value={totalUnits} />
            </label>
            <label className="client-request-fields__wide">
              <span>Комментарий</span>
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Например: ручное закрытие после сборки без ТСД"
              />
            </label>
          </div>

          <p className="inline-status">
            WMS сама распределит строки заявки по указанным местам и спишет остатки после подтверждения.
          </p>
          {localError || error ? <p className="form-error">{localError || error}</p> : null}

          <div className="client-request-edit-form__actions">
            <button className="secondary-action" type="button" onClick={onClose}>
              Отмена
            </button>
            <button className="primary-button" disabled={isSubmitting} type="submit">
              <Truck size={16} aria-hidden="true" />
              <span>{isSubmitting ? 'Закрываю' : 'Закрыть отгрузку'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function buildPackages(request: ClientRequestSummary, boxes: number, pallets: number, comment: string) {
  const places = [
    ...Array.from({ length: boxes }, () => 'BOX'),
    ...Array.from({ length: pallets }, () => 'PALLET'),
  ];
  const remainingItems = request.items.map((item) => ({
    requestItemId: item.id,
    remaining: item.quantity,
  }));
  let itemIndex = 0;
  let remainingUnits = remainingItems.reduce((sum, item) => sum + item.remaining, 0);

  return places.map((packageType, index) => {
    const remainingPlaces = places.length - index;
    let targetQuantity = Math.ceil(remainingUnits / remainingPlaces);
    const items: Array<{ requestItemId: string; quantity: number }> = [];

    while (targetQuantity > 0 && itemIndex < remainingItems.length) {
      const item = remainingItems[itemIndex];
      const quantity = Math.min(item.remaining, targetQuantity);
      items.push({ requestItemId: item.requestItemId, quantity });
      item.remaining -= quantity;
      targetQuantity -= quantity;
      remainingUnits -= quantity;

      if (item.remaining === 0) {
        itemIndex += 1;
      }
    }

    return {
      packageCode: `${packageType}-${request.id.slice(0, 8)}-${String(index + 1).padStart(2, '0')}`,
      packageType,
      comment,
      items,
    };
  });
}

function normalizeCount(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}
