import unittest
from unittest.mock import patch
import publish

# TEST: old nginx workers may answer briefly after a successful reload.
class PublicationReadinessTest(unittest.TestCase):
    def test_waits_for_new_workers(self):
        with patch.object(publish,'fetch',side_effect=[b'old page',b'new apk']) as fetch,patch.object(publish.time,'sleep'):
            publish.wait_hash('/candidate.apk',publish.sha(b'new apk'),attempts=2)
            self.assertEqual(2,fetch.call_count)

    def test_wrong_apk_never_passes(self):
        with patch.object(publish,'fetch',return_value=b'old page'),patch.object(publish.time,'sleep'):
            with self.assertRaisesRegex(AssertionError,'did not become ready'):
                publish.wait_hash('/candidate.apk',publish.sha(b'new apk'),attempts=2)

if __name__=='__main__':unittest.main()
