// TEST: no new failed tests or load-error suites may be hidden by existing baseline failures.
const fs=require('node:fs'), assert=require('node:assert/strict');
const root='/opt/logoff-wms-backups/tsd-admin-recount-20260907/';
const base=JSON.parse(fs.readFileSync(root+'full-baseline.json','utf8'));
const next=JSON.parse(fs.readFileSync(root+'full-candidate.json','utf8'));
function failures(report){return report.testResults.flatMap(s=>{
  const failed=(s.assertionResults||[]).filter(t=>t.status==='failed').map(t=>s.name+'::'+t.fullName);
  return s.status==='failed'&&!failed.length?[s.name+'::SUITE_LOAD_ERROR']:failed;
});}
const previous=new Set(failures(base)), added=failures(next).filter(x=>!previous.has(x));
assert.equal(added.length,0,'New runtime failures: '+JSON.stringify(added));
assert(next.numPassedTests>=base.numPassedTests,'Passed test count decreased');
console.log(JSON.stringify({status:'PASS',baselinePassed:base.numPassedTests,baselineFailed:base.numFailedTests,candidatePassed:next.numPassedTests,candidateFailed:next.numFailedTests,newFailures:added.length}));
