// TEST: root script URLs are not rewritten by import maps.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixEntry}=require('./entry-fix.cjs');
const old='/assets/stock-export-20261106.js',next='/assets/wb-all-labels-api-20261108.js';
const html=`<script type="importmap">${JSON.stringify({imports:{[old]:next,'/assets/admin-tiles-20261019-0.js':next}})}</script><script type="module" crossorigin src="${old}"></script><p>preserve</p>`;
test('replaces the startup URL without touching imports or body',()=>{
 const result=fixEntry(html);
 assert.equal(result.replace('src="'+next+'"','src="'+old+'"'),html);
 assert.match(result,new RegExp('src="'+next+'"'));
});
test('refuses an unexpected or already updated entry',()=>{
 assert.throws(()=>fixEntry(html.replace('src="'+old+'"','src="/unexpected.js"')));
 assert.throws(()=>fixEntry(fixEntry(html)));
});
test('release generator updates the direct script entry as well as import aliases',()=>{
 const prepare=fs.readFileSync(__dirname+'/prepare.cjs','utf8');
 assert.ok(prepare.includes(`html=html.replace('src="'+oldMain+'"','src="'+newMain+'"')`));
});
