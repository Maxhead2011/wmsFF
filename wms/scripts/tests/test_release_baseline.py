import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release_baseline', Path(__file__).parents[1] / 'release_baseline.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class ReleaseBaselineTest(unittest.TestCase):
    def setUp(self):
        root = Path(os.environ['BASELINE_TEST_TMP'])
        root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.files = {'controller.js': b'new-mode', 'ozon.js': b'unit-counter'}
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            for name, content in self.files.items():
                item = tarfile.TarInfo(name)
                item.size = len(content)
                archive.addfile(item, io.BytesIO(content))
        (self.root / 'api-runtime.tar.gz').write_bytes(data.getvalue())
        self.manifest = {'containers': {'infra-api-1': {'image': 'sha256:base'}}, 'artifacts': {
            'api-runtime.tar.gz': {'sha256': hashlib.sha256(data.getvalue()).hexdigest(),
                'size': len(data.getvalue()), 'files': {k: hashlib.sha256(v).hexdigest() for k, v in self.files.items()}}}}
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest))

    # TEST: exact deployed bytes can be recovered without executing application code.
    def test_materialize_and_verify(self):
        baseline.verify(self.root)
        target = self.root / 'candidate'
        baseline.materialize(self.root, target)
        self.assertEqual((target / 'ozon.js').read_bytes(), b'unit-counter')
        baseline.check_candidate(self.root, target, 'sha256:base', [])

    # TEST: the historic regression (unrelated Ozon helper lost in a relabel release) must fail.
    def test_missing_helper_is_rejected(self):
        target = self.root / 'candidate'
        baseline.materialize(self.root, target)
        (target / 'controller.js').write_bytes(b'new-print-button')
        (target / 'ozon.js').unlink()
        with self.assertRaisesRegex(ValueError, 'removed'):
            baseline.check_candidate(self.root, target, 'sha256:base', ['controller.js'])

    def test_unlisted_change_is_rejected(self):
        target = self.root / 'candidate'
        baseline.materialize(self.root, target)
        (target / 'ozon.js').write_bytes(b'old-counter')
        with self.assertRaisesRegex(ValueError, 'undeclared'):
            baseline.check_candidate(self.root, target, 'sha256:base', [])
        baseline.check_candidate(self.root, target, 'sha256:base', ['ozon.js'])

    def test_stale_base_is_rejected(self):
        target = self.root / 'candidate'
        baseline.materialize(self.root, target)
        with self.assertRaisesRegex(ValueError, 'image'):
            baseline.check_candidate(self.root, target, 'sha256:other-release', [])

    def test_tampered_archive_is_rejected(self):
        (self.root / 'api-runtime.tar.gz').write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'hash|size'):
            baseline.verify(self.root)

    def test_path_traversal_and_links_rejected(self):
        for name in ['../outside.js', '/absolute.js', 'C:/outside.js', 'a\\outside.js', 'a//b.js', '.', 'a/./b.js']:
            with self.assertRaises(ValueError):
                baseline.safe_name(name)

    def test_archive_symlink_rejected_without_extraction(self):
        path = self.root / 'link.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            item = tarfile.TarInfo('module.js')
            item.type = tarfile.SYMTYPE
            item.linkname = '../outside.js'
            archive.addfile(item)
        with self.assertRaisesRegex(ValueError, 'non-file'):
            baseline.contents(path)

    def test_existing_destination_is_preserved(self):
        with self.assertRaisesRegex(ValueError, 'exists'):
            baseline.materialize(self.root, self.root)


if __name__ == '__main__':
    unittest.main()
