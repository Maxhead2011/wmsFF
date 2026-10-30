import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { Reconciliation } from './InventoryPanel';
// TEST: worker/legacy dashboards cannot offer the privileged recovery action.
it.each([true,false])('found-unit form respects capability %s',enabled=>{
  const dashboard:any={canManage:true,canConfirmFoundUnit:enabled,historySessions:[{id:'session',type:'BOX_CHECK',status:'REVIEW',boxes:[{
    id:'audit',boxCode:'FFL_001',status:'MISMATCH',startedAt:'2026-10-30',lines:[{id:'line',skuName:'Яна',expectedQuantity:10,countedQuantity:9,decision:'PENDING'}],
  }]}]};
  const html=renderToStaticMarkup(<Reconciliation dashboard={dashboard} session={{accessToken:'test'} as any} onChanged={async()=>{}}/>);
  expect(html.includes('Подтвердить найденную единицу')).toBe(enabled);
  if(enabled){expect(html).toContain('Причина подтверждения');expect(html).toContain('Подтверждаю физическое наличие');expect(html).toContain('disabled');}
});
