const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), assert=require('node:assert/strict');
const ts=require('typescript'), wms=path.resolve(__dirname,'../..'), dir=path.join(process.argv[2],'modules/marketplace-connections');
const file=path.join(dir,'marketplace-connections.service.js'), original=fs.readFileSync(file,'utf8');
assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'e083fcc8ed2beab57ec5e7bad300a833756f38144dda4eee56fa749dd4508340','Verify the newer live base before preparing an overlay');
const mod='wb-linked-status-refresh', input=fs.readFileSync(path.join(wms,'apps/api/src/modules/marketplace-connections',mod+'.ts'),'utf8');
const compiled=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const init='        this.catalogStopped = false;',stop='    async onModuleDestroy() {';
assert.equal(original.split(init).length,2);assert.equal(original.split(stop).length,2);
const code=original.replace(init,`        if (process.env.WMS_WB_LINKED_STATUS_REFRESH === 'true') {
            const {refreshLinkedWbStatuses,startLinkedWbRefresh}=require('./wb-linked-status-refresh');
            const warn=message=>this.logger.warn(message);
            this.stopLinkedWbRefresh=startLinkedWbRefresh(stopped=>refreshLinkedWbStatuses(this.prisma,(key,ids)=>wildberries_request_scheduler_1.runWithWildberriesRequestPriority('background',()=>this.readWbStatusesForConnection(key,ids)),fbsOrderCategory,warn,stopped),warn);
        }
`+init).replace(stop,stop+'\n        await this.stopLinkedWbRefresh?.();');
fs.writeFileSync(path.join(dir,mod+'.js'),compiled);fs.writeFileSync(file,code);
