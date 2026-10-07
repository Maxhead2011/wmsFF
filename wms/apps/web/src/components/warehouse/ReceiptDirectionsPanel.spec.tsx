import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReceiptDirectionsPanel } from './ReceiptDirectionsPanel';
// TEST: receipt reconciliation is visible to a client and explains independent storage billing.
it('shows reconciliation to the client, with dates and no cross-client selector',()=>{
 const html=renderToStaticMarkup(createElement(ReceiptDirectionsPanel,{session:{accessToken:'test',user:{roleCodes:['CLIENT']}} as any,fixedClientId:'own'}));
 expect(html).toContain('Приёмки · сверка и доступ в остатках');expect(html).toContain('Хранение начисляется с фактической приёмки');expect(html).toContain('type="date"');expect(html).not.toContain('<select');
});
