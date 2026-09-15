"""Artifact regression test: supply the real broken 171 and candidate 173 APKs."""
import os
import unittest
from verify_ozon_apk import verify


class OzonApkRegression(unittest.TestCase):
    # TEST: release 171 had the right version but lacked the actual UI changes.
    def test_rejects_the_published_broken_apk(self):
        with self.assertRaisesRegex(ValueError, 'missing the Ozon UI call'):
            verify(os.environ['OZON_BROKEN_APK'], os.environ['OZON_AAPT'], 171)

    # TEST: validate real DEX calls and manifest metadata, not build-directory names.
    def test_accepts_the_fixed_apk(self):
        result = verify(os.environ['OZON_FIXED_APK'], os.environ['OZON_AAPT'], 173)
        self.assertTrue(result['ozonUiCallsVerified'])
        self.assertTrue(result['quantityFieldsVerified'])

    def test_rejects_wrong_release_metadata(self):
        with self.assertRaisesRegex(ValueError, 'package/version'):
            verify(os.environ['OZON_FIXED_APK'], os.environ['OZON_AAPT'], 171)


if __name__ == '__main__':
    unittest.main()
