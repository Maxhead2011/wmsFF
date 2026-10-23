"""Stage/publish only the verified three-file web overlay on our WMS."""
from pathlib import Path
import subprocess, json, fcntl, urllib.request, hashlib, time, sys

root = Path('/opt/logoff-wms/wms/work/fbs-filtered-selection-20261023')
app = Path('/opt/logoff-wms/wms')
base = 'sha256:bf530fdd6f34447e197e533b75e877f36674deedaf99b770e0e96f0c6dfbab9a'
api = 'sha256:854abc7eca0b3930768b8fcbb7a783057960553a1c17af45aca516bbe1bbe4d2'
tag = 'logoff-web:fbs-filtered-selection-20261023'

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def hashes(image):
    lines = docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', image,
                   '-c', 'find /usr/share/nginx/html -type f -exec sha256sum {} +').splitlines()
    return {line.split(maxsplit=1)[1].removeprefix('/usr/share/nginx/html/'): line.split()[0] for line in lines}

def check_base():
    assert docker('inspect', 'infra-web-1', '--format', '{{.Image}}') == base
    assert docker('inspect', 'infra-api-1', '--format', '{{.Image}}') == api

def get(name):
    for attempt in range(10):
        try:
            return urllib.request.urlopen('https://wms.logoff.pro/' + name, timeout=15).read()
        except Exception:
            if attempt == 9: raise
            time.sleep(1)

def stage():
    check_base()
    proof = json.loads((root / 'browser/proof.json').read_text())
    assert proof['isolatedApi'] and len(proof['passed']) == 9 and proof['mutations'] == 1
    assert json.loads((root / 'patch-proof.json').read_text())['changedFunctions'] == 1
    (root / 'web/Dockerfile').write_text('FROM ' + base + '\nCOPY payload/ /usr/share/nginx/html/\n')
    subprocess.run(['docker', 'build', '--network', 'none', '-t', tag, str(root / 'web')], check=True)
    candidate = docker('image', 'inspect', tag, '--format', '{{.Id}}')
    before, after = hashes(base), hashes(candidate)
    names = json.loads((root / 'web-changes.json').read_text())
    # TEST: no old asset can disappear/change; only index.html and two new assets differ.
    assert set(before) <= set(after)
    assert {n for n in after if before.get(n) != after[n]} == set(names)
    assert all(before[n] == after[n] for n in before if n != 'index.html')
    result = {'base': base, 'api': api, 'web': candidate, 'hashes': {n: after[n] for n in names},
              'oldFilesPreserved': len(before) - 1, 'browserProof': proof}
    (root / 'verification.json').write_text(json.dumps(result))
    print(json.dumps({'staged': True, 'web': candidate, 'changed': names}))

def publish():
    locks = []
    for name in ['/run/logoff-wms-release.lock', '/opt/logoff-wms/.release.lock', '/run/logoff-wms-web-release.lock']:
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(handle)
    check_base()
    result = json.loads((root / 'verification.json').read_text())
    pr = json.loads((root / 'pr.json').read_text())
    assert pr['merged'] and pr['number'] == 673
    assert not (root / 'published.json').exists()
    assert docker('image', 'inspect', tag, '--format', '{{.Id}}') == result['web']
    env = (app / '.env').read_bytes()
    apk = get('downloads/logoff-tsd.json')
    others = {n: docker('inspect', n, '--format', '{{.Id}}') for n in docker('ps', '--format', '{{.Names}}').splitlines() if n != 'infra-web-1'}
    rollback = 'logoff-web:before-fbs-filtered-selection-20261023'
    docker('tag', base, rollback)
    def switch(image):
        docker('tag', image, 'infra-web:latest')
        subprocess.run(['docker', 'compose', '--env-file', str(app / '.env'), '-f', str(app / 'infra/docker-compose.yml'),
                        'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web'], check=True)
    try:
        switch(result['web'])
        for name, expected in result['hashes'].items():
            for attempt in range(10):
                data = get(name if name != 'index.html' else '?fbs-filtered-selection=20261023')
                if hashlib.sha256(data).hexdigest() == expected: break
                if attempt == 9: raise AssertionError('Public hash mismatch: ' + name)
                time.sleep(1)
        assert json.loads(get('api/v1/health'))['status'] == 'ok'
        assert get('downloads/logoff-tsd.json') == apk and (app / '.env').read_bytes() == env
        assert all(docker('inspect', n, '--format', '{{.Id}}') == value for n, value in others.items())
    except Exception:
        switch(base)
        raise
    out = {'published': True, 'at': time.time(), 'api': api, 'web': result['web'], 'pr': pr['number'],
           'rollback': rollback, 'otherContainersUnchanged': True, 'apkUnchanged': True, 'businessRecordsChanged': False}
    (root / 'published.json').write_text(json.dumps(out)); print(json.dumps(out))

if __name__ == '__main__':
    if sys.argv[-1] == 'publish': publish()
    else: stage()
