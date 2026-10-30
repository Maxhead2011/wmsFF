import pathlib,json,difflib,hashlib,sys
r=pathlib.Path(sys.argv[1]);proof={}
for name in json.loads((r/'delta-files.json').read_text()):
 rel=name+'.js';a=(r/'before'/rel).read_text().splitlines(keepends=True);b=(r/'after'/rel).read_text().splitlines(keepends=True)
 original=(r/'api'/rel).read_text();result=original
 for g in reversed(list(difflib.SequenceMatcher(None,a,b).get_grouped_opcodes(2))):
  old=''.join(a[g[0][1]:g[-1][2]]);new=''.join(b[g[0][3]:g[-1][4]])
  assert result.count(old)==1,('Anchor differs',rel,old);result=result.replace(old,new,1)
 out=r/'api-payload'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(result.encode('utf-8'))
 proof[rel]={'before':hashlib.sha256(original.encode()).hexdigest(),'after':hashlib.sha256(result.encode()).hexdigest()}
(r/'api-delta-proof.json').write_text(json.dumps(proof,indent=2));print('Exact API delta verified')

