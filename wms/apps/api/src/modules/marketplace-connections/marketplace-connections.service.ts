import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MarketplaceType, Prisma, VolumeSource } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { UpsertMarketplaceConnectionDto } from './dto/upsert-marketplace-connection.dto';

type MarketplaceConnectionWithClient = Prisma.ClientMarketplaceConnectionGetPayload<{
  include: { client: { select: { id: true; code: true; name: true } } };
}>;

type MarketplaceProductSyncItem = {
  marketplace: MarketplaceType;
  productId: string;
  offerId: string;
  internalSku: string;
  clientSku?: string;
  article?: string;
  barcode?: string;
  barcodes: string[];
  name: string;
  brand?: string;
  category?: string;
  color?: string;
  size?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  needsChestnyZnak?: boolean;
  payload: Record<string, unknown>;
};

@Injectable()
export class MarketplaceConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async list(clientId: string | undefined, user: AuthUser) {
    const where: Prisma.ClientMarketplaceConnectionWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, clientId),
    };

    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where,
      orderBy: [{ client: { name: 'asc' } }, { marketplace: 'asc' }, { accountName: 'asc' }],
      include: {
        client: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    return connections.map(maskConnection);
  }

  async create(dto: UpsertMarketplaceConnectionDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    try {
      const created = await this.prisma.clientMarketplaceConnection.create({
        data: normalizedData(dto),
        include: {
          client: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });

      return maskConnection(created);
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Такое подключение для клиента уже есть.');
      }
      throw caught;
    }
  }

  async update(id: string, dto: Partial<UpsertMarketplaceConnectionDto>, user: AuthUser) {
    const existing = await this.prisma.clientMarketplaceConnection.findUnique({
      where: { id },
      select: { clientId: true },
    });

    if (!existing) {
      throw new NotFoundException('Подключение маркетплейса не найдено.');
    }
    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
    if (dto.clientId && dto.clientId !== existing.clientId) {
      this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    }

    try {
      const updated = await this.prisma.clientMarketplaceConnection.update({
        where: { id },
        data: normalizedData(dto),
        include: {
          client: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });

      return maskConnection(updated);
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Такое подключение для клиента уже есть.');
      }
      throw caught;
    }
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.clientMarketplaceConnection.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        marketplace: true,
        accountName: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Подключение маркетплейса не найдено.');
    }
    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');

    await this.prisma.clientMarketplaceConnection.delete({ where: { id } });
    return {
      id: existing.id,
      marketplace: existing.marketplace,
      accountName: existing.accountName,
      deleted: true,
    };
  }

  async syncProducts(id: string, user: AuthUser) {
    const connection = await this.prisma.clientMarketplaceConnection.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!connection) {
      throw new NotFoundException('Подключение маркетплейса не найдено.');
    }
    this.clientScopes.requireClientAccess(user, connection.clientId, 'write');

    if (!connection.isActive) {
      throw new BadRequestException('Подключение отключено. Включите его перед синхронизацией товаров.');
    }

    const products = await this.fetchMarketplaceProducts(connection);
    const result = {
      marketplace: connection.marketplace,
      clientId: connection.clientId,
      productsReceived: products.length,
      created: 0,
      updated: 0,
      barcodesTouched: 0,
      skipped: 0,
      errors: [] as Array<{ offerId: string; message: string }>,
    };

    for (const product of products) {
      try {
        const synced = await this.upsertMarketplaceSku(connection.clientId, product);
        result[synced.created ? 'created' : 'updated'] += 1;
        result.barcodesTouched += synced.barcodesTouched;
      } catch (caught) {
        result.skipped += 1;
        result.errors.push({
          offerId: product.offerId,
          message: caught instanceof Error ? caught.message : 'Не удалось сохранить товар.',
        });
      }
    }

    return result;
  }

  private async fetchMarketplaceProducts(connection: MarketplaceConnectionWithClient) {
    if (connection.marketplace === MarketplaceType.WILDBERRIES) {
      return this.fetchWildberriesProducts(connection);
    }

    if (connection.marketplace === MarketplaceType.OZON) {
      return this.fetchOzonProducts(connection);
    }

    throw new BadRequestException('Автоматическая выгрузка товаров сейчас подключена для Wildberries и Ozon.');
  }

  private async fetchWildberriesProducts(connection: MarketplaceConnectionWithClient) {
    const products: MarketplaceProductSyncItem[] = [];
    const maxPages = 1000;
    let cursor: Record<string, unknown> = { limit: 100 };

    for (let page = 0; page < maxPages; page += 1) {
      const response = await marketplaceJson('https://content-api.wildberries.ru/content/v2/get/cards/list', {
        method: 'POST',
        headers: {
          Authorization: connection.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          settings: {
            sort: {
              ascending: true,
            },
            cursor,
            filter: {
              withPhoto: -1,
            },
          },
        }),
      });
      const cards = asArray<Record<string, unknown>>(response.cards);

      for (const card of cards) {
        const sizes = asArray<Record<string, unknown>>(card.sizes);
        const effectiveSizes = sizes.length > 0 ? sizes : [null];
        for (const size of effectiveSizes) {
          products.push(mapWildberriesCard(card, size));
        }
      }

      const nextCursor = asRecord(response.cursor);
      const total = numberValue(nextCursor.total);
      const limit = numberValue(nextCursor.limit) || 100;
      const updatedAt = textValue(nextCursor.updatedAt);
      const nmID = textValue(nextCursor.nmID);
      if (cards.length === 0 || !updatedAt || !nmID || total < limit) {
        break;
      }

      cursor = { limit, updatedAt, nmID: Number(nmID) || nmID };
    }

    return products;
  }

  private async fetchOzonProducts(connection: MarketplaceConnectionWithClient) {
    if (!connection.sellerId) {
      throw new BadRequestException('Для Ozon заполните ID продавца / Client-Id.');
    }

    const headers = {
      'Client-Id': connection.sellerId,
      'Api-Key': connection.apiKey,
      'Content-Type': 'application/json',
    };
    const listed: Array<{ product_id?: number | string; offer_id?: string }> = [];
    let lastId = '';

    for (let page = 0; page < 100; page += 1) {
      const response = await marketplaceJson('https://api-seller.ozon.ru/v3/product/list', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            visibility: 'ALL',
          },
          last_id: lastId,
          limit: 100,
        }),
      });
      const result = asRecord(response.result);
      const items = asArray<{ product_id?: number | string; offer_id?: string }>(result.items);
      listed.push(...items);
      const nextLastId = textValue(result.last_id);
      if (items.length === 0 || !nextLastId || nextLastId === lastId) {
        break;
      }
      lastId = nextLastId;
    }

    const products: MarketplaceProductSyncItem[] = [];
    for (const chunk of chunks(listed, 100)) {
      const productIds = chunk.map((item) => item.product_id).filter((id): id is string | number => id != null);
      const detailsById = await this.fetchOzonProductDetails(headers, productIds);
      const attributesById = await this.fetchOzonProductAttributes(headers, productIds);

      for (const item of chunk) {
        const productId = String(item.product_id ?? item.offer_id ?? '');
        if (!productId) {
          continue;
        }

        products.push(mapOzonProduct(item, detailsById.get(productId), attributesById.get(productId)));
      }
    }

    return products;
  }

  private async fetchOzonProductDetails(headers: Record<string, string>, productIds: Array<string | number>) {
    if (productIds.length === 0) {
      return new Map<string, Record<string, unknown>>();
    }

    const response = await marketplaceJson('https://api-seller.ozon.ru/v3/product/info/list', {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_id: productIds }),
    });
    const items = asArray<Record<string, unknown>>(asRecord(response.result).items);
    return new Map(items.map((item) => [textValue(item.id) || textValue(item.product_id), item]));
  }

  private async fetchOzonProductAttributes(headers: Record<string, string>, productIds: Array<string | number>) {
    if (productIds.length === 0) {
      return new Map<string, Record<string, unknown>>();
    }

    try {
      const response = await marketplaceJson('https://api-seller.ozon.ru/v4/product/info/attributes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            product_id: productIds,
            visibility: 'ALL',
          },
          limit: productIds.length,
        }),
      });
      const items = asArray<Record<string, unknown>>(asRecord(response.result).items);
      return new Map(items.map((item) => [textValue(item.id) || textValue(item.product_id), item]));
    } catch {
      return new Map<string, Record<string, unknown>>();
    }
  }

  private async upsertMarketplaceSku(clientId: string, product: MarketplaceProductSyncItem) {
    const existing =
      (await this.prisma.sku.findFirst({
        where: {
          clientId,
          marketplace: product.marketplace,
          marketplaceProductId: product.productId,
        },
      })) ??
      (await this.prisma.sku.findFirst({
        where: {
          clientId,
          marketplace: product.marketplace,
          marketplaceOfferId: product.offerId,
        },
      })) ??
      (product.barcode
        ? (
            await this.prisma.barcode.findFirst({
              where: { value: product.barcode, sku: { clientId } },
              include: { sku: true },
            })
          )?.sku
        : null) ??
      (await this.prisma.sku.findUnique({
        where: {
          clientId_internalSku: {
            clientId,
            internalSku: product.internalSku,
          },
        },
      }));

    const preserveManualVolume =
      existing?.volumeSource === VolumeSource.MANUAL && Number(existing.volumeLiters) > 0;
    const data = marketplaceSkuData(clientId, product, preserveManualVolume);
    const sku = existing
      ? await this.prisma.sku.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.sku.create({
          data,
        });

    let barcodesTouched = 0;
    for (const barcode of product.barcodes) {
      await this.prisma.barcode.upsert({
        where: {
          skuId_value: {
            skuId: sku.id,
            value: barcode,
          },
        },
        update: { isPrimary: barcode === product.barcode },
        create: {
          skuId: sku.id,
          value: barcode,
          isPrimary: barcode === product.barcode,
        },
      });
      barcodesTouched += 1;
    }

    return { created: !existing, barcodesTouched };
  }
}

