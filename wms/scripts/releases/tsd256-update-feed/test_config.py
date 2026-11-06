"""TEST: feed insertion is scoped and fails closed on configuration drift."""
import unittest
from config import patch, MARKER, BLOCK

class FeedTests(unittest.TestCase):
    def test_https_only_preserves_existing_routes(self):
        old='server { listen 80; location / { proxy_pass http://old; } }\nserver {\n'+MARKER+'\n location /video/ {}\n location = /downloads/logoff-tsd-server-choice.json {}\n}'
        result=patch(old)
        self.assertEqual(result.replace(BLOCK,'',1),old)
        self.assertNotIn('alias',result.split(MARKER)[0])
        self.assertIn('Cache-Control "no-store"',result)

    def test_missing_duplicate_and_repeated_patch_rejected(self):
        for text in ['',MARKER+MARKER,patch(MARKER)]:
            with self.assertRaises(ValueError): patch(text)

if __name__=='__main__': unittest.main()
