"""TEST: ZIPs must be usable by Windows Explorer, not merely pass a CRC check."""
import tempfile
import unittest
import zipfile
import base64
import subprocess
import sys
from pathlib import Path
from windows_archive import build_archive, validate_archive

REQUIRED = ('DurakArena.exe', 'DurakArena/Binaries/Win64/DurakArena.exe',
            'DurakArena/Content/Paks/DurakArena-Windows.ucas')

class WindowsArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='durak-zip-test-')
        self.root = Path(self.temp.name)
        self.source = self.root/'game'
        for name in REQUIRED:
            path = self.source/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'fixture')

    def tearDown(self):
        self.temp.cleanup()

    def test_build_has_plain_windows_paths_and_roundtrips(self):
        target = self.root/'game.zip'
        build_archive(self.source, target)
        validate_archive(target)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), set(REQUIRED))
            self.assertIsNone(archive.testzip())
            for info in archive.infolist():
                self.assertEqual(info.create_system, 0)
                self.assertEqual(info.compress_type, zipfile.ZIP_DEFLATED)
            archive.extractall(self.root/'unpacked')
        for name in REQUIRED:
            self.assertEqual((self.root/'unpacked'/name).read_bytes(), b'fixture')

    def test_rejects_tar_dot_root_that_explorer_hides(self):
        target = self.root/'old.zip'
        with zipfile.ZipFile(target, 'w') as archive:
            archive.writestr('./', b'')
            for name in REQUIRED:
                archive.writestr('./'+name, b'fixture')
        with self.assertRaises(ValueError):
            validate_archive(target)

    @unittest.skipUnless(sys.platform == 'win32', 'Windows Explorer integration')
    def test_windows_shell_sees_new_zip_but_not_tar_dot_root(self):
        old, new = self.root/'old-shell.zip', self.root/'new-shell.zip'
        with zipfile.ZipFile(old, 'w') as archive:
            archive.writestr('./', b'')
            for name in REQUIRED:
                archive.writestr('./'+name, b'fixture')
        build_archive(self.source, new)
        for path, expected in ((old, 0), (new, 2)):
            literal = str(path).replace("'", "''")
            command = ("$s=New-Object -ComObject Shell.Application; "
                       f"$f=$s.NameSpace('{literal}'); "
                       f"if($null -eq $f -or $f.Items().Count -ne {expected}){{exit 1}}")
            encoded = base64.b64encode(command.encode('utf-16le')).decode('ascii')
            subprocess.run(['powershell.exe', '-NoProfile', '-EncodedCommand', encoded],
                           check=True, timeout=20, capture_output=True)

    def test_rejects_empty_archive(self):
        target = self.root/'empty.zip'
        with zipfile.ZipFile(target, 'w'):
            pass
        with self.assertRaises(ValueError):
            validate_archive(target)

    def test_rejects_unsafe_paths_and_case_duplicates(self):
        for extra in ('../escape.exe', '/absolute.exe', 'a\\b.exe',
                      'DurakArena/../escape.exe', 'durakarena.EXE'):
            target = self.root/'unsafe.zip'
            with zipfile.ZipFile(target, 'w') as archive:
                for name in REQUIRED:
                    archive.writestr(name, b'fixture')
                archive.writestr(extra, b'bad')
            if '\\' in extra:
                # TEST: ZipInfo normalizes backslashes on Windows while writing;
                # reproduce the raw non-canonical header from an external packer.
                target.write_bytes(target.read_bytes().replace(b'a/b.exe', b'a\\b.exe'))
            with self.assertRaises(ValueError, msg=extra):
                validate_archive(target)

    def test_excludes_runtime_saves_debug_and_manifests(self):
        for name in ('DurakArena/Saved/Config/settings.ini', 'DurakArena/game.pdb', 'Manifest_UFSFiles_Win64.txt'):
            path = self.source/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'private')
        target = self.root/'game.zip'
        build_archive(self.source, target)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), set(REQUIRED))

    def test_refuses_source_assets_or_existing_output(self):
        (self.source/'model.uasset').write_bytes(b'source')
        with self.assertRaises(ValueError):
            build_archive(self.source, self.root/'bad.zip')
        target = self.root/'existing.zip'
        target.write_bytes(b'preserve')
        with self.assertRaises(FileExistsError):
            build_archive(self.source, target)
        self.assertEqual(target.read_bytes(), b'preserve')

if __name__ == '__main__':
    unittest.main()
