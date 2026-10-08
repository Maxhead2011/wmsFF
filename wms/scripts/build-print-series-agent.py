"""Build an updated package from the verified current public agent, retaining its existing queues."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

source, output = map(Path, sys.argv[1:3])
if output.exists():
    raise SystemExit('Choose a new output path')
root = Path(__file__).resolve().parents[1]
with zipfile.ZipFile(source) as z:
    files = {n: z.read(n) for n in z.namelist() if not n.endswith('/')}
if 'config.json' in files or any('/' in n or '\\' in n for n in files):
    raise SystemExit('Only a public flat package without credentials is accepted')
name = 'LOGOFF-FBS-Print-Agent.ps1'
agent = files[name].decode('utf-8-sig')
if 'PrintSeries.ps1' in agent or agent.count('Start-Sleep -Seconds 2') != 1:
    raise SystemExit('Unexpected agent baseline')
# FIX: preserve FBS, relabel and generic label logic exactly; add the separate series cycle.
agent = agent.replace("Add-Type -AssemblyName System.Drawing", "Add-Type -AssemblyName System.Drawing\n. (Join-Path $PSScriptRoot 'PrintSeries.ps1')", 1)
agent = agent.replace('  Start-Sleep -Seconds 2', '  try { if (Invoke-PrintSeriesCycle $cfg) { continue } } catch { Write-Warning $_.Exception.Message }\n  Start-Sleep -Seconds 2')
files[name] = agent.encode('utf-8-sig')
files['PrintSeries.ps1'] = (root/'apps/windows-print-agent/PrintSeries.ps1').read_text(encoding='utf-8').encode('utf-8-sig')
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
    for name, data in files.items():
        z.writestr(name, data)
print(json.dumps({'package':str(output),'baseSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'files':list(files)}))
