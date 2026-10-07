// TEST: deployment must reject runtime drift and ambiguous markers instead of overwriting unrelated code.
const {test}=require('node:test'),assert=require('node:assert/strict'),{patch,applyEdits}=require('./billing-receipt-loading-release.cjs');
test('rejects an unpinned billing graph before applying changes',()=>assert.throws(()=>patch('function ia({session:t}){}',''),/Pinned billing runtime drift/));
test('preserves every byte outside explicitly reviewed replacements',()=>assert.equal(applyEdits('before\r\nFORM\r\nafter',[['FORM','LOADING_FORM']]),'before\r\nLOADING_FORM\r\nafter'));
test('refuses missing and duplicated markers',()=>{for(const source of ['other','FORM FORM'])assert.throws(()=>applyEdits(source,[['FORM','NEW']]),/Missing or ambiguous/)});
