"""Read-only verification and local materialization of a pinned production baseline.

Does not connect to production, publish, change Git, or run application code.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if not name or not path.parts or path.as_posix() != name or '\\' in name or ':' in name or path.is_absolute() or '..' in path.parts:
        raise ValueError('unsafe archive path: ' + name)
    return path


def contents(path):
    result = {}
    with tarfile.open(path, 'r:gz') as archive:
        for item in archive.getmembers():
            safe_name(item.name)
            if not item.isfile() or item.name in result:
                raise ValueError('non-file or duplicate archive member: ' + item.name)
            result[item.name] = archive.extractfile(item).read()
    return result


def verify(root):
    root = Path(root)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf8'))
    for name, info in manifest['artifacts'].items():
        safe_name(name)
        data = (root / name).read_bytes()
        if len(data) != info['size'] or sha(data) != info['sha256']:
            raise ValueError('artifact hash/size mismatch: ' + name)
        if 'files' in info:
            actual = {key: sha(value) for key, value in contents(root / name).items()}
            if actual != info['files']:
                raise ValueError('archive file manifest mismatch: ' + name)
    return manifest


def materialize(root, target):
    # FIX: rebuild the working candidate from all deployed modules, never an incomplete local dist.
    verify(root)
    target = Path(target)
    if target.exists():
        raise ValueError('destination already exists; refusing to overwrite: ' + str(target))
    files = contents(Path(root) / 'api-runtime.tar.gz')
    target.mkdir(parents=True)
    for name, data in files.items():
        destination = target.joinpath(*safe_name(name).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)


def check_candidate(root, target, base_image, allowed):
    manifest = verify(root)
    if base_image != manifest['containers']['infra-api-1']['image']:
        raise ValueError('base image changed; capture/review the newer release first')
    expected = manifest['artifacts']['api-runtime.tar.gz']['files']
    target = Path(target)
    if not target.is_dir() or target.is_symlink():
        raise ValueError('candidate must be a real directory')
    actual = {}
    for path in target.rglob('*'):
        if path.is_symlink():
            raise ValueError('candidate symlink is forbidden: ' + str(path))
        if path.is_file():
            actual[path.relative_to(target).as_posix()] = sha(path.read_bytes())
    removed = sorted(expected.keys() - actual.keys())
    if removed:
        raise ValueError('deployed files removed: ' + ', '.join(removed))
    changes = {name for name in actual if expected.get(name) != actual[name]}
    allow = set(allowed)
    for name in allow:
        safe_name(name)
    if changes != allow:
        raise ValueError('undeclared or missing changes: ' + json.dumps({
            'undeclared': sorted(changes - allow), 'declaredButUnchanged': sorted(allow - changes)}))
    return {'verified': True, 'baseImage': base_image, 'changedFiles': sorted(changes)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'materialize', 'check-candidate'])
    parser.add_argument('--baseline', type=Path, default=Path(__file__).parents[1] / 'baselines/our-wms/2026-09-25-fbs-display')
    parser.add_argument('--target', type=Path)
    parser.add_argument('--base-image')
    parser.add_argument('--allow', action='append', default=[])
    args = parser.parse_args()
    if args.action != 'verify' and args.target is None:
        parser.error('--target is required')
    if args.action == 'check-candidate' and not args.base_image:
        parser.error('--base-image must be read from the current deployment')
    try:
        if args.action == 'verify':
            manifest = verify(args.baseline)
            result = {'verified': True, 'artifacts': len(manifest['artifacts'])}
        elif args.action == 'materialize':
            materialize(args.baseline, args.target)
            result = {'materialized': str(args.target)}
        else:
            result = check_candidate(args.baseline, args.target, args.base_image, args.allow)
        print(json.dumps(result))
    except (ValueError, OSError, tarfile.TarError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
