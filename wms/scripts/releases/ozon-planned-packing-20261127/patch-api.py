from pathlib import Path
import json,difflib,re
r=Path('D:/WMSFF/_Kof/work/ozon-planned-packing')
def replace(text,a,b):
 assert text.count(a)==1,(a[:100],text.count(a));return text.replace(a,b,1)
def emit(name,text):
 p=r/'api'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
manual={'modules/administration/administration-internal-api.service.js','modules/client-requests/ozon-supply-policy.js','modules/tsd/dto/fbo-action.dto.js','modules/tsd/fbo-two-stage.controller.js','modules/tsd/fbo-two-stage.service.js'}
for n in json.loads((r/'api-changes.json').read_text()):
 if n in manual:continue
 new=(r/'new'/n).read_text(encoding='utf-8')
 if not (r/'old'/n).exists():emit(n,new);continue
 a=(r/'old'/n).read_text(encoding='utf-8').splitlines(keepends=True);b=new.splitlines(keepends=True);out=(r/'live-api'/n).read_text(encoding='utf-8')
 for tag,i,j,k,l in reversed(difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes()):
  if tag=='equal':continue
  found=False
  for context in [3,2,1,0]:
   if not context and i==j:continue
   before=''.join(a[max(0,i-context):i]);after=''.join(a[j:min(len(a),j+context)]);needle=before+''.join(a[i:j])+after
   if needle and out.count(needle)==1:out=out.replace(needle,before+''.join(b[k:l])+after,1);found=True;break
  assert found,(n,i,tag)
 emit(n,out)
n='modules/administration/administration-internal-api.service.js';s=(r/'live-api'/n).read_text(encoding='utf-8')
for name,delta in [('client-requests',2),('tsd',1)]:
 pattern=r"(id: '"+name+r"',[\s\S]*?routeCount: )(\d+)";s,count=re.subn(pattern,lambda m:m[1]+str(int(m[2])+delta),s,count=1);assert count==1
