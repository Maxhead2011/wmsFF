"""FIX: exact client-KIZ reuse hooks over the verified current API, never a stale full build."""
from pathlib import Path
import sys

root=Path(sys.argv[1])
candidate=root/'candidate-current'
out=root/'api/payload'

def change(name,fn):
    p=candidate/name;s=p.read_text(encoding='utf8');v=fn(s)
    assert s!=v,name+' had no delta'
    p.write_bytes(v.encode());q=out/name;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(v.encode())
def once(s,a,b):
    assert s.count(a)==1,(a[:120],s.count(a))
    return s.replace(a,b)

def queue(s):
    s="const clientKizReview=require('./kiz-client-review');\n"+s
    a='async function queueKizReview(db, clientId, kiz, taskId, evidence) {'
    s=once(s,a,a+"\n    const strict=await clientKizReview.strictLegacyQueueDecision(db,clientId,kiz,taskId,evidence);if(strict!==null)return strict;")
    a='const rows = items.slice(0, 50).map(({ kiz, ...r }) => {'
    s=once(s,a,a+"\n            if(r.taskId.startsWith('GUARD:'))return {...r,...clientKizReview.clientReviewPresentation(r,user.activeWarehouseId)};")
    s=once(s,"if (!['REUSE', 'RELABEL'].includes(resolution) || !confirmed", "if (!['REUSE', 'RELABEL', 'REJECT'].includes(resolution) || !confirmed")
    a="        this.clients.requireClientAccess(user, row.clientId, 'write');"
    s=once(s,a,a+"\n        if(row.taskId.startsWith('GUARD:'))return clientKizReview.decideClientKizReview(this.db,this.clients,row,resolution,reason,confirmed,user);\n        if(resolution==='REJECT')throw new common_1.BadRequestException('Отказ доступен для обращения нового формата.');")
    return s

