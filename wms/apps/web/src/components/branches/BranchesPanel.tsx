import { ArrowRight, ArrowRightLeft, Building2, FileSpreadsheet, MapPinned, MoreVertical, PackageCheck, Plus, RefreshCw, Save, ScanLine, Truck, UsersRound, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  assignBranchManager,
  createBranch,
  createInterBranchTransfer,
  fetchBranches,
  fetchClients,
  fetchInterBranchTransfers,
  fetchOwnCompanies,
  fetchSkus,
  fetchUsers,
  previewInterBranchTransferBoxesFile,
  receiveInterBranchTransferBox,
  updateBranch,
  type AuthSession,
  type BranchSummary,
  type BranchTransferBoxesFilePreview,
  type ClientSummary,
  type InterBranchTransfer,
  type OwnCompanySummary,
  type SkuSummary,
  type UserSummary,
} from '../../lib/api';
import './branches.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId } from '../../lib/rememberedClient';

type BranchSettingsForm = {
  name: string;
  city: string;
  address: string;
  ownCompanyId: string;
  managerUserId: string;
  sortOrder: string;
  isActive: boolean;
};

export function BranchesPanel({ session }: { session: AuthSession }) {
  const boxFileInputRef = useRef<HTMLInputElement | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [companies, setCompanies] = useState<OwnCompanySummary[]>([]);
  const [transfers, setTransfers] = useState<InterBranchTransfer[]>([]);
  const [skus, setSkus] = useState<SkuSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [skuId, setSkuId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [transferMode, setTransferMode] = useState<'ITEMS' | 'BOXES'>('ITEMS');
  const [sourceBoxCodes, setSourceBoxCodes] = useState('');
  const [boxFilePreview, setBoxFilePreview] = useState<BranchTransferBoxesFilePreview | null>(null);
  const [boxFileBusy, setBoxFileBusy] = useState(false);
  const [receiptBoxCodes, setReceiptBoxCodes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createForm, setCreateForm] = useState({ code: '', city: '', name: '', address: '', ownCompanyId: '' });
  const [settingsBranchId, setSettingsBranchId] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<BranchSettingsForm>({
    name: '',
    city: '',
    address: '',
    ownCompanyId: '',
    managerUserId: '',
    sortOrder: '100',
    isActive: true,
  });
  const isAdmin = session.user.permissionCodes.includes('system:admin');
  const activeBranch = branches.find((branch) => branch.id === session.user.activeWarehouseId) ?? null;
  const settingsBranch = branches.find((branch) => branch.id === settingsBranchId) ?? null;

  async function loadBase() {
    setError('');
    try {
      const [nextBranches, nextClients, nextUsers, nextCompanies, nextTransfers] = await Promise.all([
        fetchBranches(session.accessToken),
        fetchClients(session.accessToken),
        isAdmin ? fetchUsers(session.accessToken) : Promise.resolve([]),
        isAdmin ? fetchOwnCompanies(session.accessToken) : Promise.resolve([]),
        fetchInterBranchTransfers(session.accessToken),
      ]);
      setBranches(nextBranches);
      setClients(nextClients);
      setUsers(nextUsers.filter((user) => user.status === 'ACTIVE' && !user.roles.some((role) => ['ADMIN', 'OWNER'].includes(role.role.code))));
      setCompanies(nextCompanies);
      setTransfers(nextTransfers);
      const nextClientId = clientId || nextClients[0]?.id || '';
      setClientId(nextClientId);
      if (!targetWarehouseId) {
        setTargetWarehouseId(nextBranches.find((branch) => branch.id !== session.user.activeWarehouseId)?.id ?? '');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function loadClientData(nextClientId: string) {
    if (!nextClientId) {
      setSkus([]);
      return;
    }
    try {
      const nextSkus = await fetchSkus(session.accessToken, { clientId: nextClientId });
      setSkus(nextSkus);
      setSkuId((current) => nextSkus.some((sku) => sku.id === current) ? current : nextSkus[0]?.id ?? '');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    setClientId('');
    setTargetWarehouseId('');
    void loadBase();
  }, [session.accessToken, session.user.activeWarehouseId]);

  useEffect(() => {
    void loadClientData(clientId);
  }, [clientId, session.accessToken]);

  useEffect(() => {
    setSourceBoxCodes('');
    setBoxFilePreview(null);
  }, [clientId, session.user.activeWarehouseId]);

  const inboundTransfers = useMemo(
    () =>
      transfers.filter(
        (transfer) =>
          transfer.toWarehouse.id === activeBranch?.id &&
          ['PENDING_RECEIPT', 'PARTIALLY_RECEIVED'].includes(transfer.status),
      ),
    [activeBranch?.id, transfers],
  );

  async function previewBoxesFile(file: File | null) {
    if (!file || !activeBranch || !clientId) return;
    setTransferMode('BOXES');
    setBoxFileBusy(true);
    setBoxFilePreview(null);
    setSourceBoxCodes('');
    setError('');
    setMessage('');
    try {
      const preview = await previewInterBranchTransferBoxesFile(
        session.accessToken,
        {
          clientId,
          fromWarehouseId: activeBranch.id,
          file,
        },
      );
      setBoxFilePreview(preview);
      setSourceBoxCodes(preview.validCodes.join('\n'));
      setMessage(
        preview.summary.readyBoxes
          ? `Файл проверен: готово к перемещению ${preview.summary.readyBoxes} коробов, ${preview.summary.totalQuantity} шт. товара.`
          : 'Файл проверен, но доступных для перемещения коробов не найдено.',
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBoxFileBusy(false);
      if (boxFileInputRef.current) boxFileInputRef.current.value = '';
    }
  }

  async function submitTransfer(event: FormEvent) {
    event.preventDefault();
    if (!activeBranch) {
      setError('Сначала выберите активный город в верхней панели.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const transfer = await createInterBranchTransfer(session.accessToken, {
        clientId,
        fromWarehouseId: activeBranch.id,
        toWarehouseId: targetWarehouseId,
        ...(transferMode === 'BOXES'
          ? {
              sourceBoxCodes: sourceBoxCodes
                .split(/[\s,;]+/)
                .map((code) => code.trim())
                .filter(Boolean),
            }
          : { items: [{ skuId, quantity: Number(quantity) }] }),
        comment,
      });
      setMessage(
        `Перемещение №${transfer.number} отправлено: ${transfer.fromWarehouse.city} → ${transfer.toWarehouse.city}. Остаток в городе назначения появится после сканирования коробов.`,
      );
      setComment('');
      setSourceBoxCodes('');
      setBoxFilePreview(null);
      await Promise.all([loadBase(), loadClientData(clientId)]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function receiveBox(transfer: InterBranchTransfer) {
    const boxCode = receiptBoxCodes[transfer.id]?.trim();
    if (!boxCode) {
      setError('Отсканируйте короб для приёмки.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const received = await receiveInterBranchTransferBox(
        session.accessToken,
        transfer.id,
        boxCode,
      );
      setReceiptBoxCodes((current) => ({ ...current, [transfer.id]: '' }));
      setMessage(
        received.status === 'RECEIVED'
          ? `Перемещение №${received.number} полностью принято в ${received.toWarehouse.city}.`
          : `Короб ${boxCode} принят. Ожидаются остальные короба перемещения №${received.number}.`,
      );
      await Promise.all([loadBase(), loadClientData(clientId)]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitBranch(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await createBranch(session.accessToken, createForm);
      setCreateForm({ code: '', city: '', name: '', address: '', ownCompanyId: '' });
      setMessage('Новый филиал создан.');
      await loadBase();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function openBranchSettings(branch: BranchSummary) {
    const responsible = branch.userScopes?.find((scope) => scope.isResponsible)?.user;
    setSettingsBranchId(branch.id);
    setSettingsForm({
      name: branch.name,
      city: branch.city,
      address: branch.address || '',
      ownCompanyId: branch.ownCompanyId || '',
      managerUserId: responsible?.id || '',
      sortOrder: String(branch.sortOrder),
      isActive: branch.isActive,
    });
  }

  async function saveBranchSettings(event: FormEvent) {
    event.preventDefault();
    if (!settingsBranch) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await updateBranch(session.accessToken, settingsBranch.id, {
        name: settingsForm.name,
        city: settingsForm.city,
        address: settingsForm.address,
        ownCompanyId: settingsForm.ownCompanyId || null,
        sortOrder: Number(settingsForm.sortOrder),
        isActive: settingsForm.isActive,
      });
      const previousManagerId = settingsBranch.userScopes?.find((scope) => scope.isResponsible)?.user.id || null;
      const nextManagerId = settingsForm.managerUserId || null;
      if (previousManagerId !== nextManagerId) {
        await assignBranchManager(session.accessToken, settingsBranch.id, nextManagerId);
      }
      setMessage(`Настройки филиала «${settingsForm.city}» сохранены.`);
      setSettingsBranchId(null);
      await loadBase();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceTileGate
      eyebrow="Обособленные подразделения"
      title="Филиалы"
      description="Выберите работу с филиалом, перемещением товара или приёмкой межгородской поставки."
      tiles={[
        { title: 'Филиалы и настройки', description: 'Состав сети, ответственные, собственные компании и остатки.', icon: Building2, tone: 'blue' },
        { title: 'Перемещение между городами', description: 'Переместить товар или целые короба, включая загрузку Excel.', icon: ArrowRightLeft, tone: 'violet' },
        { title: 'Приёмка перемещения', description: 'Пропикать приехавшие короба и поставить остатки филиала.', icon: ScanLine, tone: 'green' },
      ]}
    >
    <section className="branches-panel">
      <div className="branches-hero">
        <div>
          <p className="eyebrow">Обособленные подразделения</p>
          <h2>Филиалы и перемещения между городами</h2>
          <p>Каждый менеджер работает только со своим ФФ. Администратор переключает город сверху и видит всю сеть через один логин.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void Promise.all([loadBase(), loadClientData(clientId)])}>
          <RefreshCw size={16} /> Обновить
        </button>
      </div>

      {message ? <p className="branches-message branches-message--ok">{message}</p> : null}
      {error ? <p className="branches-message branches-message--error">{error}</p> : null}

      <div className="branches-grid">
        {branches.map((branch) => {
          const stock = branch._stock;
          const isActive = branch.id === session.user.activeWarehouseId;
          const responsible = branch.userScopes?.find((scope) => scope.isResponsible)?.user ?? null;
          return (
            <article className={`branch-card ${isActive ? 'branch-card--active' : ''}`} key={branch.id}>
              <div className="branch-card__head">
                <span><MapPinned size={20} /></span>
                <div><strong>{branch.city}</strong><small>{branch.code} · {branch.name}</small></div>
                {isActive ? <em>Активный</em> : null}
                {isAdmin ? (
                  <button
                    className="branch-card__menu"
                    type="button"
                    title={`Настройки филиала ${branch.city}`}
                    aria-label={`Настройки филиала ${branch.city}`}
                    onClick={() => openBranchSettings(branch)}
                  >
                    <MoreVertical size={18} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <p>{branch.address || 'Адрес пока не указан'}</p>
              <div className="branch-card__metrics">
                <span title="Общий фактический остаток всех клиентов филиала"><b>{stock?.totalQuantity ?? 0}</b><small>товаров</small></span>
                <span title="Количество SKU с положительным остатком во всём филиале"><b>{stock?.skuCount ?? 0}</b><small>SKU</small></span>
                <span><b>{branch._count?.clients ?? 0}</b><small>клиентов</small></span>
              </div>
              <div className="branch-card__company">
                <Building2 size={16} />
                <span><small>ИП / организация</small><strong>{branch.ownCompany?.shortName || 'Не привязано'}</strong></span>
              </div>
              <div className="branch-card__responsible">
                <UsersRound size={16} />
                <span><small>Ответственный</small><strong>{responsible?.name || 'Не назначен'}</strong></span>
              </div>
            </article>
          );
        })}
      </div>

      {isAdmin && settingsBranch ? (
        <div
          className="branch-settings-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Настройки филиала ${settingsBranch.city}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setSettingsBranchId(null);
          }}
        >
          <section className="branch-settings-dialog">
            <header>
              <div>
                <p className="eyebrow">Настройки филиала</p>
                <h3>{settingsBranch.city} · {settingsBranch.code}</h3>
              </div>
              <button className="branch-settings-dialog__close" type="button" aria-label="Закрыть настройки филиала" disabled={busy} onClick={() => setSettingsBranchId(null)}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={saveBranchSettings}>
              <div className="branch-settings-grid">
                <label><span>Код филиала</span><input value={settingsBranch.code} readOnly /></label>
                <label><span>Город</span><input value={settingsForm.city} required onChange={(event) => setSettingsForm((current) => ({ ...current, city: event.target.value }))} /></label>
                <label><span>Название филиала</span><input value={settingsForm.name} required onChange={(event) => setSettingsForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label className="branch-settings-grid__wide"><span>Адрес</span><input value={settingsForm.address} onChange={(event) => setSettingsForm((current) => ({ ...current, address: event.target.value }))} /></label>
                <label><span>ИП / организация</span><select value={settingsForm.ownCompanyId} onChange={(event) => setSettingsForm((current) => ({ ...current, ownCompanyId: event.target.value }))}><option value="">Не привязано</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.shortName} · ИНН {company.inn}</option>)}</select></label>
                <label><span>Ответственный управляющий</span><select value={settingsForm.managerUserId} onChange={(event) => setSettingsForm((current) => ({ ...current, managerUserId: event.target.value }))}><option value="">Не назначен</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
                <label><span>Порядок отображения</span><input min="0" step="1" type="number" value={settingsForm.sortOrder} onChange={(event) => setSettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} /></label>
                <label className="branch-settings-toggle"><input type="checkbox" checked={settingsForm.isActive} onChange={(event) => setSettingsForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>Филиал активен</span></label>
              </div>
              <footer>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setSettingsBranchId(null)}>Отмена</button>
                <button className="primary-button" type="submit" disabled={busy}><Save size={16} aria-hidden="true" />{busy ? 'Сохраняю…' : 'Сохранить настройки'}</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      <section className="branch-workspace">
        <div className="branch-workspace__heading">
          <div><p className="eyebrow">Межгородская логистика</p><h3>Переместить товар клиента</h3></div>
          <label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}</select></label>
        </div>
        <form className="branch-transfer-form" onSubmit={submitTransfer}>
          <div className="branch-transfer-route">
            <span><small>Откуда</small><strong>{activeBranch?.city || 'Выберите город сверху'}</strong></span>
            <ArrowRight size={24} />
            <label><span>Куда</span><select value={targetWarehouseId} onChange={(event) => setTargetWarehouseId(event.target.value)} required>{branches.filter((branch) => branch.id !== activeBranch?.id).map((branch) => <option key={branch.id} value={branch.id}>{branch.city} · {branch.name}</option>)}</select></label>
          </div>
          <div className="branch-transfer-mode">
            <button className={transferMode === 'ITEMS' ? 'active' : ''} type="button" onClick={() => setTransferMode('ITEMS')}>Товар по количеству</button>
            <button className={transferMode === 'BOXES' ? 'active' : ''} type="button" onClick={() => setTransferMode('BOXES')}>Целые короба</button>
          </div>
          {transferMode === 'ITEMS' ? (
            <>
              <label><span>Товар</span><select value={skuId} onChange={(event) => setSkuId(event.target.value)} required>{skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.internalSku} · {sku.name}</option>)}</select></label>
              <label><span>Количество</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
            </>
          ) : (
            <div className="branch-transfer-boxes">
              <label>
                <span>Коды коробов</span>
                <textarea
                  rows={4}
                  value={sourceBoxCodes}
                  onChange={(event) => {
                    setSourceBoxCodes(event.target.value);
                    setBoxFilePreview(null);
                  }}
                  placeholder="Сканируйте короба через Enter, пробел или запятую"
                  required
                />
              </label>
              <div className="branch-transfer-file">
                <input
                  ref={boxFileInputRef}
                  accept=".xlsx,.xls,.csv"
                  hidden
                  type="file"
                  onChange={(event) =>
                    void previewBoxesFile(event.target.files?.[0] ?? null)
                  }
                />
                <button
                  className="secondary-button"
                  type="button"
                  disabled={boxFileBusy || busy || !clientId || !activeBranch}
                  onClick={() => boxFileInputRef.current?.click()}
                >
                  <FileSpreadsheet size={17} aria-hidden="true" />
                  {boxFileBusy ? 'Проверяю файл…' : 'Загрузить Excel с коробами'}
                </button>
                <small>
                  Подойдёт XLSX, XLS или CSV с колонкой «Код короба»,
                  «Короб», «ШК короба» либо простой список в одной колонке.
                </small>
              </div>
              {boxFilePreview ? (
                <BranchTransferFilePreview preview={boxFilePreview} />
              ) : null}
            </div>
          )}
          <label className="branch-transfer-form__comment"><span>Комментарий</span><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: открытие филиала Краснодар" /></label>
          <button
            className="primary-button"
            type="submit"
            disabled={
              busy ||
              !clientId ||
              !targetWarehouseId ||
              (transferMode === 'ITEMS' ? !skuId : !sourceBoxCodes.trim())
            }
          >
            <ArrowRightLeft size={17} /> {busy ? 'Перемещаю…' : 'Оформить перемещение'}
          </button>
        </form>
      </section>

      <section className="branch-receiving">
        <h3><Truck size={20} /> Ожидается приёмка в {activeBranch?.city || 'выбранном филиале'}</h3>
        {inboundTransfers.length ? inboundTransfers.map((transfer) => (
          <article key={transfer.id}>
            <div>
              <strong>Перемещение №{transfer.number}</strong>
              <span>{transfer.client.code} · {transfer.client.name}</span>
              <small>
                {transfer.fromWarehouse.city} → {transfer.toWarehouse.city} · принято {transfer.receivedQuantity} из {transfer.totalQuantity} шт.
              </small>
            </div>
            <div className="branch-receiving__boxes">
              {(transfer.manifest?.boxes ?? []).map((box) => {
                const received = (transfer.receivedBoxCodes ?? []).includes(box.code.toUpperCase());
                return <span className={received ? 'received' : ''} key={box.boxId}>{box.code} · {box.quantity} шт.</span>;
              })}
            </div>
            <label>
              <span>Сканирование приехавшего короба</span>
              <input
                autoComplete="off"
                value={receiptBoxCodes[transfer.id] ?? ''}
                onChange={(event) => setReceiptBoxCodes((current) => ({ ...current, [transfer.id]: event.target.value }))}
                placeholder="Код короба"
              />
            </label>
            <button className="primary-button" type="button" disabled={busy} onClick={() => void receiveBox(transfer)}>
              <ScanLine size={17} /> Принять короб
            </button>
            {transfer.issues?.length ? (
              <div className="branch-receiving__issues">
                {transfer.issues.map((issue) => <span key={issue.id}>{issue.message}</span>)}
              </div>
            ) : null}
          </article>
        )) : <p className="muted">Для выбранного клиента ожидаемых перемещений нет.</p>}
      </section>

      <section className="branch-history">
        <h3><PackageCheck size={20} /> История межгородских перемещений</h3>
        {transfers.length ? transfers.map((transfer) => (
          <article key={transfer.id}>
            <strong>№{transfer.number}</strong>
            <span>{transfer.fromWarehouse.city} <ArrowRight size={14} /> {transfer.toWarehouse.city}</span>
            <span>{transfer.client.name}</span>
            <b>{transfer.totalQuantity} шт.</b>
            <small>{transferStatusLabel(transfer.status)} · {new Date(transfer.createdAt).toLocaleString('ru-RU')} · {transfer.createdByName}</small>
          </article>
        )) : <p className="muted">Перемещений по выбранному клиенту пока нет.</p>}
      </section>

      {isAdmin ? (
        <form className="branch-create" onSubmit={submitBranch}>
          <div><Plus size={20} /><span><strong>Открыть новый ФФ</strong><small>После создания привяжите ИП и назначьте менеджера.</small></span></div>
          <input placeholder="Код, например SPB" value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} required />
          <input placeholder="Город" value={createForm.city} onChange={(event) => setCreateForm({ ...createForm, city: event.target.value })} required />
          <input placeholder="Название филиала" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} />
          <input placeholder="Адрес" value={createForm.address} onChange={(event) => setCreateForm({ ...createForm, address: event.target.value })} />
          <select value={createForm.ownCompanyId} onChange={(event) => setCreateForm({ ...createForm, ownCompanyId: event.target.value })}>
            <option value="">ИП / организация не выбраны</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.shortName} · {company.inn}</option>)}
          </select>
          <button className="secondary-button" type="submit" disabled={busy}><Plus size={16} /> Создать филиал</button>
        </form>
      ) : null}
    </section>
    </WorkspaceTileGate>
  );
}

function BranchTransferFilePreview({
  preview,
}: {
  preview: BranchTransferBoxesFilePreview;
}) {
  const errorRows = preview.rows.filter((row) => row.status === 'ERROR');
  return (
    <section
      className="branch-transfer-file-preview"
      aria-label="Проверка файла с коробами"
    >
      <div className="branch-transfer-file-preview__head">
        <span>
          <FileSpreadsheet size={18} aria-hidden="true" />
          <strong>{preview.fileName}</strong>
        </span>
        <small>Лист: {preview.sheetName}</small>
      </div>
      <div className="branch-transfer-file-preview__metrics">
        <span>
          <b>{preview.summary.readyBoxes}</b>
          <small>готово</small>
        </span>
        <span>
          <b>{preview.summary.totalQuantity}</b>
          <small>единиц товара</small>
        </span>
        <span className={preview.summary.errorBoxes ? 'has-error' : ''}>
          <b>{preview.summary.errorBoxes}</b>
          <small>ошибок</small>
        </span>
        <span>
          <b>{preview.summary.duplicateBoxes}</b>
          <small>дубликатов убрано</small>
        </span>
      </div>
      {errorRows.length ? (
        <div className="branch-transfer-file-preview__errors">
          <strong>Не будут включены в перемещение:</strong>
          {errorRows.slice(0, 50).map((row) => (
            <span key={`${row.row}:${row.code}`}>
              Строка {row.row}: {row.code} — {row.reason}
            </span>
          ))}
          {errorRows.length > 50 ? (
            <small>И ещё {errorRows.length - 50} ошибок.</small>
          ) : null}
        </div>
      ) : null}
      {preview.duplicateCodes.length ? (
        <small>
          Повторяющиеся коды удалены: {preview.duplicateCodes.slice(0, 20).join(', ')}
          {preview.duplicateCodes.length > 20
            ? ` и ещё ${preview.duplicateCodes.length - 20}`
            : ''}
          .
        </small>
      ) : null}
    </section>
  );
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}

function transferStatusLabel(status: string) {
  if (status === 'PENDING_RECEIPT') return 'В пути';
  if (status === 'PARTIALLY_RECEIVED') return 'Принято частично';
  if (status === 'RECEIVED') return 'Принято';
  if (status === 'CANCELLED') return 'Отменено';
  return status;
}
