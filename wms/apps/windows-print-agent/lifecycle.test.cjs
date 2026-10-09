// TEST: Windows PowerShell execution with fake HTTP, task scheduler and spooler only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.AGENT_TEST_ROOT||__dirname;
function run(body){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'logoff-agent-test-'));try{const ps=`$ErrorActionPreference='Stop'\n$testRoot='${dir.replace(/'/g,"''")}'\n. '${root.replace(/'/g,"''")}/JobJournal.ps1'\n${body}`;const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;}finally{fs.rmSync(dir,{recursive:true,force:true});}}
for(const queue of ['fbs','label','series'])test(`${queue}: lost ACK and process restart never repeat physical printing`,()=>run(`
$cfg=@{server='https://test.invalid';stationId='same-station'}
Initialize-PrintJournal $cfg $testRoot
$script:physical=0;$script:acks=0;$script:fail=$true
function Invoke-WmsApi {param($m,$p,$b) $script:acks++;if($script:fail){throw 'offline'};if(-not $b.success){throw 'ACK incorrectly marked failed'}}
try{Invoke-DurablePrint $cfg '${queue}' 'job-1' {$script:physical++}}catch{}
if($script:physical -ne 1){throw 'First print missing'}
Initialize-PrintJournal $cfg $testRoot
$script:fail=$false
Sync-PrintResults '${queue}'
Invoke-DurablePrint $cfg '${queue}' 'job-1' {$script:physical++}
if($script:physical -ne 1 -or $script:acks -ne 3){throw 'Repeated print or missing ACK'}
`));
test('interrupted spool submission is reported uncertain, never automatically printed again',()=>run(`
$cfg=@{server='https://test.invalid';stationId='station'}
Initialize-PrintJournal $cfg $testRoot
Save-PrintRecord 'fbs' 'uncertain' @{state='started';path='/result';result=$null}
Initialize-PrintJournal $cfg $testRoot
$script:acks=0
function Invoke-WmsApi {param($m,$p,$b) if($b.success -or $b.error -notmatch 'verify'){throw 'False success'};$script:acks++}
Sync-PrintResults 'fbs'
Invoke-DurablePrint $cfg 'fbs' 'uncertain' {throw 'MUST NOT PRINT'}
if($script:acks -ne 2){throw 'Missing recovery ACK'}
`));
test('journal corruption blocks printing instead of losing deduplication',()=>run(`
$cfg=@{server='https://test.invalid';stationId='station'}
Initialize-PrintJournal $cfg $testRoot
Save-PrintRecord 'fbs' 'job' @{state='started';path='/result';result=$null}
Get-ChildItem $testRoot -Recurse -Filter '*.json' | ForEach-Object {[IO.File]::WriteAllText($_.FullName,'broken')}
$blocked=$false
try{Initialize-PrintJournal $cfg $testRoot}catch{$blocked=$true}
if(-not $blocked){throw 'Corrupt journal ignored'}
`));
test('startup task has no daily lifetime/battery restriction and ignores duplicate starts',()=>{
 const s=fs.readFileSync(path.join(root,'AgentLifecycle.ps1'),'utf8');
 assert.match(s,/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);assert.match(s,/-MultipleInstances IgnoreNew/);
 assert.match(s,/-AllowStartIfOnBatteries/);assert.match(s,/-DontStopIfGoingOnBatteries/);assert.match(s,/-LogonType Interactive/);
});
module.exports={run};

