"""TEST: public design cannot overwrite operational scripts/downloads."""
import importlib.util, pathlib, unittest
spec = importlib.util.spec_from_file_location('deploy', pathlib.Path(__file__).parents[1] / 'deploy-public-site.py')
# Windows local tests do not need the Linux release lock.
import sys, types
sys.modules.setdefault('fcntl', types.SimpleNamespace())
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class PublicDeltaTest(unittest.TestCase):
    def test_preserves_existing_files(self):
        deploy.check_delta({'index.html':'old','app.js':'same'}, {'index.html':'new','app.js':'same','style.css':'css'}, {'index.html':'new','style.css':'css'})
    def test_rejects_operational_change(self):
        with self.assertRaisesRegex(ValueError, 'Existing file changed'):
            deploy.check_delta({'app.js':'old'}, {'app.js':'new'}, {})
    def test_rejects_lost_download(self):
        with self.assertRaises(ValueError):
            deploy.check_delta({'downloads/tsd.apk':'old'}, {}, {})
    def test_rejects_extra_file(self):
        with self.assertRaises(ValueError):
            deploy.check_delta({}, {'unexpected':'x'}, {})

if __name__ == '__main__': unittest.main()
