// TEST: important warehouse context is extracted from the full nested TSD payload.
import { describe, expect, it } from 'vitest';
import { operationContextEntries, operationPrimaryTitle } from './tsdOperationHistory';

describe('История ТСД', () => {
  it('показывает паллет, короб, товар, ШК и КИЗ из вложенного запроса', () => {
    const payload = {
      request: {
        body: {
          palletCode: 'PALLET_SORT_40',
          boxCode: 'FFL_LKB0109_001',
          productName: 'Костюм серый',
          barcode: '2049156013548',
          kiz: '0104640569959492215eADSBnNJuY_B',
        },
      },
    };

    expect(operationContextEntries(payload)).toEqual(
      expect.arrayContaining([
        ['Паллет', 'PALLET_SORT_40'],
        ['Короб', 'FFL_LKB0109_001'],
        ['Товар', 'Костюм серый'],
        ['ШК', '2049156013548'],
        ['КИЗ', '0104640569959492215eADSBnNJuY_B'],
      ]),
    );
  });

  it('даёт понятное название технической операции', () => {
    expect(operationPrimaryTitle('monitor_error', {})).toBe('Ошибка на ТСД');
    expect(operationPrimaryTitle('receipt_scan', {})).toBe('Приёмка товара');
  });
});