for(const kind of ['wb','relabel','invalid-relabel','missing-second','generic'])test(`published queue contract preserved: ${kind}`,()=>run(`
. '${root.replace(/'/g,"''")}/LOGOFF-FBS-Print-Agent.ps1' -LibraryOnly
$cfg=@{server='https://test.invalid';stationId='station';printerName='fake';labelWidthMm=58;labelHeightMm=40}
Initialize-PrintJournal $cfg $testRoot
$script:printed=@();$script:calls=@();$script:outcome=$null
function Print-OneLabel {param($bytes,$printer,$w,$h) $script:printed+=([Convert]::ToBase64String($bytes));if($printer -ne 'fake'){throw 'Wrong printer'}}
function Invoke-WmsApi {param($m,$p,$b)
 $script:calls+=$p
 if($p.EndsWith('/heartbeat')){return}
 if($p -match '/fbs/print-stations/.+/claim$'){
  ${kind==='generic'?'return $null':`return @{id='job';source='${kind.includes('relabel')?'TSD_RELABEL':'TSD_FBS_ASSEMBLY'}';stickerBase64='AQID';sortingLabel=@{contentType='image/png';imageBase64='${kind==='missing-second'?'':kind==='relabel'?'AQID':'BAUG'}'}}`}
 }
 if($p -match '/agent-stations/.+/claim$'){return @{id='generic';imageBase64='BwgJ';copies=3;widthMm=58;heightMm=40}}
 if($p.EndsWith('/result')){$script:outcome=$b}
}
Invoke-AgentQueueCycle $cfg
if($script:printed.Count -ne ${['invalid-relabel','missing-second'].includes(kind)?0:kind==='generic'?3:2}){throw ('Wrong label count: '+$script:printed.Count)}
if($script:outcome.success -ne ${['invalid-relabel','missing-second'].includes(kind)?'$false':'$true'}){throw 'Wrong result'}
${kind==='wb'?`if(($script:printed -join ',') -ne 'AQID,BAUG'){throw 'WB labels reordered'}`:''}
${kind!=='generic'?`if($script:calls -match '/agent-stations/'){throw 'FBS priority lost'}`:''}
`));
test('installer reads existing task config and retains station identity',()=>run(`
. '${root.replace(/'/g,"''")}/AgentLifecycle.ps1'
function Get-AgentHome {return (Join-Path $testRoot 'stable')}
$legacy=Join-Path $testRoot 'legacy';[IO.Directory]::CreateDirectory($legacy)|Out-Null
Write-AtomicJson (Join-Path $legacy 'config.json') @{stationId='0910-id';stationName='0910';server='https://test.invalid';printerName='fake'}
function Get-ScheduledTask {return @{Actions=@(@{Arguments=('-File "'+(Join-Path $legacy 'LOGOFF-FBS-Print-Agent.ps1')+'"')})}}
$cfg=Get-SavedAgentConfig $testRoot
if($cfg.stationId -ne '0910-id' -or $cfg.stationName -ne '0910'){throw 'Station identity lost'}
`));
test('task definition executes under the printer user and restarts without runtime limit',()=>run(`
. '${root.replace(/'/g,"''")}/AgentLifecycle.ps1'
function New-ScheduledTaskAction {param($Execute,$Argument,$WorkingDirectory) if($Argument -notmatch 'WindowStyle Hidden' -or $WorkingDirectory -ne $testRoot){throw 'Bad action'};return @{}}
function New-ScheduledTaskTrigger {param([switch]$AtLogOn,$User) if(-not $AtLogOn -or -not $User){throw 'Bad logon trigger'};return @{}}
function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel) if($LogonType -ne 'Interactive' -or $RunLevel -ne 'Limited'){throw 'Bad user context'};return @{}}
function New-ScheduledTaskSettingsSet {param($RestartCount,$RestartInterval,$ExecutionTimeLimit,$MultipleInstances,[switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries) if($ExecutionTimeLimit -ne [TimeSpan]::Zero -or $MultipleInstances -ne 'IgnoreNew' -or -not $AllowStartIfOnBatteries -or -not $DontStopIfGoingOnBatteries){throw 'Unsafe task settings'};return @{}}
function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Settings,$Principal,[switch]$Force) if($TaskName -ne 'LOGOFF FBS Print Agent'){throw 'Unexpected task'}}
Register-AgentTask $testRoot
`));
test('reopening an installed agent neither stops it nor registers a new station',()=>run(`
. '${root.replace(/'/g,"''")}/AgentLifecycle.ps1'
function Get-AgentHome {return $testRoot}
$cfg=@{server='https://test.invalid';stationId='0910';printerName='fake'}
Write-AtomicJson (Join-Path $testRoot 'config.json') $cfg
foreach($name in @('LOGOFF-FBS-Print-Agent.ps1','WmsApi.ps1','PrintSeries.ps1','JobJournal.ps1','AgentLifecycle.ps1','Setup-Agent.ps1','Install-Agent.cmd','README.txt')){[IO.File]::WriteAllText((Join-Path $testRoot $name),'test')}
function Get-ScheduledTask {return @{State='Running';Actions=@(@{Arguments=('-File "'+(Join-Path $testRoot 'LOGOFF-FBS-Print-Agent.ps1')+'"')})}}
function Register-AgentTask {throw 'Must not replace a running task'}
function Start-ScheduledTask {throw 'Already running'}
function Invoke-WmsApi {throw 'Must not register another station'}
Install-AgentFiles $testRoot $cfg | Out-Null
if(Test-Path (Join-Path $testRoot 'stop.request')){throw 'Healthy agent stopped'}
`));

test('explicit new job can reprint while a replay of the old job cannot',()=>run(`
$cfg=@{server='https://test.invalid';stationId='station'}
Initialize-PrintJournal $cfg $testRoot
$script:prints=0
function Invoke-WmsApi {}
Invoke-DurablePrint $cfg 'fbs' 'original' {$script:prints++}
Invoke-DurablePrint $cfg 'fbs' 'original' {$script:prints++}
Invoke-DurablePrint $cfg 'fbs' 'new-reprint' {$script:prints++}
if($script:prints -ne 2){throw 'Explicit new job was blocked'}
`));
test('a second Windows process cannot acquire the same station mutex',()=>run(`
. '${root.replace(/'/g,"''")}/AgentLifecycle.ps1'
$cfg=@{server='https://test.invalid';stationId=[guid]::NewGuid().ToString()}
if(-not (Enter-AgentMutex $cfg)){throw 'First process rejected'}
try {
 $code=". '${root.replace(/'/g,"''")}/JobJournal.ps1';. '${root.replace(/'/g,"''")}/AgentLifecycle.ps1';if(Enter-AgentMutex @{server='https://test.invalid';stationId='$($cfg.stationId)'}){exit 7}else{exit 0}"
 $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
 $info=[Diagnostics.ProcessStartInfo]::new('powershell.exe',('-NoProfile -NonInteractive -EncodedCommand '+$encoded));$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $child=[Diagnostics.Process]::Start($info)
 if(-not $child.WaitForExit(10000)){$child.Kill();throw 'Child timed out'}
 if($child.ExitCode -ne 0){throw 'Duplicate process allowed'}
}finally{$script:agentMutex.ReleaseMutex();$script:agentMutex.Dispose()}
`));
