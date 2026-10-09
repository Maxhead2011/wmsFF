import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {KizFoundPanel,foundCaptions} from './KizFoundPanel';
// TEST: the no-box shipment exposes an explicit physical-found action without a premature stock-return form.
it('offers review without box and explains separate stock accounting',()=>{
 const html=renderToStaticMarkup(<KizFoundPanel session={{accessToken:'test'} as any} candidate={{markId:'m',identity:'k'}}/>);
 expect(html).toContain('Товар физически у меня');expect(html).toContain('не увеличивают остаток');expect(html).not.toContain('required');
 expect(foundCaptions.REUSE).toBe('Разрешить использовать КИЗ');expect(Object.keys(foundCaptions)).toEqual(['OPEN','REUSE','RELABEL','RETURN','REJECT']);
});
