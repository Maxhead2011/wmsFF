import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {LamodaFboRelabel} from './LamodaFboRelabel';
import type {FboPlan} from '../../lib/api';
// TEST: permissions and server print evidence control the confirmation UI.
it.each([true,false])('renders exact Lamoda identity with write lock %s',disabled=>{
 const plan={requestId:'r',relabelRequired:true,relabelUnits:[{id:'unit',label:{name:'Coat',size:'52',article:'MP52',barcode:'4640684266611'},kiz:'mark',printStatus:'QUEUED'}]} as FboPlan;
 const html=renderToStaticMarkup(<LamodaFboRelabel plan={plan} accessToken="t" disabled={disabled} command={vi.fn()} refresh={vi.fn()}/>);
 expect(html).toContain('4640684266611');expect(html).toContain('MP52');expect(html).toContain('КИЗ этой единицы');
 expect(html).toContain('<button type="button" disabled="">Подтвердить переклейку');
 expect(html.includes('<fieldset disabled="">')).toBe(disabled);
});
it('does not expose relabel controls for other workflows',()=>{
 expect(renderToStaticMarkup(<LamodaFboRelabel plan={{} as FboPlan} accessToken="t" disabled={false} command={vi.fn()} refresh={vi.fn()}/>)).toBe('');
});
