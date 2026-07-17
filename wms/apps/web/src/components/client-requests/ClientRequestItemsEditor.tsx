import { ClipboardPaste, Database, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
  showQuickSearch?: boolean;
  showDatabasePicker?: boolean;
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
  showQuickSearch = false,
  showDatabasePicker = false,
  onChange,
  onAvailabilityCheck,
  onError,
}: ClientRequestItemsEditorProps) {
  const [pasteText, setPasteText] = useState('');
  const [activeSuggest, setActiveSuggest] = useState<{ index: number; query: string } | null>(null);
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [isSuggesting, setSuggesting] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [isDatabasePickerOpen, setDatabasePickerOpen] = useState(false);
  const [databaseSearch, setDatabaseSearch] = useState('');
  const [databaseSuggestions, setDatabaseSuggestions] = useState<StockSuggestion[]>([]);
  const [databaseQuantities, setDatabaseQuantities] = useState<Record<string, string>>({});
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null);
  const [isDatabaseSuggesting, setDatabaseSuggesting] = useState(false);
  const availabilityByIndex = new Map((availability?.lines ?? []).map((line) => [line.index, line]));
  const visibleItems = useMemo(
    () => items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => matchesItemSearch(item, itemSearch)),
    [itemSearch, items],
  );

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
    if (!clientId || !isDatabasePickerOpen) {
      setDatabaseSuggestions([]);
      return;
    }

    const query = databaseSearch.trim();
    const timeoutId = window.setTimeout(() => {
      setDatabaseSuggesting(true);
      fetchTurnoverSuggestions(accessToken, { clientId, search: query || undefined })
        .then((result) => setDatabaseSuggestions(buildStockSuggestions(result).slice(0, 20)))
        .catch(() => setDatabaseSuggestions([]))
        .finally(() => setDatabaseSuggesting(false));
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [accessToken, clientId, databaseSearch, isDatabasePickerOpen]);

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
        itemIndex === index ? { ...item, [field]: value, skuId: field === 'barcode' || field === 'name' ? '' : item.skuId } : item,
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
              barcode: sku.barcode,
              name: sku.name,
              internalSku: sku.internalSku,
              clientSku: sku.clientSku ?? '',
              article: sku.article ?? '',
              color: sku.color ?? '',
              size: sku.size ?? '',
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

  function addDatabaseItem(sku: StockSuggestion) {
    const key = stockSuggestionKey(sku);
    const quantity = normalizeDatabaseQuantity(databaseQuantities[key]);
    const existingIndex = items.findIndex((item) =>
      (sku.skuId && item.skuId === sku.skuId) || (sku.barcode && item.barcode.trim() === sku.barcode),
    );

    if (existingIndex === -1 && items.length >= MAX_CLIENT_REQUEST_ITEMS) {
      onError(`В заявке может быть не больше ${MAX_CLIENT_REQUEST_ITEMS} позиций.`);
      return;
    }

    const nextItems = existingIndex >= 0
      ? items.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                skuId: sku.skuId,
                barcode: sku.barcode,
                name: sku.name,
                internalSku: sku.internalSku,
                clientSku: sku.clientSku ?? '',
                article: sku.article ?? '',
                color: sku.color ?? '',
                size: sku.size ?? '',
                quantity: String(normalizeDatabaseQuantity(item.quantity) + quantity),
              }
            : item,
        )
      : [
          ...items,
          {
            ...emptyClientRequestItem(),
            skuId: sku.skuId,
            barcode: sku.barcode,
            name: sku.name,
            internalSku: sku.internalSku,
            clientSku: sku.clientSku ?? '',
            article: sku.article ?? '',
            color: sku.color ?? '',
            size: sku.size ?? '',
            quantity: String(quantity),
          },
        ];

    onError(null);
    onChange(nextItems);
    setDatabaseMessage(
      existingIndex >= 0
        ? `Количество увеличено: ${sku.internalSku || sku.barcode || sku.name}.`
        : `Товар добавлен: ${sku.internalSku || sku.barcode || sku.name}.`,
    );
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

      {showDatabasePicker ? (
        <div className="client-request-database-picker">
          <div className="client-request-database-picker__bar">
            <button
              className="secondary-action client-request-small-button"
              type="button"
              onClick={() => {
                setDatabasePickerOpen((current) => !current);
                setDatabaseMessage(null);
              }}
            >
              <Database size={15} aria-hidden="true" />
              <span>Добавить из базы</span>
            </button>
            <span>Поиск берет товары и остатки выбранного клиента.</span>
          </div>

          {isDatabasePickerOpen ? (
            <div className="client-request-database-picker__panel">
              <label className="client-request-database-picker__search">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  value={databaseSearch}
                  onChange={(event) => {
                    setDatabaseSearch(event.target.value);
                    setDatabaseMessage(null);
                  }}
                  placeholder="Начните вводить ШК, название, SKU или артикул"
                  aria-label="Поиск товара в базе клиента"
                />
                {databaseSearch ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDatabaseSearch('');
                      setDatabaseMessage(null);
                    }}
                    title="Очистить поиск"
                    aria-label="Очистить поиск товара"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              {databaseMessage ? <p className="client-request-database-picker__message">{databaseMessage}</p> : null}
              {isDatabaseSuggesting ? <p className="client-request-database-picker__message">Ищу товары в базе клиента.</p> : null}

              <div className="client-request-database-picker__results" role="list">
                {databaseSuggestions.map((sku) => {
                  const key = stockSuggestionKey(sku);
                  const alreadyInRequest = items.some((item) =>
                    (sku.skuId && item.skuId === sku.skuId) || (sku.barcode && item.barcode.trim() === sku.barcode),
                  );

                  return (
                    <div className="client-request-database-picker__result" key={key} role="listitem">
                      <div className="client-request-database-picker__product">
                        <strong>{sku.internalSku || sku.clientSku || sku.barcode || 'Товар без SKU'}</strong>
                        <span>{sku.name}</span>
                        <small>
                          {[
                            sku.barcode ? `ШК ${sku.barcode}` : 'без штрихкода',
                            sku.article,
                            sku.color,
                            sku.size,
                            `остаток ${sku.availableQuantity} шт.`,
                            alreadyInRequest ? 'уже в заявке' : '',
                          ].filter(Boolean).join(' · ')}
                        </small>
                      </div>
                      <input
                        aria-label={`Количество для добавления ${sku.internalSku || sku.name}`}
                        min="1"
                        type="number"
                        value={databaseQuantities[key] ?? '1'}
                        onChange={(event) => setDatabaseQuantities((current) => ({ ...current, [key]: event.target.value }))}
                      />
                      <button
                        className="primary-button client-request-database-picker__add"
                        type="button"
                        onClick={() => addDatabaseItem(sku)}
                      >
                        <Plus size={15} aria-hidden="true" />
                        <span>{alreadyInRequest ? 'Добавить еще' : 'Добавить'}</span>
                      </button>
                    </div>
                  );
                })}
                {!isDatabaseSuggesting && databaseSuggestions.length === 0 ? (
                  <div className="client-request-database-picker__empty" role="status">
                    {databaseSearch.trim() ? 'Товар не найден в базе клиента.' : 'Введите запрос или выберите товар из списка.'}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showQuickSearch ? (
        <div className="client-request-item-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={itemSearch}
            onChange={(event) => setItemSearch(event.target.value)}
            placeholder="ШК, название, SKU или артикул"
            aria-label="Быстрый поиск по составу заявки"
          />
          <span>{itemSearch.trim() ? `Найдено ${visibleItems.length} из ${items.length}` : `Всего ${items.length}`}</span>
          {itemSearch ? (
            <button type="button" onClick={() => setItemSearch('')} title="Очистить поиск" aria-label="Очистить поиск">
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="client-request-items-grid" role="table" aria-label="Позиции заявки">
        <div className="client-request-items-grid__header" role="row">
          <span>Штрихкод</span>
          <span>Товар</span>
          <span>Кол-во</span>
          <span>Комментарий</span>
          <span />
        </div>
        {visibleItems.map(({ item, index }) => {
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
                      <strong>{sku.internalSku}</strong>
                      <span>{sku.name}</span>
                      <small>{[sku.article, sku.barcode || 'без штрихкода', `${sku.availableQuantity} шт.`].filter(Boolean).join(' · ')}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {activeSuggest?.index === index && isSuggesting ? (
                <small className="client-request-sku-suggestions-status">Ищу варианты.</small>
              ) : null}
              {line ? <small className="client-request-item-availability">{availabilityText(line)}</small> : null}
            </div>
          );
        })}
        {visibleItems.length === 0 ? (
          <div className="client-request-items-grid__empty" role="status">
            <strong>Позиции не найдены</strong>
            <span>Измените запрос или очистите поиск.</span>
            <button type="button" onClick={() => setItemSearch('')}>Показать все</button>
          </div>
        ) : null}
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

function matchesItemSearch(item: ClientRequestDraftItem, rawQuery: string) {
  const query = normalizeItemSearch(rawQuery);
  if (!query) {
    return true;
  }

  const values = [
    item.barcode,
    item.name,
    item.internalSku,
    item.clientSku,
    item.article,
    item.color,
    item.size,
  ];
  const searchIndex = normalizeItemSearch(values.filter(Boolean).join(' '));
  const compactQuery = query.replace(/\s+/g, '');

  return searchIndex.includes(query) || searchIndex.replace(/\s+/g, '').includes(compactQuery);
}

function normalizeItemSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function normalizeDatabaseQuantity(value: string | undefined) {
  const quantity = Number(value ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 1;
  }

  return Math.floor(quantity);
}

function stockSuggestionKey(sku: StockSuggestion) {
  return `${sku.skuId}:${sku.barcode || 'no-barcode'}`;
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