emit(n,s)
n='modules/client-requests/ozon-supply-policy.js';s=(r/'live-api'/n).read_text(encoding='utf-8');new=(r/'new'/n).read_text(encoding='utf-8')
a=new.index('function assertSupplyMutable(');b=new.index('// FIX: an uncertain external',a)
c=s.index('function assertSupplyMutable(');d=s.index('// FIX: an uncertain external',c)
s='const ozon_packing_plan_1 = require("./ozon-packing-plan");\n'+s[:c]+replace(new[a:b],'(0, ozon_label_control_1.ozonLabelControlEnabled)()', 'ozonLabelControl.ozonLabelControlEnabled()')+s[d:];emit(n,s)
n='modules/tsd/dto/fbo-action.dto.js';s=(r/'live-api'/n).read_text(encoding='utf-8');new=(r/'new'/n).read_text(encoding='utf-8')
s=replace(s,'class FboActionDto {','class FboActionDto {\n    packingUnitId;')
end=new.index('], FboActionDto.prototype, "packingUnitId", void 0);')+len('], FboActionDto.prototype, "packingUnitId", void 0);');start=new.rfind('__decorate([',0,end)
s+='\n'+new[start:end]+'\n';emit(n,s)
n='modules/tsd/fbo-two-stage.controller.js';s=(r/'live-api'/n).read_text(encoding='utf-8');new=(r/'new'/n).read_text(encoding='utf-8')
end=new.index('], FboTwoStageController.prototype, "packingResolve", null);')+len('], FboTwoStageController.prototype, "packingResolve", null);');start=new.rfind('__decorate([',0,end)
s+='\nFboTwoStageController.prototype.packingResolve=function(id,body,user){return this.fbo.resolvePlannedPacking(id,body??{},user);};\n'+new[start:end]+'\n';emit(n,s)
n='modules/tsd/fbo-two-stage.service.js';s=(r/'live-api'/n).read_text(encoding='utf-8');new=(r/'new'/n).read_text(encoding='utf-8')
s='const ozon_packing_plan_1=require("../client-requests/ozon-packing-plan");\nconst ozon_supply_policy_1=require("../client-requests/ozon-supply-policy");\n'+s
method=new[new.index('    async resolvePlannedPacking('):new.index('    async eligible(')].replace('fbo_barcode_aliases_1','fboBarcodeAliases')
s=replace(s,'    constructor(prisma, scopes, balances, stock, lock, files) {',method+'    constructor(prisma, scopes, balances, stock, lock, files) {')
s=replace(s,'...(dto.relabelUnitId===undefined?[]:[dto.relabelUnitId])','...(dto.relabelUnitId===undefined?[]:[dto.relabelUnitId]),...(dto.packingUnitId===undefined?[]:[dto.packingUnitId])')
s=replace(s,'packingByProductSupported:','plannedPackingRequired:!!ozonShipment?.integration?.packingPlan,packingByProductSupported:')
a=s.index('packingSuggestions:')+len('packingSuggestions:');b=s.index(',directions:',a)
s=s[:a]+'ozonShipment?.integration?.packingPlan?ozon_packing_plan_1.plannedSuggestions(ozonShipment.integration.packingPlan,units,assembly?.boxes??[]):'+s[a:b]+s[b:]
s=replace(s,'                const directions=shipment?.directions;','                const directions=shipment?.directions;\n                const packingPlan=ozonShipment?.integration?.packingPlan;')
s=replace(s,'                const units = progress.units;','                const units = progress.units;\n                if(packingPlan&&["SORTED","CONFIRM_BOX","FINISH"].includes(dto.action))for(const box of packingPlan.boxes)ozon_packing_plan_1.assertPlannedBoxComplete(packingPlan,units,box.boxCode);')
a=s.index("else if (dto.action === 'PACK_PRODUCT')");b=s.index("else if (dto.action === 'PACK_UNIT')",a);part=s[a:b]
source=new[new.index("else if (dto.action === 'PACK_UNIT' || dto.action === 'PACK_PRODUCT')"):]
start=source.index('                    if (packingPlan && !packingPlan.boxes.some');end=source.index('                const target',start) if '                const target' in source[start:] else -1
# Reuse exact source guards, preserving every existing physical packing check.
check=source[start:source.index('const target =',start)]
part=replace(part,'                const target =',check+'const target =')
part=replace(part,'prepareOzonProductBox)(tx, id, target, dto.direction)','prepareOzonProductBox)(tx, id, target, dto.direction,packingPlan?.boxes.find(b=>b.boxCode===target.code)?.key)')
unit='const unit = units.find(u => !u.wholeBox'
part=replace(part,unit,'if(packingPlan&&!dto.packingUnitId)throw new common_1.ConflictException("Обновите ТСД: для плана нужна идентификация упаковываемой единицы.");\n                const unit = units.find(u => (!packingPlan||u.id===dto.packingUnitId)&&!u.wholeBox')
anchor='                if (directions)\n                    (0, ozon_fbo_directions_1.assertDirectionCapacity)'
part=replace(part,anchor,'                if(packingPlan)ozon_packing_plan_1.assertPlannedUnit(packingPlan,units,target.code,unit.id);\n'+anchor)
s=s[:a]+part+s[b:]
a=s.index("else if (dto.action === 'CLOSE_BOX')");b=s.index("else if (dto.action === 'SORTED')",a);part=s[a:b]
anchor='                    await tx.fboAssemblyBox.update({ where: { id: b.id }, data: { closedAt: new Date() } });'
part=replace(part,anchor,'                    if(packingPlan)ozon_packing_plan_1.assertPlannedBoxComplete(packingPlan,units,b.boxCode);\n'+anchor);s=s[:a]+part+s[b:]
emit(n,s)
print('Exact runtime overlays prepared; manual/fast-ack/receipt/picking paths preserved.')
