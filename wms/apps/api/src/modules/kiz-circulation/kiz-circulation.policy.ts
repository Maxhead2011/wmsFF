import { BadRequestException } from '@nestjs/common';
import { KizCirculationOperation, MarketplaceType } from '@prisma/client';

const OFFICIAL_TRUE_API_BASES = new Set([
  'https://markirovka.crpt.ru/api/v3/true-api',
  'https://markirovka.sandbox.crptech.ru/api/v3/true-api',
]);

export function officialTrueApiBase(value: string) {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!OFFICIAL_TRUE_API_BASES.has(normalized)) {
    throw new BadRequestException('Разрешены только официальные адреса промышленного или тестового True API v3.');
  }
  return normalized;
}

// ADDED: True API принимает КИ без кода проверки; исходный полный Data Matrix остаётся в аудите.
export function normalizeCisForTrueApi(value: string) {
  const normalized = value
    .trim()
    .replace(/^\]d2/i, '')
    .replace(/<GS>/gi, '\u001d')
    .replace(/\((01|21)\)/g, '$1');
  const separator = normalized.indexOf('\u001d');
  const cis = separator >= 0 && /^(?:91|92|93)/.test(normalized.slice(separator + 1))
    ? normalized.slice(0, separator)
    : normalized;
  if (cis.length < 18 || cis.length > 74) {
    throw new BadRequestException(
      'Не удалось безопасно получить КИ без криптохвоста. Нужен исходный Data Matrix с разделителем GS.',
    );
  }
  return cis;
}

export function isFinalMarketplaceSale(
  marketplace: MarketplaceType,
  supplierStatus?: string | null,
  marketplaceStatus?: string | null,
) {
  const supplier = (supplierStatus ?? '').trim().toLowerCase();
  const remote = (marketplaceStatus ?? '').trim().toLowerCase();
  if (marketplace === MarketplaceType.WILDBERRIES) return remote === 'sold';
  if (marketplace === MarketplaceType.OZON) return supplier === 'delivered';
  if (marketplace === MarketplaceType.YANDEX_MARKET) return supplier === 'delivered';
  return false;
}

export function buildKizCirculationDocument(input: {
  operation: KizCirculationOperation;
  inn: string;
  kpp?: string | null;
  fiasId?: string | null;
  actionDate: string;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  primaryDocumentCustomName?: string;
  paid?: boolean;
  items: Array<{ cis: string; productCostKopecks?: number | null }>;
}) {
  if (input.operation === KizCirculationOperation.RETIRE) {
    if (input.items.some((item) => !item.productCostKopecks || item.productCostKopecks < 1)) {
      throw new BadRequestException('Для дистанционной продажи укажите цену каждого КИЗ в копейках.');
    }
    return {
      inn: input.inn,
      action: 'DISTANCE',
      action_date: dateOnly(input.actionDate),
      document_type: input.documentType,
      document_number: input.documentNumber,
      document_date: dateOnly(input.documentDate),
      ...(input.documentType === 'OTHER'
        ? { primary_document_custom_name: input.primaryDocumentCustomName }
        : {}),
      ...(input.kpp ? { kpp: input.kpp } : {}),
      ...(input.fiasId ? { fias_id: input.fiasId } : {}),
      products: input.items.map((item) => ({
        cis: item.cis,
        product_cost: item.productCostKopecks!,
      })),
    };
  }

  const paid = Boolean(input.paid);
  return {
    trade_participant_inn: input.inn,
    return_type: 'REMOTE_SALE_RETURN',
    paid,
    ...(paid
      ? {
          primary_document_type: input.documentType,
          primary_document_number: input.documentNumber,
          primary_document_date: dateOnly(input.documentDate),
          ...(input.documentType === 'OTHER'
            ? { primary_document_custom_name: input.primaryDocumentCustomName }
            : {}),
        }
      : {}),
    products_list: input.items.map((item) => ({ ki: item.cis })),
  };
}

function dateOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Укажите корректную дату документа.');
  return date.toISOString().slice(0, 10);
}