function normalizedData(dto: Partial<UpsertMarketplaceConnectionDto>): Prisma.ClientMarketplaceConnectionUncheckedCreateInput {
  return {
    ...(dto.clientId === undefined ? {} : { clientId: dto.clientId }),
    ...(dto.marketplace === undefined ? {} : { marketplace: dto.marketplace }),
    ...(dto.accountName === undefined ? {} : { accountName: normalizeNullable(dto.accountName) }),
    ...(dto.sellerId === undefined ? {} : { sellerId: normalizeNullable(dto.sellerId) }),
    ...(dto.apiKey === undefined ? {} : { apiKey: dto.apiKey.trim() }),
    ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    ...(dto.comment === undefined ? {} : { comment: normalizeNullable(dto.comment) }),
  } as Prisma.ClientMarketplaceConnectionUncheckedCreateInput;
}

function maskConnection(connection: {
  id: string;
  clientId: string;
  marketplace: string;
  accountName: string | null;
  sellerId: string | null;
  apiKey: string;
  isActive: boolean;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  client: { id: string; code: string; name: string };
}) {
  return {
    id: connection.id,
    clientId: connection.clientId,
    marketplace: connection.marketplace,
    accountName: connection.accountName,
    sellerId: connection.sellerId,
    apiKeyMask: maskApiKey(connection.apiKey),
    hasApiKey: Boolean(connection.apiKey),
    isActive: connection.isActive,
    comment: connection.comment,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    client: connection.client,
  };
}

