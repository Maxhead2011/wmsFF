import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingInvoicesTable } from './BillingInvoicesTable';

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));

function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
const invoice: any = {
  id: 'august', number: 'АВГ-01', clientId: 'client', client: { id: 'client', name: 'Клиент', code: '001' },
  periodFrom: '2026-08-01', periodTo: '2026-08-31', createdAt: '2026-09-01', status: 'DRAFT',
  sourceKey: 'fbs-invoice:1', serviceCategory: 'FBS', totalRub: 100, paidRub: 25, items: [], payments: [],
};

describe('invoice registry', () => {
  beforeEach(() => vi.clearAllMocks());
  // TEST: individual invoices stay accessible without expanding FBS groups.
  it('renders every invoice as a focusable row and opens the exact invoice by click or Enter', () => {
    const onOpen = vi.fn();
    const tree = BillingInvoicesTable({ invoices: [invoice, { ...invoice, id: 'second' }], canWrite: true, onOpen, onStatusChange: vi.fn() });
    const rows = elements(tree).filter(node => node.type === 'tr' && node.props.tabIndex === 0);
    expect(rows).toHaveLength(2);
    rows[0].props.onClick({ target: { closest: () => null } });
    expect(onOpen).toHaveBeenLastCalledWith(invoice);
    const event = { key: 'Enter', preventDefault: vi.fn(), target: {}, currentTarget: {} };
    event.target = event.currentTarget;
    rows[1].props.onKeyDown(event);
    expect(onOpen.mock.calls[1][0].id).toBe('second');
  });
  // TEST: checkboxes/documents/status controls must not also open the invoice.
  it('ignores clicks and key presses originating in independent controls', () => {
    const onOpen = vi.fn();
    const tree = BillingInvoicesTable({ invoices: [invoice], canWrite: true, onOpen, onStatusChange: vi.fn() });
    const row = elements(tree).find(node => node.type === 'tr' && node.props.tabIndex === 0);
    expect(row).toBeDefined();
    row.props.onClick({ target: { closest: () => ({}) } });
    row.props.onKeyDown({ key: 'Enter', target: {}, currentTarget: {}, preventDefault: vi.fn() });
    expect(onOpen).not.toHaveBeenCalled();
  });
  // TEST: warehouse/category/document date are displayed without authorizing writes.
  it('keeps read-only rows openable and renders the server category and branch', () => {
    const tree = BillingInvoicesTable({ invoices: [{ ...invoice, serviceCategory: 'PRR', warehouse: { id: 'noginsk', name: 'Ногинск' } }], canWrite: false, onOpen: vi.fn(), onStatusChange: vi.fn() });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Ногинск');
    expect(html).toContain('ПРР');
    expect(html).toContain('01.09.2026');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Изменить');
  });
  // TEST: merged source documents cannot be changed through the inline controls.
  it('disables source-document actions after merging', () => {
    const tree = BillingInvoicesTable({ invoices: [{ ...invoice, comment: 'Объединено в счёт СЧ-002' }], canWrite: true, onOpen: vi.fn(), onEdit: vi.fn(), onStatusChange: vi.fn() });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Объединён');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Изменить');
  });
});
