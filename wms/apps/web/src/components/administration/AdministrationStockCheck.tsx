import { AlertTriangle, CheckCircle2, FileSpreadsheet, LoaderCircle, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRememberedClientId } from '../../lib/rememberedClient';
import {
  compareAdministrationWbStockFile,
  compareAdministrationWbStockApi,
  fetchBranches,
  fetchClients,
  fetchFbsWarehouseRoutes,
  fetchMarketplaceConnections,
  reconcileFbsStockItem,
  type AdministrationStockComparison,
  type AuthSession,
  type BranchSummary,
  type ClientSummary,
  type MarketplaceConnectionSummary,
} from '../../lib/api';

const ALL_WB_WAREHOUSES = 'ALL';
type WbWarehouseScope = 'ALL' | 'ONE';
type WbWarehouseTarget = {
  key: string;
  connectionId: string;
  marketplaceWarehouseId: string;
  marketplaceWarehouseName: string;
  accountName: string;
  effectiveExecutionWarehouseId: string | null;
  legacyMoscowFallback: boolean;
};

export function AdministrationStockCheck({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [connections, setConnections] = useState<MarketplaceConnectionSummary[]>([]);
  const [warehouseTargets, setWarehouseTargets] = useState<WbWarehouseTarget[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [warehouseId, setWarehouseId] = useState(session.user.activeWarehouseId ?? '');
  const [warehouseScope, setWarehouseScope] = useState<WbWarehouseScope>('ALL');
  const [warehouseTargetKey, setWarehouseTargetKey] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AdministrationStockComparison | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [hideZeroWb, setHideZeroWb] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingSource, setLoadingSource] = useState<'FILE' | 'API' | null>(null);
  const [fixingSkuId, setFixingSkuId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([fetchClients(session.accessToken), fetchBranches(session.accessToken)])
      .then(([nextClients, nextBranches]) => {
        setClients(nextClients);
        setBranches(nextBranches.filter((branch) => branch.isActive));
        setClientId((current) => current || nextClients[0]?.id || '');
        setWarehouseId((current) => current || nextBranches.find((branch) => branch.code === 'MSK')?.id || nextBranches[0]?.id || '');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось загрузить клиентов и филиалы.'));
  }, [session.accessToken]);

  useEffect(() => {
    if (!clientId) {
      setConnections([]);
      setWarehouseTargets([]);
      setWarehouseTargetKey('');
      return;
    }
    void fetchMarketplaceConnections(session.accessToken, { clientId })
      .then((items) => {
        const next = items.filter((item) => item.marketplace === 'WILDBERRIES' && item.isActive);
        setConnections(next);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось загрузить кабинеты WB.'));
  }, [clientId, session.accessToken]);

  useEffect(() => {
    let cancelled = false;
    if (!connections.length) {
      setWarehouseTargets([]);
      setWarehouseTargetKey('');
      setLoadingWarehouses(false);
      return () => { cancelled = true; };
    }
    setLoadingWarehouses(true);
    void Promise.all(connections.map(async (connection) => {
      try {
        const routes = await fetchFbsWarehouseRoutes(session.accessToken, connection.id);
        return routes.warehouses
          .filter((item) => item.mode !== 'EXCLUDED')
          .map((item) => ({
            key: `${connection.id}::${item.marketplaceWarehouseId}`,
            connectionId: connection.id,
            marketplaceWarehouseId: item.marketplaceWarehouseId,
            marketplaceWarehouseName: item.marketplaceWarehouseName,
            accountName: connection.accountName || 'Wildberries',
            effectiveExecutionWarehouseId: item.effectiveExecutionWarehouseId
              ?? (item.marketplaceWarehouseId === connection.fbsWarehouseId ? connection.fbsExecutionWarehouseId : null),
            legacyMoscowFallback: item.marketplaceWarehouseId === connection.fbsWarehouseId
              && !item.effectiveExecutionWarehouseId
              && !connection.fbsExecutionWarehouseId,
          } satisfies WbWarehouseTarget));
      } catch {
        return connection.fbsWarehouseId ? [{
          key: `${connection.id}::${connection.fbsWarehouseId}`,
          connectionId: connection.id,
          marketplaceWarehouseId: connection.fbsWarehouseId,
          marketplaceWarehouseName: connection.fbsWarehouseName || `Склад WB ${connection.fbsWarehouseId}`,
          accountName: connection.accountName || 'Wildberries',
          effectiveExecutionWarehouseId: connection.fbsExecutionWarehouseId,
          legacyMoscowFallback: !connection.fbsExecutionWarehouseId,
        } satisfies WbWarehouseTarget] : [];
      }
    })).then((groups) => {
      if (cancelled) return;
      const unique = new Map<string, WbWarehouseTarget>();
      groups.flat().forEach((item) => unique.set(item.key, item));
      setWarehouseTargets([...unique.values()].sort((left, right) =>
        left.marketplaceWarehouseName.localeCompare(right.marketplaceWarehouseName, 'ru-RU')));
    }).finally(() => {
      if (!cancelled) setLoadingWarehouses(false);
    });
    return () => { cancelled = true; };
  }, [connections, session.accessToken]);

  const eligibleWarehouseTargets = useMemo(() => {
    const branch = branches.find((item) => item.id === warehouseId);
    if (!branch) return [];
    const isMoscow = branch.code === 'MSK' || /москв/iu.test(`${branch.city} ${branch.name}`);
    return warehouseTargets.filter((target) => target.effectiveExecutionWarehouseId
      ? target.effectiveExecutionWarehouseId === branch.id
      : target.legacyMoscowFallback && isMoscow);
  }, [branches, warehouseId, warehouseTargets]);

  useEffect(() => {
    setWarehouseTargetKey((current) => eligibleWarehouseTargets.some((item) => item.key === current)
      ? current
      : eligibleWarehouseTargets[0]?.key || '');
  }, [eligibleWarehouseTargets]);

  const selectedWarehouseTarget = eligibleWarehouseTargets.find((item) => item.key === warehouseTargetKey) ?? null;
  const selectedConnectionId = warehouseScope === 'ALL' ? ALL_WB_WAREHOUSES : selectedWarehouseTarget?.connectionId || '';
  const selectedMarketplaceWarehouseId = warehouseScope === 'ONE'
    ? selectedWarehouseTarget?.marketplaceWarehouseId
    : undefined;

  useEffect(() => {
    setResult(null);
    setError('');
  }, [clientId, warehouseId, warehouseScope, warehouseTargetKey]);

  const visibleRows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('ru-RU');
    return (result?.rows ?? []).filter((row) => {
      if (!showAll && row.status === 'MATCH') return false;
      if (hideZeroWb && row.quantity === 0 && row.status !== 'WB_EXCESS') return false;
      if (!normalized) return true;
      return [row.barcode, row.sellerArticle, row.name, row.size, row.sku?.internalSku, row.sku?.name]
        .some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalized));
    });
  }, [result, search, showAll, hideZeroWb]);

  async function compare() {
    if (!clientId || !warehouseId || !selectedConnectionId || !file) {
      setError('Выберите клиента, филиал WMS, склады Wildberries и файл XLSX.');
      return;
    }
    setLoading(true);
    setLoadingSource('FILE');
    setError('');
    try {
      setResult(await compareAdministrationWbStockFile(session.accessToken, {
        clientId,
        warehouseId,
        connectionId: selectedConnectionId,
        marketplaceWarehouseId: selectedMarketplaceWarehouseId,
        file,
      }));
      setShowAll(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверка остатков завершилась ошибкой.');
    } finally {
      setLoading(false);
      setLoadingSource(null);
    }
  }

  async function compareFromWb() {
    if (!clientId || !warehouseId || !selectedConnectionId) {
      setError('Выберите клиента, филиал WMS и склады Wildberries.');
      return;
    }
    setLoading(true);
    setLoadingSource('API');
    setError('');
    try {
      setResult(await compareAdministrationWbStockApi(session.accessToken, {
        clientId,
        warehouseId,
        connectionId: selectedConnectionId,
        marketplaceWarehouseId: selectedMarketplaceWarehouseId,
      }));
      setShowAll(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось получить остатки из Wildberries.');
    } finally {
      setLoading(false);
      setLoadingSource(null);
    }
  }

  async function fixRow(row: AdministrationStockComparison['rows'][number]) {
    if (!result || !row.sku || row.status !== 'WB_EXCESS') return;
    if (!result.fixContext.connectionId || !result.fixContext.warehouseId) {
      setError('Для исправления выберите один конкретный склад WB. Режим «Все склады WB» предназначен для общей сверки.');
      return;
    }
    setFixingSkuId(row.sku.id);
    setError('');
    try {
      await reconcileFbsStockItem(session.accessToken, {
        clientId: result.client.id,
        connectionId: result.fixContext.connectionId,
        warehouseId: result.fixContext.warehouseId,
        skuId: row.sku.id,
      });
      await compareFromWb();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось исправить остаток WB.');
    } finally {
      setFixingSkuId('');
    }
  }

  return (
    <div className="admin-stack admin-stock-check">
      <section className="admin-section">
        <div className="admin-section__heading">
          <div><span>Контроль WB ↔ WMS</span><h3>Проверка остатков по файлу Wildberries</h3></div>
          <p>Загрузите стандартный файл stocks.xlsx. Проверка ничего не изменяет: она только показывает расхождения по баркоду с учётом резерва FBS.</p>
        </div>

        <div className="admin-stock-check__form">
          <label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}
          </select></label>
          <label><span>Филиал WMS</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Выберите филиал</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.city} · {branch.name}</option>)}
          </select></label>
          <fieldset className="admin-stock-check__scope">
            <legend>Какие склады WB проверить</legend>
            <label className={warehouseScope === 'ALL' ? 'is-selected' : ''}>
              <input
                type="radio"
                name="wb-stock-warehouse-scope"
                value="ALL"
                checked={warehouseScope === 'ALL'}
                onChange={() => setWarehouseScope('ALL')}
              />
              <span><strong>Все склады сразу</strong><small>{loadingWarehouses ? 'загружаю склады…' : `${eligibleWarehouseTargets.length || 0} для филиала`}</small></span>
            </label>
            <label className={warehouseScope === 'ONE' ? 'is-selected' : ''}>
              <input
                type="radio"
                name="wb-stock-warehouse-scope"
                value="ONE"
                checked={warehouseScope === 'ONE'}
                onChange={() => setWarehouseScope('ONE')}
              />
              <span><strong>Один склад</strong><small>выбрать отдельно</small></span>
            </label>
          </fieldset>
          {warehouseScope === 'ONE' ? <label><span>Склад Wildberries</span><select value={warehouseTargetKey} disabled={loadingWarehouses} onChange={(event) => setWarehouseTargetKey(event.target.value)}>
            <option value="">{loadingWarehouses ? 'Загружаю склады WB…' : 'Выберите склад WB'}</option>
            {eligibleWarehouseTargets.map((target) => <option key={target.key} value={target.key}>
              {target.marketplaceWarehouseName} · {target.accountName}
            </option>)}
          </select></label> : <div className="admin-stock-check__all-warehouses" aria-live="polite">
            <span>В проверку войдут</span>
            <strong>{loadingWarehouses
              ? 'Загружаю маршруты складов…'
              : eligibleWarehouseTargets.length ? `Все склады WB · ${eligibleWarehouseTargets.length}` : 'Для филиала склады не настроены'}</strong>
          </div>}
          <label className="admin-stock-check__file"><span>Файл остатков WB</span><input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <em><FileSpreadsheet size={18} />{file?.name || 'Выберите stocks.xlsx'}</em>
          </label>
          <button type="button" className="admin-button" onClick={() => void compare()} disabled={loading || loadingWarehouses || !eligibleWarehouseTargets.length}>
            {loadingSource === 'FILE' ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}Проверить файл
          </button>
          <button type="button" className="admin-button admin-stock-check__wb-button" onClick={() => void compareFromWb()} disabled={loading || loadingWarehouses || !eligibleWarehouseTargets.length}>
            {loadingSource === 'API' ? <LoaderCircle className="spin" size={17} /> : <FileSpreadsheet size={17} />}Взять с WB
          </button>
        </div>
        {error ? <div className="admin-message admin-message--error"><AlertTriangle size={18} />{error}</div> : null}
      </section>

      {result ? <>
        <section className={`admin-stock-health ${result.health === 'OK' ? 'is-ok' : 'is-danger'}`}>
          {result.health === 'OK' ? <CheckCircle2 size={28} /> : <AlertTriangle size={28} />}
          <div><strong>{result.health === 'OK' ? 'Остатки WB в норме' : 'На WB есть завышенные остатки'}</strong>
            <span>{result.health === 'OK'
              ? 'Количество на WB нигде не превышает свободный остаток WMS.'
              : `${result.summary.excessProducts} товар(ов) · нужно уменьшить суммарно на ${result.summary.excessUnits} шт.`} · Источник: {result.source === 'API' ? 'WB API' : result.file.name}
              {result.wildberriesWarehouses && result.wildberriesWarehouses.length > 1
                ? ` · складов WB: ${result.wildberriesWarehouses.length}`
                : ''}</span></div>
        </section>

        <section className="admin-metrics admin-metrics--stock">
          <article><span>Строк товаров</span><strong>{result.summary.products}</strong></article>
          <article><span>Найдены в WMS</span><strong>{result.summary.matched}</strong></article>
          <article><span>Полное совпадение</span><strong>{result.summary.exact}</strong></article>
          <article><span>WB больше WMS</span><strong className={result.summary.excessProducts ? 'is-danger' : 'is-ok'}>{result.summary.excessProducts}</strong></article>
          <article><span>WMS больше WB</span><strong>{result.summary.wmsGreaterProducts}</strong></article>
          <article><span>Баркод не найден</span><strong>{result.summary.notFound}</strong></article>
        </section>

        <section className="admin-section">
          <div className="admin-stock-check__toolbar">
            <label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Баркод, артикул, товар или размер" /></label>
            <label className="admin-stock-check__toggle"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Показать совпавшие</label>
            <label className="admin-stock-check__toggle"><input type="checkbox" checked={hideZeroWb} onChange={(event) => setHideZeroWb(event.target.checked)} />Скрыть нулевые WB</label>
            <span>Показано: {visibleRows.length}</span>
          </div>
          <div className="admin-stock-check__table-wrap"><table className="admin-stock-check__table"><thead><tr>
            <th>Статус</th><th>Баркод</th><th>Товар WB</th><th>Размер</th><th>WB</th><th>WMS свободно</th><th>Разница WB − WMS</th><th>Действие</th>
          </tr></thead><tbody>{visibleRows.map((row) => <tr key={row.barcode} className={`is-${row.status.toLocaleLowerCase()}`}>
            <td><span className="admin-stock-check__status">{statusLabel(row.status)}</span></td><td>{row.barcode}</td>
            <td><strong>{row.sellerArticle || row.name || '—'}</strong><small>{row.sku ? `${row.sku.internalSku} · ${row.sku.name}` : 'В WMS не найден'}</small></td>
            <td>{row.size || row.sku?.size || '—'}</td><td>{row.quantity}</td><td>{row.wmsQuantity}<small>Всего {row.wmsAvailable}, резерв {row.wmsReserved}</small></td>
            <td><strong>{row.difference > 0 ? `+${row.difference}` : row.difference}</strong></td>
            <td>{row.status === 'WB_EXCESS' && row.sku && result.fixContext.connectionId ? <button
              type="button"
              className="admin-stock-check__fix"
              disabled={Boolean(fixingSkuId)}
              onClick={() => void fixRow(row)}
            >{fixingSkuId === row.sku.id ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />}Исправить</button>
              : <small>{row.status === 'WB_EXCESS' && !result.fixContext.connectionId
                ? 'Для исправления выберите один склад'
                : row.status === 'WMS_GREATER' ? 'WB не повышаем' : row.status === 'NOT_FOUND' ? 'Сопоставьте баркод' : '—'}</small>}</td>
          </tr>)}</tbody></table></div>
          {!visibleRows.length ? <div className="admin-empty"><CheckCircle2 size={24} />Расхождений по выбранному фильтру нет.</div> : null}
        </section>
      </> : null}
    </div>
  );
}

function statusLabel(status: AdministrationStockComparison['rows'][number]['status']) {
  if (status === 'WB_EXCESS') return 'WB превышен';
  if (status === 'WMS_GREATER') return 'WMS больше';
  if (status === 'NOT_FOUND') return 'Не найден';
  return 'Совпадает';
}
