// FIX: three precise runtime changes on the verified API baseline.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=process.argv[2],dir=path.join(root,'modules/marketplace-connections');
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b)};
let s=fs.readFileSync(path.join(dir,'marketplace-connections.service.js'),'utf8');
s=replace(s,'    async scopeFbsOrdersForUser(response, user, allBranches = false, displayWarehouseId) {',`    async restoreFbsAwaitingForDisplay(clientId,response,user,allBranches=false,displayWarehouseId) {
        if(process.env.WMS_FBS_ACTION_STATUS_ENABLED!=='true')return response;
        this.clientScopes.requireClientAccess(user,clientId,'read');
        const restored=await (0,fbs_saved_archive_1.restoreSavedFbsArchive)(this.prisma,clientId,response,undefined,undefined,true);
        return this.scopeFbsOrdersForUser(restored,user,allBranches,displayWarehouseId);
    }
    async scopeFbsOrdersForUser(response, user, allBranches = false, displayWarehouseId) {`);fs.writeFileSync(path.join(dir,'marketplace-connections.service.js'),s);
s=fs.readFileSync(path.join(dir,'marketplace-connections.controller.js'),'utf8');s=replace(s,"const scoped = (view === 'snapshot' || view === 'archive')","let scoped = (view === 'snapshot' || view === 'archive')");s=replace(s,'        const archived = view === "archive" ?',`        scoped = await this.connections.restoreFbsAwaitingForDisplay(clientId,scoped,user,allBranches === "1",displayWarehouseId);
        const archived = view === "archive" ?`);fs.writeFileSync(path.join(dir,'marketplace-connections.controller.js'),s);
const source=fs.readFileSync('wms/apps/api/src/modules/marketplace-connections/fbs-saved-archive.ts','utf8');fs.writeFileSync(path.join(dir,'fbs-saved-archive.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
