import { ClipboardPaste, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchTurnoverSuggestions, type ClientRequestAvailabilityPreview, type TurnoverSuggestions } from '../../lib/api';
import {
  emptyClientRequestItem,
  MAX_CLIENT_REQUEST_ITEMS,
  parseClientRequestItemsText,
  type ClientRequestDraftItem,
} from './clientRequestItems';

type ClientRequestItemsEditorProps = {
  items: ClientRequestDraftItem[];
  accessToken: string;
  clientId: string;
  availability?: ClientRequestAvailabilityPreview | null;
  onChange: (items: ClientRequestDraftItem[]) => void;
  onAvailabilityCheck?: (items: ClientRequestDraftItem[]) => void;
  onError: (message: string | null) => void;
};

type StockSuggestion = {
  skuId: string;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  color: string | null;
  size: string | null;
  name: string;
  barcode: string;
  availableQuantity: number;
};

export function ClientRequestItemsEditor({
  items,
  accessToken,
  clientId,
  availability,
  onChange,
  onAvailabilityCheck,
  onError,
}: ClientRequestItemsEditorProps) {
  const [pasteText, setPasteText] = useState('');
  const [activeSuggest, setActiveSuggest] = useState<{ index: number; query: string } | null>(null);
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [isSuggesting, setSuggesting] = useState(false);
  const availabilityByIndex = new Map((availability?.lines ?? []).map((line) => [line.index, line]));

  useEffect(() => {
    const query = activeSuggest?.query.trim() ?? '';
    if (!clientId || !activeSuggest) {
      setSuggestions([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuggesting(true);
      fetchTurnoverSuggestions(accessToken, { clientId, search: query || undefined })
        .then((result) => setSuggestions(buildStockSuggestions(result).slice(0, 8)))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggesting(false));
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [accessToken, activeSuggest, clientId]);

  useEffect(() => {
    if (!clientId || !onAvailabilityCheck) {
      return;
    }

    const hasCheckableItems = items.some((item) => item.skuId.trim() || item.barcode.trim());
    if (!hasCheckableItems) {
      return;
    }

    const timeoutId = window.setTimeout(() => onAvailabilityCheck(items), 350);
    return () => window.clearTimeout(timeoutId);
  }, [clientId, items, onAvailabilityCheck]);

  function updateItem(index: number, field: keyof ClientRequestDraftItem, value: string) {
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? updateDraftItem(item, field, value) : item,
      ),
    );
    if (field === 'barcode' || field === 'name') {
      setActiveSuggest({ index, query: value });
    }
  }

  function selectSku(index: number, sku: StockSuggestion) {
    onError(null);
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              skuId: sku.skuId,
              internalSku: sku.internalSku,
              clientSku: sku.clientSku ?? '',
              article: sku.article ?? '',
              color: sku.color ?? '',
              size: sku.size ?? '',
              barcode: sku.barcode,
              name: sku.name,
            }
          : item,
      ),
    );
    setActiveSuggest(null);
    setSuggestions([]);
  }

  function addItem() {
    if (items.length >= MAX_CLIENT_REQUEST_ITEMS) {
      onError(`В заявке может быть не больше ${MAX_CLIENT_REQUEST_ITEMS} позиций.`);
      return;
    }

    onError(null);
    onChange([...items, emptyClientRequestItem()]);
  }

  function removeItem(index: number) {
    onError(null);
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  function applyPaste() {
    try {
      const parsed = parseClientRequestItemsText(pasteText);
      const nextItems = [...items.filter((item) => item.name || item.barcode || item.comment), ...parsed].slice(
        0,
        MAX_CLIENT_REQUEST_ITEMS,
      );

      onError(null);
      onChange(nextItems.length > 0 ? nextItems : [emptyClientRequestItem()]);
      setPasteText('');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Не удалось разобрать состав заявки.');
    }
  }

  return (
    <section className="client-request-items-editor" aria-label="Состав заявки">
      <div className="client-request-items-editor__heading">
        <div>
          <h3>Состав заявки</h3>
          <p>{items.length} / {MAX_CLIENT_REQUEST_ITEMS} позиций</p>
        </div>
        <button className="secondary-action client-request-small-button" type="button" onClick={addItem}>
          <Plus size={15} aria-hidden="true" />
          <span>Строка</span>
        </button>
      </div>

      <div className="client-request-items-grid" role="table" aria-label="Позиции заявки">
        <div className="client-request-items-grid__header" role="row">
          <span>Штрихкод</span>
          <span>Товар</span>
          <span>Кол-во</span>
          <span>Комментарий</span>
          <span />
        </div>
        {items.map((item, index) => {
          const line = availabilityByIndex.get(index);
          return (
            <div className={`client-request-items-grid__row ${availabilityClassName(line)}`} key={index} role="row">
              <input
                aria-label={`Штрихкод позиции ${index + 1}`}
                value={item.barcode}
                onChange={(event) => updateItem(index, 'barcode', event.target.value)}
                onFocus={(event) => setActiveSuggest({ index, query: event.currentTarget.value })}
              />
              <input
                aria-label={`Товар позиции ${index + 1}`}
                value={item.name}
                onChange={(event) => updateItem(index, 'name', event.target.value)}
                onFocus={(event) => setActiveSuggest({ index, query: event.currentTarget.value })}
              />
              <input
                aria-label={`Количество позиции ${index + 1}`}
                min="1"
                type="number"
                value={item.quantity}
                onChange={(event) => updateItem(index, 'quantity', event.target.value)}
              />
              <input
                aria-label={`Комментарий позиции ${index + 1}`}
                value={item.comment}
                onChange={(event) => updateItem(index, 'comment', event.target.value)}
              />
              <button
                className="icon-button client-request-row-remove"
                disabled={items.length === 1}
                type="button"
                onClick={() => removeItem(index)}
                title="Удалить строку"
                aria-label={`Удалить позицию ${index + 1}`}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
              {activeSuggest?.index === index && suggestions.length > 0 ? (
                <div className="client-request-sku-suggestions">
                  {suggestions.map((sku) => (
                    <button key={sku.skuId} type="button" onClick={() => selectSku(index, sku)}>
                      <strong>{sku.name}</strong>
                      <span>{sku.barcode || 'без штрихкода'}</span>
                      <small>{skuSuggestionDetails(sku)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {item.skuId ? <small className="client-request-selected-sku">{selectedSkuDetails(item)}</small> : null}
              {activeSuggest?.index === index && isSuggesting ? (
                <small className="client-request-sku-suggestions-status">Ищу варианты.</small>
              ) : null}
              {line ? <small className="client-request-item-availability">{availabilityText(line)}</small> : null}
            </div>
          );
        })}
      </div>

      <div className="client-request-paste">
        <label>
          <span>Вставка из Excel/CSV</span>
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="штрихкод;товар;количество;комментарий"
          />
        </label>
        <button
          className="secondary-action client-request-small-button"
          disabled={!pasteText.trim()}
          type="button"
          onClick={applyPaste}
        >
          <ClipboardPaste size={15} aria-hidden="true" />
          <span>Добавить строки</span>
        </button>
      </div>
    </section>
  );
}

function buildStockSuggestions(result: TurnoverSuggestions) {
  const quantitiesBySku = new Map(result.products.map((product) => [product.skuId, product.quantity]));
  const suggestions = [
    ...result.products.map((product) => ({
      skuId: product.skuId,
      internalSku: product.internalSku,
      clientSku: product.clientSku,
      article: product.article,
      color: product.color,
      size: product.size,
      name: product.name,
      barcode: product.barcode ?? '',
      availableQuantity: product.quantity,
    })),
    ...result.barcodes.map((barcode) => ({
      skuId: barcode.skuId,
      internalSku: barcode.internalSku,
      clientSku: barcode.clientSku,
      article: barcode.article,
      color: barcode.color,
      size: barcode.size,
      name: barcode.name,
      barcode: barcode.value,
      availableQuantity: quantitiesBySku.get(barcode.skuId) ?? 0,
    })),
  ];

  return uniqueStockSuggestions(suggestions)
    .sort((left, right) => right.availableQuantity - left.availableQuantity);
}

function uniqueStockSuggestions(suggestions: StockSuggestion[]) {
  const seen = new Set<string>();
  const result: StockSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = `${suggestion.skuId}:${suggestion.barcode}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(suggestion);
  }

  return result;
}

function updateDraftItem(item: ClientRequestDraftItem, field: keyof ClientRequestDraftItem, value: string) {
  if (field === 'barcode' || field === 'name') {
    return {
      ...item,
      [field]: value,
      skuId: '',
      internalSku: '',
      clientSku: '',
      article: '',
      color: '',
      size: '',
    };
  }

  return { ...item, [field]: value };
}

function skuSuggestionDetails(sku: StockSuggestion) {
  return [
    sku.article ? `Арт. ${sku.article}` : null,
    sku.size ? `Размер ${sku.size}` : null,
    sku.color ? `Цвет ${sku.color}` : null,
    sku.clientSku ? `SKU клиента ${sku.clientSku}` : sku.internalSku,
    `${sku.availableQuantity} шт. на остатке`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function selectedSkuDetails(item: ClientRequestDraftItem) {
  return [
    item.name,
    item.barcode ? `ШК ${item.barcode}` : null,
    item.article ? `Арт. ${item.article}` : null,
    item.size ? `Размер ${item.size}` : null,
    item.color ? `Цвет ${item.color}` : null,
    item.clientSku ? `SKU клиента ${item.clientSku}` : item.internalSku || null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function availabilityClassName(line: ClientRequestAvailabilityPreview['lines'][number] | undefined) {
  if (!line) {
    return '';
  }

  if (!line.canFulfill) {
    return 'client-request-items-grid__row--shortage';
  }

  return line.conflicts.length > 0 ? 'client-request-items-grid__row--reserved' : 'client-request-items-grid__row--ok';
}

function availabilityText(line: ClientRequestAvailabilityPreview['lines'][number]) {
  const conflictText = line.conflicts.length
    ? ` Участвует в заявке: ${line.conflicts
        .slice(0, 2)
        .map((conflict) => `${conflict.title} от ${new Date(conflict.createdAt).toLocaleDateString('ru-RU')} (${conflict.type})`)
        .join('; ')}.`
    : '';

  if (!line.skuId) {
    return `Товар не найден в остатках клиента. Удалите строку или укажите другой штрихкод.`;
  }

  if (!line.canFulfill) {
    return `Недостаточно: нужно ${line.requestedQuantity}, доступно ${line.availableQuantity}, занято ${line.reservedQuantity}.${conflictText}`;
  }

  return `Доступно ${line.availableQuantity}, занято ${line.reservedQuantity}.${conflictText}`;
}
