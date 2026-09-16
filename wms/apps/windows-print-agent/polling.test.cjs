// TEST: execute the production polling functions with fake HTTP and printer calls only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
test('fast polling drains jobs in order, backs off errors, and preserves other installations',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'AgentLoop.ps1'),'utf8');
 const script=`$ErrorActionPreference='Stop'
${source}
$script:events=[Collections.Generic.List[string]]::new()
$script:jobNumber=0
$script:mode='jobs'
function Invoke-WmsApi($method,$uri,$body) {
 $script:events.Add($uri)
 if ($uri.EndsWith('/claim')) {
  if ($script:mode -eq 'offline') { throw 'offline' }
  if ($script:mode -eq 'empty') { return $null }
  $script:jobNumber++
  $sorting=if($script:mode -eq 'bad-label'){'application/pdf'}else{'image/png'}
  return @{id="job$script:jobNumber";stickerBase64='AA==';sortingLabel=@{imageBase64='AA==';contentType=$sorting}}
 }
 if ($uri.EndsWith('/result')) { $script:events.Add("ack:$($body.success)") }
}
function Print-OneLabel($bytes,$printer,$width,$height) { $script:events.Add('WB') }
function Print-SortingLabel($job,$printer,$width,$height) { $script:events.Add("sorting:$($job.id)") }
$cfg=@{server='https://wms.logoff.pro';stationId='station';printerName='FAKE';labelWidthMm=58;labelHeightMm=40}
$fast=Test-WmsFastPolling $cfg
$first=Invoke-WmsFbsPrintCycle $cfg $fast
$firstDelay=Get-WmsPollDelay $first $false $fast
$second=Invoke-WmsFbsPrintCycle $cfg $fast
$jobs=@($script:events);$script:events.Clear()
$script:mode='empty';$empty=Invoke-WmsFbsPrintCycle $cfg $fast;$idleDelay=Get-WmsPollDelay $empty $false $fast
$script:mode='offline';$caught=$false;try { Invoke-WmsFbsPrintCycle $cfg $fast | Out-Null } catch { $caught=$true }
$errorDelay=Get-WmsPollDelay $false $caught $fast
$script:events.Clear();$script:mode='bad-label';Invoke-WmsFbsPrintCycle $cfg $fast | Out-Null;$bad=@($script:events)
$script:events.Clear();$script:mode='empty';$cfg.server='https://wms.ffullhab.ru';$legacyFast=Test-WmsFastPolling $cfg;Invoke-WmsFbsPrintCycle $cfg $legacyFast | Out-Null
@{fast=$fast;first=$first;second=$second;firstDelay=$firstDelay;jobs=$jobs;idleDelay=$idleDelay;errorDelay=$errorDelay;bad=$bad;legacyFast=$legacyFast;legacyCalls=@($script:events);legacyDelay=(Get-WmsPollDelay $true $false $legacyFast);spoofFast=(Test-WmsFastPolling @{server='https://wms.logoff.pro.example.org'})} | ConvertTo-Json -Depth 5 -Compress
`;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);const timer=setTimeout(()=>child.kill(),20000);
 const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});clearTimeout(timer);assert.equal(exit,0,err);const r=JSON.parse(out.trim());
 assert.equal(r.fast,true);assert.equal(r.first,true);assert.equal(r.second,true);assert.equal(r.firstDelay,0);assert.equal(r.idleDelay,250);assert.equal(r.errorDelay,2000);
 assert.deepEqual(r.jobs,['/marketplace-connections/fbs/print-stations/station/claim','WB','sorting:job1','/marketplace-connections/fbs/print-jobs/job1/result','ack:True','/marketplace-connections/fbs/print-stations/station/claim','WB','sorting:job2','/marketplace-connections/fbs/print-jobs/job2/result','ack:True']);
 assert(!r.bad.includes('WB'));assert(r.bad.includes('ack:False'));assert.equal(r.legacyFast,false);assert.equal(r.legacyDelay,2000);assert.equal(r.spoofFast,false);
 assert.deepEqual(r.legacyCalls,['/marketplace-connections/fbs/print-stations/station/heartbeat','/marketplace-connections/fbs/print-stations/station/claim']);
});
