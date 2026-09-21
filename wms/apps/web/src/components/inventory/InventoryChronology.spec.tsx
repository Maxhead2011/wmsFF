import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Reconciliation } from './InventoryPanel';

it('orders checks globally by displayed time, regardless of pending decisions or session grouping', () => {
  // TEST: an old unresolved check must not hide a newer resolved check.
  const box = (id: string, startedAt: string, completedAt: string | null, pending = false) => ({
    id, boxCode: id, status: pending ? 'MISMATCH' : 'RESOLVED', startedAt, completedAt,
    countedByName: 'Сборщик', lines: [{ id: `line-${id}`, skuName: 'Товар',
      expectedQuantity: 2, countedQuantity: 1, decision: pending ? 'PENDING' : 'APPLY_ACTUAL' }],
  });
  const historySessions = [
    { id: 'multi', type: 'PARTIAL', boxes: [
      box('OLD-BOX', '2026-09-19T09:00:00Z', '2026-09-19T10:00:00Z', true),
      box('NEW-BOX', '2026-09-18T09:00:00Z', '2026-09-21T12:00:00Z'),
    ] },
    { id: 'single', type: 'BOX_CHECK', boxes: [box('MIDDLE-BOX', '2026-09-21T11:00:00Z', null)] },
  ];
  const before = JSON.stringify(historySessions);
  const html = renderToStaticMarkup(<Reconciliation
    dashboard={{ historySessions, canManage: false } as never}
    session={{ accessToken: 'test' } as never} onChanged={async () => {}} />);
  expect(html.indexOf('NEW-BOX')).toBeLessThan(html.indexOf('MIDDLE-BOX'));
  expect(html.indexOf('MIDDLE-BOX')).toBeLessThan(html.indexOf('OLD-BOX'));
  expect(JSON.stringify(historySessions)).toBe(before);
});
