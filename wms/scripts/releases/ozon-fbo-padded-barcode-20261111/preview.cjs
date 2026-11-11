const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { ClientScopeService } = require('./dist/modules/auth/client-scope.service');
const { OzonFboImportService } = require('./dist/modules/client-requests/ozon-fbo-import.service');
const { OzonLinkImportService } = require('./dist/modules/client-requests/ozon-link-import.service');
const { OzonAssemblySupplyService } = require('./dist/modules/client-requests/ozon-assembly-supply.service');
const db = new PrismaClient();
const fetchOriginal = global.fetch;
global.fetch = (input, init) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://api-seller.ozon.ru');
  assert(['/v3/supply-order/get', '/v1/cluster/list', '/v1/supply-order/bundle'].includes(url.pathname));
  return fetchOriginal(input, {...init, redirect: 'error'});
};
(async () => {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const scopes = new ClientScopeService();
    const importer = new OzonFboImportService(tx, scopes);
    const supply = new OzonAssemblySupplyService(tx, scopes);
    const service = new OzonLinkImportService(tx, scopes, importer, supply);
    const client = await tx.client.findUniqueOrThrow({where:{code:'CL-000002'}});
    const connections = await tx.clientMarketplaceConnection.findMany({where:{clientId:client.id, sellerId:'467702', marketplace:'OZON', isActive:true},select:{id:true}});
    assert.equal(connections.length,1);
    const user = {id:'ozon-preview-verification',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',warehouseIds:[],writableWarehouseIds:[]};
    const warehouses = await importer.warehouses(client.id,user);
    const warehouse = warehouses.find(w => /Москва/.test(w.name ?? w.warehouseName));
    assert(warehouse, 'Moscow warehouse unavailable');
    user.activeWarehouseId = warehouse.id ?? warehouse.warehouseId;
    const result = await service.preview({clientId:client.id,warehouseId:user.activeWarehouseId,connectionId:connections[0].id,links:'https://seller.ozon.ru/app/supply/orders/139939408'},user);
    assert.equal(result.orders.length,1);
    assert.equal(String(result.orders[0].orderId),'139939408');
    assert(result.items.some(i=>i.barcode==='04610460840540'));
    assert.equal(result.items.reduce((total,i)=>total+i.quantity,0),result.totalQuantity);
    console.log(JSON.stringify({items:result.items.length,totalQuantity:result.totalQuantity,directions:result.directions.length,existingRequest:result.existingRequest?.number??null}));
  },{timeout:90000});
})().catch(error => {console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
