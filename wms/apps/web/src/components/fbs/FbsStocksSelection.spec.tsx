import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FbsStocksView } from './FbsPanel';
import { fetchFbsStocks, updateFbsStockPublicationBulk } from '../../lib/api';

// TEST: invoke the real rendered controls and API handler, with deterministic hook state.
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, data: null as any }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: any) {
    const i = h.cursor++;
    if (!(i in h.slots)) {
      const value = typeof initial === 'function' ? initial() : initial;
      h.slots[i] = value?.status === 'loading' && value?.data === null
        ? { status: 'ready', data: h.data, error: '' } : value;
    }
    return [h.slots[i], (v: any) => { h.slots[i] = typeof v === 'function' ? v(h.slots[i]) : v; }];
  },
  useMemo: (fn: () => any) => fn(), useCallback: (fn: any) => fn(),
  useRef: (v: any) => ({ current: v }), useEffect: () => {},
}));
vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  fetchFbsStocks: vi.fn(), updateFbsStockPublicationBulk: vi.fn(),
}));
const session = { accessToken: 'test', user: { permissionCodes: [], roleCodes: ['CLIENT'] } } as any;
function item(id: string, extra = {}) {
  return { skuId: id, name: id, article: id, internalSku: id, status: 'SELLING',
    wmsAvailable: 10, reserved: 0, sellable: 10, wbAmount: 10, saleLimit: null,
    relabeling: { isTarget: false, allocatedToTargets: 0 }, ...extra };
}
function nodes(tree: any, type: string): any[] {
  if (Array.isArray(tree)) return tree.flatMap(n => nodes(n, type));
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree?.props?.children ?? '') : String(tree ?? '');
}
function render(search = '') { h.cursor = 0; return FbsStocksView({ clientId: 'client', session, search }); }
const header = (tree: any) => nodes(nodes(tree, 'thead')[0], 'input')[0];
const globalChoice = (tree: any) => nodes(nodes(tree, 'label').find(n => n.props.className === 'fbs-stocks__select-all'), 'input')[0];
const button = (tree: any, name: string) => nodes(tree, 'button').find(n => text(n).includes(name));
const rowChoices = (tree: any) => nodes(nodes(tree, 'tbody')[0], 'input').filter(n => n.props.type === 'checkbox');
beforeEach(() => {
  h.slots = []; h.cursor = 0;
  h.data = { connected: true, connections: [{ id: 'shop', accountName: 'Магазин' }], selectedConnectionId: 'shop',
    warehouses: [{ id: 'warehouse', name: 'Склад тест' }], selectedWarehouseId: 'warehouse', connectedWarehouseId: 'warehouse',
    summary: { products: 3, enabled: 3, disabled: 0, unmanaged: 0, sellable: 30, differences: 0, excessProducts: 0, shortages: 0 },
    items: [item('MATCH-M'), item('MATCH-L'), item('OTHER')] };
  vi.stubGlobal('React', React); vi.stubGlobal('window', { confirm: vi.fn(() => false) });
  vi.mocked(fetchFbsStocks).mockReset().mockImplementation(async () => h.data);
  vi.mocked(updateFbsStockPublicationBulk).mockReset().mockResolvedValue({ updatedProducts: 2, amount: 0 } as any);
});
afterEach(() => vi.unstubAllGlobals());
it('selects only searched rows; the shop-wide checkbox remains unchecked', () => {
  header(render('MATCH')).props.onChange();
  expect(rowChoices(render()).map(n => n.props.checked)).toEqual([true, true, false]);
  expect(globalChoice(render('MATCH')).props.checked).toBe(false);
  expect(text(render('MATCH'))).toContain('Выбрано: 2');
});
it('selects every filtered page, respects status and includes zero-free found rows', () => {
  h.data.items = [...Array.from({ length: 105 }, (_, i) => item('MATCH-' + i, { sellable: 0, status: 'STOPPED' })), item('MATCH-selling'), item('OTHER', { status: 'STOPPED' })];
  nodes(render('MATCH'), 'select').find(n => n.props.value === 'ALL').props.onChange({ target: { value: 'STOPPED' } });
  header(render('MATCH')).props.onChange();
  expect(text(render('MATCH'))).toContain('Выбрано: 105');
  expect(rowChoices(render('MATCH'))).toHaveLength(100);
  button(render('MATCH'), 'Далее').props.onClick();
  expect(rowChoices(render('MATCH'))).toHaveLength(5);
  expect(rowChoices(render('MATCH')).every(n => n.props.checked)).toBe(true);
});
it('keeps the global positive-free selection independent of search and labels its scope', () => {
  h.data.items.push(item('ZERO', { sellable: 0 }));
  globalChoice(render('MATCH')).props.onChange();
  expect(rowChoices(render()).map(n => n.props.checked)).toEqual([true, true, true, false]);
  expect(text(render('MATCH'))).toContain('Выбрать все товары');
  expect(text(render('MATCH'))).toContain('Скрыто поиском и фильтрами: 1');
  header(render('MATCH')).props.onChange();
  expect(rowChoices(render()).map(n => n.props.checked)).toEqual([false, false, true, false]);
});
it('represents partial selection and disables the header for no matches', () => {
  rowChoices(render('MATCH'))[0].props.onChange();
  const checkbox = header(render('MATCH'));
  expect(checkbox.props['aria-checked']).toBe('mixed');
  const el = { indeterminate: false }; checkbox.ref(el);
  expect(el.indeterminate).toBe(true);
  expect(header(render('ABSENT')).props.disabled).toBe(true);
});
it('cancelling bulk stop sends no request and retains selection', async () => {
  header(render('MATCH')).props.onChange();
  button(render('MATCH'), 'Не продавать выбранные').props.onClick();
  await Promise.resolve();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2'));
  expect(updateFbsStockPublicationBulk).not.toHaveBeenCalled();
  expect(rowChoices(render()).map(n => n.props.checked)).toEqual([true, true, false]);
});
it('confirms the full count including hidden selection, then sends only those IDs', async () => {
  globalChoice(render()).props.onChange();
  vi.mocked(window.confirm).mockReturnValue(true);
  button(render('MATCH'), 'Не продавать выбранные').props.onClick();
  await Promise.resolve(); await Promise.resolve();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/3[\s\S]*Склад тест[\s\S]*1/));
  expect(updateFbsStockPublicationBulk).toHaveBeenCalledWith('test', expect.objectContaining({
    clientId: 'client', connectionId: 'shop', warehouseId: 'warehouse', enabled: false, skuIds: ['MATCH-M', 'MATCH-L', 'OTHER'],
  }));
});
