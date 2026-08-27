import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const nullableString: SchemaObject = { type: 'string', nullable: true };

function paged(itemProperties: Record<string, SchemaObject>): SchemaObject {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: { type: 'array', items: { type: 'object', properties: itemProperties } },
      meta: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          limit: { type: 'integer' },
          nextAfterId: nullableString,
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  };
}

// ADDED: explicit response schemas keep the downloadable OpenAPI useful outside the WMS frontend.
export const integrationProfileSchema: SchemaObject = {
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        keyPrefix: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        client: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' } } },
        warehouse: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, city: { type: 'string' } } },
      },
    },
  },
};

export const integrationCatalogSchema = paged({
  id: { type: 'string', format: 'uuid' },
  internalSku: { type: 'string' },
  clientSku: nullableString,
  article: nullableString,
  name: { type: 'string' },
  brand: nullableString,
  category: nullableString,
  color: nullableString,
  size: nullableString,
  weightGrams: { type: 'integer', nullable: true },
  lengthCm: { type: 'string', nullable: true },
  widthCm: { type: 'string', nullable: true },
  heightCm: { type: 'string', nullable: true },
  volumeLiters: { type: 'string', nullable: true },
  needsChestnyZnak: { type: 'boolean' },
  isUnmarked: { type: 'boolean' },
  barcodes: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, isPrimary: { type: 'boolean' } } } },
  updatedAt: { type: 'string', format: 'date-time' },
});

export const integrationStocksSchema = paged({
  id: { type: 'string', format: 'uuid' },
  skuId: { type: 'string', format: 'uuid' },
  boxId: nullableString,
  palletId: nullableString,
  status: { type: 'string' },
  quantity: { type: 'integer' },
  sku: {
    type: 'object',
    properties: {
      internalSku: { type: 'string' },
      clientSku: nullableString,
      article: nullableString,
      name: { type: 'string' },
      barcodes: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, isPrimary: { type: 'boolean' } } } },
    },
  },
  box: { type: 'object', nullable: true, properties: { code: { type: 'string' } } },
  pallet: { type: 'object', nullable: true, properties: { code: { type: 'string' } } },
  updatedAt: { type: 'string', format: 'date-time' },
});

export const integrationRequestsSchema = paged({
  id: { type: 'string', format: 'uuid' },
  number: { type: 'integer' },
  type: { type: 'string' },
  status: { type: 'string' },
  priority: { type: 'string' },
  title: { type: 'string' },
  comment: nullableString,
  desiredDate: { type: 'string', format: 'date-time', nullable: true },
  items: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        skuId: nullableString,
        barcode: nullableString,
        name: nullableString,
        quantity: { type: 'integer' },
        comment: nullableString,
      },
    },
  },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
});

export const integrationMovementsSchema = paged({
  id: { type: 'string', format: 'uuid' },
  skuId: { type: 'string', format: 'uuid' },
  boxId: nullableString,
  palletId: nullableString,
  type: { type: 'string' },
  status: { type: 'string' },
  quantity: { type: 'integer' },
  sourceDocument: nullableString,
  idempotencyKey: nullableString,
  comment: nullableString,
  createdAt: { type: 'string', format: 'date-time' },
  sku: { type: 'object', properties: { internalSku: { type: 'string' }, article: nullableString, name: { type: 'string' } } },
  box: { type: 'object', nullable: true, properties: { code: { type: 'string' } } },
});

export const integrationAdjustmentSchema: SchemaObject = {
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        idempotencyKey: { type: 'string' },
        status: { type: 'string', enum: ['APPLIED', 'ALREADY_APPLIED', 'NO_CHANGE'] },
        skuId: { type: 'string', format: 'uuid' },
        // FIX: для бескоробного остатка API возвращает null.
        box: { type: 'string', nullable: true },
        previousQuantity: { type: 'integer' },
        countedQuantity: { type: 'integer' },
        delta: { type: 'integer' },
      },
    },
  },
};
