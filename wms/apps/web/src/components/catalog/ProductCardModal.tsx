import { ImageOff, X } from 'lucide-react';
import type { SkuDetail, SkuSummary } from '../../lib/api';
import './catalog.css';

type ProductCardModalProps = {
  sku: SkuDetail;
  onClose: () => void;
};

export function ProductCardModal({ sku, onClose }: ProductCardModalProps) {
  return (
    <div className="catalog-modal-backdrop" role="presentation">
      <section className="catalog-modal" aria-label="Карточка товара" role="dialog" aria-modal="true">
        <header className="catalog-modal__header">
          <div>
            <span>{sku.client ? `${sku.client.code} · ${sku.client.name}` : 'Карточка товара'}</span>
            <h3>{sku.name}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть карточку">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="catalog-modal__body">
          <aside className="catalog-modal__media">
            <ProductPhoto sku={sku} large />
            <div className="catalog-photo-strip">
              {sku.marketplacePhotos.map((photo, index) => (
                <img alt={`${sku.name} ${index + 1}`} key={photo} src={photo} loading={index < 4 ? 'eager' : 'lazy'} />
              ))}
              {sku.marketplacePhotos.length === 0 ? <span>Фото из API пока нет</span> : null}
            </div>
          </aside>

          <div className="catalog-readonly-card">
            <dl className="catalog-readonly-facts">
              <Fact label="Внутренний SKU" value={sku.internalSku} />
              <Fact label="SKU клиента" value={sku.clientSku} />
              <Fact label="Артикул" value={sku.article} />
              <Fact label="Штрихкод" value={primaryBarcode(sku)} />
              <Fact label="Бренд" value={sku.brand} />
              <Fact label="Категория" value={sku.category} />
              <Fact label="Цвет" value={sku.color} />
              <Fact label="Размер" value={sku.size} />
              <Fact label="Габариты" value={formatDimensions(sku)} />
              <Fact label="Вес" value={formatNumber(sku.weightGrams, 'г')} />
              <Fact label="Литраж" value={formatNumber(sku.volumeLiters, 'л')} />
              <Fact label="Маркетплейс" value={sku.marketplace ?? 'WMS'} />
            </dl>

            <section className="catalog-detail-section">
              <h4>Признаки</h4>
              <p className="catalog-muted">{skuFlags(sku).join(', ') || 'Без специальных признаков'}</p>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProductPhoto({ large = false, sku }: { large?: boolean; sku: SkuSummary }) {
  const photo = sku.marketplacePhotos[0];
  if (!photo) {
    return (
      <span className={large ? 'catalog-photo catalog-photo--large catalog-photo--empty' : 'catalog-photo catalog-photo--empty'}>
        <ImageOff size={large ? 30 : 18} aria-hidden="true" />
      </span>
    );
  }

  return <img className={large ? 'catalog-photo catalog-photo--large' : 'catalog-photo'} alt={sku.name} src={photo} loading={large ? 'eager' : 'lazy'} />;
}

function Fact({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? '-' : String(value)}</dd>
    </div>
  );
}

function primaryBarcode(sku: SkuSummary) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}

function formatDimensions(sku: SkuSummary) {
  if (!sku.lengthCm || !sku.widthCm || !sku.heightCm) {
    return '-';
  }

  return `${sku.lengthCm} x ${sku.widthCm} x ${sku.heightCm} см`;
}

function formatNumber(value: string | number | null, suffix: string) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${value} ${suffix}`;
}

function skuFlags(sku: SkuSummary) {
  return [
    sku.needsChestnyZnak ? 'ЧЗ' : '',
    sku.isUnmarked ? 'без маркировки' : '',
    sku.needsLabel ? 'этикетка' : '',
    sku.needsRelabel ? 'перемаркировка' : '',
  ].filter(Boolean);
}
