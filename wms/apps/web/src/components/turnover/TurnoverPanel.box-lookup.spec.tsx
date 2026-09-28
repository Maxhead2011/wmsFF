import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnoverPanel } from './TurnoverPanel';
import { fetchTurnoverBoxDetails, fetchTurnoverReport, fetchTurnoverStatistics } from '../../lib/api';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as Array<() => unknown>, ref:{current:0} }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (fn: () => unknown) => { hooks.effects.push(fn); },
  useRef: () => hooks.ref,
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
}));
vi.mock('../../lib/rememberedClient', () => ({useRememberedClientId: () => ['selected-client', vi.fn()], validRememberedClientId: () => true}));
vi.mock('../../lib/api', async () => ({...await vi.importActual('../../lib/api'),fetchTurnoverBoxDetails:vi.fn(),fetchTurnoverReport:vi.fn(),fetchTurnoverStatistics:vi.fn()}));
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
  hooks.values[2] = {status:'ready',data:{items:[{skuId:'sku',client:{id:'product-client',name:'Клиент товара'},name:'Товар',internalSku:'A',primaryBarcode:'2051754386153',barcodes:[],kiz:[],movements:[],currentQuantity:(Array.isArray(cell) ? cell : [cell]).reduce((sum, row) => sum + (row.quantity ?? 0), 0),currentCells:Array.isArray(cell) ? cell : [cell]}]}};
  return TurnoverPanel({session:{accessToken:'token',user:{id:'user',roleCodes:[],permissionCodes:[]}} as any});
}
describe('turnover location lookup', () => {
  beforeEach(() => { hooks.values=[]; hooks.effects=[];hooks.ref.current=0; vi.clearAllMocks();vi.mocked(fetchTurnoverBoxDetails).mockRejectedValue(new Error('not found')); });
  // TEST: selecting a client must not load all movement histories before a barcode can be searched.
  it('does not start an unfiltered report on client selection', () => {
    render({boxId:null,boxCode:'Без короба',quantity:1});
    hooks.effects[1]();
    expect(fetchTurnoverReport).not.toHaveBeenCalled();
  });
  // TEST: a late response cannot replace the result of a newer search.
  it('ignores an older report response and allows searching while loading', async () => {
    hooks.values[0]='movement';
    let oldResolve!: (value:any)=>void;
    vi.mocked(fetchTurnoverReport).mockImplementationOnce(()=>new Promise(resolve=>{oldResolve=resolve;}))
      .mockResolvedValueOnce({items:[],totals:{skuCount:2}} as any);
    vi.mocked(fetchTurnoverStatistics).mockResolvedValue(null as any);
    const make=()=>{hooks.cursor=0;return TurnoverPanel({session:{accessToken:'token',user:{id:'u',roleCodes:[],permissionCodes:[]}} as any});};
    const button=(tree:any)=>elements(tree).find(n=>n.type==='button'&&n.props.className==='primary-button');
    button(make()).props.onClick();
    expect(button(make()).props.disabled).toBe(false);
    button(make()).props.onClick();
    await new Promise(resolve=>setTimeout(resolve,0));
    oldResolve({items:[],totals:{skuCount:1}});
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(hooks.values[2].data.totals.skuCount).toBe(2);
  });
  // TEST: a slow or failed statistics response cannot delay or discard ready stock rows.
  it.each(['pending', 'failed'])('shows stock while statistics is %s', async mode => {
    vi.mocked(fetchTurnoverReport).mockResolvedValue({ items: [], totals: {} } as any);
    vi.mocked(fetchTurnoverStatistics).mockImplementation(() => mode === 'pending'
      ? new Promise(() => {}) : Promise.reject(new Error('statistics timeout')));
    hooks.cursor = 0;
    hooks.values[0] = 'movement';
    const tree = TurnoverPanel({ session: { accessToken: 'token', user: {
      id: 'user', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'],
    } } as any });
    elements(tree).find(n => n.type === 'button' && n.props.className === 'primary-button').props.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(hooks.values[2].status).toBe('ready');
    expect(hooks.values[3].status).toBe(mode === 'pending' ? 'loading' : 'error');
  });
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

// TEST: hide zero-balance history without changing stock rows or positive packing locations.
describe('current location balances', () => {
  beforeEach(() => { hooks.values=[]; hooks.effects=[]; hooks.ref.current=0; vi.clearAllMocks(); });
  it('shows only boxes 363 and 364 for the six remaining units', () => {
    const cells = [
      {boxId:'363',boxCode:'FFL_LKB0909_363',status:'AVAILABLE',quantity:1},
      {boxId:'364',boxCode:'FFL_LKB0909_364',status:'AVAILABLE',quantity:5},
      {boxId:'275',boxCode:'FFL_LKB0909_275',status:'AVAILABLE',quantity:0},
      {boxId:'fbo',boxCode:'FBO-PICK-history',status:'PACKING',quantity:0},
      {boxId:null,boxCode:'boxless-zero',status:'PACKING',quantity:0},
    ];
    const before=structuredClone(cells);
    const locations=elements(render(cells)).find(n=>n.props?.className==='turnover-quick-tool__locations');
    expect(elements(locations).filter(n=>n.type==='button')).toHaveLength(2);
    expect(text(locations)).toContain('FFL_LKB0909_363');
    expect(text(locations)).toContain('FFL_LKB0909_364');
    expect(hooks.values[2].data.items[0].currentCells).toEqual(before);
    expect(hooks.values[2].data.items[0].currentQuantity).toBe(6);
  });
  it('shows the empty message when all locations are zero', () => {
    const locations=elements(render([{boxId:'empty',boxCode:'EMPTY',status:'AVAILABLE',quantity:0}])).find(n=>n.props?.className==='turnover-quick-tool__locations');
    expect(elements(locations).filter(n=>n.type==='button')).toHaveLength(0);
    expect(elements(locations).some(n=>n.props?.className==='turnover-quick-tool__empty')).toBe(true);
  });
  it('keeps positive packing and boxless stock visible', () => {
    const locations=elements(render([{boxId:'fbo',boxCode:'FBO-PICK-current',status:'PACKING',quantity:2},{boxId:null,boxCode:'boxless-positive',status:'PACKING',quantity:1}])).find(n=>n.props?.className==='turnover-quick-tool__locations');
    expect(elements(locations).filter(n=>n.type==='button')).toHaveLength(2);
  });
});
