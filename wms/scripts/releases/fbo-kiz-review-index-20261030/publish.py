"""FIX: additive index only, pinned own-WMS release, no row changes."""
import subprocess,json,fcntl,time
from pathlib import Path
r=Path('/opt/logoff-wms/wms/work/fbo-kiz-review-index-20261030')
base='sha256:add4e84416d33f85f96d8a398681c6c08148534b38cf7349085791a17040acfe'
def d(*args):return subprocess.check_output(['docker',*args],text=True).strip()
f=open('/run/logoff-wms-release.lock','a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert d('inspect','infra-api-1','--format','{{.Image}}')==base
pr=json.loads((r/'pr.json').read_text());assert pr['merged'] and pr['head']['ref']=='fix/fbo-kiz-review-index'
assert json.loads((r/'isolated-proof.json').read_text())['greenConcurrentRuns']==5
before={n:d('inspect',n,'--format','{{.Id}}') for n in d('ps','--format','{{.Names}}').splitlines()}
# No credentials are printed; the existing PostgreSQL container supplies its own user/database.
cmd=['docker','exec','-i','infra-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
p=subprocess.run(cmd,input=(r/'review-index.sql').read_bytes(),capture_output=True);(r/'index-result.txt').write_bytes(p.stdout+p.stderr);print(p.stdout.decode());print(p.stderr.decode());p.check_returncode()
assert all(d('inspect',n,'--format','{{.Id}}')==x for n,x in before.items())
proof={'pr':pr['number'],'api':base,'index':'KizReviewCase_client_identity_idx','containersUnchanged':True,'at':time.time()};(r/'published.json').write_text(json.dumps(proof));print(json.dumps(proof))
