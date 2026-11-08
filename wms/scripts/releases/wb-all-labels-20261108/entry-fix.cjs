// FIX: preserve every current runtime asset and change only the mapped entry URL.
const fs=require('node:fs'), assert=require('node:assert/strict');
function fixEntry(html){
  const map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  const old='/assets/stock-export-20261106.js', next=map[old];
  assert.equal(next,'/assets/wb-all-labels-api-20261108.js');
  assert.equal(html.split('src="'+old+'"').length,2);
  return html.replace('src="'+old+'"','src="'+next+'"');
}
module.exports={fixEntry};
if(require.main===module)fs.writeFileSync(process.argv[3],fixEntry(fs.readFileSync(process.argv[2],'utf8')));
