import { describe, it, expect } from 'vitest';
import { correctedInvoiceBalance } from './billing-correction-balance';
// TEST: signed corrections change receivables without manufacturing or rewriting receipts.
describe('correction balances', () => {
  it('supports increases and reductions with exact cents', () => {
    expect(correctedInvoiceBalance('550535.37', '450000', ['-100000', '20000'])).toEqual({ originalTotalRub: 550535.37,
      correctionRub: -80000, effectiveTotalRub: 470535.37, remainingRub: 20535.37, overpaymentRub: 0 });
    expect(correctedInvoiceBalance('0.30', '0', ['-0.10', '-0.20']).remainingRub).toBe(0);
  });
  it('shows a credit after reducing a paid invoice and reopens debt after increasing it', () => {
    expect(correctedInvoiceBalance(100, 100, [-25])).toMatchObject({ remainingRub: 0, overpaymentRub: 25 });
    expect(correctedInvoiceBalance(100, 100, [25])).toMatchObject({ remainingRub: 25, overpaymentRub: 0 });
  });
  it('rejects a negative final amount and fractional kopecks', () => {
    expect(() => correctedInvoiceBalance(100, 0, [-101])).toThrow(/отрицательной/);
    expect(() => correctedInvoiceBalance(100, 0, ['0.001'])).toThrow(/копейки/);
  });
});
