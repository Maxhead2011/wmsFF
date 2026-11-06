"""FIX: expose the signed-255 update channel on the new WMS HTTPS host only."""
MARKER = ' listen 443 ssl default_server;'
BLOCK = '''
 # TSD256 new-WMS update channel; old HTTP and .servers feeds unchanged.
 location = /downloads/logoff-tsd.json {
  alias /var/www/wms-updates/logoff-tsd.json;
  default_type application/json;
  add_header Cache-Control "no-store";
 }
 location = /downloads/logoff-tsd.apk {
  alias /var/www/wms-updates/logoff-tsd-fabric-256.apk;
  default_type application/vnd.android.package-archive;
 }
 location = /downloads/logoff-tsd-fabric-256.apk {
  alias /var/www/wms-updates/logoff-tsd-fabric-256.apk;
  default_type application/vnd.android.package-archive;
 }
'''

def patch(text):
    if text.count(MARKER) != 1 or 'location = /downloads/logoff-tsd.json' in text:
        raise ValueError('Unexpected or already patched Nginx configuration')
    return text.replace(MARKER, MARKER + BLOCK, 1)
