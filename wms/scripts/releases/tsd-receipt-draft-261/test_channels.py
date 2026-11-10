import unittest
from publish_channels import update_config,MAIN,SERVERS

# TEST: LAN used stale container feeds; .servers APK alias returned253 despite JSON260.
class ChannelRoutesTest(unittest.TestCase):
    def test_both_transport_routes_preserve_separate_package_aliases(self):
        before='server {\n listen 80 default_server;\n location / { proxy_pass http://web; }\n}\nserver {\n listen 443 ssl default_server;\n location /video/ { proxy_pass http://video; }\n}'
        after=update_config(before)
        http,https=after.split(' listen 443 ssl default_server;')
        self.assertIn('location = /downloads/logoff-tsd.json',http)
        self.assertIn('alias /var/www/wms-updates/'+MAIN,http)
        self.assertIn('alias /var/www/wms-updates/'+SERVERS,http)
        self.assertIn('location = /downloads/logoff-tsd-server-choice.apk',https)
        self.assertIn('location /video/ { proxy_pass http://video; }',after)
        self.assertIn('location / { proxy_pass http://web; }',after)

    def test_duplicate_or_unknown_route_fails_closed(self):
        with self.assertRaises(AssertionError):update_config('unknown config')

if __name__=='__main__':unittest.main()
