// FIX: apply only reviewed anchors to the current production runtime; never replace the shared service.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const root=process.argv[2],file=path.join(root,'common/kiz-review-queue.js');
let s=fs.readFileSync(file,'utf8');
const once=(a,b)=>{assert.equal(s.split(a).length,2,'Unique anchor: '+a);s=s.replace(a,b);};
once('const kiz_cancelled_reuse_1 =', 'const physical_reuse = require("./kiz-physical-reuse");\nconst kiz_cancelled_reuse_1 =');
once('const permission = staleUnitPermission ? null : permittedReviewAction(previous, context, evidence.decision);',
 'const physicalPermission = physical_reuse.physicalReusePermission(previous, context, evidence, mark);\n        const permission = staleUnitPermission ? null : physicalPermission ? "ALLOW" : previous?.snapshot?.physicalReuse ? null : permittedReviewAction(previous, context, evidence.decision);');
once("(previous?.resolution === 'REUSE' && evidence.decision === 'RELABEL') ||", "(previous?.resolution === 'REUSE' && evidence.decision === 'RELABEL' && !physicalPermission) || (previous?.snapshot?.physicalReuse && !physicalPermission) ||");
once('barcode: task.barcode, boxCode: task.boxCode, workerName: task.workerName, workerUserId: task.workerUserId }), evidence: json(evidence)',
 'barcode: task.barcode, boxCode: task.boxCode, workerName: task.workerName, workerUserId: task.workerUserId, ...(physicalPermission ? {physicalReuse:previous.snapshot.physicalReuse} : {}) }), evidence: json(evidence)');
once('return { ...r, evidence:', 'return { ...r, physicalReuseAllowed: physical_reuse.physicalReuseEligible(evidence), evidence:');
// Only request-bound decisions support this exception. Independent UNIT/FOUND approvals retain their own policy.
const anchor="if (resolution === 'REUSE' && evidence.decision === 'RELABEL')";
assert.equal(s.split(anchor).length,3);
s=s.replace(anchor,"const physicalOverride = resolution === 'REUSE' && physical_reuse.physicalReuseEligible(evidence);\n        if (resolution === 'REUSE' && evidence.decision === 'RELABEL' && !physicalOverride)");
once("if (resolution === 'REUSE' && links.some(t => identityOf(t.kiz ?? '') === row.kizIdentity))", "let physicalProof = null;\n            if (physicalOverride) physicalProof = await physical_reuse.approvePhysicalReuse(tx,task,mark,evidence,user,id,reason.trim());\n            if (!physicalOverride && resolution === 'REUSE' && links.some(t => identityOf(t.kiz ?? '') === row.kizIdentity))");
once('decidedByName: user.name, decidedAt: new Date(), decision: evidence.decision, evidence: json(evidence) }',
 'decidedByName: user.name, decidedAt: new Date(), decision: evidence.decision, evidence: json(evidence), ...(physicalProof ? {snapshot:json({...fresh.snapshot,physicalReuse:physicalProof})} : {}) }');
once('context: row.context, kizIdentity: row.kizIdentity, evidence })', 'context: row.context, kizIdentity: row.kizIdentity, evidence, physicalProof })');
fs.writeFileSync(file,s);
const source=fs.readFileSync(path.join(__dirname,'../apps/api/src/common/kiz-physical-reuse.ts'),'utf8');
fs.writeFileSync(path.join(root,'common/kiz-physical-reuse.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
