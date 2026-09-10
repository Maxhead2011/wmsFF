import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FbsPanel } from './FbsPanel';
import { deliverFbsSupplies, fetchFbsSupplyDeliveryOptions } from '../../lib/api';

// TEST: exercise the panel's actual callbacks and request payload with the project's hook harness.
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => {}, useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
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
  useRememberedClientId: () => ['client', vi.fn()],
}));
vi.mock('../../lib/api', async () => ({
  ...await vi.importActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchFbsSupplyDeliveryOptions: vi.fn(), deliverFbsSupplies: vi.fn(),
}));
const orders = [{ connectionId: 'cabinet', id: 'order', supplyId: 'WB-GI-1' }] as any;
const options = {
  supplies: [{ connectionId: 'cabinet', supplyId: 'WB-GI-1', orderCount: 1, itemCount: 2, destinationOfficeId: '123', destinationOfficeName: 'Склад WB' }],
  offices: [{ id: '123', name: 'Склад WB', city: 'Москва', compatible: true }, { id: '456', name: 'Другой склад', city: '', compatible: false }],
  requiredDestinationOfficeId: '123', earliestWbDeliveryDate: null, defaultPlannedDeliveryDate: '2026-09-12', blockers: [] as string[],
};
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
}
function render() {
  hooks.cursor = 0;
  return FbsPanel({ session: { accessToken: 'token', user: { id: 'user', clientIds: ['client'], permissionCodes: [], roleCodes: [] } } as any });
}
function deliveryDialog() { return elements(render()).find(node => node.props?.state?.options?.supplies); }
function dialogControls() { const dialog = deliveryDialog(); return elements(dialog.type(dialog.props)); }
function deliveryButton() { return dialogControls().find(node => node.type === 'button' && node.props.className.includes('button-primary')); }
async function openDialog() { await elements(render()).find(node => typeof node.props?.onDeliver === 'function').props.onDeliver(orders); }

describe('FBS supply delivery confirmation', () => {
  // TEST: the verified live UI has no repeat-assembly feature; billing must not introduce it.
  it('keeps unrelated repeat-assembly UI outside the billing release', () => {
    const panel = readFileSync(new URL('./FbsPanel.tsx', import.meta.url), 'utf8');
    expect(panel.includes('FbsRepeatAssemblyPanel')).toBe(false);
  });
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    hooks.values = ['WILDBERRIES']; hooks.cursor = 0; vi.clearAllMocks();
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    vi.mocked(fetchFbsSupplyDeliveryOptions).mockResolvedValue(options);
    vi.mocked(deliverFbsSupplies).mockResolvedValue({ delivered: 1, failed: [], orders: null } as any);
  });
  it('loads destinations first and sends the selected destination/date only after confirmation', async () => {
    await openDialog();
    expect(fetchFbsSupplyDeliveryOptions).toHaveBeenCalledWith('token', { clientId: 'client', orders: [{ connectionId: 'cabinet', id: 'order' }] });
    expect(deliverFbsSupplies).not.toHaveBeenCalled();
    expect(deliveryButton().props.disabled).toBe(false);
    dialogControls().find(node => node.type === 'input' && node.props.type === 'date').props.onChange({ target: { value: '2026-09-15' } });
    await deliveryDialog().props.onSubmit();
    expect(deliverFbsSupplies).toHaveBeenCalledWith('token', { clientId: 'client', orders: [{ connectionId: 'cabinet', id: 'order' }], destinationOfficeId: '123', plannedDeliveryDate: '2026-09-15' });
    expect(deliveryDialog()).toBeUndefined();
  });
  it('cancels without sending a delivery request', async () => {
    await openDialog(); deliveryDialog().props.onCancel();
    expect(deliveryDialog()).toBeUndefined(); expect(deliverFbsSupplies).not.toHaveBeenCalled();
  });
  it('blocks incompatible offices and empty or invalid dates in both button and handler', async () => {
    await openDialog();
    expect(dialogControls().find(node => node.type === 'option' && node.props.value === '456').props.disabled).toBe(true);
    for (const [office, date] of [['456', '2026-09-15'], ['123', ''], ['123', '2026-02-30']]) {
      deliveryDialog().props.onOfficeChange(office); deliveryDialog().props.onDateChange(date);
      expect(deliveryButton().props.disabled).toBe(true);
      await deliveryDialog().props.onSubmit();
      expect(deliverFbsSupplies).not.toHaveBeenCalled();
    }
  });
  it('does not submit when delivery-options reports blockers', async () => {
    vi.mocked(fetchFbsSupplyDeliveryOptions).mockResolvedValue({ ...options, blockers: ['Поставки относятся к разным складам.'] });
    await openDialog(); expect(deliveryButton().props.disabled).toBe(true);
    await deliveryDialog().props.onSubmit(); expect(deliverFbsSupplies).not.toHaveBeenCalled();
  });
  it('shows options failures without delivering', async () => {
    vi.mocked(fetchFbsSupplyDeliveryOptions).mockRejectedValue(new Error('Не удалось загрузить склады'));
    await openDialog(); expect(deliveryDialog()).toBeUndefined(); expect(deliverFbsSupplies).not.toHaveBeenCalled();
    expect(elements(render()).find(node => node.props?.onDeliver).props.actionError).toBe('Не удалось загрузить склады');
  });
  it('preserves selection and shows server errors for a retry', async () => {
    await openDialog(); vi.mocked(deliverFbsSupplies).mockRejectedValue(new Error('Состав поставки изменился'));
    await deliveryDialog().props.onSubmit();
    expect(deliveryDialog().props.state.error).toBe('Состав поставки изменился');
    expect(deliveryDialog().props.state.destinationOfficeId).toBe('123');
    expect(deliveryButton().props.disabled).toBe(false);
  });
  it('guards same-tick double confirmation while the request is pending', async () => {
    await openDialog();
    let resolve!: (value: any) => void;
    vi.mocked(deliverFbsSupplies).mockReturnValue(new Promise(done => { resolve = done; }));
    const dialog = deliveryDialog(); const first = dialog.props.onSubmit(); await dialog.props.onSubmit();
    expect(deliverFbsSupplies).toHaveBeenCalledTimes(1); expect(deliveryButton().props.disabled).toBe(true);
    resolve({ delivered: 1, failed: [], orders: null }); await first;
    expect(deliveryDialog()).toBeUndefined();
  });
});
