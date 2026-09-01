import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  RefreshCw,
  ShieldCheck,
  Truck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fetchClients,
  fetchLogisticsTariffSets,
  fetchRoles,
  fetchStockBalances,
  downloadTsdReceiptReviewBoxesXlsx,
  fetchTsdReceiptReviewDashboard,
  fetchTsdReviewQueue,
  resolveTsdReviewOperation,
  type AuthSession,
  type AuthUser,
  type ClientSummary,
  type LogisticsTariffSetSummary,
  type ResolveTsdReviewPayload,
  type RoleSummary,
  type StockBalance,
  type TsdReviewOperation,
  type TsdReviewReason,
  type TsdReceiptReviewDashboard,
} from '../lib/api';
import { stockStatusLabel } from './client-cabinet/clientCabinetFormat';
import { TsdReceiptReviewPanel } from './tsd/TsdReceiptReviewPanel';
import { TsdOperationHistoryPanel } from './tsd/TsdOperationHistoryPanel';

const dataTabs = [
  { id: 'clients', label: 'Клиенты', permission: 'clients:read', icon: UsersRound },
  { id: 'stock', label: 'Остатки', permission: 'stock:read', icon: Database },
  { id: 'tsdReview', label: 'Разбор ТСД', permission: 'stock:write', icon: AlertTriangle },
  { id: 'tsdHistory', label: 'История ТСД', permission: 'stock:write', icon: ClipboardCheck },
  { id: 'roles', label: 'Роли', permission: 'users:read', icon: ShieldCheck },
  { id: 'tariffs', label: 'Логистика', permission: 'logistics:read', icon: Truck },
] as const;

type DataTab = (typeof dataTabs)[number]['id'];

const tsdReviewReasonOptions: TsdReviewReason[] = [
  'INVENTORY_MISMATCH',
  'SKU_NOT_FOUND',
  'BOX_NOT_FOUND',
  'RECEIPT_FAILED',
  'DEVICE_MISMATCH',
  'VALIDATION_ERROR',
  'MANUAL_REJECT',
  'OTHER',
];

type LoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error?: string;
};

type DashboardLoadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error?: string;
};

