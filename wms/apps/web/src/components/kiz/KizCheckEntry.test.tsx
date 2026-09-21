import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KizIssuesPanel } from './KizIssuesPanel';
import type { AuthSession } from '../../lib/api';
afterEach(()=>vi.unstubAllEnvs());
// TEST: a production build must retain the administrator entry point, alongside existing scenarios.
describe('KIZ check entry point',()=>{
 it.each(['ADMIN','OWNER','SUPER_ADMIN'])('shows scanner entry for %s',role=>{
  vi.stubEnv('VITE_KIZ_REUSE_EVIDENCE_ENABLED','true');
  const html=renderToStaticMarkup(<KizIssuesPanel session={{accessToken:'test',user:{roleCodes:[role]}} as AuthSession}/>);
  for(const label of ['Проверка КИЗов','Проблемные КИЗ','Расхождения в коробах','Исправления'])expect(html).toContain(label);
 });
 it.each([['CLIENT','true'],['ADMIN','false']])('keeps disabled/unauthorized view unchanged: %s %s',(role,enabled)=>{
  vi.stubEnv('VITE_KIZ_REUSE_EVIDENCE_ENABLED',enabled);
  expect(renderToStaticMarkup(<KizIssuesPanel session={{accessToken:'test',user:{roleCodes:[role]}} as AuthSession}/>)).not.toContain('Проверка КИЗов');
 });
});
