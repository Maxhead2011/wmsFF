import { Building2, Edit3, FileImage, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createOwnCompany,
  deleteOwnCompanyAsset,
  fetchClients,
  fetchOwnCompanies,
  updateClient,
  updateOwnCompany,
  uploadOwnCompanyAsset,
  type AuthSession,
  type AuthUser,
  type ClientSummary,
  type OwnCompanySummary,
  type UpsertOwnCompanyPayload,
} from '../../lib/api';
import { RequisitesDocumentImport } from '../requisites/RequisitesDocumentImport';
import './own-companies.css';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';

type OwnCompaniesPanelProps = {
  session: AuthSession;
};

type OwnCompanyFormState = {
  id: string | null;
  shortName: string;
  fullName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  bankAccounts: BankAccountFormState[];
  paymentCode: string;
  paymentPurposeCode: string;
  isDefault: boolean;
  isActive: boolean;
  comment: string;
};

type BankAccountFormState = {
  key: string;
  id?: string;
  bankName: string;
  bankBik: string;
  bankInn: string;
  bankKpp: string;
  bankAccount: string;
  correspondentAccount: string;
  isDefault: boolean;
  comment: string;
};

function emptyForm(): OwnCompanyFormState {
  return {
    id: null,
    shortName: '',
    fullName: '',
    inn: '',
    kpp: '',
    ogrn: '',
    legalAddress: '',
    bankAccounts: [],
    paymentCode: '',
    paymentPurposeCode: '',
    isDefault: false,
    isActive: true,
    comment: '',
  };
}

function emptyBankAccount(isDefault = false): BankAccountFormState {
  return {
    key: `bank-${Date.now()}-${Math.random()}`,
    bankName: '',
    bankBik: '',
    bankInn: '',
    bankKpp: '',
    bankAccount: '',
    correspondentAccount: '',
    isDefault,
    comment: '',
  };
}

