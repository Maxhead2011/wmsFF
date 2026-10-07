// TEST: release patch refuses ambiguous markers and unreviewed live method changes.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {edits,transplant,patchWeb}=require('../billing-done-requests-release.cjs');
test('reverse-preserving unique replacements',()=>{assert.equal(edits('first middle last',[['middle','new']]),'first new last');assert.throws(()=>edits('a a',[['a','b']]),/Ambiguous/)});
test('retains all other methods when transplanting the reviewed delta',()=>{
 const old='class Sample { unchanged(){ return 1; } change(){ return 2; } }';
 const next='class Sample { unchanged(){ return 1; } change(){ return 3; } added(){ return 4; } }';
 const patched=transplant(old,old,next,'Sample',['change'],['added']);
 assert.match(patched,/unchanged\(\)\{ return 1; \}/);assert.match(patched,/change\(\)\{ return 3; \}/);assert.match(patched,/added\(\)\{ return 4; \}/);
});
test('rejects unseen changes in a method and an unpinned browser module',()=>{
 assert.throws(()=>transplant('class S { m(){return 9} }','class S { m(){return 1} }','class S { m(){return 2} }','S',['m']),/drift/);
 assert.throws(()=>patchWeb('changed runtime','bundle'),/drift/);
});
