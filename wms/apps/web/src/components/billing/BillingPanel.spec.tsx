import { describe, expect, it, vi } from 'vitest';
// TEST: amended balances affect payment eligibility; the original amount remains visible and immutable.
it('uses effective totals and protects issued snapshots when corrections are enabled', () => {
  const invoice: any = { status: 'ISSUED', totalRub: 100, paidRub: 45, effectiveTotalRub: 50, comment: '', issuedAt: '2026-09-01' };
  expect(billingInvoiceCardPermissions(invoice, true)).toEqual({ canEdit: false, canPay: true, remainingRub: 5 });
  expect(billingInvoiceCardPermissions({ ...invoice, paidRub: 55 }, true)).toEqual({ canEdit: false, canPay: false, remainingRub: 0 });
});
import { BillingPanel, filterBillingRegisterInvoices, billingInvoiceCardPermissions } from './BillingPanel';
import { BillingPeriodGenerationDialog } from './BillingPeriodGenerationDialog';
import { BillingCashReceiptPanel } from './BillingCashReceiptPanel';
import { BillingInvoicesTable } from './BillingInvoicesTable';
import { fetchBillingInvoices } from '../../lib/api';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => {}, useMemo: (factory: () => unknown) => factory(),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) {
      const value = typeof initial === 'function' ? initial() : initial;
      hooks.values[index] = value?.status === 'idle' && Array.isArray(value?.data) ? { status: 'ready', data: [] } : value;
    }
    return [hooks.values[index], (next: any) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
  useRef: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
}));
vi.mock('../../lib/rememberedClient', async () => ({
  ...await vi.importActual<typeof import('../../lib/rememberedClient')>('../../lib/rememberedClient'),
  useRememberedClientId: () => ['', vi.fn()],
}));
vi.mock('../../lib/api', async () => ({
  ...await vi.importActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchBillingInvoices: vi.fn().mockResolvedValue([]), fetchBillingCharges: vi.fn().mockResolvedValue([]),
  fetchBillingServices: vi.fn().mockResolvedValue([]), fetchClients: vi.fn().mockResolvedValue([]),
  fetchClientRequests: vi.fn().mockResolvedValue([]), fetchBillingReconciliation: vi.fn().mockResolvedValue({}),
}));
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

