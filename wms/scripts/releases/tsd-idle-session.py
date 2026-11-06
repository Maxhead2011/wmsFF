"""FIX: apply only the idle-session delta to an already verified runtime snapshot."""
import argparse
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--target', required=True)
p.add_argument('--compiled', required=True)
a = p.parse_args()
target, compiled = Path(a.target), Path(a.compiled)
pending = {}

def read(root, path):
    return (root / path).read_text(encoding='utf-8')

def write(path, value):
    pending[path] = value

def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError('Runtime drift: expected exactly one patch anchor: ' + before[:80])
    return text.replace(before, after, 1)

# These small modules must match the compiled delta outside the reviewed lines.
for path in ['modules/auth/access-token.service.js', 'modules/auth/guards/auth.guard.js',
             'modules/auth/guards/tsd-warehouse-keeper-capability.js', 'modules/tsd/dto/login-tsd-device.dto.js']:
    old, new = read(target, path), read(compiled, path)
    # Bound unexpected drift rather than replacing an unrelated runtime release.
    import difflib
    delta = list(difflib.unified_diff(old.splitlines(), new.splitlines(), n=0))
    if len(delta) > 42:
        raise RuntimeError('Unexpected module divergence: ' + path)
    write(path, new)

path='modules/tsd/tsd-device.service.js'
old, new=read(target,path),read(compiled,path)
anchor='const tsd_monitor_messages_1 = require("./tsd-monitor-messages");'
old=replace_once(old,anchor,anchor+'\nconst tsd_idle_session_service_1 = require("../auth/tsd-idle-session.service");')
pattern=r'    async login\(dto\) \{[\s\S]*?(?=    async loginByUserCredentials\(dto\))'
before=re.search(pattern,old);after=re.search(pattern,new)
if not before or not after: raise RuntimeError('Login patch anchor missing')
write(path,replace_once(old,before.group(),after.group()))

path='modules/tsd/tsd-device.controller.js'
old,new=read(target,path),read(compiled,path)
anchor='    login(dto) {\n        return this.devices.login(dto);\n    }'
old=replace_once(old,anchor,anchor+'\n    activity(token, body) {\n        return this.devices.recordSessionActivity(token, body);\n    }')
blocks=re.findall(r'__decorate\(\[[\s\S]*?\], TsdDeviceController.prototype, "activity", null\);',new)
if len(blocks)!=1: raise RuntimeError('Activity decorators missing')
# Take only the last decorator block, preserving all existing route metadata.
decorators=blocks[0][blocks[0].rfind('__decorate(['):]
anchor='exports.TsdDeviceController = TsdDeviceController = __decorate(['
write(path,replace_once(old,anchor,decorators+'\n'+anchor))

path='modules/administration/administration-internal-api.service.js'
old=read(target,path)
pattern=r"(id: 'tsd',[\s\S]*?routeCount: )108,"
if len(re.findall(pattern,old))!=1: raise RuntimeError('TSD registry count drift')
write(path,re.sub(pattern,lambda match:match.group(1)+'109,',old))

path='modules/auth/tsd-idle-session.service.js'
if (target/path).exists(): raise RuntimeError('Idle module already exists; use a fresh baseline')
write(path,read(compiled,path))
for path, value in pending.items():
    (target/path).write_bytes(value.encode('utf-8'))
print('Prepared eight-module idle-session overlay; production is unchanged.')