def marketplace(s):
    s="const clientKizReview=require('../../common/kiz-client-review');\nconst clientKizRegistry=require('../../common/kiz-client-registry');\n"+s
    start=s.index('    async scanFbsTsdKiz(');end=s.index('    async resolveFbsKizConflict(',start);part=s[start:end]
    a="        if (task.kiz && task.wbMetaStatus === 'ACCEPTED') {"
    part=once(part,a,a+"\n            if(await clientKizReview.assertFbsClientKiz(this.prisma,task,task.kiz,user)==='RELABEL')throw new common_1.ConflictException('Администратор назначил переклейку. Отложите товар.');")
    a="        if (kizFormatError) {\n            throw new common_1.BadRequestException(kizFormatError);\n        }"
    part=once(part,a,a+"\n        const clientKizDecision=await clientKizReview.assertFbsClientKiz(this.prisma,task,kiz,user);\n        if(clientKizDecision==='RELABEL')return this.proposeFbsPhysicalKizRelabel(task,kiz,user);")
    a='...await (0, kiz_physical_identity_1.physicalKizLookup)(this.prisma, kiz)'
    part=once(part,a,"...(clientKizRegistry.clientKizGuardEnabled()?{id:(await clientKizReview.clientPhysicalMark(this.prisma,task.clientId,kiz))?.id??'__no_client_mark__'}:await (0, kiz_physical_identity_1.physicalKizLookup)(this.prisma,kiz))")
    a='const duplicateCandidates = await this.prisma.fbsTsdAssembly.findMany({\n            where: {'
    part=once(part,a,a+'\n                ...(clientKizRegistry.clientKizGuardEnabled()?{clientId:task.clientId}:{}),')
    s=s[:start]+part+s[end:]
    for method in ['resolveFbsKizConflict','acceptSosWbKiz']:
        start=s.index('    async '+method+'(');end=s.index('\n    async ',start+10);part=s[start:end]
        a='        const orderId = numericWbOrderId(task.orderId);' if method=='resolveFbsKizConflict' else '        let mark = await this.prisma.productMark.findFirst({'
        part=once(part,a,"        if(await clientKizReview.assertFbsClientKiz(this.prisma,task,kiz,user)==='RELABEL')throw new common_1.ConflictException('Администратор назначил переклейку. Отложите товар.');\n"+a)
        if method=='acceptSosWbKiz':
            part=once(part,'...await (0, kiz_physical_identity_1.physicalKizLookup)(this.prisma, kiz)',"...(clientKizRegistry.clientKizGuardEnabled()?{id:(await clientKizReview.clientPhysicalMark(this.prisma,task.clientId,kiz))?.id??'__no_client_mark__'}:await (0, kiz_physical_identity_1.physicalKizLookup)(this.prisma,kiz))")
            a='const duplicate = await this.prisma.fbsTsdAssembly.findFirst({\n            where: {'
            part=once(part,a,a+'\n                ...(clientKizRegistry.clientKizGuardEnabled()?{clientId:task.clientId}:{}),')
        s=s[:start]+part+s[end:]
    # Persist refused shipment cases only after the stock transaction has rolled back.
    for marker in ["job.printedAt ?? undefined);", "print.printedAt ?? undefined);"]:
        point=s.index(marker);start=s.rindex('await this.prisma.$transaction(',0,point);end=s.index('}, { timeout: 30_000 });',point)+len('}, { timeout: 30_000 });')
        part=s[start:end]
        part=part.replace('await this.prisma.$transaction(', 'await clientKizReview.withClientKizReview(this.prisma,{id:task.workerUserId,name:task.workerName},()=>this.prisma.$transaction(',1)
        part=part[:-2]+'));'
        s=s[:start]+part+s[end:]
    a="await this.prisma.$transaction(tx => (0, wb_order_stock_lifecycle_1.finalizeWbOrderShipment)(tx, task.id, manuallyShipped ? 'WMS_REQUEST_SHIPPED' : 'WB_SHIPMENT_CONFIRMED', cleanJson(order)), { timeout: 30_000 });"
    s=once(s,a,"await clientKizReview.withClientKizReview(this.prisma,{id:task.workerUserId,name:task.workerName},()=>this.prisma.$transaction(tx => (0, wb_order_stock_lifecycle_1.finalizeWbOrderShipment)(tx, task.id, manuallyShipped ? 'WMS_REQUEST_SHIPPED' : 'WB_SHIPMENT_CONFIRMED', cleanJson(order)), { timeout: 30_000 }));")
    a='        const kiz = remoteKizValues[0];'
    s=once(s,a,a+"\n        if(await clientKizReview.assertFbsClientKiz(this.prisma,task,kiz,user)==='RELABEL')throw new common_1.ConflictException('Администратор назначил переклейку. Отложите товар.');")
    s=s.replace('...await (0, kiz_physical_identity_1.physicalKizLookup)(this.prisma, kiz)', "...(clientKizRegistry.clientKizGuardEnabled()?{id:(await clientKizReview.clientPhysicalMark(this.prisma,task.clientId,kiz))?.id??'__no_client_mark__'}:await (0, kiz_physical_identity_1.physicalKizLookup)(this.prisma,kiz))")
    s=s.replace('...await (0, kiz_physical_identity_1.physicalKizLookup)(tx, task.kiz, false)', "...(clientKizRegistry.clientKizGuardEnabled()?{id:(await clientKizReview.clientPhysicalMark(tx,task.clientId,task.kiz))?.id??'__no_client_mark__'}:await (0, kiz_physical_identity_1.physicalKizLookup)(tx,task.kiz,false))")
    # Completed/new external submission uses the same permission, including tasks picked before deployment.
    start=s.index('    async completeFbsTsdAssembly(');end=s.index('\n    async ',start+10);part=s[start:end]
    a="        if (task.marketplace === client_1.MarketplaceType.OZON && !task.marketplaceSubmittedAt) {"
    part=once(part,a,"        if(task.kiz)await clientKizReview.assertFbsClientKiz(this.prisma,task,task.kiz,user);\n"+a)
    s=s[:start]+part+s[end:]
    return s

