import tempfile
from pathlib import Path
import unittest
from build_runtime import manifest, require_hash, verify_classes

# TEST: release must reject a different runtime and unexpected binary changes.
class RuntimeGuardsTest(unittest.TestCase):
    def test_rejects_unreviewed_apk(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'other.apk';p.write_bytes(b'other build')
            with self.assertRaisesRegex(ValueError,'Unreviewed APK'):
                require_hash(p,'0'*64)

    def test_rejects_wrong_manifest(self):
        with self.assertRaisesRegex(ValueError,'version name'):
            manifest(b'not production AndroidManifest.xml')

    def test_rejects_unexpected_classes(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'before',Path(d)/'after';a.mkdir();b.mkdir()
            (b/'Unrelated.smali').write_text('unexpected')
            with self.assertRaisesRegex(ValueError,'new classes'):
                verify_classes(a,b)

if __name__=='__main__': unittest.main()
