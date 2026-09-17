import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FboProgress} from './FboProgress';
import {ClientRequestCreateForm} from './ClientRequestCreateForm';
import {startFboPolling} from './fboLivePolling';
import {isWbFboRequest} from './fboRequestScope';
import {buildFboNavigation,workspaceNav} from '../../lib/workspaces';
import type {AuthSession,ClientRequestSummary,FboPlan} from '../../lib/api';

describe('FBO live execution and navigation',()=>{
 afterEach(()=>vi.useRealTimers());
 // TEST: the FBO form fixes the outbound type without restricting the general request form.
 it('locks the request type only in the FBO form',()=>{
  const session={user:{id:'u',permissionCodes:['system:admin'],writableClientIds:[],clientScopeMode:'ALL'}} as unknown as AuthSession;
  const render=(outboundOnly:boolean)=>renderToStaticMarkup(<ClientRequestCreateForm session={session} clients={[{id:'c',code:'C',name:'Client'} as never]} onCreated={()=>{}} outboundOnly={outboundOnly}/>);
  expect(render(true)).toMatch(/<span>Тип<\/span><select disabled="">/);
  expect(render(false)).toMatch(/<span>Тип<\/span><select>/);
 });
 // TEST: live observation continues without a scan, pauses while hidden, and stops when the view closes.
 it('refreshes every five seconds until the monitor closes',()=>{
  vi.useFakeTimers();const refresh=vi.fn();let visible=true;const stop=startFboPolling(refresh,()=>visible);
  vi.advanceTimersByTime(10000);expect(refresh).toHaveBeenCalledTimes(2);
  visible=false;vi.advanceTimersByTime(5000);expect(refresh).toHaveBeenCalledTimes(2);
  visible=true;vi.advanceTimersByTime(5000);expect(refresh).toHaveBeenCalledTimes(3);
  stop();vi.advanceTimersByTime(10000);expect(refresh).toHaveBeenCalledTimes(3);
 });
 // TEST: counts come from persisted FBO units, with line progress and the actual scanning employee.
 it('shows progress, remaining quantity and scan history',()=>{
  const plan={needed:6,picked:2,packed:1,route:[],boxes:[],lines:[{id:'l',name:'Реглан',article:'светлмеланж',size:'M',barcode:'2047945565575',needed:6,picked:2,packed:1,remaining:4}],pickedUnits:[{id:'u',requestItemId:'l',barcode:'2047945565575',kiz:'test-kiz',sourceBoxCode:'FFL_20',pickedBy:'Соня',pickedAt:'2026-09-17T12:00:00Z'}]} as unknown as FboPlan;
  const html=renderToStaticMarkup(<FboProgress plan={plan}/>);
  expect(html).toContain('Осталось отобрать');expect(html).toContain('33%');expect(html).toContain('17%');
  expect(html).toContain('Реглан');expect(html).toContain('test-kiz');expect(html).toContain('Соня');expect(html).toContain('15:00:00');
 });
 // TEST: preserve the sold menu and the separate DBS entry; our FBO group follows FBS.
 it('groups FBO only for opted-in installations',()=>{
  expect(buildFboNavigation(workspaceNav,false)).toBe(workspaceNav);
  const nav=buildFboNavigation(workspaceNav,true);const fbs=nav.findIndex(i=>i.id==='fbs');
  expect(nav[fbs+1]).toMatchObject({id:'fbo-ozon',title:'FBO'});
  expect(nav.filter(i=>i.id==='fbo-ozon')).toHaveLength(1);expect(nav.find(i=>i.id==='dbs')?.title).toBe('DBS');
 });
 // TEST: Excel and manual outbound requests qualify; FBS links and legacy FBS markers do not.
 it('separates WB FBO requests from FBS and receipts',()=>{
  const r={type:'OUTBOUND',title:'Сборка из Excel',comment:null,_count:{fbsOrderLinks:0}} as ClientRequestSummary;
  expect(isWbFboRequest(r)).toBe(true);expect(isWbFboRequest({...r,title:'Ручная сборка'})).toBe(true);
  expect(isWbFboRequest({...r,type:'INBOUND'})).toBe(false);
  expect(isWbFboRequest({...r,_count:{fbsOrderLinks:1}})).toBe(false);
  expect(isWbFboRequest({...r,title:'FBS WB'})).toBe(false);
  expect(isWbFboRequest({...r,title:'DBS WB'})).toBe(false);
  expect(isWbFboRequest({...r,comment:'Создано из FBS-заказов: 123'})).toBe(false);
 });
});