function maskApiKey(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return '********';
  }
  return `${'*'.repeat(8)}${trimmed.slice(-4)}`;
}

function normalizeNullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isUniqueError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const normalized = textValue(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return ['1', 'true', 'yes', 'y', 'да'].includes(normalized);
}

async function marketplaceJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      textValue(payload.message) ||
      textValue(payload.error) ||
      textValue(payload.detail) ||
      `Маркетплейс вернул HTTP ${response.status}.`;
    throw new BadRequestException(message);
  }

  return payload;
}

function mapWildberriesCard(card: Record<string, unknown>, size: Record<string, unknown> | null): MarketplaceProductSyncItem {
  const nmID = textValue(card.nmID);
  const vendorCode = textValue(card.vendorCode);
  const chrtID = textValue(size?.chrtID);
  const sizeName = [textValue(size?.techSize), textValue(size?.wbSize)].filter(Boolean).join(' / ');
  const barcodes = uniqueStrings(asArray<unknown>(size?.skus).map(textValue));
  const dimensions = asRecord(card.dimensions);
  const characteristics = asArray<Record<string, unknown>>(card.characteristics);
  const needKiz = toBoolean(card.needKiz) || toBoolean(card.kizMarked);
  const color = characteristicValue(characteristics, ['цвет', 'color']);
  const productId = [nmID || vendorCode, chrtID].filter(Boolean).join(':') || vendorCode || cryptoSafeId(card);
  const offerId = barcodes[0] || chrtID || vendorCode || productId;

  return {
    marketplace: MarketplaceType.WILDBERRIES,
    productId,
    offerId,
    internalSku: safeSku([vendorCode || `WB-${productId}`, sizeName].filter(Boolean).join('-')),
    clientSku: vendorCode || undefined,
    article: vendorCode || undefined,
    barcode: barcodes[0],
    barcodes,
    name: textValue(card.title) || textValue(card.object) || vendorCode || `WB ${productId}`,
    brand: textValue(card.brand) || undefined,
    category: textValue(card.subjectName) || textValue(card.object) || undefined,
    color: color || undefined,
    size: sizeName || undefined,
    weightGrams: kgToGrams(numberValue(dimensions.weightBrutto)),
    lengthCm: positiveNumber(dimensions.length),
    widthCm: positiveNumber(dimensions.width),
    heightCm: positiveNumber(dimensions.height),
    needsChestnyZnak:
      needKiz ||
      toBoolean(card.needKiz) ||
      toBoolean(card.kizMarked) ||
      (Boolean(textValue(card.imtID)) && hasCharacteristic(characteristics, ['киз', 'честный знак', 'маркировка'])),
    payload: {
      marketplace: 'WILDBERRIES',
      card,
      size,
      characteristics,
      dimensions,
    },
  };
}

