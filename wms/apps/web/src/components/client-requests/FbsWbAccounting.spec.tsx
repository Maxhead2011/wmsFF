import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FbsWbAccounting, FbsWbAccountingDialog, wbAccountingCommentReady } from './FbsWbAccounting';

describe('WB accounting is distinct from physical completion', () => {
  // TEST: the warehouse shipment decision displays the exact pair and its source.
  it('shows shipped KIZ/barcode evidence and explicitly labels an unknown source', () => {
    const html = renderToStaticMarkup(<FbsWbAccounting busy={false} data={{ enabled: true, candidates: [], accounted: [{
      id: 'task', orderId: '100', productName: 'Suit', wbStatus: 'complete/sorted', shipped: true, kiz: 'KIZ-EXACT', barcode: 'BC-EXACT',
      confirmedAt: null, confirmedByName: 'Manager', comment: 'Verified', sourceBoxCode: null,
    }] }} />);
    expect(html).toContain('Отгружен со склада по WB'); expect(html).toContain('KIZ-EXACT'); expect(html).toContain('BC-EXACT');
    expect(html).toContain('Без короба'); expect(html).not.toContain('<button');
  });
  it('discloses the exact stock write-off before confirmation', () => {
    const html = renderToStaticMarkup(<FbsWbAccountingDialog orderId="100" kiz="KIZ" barcode="BC" busy={false} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(html).toContain('спишет одну единицу'); expect(html).toContain('Подтвердить списание и отгрузку');
    expect(html).toContain('Без короба'); expect(html).not.toContain('не создаёт физическую сборку');
  });
  it('requires warehouse permission for the KIZ shipment button', () => {
    const data = { enabled: true, candidates: [{ id: 'task', orderId: '100', productName: 'Suit', wbStatus: 'complete/sorted', kiz: 'KIZ', barcode: 'BC' }], accounted: [] };
    expect(renderToStaticMarkup(<FbsWbAccounting data={data} busy={false} onAccount={vi.fn()} />)).not.toContain('<button');
    expect(renderToStaticMarkup(<FbsWbAccounting data={data} busy={false} canShip onAccount={vi.fn()} />)).toContain('Подтвердить отгрузку по WB');
  });
  // TEST: confirmed orders retain the manager and date without offering a second action.
  it('shows an audited separate group without a collect/transfer button', () => {
    const html = renderToStaticMarkup(<FbsWbAccounting busy={false} data={{ enabled: true, candidates: [], accounted: [{
      id: 'task', orderId: '5702368259', productName: 'Костюм', wbStatus: 'complete/sorted',
      confirmedByName: 'Менеджер', confirmedAt: '2026-09-12T08:00:00Z', comment: 'Проверен WB',
    }] }} />);
    expect(html).toContain('Учтены по WB'); expect(html).toContain('Менеджер'); expect(html).toContain('Проверен WB');
    expect(html).not.toContain('<button'); expect(html).not.toContain('COMPLETED');
  });
  it('offers a manager action only when enabled and writable', () => {
    const data = { enabled: true, candidates: [{ id: 'task', orderId: '100', productName: 'Suit', wbStatus: 'complete/sorted' }], accounted: [] };
    expect(renderToStaticMarkup(<FbsWbAccounting data={data} busy={false} onAccount={vi.fn()} />)).toContain('Учесть по статусу WB');
    expect(renderToStaticMarkup(<FbsWbAccounting data={data} busy={false} />)).not.toContain('<button');
    expect(renderToStaticMarkup(<FbsWbAccounting data={{ ...data, enabled: false }} busy={false} onAccount={vi.fn()} />)).not.toContain('<button');
    expect(renderToStaticMarkup(<FbsWbAccounting busy={false} />)).toBe('');
  });
  // TEST: opening the dialog does not silently confirm the accounting decision.
  it('requires a comment and explicit confirmation', () => {
    const html = renderToStaticMarkup(<FbsWbAccountingDialog orderId="100" busy={false} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(html).toContain('не создаёт физическую сборку'); expect(html).toContain('name="wbAccountingComment"');
    expect(html).toMatch(/type="submit" disabled=""/);
    expect(wbAccountingCommentReady('  ')).toBe(false); expect(wbAccountingCommentReady('ok')).toBe(false);
    expect(wbAccountingCommentReady(' Проверено ')).toBe(true); expect(wbAccountingCommentReady('x'.repeat(1001))).toBe(false);
  });
});
