"""FIX: apply source token deltas to verified runtime, preserving every unrelated byte."""
from pathlib import Path
import subprocess,json,difflib,sys,hashlib,tarfile,re
r=Path(sys.argv[1]); repo=Path.cwd().parent if Path.cwd().name=='wms' else Path.cwd()
node=r'''const fs=require('fs'),ts=require('./wms/node_modules/typescript'),cp=require('child_process');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:9,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
const tokens=s=>{const tree=ts.createSourceFile('x.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),out=[];function visit(n){const children=n.getChildren(tree);if(children.length)children.forEach(visit);else if(n.kind!==ts.SyntaxKind.EndOfFileToken&&n.end>n.getStart(tree))out.push([n.getText(tree),n.getStart(tree),n.end]);}visit(tree);return out;};
const files=[...new Set([...cp.execFileSync('git',['diff','48b891eb','--name-only'],{encoding:'utf8'}).trim().split(/\r?\n/),...cp.execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/)])].filter(f=>f.startsWith('wms/apps/api/src/')&&f.endsWith('.ts')&&!f.endsWith('.spec.ts'));
const result=[];for(const file of files){let old=null;try{old=compile(cp.execFileSync('git',['show','48b891eb:'+file],{encoding:'utf8',maxBuffer:10000000,stdio:['ignore','pipe','ignore']}))}catch{}if(old&&file.endsWith('request-market-status.controller.ts'))old=old.replaceAll("process.env.WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED !== 'true'","!(process.env.WMS_REQUEST_MARKET_STATUS_MANUAL_ENABLED === 'true')");const next=compile(fs.readFileSync(file,'utf8'));result.push({file:file.slice(17).replace(/\.ts$/,'.js'),old,next,ot:old?tokens(old):null,nt:tokens(next)});}fs.writeFileSync(process.argv[1],JSON.stringify(result));'''
subprocess.run(['node','-e',node,str(r/'source-deltas.json')],cwd=repo,check=True)
candidate=r/'candidate-v981';candidate.mkdir(exist_ok=False)
with tarfile.open(r/'api981.tar.gz') as archive:
 for item in archive:
  if not item.isfile():continue
  name=item.name.removeprefix('./');assert '..' not in Path(name).parts
  p=candidate/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(item).read())
