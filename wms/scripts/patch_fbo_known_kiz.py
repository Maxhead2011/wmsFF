"""Patch only the verified production FBO module. No SSH, deployment or DB writes."""
import argparse, hashlib, pathlib

def patch(source: str) -> str:
    anchor = '        const previous = matches[0];'
    if source.count(anchor) != 1 or 'async bindPickedMark(' not in source:
        raise ValueError('Unknown runtime; inspect current release before patching')
    return source.replace(anchor, anchor + '\n        // FIX: unknown identities require receipt review, never consume another KIZ quantity.\n        require("./fbo-known-kiz").requireKnownFboKiz(previous);', 1)

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--target',required=True);p.add_argument('--sha256',required=True)
    a=p.parse_args();src=pathlib.Path(a.source);dst=pathlib.Path(a.target)
    if src.resolve()==dst.resolve() or dst.exists():raise SystemExit('Target must be a new candidate file')
    data=src.read_bytes()
    if hashlib.sha256(data).hexdigest()!=a.sha256:raise SystemExit('Runtime hash changed')
    result=patch(data.decode('utf-8'));dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(result.encode('utf-8'))
