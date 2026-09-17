import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WbPrintCheckResults, printStatus } from './WbPrintCheckPanel';
import { ServiceCenterPanel } from './ServiceCenterPanel';
import type { WbPrintCheckReport } from '../../lib/api';
const row = {id:'a',clientId:'c',clientName:'Лукин',requestNumber:1065,warehouseName:'ФФ Москва',productName:'Костюм',kiz:'kiz',wbMetaStatus:'ACCEPTED',scans:[],prints:[],labelRequests:[]} as unknown as WbPrintCheckReport['results'][number];
const render = (r= row) => renderToStaticMarkup(<WbPrintCheckResults report={{orderId:'5786259714',checkedAt:'2026-09-17T15:05:00Z',results:[r]}}/>);
describe('WB print report',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  // TEST: the service entry appears only on opted-in installations.
  it.each([true,false])('gates the service tab with rollout=%s',enabled=>{
    vi.stubEnv('VITE_WB_PRINT_CHECK_ENABLED',String(enabled));
    const html=renderToStaticMarkup(<ServiceCenterPanel session={{accessToken:'test',user:{id:'u'}} as never}/>);
    expect(html.includes('Проверка печати WB')).toBe(enabled);
  });
  // TEST: historical "printedAt" alone never claims that a physical print completed.
  it('does not call a generated label a confirmed print',()=>{
    const html=render({...row,labelRequests:[{at:'2026-09-17T15:04:38Z',worker:'Соня',kiz:'kiz',stickerCode:'WB',hasPrintJob:false}]});
    expect(html).toContain('Подтверждения печати от агента нет');expect(html).toContain('18:04:38');
    expect(html).not.toContain('Печать подтверждена агентом');
  });
  it('shows confirmed SOS WB2 printing in Moscow time with the operator and printer',()=>{
    const html=render({...row,prints:[{id:'j',status:'PRINTED',kiz:'kiz',deviceCode:'SOS-WB:123',requestedBy:'Соня',createdAt:'2026-09-17T15:04:38Z',printedAt:'2026-09-17T15:04:40Z',attempts:1,station:{name:'17.09',printerName:'TSC TE200'}} as never]});
    for(const value of ['Печать подтверждена агентом','SOS WB2','Соня','TSC TE200','18:04:40'])expect(html).toContain(value);
  });
  it.each(['QUEUED','CLAIMED','FAILED','CANCELLED'])('does not treat %s as confirmed printing', status=>{
    expect(printStatus(status)).not.toBe('Печать подтверждена агентом');
  });
  it('shows a missing-order result',()=>{
    const html=renderToStaticMarkup(<WbPrintCheckResults report={{orderId:'123',checkedAt:'2026-09-17T15:05:00Z',results:[]}}/>);
    expect(html).toContain('нет доступных записей');
  });
});
