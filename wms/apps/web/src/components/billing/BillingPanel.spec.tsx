import { describe, expect, it, vi } from 'vitest';
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
