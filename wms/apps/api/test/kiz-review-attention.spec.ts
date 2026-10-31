import 'reflect-metadata';
import {validate} from 'class-validator';
import {afterEach,expect,it,vi} from 'vitest';
import {DecideKizReviewDto} from '../src/modules/inventory/kiz-review-decision.dto';
import {openKizReviewCount} from '../src/common/kiz-review-attention';
const user:any={roleCodes:['ADMIN'],permissionCodes:['system:admin'],activeWarehouseId:'wh',hiddenClientIds:['hidden']};
afterEach(()=>vi.unstubAllEnvs());
it('accepts explicit REJECT at the HTTP validation boundary',async()=>{
 // TEST: the production DTO rejected an action already supported by the decision service.
 expect(await validate(Object.assign(new DecideKizReviewDto(),{resolution:'REJECT',reason:'Проверено физически',confirmed:true}))).toEqual([]);
 expect((await validate(Object.assign(new DecideKizReviewDto(),{resolution:'DELETE',reason:'reason',confirmed:true}))).length).toBeGreaterThan(0);
});
it('counts an OPEN receipt review even without any FBS request, scoped to client and warehouse',async()=>{
 // TEST: the old badge never queried the review queue, including first-time receipts.
 vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','true');
 const db:any={kizReviewCase:{findMany:vi.fn().mockResolvedValue([{taskId:'GUARD:RECEIPT:x',status:'OPEN'}])},fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([])}};
 expect(await openKizReviewCount(db,user)).toBe(1);
 expect(db.kizReviewCase.findMany.mock.calls[0][0].where).toMatchObject({status:'OPEN',warehouseId:'wh',clientId:{notIn:['hidden']}});
});
it('does not query sold installations or users without review access',async()=>{
 const db:any={kizReviewCase:{findMany:vi.fn()}};
 expect(await openKizReviewCount(db,user)).toBeUndefined();
 vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','true');
 expect(await openKizReviewCount(db,{...user,roleCodes:['WORKER']})).toBeUndefined();
 expect(db.kizReviewCase.findMany).not.toHaveBeenCalled();
});

import {KizIssuesService} from '../src/modules/kiz-issues/kiz-issues.service';
it('includes receipt reviews when the old report returns early without requests',async()=>{
 vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','true');
 const db:any={clientRequest:{findMany:vi.fn().mockResolvedValue([])},kizReviewCase:{findMany:vi.fn().mockResolvedValue([{taskId:'GUARD:RECEIPT:case'}])}};
 const report=await new KizIssuesService(db,{} as any).list({},user);
 expect(report.summary).toMatchObject({unread:0,openReviews:1,attention:1});
 db.kizReviewCase.findMany.mockResolvedValue([]);
 expect((await new KizIssuesService(db,{} as any).list({},user)).summary.attention).toBe(0);
});
it('ignores inactive legacy tasks and queries only unresolved reviews',async()=>{
 vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','true');
 const db:any={kizReviewCase:{findMany:vi.fn().mockResolvedValue([{taskId:'old',context:'old'}])},fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([{id:'old',status:'COMPLETED'}])}};
 expect(await openKizReviewCount(db,user)).toBe(0);
 expect(db.kizReviewCase.findMany.mock.calls[0][0].where.status).toBe('OPEN');
});
