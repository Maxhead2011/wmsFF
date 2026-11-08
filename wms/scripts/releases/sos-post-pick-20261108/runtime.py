from pathlib import Path
import json,subprocess,sys
r=Path(sys.argv[1]);image=json.loads((r/'stage.json').read_text())['images']['api']
p=subprocess.run(['docker','run','--rm','--network','none','--entrypoint','node','-w','/app/apps/api','-e','NODE_PATH=/app/apps/api/node_modules:/app/node_modules','-v',str(r/'runtime.cjs')+':/app/apps/api/sos-runtime.cjs:ro',image,'sos-runtime.cjs'],check=True,capture_output=True,text=True)
result=json.loads(p.stdout);assert result['passed']==8;(r/'runtime-api-proof.json').write_text(json.dumps(result));print(result)
