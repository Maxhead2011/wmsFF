// TEST: real transactions and real invoice writer; isolated synthetic DB only.
require('reflect-metadata');const assert=require('node:assert/strict');
assert.equal(new URL(process.env.DATABASE_URL).hostname,'cargo-pickup-test-pg');
const {PrismaClient}=require('@prisma/client'),db=new PrismaClient(),dir='/app/apps/api/dist/';
const {BillingService}=require(dir+'modules/billing/billing.service'),{WarehouseService}=require(dir+'modules/warehouse/warehouse.service'),{ClientScopeService}=require(dir+'modules/auth/client-scope.service');
(async()=>{
 process.env.WMS_CARGO_PICKUP_ENABLED='true';process.env.WMS_BILLING_PERIOD_CLOSE_ENABLED='true';
 const client=await db.client.create({data:{code:'CARGO',name:'Synthetic cargo'}}),warehouse=await db.warehouse.create({data:{code:'CARGO',name:'Synthetic cargo'}}),actor=await db.user.create({data:{email:'cargo@example.invalid',name:'Synthetic',passwordHash:'unused'}});
 const user={id:actor.id,name:actor.name,email:actor.email,isDemo:false,roleCodes:['ADMIN'],permissionCodes:['system:admin','billing:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:warehouse.id,warehouseIds:[warehouse.id],writableWarehouseIds:[warehouse.id],hiddenClientIds:[]};
 const scopes=new ClientScopeService(),billing=new BillingService(db,scopes),service=new WarehouseService(db,scopes,{}, {}, {},billing,{});
 // Bank-account integration is unrelated; all financial writes/guards remain real.
 billing.paymentAccountSnapshot=async()=>({});
 const arrival=cost=>({clientId:client.id,arrivalDate:'2026-10-02',bagCount:1,boxCount:0,ourDelivery:true,deliveryCostRub:cost});
 await service.createGoodsArrival(arrival(500),user);await service.createGoodsArrival({...arrival(700),arrivalDate:'2026-10-01'},user);
 await service.createGoodsArrival({...arrival(900),ourDelivery:false},user);
 const dto={clientId:client.id,periodFrom:'2026-10-01',periodTo:'2026-10-31'};let passed=0;
 // Forced failure after invoice creation must roll back invoice, charges AND source links.
 const broken=Object.create(service);broken.billing=Object.create(billing);broken.billing.createManualInvoice=async function(dto,user){await billing.createManualInvoice(dto,user);throw Error('FORCED_ROLLBACK');};
 await assert.rejects(()=>broken.billCargoPickups(dto,user),/FORCED_ROLLBACK/);assert.equal(await db.billingInvoice.count(),0);assert.equal(await db.billingCharge.count(),0);passed++;
 const results=await Promise.allSettled([service.billCargoPickups(dto,user),service.billCargoPickups(dto,user)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.billingInvoice.count(),1);assert.equal(await db.billingCharge.count(),2);passed++;
 const invoice=await db.billingInvoice.findFirst({include:{items:{orderBy:{serviceDate:'asc'}}}});assert.equal(Number(invoice.totalRub),1200);assert.deepEqual(invoice.items.map(r=>Number(r.totalRub)),[700,500]);passed++;
 const rows=await service.listGoodsArrivals(dto,user),source=rows.find(r=>r.ourDelivery);
 await assert.rejects(()=>service.updateCargoPickup(source.id,{ourDelivery:false},user));await assert.rejects(()=>service.deleteGoodsArrival(source.id,user));passed++;
 await billing.updateInvoiceStatus(invoice.id,{status:'CANCELLED'},user);assert.equal(await db.billingCharge.count({where:{status:'CANCELLED'}}),2);
 await service.billCargoPickups(dto,user);assert.equal(await db.billingInvoice.count({where:{status:{not:'CANCELLED'}}}),1);passed++;
 const other={...user,activeWarehouseId:'00000000-0000-0000-0000-000000000000'};await assert.rejects(()=>service.billCargoPickups(dto,other));passed++;
 process.env.WMS_CARGO_PICKUP_ENABLED='false';await assert.rejects(()=>service.billCargoPickups(dto,user));passed++;
 // PRR stays separately billable even after the cargo invoice uses the same arrivals.
 process.env.WMS_CARGO_PICKUP_ENABLED='true';
 const prr=await service.ensurePprServices();for(const item of [prr.bags,prr.boxes])await db.billingService.update({where:{id:item.id},data:{defaultPriceRub:10}});
 const prrInvoice=await service.billGoodsArrivals(dto,user);assert.equal(Number(prrInvoice.totalRub),30);
 assert.equal(await db.billingInvoice.count({where:{status:{not:'CANCELLED'}}}),2);passed++;
 console.log(JSON.stringify({passed,syntheticOnly:true}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1});