type DashboardDataPanelProps = {
  session: AuthSession;
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function DashboardDataPanel({ session }: DashboardDataPanelProps) {
  const [activeTab, setActiveTab] = useState<DataTab>('clients');
  const [clients, setClients] = useState<LoadState<ClientSummary>>({ status: 'idle', data: [] });
  const [stock, setStock] = useState<LoadState<StockBalance>>({ status: 'idle', data: [] });
  const [tsdReview, setTsdReview] = useState<LoadState<TsdReviewOperation>>({ status: 'idle', data: [] });
  const [tsdReceiptReview, setTsdReceiptReview] = useState<DashboardLoadState<TsdReceiptReviewDashboard>>({
    status: 'idle',
    data: null,
  });
  const [roles, setRoles] = useState<LoadState<RoleSummary>>({ status: 'idle', data: [] });
  const [tariffs, setTariffs] = useState<LoadState<LogisticsTariffSetSummary>>({ status: 'idle', data: [] });
  const [rejectReasons, setRejectReasons] = useState<Record<string, TsdReviewReason>>({});

  const availableTabs = useMemo(
    () => dataTabs.filter((tab) => canUse(session.user, tab.permission)),
    [session.user],
  );
  const activeTabMeta = availableTabs.find((tab) => tab.id === activeTab);

  useEffect(() => {
    if (availableTabs.length > 0 && !activeTabMeta) {
      setActiveTab(availableTabs[0].id);
    }
  }, [activeTabMeta, availableTabs]);

  useEffect(() => {
    if (activeTabMeta) {
      void loadTab(activeTabMeta.id);
    }
  }, [activeTabMeta?.id]);

  async function loadTab(tab: DataTab, force = false) {
    if (tab === 'clients') {
      if (!force && clients.status !== 'idle') {
        return;
      }

      setClients((current) => ({ ...current, status: 'loading', error: undefined }));
      try {
        setClients({ status: 'ready', data: await fetchClients(session.accessToken) });
      } catch (caught) {
        setClients((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      }
    }

    if (tab === 'stock') {
      if (!force && stock.status !== 'idle') {
        return;
      }

      setStock((current) => ({ ...current, status: 'loading', error: undefined }));
      try {
        setStock({ status: 'ready', data: await fetchStockBalances(session.accessToken) });
      } catch (caught) {
        setStock((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      }
    }

    if (tab === 'tsdReview') {
      if (!force && tsdReview.status !== 'idle' && tsdReceiptReview.status !== 'idle') {
        return;
      }

      setTsdReview((current) => ({ ...current, status: 'loading', error: undefined }));
      setTsdReceiptReview((current) => ({ ...current, status: 'loading', error: undefined }));
      try {
        const [queue, receiptDashboard] = await Promise.all([
          fetchTsdReviewQueue(session.accessToken),
          fetchTsdReceiptReviewDashboard(session.accessToken),
        ]);
        setTsdReview({ status: 'ready', data: queue });
        setTsdReceiptReview({ status: 'ready', data: receiptDashboard });
      } catch (caught) {
        setTsdReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
        setTsdReceiptReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      }
    }

    if (tab === 'tsdHistory') {
      return;
    }

    if (tab === 'roles') {
      if (!force && roles.status !== 'idle') {
        return;
      }

      setRoles((current) => ({ ...current, status: 'loading', error: undefined }));
      try {
        setRoles({ status: 'ready', data: await fetchRoles(session.accessToken) });
      } catch (caught) {
        setRoles((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      }
    }

    if (tab === 'tariffs') {
      if (!force && tariffs.status !== 'idle') {
        return;
      }

      setTariffs((current) => ({ ...current, status: 'loading', error: undefined }));
      try {
        setTariffs({ status: 'ready', data: await fetchLogisticsTariffSets(session.accessToken) });
      } catch (caught) {
        setTariffs((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      }
    }
  }

  async function resolveReview(
    operation: TsdReviewOperation,
    action: ResolveTsdReviewPayload['action'],
    reason?: TsdReviewReason,
  ) {
    setTsdReview((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      await resolveTsdReviewOperation(session.accessToken, operation.id, {
        action,
        comment:
          action === 'ACCEPT_RECEIPT_WITH_ERROR'
            ? 'Фактическое наличие товара в коробе подтверждено администратором.'
            : action === 'APPLY_INVENTORY_ADJUSTMENT'
            ? 'Подтверждено оператором WMS.'
            : 'Отклонено оператором WMS.',
        reason: action === 'REJECT' ? reason ?? defaultRejectReason(operation) : undefined,
      });
      await loadTab('tsdReview', true);
      setRejectReasons((current) => {
        const next = { ...current };
        delete next[operation.id];
        return next;
      });
    } catch (caught) {
      setTsdReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      setTsdReceiptReview((current) => ({ ...current, status: 'error', error: errorMessage(caught) }));
      throw caught;
    }
  }

  function renderActiveTab() {
    if (!activeTabMeta) {
      return <PanelMessage text="У текущего пользователя нет доступных разделов операционной панели." />;
    }

    if (activeTab === 'clients') {
      return renderLoadState(clients, 'Клиенты пока не заведены.', renderClients);
    }

    if (activeTab === 'stock') {
      return renderLoadState(stock, 'Остатки появятся после импорта или приемки.', renderStock);
    }

    if (activeTab === 'tsdReview') {
      const otherOperations = tsdReview.data.filter((operation) => operation.operationType !== 'receipt_scan');
      return (
        <>
          <TsdReceiptReviewPanel
            userId={session.user.id}
            dashboard={tsdReceiptReview.data}
            error={tsdReceiptReview.error}
            isLoading={tsdReceiptReview.status === 'idle' || tsdReceiptReview.status === 'loading'}
            onRefresh={() => void loadTab('tsdReview', true)}
            onDownloadBoxesXlsx={(clientId) =>
              downloadTsdReceiptReviewBoxesXlsx(session.accessToken, clientId)
            }
            onAcceptWithError={(item) =>
              resolveReview(
                {
                  id: item.id,
                } as TsdReviewOperation,
                'ACCEPT_RECEIPT_WITH_ERROR',
              )
            }
          />
          {otherOperations.length ? (
            <div className="tsd-review-other">
              <h3>Прочие операции ТСД</h3>
              {renderTsdReview(
                otherOperations,
                rejectReasons,
                (operation, reason) =>
                  setRejectReasons((current) => ({
                    ...current,
                    [operation.id]: reason,
                  })),
                (operation, action, reason) => void resolveReview(operation, action, reason),
              )}
            </div>
          ) : null}
        </>
      );
    }

    if (activeTab === 'tsdHistory') {
      return <TsdOperationHistoryPanel accessToken={session.accessToken} />;
    }

    if (activeTab === 'roles') {
      return renderLoadState(roles, 'Роли еще не синхронизированы.', renderRoles);
    }

    return renderLoadState(tariffs, 'Тарифы логистики пока не загружены.', renderTariffs);
  }

  return (
    <section className="data-panel" aria-label="Операционные данные">
      <div className="section-heading data-panel__heading">
        <div>
          <p className="eyebrow">Данные онлайн</p>
          <h2>Операционные данные</h2>
        </div>
        {activeTabMeta ? (
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadTab(activeTabMeta.id, true)}
            title="Обновить"
            aria-label="Обновить данные"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {availableTabs.length > 0 ? (
        <div className="data-tabs" role="tablist" aria-label="Разделы операционных данных">
          {availableTabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              <tab.icon size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="data-panel__body">{renderActiveTab()}</div>
    </section>
  );
}

function renderLoadState<T>(state: LoadState<T>, emptyText: string, renderReady: (items: T[]) => ReactNode) {
  if (state.status === 'idle' || (state.status === 'loading' && state.data.length === 0)) {
    return <PanelMessage text="Загружаю данные." />;
  }

  if (state.status === 'error') {
    return <PanelMessage tone="error" text={state.error ?? 'Не удалось загрузить данные.'} />;
  }

  if (state.data.length === 0) {
    return <PanelMessage text={emptyText} />;
  }

  return (
    <>
      {state.status === 'loading' ? <p className="inline-status">Обновляю список.</p> : null}
      {renderReady(state.data)}
    </>
  );
}

function renderClients(items: ClientSummary[]) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Код</th>
            <th>Клиент</th>
            <th>ИНН</th>
            <th>Почта</th>
            <th>Статус</th>
            <th>Создан</th>
          </tr>
        </thead>
        <tbody>
          {items.map((client) => (
            <tr key={client.id}>
              <td>{client.code}</td>
              <td>{client.name}</td>
              <td>{client.inn ?? '-'}</td>
              <td>{client.email ?? '-'}</td>
              <td>
                <span className="status status--ready">{client.status}</span>
              </td>
              <td>{formatDate(client.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderStock(items: StockBalance[]) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Штрихкод</th>
            <th>Короб</th>
            <th>Паллет</th>
            <th>Статус</th>
            <th>Кол-во</th>
            <th>Обновлено</th>
          </tr>
        </thead>
        <tbody>
          {items.map((balance) => (
            <tr key={balance.id}>
              <td>
                <strong>{balance.sku.internalSku}</strong>
                <span>{balance.sku.name}</span>
              </td>
              <td>{primaryBarcode(balance) ?? '-'}</td>
              <td>{balance.box?.code ?? '-'}</td>
              <td>{balance.pallet?.code ?? '-'}</td>
              <td>
                <span className="status status--planned">{stockStatusLabel(balance.status)}</span>
              </td>
              <td>{balance.quantity}</td>
              <td>{formatDate(balance.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderRoles(items: RoleSummary[]) {
  return (
    <div className="role-grid">
      {items.map((role) => (
        <article className="role-item" key={role.id}>
          <div>
            <span className="status status--ready">{role.code}</span>
            <h3>{role.name}</h3>
          </div>
          <div className="permission-list">
            {role.permissions.map((permission) => (
              <span key={permission.code}>{permission.code}</span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function renderTariffs(items: LogisticsTariffSetSummary[]) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Набор</th>
            <th>Файл</th>
            <th>Период</th>
            <th>Направления</th>
            <th>Создан</th>
          </tr>
        </thead>
        <tbody>
          {items.map((tariff) => (
            <tr key={tariff.id}>
              <td>
                <strong>{tariff.name}</strong>
                <span>{tariff.note ?? 'без примечания'}</span>
              </td>
              <td>{tariff.sourceFile ?? '-'}</td>
              <td>
                {formatDate(tariff.activeFrom)} - {formatDate(tariff.activeTo)}
              </td>
              <td>{tariff._count.directions}</td>
              <td>{formatDate(tariff.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderTsdReview(
  items: TsdReviewOperation[],
  rejectReasons: Record<string, TsdReviewReason>,
  onRejectReasonChange: (operation: TsdReviewOperation, reason: TsdReviewReason) => void,
  onResolve: (operation: TsdReviewOperation, action: ResolveTsdReviewPayload['action'], reason?: TsdReviewReason) => void,
) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Операция</th>
            <th>ТСД</th>
            <th>Данные</th>
            <th>Причина</th>
            <th>Создана</th>
            <th>Решение</th>
          </tr>
        </thead>
        <tbody>
          {items.map((operation) => (
            <tr key={operation.id}>
              <td>
                <strong>{operation.operationType}</strong>
                <span>{operation.operationKey}</span>
              </td>
              <td>{operation.deviceId}</td>
              <td>{payloadSummary(operation.payload)}</td>
              <td>
                <strong>{reviewReasonLabel(operation.reviewReason)}</strong>
                <span>{operation.serverMessage ?? '-'}</span>
              </td>
              <td>{formatDate(operation.createdAt)}</td>
              <td>
                <div className="review-actions">
                  {operation.operationType === 'inventory_scan' ? (
                    <button
                      className="review-action review-action--accept"
                      type="button"
                      onClick={() => onResolve(operation, 'APPLY_INVENTORY_ADJUSTMENT')}
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      <span>Принять</span>
                    </button>
                  ) : null}
                  <select
                    className="review-reason-select"
                    value={rejectReasons[operation.id] ?? defaultRejectReason(operation)}
                    onChange={(event) => onRejectReasonChange(operation, event.target.value as TsdReviewReason)}
                    aria-label="Причина отклонения"
                  >
                    {tsdReviewReasonOptions.map((reason) => (
                      <option key={reason} value={reason}>
                        {reviewReasonLabel(reason)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="review-action review-action--reject"
                    type="button"
                    onClick={() => onResolve(operation, 'REJECT', rejectReasons[operation.id] ?? defaultRejectReason(operation))}
                  >
                    <XCircle size={15} aria-hidden="true" />
                    <span>Отклонить</span>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderTsdReviewHistory(items: TsdReviewOperation[]) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Операция</th>
            <th>Решение</th>
            <th>Оператор</th>
            <th>Данные</th>
            <th>Причина</th>
            <th>Комментарий</th>
            <th>Дата</th>
          </tr>
        </thead>
        <tbody>
          {items.map((operation) => (
            <tr key={operation.id}>
              <td>
                <strong>{operation.operationType}</strong>
                <span>{operation.operationKey}</span>
              </td>
              <td>
                <span className={`status status--${operation.status === 'ACCEPTED' ? 'ready' : 'planned'}`}>
                  {reviewActionLabel(operation)}
                </span>
              </td>
              <td>
                <strong>{operation.reviewedBy?.name ?? '-'}</strong>
                {operation.reviewedBy?.email ? <span>{operation.reviewedBy.email}</span> : null}
              </td>
              <td>{payloadSummary(operation.payload)}</td>
              <td>
                <strong>{reviewReasonLabel(operation.reviewReason)}</strong>
                <span>{operation.serverMessage ?? '-'}</span>
              </td>
              <td>{operation.resolutionMessage ?? operation.reviewComment ?? operation.serverMessage ?? '-'}</td>
              <td>{formatDate(operation.reviewedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelMessage({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'error' }) {
  return <p className={`panel-message panel-message--${tone}`}>{text}</p>;
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось загрузить данные.';
}

function formatDate(value: string | null) {
  if (!value) {
    return 'не задано';
  }

  return dateFormatter.format(new Date(value));
}

function primaryBarcode(balance: StockBalance) {
  return balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? balance.sku.barcodes[0]?.value;
}

function payloadSummary(payload: Record<string, unknown>) {
  const fields = ['clientId', 'barcode', 'skuId', 'boxCode', 'fromBoxCode', 'toBoxCode', 'quantity', 'countedQuantity'];
  return fields
    .map((field) => (payload[field] == null ? '' : `${field}: ${String(payload[field])}`))
    .filter(Boolean)
    .join(' · ');
}

function defaultRejectReason(operation: TsdReviewOperation): TsdReviewReason {
  return operation.reviewReason ?? 'MANUAL_REJECT';
}

function reviewReasonLabel(reason: TsdReviewReason | null) {
  if (!reason) {
    return 'Причина не задана';
  }

  const labels: Record<TsdReviewReason, string> = {
    INVENTORY_MISMATCH: 'Расхождение инвентаризации',
    SKU_NOT_FOUND: 'SKU не найден',
    BOX_NOT_FOUND: 'Короб не найден',
    RECEIPT_FAILED: 'Ошибка приемки',
    DEVICE_MISMATCH: 'Не тот ТСД',
    VALIDATION_ERROR: 'Ошибка данных',
    MANUAL_REJECT: 'Ручное отклонение',
    OTHER: 'Другая причина',
  };

  return labels[reason];
}

function reviewActionLabel(operation: TsdReviewOperation) {
  if (operation.reviewAction === 'APPLY_INVENTORY_ADJUSTMENT') {
    return 'Корректировка принята';
  }

  if (operation.reviewAction === 'REJECT') {
    return 'Отклонено';
  }

  return operation.status;
}
