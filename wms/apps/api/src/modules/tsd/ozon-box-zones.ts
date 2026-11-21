import {ConflictException} from '@nestjs/common';
import type {SupplyIntegration} from '../client-requests/ozon-supply-policy';
import type {OzonDirection} from './ozon-fbo-directions';

// FIX: only these WMS clients permit mixed cartons with missing Ozon metadata.
const allowUnknownZone = new Set([
  '634434d6-0d5a-4f6b-8876-6c8d3252cdff', // ИП Елецкая
  'c401202c-be57-4310-9939-2ea36767da37', // ИП Кубрин
]);
export function assertOzonBoxZones(raw: unknown, name: string | null | undefined, directions: OzonDirection[], packed: string[], added: string, clientId = '') {
  const skus = new Set([...packed, added]);
  if (skus.size < 2) return;
  const link = raw as SupplyIntegration | null;
  const supply = name && link?.supplies?.find(s => s.id === link.mapping?.[name]);
  const direction = directions.find(d => d.name === name);
  const zones = new Set<string>();
  for (const sku of skus) {
    const barcode = direction?.items.find(i => i.skuId === sku)?.barcode;
    const items = supply ? supply.items.filter(i => i.barcode === barcode) : [];
    const zone = items.length === 1 && items[0].placementZone?.trim();
    if (!zone || /UNKNOWN|UNSPECIFIED|^NONE$/i.test(zone)) {
      if (allowUnknownZone.has(clientId)) continue;
      throw new ConflictException('Зона размещения Ozon неизвестна. Обновите состав поставки или выберите короб с одним SKU.');
    }
    zones.add(zone);
  }
  if (zones.size > 1) throw new ConflictException('У товаров разные зоны размещения Ozon. Выберите другой короб.');
}
