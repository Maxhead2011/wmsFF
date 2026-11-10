import tempfile
from pathlib import Path
import unittest
import build_runtime
from build_runtime import manifest, require_hash, verify_classes

# TEST: release must reject a different runtime and unexpected binary changes.
class RuntimeGuardsTest(unittest.TestCase):
    # TEST: .servers must keep its own pinned runtime and package/update channel.
    def test_servers_variant_has_distinct_pinned_baseline(self):
        baseline,filename,package=build_runtime.variant_settings('servers')
        self.assertEqual('0115239cb0abb26c33b37a06fadfd1d6409213fa32ee9aad8a1c99b684f8ac98',baseline)
        self.assertEqual('pro.logoff.wms.tsd.servers',package)
        self.assertEqual('logoff-tsd-servers-receipt-draft-261.apk',filename)

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
