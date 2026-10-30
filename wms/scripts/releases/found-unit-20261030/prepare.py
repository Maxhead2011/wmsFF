"""FIX: fail closed if a current runtime anchor differs; no deployment."""
import pathlib,json,difflib,hashlib,sys
root=pathlib.Path(sys.argv[1]);proof={}
for name in json.loads((root/'delta-files.json').read_text()):
 rel=name+'.js';before=(root/'before'/rel).read_text();after=(root/'after'/rel).read_text()
 target=root/'api'/rel;original=target.read_text();result=original
 if name.endswith('administration-internal-api.service'):
  old='routeCount: 31, // FIX: include SKU collection capabilities and the administrator KIZ location check.'
  assert result.count(old)==1
  result=result.replace(old,'routeCount: 32, // FIX: retain runtime-only routes and add found-unit confirmation.')
  out=root/'api-payload'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(result.encode())
  proof[rel]={'before':hashlib.sha256(original.encode()).hexdigest(),'after':hashlib.sha256(result.encode()).hexdigest()};continue
 a=before.splitlines(keepends=True);b=after.splitlines(keepends=True)
 for group in reversed(list(difflib.SequenceMatcher(None,a,b).get_grouped_opcodes(2))):
  i,j=group[0][1],group[-1][2];k,l=group[0][3],group[-1][4]
  old=''.join(a[i:j]);new=''.join(b[k:l])
  if result.count(old)!=1 and group[0][0]=='equal' and group[-1][0]=='equal':
   i+=1;j-=1;k+=1;l-=1;old=''.join(a[i:j]);new=''.join(b[k:l])
  if result.count(old)!=1:
   print('ANCHOR MISMATCH',rel,repr(old));raise SystemExit(1)
  result=result.replace(old,new,1)
 out=root/'api-payload'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(result.encode('utf-8'))
 proof[rel]={'before':hashlib.sha256(original.encode()).hexdigest(),'after':hashlib.sha256(result.encode()).hexdigest()}
for rel in ['modules/inventory/found-unit-review.js','modules/tsd/fbo-known-kiz.js']:
 out=root/'api-payload'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes((root/'compiled'/rel).read_bytes())
(root/'api-delta-proof.json').write_text(json.dumps(proof,indent=2))
print('Exact source delta prepared',len(proof))