tokenizer="const fs=require('fs'),ts=require('./wms/node_modules/typescript'),s=fs.readFileSync(process.argv[1],'utf8'),tree=ts.createSourceFile('x.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),out=[];function visit(n){const children=n.getChildren(tree);if(children.length)children.forEach(visit);else if(n.kind!==ts.SyntaxKind.EndOfFileToken&&n.end>n.getStart(tree))out.push([n.getText(tree),n.getStart(tree),n.end]);}visit(tree);console.log(JSON.stringify(out));"
proof={}
for d in json.loads((r/'source-deltas.json').read_text(encoding='utf-8')):
 p=candidate/d['file']; original=p.read_text(encoding='utf-8') if p.exists() else None
 if d['file']=='modules/client-requests/client-requests.module.js':
  anchor='        providers: ['
  assert original.count(anchor)==1
  added='require("./request-market-status.service").RequestMarketStatusService,require("./request-market-status-scheduler.service").RequestMarketStatusScheduler,'
  result=original.replace(anchor,anchor+added)
  assert result.replace(added,'')==original
 elif d['old'] is None:
  assert original is None,d['file'];result=d['next']
 else:
  assert original is not None,d['file']
  # JS UTF-16 offsets are converted before slicing Python Unicode strings.
  def position(s,n):return len(s.encode('utf-16-le')[:n*2].decode('utf-16-le'))
  rt=json.loads(subprocess.check_output(['node','-e',tokenizer,str(p)],cwd=repo,text=True,encoding='utf-8')); rv=[t[0]for t in rt]; ov=[t[0]for t in d['ot']];nv=[t[0]for t in d['nt']]
  edits=[]
  skipped=[]
  if d['file']=='modules/marketplace-connections/marketplace-connections.service.js':
   for method,following in [('getFbsAllLabels','getFbsOrderStickersPdf'),('getFbsOrderStickersPdf','getFbsSupplyStickersPdf')]:
    begin=original.index('    async '+method+'(');end=original.find('\n    async ',begin+1)
    block=original[begin:end]
    if method=='getFbsAllLabels':
     needle='return require("./wb-all-labels").wbAllLabels('
     assert block.count(needle)==1
     changed=block.replace(needle,'const result = await require("./wb-all-labels").wbAllLabels(')
     endbrace=changed.rfind('    }');assert endbrace>0
     changed=changed[:endbrace]+'''        if (!result.warnings.some(w => w.startsWith('ШК товара / заказа')))
            await fbs_ribbon_evidence_1.rememberRibbon(this.prisma, clientId, user.id, orders, Buffer.from(result.fileBase64, 'base64'));
        return result;
'''+changed[endbrace:]
    else:
     needle="if (paired) return { ...paired, fileName: 'fbs-product-and-order-' + fileTimestamp(new Date()) + '.pdf', contentType: 'application/pdf' };"
     assert block.count(needle)==1
     changed=block.replace(needle,"if (paired) { if (fbs_request_auto_status_1.fbsActionStatusEnabled()) await fbs_ribbon_evidence_1.rememberRibbon(this.prisma,clientId,user.id,(await resolve()).orders,paired.buffer); "+needle[len('if (paired) '):]+" }")
    edits.append((begin,end,changed))
    ob=d['old'].index('    async '+method+'(');oe=d['old'].find('\n    async ',ob+1)
    skipped.append((ob,oe))
  for op,a,b,c,e in difflib.SequenceMatcher(None,ov,nv,autojunk=True).get_opcodes():
   if op=='equal':continue
   if any(lo<=position(d['old'],d['ot'][a][1])<hi for lo,hi in skipped):continue
   inserted=d['next'][position(d['next'],d['nt'][c][1]):position(d['next'],d['nt'][e-1][2])] if e>c else ''
   if op=='insert' and a>0 and ov[a-1]=='const' and inserted.endswith('const'):inserted='const '+inserted[:-5]
   if d['file']=='modules/marketplace-connections/marketplace-connections.service.js' and op=='insert' and re.fullmatch(r'(?:const \w+ = require\("[^"\n]+"\);\s*)+',inserted):
    added=[]
    for declaration in re.findall(r'const \w+ = require\("[^"\n]+"\);',inserted):
     alias=re.search(r'const (\w+) =',declaration)[1]
     if re.search(r'\b(?:const|let|var) '+alias+r'\b',original):assert declaration in original,(d['file'],alias)
     else:added.append(declaration)
    if added:edits.append((0,0,'\n'.join(added)+'\n'))
    continue
   candidates=[]
   for ctx in [12,8,4,2,1,0]:
    lo=max(0,a-ctx);hi=min(len(ov),b+ctx);pattern=ov[lo:hi]
    if not pattern:continue
    candidates=[i for i in range(len(rv)-len(pattern)+1)if rv[i:i+len(pattern)]==pattern]
    if len(candidates)==1:break
   assert len(candidates)==1,(d['file'],op,a,b,ov[a:b][:12],len(candidates))
   i=candidates[0]+a-lo;j=i+b-a
   start=position(original,rt[i][1]) if i<len(rt) else len(original)
   end=position(original,rt[j-1][2]) if j>i else start
   newstart=position(d['next'],d['nt'][c][1]) if c<len(nv) else len(d['next']);newend=position(d['next'],d['nt'][e-1][2]) if e>c else newstart
   replacement=d['next'][newstart:newend]
   if a==b:replacement+='\n'
   edits.append((start,end,replacement))
  edits.sort();assert all(edits[i][1]<=edits[i+1][0]for i in range(len(edits)-1)),d['file']
  result=original
  for start,end,replacement in reversed(edits):result=result[:start]+replacement+result[end:]
  proof[d['file']]={'sourceTokenEdits':len(edits),'baseSha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(result.encode('utf-8'))
 dest=r/'payload-v979'/d['file'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(p.read_bytes())
 proof.setdefault(d['file'],{})['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
(r/'overlay-proof.json').write_text(json.dumps(proof,indent=2));print('PASS exact token delta',len(proof),'modules')