export function OwnCompaniesPanel({ session }: OwnCompaniesPanelProps) {
  const canWrite = canUse(session.user, 'own-companies:write');
  const isSystemAdmin = session.user.permissionCodes.includes('system:admin');
  const [companies, setCompanies] = useState<OwnCompanySummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [form, setForm] = useState<OwnCompanyFormState>(() => emptyForm());
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [busyClientId, setBusyClientId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const defaultCompany = useMemo(() => companies.find((company) => company.isDefault), [companies]);
  const canEditCompany = (company: OwnCompanySummary) =>
    canWrite && (isSystemAdmin || company.warehouseId === session.user.activeWarehouseId);

  useEffect(() => {
    setCompanies([]);
    setClients([]);
    setForm(emptyForm());
    void loadCompanies();
  }, [session.accessToken, session.user.activeWarehouseId]);

  if (!canUse(session.user, 'own-companies:read')) {
    return null;
  }

  async function loadCompanies() {
    setStatus('loading');
    setError(null);
    try {
      const [nextCompanies, nextClients] = await Promise.all([
        fetchOwnCompanies(session.accessToken),
        fetchClients(session.accessToken),
      ]);
      setCompanies(nextCompanies);
      setClients(nextClients);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setStatus('idle');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }

    setStatus('saving');
    setError(null);
    setMessage('');
    try {
      const payload = formToPayload(form, isSystemAdmin);
      let saved = form.id
        ? await updateOwnCompany(session.accessToken, form.id, payload)
        : await createOwnCompany(session.accessToken, payload);
      if (stampFile) {
        saved = await uploadOwnCompanyAsset(session.accessToken, saved.id, 'stamp', stampFile);
      }
      if (signatureFile) {
        saved = await uploadOwnCompanyAsset(session.accessToken, saved.id, 'signature', signatureFile);
      }
      setCompanies((current) => [saved, ...current.filter((company) => company.id !== saved.id)].sort(sortCompanies));
      setForm(emptyForm());
      setStampFile(null);
      setSignatureFile(null);
      await loadCompanies();
      setMessage('Реквизиты, печать и факсимиле сохранены.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setStatus('idle');
    }
  }

  function edit(company: OwnCompanySummary) {
    setForm({
      id: company.id,
      shortName: company.shortName,
      fullName: company.fullName,
      inn: company.inn,
      kpp: company.kpp ?? '',
      ogrn: company.ogrn ?? '',
      legalAddress: company.legalAddress ?? '',
      bankAccounts: company.bankAccounts.length
        ? company.bankAccounts.map((account) => ({
            key: account.id,
            id: account.id,
            bankName: account.bankName,
            bankBik: account.bankBik,
            bankInn: account.bankInn ?? '',
            bankKpp: account.bankKpp ?? '',
            bankAccount: account.bankAccount,
            correspondentAccount: account.correspondentAccount ?? '',
            isDefault: account.isDefault,
            comment: account.comment ?? '',
          }))
        : company.bankAccount
          ? [{
              ...emptyBankAccount(true),
              bankName: company.bankName ?? '',
              bankBik: company.bankBik ?? '',
              bankAccount: company.bankAccount,
              correspondentAccount: company.correspondentAccount ?? '',
            }]
          : [],
      paymentCode: company.paymentCode ?? '',
      paymentPurposeCode: company.paymentPurposeCode ?? '',
      isDefault: company.isDefault,
      isActive: company.isActive,
      comment: company.comment ?? '',
    });
    setMessage('');
    setStampFile(null);
    setSignatureFile(null);
  }

  async function assignCompany(client: ClientSummary, ownCompanyId: string) {
    setBusyClientId(client.id);
    setError(null);
    try {
      const updated = await updateClient(session.accessToken, client.id, { ownCompanyId });
      setClients((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(`Для клиента ${client.name} выбрана компания ${updated.ownCompany?.shortName ?? ''}.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyClientId('');
    }
  }

  async function removeAsset(company: OwnCompanySummary, kind: 'stamp' | 'signature') {
    if (!window.confirm(`Удалить ${kind === 'stamp' ? 'печать' : 'факсимиле'} у ${company.shortName}?`)) {
      return;
    }
    try {
      const updated = await deleteOwnCompanyAsset(session.accessToken, company.id, kind);
      setCompanies((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <WorkspaceTileGate
      eyebrow="Реквизиты"
      title="Собственные компании"
      description="Управляйте реквизитами, расчётными счетами и привязкой компании к клиенту из одного рабочего места."
      tiles={[
        { title: 'Компания и реквизиты', description: 'Создать или изменить юридические данные компании.', icon: Building2, tone: 'blue' },
        { title: 'Расчётные счета', description: 'Добавить счета и выбрать основной для выставления.', icon: Save, tone: 'green' },
        { title: 'Печать и подпись', description: 'Загрузить печать и факсимиле для документов.', icon: FileImage, tone: 'violet' },
      ]}
    >
    <section className="own-companies-panel" aria-label="Собственные компании">
      <div className="section-heading own-companies-panel__heading">
        <div>
          <p className="eyebrow">Реквизиты</p>
          <h2>Собственные компании</h2>
        </div>
        <button className="icon-button" type="button" onClick={() => void loadCompanies()} title="Обновить" aria-label="Обновить">
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>

      {isSystemAdmin && defaultCompany ? (
        <div className="own-companies-default">
          <Building2 size={18} aria-hidden="true" />
          <span>По умолчанию для счетов и актов</span>
          <strong>{defaultCompany.shortName}</strong>
          <small>р/с {defaultCompany.bankAccount || 'не указан'}</small>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {!isSystemAdmin ? (
        <p className="own-companies-panel__scope-note">
          Здесь показываются только компании выбранного филиала. Новая компания будет автоматически
          привязана к нему и не появится у сотрудников других филиалов.
        </p>
      ) : null}

      <form className="own-company-form" onSubmit={(event) => void submit(event)}>
        <RequisitesDocumentImport
          accessToken={session.accessToken}
          target="own-company"
          disabled={!canWrite || status === 'saving'}
          onImported={(fields) => {
            setForm((current) => ({
              ...current,
              shortName: fields.shortName || fields.name || current.shortName,
              fullName: fields.fullName || fields.legalName || current.fullName,
              inn: fields.inn || current.inn,
              kpp: fields.kpp || current.kpp,
              ogrn: fields.ogrn || current.ogrn,
              legalAddress: fields.legalAddress || current.legalAddress,
              bankAccounts: mergeImportedBankAccount(current.bankAccounts, fields),
            }));
            setError(null);
            setMessage('Реквизиты распознаны. Проверьте заполненные поля перед сохранением.');
          }}
        />
        <div className="own-company-form__grid">
          <label>
            <span>Краткое название</span>
            <input required value={form.shortName} onChange={(event) => setFormValue('shortName', event.target.value)} />
          </label>
          <label>
            <span>Полное название</span>
            <input required value={form.fullName} onChange={(event) => setFormValue('fullName', event.target.value)} />
          </label>
          <label>
            <span>ИНН</span>
            <input required value={form.inn} onChange={(event) => setFormValue('inn', event.target.value)} />
          </label>
          <label>
            <span>КПП</span>
            <input value={form.kpp} onChange={(event) => setFormValue('kpp', event.target.value)} />
          </label>
          <label>
            <span>ОГРН / ОГРНИП</span>
            <input value={form.ogrn} onChange={(event) => setFormValue('ogrn', event.target.value)} />
          </label>
          <label className="own-company-form__wide">
            <span>Юридический адрес</span>
            <input value={form.legalAddress} onChange={(event) => setFormValue('legalAddress', event.target.value)} />
          </label>
          <label>
            <span>Код</span>
            <input value={form.paymentCode} onChange={(event) => setFormValue('paymentCode', event.target.value)} />
          </label>
          <label>
            <span>Наз. пл.</span>
            <input value={form.paymentPurposeCode} onChange={(event) => setFormValue('paymentPurposeCode', event.target.value)} />
          </label>
          <label className="own-company-form__wide">
            <span>Комментарий</span>
            <input value={form.comment} onChange={(event) => setFormValue('comment', event.target.value)} />
          </label>
          <label className="own-company-form__asset">
            <span>Изображение печати (PNG/JPEG)</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => setStampFile(event.target.files?.[0] ?? null)}
            />
            <small>
              {stampFile?.name ||
                (form.id ? companies.find((item) => item.id === form.id)?.stampFileName : '') ||
                'не загружена'}
            </small>
          </label>
          <label className="own-company-form__asset">
            <span>Факсимиле / подпись (PNG/JPEG)</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => setSignatureFile(event.target.files?.[0] ?? null)}
            />
            <small>
              {signatureFile?.name ||
                (form.id ? companies.find((item) => item.id === form.id)?.signatureFileName : '') ||
                'не загружено'}
            </small>
          </label>
        </div>

        <section className="own-company-bank-accounts">
          <div className="own-company-bank-accounts__heading">
            <div>
              <strong>Расчётные счета компании</strong>
              <small>Основной счёт выбирается автоматически при создании нового счёта на оплату.</small>
            </div>
            <button className="secondary-button" type="button" onClick={addBankAccount}>
              <Plus size={16} aria-hidden="true" />
              Добавить расчётный счёт
            </button>
          </div>

          {form.bankAccounts.map((account, index) => (
            <article className="own-company-bank-account" key={account.key}>
              <header>
                <label className="own-company-bank-account__default">
                  <input
                    checked={account.isDefault}
                    name="default-bank-account"
                    type="radio"
                    onChange={() => setDefaultBankAccount(account.key)}
                  />
                  <span>{account.isDefault ? 'Основной счёт' : `Счёт ${index + 1}`}</span>
                </label>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => removeBankAccount(account.key)}
                  title="Удалить расчётный счёт"
                  aria-label="Удалить расчётный счёт"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </header>
              <div className="own-company-bank-account__grid">
                <label>
                  <span>Банк</span>
                  <input required value={account.bankName} onChange={(event) => updateBankAccount(account.key, { bankName: event.target.value })} />
                </label>
                <label>
                  <span>БИК банка</span>
                  <input required value={account.bankBik} onChange={(event) => updateBankAccount(account.key, { bankBik: event.target.value })} />
                </label>
                <label>
                  <span>ИНН банка</span>
                  <input value={account.bankInn} onChange={(event) => updateBankAccount(account.key, { bankInn: event.target.value })} />
                </label>
                <label>
                  <span>КПП банка</span>
                  <input value={account.bankKpp} onChange={(event) => updateBankAccount(account.key, { bankKpp: event.target.value })} />
                </label>
                <label>
                  <span>Расчётный счёт</span>
                  <input required value={account.bankAccount} onChange={(event) => updateBankAccount(account.key, { bankAccount: event.target.value })} />
                </label>
                <label>
                  <span>Корреспондентский счёт</span>
                  <input value={account.correspondentAccount} onChange={(event) => updateBankAccount(account.key, { correspondentAccount: event.target.value })} />
                </label>
                <label className="own-company-bank-account__comment">
                  <span>Название / комментарий</span>
                  <input value={account.comment} placeholder="Например: Сбербанк, дополнительный" onChange={(event) => updateBankAccount(account.key, { comment: event.target.value })} />
                </label>
              </div>
            </article>
          ))}

          {form.bankAccounts.length === 0 ? (
            <p className="own-company-bank-accounts__empty">Расчётные счета пока не добавлены.</p>
          ) : null}
        </section>

        <div className="own-company-form__checks">
          {isSystemAdmin ? (
            <label>
              <input checked={form.isDefault} type="checkbox" onChange={(event) => setFormValue('isDefault', event.target.checked)} />
              <span>Использовать по умолчанию в счетах и актах</span>
            </label>
          ) : null}
          <label>
            <input checked={form.isActive} type="checkbox" onChange={(event) => setFormValue('isActive', event.target.checked)} />
            <span>Активна</span>
          </label>
        </div>

        <div className="own-company-form__actions">
          <button className="primary-button" disabled={status === 'saving'} type="submit">
            <Save size={16} aria-hidden="true" />
            {form.id ? 'Сохранить изменения' : 'Добавить компанию'}
          </button>
          {form.id ? (
            <button className="secondary-button" type="button" onClick={() => setForm(emptyForm())}>
              Отменить
            </button>
          ) : null}
        </div>
      </form>

      <div className="own-companies-table-wrap">
        <table className="own-companies-table">
          <thead>
            <tr>
              <th>Компания</th>
              <th>ИНН</th>
              <th>Банк</th>
              <th>Расчетные счета</th>
              <th>Статус</th>
              <th>Печать и подпись</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}>
                <td>
                  <strong>{company.shortName}</strong>
                  <span>{company.fullName}</span>
                </td>
                <td>{company.inn}</td>
                <td>
                  <span>{company.bankName || '-'}</span>
                  <small>БИК {company.bankBik || '-'}</small>
                </td>
                <td>
                  {(company.bankAccounts.length ? company.bankAccounts : [null]).map((account, index) =>
                    account ? (
                      <small key={account.id}>
                        {account.isDefault ? 'Основной: ' : ''}{account.bankAccount} · {account.bankName}
                      </small>
                    ) : (
                      <small key={index}>{company.bankAccount || 'не указан'}</small>
                    ),
                  )}
                </td>
                <td>
                  <span className={`status status--${company.isActive ? 'ready' : 'planned'}`}>
                    {company.isActive ? 'активна' : 'выключена'}
                  </span>
                  {isSystemAdmin && company.isDefault ? <span className="status status--in-progress">по умолчанию</span> : null}
                  {company.warehouseId ? <small>Компания филиала</small> : null}
                </td>
                <td className="own-company-assets">
                  <span>{company.hasStamp ? `✓ Печать: ${company.stampFileName}` : '— Печать не загружена'}</span>
                  <span>{company.hasSignature ? `✓ Факсимиле: ${company.signatureFileName}` : '— Факсимиле не загружено'}</span>
                  {company.hasStamp && canEditCompany(company) ? (
                    <button type="button" className="link-button" onClick={() => void removeAsset(company, 'stamp')}>
                      удалить печать
                    </button>
                  ) : null}
                  {company.hasSignature && canEditCompany(company) ? (
                    <button type="button" className="link-button" onClick={() => void removeAsset(company, 'signature')}>
                      удалить факсимиле
                    </button>
                  ) : null}
                </td>
                <td>
                  <button className="icon-button" disabled={!canEditCompany(company)} type="button" onClick={() => edit(company)} title="Редактировать" aria-label="Редактировать">
                    <Edit3 size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {companies.length === 0 ? (
              <tr>
                <td colSpan={7}>{status === 'loading' ? 'Загрузка...' : 'Компаний пока нет.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {companies.length > 0 ? (
        <section className="own-company-clients">
          <div>
            <FileImage size={18} aria-hidden="true" />
            <div>
              <strong>Какая компания работает с клиентом</strong>
              <p>
                Эта компания автоматически используется в счетах, актах и договорах.
                {companies.filter((company) => company.isActive).length === 1
                  ? ' Единственная активная компания назначается автоматически.'
                  : ' Выберите компанию для каждого клиента.'}
              </p>
            </div>
          </div>
          <div className="own-company-clients__list">
            {clients.map((client) => (
              <label key={client.id}>
                <span>
                  {client.name}
                  <small>{client.legalName}</small>
                </span>
                <select
                  value={client.ownCompanyId ?? ''}
                  disabled={!canWrite || busyClientId === client.id}
                  onChange={(event) => void assignCompany(client, event.target.value)}
                >
                  <option value="" disabled>Выберите компанию</option>
                  {companies.filter((company) => company.isActive).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.shortName} · ИНН {company.inn}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      ) : null}
    </section>
    </WorkspaceTileGate>
  );

  function setFormValue<Key extends keyof OwnCompanyFormState>(key: Key, value: OwnCompanyFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addBankAccount() {
    setForm((current) => ({
      ...current,
      bankAccounts: [
        ...current.bankAccounts,
        emptyBankAccount(current.bankAccounts.length === 0),
      ],
    }));
  }

  function updateBankAccount(key: string, patch: Partial<BankAccountFormState>) {
    setForm((current) => ({
      ...current,
      bankAccounts: current.bankAccounts.map((account) =>
        account.key === key ? { ...account, ...patch } : account,
      ),
    }));
  }

  function setDefaultBankAccount(key: string) {
    setForm((current) => ({
      ...current,
      bankAccounts: current.bankAccounts.map((account) => ({
        ...account,
        isDefault: account.key === key,
      })),
    }));
  }

  function removeBankAccount(key: string) {
    setForm((current) => {
      const removed = current.bankAccounts.find((account) => account.key === key);
      const bankAccounts = current.bankAccounts.filter((account) => account.key !== key);
      if (removed?.isDefault && bankAccounts.length > 0) {
        bankAccounts[0] = { ...bankAccounts[0], isDefault: true };
      }
      return { ...current, bankAccounts };
    });
  }
}

function formToPayload(form: OwnCompanyFormState, allowGlobalDefault: boolean): UpsertOwnCompanyPayload {
  const bankAccounts = form.bankAccounts.map((account) => ({
    id: account.id,
    bankName: account.bankName,
    bankBik: account.bankBik,
    bankInn: account.bankInn || undefined,
    bankKpp: account.bankKpp || undefined,
    bankAccount: account.bankAccount,
    correspondentAccount: account.correspondentAccount || undefined,
    isDefault: account.isDefault,
    comment: account.comment || undefined,
  }));
  const defaultAccount = bankAccounts.find((account) => account.isDefault) ?? bankAccounts[0];

  return {
    shortName: form.shortName,
    fullName: form.fullName,
    inn: form.inn,
    kpp: form.kpp || undefined,
    ogrn: form.ogrn || undefined,
    legalAddress: form.legalAddress || undefined,
    bankName: defaultAccount?.bankName || undefined,
    bankBik: defaultAccount?.bankBik || undefined,
    bankAccount: defaultAccount?.bankAccount || undefined,
    correspondentAccount: defaultAccount?.correspondentAccount || undefined,
    paymentCode: form.paymentCode || undefined,
    paymentPurposeCode: form.paymentPurposeCode || undefined,
    isDefault: allowGlobalDefault ? form.isDefault : false,
    isActive: form.isActive,
    comment: form.comment || undefined,
    bankAccounts,
  };
}

type ImportedBankFields = {
  bankName?: string;
  bankBik?: string;
  bankAccount?: string;
  correspondentAccount?: string;
};

function mergeImportedBankAccount(
  accounts: BankAccountFormState[],
  fields: ImportedBankFields,
) {
  if (!fields.bankName && !fields.bankBik && !fields.bankAccount && !fields.correspondentAccount) {
    return accounts;
  }
  const currentDefault = accounts.find((account) => account.isDefault) ?? accounts[0];
  const imported = {
    ...(currentDefault ?? emptyBankAccount(true)),
    bankName: fields.bankName || currentDefault?.bankName || '',
    bankBik: fields.bankBik || currentDefault?.bankBik || '',
    bankAccount: fields.bankAccount || currentDefault?.bankAccount || '',
    correspondentAccount:
      fields.correspondentAccount || currentDefault?.correspondentAccount || '',
  };
  if (!currentDefault) {
    return [imported];
  }
  return accounts.map((account) => (account.key === currentDefault.key ? imported : account));
}

function sortCompanies(left: OwnCompanySummary, right: OwnCompanySummary) {
  if (left.isDefault !== right.isDefault) {
    return left.isDefault ? -1 : 1;
  }

  return left.shortName.localeCompare(right.shortName, 'ru');
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить действие.';
}
