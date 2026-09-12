import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClientRequestsTable } from './ClientRequestsTable';

// TEST: render the real request table; SKU cancellation is distinct from generic outbound cancellation.
function table(status='IN_WORK', extra: Record<string, unknown>={}) {
  const props: any = { items:[{id:'collection',number:42,type:'SKU_COLLECTION',status,title:'Сборка по SKU',priority:'NORMAL',createdAt:'2026-09-12T08:00:00Z',
    client:{id:'client',name:'Client',code:'C'},items:[],packages:[],files:[]}],
    canChangeStatus:true,canPickOutbound:false,canCancelRequests:false,canEditAnyRequest:false,canRefreshPickInstruction:false,
    onStatusChange:vi.fn(),onCancelRequest:vi.fn(),onEditRequest:vi.fn(),onPickOutbound:vi.fn(),onPackageOutbound:vi.fn(),onShipOutbound:vi.fn(),
    onCancelSkuCollection:vi.fn(),...extra };
  return renderToStaticMarkup(<ClientRequestsTable {...props}/>);
}
describe('SKU task removal button',()=>{
  it.each(['APPROVED','IN_WORK','PACKED'])('shows removal for active task %s with stock capability',status=>{
    expect(table(status)).toContain('Снять задачу');expect(table(status)).toContain('Действия');
    expect(table(status)).not.toContain('title="Отменить заявку"');
  });
  it.each(['DONE','CANCELLED','REJECTED'])('does not offer removal for %s history',status=>{
    expect(table(status)).not.toContain('Снять задачу');
  });
  it('keeps sold/read-only interface unchanged without the server capability',()=>{
    expect(table('IN_WORK',{onCancelSkuCollection:undefined,canCancelRequests:true})).not.toContain('Снять задачу');
  });
  it('disables repeat clicks during the operation',()=>{
    const html=table('IN_WORK',{cancellingSkuCollectionId:'collection'});
    expect(html).toContain('Снимаю…');expect(html).toMatch(/disabled=""[^>]*>.*Снимаю…/s);
  });
});
