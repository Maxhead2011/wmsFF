// FIX: exact delta over verified runtime; never replace the divergent whole service.
const fs=require('fs'),path=require('path'),ts=require('../../../node_modules/typescript');
const target=process.argv[2],dir=path.join(target,'modules/marketplace-connections');
const p=path.join(dir,'marketplace-connections.service.js');let s=fs.readFileSync(p,'utf8');
const begin=s.indexOf('    async syncOneFbsRequest(');if(begin<0)throw Error('Missing synchronizer');
const end=s.indexOf('\n    async ',begin+10);let part=s.slice(begin,end);
const lock='if ((0, ozon_fbs_pick_lines_1.ozonPickLinesEnabled)()) await tx.$queryRaw';
if(part.split(lock).length!==2)throw Error('Lock anchor mismatch');
part=part.replace(lock,"if ((0, ozon_fbs_pick_lines_1.ozonPickLinesEnabled)() || require('./wb-packed-auto-done').wbPackedAutoDoneEnabled()) await tx.$queryRaw");
const anchor='            const liveLinks = request.fbsOrderLinks.filter';
if(part.split(anchor).length!==2)throw Error('Sync anchor mismatch');
part=part.replace(anchor,"            if (await require('./wb-packed-auto-done').closeWbPackedRequest(tx,request,[...orderByKey.values()],Boolean(explicitBatch))) return {changed:true,summary:'WB accepted packed request; status DONE without stock writes'};\n"+anchor);
s=s.slice(0,begin)+part+s.slice(end);fs.writeFileSync(p,s);
fs.writeFileSync(path.join(dir,'wb-packed-auto-done.js'),ts.transpileModule(fs.readFileSync('apps/api/src/modules/marketplace-connections/wb-packed-auto-done.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