def fbo(s):
    s="const clientKizReview=require('../../common/kiz-client-review');\nconst clientKizRegistry=require('../../common/kiz-client-registry');\n"+s
    a='const identity = (value) => (0, kiz_physical_identity_1.physicalKizIdentity)(value) || value.trim();'
    s=once(s,a,'const identity = (value) => (clientKizRegistry.clientKizGuardEnabled()?clientKizRegistry.clientKizIdentity(value):(0, kiz_physical_identity_1.physicalKizIdentity)(value)) || value.trim();')
    start=s.index('    async executeAction(');end=s.index('    async packingProgress(',start);part=s[start:end]
    a='            catch (error) {'
    part=once(part,a,a+"\n                if(error instanceof clientKizReview.ClientKizReviewRequired||error?.clientKizAmbiguity){await clientKizReview.queueFboKizError(this.prisma,id,error,user);throw error;}")
    a='                        if (pick.mark) {\n                            const resolved'
    part=once(part,a,"                        if (pick.mark) {\n                            await clientKizReview.assertClientKizUse(tx,{scope:'FBO',clientId:r.clientId,warehouseId:r.warehouseId,requestId:r.id,kiz:pick.mark.value,skuId:pick.skuId,boxId:source.id},user);\n                            const resolved")
    part=part.replace('this.exactMark(tx, dto.kiz)','this.exactMark(tx, dto.kiz, r.clientId)').replace('this.exactMark(tx, pick.mark.value)','this.exactMark(tx, pick.mark.value, r.clientId)')
    part=part.replace('this.exactMark.bind(this)','(db,code)=>this.exactMark(db,code,r.clientId)')
    a="else if (dto.action === 'FINISH') {"
    part=once(part,a,a+"\n                    await clientKizReview.assertClientRequestKizShipment(tx,r,user);")
    s=s[:start]+part+s[end:]
    a='    async exactMark(tx, kiz) {'
    s=once(s,a,"    async exactMark(tx,kiz,clientId) {\n        if(clientKizRegistry.clientKizGuardEnabled()&&clientId){const mark=await clientKizReview.clientPhysicalMark(tx,clientId,kiz);if(!mark)throw new common_1.ConflictException('КИЗ не найден у клиента.');return mark;}")
    start=s.index('    async bindPickedMark(');end=s.index('    async exactMark(',start);part=s[start:end]
    a='    async bindPickedMark(tx, r, skuId, boxId, kiz, key, user) {'
    part=once(part,a,a+"\n        const guardInput={scope:'FBO',clientId:r.clientId,warehouseId:r.warehouseId,requestId:r.id,kiz,skuId,boxId};\n        await clientKizReview.assertClientKizUse(tx,guardInput,user);")
    part=once(part,'const physical = (0, kiz_physical_identity_1.physicalKizIdentity)(kiz);', 'const physical = clientKizRegistry.clientKizGuardEnabled()?clientKizRegistry.clientKizIdentity(kiz):(0, kiz_physical_identity_1.physicalKizIdentity)(kiz);')
    part=once(part,"[physical, ']d2' + physical, ']D2' + physical].map", "(clientKizRegistry.clientKizGuardEnabled()?clientKizRegistry.clientKizPrefixes(physical):[physical, ']d2' + physical, ']D2' + physical]).map")
    part=once(part,"const filter = { OR: prefixes.map(p => ({ kiz: { startsWith: p } })) };", "const filter = { OR: prefixes.map(p => ({ kiz: { startsWith: p } })) };\n        const clientScope=clientKizRegistry.clientKizGuardEnabled()?{clientId:r.clientId}:{};")
    part=once(part,'where: { OR: prefixes.map(p => ({ value: { startsWith: p } })) }','where: { ...clientScope, OR: prefixes.map(p => ({ value: { startsWith: p } })) }')
    part=once(part,"where: { ...filter, state: { not: 'RETURNED' } }", "where: { ...filter, ...(clientKizRegistry.clientKizGuardEnabled()?{assembly:{request:{clientId:r.clientId}}}:{}), state: { not: 'RETURNED' } }")
    part=once(part,'where: filter','where: {...filter,...clientScope}')
    part=once(part,"for (const unit of oldUnits.filter(u => u.assembly.phase !== 'COMPLETED'))", "for (const unit of oldUnits.filter(u => !clientKizRegistry.clientKizGuardEnabled() && u.assembly.phase !== 'COMPLETED'))")
    part=once(part,'        return mark;','        await clientKizReview.refreshClientKizClaim(tx,guardInput,mark);\n        return mark;')
    s=s[:start]+part+s[end:]
    # Manual packing is another pick entry point; guard both known marks and inferred stock.
    a="        if (existing?.wholeBox) {"
    s=once(s,a,"        await clientKizReview.assertClientKizUse(tx,{scope:'FBO',clientId:r.clientId,warehouseId:r.warehouseId,requestId:r.id,kiz:mark.value,skuId:mark.skuId,boxId:existing?.sourceBoxId||mark.boxId},user);\n"+a)
    start=s.index('    async manualPackingMark(');end=s.index('    async box(',start);part=s[start:end]
    a="        const key = identity(dto.kiz);"
    part=once(part,a,a+"\n        if(clientKizRegistry.clientKizGuardEnabled()){const mark=await clientKizReview.clientPhysicalMark(tx,r.clientId,dto.kiz);if(mark)return mark;}")
    part=once(part,"where: { OR: [key, ']d2' + key, ']D2' + key]", "where: { ...(clientKizRegistry.clientKizGuardEnabled()?{clientId:r.clientId}:{}), OR: [key, ']d2' + key, ']D2' + key]")
    a='            const mark = await tx.productMark.create({ data: { clientId: r.clientId, skuId: sku.id, boxId: source.id,'
    part=once(part,a,"            const guardInput={scope:'FBO',clientId:r.clientId,warehouseId:r.warehouseId,requestId:r.id,kiz:dto.kiz,skuId:sku.id,boxId:source.id};\n            await clientKizReview.assertClientKizUse(tx,guardInput,user);\n"+a)
    part=once(part,'            return mark;', '            await clientKizReview.refreshClientKizClaim(tx,guardInput,mark);\n            return mark;')
    a='        const dimensions = { clientId: r.clientId, warehouseId: r.warehouseId, skuId: sku.id, boxId: source.id, palletId: source.palletId, status: \'AVAILABLE\' };'
    part=once(part,a,"        const guardInput={scope:'FBO',clientId:r.clientId,warehouseId:r.warehouseId,requestId:r.id,kiz:dto.kiz,skuId:sku.id,boxId:source.id};\n        await clientKizReview.assertClientKizUse(tx,guardInput,user);\n"+a)
    part=once(part,'        return mark;\n    }','        await clientKizReview.refreshClientKizClaim(tx,guardInput,mark);\n        return mark;\n    }')
    s=s[:start]+part+s[end:]
    return s

def unboxed(s):
    s="const clientKizReview=require('../../common/kiz-client-review');\n"+s
    a='    const mark = dto.kiz ? await exactMark(tx, dto.kiz) : null;'
    return once(s,a,a+"\n    if(mark)await clientKizReview.assertClientKizUse(tx,{scope:'FBO',clientId:r.clientId,warehouseId:r.warehouseId,requestId:r.id,kiz:mark.value,skuId:line.skuId,boxId:null},user);")

change('common/kiz-review-queue.js',queue)
change('modules/marketplace-connections/marketplace-connections.service.js',marketplace)
change('modules/tsd/fbo-two-stage.service.js',fbo)
change('modules/tsd/fbo-unboxed-picking.js',unboxed)
