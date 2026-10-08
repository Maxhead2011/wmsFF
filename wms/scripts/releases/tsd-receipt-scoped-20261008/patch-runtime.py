"""Apply only matching compiled hunks to a freshly materialized runtime candidate."""
import argparse,subprocess,json,difflib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--release',type=Path,required=True);p.add_argument('--source-ref',required=True);a=p.parse_args()
name='modules/warehouse/receipt-channel-policy';source='wms/apps/api/src/'+name+'.ts'
old=subprocess.check_output(['git','show',a.source_ref+':'+source],cwd=a.repo).decode('utf-8');new=(a.repo/source).read_text(encoding='utf-8')
code="const fs=require('fs'),ts=require('./wms/node_modules/typescript');const v=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(v.map(source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText)));"
old,new=json.loads(subprocess.check_output(['node','-e',code],input=json.dumps([old,new]).encode(),cwd=a.repo));target=a.release/'candidate-api'/Path(name+'.js');runtime=target.read_text(encoding='utf-8')
for group in difflib.SequenceMatcher(None,old.splitlines(True),new.splitlines(True),autojunk=False).get_grouped_opcodes(3):
 before=''.join(old.splitlines(True)[group[0][1]:group[-1][2]]);after=''.join(new.splitlines(True)[group[0][3]:group[-1][4]])
 if runtime.count(before)!=1:raise ValueError('Runtime diverged; refusing replacement')
 runtime=runtime.replace(before,after)
target.write_text(runtime,encoding='utf-8')
