import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {FbsPackingStatus} from './FbsPackingStatus';
// TEST: found and packed are distinct stages with both actors visible.
it('shows packing only after confirmed evidence',()=>{
 const packing={stage:'FOUND' as const,foundAt:'2026-09-18T09:00:00Z',foundBy:'Picker',packedAt:null,packedBy:null};
 const found=renderToStaticMarkup(<FbsPackingStatus packing={packing}/>);
 expect(found).toContain('Найдено');expect(found).not.toContain('Упаковано');
 const packed=renderToStaticMarkup(<FbsPackingStatus packing={{...packing,stage:'PACKED',packedAt:'2026-09-18T10:00:00Z',packedBy:'Packer'}}/>);
 expect(packed).toContain('Упаковано');expect(packed).toContain('Picker');expect(packed).toContain('Packer');
});
