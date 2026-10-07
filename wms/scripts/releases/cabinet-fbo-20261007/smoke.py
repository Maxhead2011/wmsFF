import subprocess,json,pathlib
r=pathlib.Path('/opt/logoff-wms/wms/work/cabinet-fbo-20261007')
def d(*a):return subprocess.check_output(['docker',*a],text=True).strip()
v=json.loads((r/'verification.json').read_text());info=json.loads(d('inspect','infra-api-1'))[0]
args=['run','--rm','--network',next(iter(info['NetworkSettings']['Networks'])),'-v',str(r)+':/release:ro','-w','/app/apps/api','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules']
for e in info['Config']['Env']:
 if e.startswith('DATABASE_URL=') or e.startswith('WMS_'):args+=['-e',e]
args+=['--entrypoint','node',v['api']['candidate'],'/release/live-smoke.cjs']
# Credentials are passed only within the server; never print args or exception command.
result=subprocess.run(['docker',*args],capture_output=True,text=True)
print(result.stdout);print(result.stderr);assert result.returncode==0,'Read-only smoke failed'
(r/'smoke.json').write_text(json.dumps({'passed':True,'readOnly':True,'result':json.loads(result.stdout)}))
