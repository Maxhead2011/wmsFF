const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ts=require('../../../node_modules/typescript');
const root=process.argv[2],file=path.join(root,'modules/marketplace-connections/marketplace-connections.service.js');
let s=fs.readFileSync(file,'utf8');
function once(old,next){assert.equal(s.split(old).length,2,old.slice(0,100));s=s.replace(old,next);}
function method(name,change){const tree=ts.createSourceFile(file,s,99,true);let found;function walk(n){if(ts.isMethodDeclaration(n)&&n.name?.getText(tree)===name){assert(!found);found=n;}ts.forEachChild(n,walk);}walk(tree);assert(found,name);const start=found.getStart(tree),end=found.end;s=s.slice(0,start)+change(s.slice(start,end).replace(/\r\n/g,'\n'))+s.slice(end);}
// FIX: only explicit enable commands carry initialization authority. Automatic/reconciliation calls do not.
method('updateFbsStockPublicationFresh',m=>{const old='{ chrtId: ids.chrtId, amount },\n            ]);';assert(m.includes(old));return m.replace(old,'{ chrtId: ids.chrtId, amount },\n            ], dto.enabled === true);');});
method('updateFbsStockPublicationBulkFresh',m=>{const old='batch.map((item) => ({ chrtId: item.chrtId, amount: item.amount })))';assert(m.includes(old));return m.replace(old,'batch.map((item) => ({ chrtId: item.chrtId, amount: item.amount })), dto.enabled === true)');});
once('async putWildberriesStocks(clientId, apiKey, warehouseId, stocks) {','async putWildberriesStocks(clientId, apiKey, warehouseId, stocks, explicitEnable = false) {');
method('putWildberriesStocks',m=>{
 const marker='            const products = await this.prisma.fbsStockPublication.findMany';assert(m.includes(marker));
 return m.replace(marker,`            // FIX: our opt-in linked clients only; allocation writers retain the strict existing path.
            if (explicitEnable && !policy && (0, marketplace_product_links_1.productLinksEnabled)(clientId)) {
                await this.initializeExplicitWbPublication(clientId, connectionId, apiKey, warehouseId, stocks, observations);
            }
`+marker);
});
once('async putWildberriesStocksRaw(clientId, apiKey, warehouseId, stocks, missingZeroIds = []) {','async putWildberriesStocksRaw(clientId, apiKey, warehouseId, stocks, missingZeroIds = [], verifiedInitialZeroIds = []) {');
method('putWildberriesStocksRaw',m=>{
const old='allowMissingZeroIds: zeroIds,';assert(m.includes(old));
m=m.replace(old,'// FIX: ephemeral IDs originate only in the fresh exact-catalog check below. Positive amounts never qualify.\n            allowMissingZeroIds: new Set([...zeroIds, ...verifiedInitialZeroIds.filter(id => stocks.some(s => s.chrtId === id && s.amount === 0))]),');
const marker='                return amounts;';assert.equal(m.split(marker).length,2);
return m.replace(marker,`                // FIX: another writer may have listed the size since the missing-row read.
                if (verifiedInitialZeroIds.some(id => amounts.has(id) && amounts.get(id) !== 0))
                    throw new common_1.ConflictException('Остаток WB появился во время первой публикации. Нужен новый расчёт.');
`+marker);});
const methodBody=`
    async initializeExplicitWbPublication(clientId, connectionId, apiKey, warehouseId, stocks, observations) {
        const helper = require('./wb-first-publication');
        const read = () => this.fetchWildberriesStockAmounts(apiKey, warehouseId, stocks.map(s => s.chrtId), true, true);
        await helper.initializeFirstPublication(stocks, {
            read,
            verify: async ids => {
                const connection = await this.prisma.clientMarketplaceConnection.findFirst({where:{id:connectionId,clientId,isActive:true,marketplace:client_1.MarketplaceType.WILDBERRIES},include:{client:true}});
                const route = await this.prisma.fbsWarehouseRoutingRule.findUnique({where:{connectionId_marketplaceWarehouseId:{connectionId,marketplaceWarehouseId:warehouseId}}});
                if (!connection || connection.apiKey !== apiKey || connection.fbsWarehouseId !== warehouseId || !route || !['CENTRAL','DIRECT'].includes(route.mode))
                    throw new common_1.ConflictException('Первая публикация разрешена только на подключённом складе нашей маршрутизации.');
                const publications = await this.prisma.fbsStockPublication.findMany({where:{clientId,connectionId,warehouseId,enabled:true},include:{sku:{include:{barcodes:true}}}});
                const linked = await (0, marketplace_product_links_1.wbLinkedSkus)(this.prisma,clientId,connectionId,publications.map(p=>p.sku));
                const identities = linked.map(s=>({skuId:s.id,productId:s.marketplaceProductId,barcodes:s.barcodes.map(b=>b.value)}));
                const cards = await this.fetchWildberriesProducts(connection);
                return helper.verifyFirstPublication(ids, identities, cards);
            },
            record: (phase, details) => this.prisma.auditLog.create({data:{action:'FBS_WB_FIRST_PUBLICATION',entity:'ClientMarketplaceConnection',entityId:connectionId,payload:{clientId,connectionId,warehouseId,phase,...details}}}),
            sendZeros: async (zeros, ids) => {
                await observations.guard();
                await this.putWildberriesStocksRaw(clientId,apiKey,warehouseId,zeros,[],ids);
            },
        });
    }
`;
once('    async putWildberriesStocksRaw(',methodBody+'    async putWildberriesStocksRaw(');
fs.writeFileSync(file,s);
const source=fs.readFileSync(path.resolve(__dirname,'../../../apps/api/src/modules/marketplace-connections/wb-first-publication.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
fs.writeFileSync(path.join(root,'modules/marketplace-connections/wb-first-publication.js'),compiled);
