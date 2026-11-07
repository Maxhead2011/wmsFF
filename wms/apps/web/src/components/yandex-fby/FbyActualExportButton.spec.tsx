import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { FbyActualExportButton } from './FbyActualExportButton';
// TEST: only finished packaging exposes an enabled download; backend rechecks physical readiness.
it('enables actual export only for packed or handed-over requests',()=>{
 for(const status of ['SUBMITTED','IN_PROGRESS','CANCELLED','PACKED','DONE']){
  const html=renderToStaticMarkup(<FbyActualExportButton token="test" accountId="a" requestId="r" number={1} status={status}/>);
  expect(html.includes('disabled')).toBe(!['PACKED','DONE'].includes(status));expect(html).toContain('Скачать для Яндекса');
 }
});
