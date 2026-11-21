import {ConflictException} from '@nestjs/common';
import type {SupplyIntegration} from '../client-requests/ozon-supply-policy';
import type {OzonDirection} from './ozon-fbo-directions';

// FIX: placement-zone checks apply only to ООО «ПАЛИТРА» (CL-000002).
const palitraClientId = 'e8597352-0b93-442c-9582-c694620a9695';

export function assertOzonBoxZones(raw: unknown, name: string | null | undefined, directions: OzonDirection[], packed: string[], added: string, clientId = '') {
  if (clientId !== palitraClientId) return;
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
      throw new ConflictException('Зона размещения Ozon неизвестна. Обновите состав поставки или выберите короб с одним SKU.');
    }
    zones.add(zone);
  }
  if (zones.size > 1) throw new ConflictException('У товаров разные зоны размещения Ozon. Выберите другой короб.');
}
