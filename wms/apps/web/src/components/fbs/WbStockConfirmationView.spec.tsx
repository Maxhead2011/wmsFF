import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StockManagementMenu } from './StockManagementMenu';
import { confirmationAmount, confirmationStatus } from '../../lib/wbStockConfirmation';
import { fetchWbStockConfirmations, verifyWbStockConfirmations } from '../../lib/api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: null is unknown, whereas zero is an actual WB stock value.
it('distinguishes missing and zero confirmations',()=>{expect(confirmationAmount(null)).toBe('—');expect(confirmationAmount(0)).toBe('0');expect(confirmationStatus('MISMATCH')).toBe('Расхождение');});
it('enables the fifth tile only with the server capability',()=>{const html=renderToStaticMarkup(<StockManagementMenu cabinetMessage="WB" duplicatesEnabled confirmationEnabled onSelect={()=>{}}/>);expect(html).not.toContain('disabled=""');expect(html).toContain('Отправка, проверка и расхождения');});
it('uses scoped list and the existing read-only WB check endpoint',async()=>{
 const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})));vi.stubGlobal('fetch',fetch);
 await fetchWbStockConfirmations('token','c','wb',{page:2,status:'UNCONFIRMED',search:'001'});await verifyWbStockConfirmations('token','c','wb');
 expect(fetch.mock.calls[0][0]).toContain('clientId=c');expect(fetch.mock.calls[0][0]).toContain('page=2');expect(fetch.mock.calls[1][0]).toContain('/allocation/check');expect(fetch.mock.calls[1][0]).not.toContain('/sync');expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({clientId:'c',connectionId:'wb'});
});
