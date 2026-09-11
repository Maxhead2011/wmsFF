import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FbsManagerDecisionDialog, managerDecisionReady, needsFbsReturnScans } from './FbsManagerDecisionDialog';

describe('manager decision preserves the physical pick', () => {
  // TEST: both the single-item and bulk handlers use this gate instead of blocking manager acknowledgement.
  it.each([1, 2])('does not require receipt scans for manager decisions on %s picked units', count => {
    const rows = Array.from({ length: count }, () => ({ requiresReturnReceipt: true }));
    expect(needsFbsReturnScans('MANAGER_CONFIRMED', rows)).toBe(false);
    expect(needsFbsReturnScans('RETURN_TO_STOCK', rows)).toBe(true);
  });
  it('keeps the old return flow for unpicked/sold-WMS rows', () => {
    expect(needsFbsReturnScans('RETURN_TO_STOCK', [{ requiresReturnReceipt: false }])).toBe(false);
  });
  // TEST: the UI must not infer an applied label from a generated sticker or select an outcome silently.
  it('offers two explicit outcomes, a required comment and no preselected outcome', () => {
    const html = renderToStaticMarkup(createElement(FbsManagerDecisionDialog, { orderCount: 2, busy: false, onSubmit: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain('Этикетка WB уже наклеена'); expect(html).toContain('товар отложен');
    expect(html).toContain('отдельными группами'); expect(html).toContain('не восстановит доступный остаток');
    expect(html).not.toContain('checked=""'); expect(html).toContain('name="managerComment"');
    expect(html).toMatch(/type="submit" disabled=""/);
  });
  it.each([
    ['', 'Решение', false], ['SHIP_WITH_WB_LABEL', ' ', false], ['AWAIT_RETURN_RECEIPT', '', false],
    ['SHIP_WITH_WB_LABEL', 'Наклеено', true], ['AWAIT_RETURN_RECEIPT', 'Отложено', true], ['unknown', 'Решение', false],
  ])('validates disposition %s and the comment', (disposition, comment, ready) => {
    expect(managerDecisionReady(disposition, comment)).toBe(ready);
  });
});
