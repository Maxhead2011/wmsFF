import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {SidebarRequestBadge} from './SidebarRequestCounts';
describe('sidebar request badge',()=>{
 // TEST: full totals and subsets on both ordinary navigation and favorite copies.
 it('renders exact large totals and work counts for all three sections',()=>{
  const state={scope:'x',value:{requests:{total:230,inWork:11},fbs:{total:205,inWork:9},fbo:{total:25,inWork:2}}};
  for(const [id,text] of [['requests','230 (11)'],['fbs','205 (9)'],['fbo-ozon','25 (2)']]){
   const html=renderToStaticMarkup(<SidebarRequestBadge id={id} state={state}/>);expect(html).toContain(text);expect(html).toContain('workspace-nav__badge');expect(html).not.toContain('99+');
  }
 });
 // TEST: zero is a known count, error/loading/unauthorized are separate states.
 it('distinguishes zero from missing or failed data and leaves KIZ alone',()=>{
  expect(renderToStaticMarkup(<SidebarRequestBadge id="fbs" state={{scope:'x',value:{requests:{total:0,inWork:0},fbs:{total:0,inWork:0},fbo:{total:0,inWork:0}}}}/>)).toContain('0 (0)');
  expect(renderToStaticMarkup(<SidebarRequestBadge id="requests" state={{scope:'x',error:true}}/>)).toContain('—');
  expect(renderToStaticMarkup(<SidebarRequestBadge id="requests" state={{scope:'x'}}/>)).toContain('…');
  expect(renderToStaticMarkup(<SidebarRequestBadge id="requests" state={null}/>)).toBe('');
  expect(renderToStaticMarkup(<SidebarRequestBadge id="kiz" state={{scope:'x'}}/>)).toBe('');
 });
});
