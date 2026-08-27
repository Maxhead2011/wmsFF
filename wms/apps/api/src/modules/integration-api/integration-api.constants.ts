// ADDED: public scopes are deliberately small and additive; credentials never inherit WMS user rights.
export const WMS_INTEGRATION_SCOPES = [
  'catalog:read',
  'stock:read',
  'stock:write',
  'requests:read',
  'movements:read',
] as const;

export type WmsIntegrationScope = (typeof WMS_INTEGRATION_SCOPES)[number];

export const WMS_INTEGRATION_SCOPE_LABELS: Record<WmsIntegrationScope, string> = {
  'catalog:read': 'Чтение справочника товаров',
  'stock:read': 'Чтение остатков',
  'stock:write': 'Корректировка фактического остатка',
  'requests:read': 'Чтение заявок',
  'movements:read': 'Чтение движений товара',
};

export const WMS_API_KEY_HEADER = 'x-wms-api-key';
export const WMS_API_KEY_PREFIX = 'wms_live_';
