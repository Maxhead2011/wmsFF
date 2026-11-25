import 'reflect-metadata';
import {ValidationPipe} from '@nestjs/common';
import {describe,expect,it} from 'vitest';
import {FulfillmentQueryDto} from '../src/modules/analytics/fulfillment.controller';
// TEST: use the same strict transformation as main.ts, not just direct service calls.
describe('fulfillment HTTP query validation',()=>{
 const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
 const meta={type:'query' as const,metatype:FulfillmentQueryDto};
 const query={clientId:'c',warehouseId:'w',channel:'FBS',dateFrom:'2026-08-27',dateTo:'2026-11-24',leadDays:'7',reviewDays:'7',safetyDays:'3'};
 it('accepts browser query strings and converts stock horizon to integers',async()=>{
  expect(await pipe.transform(query,meta)).toMatchObject({leadDays:7,reviewDays:7,safetyDays:3,channel:'FBS'});
 });
 it('rejects unknown parameters and fractional horizons',async()=>{
  await expect(pipe.transform({...query,refresh:'123'},meta)).rejects.toThrow();
  await expect(pipe.transform({...query,leadDays:'1.5'},meta)).rejects.toThrow();
 });
});
