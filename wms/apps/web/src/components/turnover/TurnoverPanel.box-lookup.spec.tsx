import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnoverPanel } from './TurnoverPanel';
import { fetchTurnoverBoxDetails } from '../../lib/api';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => undefined,
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
}));
vi.mock('../../lib/rememberedClient', () => ({useRememberedClientId: () => ['selected-client', vi.fn()], validRememberedClientId: () => true}));
vi.mock('../../lib/api', async () => ({...await vi.importActual('../../lib/api'),fetchTurnoverBoxDetails:vi.fn()}));
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function text(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
}
function render(cell: any) {
  hooks.cursor = 0;
  hooks.values[0] = 'lookup';
  hooks.values[1] = {status:'ready',data:[{id:'selected-client',name:'Выбранный клиент'}]};
  hooks.values[2] = {status:'ready',data:{items:[{skuId:'sku',client:{id:'product-client',name:'Клиент товара'},name:'Товар',internalSku:'A',primaryBarcode:'2051754386153',barcodes:[],kiz:[],movements:[],currentQuantity:5,currentCells:[cell]}]}};
  return TurnoverPanel({session:{accessToken:'token',user:{id:'user',roleCodes:[],permissionCodes:[]}} as any});
}
describe('turnover location lookup', () => {
  beforeEach(() => { hooks.values=[]; vi.clearAllMocks();vi.mocked(fetchTurnoverBoxDetails).mockRejectedValue(new Error('not found')); });
  // TEST: a virtual location cannot open an unrelated physical box with the same label.
  it('does not search a physical box for a boxless balance', async () => {
    const tree=render({boxId:null,boxCode:'Без короба',status:'PACKING',quantity:5});
    const button=elements(tree).find(n=>n.type==='button' && text(n).startsWith('Без короба'));
    expect(button?.props.disabled).toBe(true);
    await button.props.onClick?.();
    expect(fetchTurnoverBoxDetails).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Товар не привязан к коробу');
  });
  // TEST: barcode search can return another allowed client; use the product owner.
  it('opens a real location only within its product client', async () => {
    const tree=render({boxId:'box',boxCode:'FFL_001',status:'AVAILABLE',quantity:5});
    await elements(tree).find(n=>n.type==='button' && text(n).startsWith('FFL_001')).props.onClick();
    expect(fetchTurnoverBoxDetails).toHaveBeenCalledWith('token','FFL_001',{clientId:'product-client'});
  });
});
