"""Build a cooked Windows client ZIP without the './' root hidden by Explorer."""
import argparse
from pathlib import Path
import shutil
import zipfile

REQUIRED = {'DurakArena.exe', 'DurakArena/Binaries/Win64/DurakArena.exe'}
SOURCE_SUFFIXES = {'.uasset', '.umap', '.uproject', '.cpp', '.h', '.ps1', '.py'}

def validate_archive(path):
    # FIX: CRC alone accepts tar's './' root, although Windows shows an empty folder.
    with zipfile.ZipFile(path) as archive:
        seen = set()
        names = set()
        for info in archive.infolist():
            name = info.orig_filename
            parts = name.rstrip('/').split('/')
            if not name or '\x00' in name or '\\' in name or ':' in name or any(p in ('', '.', '..') for p in parts):
                raise ValueError('Non-canonical Windows ZIP path: '+name)
            if name.casefold() in seen:
                raise ValueError('Duplicate Windows ZIP path: '+name)
            seen.add(name.casefold())
            if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('Unsupported Windows ZIP encoding: '+name)
            if info.is_dir():
                continue
            if info.file_size == 0 and name in REQUIRED:
                raise ValueError('Empty launcher')
            if Path(name).suffix.lower() in SOURCE_SUFFIXES or 'saved' in [p.lower() for p in parts]:
                raise ValueError('Source or runtime data in release: '+name)
            names.add(name)
        if not REQUIRED.issubset(names) or not any(n.startswith('DurakArena/Content/Paks/') and n.endswith('.ucas') for n in names):
            raise ValueError('Incomplete cooked Windows client')
        bad = archive.testzip()
        if bad:
            raise ValueError('CRC failure: '+bad)
        return len(names)

def build_archive(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    if target.exists():
        raise FileExistsError(target)
    if not source.is_dir() or target.is_relative_to(source):
        raise ValueError('Output must be outside the cooked client folder')
    files = []
    for path in sorted(source.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks cannot be packaged')
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        if 'saved' in [p.lower() for p in relative.parts] or path.suffix.lower() == '.pdb' or path.name.startswith('Manifest_'):
            continue
        if path.suffix.lower() in SOURCE_SUFFIXES or path.name.startswith('.env'):
            raise ValueError('Not a cooked distribution file: '+str(relative))
        files.append((path, relative.as_posix()))
    # FIX: plain relative names, DOS metadata, standard Deflate; never add './'.
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, allowZip64=False) as archive:
        for path, name in files:
            info = zipfile.ZipInfo.from_file(path, arcname=name)
            info.create_system = 0
            info.external_attr = 0x20
            info.compress_type = zipfile.ZIP_DEFLATED
            with path.open('rb') as src, archive.open(info, 'w') as dst:
                shutil.copyfileobj(src, dst, length=1024*1024)
    return validate_archive(target)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    count = build_archive(args.source, args.target)
    print('WINDOWS_ZIP_READY', count, 'files', args.target, flush=True)
