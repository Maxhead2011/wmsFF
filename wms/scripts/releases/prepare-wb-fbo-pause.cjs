const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=process.argv[2],wms=path.resolve(__dirname,'../..'),p=path.join(root,'wb-fbo-supply.service.js');let s=fs.readFileSync(p,'utf8');
const from="response = await fetch('https://supplies-api.wildberries.ru",to="response = await (process.env.WMS_WB_FBO_REQUEST_PAUSE === 'true' ? (url,init)=>require('./wb-fbo-request-pause').wbFboPausedFetch(this.db,c.clientId,()=>fetch(url,init)) : fetch)('https://supplies-api.wildberries.ru";
assert.equal(s.split(from).length,2);s=s.replace(from,to);
const catchFrom="catch {\n            throw new common_1.BadGatewayException('Нет ответа WB. Повторите проверку.');";
assert.equal(s.split(catchFrom).length,2);s=s.replace(catchFrom,"catch (e) {\n            if(e instanceof common_1.BadGatewayException) throw e;\n            throw new common_1.BadGatewayException('Нет ответа WB. Повторите проверку.');");
fs.writeFileSync(p,s);
fs.writeFileSync(path.join(root,'wb-fbo-request-pause.js'),ts.transpileModule(fs.readFileSync(path.join(wms,'apps/api/src/modules/client-requests/wb-fbo-request-pause.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
console.log('Prepared two-module overlay; verify current deployed base before publication');