function mapOzonProduct(
  item: { product_id?: number | string; offer_id?: string },
  detail: Record<string, unknown> | undefined,
  attributes: Record<string, unknown> | undefined,
): MarketplaceProductSyncItem {
  const source: Record<string, unknown> = { ...item, ...(detail ?? {}) };
  const productId = textValue(source.id) || textValue(source.product_id) || textValue(item.product_id) || textValue(item.offer_id);
  const offerId = textValue(source.offer_id) || textValue(item.offer_id) || productId;
  const barcodes = uniqueStrings([
    textValue(source.barcode),
    ...asArray<unknown>(source.barcodes).map(textValue),
    ...asArray<unknown>(source.sku_barcodes).map(textValue),
  ]);
  const attrs = asArray<Record<string, unknown>>(attributes?.attributes);
  const dimensions = extractOzonDimensions(source, attributes);

  return {
    marketplace: MarketplaceType.OZON,
    productId,
    offerId,
    internalSku: safeSku(offerId || `OZON-${productId}`),
    clientSku: offerId || undefined,
    article: offerId || undefined,
    barcode: barcodes[0],
    barcodes,
    name: textValue(source.name) || textValue(attributes?.name) || offerId || `Ozon ${productId}`,
    brand: textValue(source.brand) || attributeValue(attrs, ['бренд', 'brand']) || undefined,
    category: textValue(source.category_name) || textValue(attributes?.type_name) || textValue(attributes?.description_category_id) || undefined,
    color: attributeValue(attrs, ['цвет', 'color']) || undefined,
    size: attributeValue(attrs, ['размер', 'size']) || undefined,
    weightGrams: dimensions.weightGrams,
    lengthCm: dimensions.lengthCm,
    widthCm: dimensions.widthCm,
    heightCm: dimensions.heightCm,
    needsChestnyZnak: hasAttribute(attrs, ['честный знак', 'маркировка', 'киз']),
    payload: {
      marketplace: 'OZON',
      listItem: item,
      detail,
      attributes,
    },
  };
}

