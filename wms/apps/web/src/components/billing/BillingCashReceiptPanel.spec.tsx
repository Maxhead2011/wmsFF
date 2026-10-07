import { describe, expect, it, vi } from 'vitest';
import { BillingCashReceiptPanel } from './BillingCashReceiptPanel';
import { createIncomingPayment } from '../../lib/api';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useMemo:(fn:()=>unknown)=>fn(),useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(next:any)=>{hooks.values[i]=typeof next==='function'?next(hooks.values[i]):next}];}}));
vi.mock('../../lib/rememberedClient',()=>({useRememberedClientId:()=>['c',vi.fn()]}));
vi.mock('../../lib/api',async()=>({...await vi.importActual<typeof import('../../lib/api')>('../../lib/api'),createIncomingPayment:vi.fn().mockResolvedValue({totalRub:450000,invoices:[]})}));
function elements(node:any):any[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(elements);return [node,...elements(node.props?.children)]}
const invoice:any={id:'i',number:'INV-202609-0007',clientId:'c',status:'ISSUED',totalRub:550535.37,paidRub:0,periodFrom:'2026-09-01',periodTo:'2026-09-30',payments:[]};
const clients:any=[{id:'c',name:'Клиент'}],session:any={accessToken:'fixture',user:{id:'u'}};
describe('incoming payment amount and history',()=>{
  // TEST: pending/failed invoice loading must never allow a payment from stale allocations.
  it('shows loading and retry and blocks submitting a previously balanced receipt',async()=>{
    hooks.values=[];hooks.cursor=0;vi.clearAllMocks();
    let state:any={};const retry=vi.fn();
    const render=()=>{hooks.cursor=0;return BillingCashReceiptPanel({clients,session,invoices:[invoice],onPaid:vi.fn(),...state})};
    elements(render()).find(n=>n.type==='input'&&n.props.placeholder==='0,00').props.onChange({target:{value:'450000'}});
    elements(render()).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange();
    state={loading:true};let nodes=elements(render());
    expect(nodes.find(n=>n.props?.role==='status')).toBeDefined();
    expect(nodes.find(n=>n.type==='button'&&n.props.type==='submit').props.disabled).toBe(true);
    await nodes.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    expect(createIncomingPayment).not.toHaveBeenCalled();
    state={loadError:'Сервер не ответил',onRetry:retry};nodes=elements(render());
    expect(nodes.find(n=>n.props?.role==='alert').props.children).toBe('Сервер не ответил');
    nodes.find(n=>n.type==='button'&&n.props.children==='Повторить загрузку').props.onClick();
    expect(retry).toHaveBeenCalledOnce();
    await nodes.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    expect(createIncomingPayment).not.toHaveBeenCalled();
  });
  // TEST: selecting a 550535.37 invoice must send the entered 450000, not silently replace it with the debt.
  it('preserves a partial receipt through invoice selection, deselection and submit',async()=>{
    hooks.values=[];hooks.cursor=0;vi.clearAllMocks();
    const render=()=>{hooks.cursor=0;return BillingCashReceiptPanel({clients,session,invoices:[invoice],onPaid:vi.fn()})};
    const amount=()=>elements(render()).find(n=>n.type==='input'&&n.props.placeholder==='0,00');
    const checkbox=()=>elements(render()).find(n=>n.type==='input'&&n.props.type==='checkbox');
    amount().props.onChange({target:{value:'450000'}});checkbox().props.onChange();
    expect(amount().props.value).toBe('450000');
    expect(elements(render()).find(n=>n.type==='input'&&n.props['aria-label']===`Сумма оплаты счета ${invoice.number}`).props.value).toBe('450000.00');
    checkbox().props.onChange();expect(amount().props.value).toBe('450000');
    checkbox().props.onChange();await elements(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    expect(createIncomingPayment).toHaveBeenCalledWith('fixture',expect.objectContaining({totalRub:450000,allocations:[{invoiceId:'i',amountRub:450000}]}));
  });
  // TEST: a fully paid invoice disappears from allocation candidates but its recorded receipt remains visible.
  it('shows payment history for paid invoices including cancelled originals',()=>{
    hooks.values=[];hooks.cursor=0;
    const paid={...invoice,status:'PAID',paidRub:550535.37,payments:[{id:'old',amountRub:550535.37,status:'CANCELLED',paidAt:'2026-10-03'},{id:'new',amountRub:450000,status:'RECORDED',paidAt:'2026-10-03'}]};
    const nodes=elements(BillingCashReceiptPanel({clients,session,invoices:[paid],onPaid:vi.fn()}));
    const history=nodes.find(n=>n.type==='section'&&n.props['aria-label']==='История поступлений');
    expect(history).toBeDefined();expect(elements(history).filter(n=>n.type==='tr')).toHaveLength(3);
    expect(nodes.filter(n=>n.type==='input'&&n.props.type==='checkbox')).toHaveLength(0);
  });
});
