import { ImageOff, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { fetchNomenclature, type AuthSession, type NomenclatureSummary } from '../../lib/api';
import { NomenclatureEditDialog } from './NomenclatureEditDialog';

type SkuDirectoryTableProps = {
  session: AuthSession;
  reloadKey: number;
};

type NomenclatureWithDetails = NomenclatureSummary & {
  brand?: string | null;
  subjectName?: string | null;
  photoUrl?: string | null;
  weightGrams?: string | number | null;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
  volumeLiters?: string | number | null;
  properties?: Record<string, unknown> | Array<{ name?: string; value?: unknown }> | null;
};

export function SkuDirectoryTable({ session, reloadKey }: SkuDirectoryTableProps) {
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [localReloadKey, setLocalReloadKey] = useState(0);
  const [skus, setSkus] = useState<NomenclatureSummary[]>([]);
  const [selectedSku, setSelectedSku] = useState<NomenclatureSummary | null>(null);
  const [editingSku, setEditingSku] = useState<NomenclatureSummary | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadSkus() {
      setLoading(true);
      setError('');
      try {
        const list = await fetchNomenclature(session.accessToken, {
          search: appliedSearch || undefined,
        });
        if (isActive) {
          setSkus(list);
          setSelectedSku((current) => (current ? list.find((sku) => sku.id === current.id) ?? null : null));
        }
      } catch (caught) {
        if (isActive) {
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить номенклатуру.');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    void loadSkus();

    return () => {
      isActive = false;
    };
  }, [appliedSearch, localReloadKey, reloadKey, session.accessToken]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedSearch(search.trim());
  }

  function acceptEditedSku(saved: NomenclatureSummary) {
    setSkus((current) => current.map((sku) => (sku.id === saved.id ? saved : sku)));
    setSelectedSku((current) => (current?.id === saved.id ? saved : current));
    setEditingSku(null);
  }

  return (
    <div className="client-table-block">
      <div className="directory-subheading">
        <div>
          <h3>Номенклатура</h3>
          <span>Последние 100 карточек общего справочника</span>
        </div>
      </div>

      <form className="sku-table-toolbar" onSubmit={applySearch}>
        <label className="directory-select-row">
          <span>Поиск</span>
          <div className="sku-search-box">
            <Search size={16} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Название, артикул ВБ, SKU или штрихкод"
            />
          </div>
        </label>

        <button className="icon-text-button" type="submit">
          <Search size={16} aria-hidden="true" />
          Найти
        </button>
        <button className="icon-text-button" type="button" onClick={() => setLocalReloadKey((current) => current + 1)}>
          <RefreshCw size={16} aria-hidden="true" />
          Обновить
        </button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="client-table-scroll">
        <table className="client-directory-table sku-directory-table">
          <thead>
            <tr>
              <th>Внутренний SKU</th>
              <th>Артикул ВБ</th>
              <th>Название</th>
              <th>Штрихкод</th>
              <th>Ед.</th>
              <th>Тип</th>
              <th>Цвет</th>
              <th>Размер</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => (
              <tr
                className={selectedSku?.id === sku.id ? 'selected' : undefined}
                key={sku.id}
                onClick={() => setSelectedSku(sku)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedSku(sku);
                  }
                }}
                tabIndex={0}
              >
                <td>{sku.internalSku}</td>
                <td>{sku.article || '-'}</td>
                <td>
                  <strong className="sku-directory-table__name">{sku.name}</strong>
                  {sku.printName ? <span>{sku.printName}</span> : null}
                </td>
                <td>{sku.barcode || '-'}</td>
                <td>{sku.unit || '-'}</td>
                <td>{sku.itemType || '-'}</td>
                <td>{sku.color || '-'}</td>
                <td>{sku.size || '-'}</td>
                <td className="sku-directory-table__actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingSku(sku);
                    }}
                    title="Редактировать"
                    aria-label={`Редактировать ${sku.name}`}
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {skus.length === 0 ? (
              <tr>
                <td colSpan={9}>{isLoading ? 'Загрузка...' : 'Номенклатура не найдена'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedSku ? (
        <SkuDetailsCard sku={selectedSku} onClose={() => setSelectedSku(null)} onEdit={() => setEditingSku(selectedSku)} />
      ) : null}
      {editingSku ? (
        <NomenclatureEditDialog
          item={editingSku}
          session={session}
          onClose={() => setEditingSku(null)}
          onSaved={acceptEditedSku}
        />
      ) : null}
    </div>
  );
}

function SkuDetailsCard({ sku, onClose, onEdit }: { sku: NomenclatureSummary; onClose: () => void; onEdit: () => void }) {
  const details = sku as NomenclatureWithDetails;
  const dimensions = [
    { label: 'Длина', value: details.lengthCm, suffix: 'см' },
    { label: 'Ширина', value: details.widthCm, suffix: 'см' },
    { label: 'Высота', value: details.heightCm, suffix: 'см' },
    { label: 'Вес', value: details.weightGrams, suffix: 'г' },
    { label: 'Литраж', value: details.volumeLiters, suffix: 'л' },
  ];
  const properties = normalizeProperties(details.properties);

  return (
    <aside className="sku-details-card" aria-label="Карточка товара">
      <div className="sku-details-card__media">
        {details.photoUrl ? (
          <img alt={details.name} src={details.photoUrl} />
        ) : (
          <div className="sku-details-card__placeholder">
            <ImageOff size={28} aria-hidden="true" />
            <span>Фото не загружено</span>
          </div>
        )}
      </div>

      <div className="sku-details-card__body">
        <div className="sku-details-card__heading">
          <div>
            <span>Карточка товара</span>
            <h3>{details.name}</h3>
            {details.printName ? <p>{details.printName}</p> : null}
          </div>
          <div className="sku-details-card__actions">
            <button className="icon-button" type="button" onClick={onEdit} title="Редактировать" aria-label="Редактировать номенклатуру">
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть карточку">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <dl className="sku-details-card__facts">
          <DetailTerm label="Артикул ВБ" value={details.article} />
          <DetailTerm label="Название" value={details.name} />
          <DetailTerm label="Внутренний SKU" value={details.internalSku} />
          <DetailTerm label="Штрихкод" value={details.barcode} />
          <DetailTerm label="Бренд" value={details.brand} />
          <DetailTerm label="Категория" value={details.subjectName ?? details.itemType} />
          <DetailTerm label="Цвет" value={details.color} />
          <DetailTerm label="Размер" value={details.size} />
          <DetailTerm label="Единица" value={details.unit} />
          <DetailTerm label="Честный ЗНАК" value={details.needsChestnyZnak ? 'Да' : 'Нет'} />
        </dl>

        <div className="sku-details-card__section">
          <h4>Габариты</h4>
          <div className="sku-details-card__metrics">
            {dimensions.map((dimension) => (
              <div key={dimension.label}>
                <span>{dimension.label}</span>
                <strong>{formatDetailValue(dimension.value, dimension.suffix)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="sku-details-card__section">
          <h4>Свойства</h4>
          {properties.length ? (
            <dl className="sku-details-card__properties">
              {properties.map((property) => (
                <DetailTerm key={property.name} label={property.name} value={property.value} />
              ))}
            </dl>
          ) : (
            <p className="sku-details-card__empty">Дополнительные свойства пока не заполнены.</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function DetailTerm({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatDetailValue(value)}</dd>
    </div>
  );
}

function normalizeProperties(properties: NomenclatureWithDetails['properties']) {
  if (!properties) {
    return [];
  }

  if (Array.isArray(properties)) {
    return properties
      .map((property) => ({ name: property.name?.trim() ?? '', value: property.value }))
      .filter((property) => property.name);
  }

  return Object.entries(properties).map(([name, value]) => ({ name, value }));
}

function formatDetailValue(value: unknown, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${String(value)}${suffix ? ` ${suffix}` : ''}`;
}
