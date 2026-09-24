import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { AdministrationNavigation } from './AdministrationPanel';
import type { AuthSession } from '../../lib/api';
// TEST: server tile navigation retains auto-assembly and gates the new recovery entry.
describe('FBO recovery server navigation', () => {
  const html = (role: string, enabled: boolean) => renderToStaticMarkup(<AdministrationNavigation session={{accessToken:'test',user:{roleCodes:[role],permissionCodes:['system:admin']}} as AuthSession} activeTab={null} phantomCount={0} onSelect={()=>{}} fboEnabled={enabled}/>);
  it('keeps auto-assembly and adds FBO only when enabled for administrators', () => {
    expect(html('OWNER', true)).toContain('Автосборка');
    expect(html('OWNER', true)).toContain('Проблемы FBO');
    expect(html('ADMIN', true)).toContain('Проблемы FBO');
    expect(html('OWNER', false)).not.toContain('Проблемы FBO');
    expect(html('CLIENT', true)).not.toContain('Проблемы FBO');
  });
});
