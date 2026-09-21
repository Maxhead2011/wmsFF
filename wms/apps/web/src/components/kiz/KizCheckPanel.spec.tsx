import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { KizIssuesPanel } from './KizIssuesPanel';
import { KizCheckPanel } from './KizCheckPanel';

afterEach(()=>vi.unstubAllEnvs());
const session=(role:string)=>({accessToken:'test',user:{roleCodes:[role],activeWarehouseId:'wh'}} as any);
// TEST: the extra tile is visible only to administrators in our opt-in build.
it('isolates the new tile from sold builds and picker accounts',()=>{
  vi.stubEnv('VITE_KIZ_REUSE_EVIDENCE_ENABLED','true');
  expect(renderToStaticMarkup(<KizIssuesPanel session={session('ADMIN')} />)).toContain('Проверка КИЗов');
  expect(renderToStaticMarkup(<KizIssuesPanel session={session('OPERATOR')} />)).not.toContain('Проверка КИЗов');
  vi.stubEnv('VITE_KIZ_REUSE_EVIDENCE_ENABLED','false');
  expect(renderToStaticMarkup(<KizIssuesPanel session={session('ADMIN')} />)).not.toContain('Проверка КИЗов');
});
// TEST: scanning is an explicit read-only action, separate from issue correction.
it('offers a scanner without stock-changing actions',()=>{
  const html=renderToStaticMarkup(<KizCheckPanel session={session('OWNER')} />);
  expect(html).toContain('Проверить');expect(html).toContain('не изменяет остатки');
  expect(html).not.toContain('Списать');
});
