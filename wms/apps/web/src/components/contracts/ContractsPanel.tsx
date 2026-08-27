import { Archive, ArchiveRestore, ArrowRight, CheckCircle2, Download, FilePlus2, FileSignature, FileText, RefreshCw, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  createClientContract,
  deleteClientContract,
  checkClientContractRequisites,
  downloadClientContract,
  downloadContractAdditionalAgreement,
  fetchContractClients,
  fetchContracts,
  refreshClientContractRequisites,
  setClientContractArchived,
  uploadContractAdditionalAgreement,
  uploadSignedClientContract,
  type AuthSession,
  type ClientContractSummary,
  type ClientContractRequisitesCheck,
  type ContractClientOption,
} from '../../lib/api';
import './contracts.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { useRememberedClientId } from '../../lib/rememberedClient';

export function ContractsPanel({ session }: { session: AuthSession }) {
  const canCreate = canUse(session, 'billing:write');
  const [contracts, setContracts] = useState<ClientContractSummary[]>([]);
  const [clients, setClients] = useState<ContractClientOption[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [contractDate, setContractDate] = useState(today());
  const [contractNumber, setContractNumber] = useState('');
  const [wmsUrl, setWmsUrl] = useState('https://wms.logoff.pro');
  const [wmsLogin, setWmsLogin] = useState('');
  const [wmsPassword, setWmsPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [requisitesCheck, setRequisitesCheck] = useState<{
    contract: ClientContractSummary;
    result: ClientContractRequisitesCheck;
    wmsPassword: string;
    status: 'ready' | 'applying';
    error?: string;
  } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId), [clientId, clients]);

  async function load() {
    setBusy('load');
    setError('');
    try {
      const [nextContracts, nextClients] = await Promise.all([
        fetchContracts(session.accessToken),
        fetchContractClients(session.accessToken),
      ]);
      setContracts(nextContracts);
      setClients(nextClients);
      if (!clientId && nextClients.length === 1) {
        selectClient(nextClients[0], false);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  function selectClient(client: ContractClientOption | undefined, updateId = true) {
    if (updateId) {
      setClientId(client?.id ?? '');
    }
    setWmsLogin(client?.suggestedLogin ?? '');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clientId || !wmsLogin.trim() || !wmsPassword) {
      setError('Выберите клиента и заполните логин и пароль WMS для договора.');
      return;
    }
    setBusy('create');
    setError('');
    setMessage('');
    try {
      const created = await createClientContract(session.accessToken, {
        clientId,
        contractDate,
        contractNumber: contractNumber.trim() || undefined,
        wmsUrl,
        wmsLogin,
        wmsPassword,
      });
      setContracts((current) => [created, ...current]);
      setWmsPassword('');
      setContractNumber('');
      setMessage(`Договор №${created.number} создан. PDF готов к скачиванию.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function download(contract: ClientContractSummary, signed = false) {
    setBusy(`download-${contract.id}-${signed}`);
    setError('');
    try {
      const blob = await downloadClientContract(session.accessToken, contract.id, signed);
      downloadBlob(blob, signed ? contract.signedFileName || `Подписанный ${contract.fileName}` : contract.fileName);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function uploadSigned(contract: ClientContractSummary, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(`signed-${contract.id}`);
    setError('');
    try {
      const updated = await uploadSignedClientContract(session.accessToken, contract.id, file);
      replaceContract(updated);
      setMessage(`Подписанный договор №${updated.number} загружен.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function uploadAgreement(contract: ClientContractSummary, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(`agreement-${contract.id}`);
    setError('');
    try {
      const updated = await uploadContractAdditionalAgreement(session.accessToken, contract.id, file);
      replaceContract(updated);
      setMessage(`Дополнительное соглашение добавлено к договору №${updated.number}.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function downloadAgreement(contract: ClientContractSummary, attachmentId: string, fileName: string) {
    setBusy(`attachment-${attachmentId}`);
    setError('');
    try {
      const blob = await downloadContractAdditionalAgreement(session.accessToken, contract.id, attachmentId);
      downloadBlob(blob, fileName);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function checkRequisites(contract: ClientContractSummary) {
    setBusy(`check-${contract.id}`);
    setError('');
    setMessage('');
    try {
      const result = await checkClientContractRequisites(session.accessToken, contract.id);
      if (result.upToDate) {
        setMessage(`Договор №${contract.number} проверен: реквизиты актуальны, замен не требуется.`);
        return;
      }
      setRequisitesCheck({
        contract,
        result,
        wmsPassword: '',
        status: 'ready',
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function applyRequisitesRefresh() {
    if (!requisitesCheck || requisitesCheck.status === 'applying') return;
    if (!requisitesCheck.wmsPassword.trim()) {
      setRequisitesCheck((current) =>
        current ? { ...current, error: 'Введите актуальный пароль WMS для нового исходного PDF.' } : current,
      );
      return;
    }
    setRequisitesCheck((current) =>
      current ? { ...current, status: 'applying', error: undefined } : current,
    );
    try {
      const result = await refreshClientContractRequisites(
        session.accessToken,
        requisitesCheck.contract.id,
        {
          expectedFingerprint: requisitesCheck.result.fingerprint,
          wmsPassword: requisitesCheck.wmsPassword,
        },
      );
      replaceContract(result.contract);
      setRequisitesCheck(null);
      setMessage(
        `В договоре №${result.contract.number} обновлено полей: ${result.appliedChanges.length}. ` +
        (result.signedFilePreserved
          ? 'Исходный PDF пересоздан, ранее загруженный подписанный экземпляр сохранён без изменений.'
          : 'Исходный PDF пересоздан.'),
      );
    } catch (caught) {
      setRequisitesCheck((current) =>
        current ? { ...current, status: 'ready', error: errorMessage(caught) } : current,
      );
    }
  }

  function replaceContract(updated: ClientContractSummary) {
    setContracts((current) => current.map((contract) => (contract.id === updated.id ? updated : contract)));
  }

  async function toggleArchive(contract: ClientContractSummary) {
    const archived = !contract.archivedAt;
    if (!window.confirm(archived ? `Переместить договор №${contract.number} в архив?` : `Вернуть договор №${contract.number} из архива?`)) return;
    setBusy(`archive-${contract.id}`);
    setError('');
    try {
      const updated = await setClientContractArchived(session.accessToken, contract.id, archived);
      replaceContract(updated);
      setMessage(archived ? `Договор №${contract.number} перемещён в архив.` : `Договор №${contract.number} восстановлен.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  async function removeContract(contract: ClientContractSummary) {
    if (!window.confirm(`Удалить договор №${contract.number} полностью? PDF и дополнительные соглашения будут удалены без возможности восстановления.`)) return;
    setBusy(`delete-${contract.id}`);
    setError('');
    try {
      await deleteClientContract(session.accessToken, contract.id);
      setContracts((current) => current.filter((item) => item.id !== contract.id));
      setMessage(`Договор №${contract.number} удалён.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('');
    }
  }

  return (
    <WorkspaceTileGate
      eyebrow="Документооборот"
      title="Договоры"
      description="Сначала выберите действие — создание, работа с подписанными документами или проверка реквизитов."
      tiles={[
        { title: 'Создать договор', description: 'Сформировать договор с данными клиента и доступом к WMS.', icon: FilePlus2, tone: 'red' },
        { title: 'Подписанные документы', description: 'Загрузить, скачать и хранить оригиналы договоров.', icon: FileSignature, tone: 'violet' },
        { title: 'Проверка реквизитов', description: 'Сверить договор с актуальными данными клиента.', icon: ShieldCheck, tone: 'green' },
      ]}
    >
    <section className="contracts-panel" aria-label="Договоры">
      <div className="section-heading contracts-panel__heading">
        <div>
          <p className="eyebrow">Документооборот</p>
          <h2>Договоры с клиентами</h2>
          <p>Исходные, подписанные договоры и дополнительные соглашения хранятся в WMS.</p>
        </div>
        <button className="icon-text-button" type="button" onClick={() => void load()} disabled={busy === 'load'}>
          <RefreshCw size={16} aria-hidden="true" />
          Обновить
        </button>
        <label className="contracts-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Показать архив</label>
      </div>

      {error ? <div className="contracts-alert contracts-alert--error">{error}</div> : null}
      {message ? <div className="contracts-alert contracts-alert--success">{message}</div> : null}

      {canCreate ? (
        <form className="contract-create-card" onSubmit={(event) => void submit(event)}>
          <div className="contract-create-card__title">
            <FileSignature size={22} aria-hidden="true" />
            <div>
              <strong>Создать договор</strong>
              <span>Исполнитель: основная компания ИП Говорова Е.А.</span>
            </div>
          </div>
          <div className="contract-create-grid">
            <label>
              <span>Клиент</span>
              <select
                value={clientId}
                onChange={(event) => selectClient(clients.find((client) => client.id === event.target.value))}
                required
              >
                <option value="">Выберите клиента</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} · {client.legalName || client.name}{client.inn ? ` · ИНН ${client.inn}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Дата договора</span>
              <input type="date" value={contractDate} onChange={(event) => setContractDate(event.target.value)} required />
            </label>
            <label>
              <span>Номер договора</span>
              <input
                value={contractNumber}
                onChange={(event) => setContractNumber(event.target.value)}
                placeholder="Оставьте пустым — назначится автоматически"
              />
            </label>
            <label>
              <span>Адрес WMS</span>
              <input type="url" value={wmsUrl} onChange={(event) => setWmsUrl(event.target.value)} required />
            </label>
            <label>
              <span>Логин WMS</span>
              <input value={wmsLogin} onChange={(event) => setWmsLogin(event.target.value)} required />
            </label>
            <label>
              <span>Пароль WMS для договора</span>
              <input
                type="text"
                autoComplete="off"
                value={wmsPassword}
                onChange={(event) => setWmsPassword(event.target.value)}
                required
              />
            </label>
          </div>
          <div className="contract-create-card__footer">
            <span>
              {selectedClient ? `Договор будет создан для ${selectedClient.legalName || selectedClient.name}. ` : ''}
              Пароль попадёт только в PDF и отдельно в базе не сохраняется.
            </span>
            <button className="primary-button" type="submit" disabled={busy === 'create'}>
              <FilePlus2 size={17} aria-hidden="true" />
              {busy === 'create' ? 'Формирую PDF…' : 'Создать договор'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="contracts-list">
        {contracts.length === 0 && busy !== 'load' ? (
          <div className="contracts-empty">
            <FileText size={26} aria-hidden="true" />
            <strong>Договоров пока нет</strong>
            <span>{canCreate ? 'Выберите клиента и создайте первый договор.' : 'Когда договор будет создан, он появится здесь.'}</span>
          </div>
        ) : null}
        {contracts.filter((contract) => showArchived ? Boolean(contract.archivedAt) : !contract.archivedAt).map((contract) => (
          <article className={`contract-card ${contract.status === 'SIGNED' ? 'contract-card--signed' : ''} ${contract.archivedAt ? 'contract-card--archived' : ''}`} key={contract.id}>
            <div className="contract-card__top">
              <div className="contract-card__identity">
                <span className="contract-card__icon"><FileText size={20} aria-hidden="true" /></span>
                <div>
                  <strong>Договор №{contract.number}</strong>
                  <span>{contract.client.legalName || contract.client.name} · {contract.client.code}</span>
                </div>
              </div>
              <span className={`contract-status contract-status--${contract.status === 'SIGNED' ? 'signed' : 'waiting'}`}>
                {contract.status === 'SIGNED' ? <CheckCircle2 size={15} aria-hidden="true" /> : <FileSignature size={15} aria-hidden="true" />}
                {contract.status === 'SIGNED' ? 'Подписан' : 'Ожидает подписи'}
              </span>
              {contract.archivedAt ? <span className="contract-status contract-status--archived"><Archive size={15}/>В архиве</span> : null}
            </div>

            <div className="contract-card__meta">
              <span><b>Дата:</b> {formatDate(contract.contractDate)}</span>
              <span><b>Создан:</b> {formatDateTime(contract.createdAt)}</span>
              <span><b>Логин WMS:</b> {contract.wmsLogin}</span>
              <span><b>Доп. соглашений:</b> {contract.attachments.length}</span>
            </div>

            <div className="contract-card__actions">
              <button type="button" onClick={() => void download(contract)}>
                <Download size={16} aria-hidden="true" /> Скачать исходный PDF
              </button>
              {canCreate ? (
                <button
                  className="contract-requisites-check-button"
                  type="button"
                  onClick={() => void checkRequisites(contract)}
                  disabled={busy === `check-${contract.id}`}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  {busy === `check-${contract.id}` ? 'Проверяю реквизиты…' : 'Проверить договор'}
                </button>
              ) : null}
              {contract.signedUploadedAt ? (
                <button type="button" onClick={() => void download(contract, true)}>
                  <Download size={16} aria-hidden="true" /> Скачать подписанный
                </button>
              ) : null}
              <label className="contract-upload-button">
                <Upload size={16} aria-hidden="true" />
                {contract.signedUploadedAt ? 'Заменить подписанный' : 'Загрузить подписанный договор'}
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => void uploadSigned(contract, event)} />
              </label>
              <label className="contract-upload-button contract-upload-button--secondary">
                <FilePlus2 size={16} aria-hidden="true" />
                Добавить доп. соглашение
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => void uploadAgreement(contract, event)} />
              </label>
              {canCreate ? <button type="button" className="contract-archive-button" onClick={() => void toggleArchive(contract)} disabled={busy === `archive-${contract.id}`}>{contract.archivedAt ? <ArchiveRestore size={16}/> : <Archive size={16}/>} {contract.archivedAt ? 'Вернуть из архива' : 'В архив'}</button> : null}
              {canCreate ? <button type="button" className="contract-delete-button" onClick={() => void removeContract(contract)} disabled={busy === `delete-${contract.id}`}><Trash2 size={16}/>Удалить</button> : null}
            </div>

            {contract.attachments.length > 0 ? (
              <div className="contract-attachments">
                <strong>Дополнительные соглашения</strong>
                {contract.attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => void downloadAgreement(contract, attachment.id, attachment.fileName)}
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span>{attachment.fileName}</span>
                    <small>{formatFileSize(attachment.fileSize)} · {formatDateTime(attachment.createdAt)}</small>
                    <Download size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {requisitesCheck ? (
        <div className="contract-check-backdrop" role="presentation">
          <section
            className="contract-check-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contract-check-title"
          >
            <header className="contract-check-dialog__header">
              <div>
                <span className="contract-check-dialog__icon"><ShieldCheck size={21} aria-hidden="true" /></span>
                <div>
                  <h3 id="contract-check-title">Изменения в договоре №{requisitesCheck.contract.number}</h3>
                  <p>Система предлагает заменить только изменившиеся реквизиты.</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Закрыть проверку договора"
                onClick={() => setRequisitesCheck(null)}
                disabled={requisitesCheck.status === 'applying'}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <div className="contract-check-dialog__summary">
              Найдено изменений: <strong>{requisitesCheck.result.changes.length}</strong>
            </div>

            <div className="contract-requisites-changes">
              {requisitesCheck.result.changes.map((change) => (
                <article key={`${change.party}-${change.field}`}>
                  <div className="contract-requisites-changes__label">
                    <span>{change.party === 'CLIENT' ? 'Заказчик' : 'Исполнитель'}</span>
                    <strong>{change.label}</strong>
                  </div>
                  <div className="contract-requisites-changes__values">
                    <span title={change.oldValue ?? 'Не заполнено'}>{change.oldValue || 'Не заполнено'}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                    <strong title={change.newValue ?? 'Будет очищено'}>{change.newValue || 'Будет очищено'}</strong>
                  </div>
                </article>
              ))}
            </div>

            {requisitesCheck.result.signedFilePresent ? (
              <div className="contract-check-dialog__signed-warning">
                Подписанный клиентом PDF уже загружен. Он не будет перезаписан или удалён; обновится только исходный PDF.
              </div>
            ) : null}

            <label className="contract-check-dialog__password">
              <span>Актуальный пароль WMS для нового PDF</span>
              <input
                type="text"
                autoComplete="off"
                value={requisitesCheck.wmsPassword}
                onChange={(event) =>
                  setRequisitesCheck((current) =>
                    current ? { ...current, wmsPassword: event.target.value, error: undefined } : current,
                  )
                }
                placeholder="Пароль не хранится и нужен только для формирования PDF"
                disabled={requisitesCheck.status === 'applying'}
              />
            </label>

            {requisitesCheck.error ? (
              <div className="contracts-alert contracts-alert--error">{requisitesCheck.error}</div>
            ) : null}

            <footer className="contract-check-dialog__footer">
              <button
                type="button"
                className="contract-check-dialog__cancel"
                onClick={() => setRequisitesCheck(null)}
                disabled={requisitesCheck.status === 'applying'}
              >
                Ничего не менять
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void applyRequisitesRefresh()}
                disabled={requisitesCheck.status === 'applying'}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {requisitesCheck.status === 'applying' ? 'Обновляю PDF…' : 'Подтвердить замены'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
    </WorkspaceTileGate>
  );
}

function canUse(session: AuthSession, permission: string) {
  return session.user.permissionCodes.includes('system:admin') || session.user.permissionCodes.includes(permission);
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию с договором.';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
