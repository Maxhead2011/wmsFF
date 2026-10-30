import {describe,it,expect} from 'vitest';
import {fboProcessOptions,fboProcessValue} from './fboProcess';
import type {ClientRequestSummary} from '../../lib/api';
describe('FBO process',()=>{
 // TEST: exact approved order and non-terminal loading without changing unrelated request workflows.
 it('offers six FBO states and preserves FBS options',()=>{
  const r={type:'OUTBOUND',title:'FBO',status:'PACKED'} as ClientRequestSummary;
  expect(fboProcessOptions(r).map(x=>x.label)).toEqual(['Новая','В работе','Упакована','Отгружено','Сдано','Отменена']);
  expect(fboProcessOptions({...r,title:'FBS test'}).map(x=>x.value)).toContain('IN_REVIEW');
  expect(fboProcessValue({...r,fboDispatchAt:'today'})).toBe('SHIPPED');
  expect(fboProcessValue({...r,status:'DONE',fboDispatchAt:'today'})).toBe('DONE');
  expect(fboProcessValue({...r,status:'APPROVED'})).toBe('SUBMITTED');
 });
});
