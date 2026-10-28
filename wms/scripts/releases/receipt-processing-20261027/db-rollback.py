from pathlib import Path
import json,subprocess,os
r=Path('/opt/logoff-wms/wms/work/receipt-processing-20261027')
info=json.loads(subprocess.check_output(['docker','inspect','infra-api-1']))[0]
image=json.loads((r/'verification.json').read_text())['images']['api']
p=r/'test.env';p.write_text('\n'.join(info['Config']['Env'])+'\n');p.chmod(0o600)
try:
 out=subprocess.check_output(['docker','run','--rm','--network',next(iter(info['NetworkSettings']['Networks'])),'--env-file',str(p),'-e','WMS_RECEIPT_PROCESSING_ENABLED=true','-e','NODE_PATH=/app/node_modules:/app/apps/api/node_modules','-v',str(r)+':/test:ro','--entrypoint','node',image,'/test/db-rollback.cjs'])
 proof=json.loads(out.decode().splitlines()[-1]);assert proof['passed']==8 and proof['rolledBack'];proof['apiImage']=image;(r/'db-proof.json').write_text(json.dumps(proof));print(json.dumps(proof))
finally:p.unlink()
