"""TEST: isolate the game route and reject accidental deployment of source/private files."""
import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location('durak_publish',Path(__file__).with_name('publish.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
baseline='server {\n    listen 443 ssl;\n    location /api/ {\n        proxy_pass http://127.0.0.1:3000/api/;\n    }\n    location / { proxy_pass http://127.0.0.1:3080; }\n}\n'
result=module.nginx_config(baseline)
assert result.replace(module.SNIPPET,'')==baseline
assert 'application/javascript js mjs;' in result
assert 'location ^~ /durak/' in result
assert 'try_files $uri $uri/ =404;' in result
assert module.nginx_config(result)==result
for bad in ['',baseline+baseline,baseline.replace('/api/','/durak/')]:
    try: module.nginx_config(bad)
    except ValueError: pass
    else: raise AssertionError('Unsafe nginx input accepted')
for name in ['index.html','release.json','web/cards/JD.svg','web/app.mjs','downloads/LOGOFF-Durak-Windows.zip']:
    assert module.allowed(name),name
for name in ['.env','web/.env','../index.html','web/cards/../../secret.svg','Content/ParagonKwang/model.uasset','web/extra.js']:
    assert not module.allowed(name),name
print('DEPLOY_POLICY_TESTS_OK')
