# FIX: apply unique compiler deltas to materialized verified runtime only.
from pathlib import Path
import json,sys,difflib
r=Path(sys.argv[1])
for n,v in json.loads((r/'compiled.json').read_text(encoding='utf-8')).items():
 p=r/'candidate-current'/n;s=p.read_text(encoding='utf-8');old=v['old'].splitlines(True);new=v['next'].splitlines(True)
 if n=='modules/clients/clients.controller.js':
  def rep(a,b):
   global s
   assert s.count(a)==1,(n,a);s=s.replace(a,b,1)
  rep('list(user, includeArchived, displayWarehouseId, allBranches)', 'list(user, includeArchived, displayWarehouseId, allBranches, marketplaceDirectory)')
  rep("{ displayWarehouseId, allBranches: allBranches === '1' }", "{ displayWarehouseId, allBranches: allBranches === '1', marketplaceDirectory: marketplaceDirectory === 'true' }")
  rep("__param(3, (0, common_1.Query)('allBranches')),", "__param(3, (0, common_1.Query)('allBranches')),\n    __param(4, (0, common_1.Query)('marketplaceDirectory')),")
  rep('[Object, String, String, String]', '[Object, String, String, String, String]')
 elif n=='modules/clients/clients.service.js':
  before='select: this.clientSummarySelect(),'
  assert s.count(before)>0
  s=s.replace(before,"select: {...this.clientSummarySelect(), ...(view.marketplaceDirectory && process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED==='true' ? {marketplaceConnections:{select:{marketplace:true,isActive:true}},lamodaAccounts:{select:{isActive:true,fboEnabled:true,fbsEnabled:true}}}:{})},",1)
 else:
  for g in difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(3):
   before=''.join(old[g[0][1]:g[-1][2]]);after=''.join(new[g[0][3]:g[-1][4]])
   assert s.count(before)==1,(n,before[:100]);s=s.replace(before,after,1)
 p.write_bytes(s.encode());out=r/'api/payload'/n;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(p.read_bytes())
