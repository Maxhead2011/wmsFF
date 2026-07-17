import { Plus, ReceiptText, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createBillingInvoice,
  createManualBillingInvoice,
  fetchClientBillingServices,
  generateStorageCharge,
  updateManualBillingInvoice,
  upsertClientBillingService,
  type AuthSession,
  type BillingInvoiceSummary,
  type BillingPriceTaxMode,
  type BillingUnit,
  type ClientBillingServiceSummary,
  type ClientSummary,
} from '../../lib/api';

type BillingInvoiceFormProps = {
  clients: ClientSummary[];
  session: AuthSession;
  onCreated: (invoice: BillingInvoiceSummary) => void;
  invoice?: BillingInvoiceSummary;
};

type InvoiceRow = {
  key: string;
  invoiceItemId?: string;
  serviceId: string;
  serviceSearch: string;
  description: string;
  unit: BillingUnit;
  quantity: string;
  unitPriceRub: string;
  taxMode: BillingPriceTaxMode;
  serviceDate: string;
  comment: string;
  isStandard: boolean;
};

const standardServiceCodes = ['BOX_60_40_40', 'BOX_ASSEMBLY', 'PALLET', 'PALLET_ASSEMBLY'];

export function BillingInvoiceForm({ clients, session, onCreated, invoice }: BillingInvoiceFormProps) {
  const [clientId, setClientId] = useState(invoice?.clientId ?? clients[0]?.id ?? '');
  const [periodFrom, setPeriodFrom] = useState(invoice ? dateInput(invoice.periodFrom) : monthStart());
  const [periodTo, setPeriodTo] = useState(invoice ? dateInput(invoice.periodTo) : today());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ? dateInput(invoice.dueDate) : '');
  const [comment, setComment] = useState(invoice?.comment ?? '');
  const [isStorageInvoice, setIsStorageInvoice] = useState(false);
  const [isApprovedChargesInvoice, setIsApprovedChargesInvoice] = useState(false);
  const [services, setServices] = useState<ClientBillingServiceSummary[]>([]);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingPrices, setIsSavingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serviceOptions = useMemo(() => services.filter((item) => item.isActive), [services]);
  const invoiceTotal = useMemo(() => rows.reduce((sum, row) => sum + rowTotal(row), 0), [rows]);

  useEffect(() => {
    if (!clientId) {
      setServices([]);
      setRows([]);
      return;
    }

    void loadClientServices(clientId);
  }, [clientId, invoice?.id]);

  async function loadClientServices(nextClientId: string) {
    setIsLoadingServices(true);
    setError(null);

    try {
      const nextServices = await fetchClientBillingServices(session.accessToken, nextClientId);
      setServices(nextServices);
      setRows(invoice ? buildInvoiceRows(invoice, nextServices) : buildInitialRows(nextServices, periodTo));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsLoadingServices(false);
    }
  }

  async function saveClientPrices() {
    if (!clientId) {
      setError('Выберите клиента.');
      return;
    }

    setIsSavingPrices(true);
    setError(null);

    try {
      const pricedRows = rows.filter((row) => row.serviceId);
      await Promise.all(
        pricedRows.map((row) =>
          upsertClientBillingService(session.accessToken, clientId, {
            serviceId: row.serviceId,
            priceRub: numberFromInput(row.unitPriceRub),
            taxMode: row.taxMode,
            isActive: true,
            comment: row.comment || undefined,
          }),
        ),
      );
      await loadClientServices(clientId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingPrices(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) {
      setError('Выберите клиента.');
      return;
    }

    if (isApprovedChargesInvoice) {
      setIsSubmitting(true);
      setError(null);

      try {
        const invoice = await createBillingInvoice(session.accessToken, {
          clientId,
          periodFrom,
          periodTo,
          dueDate: dueDate || undefined,
          comment: comment || undefined,
        });
        onCreated(invoice);
        setComment('');
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isStorageInvoice) {
      setIsSubmitting(true);
      setError(null);

      try {
        const charge = await generateStorageCharge(session.accessToken, {
          clientId,
          periodFrom,
          periodTo,
          approve: true,
          comment: comment || undefined,
        });
        const invoice = await createBillingInvoice(session.accessToken, {
          clientId,
          periodFrom,
          periodTo,
          dueDate: dueDate || undefined,
          chargeIds: [charge.id],
          comment: comment || undefined,
        });
        onCreated(invoice);
        setComment('');
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const invoiceRows = rows
      .filter((row) => numberFromInput(row.quantity) > 0)
      .map((row) => ({
        invoiceItemId: row.invoiceItemId,
        serviceId: row.serviceId || undefined,
        description: row.description || undefined,
        unit: row.unit,
        quantity: numberFromInput(row.quantity),
        unitPriceRub: numberFromInput(row.unitPriceRub),
        taxMode: row.taxMode,
        serviceDate: row.serviceDate || undefined,
        comment: row.comment || undefined,
      }));

    if (invoiceRows.length === 0) {
      setError('Заполните хотя бы одну строку счета с количеством больше нуля.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const savedInvoice = await (invoice
        ? updateManualBillingInvoice(session.accessToken, invoice.id, {
            clientId,
            periodFrom,
            periodTo,
            dueDate: dueDate || undefined,
            rows: invoiceRows,
            comment: comment || undefined,
          })
        : createManualBillingInvoice(session.accessToken, {
            clientId,
            periodFrom,
            periodTo,
            dueDate: dueDate || undefined,
            rows: invoiceRows,
            comment: comment || undefined,
          }));
      onCreated(savedInvoice);
      if (!invoice) {
        setComment('');
        setRows((current) => current.map((row) => ({ ...row, quantity: '0' })));
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateRow(key: string, patch: Partial<InvoiceRow>) {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) {
          return row;
        }

        const next = { ...row, ...patch };
        if (patch.serviceId !== undefined) {
          const selected = services.find((item) => item.service.id === patch.serviceId);
          if (selected) {
            next.serviceSearch = serviceLabel(selected);
            next.description = selected.service.name;
            next.unit = selected.service.unit;
            next.unitPriceRub = String(numberFromInput(selected.priceRub));
            next.taxMode = selected.taxMode;
          }
        }

        return next;
      }),
    );
  }

  function updateServiceSearch(key: string, value: string) {
    const selected = serviceOptions.find(
      (item) => normalizedServiceLabel(item) === normalizeSearch(value) || normalizeSearch(item.service.code) === normalizeSearch(value),
    );
    if (selected) {
      selectService(key, selected);
      return;
    }

    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              serviceId: '',
              serviceSearch: value,
              description: value,
            }
          : row,
      ),
    );
  }

  function selectService(key: string, item: ClientBillingServiceSummary) {
    updateRow(key, {
      serviceId: item.service.id,
      serviceSearch: serviceLabel(item),
      description: item.service.name,
      unit: item.service.unit,
      unitPriceRub: String(numberFromInput(item.priceRub)),
      taxMode: item.taxMode,
    });
  }

  function addRow() {
    setRows((current) => [...current, emptyRow(periodTo)]);
  }

  function deleteRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <form className="billing-form" onSubmit={(event) => void submit(event)}>
      <div className="billing-fields billing-fields--invoice">
        <label>
          <span>Клиент</span>
          <select disabled={Boolean(invoice)} value={clientId} onChange={(event) => setClientId(event.target.value)}>
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
          <span>Оплатить до</span>
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>

        <label className="billing-fields__wide">
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="для счета" />
        </label>
      </div>

      {!invoice ? <label className="billing-checkbox">
        <input
          checked={isApprovedChargesInvoice}
          type="checkbox"
          onChange={(event) => {
            setIsApprovedChargesInvoice(event.target.checked);
            if (event.target.checked) {
              setIsStorageInvoice(false);
            }
          }}
        />
        <span>Все утвержденные начисления за выбранный период</span>
      </label> : null}

      {!invoice ? <label className="billing-checkbox">
        <input
          checked={isStorageInvoice}
          type="checkbox"
          onChange={(event) => {
            setIsStorageInvoice(event.target.checked);
            if (event.target.checked) {
              setIsApprovedChargesInvoice(false);
            }
          }}
        />
        <span>Хранение за выбранный период</span>
      </label> : null}

      {!isStorageInvoice && !isApprovedChargesInvoice ? (
        <>
          <div className="billing-invoice-toolbar">
            <button className="secondary-button" type="button" onClick={addRow}>
              <Plus size={16} aria-hidden="true" />
              <span>Добавить строку</span>
            </button>
            <button className="secondary-button" disabled={isSavingPrices || rows.length === 0} type="button" onClick={() => void saveClientPrices()}>
              <Save size={16} aria-hidden="true" />
              <span>{isSavingPrices ? 'Сохраняю' : 'Сохранить цены клиента'}</span>
            </button>
            <strong>Итого: {formatMoney(invoiceTotal)} ₽</strong>
          </div>

          <div className="billing-table-wrap">
            <table className="data-table billing-table billing-table--invoice-form">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th>Описание</th>
                  <th>Ед.</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Налог</th>
                  <th>Сумма</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div className="billing-service-combobox">
                        <input
                          autoComplete="off"
                          list={`billing-services-${row.key}`}
                          value={row.serviceSearch}
                          onChange={(event) => updateServiceSearch(row.key, event.target.value)}
                          placeholder="Начните вводить услугу"
                        />
                        <datalist id={`billing-services-${row.key}`}>
                          {filteredServiceOptions(serviceOptions, row.serviceSearch).map((item) => (
                            <option key={item.service.id} label={item.service.code} value={item.service.name} />
                          ))}
                        </datalist>
                      </div>
                    </td>
                    <td>
                      <input value={row.description} onChange={(event) => updateRow(row.key, { description: event.target.value })} />
                    </td>
                    <td>
                      <select value={row.unit} onChange={(event) => updateRow(row.key, { unit: event.target.value as BillingUnit })}>
                        {unitOptions.map((unit) => (
                          <option key={unit} value={unit}>
                            {unitLabel(unit)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input min="0" step="0.001" type="number" value={row.quantity} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} />
                    </td>
                    <td>
                      <input min="0" step="0.01" type="number" value={row.unitPriceRub} onChange={(event) => updateRow(row.key, { unitPriceRub: event.target.value })} />
                    </td>
                    <td>
                      <select value={row.taxMode} onChange={(event) => updateRow(row.key, { taxMode: event.target.value as BillingPriceTaxMode })}>
                        <option value="INCLUDED">В цене</option>
                        <option value="ADD_6_PERCENT">Добавить 6%</option>
                      </select>
                    </td>
                    <td>{formatMoney(rowTotal(row))} ₽</td>
                    <td>
                      <button className="icon-button" type="button" onClick={() => deleteRow(row.key)} title="Удалить строку" aria-label="Удалить строку">
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {isLoadingServices ? (
                  <tr>
                    <td colSpan={8}>Загружаю услуги клиента.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="panel-message">
          {isApprovedChargesInvoice
            ? 'Счет будет заполнен всеми утвержденными начислениями клиента за выбранный период, которые еще не вошли в другие счета.'
            : 'Счет будет заполнен начислением хранения за выбранный период.'}
        </p>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button billing-submit" disabled={isSubmitting || clients.length === 0} type="submit">
        <ReceiptText size={17} aria-hidden="true" />
        <span>{isSubmitting ? 'Сохраняю' : invoice ? 'Сохранить изменения' : 'Сформировать счет'}</span>
      </button>
    </form>
  );
}

const unitOptions: BillingUnit[] = ['SERVICE', 'PIECE', 'BOX', 'PALLET', 'LITER', 'LITER_DAY', 'DAY', 'HOUR'];

function buildInitialRows(services: ClientBillingServiceSummary[], serviceDate: string): InvoiceRow[] {
  const standardRows = standardServiceCodes
    .map((code) => services.find((item) => item.service.code === code))
    .filter((item): item is ClientBillingServiceSummary => Boolean(item))
    .map((item) => rowFromService(item, serviceDate, true));

  return standardRows.length ? standardRows : [emptyRow(serviceDate)];
}

function buildInvoiceRows(invoice: BillingInvoiceSummary, services: ClientBillingServiceSummary[]): InvoiceRow[] {
  return invoice.items.map((item) => {
    const service = services.find((candidate) => candidate.service.id === item.charge?.serviceId);
    return {
      key: item.id,
      invoiceItemId: item.id,
      serviceId: service?.service.id ?? item.charge?.serviceId ?? '',
      serviceSearch: service?.service.name ?? item.description,
      description: item.description,
      unit: item.unit,
      quantity: String(item.quantity),
      unitPriceRub: String(item.unitPriceRub),
      taxMode: 'INCLUDED',
      serviceDate: dateInput(item.serviceDate),
      comment: '',
      isStandard: Boolean(service && standardServiceCodes.includes(service.service.code)),
    };
  });
}

function rowFromService(item: ClientBillingServiceSummary, serviceDate: string, isStandard: boolean): InvoiceRow {
  return {
    key: `${item.service.id}-${Date.now()}-${Math.random()}`,
    serviceId: item.service.id,
    serviceSearch: serviceLabel(item),
    description: item.service.name,
    unit: item.service.unit,
    quantity: '0',
    unitPriceRub: String(numberFromInput(item.priceRub)),
    taxMode: item.taxMode,
    serviceDate,
    comment: '',
    isStandard,
  };
}

function emptyRow(serviceDate: string): InvoiceRow {
  return {
    key: `manual-${Date.now()}-${Math.random()}`,
    serviceId: '',
    serviceSearch: '',
    description: '',
    unit: 'SERVICE',
    quantity: '0',
    unitPriceRub: '0',
    taxMode: 'INCLUDED',
    serviceDate,
    comment: '',
    isStandard: false,
  };
}

function rowTotal(row: InvoiceRow) {
  const unitPrice = applyTaxMode(numberFromInput(row.unitPriceRub), row.taxMode);
  return roundMoney(numberFromInput(row.quantity) * unitPrice);
}

function applyTaxMode(value: number, taxMode: BillingPriceTaxMode) {
  return taxMode === 'ADD_6_PERCENT' ? roundMoney((value / 94) * 100) : value;
}

function numberFromInput(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function filteredServiceOptions(options: ClientBillingServiceSummary[], query: string) {
  const normalized = normalizeSearch(query);
  const filtered = normalized
    ? options.filter(
        (item) =>
          normalizeSearch(item.service.name).startsWith(normalized) ||
          normalizeSearch(item.service.code).startsWith(normalized),
      )
    : options;

  return filtered.slice(0, 8);
}

function serviceLabel(item: ClientBillingServiceSummary) {
  return item.service.name;
}

function normalizedServiceLabel(item: ClientBillingServiceSummary) {
  return normalizeSearch(serviceLabel(item));
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU');
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

function dateInput(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}

function unitLabel(unit: BillingUnit) {
  const labels: Record<BillingUnit, string> = {
    SERVICE: 'услуга',
    PIECE: 'шт',
    BOX: 'короб',
    PALLET: 'паллет',
    LITER: 'литр',
    LITER_DAY: 'литро-день',
    DAY: 'день',
    HOUR: 'час',
  };

  return labels[unit];
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
