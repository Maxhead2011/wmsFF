"""Capture a verified local API archive without credentials or deployment configuration."""
import sys,json,tarfile,hashlib,io
from pathlib import Path
source,target,image=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
target.mkdir(parents=True,exist_ok=False)
files={}
with tarfile.open(source) as archive:
 for entry in archive:
  if not entry.isfile():continue
  name=entry.name.removeprefix('./');assert not name.startswith('/') and '..' not in Path(name).parts
  files[name]=archive.extractfile(entry).read()
archive_path=target/'api-runtime.tar.gz'
with tarfile.open(archive_path,'w:gz') as archive:
 for name,data in sorted(files.items()):
  entry=tarfile.TarInfo(name);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
digest=lambda b:hashlib.sha256(b).hexdigest()
(target/'manifest.json').write_text(json.dumps({'sourceParityVerified':False,'containers':{'infra-api-1':{'image':image}},'artifacts':{'api-runtime.tar.gz':{'size':archive_path.stat().st_size,'sha256':digest(archive_path.read_bytes()),'files':{n:digest(b)for n,b in files.items()}}}},indent=2))
print('Captured API files',len(files))