function marketplaceSkuData(
  clientId: string,
  product: MarketplaceProductSyncItem,
  preserveManualVolume = false,
): Prisma.SkuUncheckedCreateInput {
  const volumeLiters = calculateVolumeLiters(product);

  return {
    clientId,
    internalSku: product.internalSku,
    clientSku: product.clientSku,
    article: product.article,
    name: product.name,
    brand: product.brand,
    category: product.category,
    color: product.color,
    size: product.size,
    weightGrams: product.weightGrams,
    lengthCm: product.lengthCm,
    widthCm: product.widthCm,
    heightCm: product.heightCm,
    ...(!preserveManualVolume && volumeLiters ? { volumeLiters, volumeSource: 'CALCULATED' } : {}),
    needsChestnyZnak: product.needsChestnyZnak ?? false,
    marketplace: product.marketplace,
    marketplaceProductId: product.productId,
    marketplaceOfferId: product.offerId,
    marketplacePayload: cleanJson(product.payload),
    marketplaceSyncedAt: new Date(),
  };
}

function extractOzonDimensions(source: Record<string, unknown>, attributes?: Record<string, unknown>) {
  const unit = textValue(source.dimension_unit).toLowerCase();
  const weightUnit = textValue(source.weight_unit).toLowerCase();
  const depth = positiveNumber(source.depth) ?? positiveNumber(source.length);
  const width = positiveNumber(source.width);
  const height = positiveNumber(source.height);
  const weight = positiveNumber(source.weight);

  return {
    lengthCm: convertLengthToCm(depth, unit),
    widthCm: convertLengthToCm(width, unit),
    heightCm: convertLengthToCm(height, unit),
    weightGrams:
      convertWeightToGrams(weight, weightUnit) ??
      convertWeightToGrams(positiveNumber(attributes?.weight), textValue(attributes?.weight_unit).toLowerCase()),
  };
}

function convertLengthToCm(value: number | undefined, unit: string) {
  if (!value) {
    return undefined;
  }
  if (unit === 'mm') {
    return round(value / 10, 2);
  }
  if (unit === 'm') {
    return round(value * 100, 2);
  }
  return round(value, 2);
}

function convertWeightToGrams(value: number | undefined, unit: string) {
  if (!value) {
    return undefined;
  }
  if (unit === 'kg' || unit === 'кг') {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

function kgToGrams(value: number | undefined) {
  return value ? Math.round(value * 1000) : undefined;
}

function calculateVolumeLiters(product: Pick<MarketplaceProductSyncItem, 'lengthCm' | 'widthCm' | 'heightCm'>) {
  if (!product.lengthCm || !product.widthCm || !product.heightCm) {
    return undefined;
  }

  return round((product.lengthCm * product.widthCm * product.heightCm) / 1000, 3);
}

function characteristicValue(characteristics: Array<Record<string, unknown>>, names: string[]) {
  return attributeValue(characteristics, names);
}

function attributeValue(attributes: Array<Record<string, unknown>>, names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  const attribute = attributes.find((item) => {
    const name = [textValue(item.name), textValue(item.charcName), textValue(item.attribute_name)].join(' ').toLowerCase();
    return normalizedNames.some((needle) => name.includes(needle));
  });
  if (!attribute) {
    return '';
  }

  const values = asArray<unknown>(attribute.values)
    .map((value) => (typeof value === 'object' && value !== null ? textValue((value as Record<string, unknown>).value) : textValue(value)))
    .filter(Boolean);
  return values.join(', ') || textValue(attribute.value);
}

function hasCharacteristic(characteristics: Array<Record<string, unknown>>, names: string[]) {
  return Boolean(characteristicValue(characteristics, names));
}

function hasAttribute(attributes: Array<Record<string, unknown>>, names: string[]) {
  return Boolean(attributeValue(attributes, names));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function textValue(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function numberValue(value: unknown) {
  if (value == null || value === '') {
    return 0;
  }
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed > 0 ? parsed : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeSku(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 100 ? normalized : `${normalized.slice(0, 83)}-${cryptoSafeId(normalized)}`;
}

function cryptoSafeId(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanJson(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
