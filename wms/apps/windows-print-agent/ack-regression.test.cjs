// TEST: same executable ACK regression for the actual old public agent and the candidate.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=process.env.AGENT_TEST_ROOT||__dirname,baseline=process.env.AGENT_OLD_SOURCE;
test('lost success ACK never sends a false physical-print failure',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'logoff-ack-'));
 try{
 let init,invoke;
 if(baseline){let old=fs.readFileSync(baseline,'utf8').replace(/\r\n/g,'\n');init=old.slice(old.indexOf('function Read-Config'),old.indexOf('\ntry {\n  $cfg = Read-Config'));invoke=old.slice(old.indexOf('while ($true)')).replace('while ($true)','for ($once=0; $once -lt 1; $once++)');}
 else {init=`. '${root.replace(/'/g,"''")}/LOGOFF-FBS-Print-Agent.ps1' -LibraryOnly`;invoke='try { Invoke-AgentQueueCycle $cfg } catch { }';}
 const ps=`$ErrorActionPreference='Stop'\n${init}\n$cfg=@{server='https://test.invalid';stationId='test';printerName='test';labelWidthMm=58;labelHeightMm=40}\n${baseline?'':`Initialize-PrintJournal $cfg '${dir.replace(/'/g,"''")}'`}\n$script:physical=0;$script:acks=@()\nfunction Print-OneLabel {$script:physical++}\nfunction Start-Sleep {}\nfunction Invoke-PrintSeriesCycle {return $false}\nfunction Write-AgentError {}\nfunction Invoke-WmsApi {param($m,$p,$b)\nif($p.EndsWith('/heartbeat')){return}\nif($p.EndsWith('/claim')){return @{id='job';stickerBase64='AQID';sortingLabel=@{imageBase64='BAUG';contentType='image/png'}}}\nif($p.EndsWith('/result')){$script:acks+=$b.success;if($script:acks.Count -eq 1){throw 'Network interrupted after print'}}\n}\n${invoke}\nif($script:physical -ne 2){throw 'Wrong label count'}\nif($script:acks.Count -ne 1 -or $script:acks[0] -ne $true){throw 'REGRESSION: lost ACK misreported as physical print failure'}\nWrite-Output 'PASS'`; 
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
