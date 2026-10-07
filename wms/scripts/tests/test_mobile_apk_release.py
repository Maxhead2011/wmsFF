import importlib.util
import pathlib
import re
import unittest

# TEST: a download-only release must reject any unrelated file drift.
class ReleaseTest(unittest.TestCase):
    # TEST: public metadata must describe the version actually built into the APK.
    def test_release_version_matches_android(self):
        root = pathlib.Path(__file__).parents[2]
        script = (root / 'scripts/mobile-apk-release.py').read_text(encoding='utf-8')
        gradle = (root / 'apps/android-mobile-logoff/app/build.gradle.kts').read_text(encoding='utf-8')
        version = re.search(r'versionName = "([^"]+)"', gradle).group(1)
        code = re.search(r'versionCode = (\d+)', gradle).group(1)
        self.assertIn('metadata.update(versionCode=' + code + ",versionName='" + version + "'", script)

    def test_delta_is_exact(self):
        path = pathlib.Path(__file__).parents[1] / 'mobile-apk-release.py'
        spec = importlib.util.spec_from_file_location('release', path)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        before = {'index.html': 'a', 'app.apk': 'b', 'app.json': 'c'}
        expected = {'app.apk': 'd', 'app.json': 'e'}
        release.verify(before, {**before, **expected}, expected)
        for after in ({**before, **expected, 'index.html': 'bad'}, {**before, **expected, 'extra': 'x'}, before):
            with self.assertRaises(RuntimeError):
                release.verify(before, after, expected)

if __name__ == '__main__': unittest.main()
