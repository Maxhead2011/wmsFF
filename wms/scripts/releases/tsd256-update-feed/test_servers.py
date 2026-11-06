"""TEST: prevent ordinary APK metadata from entering the servers channel."""
import unittest
from servers import validate,patch

class ServersTests(unittest.TestCase):
    def test_versions_and_package_match(self):
        old={'packageId':'pro.logoff.wms.tsd.servers','versionCode':254}
        new={**old,'versionCode':256}
        validate(old,new)
        with self.assertRaises(ValueError):validate(old,{**new,'packageId':'pro.logoff.wms.tsd'})
        with self.assertRaises(ValueError):validate({**old,'versionCode':257},new)

    def test_additive_https_route(self):
        before='server { listen 80; }\nserver {\n listen 443 ssl default_server;\n location /video/ {}\n}'
        after=patch(before)
        self.assertEqual(after.split('server {')[1],before.split('server {')[1])
        self.assertIn('location /video/ {}',after)
        with self.assertRaises(ValueError):patch(after)

if __name__=='__main__':unittest.main()
