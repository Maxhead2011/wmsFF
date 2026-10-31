// FIX: overlay only checked fragments on the live release, preserving runtime-only logic.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function save(p,s){p=root+'/'+p;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
function patch(n,fn){save('api-payload/'+n,fn(read(root+'/api-live/'+n)));}
for(const n of ['common/client-receipt-kiz-policy.js','common/kiz-review-attention.js','modules/clients/client-kiz-policy.controller.js','modules/clients/client-kiz-policy.service.js'])save('api-payload/'+n,read(w+'/apps/api/dist/'+n));
patch('modules/clients/clients.module.js',s=>once(once(s,
 'controllers: [clients_controller_1.ClientsController,','controllers: [require("./client-kiz-policy.controller").ClientKizPolicyController, clients_controller_1.ClientsController,'),
 'providers: [clients_service_1.ClientsService,','providers: [require("./client-kiz-policy.service").ClientKizPolicyService, clients_service_1.ClientsService,'));
patch('modules/tsd/tsd-assembly.service.js',s=>{
 s=once(s,'        if (!found) {\n            throw new common_1.NotFoundException(\'Товар по штрихкоду не найден.\');',
 '        const marking = await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(this.prisma, clientId);\n        if (!found && marking.needsChestnyZnak) return {id:null,skuId:null,clientId,barcode,name:barcode,isDraft:true,...marking};\n        if (!found) {\n            throw new common_1.NotFoundException(\'Товар по штрихкоду не найден.\');');
 return once(s,'            isUnmarked: sku.isUnmarked,\n            isDraft: sku.isDraft,','            isUnmarked: sku.isUnmarked,\n            ...marking,\n            isDraft: sku.isDraft,');
});
patch('modules/stock/stock-operations.service.js',s=>once(once(s,
 '            const { createdDraft, sku } = await this.resolveOrCreateSkuForReceipt(tx, dto);',
 '            if (movementType === "RECEIPT") await require("../../common/client-receipt-kiz-policy").assertClientReceiptKiz(tx,dto.clientId,dto.kiz);\n            const { createdDraft, sku } = await this.resolveOrCreateSkuForReceipt(tx, dto);'),
 "                    draftSource: 'RECEIPT_SCAN',", "                    draftSource: 'RECEIPT_SCAN',\n                    ...await require(\"../../common/client-receipt-kiz-policy\").clientReceiptMarking(tx,dto.clientId),"));
patch('modules/skus/skus.service.js',s=>once(once(s,
 '                        isUnmarked: dto.isUnmarked ?? false,','                        isUnmarked: dto.isUnmarked ?? false,\n                        ...await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(tx,dto.clientId),'),
 'const updateData = this.buildSkuUpdateData(dto, existing);','const updateData = {...this.buildSkuUpdateData(dto, existing), ...await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(this.prisma,existing.clientId)};'));
patch('modules/imports/imports.service.js',s=>once(once(s,
 '    async ensureSku(tx, item) {','    async ensureSku(tx, item) {\n        await require("../../common/client-receipt-kiz-policy").assertClientReceiptKiz(tx,item.clientId,item.kiz);'),
 '                internalSku: `BAR-${item.barcode}`,','                internalSku: `BAR-${item.barcode}`,\n                ...await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(tx,item.clientId),'));
patch('modules/marketplace-connections/marketplace-connections.service.js',s=>once(once(s,
 'const data = marketplaceSkuData(clientId, product, preserveManualVolume);','const data = {...marketplaceSkuData(clientId, product, preserveManualVolume), ...await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(this.prisma,clientId)};'),
 'syncProductLink)(this.prisma, connection, product, marketplaceSkuData(connection.clientId, product, false))',
 'syncProductLink)(this.prisma, connection, product, {...marketplaceSkuData(connection.clientId, product, false), ...await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(this.prisma,connection.clientId)})'));
