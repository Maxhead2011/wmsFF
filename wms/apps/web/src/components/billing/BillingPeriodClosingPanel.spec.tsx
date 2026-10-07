import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BillingPeriodClosingPanel } from './BillingPeriodClosingPanel';
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effect: undefined as undefined | (() => unknown) }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => unknown) => { hooks.effect = effect; },
  useState: (initial: any) => {
    const i = hooks.cursor++;if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (next: any) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: any) => { const i = hooks.cursor++;if (!(i in hooks.values)) hooks.values[i] = { current: initial };return hooks.values[i]; },
}));
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
const props: any = { session: { accessToken: 'fixture', user: { permissionCodes: ['billing:read', 'billing:write'], activeWarehouseId: 'w' } }, clientId: 'c', periodFrom: '2026-09-01', periodTo: '2026-09-30', onChanged: vi.fn() };
function render(overrides: any = {}) { hooks.cursor = 0;return BillingPeriodClosingPanel({ ...props, ...overrides }); }
function find(label: string) { return elements(render()).find(e => e.props?.['aria-label'] === label); }
beforeEach(() => { hooks.values = [];hooks.cursor = 0;vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());
// TEST: disabled rollout and read-only users cannot reach mutation controls.
it('hides the disabled rollout and exposes only history to read-only users', () => {
  expect(render()).toBeNull();hooks.values[0] = true;
  const nodes = elements(render({ session: { ...props.session, user: { ...props.session.user, permissionCodes: ['billing:read'] } } }));
  expect(nodes.some(e => e.type === 'button')).toBe(false);
  expect(nodes.some(e => e.type === 'h4' && e.props.children === 'История исправлений')).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
// TEST: signed money is submitted exactly; changing it invalidates the financial preview.
it('previews a reduction and invalidates it after editing the amount', async () => {
  render();hooks.values[0] = true;
  find('Счёт для исправления').props.onChange({ target: { value: 'i' } });
  find('Изменение суммы').props.onChange({ target: { value: '-25.50' } });
  find('Причина исправления').props.onChange({ target: { value: '  Ошибочная услуга  ' } });
  const response = { invoiceId: 'i', invoiceNumber: 'INV', amountRub: -25.5, kind: 'ADJUSTMENT', reason: 'Ошибочная услуга', previewHash: 'hash', after: { effectiveTotalRub: 74.5, remainingRub: 29.5, overpaymentRub: 0 } };
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => response } as Response);
  const button = elements(render()).find(e => e.type === 'button' && e.props.children === 'Рассчитать исправление');
  button.props.onClick();await vi.waitFor(() => expect(find('Предварительная корректировка')).toBeDefined());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ invoiceId: 'i', amountRub: '-25.50', reason: 'Ошибочная услуга', kind: 'ADJUSTMENT' });
  find('Изменение суммы').props.onChange({ target: { value: '30' } });
  expect(find('Предварительная корректировка')).toBeUndefined();
});
// TEST: unresolved services prevent closing even with an entered reason.
it('disables closure when preview reports unfinished calculations', () => {
  render();hooks.values[0] = true;hooks.values[4] = 'Проверено';
  hooks.values[5] = { canClose: false, previewHash: 'hash', snapshots: [], issues: [{ sourceId: 'x', code: 'WORK', reason: 'Нет начисления' }] };
  const button = elements(render()).find(e => e.type === 'button' && e.props.children === 'Закрыть проверенный период');
  expect(button.props.disabled).toBe(true);expect(fetch).not.toHaveBeenCalled();
});
