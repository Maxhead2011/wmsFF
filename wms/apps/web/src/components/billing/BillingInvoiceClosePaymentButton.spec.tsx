import { beforeEach, expect, it, vi } from 'vitest';
import { BillingInvoiceClosePaymentButton } from './BillingInvoiceClosePaymentButton';
import { updateBillingInvoiceStatus } from '../../lib/api';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: any) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = initial; return [hooks.values[n], (value: any) => { hooks.values[n] = value; }]; },
  useRef: (initial: any) => { const n = hooks.cursor++; return hooks.values[n] ?? (hooks.values[n] = { current: initial }); },
}));
vi.mock('../../lib/api', () => ({ updateBillingInvoiceStatus: vi.fn() }));
const onPaid = vi.fn();
function render() { hooks.cursor = 0; return BillingInvoiceClosePaymentButton({ invoiceId: 'invoice', session: { accessToken: 'test' } as any, onPaid }); }
function nodes(node: any): any[] { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function button() { return nodes(render()).find(node => node.type === 'button'); }
beforeEach(() => { hooks.values = []; vi.clearAllMocks(); });

// TEST: full payment uses a status confirmation, with the authoritative remaining amount calculated by the server.
it('confirms full payment and refreshes the invoice and its payment history', async () => {
  const updated = { id: 'invoice', status: 'PAID', payments: [{ amountRub: '100535.37' }] };
  vi.mocked(updateBillingInvoiceStatus).mockResolvedValue(updated as any);
  await button().props.onClick();
  expect(updateBillingInvoiceStatus).toHaveBeenCalledWith('test', 'invoice', { status: 'PAID' });
  expect(onPaid).toHaveBeenCalledWith(updated);
});

// TEST: rapid clicks before the first rerender cannot submit two confirmations.
it('disables and ignores repeat clicks while the receipt is being recorded', async () => {
  let finish!: (value: any) => void;
  vi.mocked(updateBillingInvoiceStatus).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const action = button().props.onClick;
  const first = action();
  await action();
  expect(button().props.disabled).toBe(true);
  expect(updateBillingInvoiceStatus).toHaveBeenCalledTimes(1);
  finish({ id: 'invoice', status: 'PAID' });
  await first;
  expect(button().props.disabled).toBe(false);
});

// TEST: a failed receipt remains visible and can be retried without falsely closing the invoice.
it('shows failures and allows retry without reporting a successful payment', async () => {
  vi.mocked(updateBillingInvoiceStatus).mockRejectedValueOnce(new Error('Сервер недоступен'));
  await button().props.onClick();
  expect(onPaid).not.toHaveBeenCalled();
  expect(nodes(render()).find(node => node.props?.role === 'alert').props.children).toBe('Сервер недоступен');
  vi.mocked(updateBillingInvoiceStatus).mockResolvedValue({ id: 'invoice' } as any);
  await button().props.onClick();
  expect(onPaid).toHaveBeenCalledTimes(1);
});
