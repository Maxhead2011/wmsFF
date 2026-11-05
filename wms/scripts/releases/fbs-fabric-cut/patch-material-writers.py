"""Prepare (never deploy) the three PR864 runtime-only material writers.

Usage: python patch-material-writers.py SNAPSHOT_DIST NEW_OUTPUT_DIST
The output directory must not exist. Compiled fabric-fbs helpers are supplied by
the separate candidate assembly step. Never point output at a running service.
"""
import hashlib
from pathlib import Path
import sys

HASHES = {
    'fabric-rolls.js': '3a62d1655ce76d4d9b5e0879bcae394f178b0265ee08bfaaa8a57d882cd00f17',
    'fabric-shipment-accounting.js': '46a84633891de99a8fc4da45ba0e35b9a76592ef9ef146dd2b1e3960666862db',
    'fabric-roll-storage.js': 'aafec7a1809e2b40dce2eeadb6e5b507690527e7fc782c3ca0087be54f267213',
}

def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Runtime anchor differs: ' + old[:100])
    return text.replace(old, new, 1)

def patch(name, text):
    if name == 'fabric-rolls.js':
        text = once(text, 'const after=applyRollAction(before,dto,sku,warehouseId);',
            "const after=applyRollAction(before,dto,sku,warehouseId);\n"
            "   // FIX: existing reservations stay protected even with assignment disabled.\n"
            "   if(before.fbsReservations?.length)require('./fabric-fbs-protection').assertFabricMutationPreservesReservations(before,after);")
        anchor = "await tx.systemSetting.upsert({where:{key:'fabric.rolls.enabled.v1:'+id}"
        text = once(text, anchor,
            "if(!dto.enabled){const saved=await tx.systemSetting.findUnique({where:{key:this.key(id)}});"
            "if(saved?.value?.fbsReservations?.some(r=>!r.released&&r.confirmedUnits<r.units))"
            "throw new C.ConflictException('Есть резервы ткани ФБС. Сначала завершите или отмените соответствующие заказы.');}\n   " + anchor)
    elif name == 'fabric-roll-storage.js':
        text = once(text, "'FABRIC_ROLL_WRITE_OFF']", "'FABRIC_ROLL_WRITE_OFF','FABRIC_FBS_CUT']")
    else:
        text = once(text, "const VOLUME=24.740;", "const VOLUME=24.740;\nconst {freeFabricMm,fabricCreditMatches}=require('./fabric-fbs-protection');")
        text = once(text, 'for(const c of credits){',
            "// FIX: bound production belongs to this task, never an earlier order of the same SKU.\n"
            "  for(const c of [...credits].sort((a,b)=>Number(!!b.taskId)-Number(!!a.taskId))){\n"
            "   if(c.taskId&&!fabricCreditMatches(c,e))continue;")
        text = once(text, 'const amount=Math.min(needed,r.remainingMm);',
            'const amount=Math.min(needed,state.fbsReservations?.length?freeFabricMm(state,r.id):r.remainingMm);')
        text = once(text, 'select:{id:true,requestId:true,skuId:true,warehouseId:true,quantity:true,shippedAt:true}',
            'select:{id:true,requestId:true,skuId:true,warehouseId:true,quantity:true,shippedAt:true,connectionId:true,orderId:true,assemblyId:true}')
        text = once(text, "key:'wb:'+f.id,requestId:f.requestId,", "key:'wb:'+f.id,requestId:f.requestId,marketplace:'WILDBERRIES',connectionId:f.connectionId,orderId:f.orderId,taskId:f.assemblyId,")
        text = once(text, 'const result=planShipments(before,events,credits);',
            "// FIX: only audited PACKING production is a bound credit.\n"
            " const produced=before.fbsOrders?await tx.auditLog.findMany({where:{entity:'FabricRolls',entityId:clientId,action:'FABRIC_FBS_CUT'},select:{payload:true}}):[];\n"
            " for(const row of produced){const c=row.payload;"
            "if(!c||c.clientId!==clientId||!fabricCreditMatches(c,c)||!Number.isFinite(Date.parse(c.at)))throw new ConflictException('Некорректная история нарезки ФБС.');"
            "credits.push({...c,at:c.at});}\n"
            " const result=planShipments(before,events,credits);")
    return text

def main():
    source, target = map(Path, sys.argv[1:])
    if target.exists():
        raise ValueError('Output must be a new directory')
    outputs = {}
    for name, expected in HASHES.items():
        data = (source / 'modules/warehouse' / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Rebase required: ' + name)
        outputs[name] = patch(name, data.decode('utf-8'))
    directory = target / 'modules/warehouse'
    directory.mkdir(parents=True)
    for name, text in outputs.items():
        with (directory / name).open('w', encoding='utf-8', newline='') as handle:
            handle.write(text)
    print('Prepared 3 material writer modules; not deployed')

if __name__ == '__main__':
    main()
