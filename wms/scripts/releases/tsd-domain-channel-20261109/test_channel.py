# TEST: domain update requests reach the current channel without touching other downloads.
import unittest,re
from channel import patch,PATTERN,BLOCK
class Routing(unittest.TestCase):
 def test_channels_and_apks(self):
  for p in ['logoff-tsd.json','logoff-tsd-server-choice.json','logoff-tsd.apk','logoff-tsd-servers-receipt-voice-260.apk']:
   self.assertTrue(re.fullmatch(PATTERN,'/downloads/'+p))
  for p in ['/api/v1/tsd','/downloads/print-agent.exe','/Demo/downloads/logoff-tsd.json','/downloads/logoff-tsd.json/anything']:
   self.assertFalse(re.fullmatch(PATTERN,p))
 def test_minimal_patch_and_loop_prevention(self):
  original='server {\n    listen 443 ssl;\n    server_name wms.logoff.pro;\n    location / { proxy_pass http://web; }\n}'
  result=patch(original)
  self.assertEqual(result.replace(BLOCK,''),original)
  self.assertIn('proxy_set_header Host 127.0.0.1;',result)
  self.assertIn('proxy_ssl_server_name off;',result)
  with self.assertRaises(AssertionError):patch(result)
 def test_wrong_scope_rejected(self):
  with self.assertRaises(AssertionError):patch('server { listen 443 ssl; server_name sold; }')
if __name__=='__main__':unittest.main()
