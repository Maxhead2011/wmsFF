"""FIX: surgical receipt deltas over the freshly verified runtime, never full service replacement."""
from pathlib import Path
import argparse

def replace_once(s, old, new):
    if s.count(old) != 1: raise ValueError('Expected one exact receipt anchor: '+old[:100])
    return s.replace(old,new,1)

def section(s, start, end, apply):
    a=s.index(start); b=s.index(end,a)
    return s[:a]+apply(s[a:b])+s[b:]

def patch(base,out):
    changed=[]
    def load(name):
        p=out/name
        return (p if p.exists() else base/name).read_text(encoding='utf8')
    def save(name,s):
        if 'const _kClient = ' not in s:
            s='const _kClient = require("../../common/kiz-client-registry");\n'+s
        p=out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(s.encode());changed.append(name)
    name='modules/stock/stock-operations.service.js';s=load(name)
    def receive(t):
        t=replace_once(t,'            const kiz = dto.kiz?.trim();', '''            const kiz = dto.kiz?.trim();
            // FIX: serialized identity claim precedes stock writes; a replay stays ALREADY_APPLIED.
            if (kiz && _kClient.clientKizGuardEnabled()) {
                if(dto.quantity!==1) throw new common_1.BadRequestException('Один КИЗ соответствует одной единице товара.');
                const fresh = await _kClient.assertNewReceiptKiz(tx,{clientId:dto.clientId,kiz,operationKey:dto.idempotencyKey,warehouseId:operationWarehouseId});
                if(!fresh) return {idempotencyKey:dto.idempotencyKey,status:'ALREADY_APPLIED'};
            }''')
        t=replace_once(t,'            if (kiz) {\n                const existingKiz', '            if (kiz && !_kClient.clientKizGuardEnabled()) {\n                const existingKiz')
        t=replace_once(t,'                    throw caught;\n                }\n            }\n            return {', '''                    throw caught;
                }
                await _kClient.recordClientKizReceipt(tx,{clientId:dto.clientId,kiz,operationKey:dto.idempotencyKey,
                    warehouseId:box?.warehouseId??operationWarehouseId,skuId:sku.id,boxCode:box?.code,productName:sku.name,
                    barcode:dto.barcode,receivedAt:movement.createdAt,sourceDocument:dto.sourceDocument,userId:user.id,
                    source:movementType==='RECEIPT'?'RECEIPT':'LEGACY_UNKNOWN'});
            }
            return {''')
        return t
    save(name,section(s,'    async receiveIntoBox(', '    async adjustInventoryToCounted(',receive))

    name='modules/tsd/tsd-receipt.service.js';s=load(name)
    def check(t):
        return replace_once(t,'        const warehouseId = this.resolveWritableWarehouseId(user);','''        const warehouseId = this.resolveWritableWarehouseId(user);
        if(_kClient.clientKizGuardEnabled()) {
            const duplicateInfo=await _kClient.lookupClientKiz(this.prisma,clientId,kiz,warehouseId);
            return {clientKizGuardEnabled:true,duplicate:!!duplicateInfo,kiz,code:duplicateInfo?'KIZ_DUPLICATE':undefined,duplicateInfo,
                boxCode:duplicateInfo?.firstBoxCode??duplicateInfo?.currentBoxCode??null,skuName:duplicateInfo?.productName??null,
                message:duplicateInfo?_kClient.receiptKizDuplicateMessage(duplicateInfo):'КИЗ свободен.'};
        }''')
    s=section(s,'    async checkKiz(', '    async closeBox(',check)
    s=replace_once(s,'    async closeBox(','''    async queueKizReview(body,user) {
        return require('../../common/kiz-client-review').queueReceiptKizReview(this.prisma,this.clientScopes,body,user);
    }
    async closeBox(''')
    save(name,s)

    name='modules/tsd/tsd-review.service.js';s=load(name)
    def review(t):
        t=replace_once(t,'    async acceptReceiptWithError(operation, dto, user) {','    async acceptReceiptWithError(operation, dto, user, guardTx) {')
        t=replace_once(t,"        this.clientScopes.requireClientAccess(user, payload.clientId, 'write');",'''        this.clientScopes.requireClientAccess(user, payload.clientId, 'write');
        if(_kClient.clientKizGuardEnabled() && payload.kiz && !guardTx) {
            return _kClient.withReceiptErrorKizGuard(this.prisma,{clientId:payload.clientId,kiz:payload.kiz,
                operationKey:`${operation.operationKey}:accepted-with-error`,warehouseId:user.activeWarehouseId,
                skuId:payload.skuId,barcode:payload.barcode,sourceDocument:payload.sourceDocument,userId:user.id},
                tx=>this.acceptReceiptWithError(operation,dto,user,tx));
        }
        const db=guardTx??this.prisma;''')
        t=replace_once(t,'await this.prisma.productMark.findFirst(', 'await db.productMark.findFirst(')
        t=replace_once(t,'await this.prisma.tsdOperation.update(', 'await db.tsdOperation.update(')
        return replace_once(t,'        }, user);', '        }, user, ...(guardTx ? [guardTx] : []));')
    save(name,section(s,'    async acceptReceiptWithError(', '    listReviewHistory(',review))

    name='modules/imports/imports.service.js';s=load(name)
    s=section(s,'    async previewReceiptWorkbook(', '    previewLogisticsWorkbook(',lambda t:replace_once(t,
      'await this.duplicateKizIssues(parsed.items)', 'await this.duplicateKizIssues(parsed.items,user.activeWarehouseId)'))
    def commit(t):
        t=replace_once(t,'await this.duplicateKizIssues(parsed.items)','await this.duplicateKizIssues(parsed.items,warehouseId)')
        t=replace_once(t,'            for (const item of parsed.items) {','''            for (const item of parsed.items) {
                if(_kClient.clientKizGuardEnabled()) await _kClient.assertNewReceiptKiz(tx,{clientId:item.clientId,kiz:item.kiz,
                    operationKey:['receipt-import',options.sourceDocument,item.sourceRow,item.boxCode,item.kiz].join(':'),warehouseId});''')
        return replace_once(t,'                counters.boxesTouched += 1;','''                await _kClient.recordClientKizReceipt(tx,{clientId:item.clientId,kiz:item.kiz,operationKey:movement.idempotencyKey,
                    warehouseId,skuId:sku.id,boxCode:box.code,productName:sku.name,barcode:item.barcode,receivedAt:movement.createdAt,
                    sourceDocument:options.sourceDocument,userId:options.user.id});
                counters.boxesTouched += 1;''')
    s=section(s,'    async commitReceiptWorkbook(', '    readFirstSheet(',commit)
    s=replace_once(s,'    async duplicateKizIssues(items) {','''    async duplicateKizIssues(items,warehouseId) {
        if(_kClient.clientKizGuardEnabled()) {
            const seen=new Set(),issues=[];
            for(const item of items) {
                const identity=_kClient.clientKizIdentity(item.kiz),key=JSON.stringify([item.clientId,identity]);
                if(!identity) issues.push({row:item.sourceRow,message:'Не распознан GTIN и серийный номер КИЗ.',severity:'error'});
                else if(seen.has(key)) issues.push({row:item.sourceRow,message:'ДУБЛЬ КИЗ внутри файла. Один КИЗ может быть принят только один раз.',severity:'error'});
                else { const prior=await _kClient.lookupClientKiz(this.prisma,item.clientId,item.kiz,warehouseId);
                    if(prior) issues.push({row:item.sourceRow,message:_kClient.receiptKizDuplicateMessage(prior),severity:'error'}); }
                seen.add(key);
            }
            return issues;
        }''')
    save(name,s)

    name='modules/warehouse/warehouse.service.js';s=load(name)
    def edit(t):
        t=replace_once(t,'            this.assertBoxWarehouse(warehouseId, movement.box);','''            this.assertBoxWarehouse(warehouseId, movement.box);
            const previousKiz=movement.productMarks[0]?.value;
            if(_kClient.clientKizGuardEnabled()) {
                if((kiz||previousKiz) && (quantity??movement.quantity)!==1) throw new common_1.BadRequestException('Один КИЗ соответствует одной единице товара.');
                if(kiz && _kClient.clientKizIdentity(kiz)!==_kClient.clientKizIdentity(previousKiz??''))
                    await _kClient.assertNewReceiptKiz(tx,{clientId:movement.clientId,kiz,operationKey:`receipt-edit:${id}:${_kClient.clientKizIdentity(kiz)}`,warehouseId:warehouseId??movement.box.warehouseId});
            }''')
        return replace_once(t,"            await this.recordReceiptAdminOperation('receipt_scan', user, {",'''            if(_kClient.clientKizGuardEnabled() && kiz && _kClient.clientKizIdentity(kiz)!==_kClient.clientKizIdentity(previousKiz??'')) {
                const receiptSku=await tx.sku.findUnique({where:{id:movement.skuId},select:{name:true}});
                await _kClient.recordClientKizReceipt(tx,{clientId:movement.clientId,kiz,operationKey:`receipt-edit:${id}:${_kClient.clientKizIdentity(kiz)}`,
                    warehouseId:warehouseId??movement.box.warehouseId,skuId:movement.skuId,productName:receiptSku?.name,userId:user.id,
                    source:'CORRECTION',sourceDocument:movement.sourceDocument});
            }
            await this.recordReceiptAdminOperation('receipt_scan', user, {''')
    save(name,section(s,'    async updateOnlineReceiptItem(', '    resolveWarehouseScope(',edit))
    return changed

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();print('\n'.join(patch(a.base,a.out)))
