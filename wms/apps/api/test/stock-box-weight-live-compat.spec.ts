import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { validateBoxWeight } from '../src/modules/stock/stock-operations.service';

describe('box weight live compatibility', () => {
  // TEST: SKU-derived weight remains advisory whether or not confirmation was supplied.
  it.each([false, true])('warns for calculated overweight with confirmation=%s', (confirmed) => {
    expect(validateBoxWeight('BOX-1', {}, [{ quantity: 26, skuWeightGrams: 1000 }], confirmed)).toEqual({
      calculatedWeightGrams: 26000,
      warnings: [{ code: 'BOX_CALCULATED_WEIGHT_OVER_LIMIT', limitGrams: 25000,
        message: 'Расчетный вес короба BOX-1 превышает 25 кг; закрытие разрешено с предупреждением.' }],
    });
  });

  // TEST: preserving advisory calculation must not weaken the measured-weight check.
  it('still rejects unconfirmed measured overweight and records explicit confirmation', () => {
    expect(() => validateBoxWeight('BOX-1', { weightGrams: 26000 }, [])).toThrow(BadRequestException);
    expect(validateBoxWeight('BOX-1', { weightGrams: 26000 }, [], true)).toMatchObject({
      measuredWeightGrams: 26000, warnings: [{ code: 'BOX_WEIGHT_OVER_LIMIT_CONFIRMED' }],
    });
  });

  it('accepts the exact 25 kg boundary and prioritizes supplied measured weight', () => {
    expect(validateBoxWeight('BOX-1', {}, [{ quantity: 25, skuWeightGrams: 1000 }])).toEqual({ calculatedWeightGrams: 25000 });
    expect(validateBoxWeight('BOX-1', { weightGrams: 25000 }, [{ quantity: 26, skuWeightGrams: 1000 }])).toBeUndefined();
  });

  it('retains missing-SKU-weight diagnostics and pallet exemption', () => {
    expect(validateBoxWeight('BOX-1', {}, [{ quantity: 2, skuWeightGrams: null }])).toMatchObject({
      warnings: [{ code: 'SKU_WEIGHT_MISSING', missingUnits: 2 }],
    });
    expect(validateBoxWeight('PALLET-1', { packageType: 'PALLET', weightGrams: 26000 }, [])).toBeUndefined();
  });
});
