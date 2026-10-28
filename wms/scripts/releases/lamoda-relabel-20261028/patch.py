# FIX: preserve published-only code; apply reviewed unique compiler hunks, never whole modules.
from pathlib import Path
import json,sys,difflib,re
r=Path(sys.argv[1]);result={}
for name,v in json.loads((r/'compiled.json').read_text(encoding='utf-8')).items():
 p=r/'runtime-lamoda-counts'/name
 if v['old'] is None:result[name]=v['next'];continue
 s=p.read_text(encoding='utf-8')
 if name=='modules/administration/administration-internal-api.service.js':
  before='routeCount: 101, // FIX: compact FBO acknowledgement and read-only operation-status handlers.'
  assert s.count(before)==1
  result[name]=s.replace(before,'routeCount: 103, // FIX: two Lamoda unit-label endpoints added to the published registry.')
  continue
 if name=='modules/tsd/dto/fbo-action.dto.js':
  before="(0, class_validator_1.IsIn)(['START',"
  assert s.count(before)==1
  s=s.replace(before,"(0, class_validator_1.IsIn)(['RELABEL_UNIT', 'START',")
  s+='\n__decorate([(0,class_validator_1.IsOptional)(),(0,class_validator_1.IsString)(),(0,class_validator_1.MaxLength)(100),__metadata("design:type",String)],FboActionDto.prototype,"relabelUnitId",void 0);\n'
  result[name]=s;continue
 if name=='modules/tsd/fbo-two-stage.controller.js':
  new=v['next'];start=new.index('__decorate([\n    (0, common_1.Get)(\'lamoda-relabel/stations\')');end=new.index('__decorate([\n    (0, common_1.Get)()',start)
  s+='\nFboTwoStageController.prototype.relabelStations=function(id,user){return this.fbo.relabelStations(id,user);};\nFboTwoStageController.prototype.relabelPrint=function(id,body,user){return this.fbo.printLamodaRelabel(id,body??{},user);};\n'+new[start:end]
  result[name]=s;continue
 old=v['old'].splitlines(True);new=v['next'].splitlines(True)
 for group in difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(2):
  before=''.join(old[group[0][1]:group[-1][2]]);after=''.join(new[group[0][3]:group[-1][4]])
  if name=='modules/tsd/fbo-two-stage.service.js' and 'const unit = units.find' in before:
   pattern=r"const unit = units\.find\(u => !u\.wholeBox && u\.state === 'PICKED'[^\n]+;"
   matches=list(re.finditer(pattern,s));assert len(matches)==2 # published PACK_PRODUCT and PACK_UNIT branches
   start=after.index('                const unit =');end=after.index('                if (!unit)',start)
   value=after[start:end].replace('(0, fbo_barcode_aliases_1.fboBarcodeMatches)','fboBarcodeAliases.fboBarcodeMatches')
   for m in reversed(matches):s=s[:m.start()]+value+'\nif(unit) lamoda_fbo_relabel_1.assertLamodaRelabelPacked(relabelRequired,unit.lamodaRelabelConfirmedAt);\n'+s[m.end():]
   continue
  if name=='modules/tsd/fbo-two-stage.service.js' and 'for (const unit of picked)' in after:
   pattern=r"const picked = units\.filter\(u => u\.wholeBox && u\.sourceBoxId === box\.id && u\.state === 'PICKED'\);"
   matches=list(re.finditer(pattern,s));assert len(matches)==1;m=matches[0]
   s=s[:m.end()]+'\nfor(const unit of picked) lamoda_fbo_relabel_1.assertLamodaRelabelPacked(relabelRequired,unit.lamodaRelabelConfirmedAt);\n'+s[m.end():];continue
  if name=='modules/tsd/fbo-two-stage.service.js' and "else if (dto.action === 'RELABEL_UNIT')" in after:
   start=after.index("else if (dto.action === 'RELABEL_UNIT')");end=after.index("else if (dto.action !== 'START')",start)
   anchor="else if (dto.action !== 'START')";assert s.count(anchor)==1;s=s.replace(anchor,after[start:end]+anchor);continue
  if name=='modules/tsd/fbo-two-stage.service.js' and '...(dto.relabelUnitId' in after:
   anchor='...(dto.undoOperationId===undefined?[]:[dto.undoOperationId])';assert s.count(anchor)==1
   s=s.replace(anchor,anchor+',...(dto.relabelUnitId===undefined?[]:[dto.relabelUnitId])');continue
  if name=='modules/tsd/fbo-two-stage.service.js' and "dto.action.startsWith('MANUAL_')" in after:
   start=after.index('            const relabelRequired');end=after.index('            const directionBoxes',start)
   anchors=list(re.finditer(r'const directionBoxes\s*=\s*directions\s*\?',s));assert len(anchors)==1
   at=anchors[0].start();s=s[:at]+after[start:end]+s[at:];continue
  if name=='modules/tsd/fbo-two-stage.service.js' and before.startswith('exports.FboTwoStageService = void 0;'):
   for var,mod in [('lamoda_fbo_policy_1','../lamoda/lamoda-fbo-policy'),('lamoda_fbo_relabel_1','./lamoda-fbo-relabel'),('tsd_relabel_label_1','./tsd-relabel-label')]:
    if not re.search(r'const '+var+r'\s*=',s):s+='\nconst '+var+' = require("'+mod+'");\n'
   continue
  if name=='modules/tsd/fbo-two-stage.service.js' and 'relabelUnits: relabelUnits.map' in after:
   start=after.index('            relabelRequired,');end=after.index('            // FIX: only',start)
   anchor="marketplace:yandex?'YANDEX_MARKET':lamoda?'LAMODA':shipment?'OZON':'WILDBERRIES',"
   assert s.count(anchor)==1;s=s.replace(anchor,anchor+'\n'+after[start:end]);continue
  if name=='modules/tsd/fbo-two-stage.service.js' and 'const relabelJobs =' in after:
   start=after.index('        // FIX: a persisted requirement');end=after.index('        // FIX: expose persisted',start)
   anchor='const units = assembly?.units ?? [];';assert s.count(anchor)==1;s=s.replace(anchor,anchor+'\n'+after[start:end])
   anchor='barcodes: fboBarcodeAliases.fboBarcodeAliases(i,r.items)';assert s.count(anchor)==1
   s=s.replace(anchor,'barcodes: [...new Set([...fboBarcodeAliases.fboBarcodeAliases(i,r.items),...relabelLabels.filter(l=>l.skuId===i.skuId).map(l=>l.barcode)])]')
   continue
  if s.count(before)==1:s=s.replace(before,after,1);continue
  # Runtime files include historical extra empty lines. Match those without changing other lines.
  pattern=r'\s*'.join(re.escape(token) for token in before.split())
  matches=list(re.finditer(pattern,s))
  if len(matches)!=1:
   (r/'failed-hunk.txt').write_text(name+'\nBEFORE\n'+before+'\nAFTER\n'+after,encoding='utf-8')
   raise RuntimeError('Non-unique runtime hunk: '+name+'; inspect failed-hunk.txt')
  m=matches[0];s=s[:m.start()]+after.strip()+s[m.end():]
 if name=='modules/tsd/fbo-two-stage.service.js':
  gate="if(directions&&!['START','PICK_UNIT'";assert s.count(gate)==1
  s=s.replace(gate,"if(directions&&!(lamoda&&dto.action==='RELABEL_UNIT')&&!['START','PICK_UNIT'")
  anchor="else if (input.action === 'PACK_UNITS') {";assert s.count(anchor)==1
  s=s.replace(anchor,anchor+'\nawait lamoda_fbo_relabel_1.assertLamodaRelabelRecovery(tx,r);\n')
 result[name]=s
for name,s in result.items():
 for dest in [r/'candidate-lamoda-counts'/name,r/'api/payload'/name]:
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(s.encode())
print('Patched',len(result),'declared modules')
