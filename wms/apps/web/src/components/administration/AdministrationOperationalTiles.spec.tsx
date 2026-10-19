import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { AdministrationOperationalTiles } from './AdministrationOperationalTiles';
import { AdministrationPanel } from './AdministrationPanel';
import { AdministrationSortingCancellation } from './AdministrationSortingCancellation';
const session=(role:string)=>({accessToken:'test',user:{id:'u',roleCodes:[role],activeWarehouseId:'wh',administrationEnabled:false}}) as any;
afterEach(()=>vi.unstubAllEnvs());
// TEST: separate cards replace the plain button and are available to both operational roles.
it.each(['ADMIN','OWNER'])('renders separate receipt and sorting tiles for %s',role=>{
 vi.stubEnv('VITE_PALLET_SORTING_ENABLED','true');vi.stubEnv('VITE_ADMIN_PROBLEMS_ENABLED','true');
 const html=renderToStaticMarkup(<AdministrationOperationalTiles session={session(role)} onSelect={()=>{}}/>);
 expect((html.match(/class="admin-topic-tile /g)||[])).toHaveLength(2);
 expect(html).toContain('Проблемы приёмки');expect(html).toContain('Незавершённые сортировки');expect(html).toContain('<svg');
});
it.each(['OPERATOR','CLIENT'])('hides both cards from %s',role=>{
 vi.stubEnv('VITE_PALLET_SORTING_ENABLED','true');vi.stubEnv('VITE_ADMIN_PROBLEMS_ENABLED','true');
 expect(renderToStaticMarkup(<AdministrationOperationalTiles session={session(role)} onSelect={()=>{}}/>)).toBe('');
});
it('does not mount the empty sorting card or receipt form before selection',()=>{
 vi.stubEnv('VITE_PALLET_SORTING_ENABLED','true');vi.stubEnv('VITE_ADMIN_PROBLEMS_ENABLED','true');
 const html=renderToStaticMarkup(<AdministrationPanel session={session('ADMIN')} onOpenWorkspace={()=>{}}/>);
 expect(html).toContain('admin-topic-grid');expect(html).not.toContain('Снятие незавершённой сортировки');expect(html).not.toContain('receipt-barcode-problems');expect(html).not.toContain('admin-card');
});
it('embedded sorting content has no second entry button',()=>{
 vi.stubEnv('VITE_PALLET_SORTING_ENABLED','true');const html=renderToStaticMarkup(<AdministrationSortingCancellation session={session('OWNER')} embedded/>);
 expect(html).toContain('admin-sorting-content');expect(html).not.toContain('>Незавершённые сортировки</button>');
});
