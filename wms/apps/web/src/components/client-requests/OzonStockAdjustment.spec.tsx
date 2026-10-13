import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {OzonStockAdjustment} from './OzonStockAdjustment';
// TEST: both actions are available together and respect the parent read-only state.
it.each([false,true])('renders inbound sync next to actual-stock adjustment (disabled=%s)',disabled=>{
 const html=renderToStaticMarkup(<OzonStockAdjustment requestId="r" accessToken="t" disabled={disabled} onLockChange={vi.fn()} onChanged={vi.fn()}/>);
 expect(html).toContain('Скорректировать по фактическим остаткам');
 expect(html).toContain('Синхронизировать с Ozon');
 expect((html.match(/disabled=""/g)??[]).length).toBe(disabled?2:0);
});