const invoice: any = {
  id: 'august', clientId: 'lukin', client: { id: 'lukin' }, periodFrom: '2026-08-01', periodTo: '2026-08-31',
  status: 'ISSUED', serviceCategory: 'STORAGE', totalRub: 100, paidRub: 25, payments: [], items: [], comment: '',
};
describe('billing register filters and invoice card', () => {
  // TEST: a pending or failed invoice request must never turn our receipt tab into a blank screen.
  it('keeps the own-WMS receipt form visible during loading and exposes retry after failure', () => {
    hooks.values = []; hooks.cursor = 0;
    vi.stubGlobal('window', { location: { hostname: 'wms.logoff.pro' } });
    try {
      const render = () => { hooks.cursor = 0; return BillingPanel({ session: { accessToken: 'token', user: { id: 'u', permissionCodes: ['billing:read', 'billing:write'] } } as any }); };
      render();
      elements(render()).find(n => n.type === 'button' && n.props.children === 'Приход ДС').props.onClick();
      hooks.values[1] = { status: 'loading', data: [] };
      let receipt = elements(render()).find(n => n.type === BillingCashReceiptPanel);
      expect(receipt).toBeDefined();expect(receipt.props.loading).toBe(true);
      hooks.values[1] = { status: 'error', data: [], error: 'Сервер не ответил' };
      receipt = elements(render()).find(n => n.type === BillingCashReceiptPanel);
      expect(receipt).toBeDefined();expect(receipt.props.loadError).toBe('Сервер не ответил');expect(receipt.props.onRetry).toBeTypeOf('function');
    } finally { vi.unstubAllGlobals(); }
  });
  // TEST: the sold environment keeps its original receipt loading path.
  it('preserves the legacy readiness gate outside our WMS', () => {
    hooks.values = []; hooks.cursor = 0;
    vi.stubGlobal('window', { location: { hostname: 'sold.example.invalid' } });
    try {
      const render = () => { hooks.cursor = 0; return BillingPanel({ session: { accessToken: 'token', user: { id: 'u', permissionCodes: ['billing:read', 'billing:write'] } } as any }); };
      elements(render()).find(n => n.type === 'button' && n.props.children === 'Приход ДС').props.onClick();
      hooks.values[1] = { status: 'loading', data: [] };
      expect(elements(render()).find(n => n.type === BillingCashReceiptPanel)).toBeUndefined();
      hooks.values[1] = { status: 'ready', data: [] };
      const receipt = elements(render()).find(n => n.type === BillingCashReceiptPanel);
      expect(receipt.props.loading).toBe(false); expect(receipt.props.onRetry).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });
  // TEST: status remains available on topics and survives returning to the invoice list.
  it('filters every invoice status from topics and preserves the choice in the list', () => {
    hooks.values = []; hooks.cursor = 0;
    const render = () => { hooks.cursor = 0; return BillingPanel({ session: { accessToken: 'token', user: { id: 'user', permissionCodes: ['billing:read'] } } as any }); };
    const rows = ['DRAFT', 'ISSUED', 'PAID', 'CANCELLED'].map(status => ({ ...invoice, id: status, status }));
    render(); hooks.values[2] = { status: 'ready', data: rows };
    elements(render()).find(node => node.type === 'button' && node.props.children === 'Весь период').props.onClick();
    elements(render()).find(node => node.type === 'button' && elements(node.props.children).some(child => child.type === 'span' && child.props.children === 'Темы счетов')).props.onClick();
    const statusSelect = () => {
      const label = elements(render()).find(node => node.type === 'label' && elements(node.props.children).some(child => child.type === 'span' && child.props.children === 'Статус счёта'));
      expect(label).toBeDefined();
      return elements(label).find(node => node.type === 'select');
    };
    expect(elements(statusSelect()).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['', 'DRAFT', 'ISSUED', 'PAID', 'CANCELLED']);
    statusSelect().props.onChange({ target: { value: 'PAID' } });
    const allTile = elements(render()).find(node => node.type === 'button' && node.props.className?.includes('kind-tile--all'));
    expect(elements(allTile).find(node => node.type === 'b').props.children).toBe(1);
    allTile.props.onClick();
    expect(statusSelect().props.value).toBe('PAID');
    for (const status of ['DRAFT', 'ISSUED', 'PAID', 'CANCELLED', '']) {
      statusSelect().props.onChange({ target: { value: status } });
      expect(elements(render()).find(node => node.type === BillingInvoicesTable).props.invoices.map((row: any) => row.id)).toEqual(status ? [status] : rows.map(row => row.id));
    }
  });
  // TEST: recovered mixed invoices use the server's FBS label without losing period/client/status filters.
  it('includes mixed recovered FBS invoices once in the FBS register', () => {
    const recovery = { ...invoice, id: 'recovery', status: 'DRAFT', serviceCategory: 'FBS',
      sourceKey: 'fbs-invoice:lukin:completed-work:hash', periodFrom: '2026-09-04', periodTo: '2026-09-04',
      items: [{ description: 'Обработка FBS' }, { description: 'Первичная обработка' }, { description: 'Дополнительные услуги' }] };
    const rows = [recovery, { ...recovery, id: 'other', serviceCategory: 'OTHER' },
      { ...recovery, id: 'different-client', clientId: 'other', client: { id: 'other' } },
      { ...recovery, id: 'issued', status: 'ISSUED' },
      { ...recovery, id: 'outside-period', periodFrom: '2026-08-31', periodTo: '2026-08-31' }];
    const result = filterBillingRegisterInvoices(rows, { clientId: 'lukin', from: '2026-09-01', to: '2026-09-14', category: 'FBS', status: 'DRAFT' });
    expect(result.map(row => row.id)).toEqual(['recovery']);
    expect(result[0]).toBe(recovery);
  });
  // TEST: bulk incoming payments must update the independent registry and request a refresh.
  it('shows the paid state in the registry after a bulk incoming payment', async () => {
    hooks.values = []; hooks.cursor = 0; vi.clearAllMocks();
    const render = () => { hooks.cursor = 0; return BillingPanel({ session: { accessToken: 'token', user: { id: 'user', permissionCodes: ['billing:read', 'billing:write'] } } as any }); };
    render();
    // The first load states are charges, overview invoices and registry invoices.
    hooks.values[1] = { status: 'ready', data: [invoice] };
    hooks.values[2] = { status: 'ready', data: [invoice] };
    const previousRevision = hooks.values[3];
    elements(render()).find(node => node.type === 'button' && node.props.children === 'Весь период').props.onClick();
    elements(render()).find(node => node.type === 'button' && node.props.children === 'Приход ДС').props.onClick();
    const receipt = elements(render()).find(node => node.type === BillingCashReceiptPanel);
    const paid = { ...invoice, status: 'PAID', paidRub: 100 };
    receipt.props.onPaid([paid]);
    expect(elements(render()).find(node => node.type === BillingCashReceiptPanel).props.invoices).toEqual([paid]);
    elements(render()).find(node => node.type === 'button' && node.props.children === 'Счета').props.onClick();
    const table = elements(render()).find(node => node.type === BillingInvoicesTable);
    expect(table.props.invoices).toEqual([paid]);
    expect(hooks.values[3]).toBe(previousRevision + 1);
    await Promise.resolve();
  });
  // TEST: refresh must not hide the result of generation for a different selected month.
  it('keeps the result dialog open after successful generation and refreshes invoices', async () => {
    hooks.values = []; hooks.cursor = 0; vi.clearAllMocks();
    const render = () => { hooks.cursor = 0; return BillingPanel({ session: { accessToken: 'token', user: { id: 'user', permissionCodes: ['billing:read', 'billing:write'] } } as any }); };
    const trigger = elements(render()).find(node => node.type === 'button' && node.props.children === 'Сформировать за период');
    expect(trigger.props.disabled).toBe(false);
    trigger.props.onClick();
    const dialog = elements(render()).find(node => node.type === BillingPeriodGenerationDialog);
    expect(dialog).toBeDefined();
    dialog.props.onCreated();
    expect(elements(render()).some(node => node.type === BillingPeriodGenerationDialog)).toBe(true);
    expect(fetchBillingInvoices).toHaveBeenCalledWith('token');
    await Promise.resolve();
  });
  // TEST: period/category/status/client all apply; Lukin remains in the general registry.
  it('combines filters without globally excluding clients', () => {
    const all = [invoice, { ...invoice, id: 'september', periodFrom: '2026-09-01', periodTo: '2026-09-30' }, { ...invoice, id: 'fbs', serviceCategory: 'FBS' }];
    expect(filterBillingRegisterInvoices(all, { clientId: 'lukin', from: '2026-08-01', to: '2026-08-31', category: 'STORAGE', status: 'ISSUED' }).map(row => row.id)).toEqual(['august']);
    expect(filterBillingRegisterInvoices(all, { clientId: 'different' })).toEqual([]);
  });
  // TEST: filter service dates independently of the invoice creation date.
  it('includes overlap boundaries and excludes mismatching statuses or unclassified services', () => {
    const overlap = { ...invoice, periodFrom: '2026-07-31', periodTo: '2026-08-01', createdAt: '2026-09-10' };
    expect(filterBillingRegisterInvoices([overlap], { from: '2026-08-01', to: '2026-08-31' })).toEqual([overlap]);
    expect(filterBillingRegisterInvoices([invoice], { status: 'PAID' })).toEqual([]);
    expect(filterBillingRegisterInvoices([{ ...invoice, serviceCategory: undefined }], { category: 'PRR' })).toEqual([]);
  });
  // TEST: a newly recorded partial/full payment immediately changes remaining debt and actions.
  it('allows permitted edits/payments and blocks paid, merged, cancelled or read-only changes', () => {
    expect(billingInvoiceCardPermissions(invoice, true)).toEqual({ canEdit: true, canPay: true, remainingRub: 75 });
    expect(billingInvoiceCardPermissions({ ...invoice, paidRub: 60 }, true).remainingRub).toBe(40);
    expect(billingInvoiceCardPermissions({ ...invoice, status: 'PAID', paidRub: 100 }, true)).toEqual({ canEdit: false, canPay: false, remainingRub: 0 });
    expect(billingInvoiceCardPermissions(invoice, false)).toEqual({ canEdit: false, canPay: false, remainingRub: 75 });
    for (const patch of [{ status: 'CANCELLED' }, { comment: 'Объединено в счёт СЧ-002' }, { comment: 'Объединено в FBS-счёт СЧ-003' }]) {
      const result = billingInvoiceCardPermissions({ ...invoice, ...patch }, true);
      expect(result.canEdit).toBe(false);
      expect(result.canPay).toBe(false);
    }
  });
});
