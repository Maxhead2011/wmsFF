import { expect, it } from 'vitest';
import { orderAssemblyPrintHtml } from './orderAssemblyLabels';
// TEST: direct WMS printing must use the same PNG bytes returned to the TSD station.
it('prints exactly the WB image and the shared sorting image, without another template',()=>{
 const html=orderAssemblyPrintHtml({orderId:'5497088111',contentType:'image/png',imageBase64:'V0I=',sortingLabel:{contentType:'image/png',imageBase64:'U09SVA==',widthMm:58,heightMm:40}});
 expect(html.match(/<img /g)).toHaveLength(2);expect(html).toContain('data:image/png;base64,U09SVA==');expect(html).not.toContain('ЗАЯВКА WMS');
});
it('fails before opening print when the sorting label is missing or unsafe',()=>{
 expect(()=>orderAssemblyPrintHtml({orderId:'1',contentType:'image/png',imageBase64:'V0I='} as any)).toThrow('сортировоч');
 expect(()=>orderAssemblyPrintHtml({orderId:'1',contentType:'text/html',imageBase64:'V0I=',sortingLabel:{contentType:'image/png',imageBase64:'U09SVA==',widthMm:58,heightMm:40}})).toThrow();
});