patch('modules/inventory/inventory.service.js',s=>{
 s=once(s,'if ((dto.captureKiz || stockKizAudit) && sku.needsChestnyZnak && !sku.isUnmarked) {','if (await require("../../common/client-receipt-kiz-policy").clientRequiresReceiptKiz(this.prisma,auditBox.clientId) || ((dto.captureKiz || stockKizAudit) && sku.needsChestnyZnak && !sku.isUnmarked)) {');
 s=once(s,"    async setCount(auditBoxId, dto, user) {\n        const auditBox = await this.requireCountingBox(auditBoxId, user);\n        this.clientScopes.requireClientAccess(user, auditBox.clientId, 'write');", "    async setCount(auditBoxId, dto, user) {\n        const auditBox = await this.requireCountingBox(auditBoxId, user);\n        this.clientScopes.requireClientAccess(user, auditBox.clientId, 'write');\n        if(await require(\"../../common/client-receipt-kiz-policy\").clientRequiresReceiptKiz(this.prisma,auditBox.clientId))throw new common_1.BadRequestException('Все товары клиента учитываются по КИЗ. Отсканируйте каждую единицу вместо ручного количества.');");
 const compiled=read(w+'/apps/api/dist/modules/inventory/inventory.service.js');
 const start=compiled.indexOf('        // FIX: a count started before enabling');const end=compiled.indexOf('        const mismatch =',start);assert(start>0&&end>start);
 const fragment=compiled.slice(start,end).replaceAll('(0, client_receipt_kiz_policy_1.clientRequiresReceiptKiz)','require("../../common/client-receipt-kiz-policy").clientRequiresReceiptKiz');
 return once(s,'        const mismatch = lines.some((line) => line.countedQuantity !== line.expectedQuantity);',fragment+'        const mismatch = lines.some((line) => line.countedQuantity !== line.expectedQuantity);');
});
patch('modules/inventory/kiz-location.controller.js',s=>once(s,"(0, class_validator_1.IsIn)(['REUSE', 'RELABEL'])","(0, class_validator_1.IsIn)(['REUSE', 'RELABEL', 'REJECT'])"));
patch('modules/kiz-issues/kiz-issues.service.js',s=>once(s,'    async list(filter, user) {',`    async list(filter,user) {
      const report=await this.listLegacy(filter,user);
      const openReviews=await require('../../common/kiz-review-attention').openKizReviewCount(this.prisma,user,filter.clientId);
      return openReviews===undefined?report:{...report,summary:{...report.summary,openReviews,attention:report.summary.unread+openReviews}};
    }
    async listLegacy(filter, user) {`));
patch('modules/administration/administration-internal-api.service.js',s=>once(s,"prefixes: ['/clients', '/clients/:clientId/product-display', '/clients/:clientId/stores'],\n\n        routeCount: 14,","prefixes: ['/clients', '/clients/:clientId/product-display', '/clients/:clientId/stores', '/clients/:clientId/kiz-policy'],\n\n        routeCount: 16,"));

// Keep React, API request helper and entry root from the actual published application.
let html=read(root+'/web-base/index.html'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);
const old='processing-terms-20261031-0.js',next='client-kiz-20261031.js';
let s=read(root+'/web-base/assets/'+old);
s=once(s,'ne&&P(we.summary.unread)','ne&&P(we.summary.attention??we.summary.unread)');
s=once(s,'if(await Pe(t.accessToken,u.row.id,u.resolution,D.trim(),S),!v.current)return;', 'if(await Pe(t.accessToken,u.row.id,u.resolution,D.trim(),S),window.dispatchEvent(new Event("kiz-issues-changed")),!v.current)return;');
const anchor='Te&&e.jsx(__pdSettings,{accessToken:t.accessToken,clientId:M.client.id},M.client.id+":product-display")';
s=once(s,anchor,'Te&&e.jsxs("div",{className:"client-cabinet-settings-row",children:[e.jsx(__pdSettings,{accessToken:t.accessToken,clientId:M.client.id},M.client.id+":product-display"),e.jsx(__KizPolicy.ClientKizPolicySettings,{accessToken:t.accessToken,clientId:M.client.id},M.client.id+":kiz-policy")]})');
const source=read(w+'/apps/web/src/components/client-cabinet/ClientKizPolicySettings.tsx'),ast=ts.createSourceFile('x.tsx',source,99,true,ts.ScriptKind.TSX);
const body=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const preamble='const useEffect=x.useEffect,useState=x.useState;function fetchClientKizPolicy(accessToken,clientId){return z(`/clients/${encodeURIComponent(clientId)}/kiz-policy`,{accessToken})}function saveClientKizPolicy(accessToken,clientId,required){return z(`/clients/${encodeURIComponent(clientId)}/kiz-policy`,{accessToken,method:"PUT",body:{required}})}';
s+='\n'+esbuild.buildSync({stdin:{contents:preamble+body,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__KizPolicy',minify:true,jsx:'transform',jsxFactory:'x.createElement'}).outputFiles[0].text;
save('web-payload/assets/'+next,s);
for(const key of Object.keys(map.imports))if(map.imports[key]==='/assets/'+old)map.imports[key]='/assets/'+next;map.imports['/assets/'+old]='/assets/'+next;
html=html.replace(m[1],JSON.stringify(map));html=once(html,'<script type="module" crossorigin src="/assets/'+old+'"','<script type="module" crossorigin src="/assets/'+next+'"');
const css=read(w+'/apps/web/src/components/client-cabinet/client-cabinet.css').split('/* FIX: keep the KIZ rule beside')[1];assert(css);
save('web-payload/assets/client-kiz-20261031.css','/* FIX: keep the KIZ rule beside'+css);
html=once(html,'</head>','<link rel="stylesheet" href="/assets/client-kiz-20261031.css">\n</head>');save('web-payload/index.html',html);
assert.equal((html.match(/<script type="module" crossorigin src=/g)||[]).length,1);
for(const dir of ['api-payload','web-payload'])for(const f of fs.readdirSync(root+'/'+dir,{recursive:true}))if(f.endsWith('.js'))assert.equal(ts.createSourceFile(f,read(root+'/'+dir+'/'+f),99,true).parseDiagnostics.length,0,f);
console.log('Prepared exact API overlay and single-entry web candidate');
