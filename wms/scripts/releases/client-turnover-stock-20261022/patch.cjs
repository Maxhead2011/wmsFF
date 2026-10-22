const fs=require('fs'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const r=process.argv[2];function replace(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b)}
let a=fs.readFileSync(r+'/api-base/modules/turnover/turnover.service.js','utf8').replaceAll('\r\n','\n');
a=replace(a,'async getStockXlsx(query, user) {\n        this.requireInternalStatisticsAccess(user);','async getStockXlsx(query, user) {\n        // FIX: controller stock:read and existing client/warehouse scopes protect reads.');
fs.mkdirSync(r+'/api/modules/turnover',{recursive:true});fs.writeFileSync(r+'/api/modules/turnover/turnover.service.js',a);
const old='receipt-manager-20261022.js',next='client-turnover-stock-20261022.js';let s=fs.readFileSync(r+'/web-base/assets/'+old,'utf8');
s=replace(s,'je=x.useMemo(()=>m8(t.user.roleCodes,t.user.permissionCodes),[t.user]),Pe=','je=x.useMemo(()=>m8(t.user.roleCodes,t.user.permissionCodes),[t.user]),canReadStock=je||t.user.permissionCodes.includes("stock:read"),Pe=');
s=replace(s,'(n==="stats"||n==="stockExport")&&!je','n==="stats"&&!je||n==="stockExport"&&!canReadStock');
s=replace(s,'[n,je,Pe])','[n,je,Pe,canReadStock])');
s=replace(s,'je?e.jsx(ui,{active:!1,index:6,','canReadStock?e.jsx(ui,{active:!1,index:6,');
s=replace(s,'n==="stockExport"&&je?','n==="stockExport"&&canReadStock?');
assert.equal(ts.createSourceFile('x',s,99,true).parseDiagnostics.length,0);
fs.mkdirSync(r+'/web/assets',{recursive:true});fs.writeFileSync(r+'/web/assets/'+next,s);
let html=fs.readFileSync(r+'/web-base/index.html','utf8');html=html.replaceAll('/assets/'+old,'/assets/'+next).replace('{"imports":{','{"imports":{"/assets/'+old+'":"/assets/'+next+'",');fs.writeFileSync(r+'/web/index.html',html);fs.writeFileSync(r+'/web-changes.json',JSON.stringify(['index.html','assets/'+next]));
