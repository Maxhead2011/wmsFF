"""Exact own-WMS overlay with pinned images, signature checks and rollback."""
from pathlib import Path
import subprocess, json, hashlib, fcntl, time, urllib.request, sys, shutil, zipfile, datetime

ROOT = Path('/opt/logoff-wms/wms/work/receipt-placement-active-list')
APP = Path('/opt/logoff-wms/wms')
ROOTS = {'api': '/app/apps/api/dist/', 'web': '/usr/share/nginx/html/'}

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def images():
    return {k: docker('inspect', 'infra-' + k + '-1', '--format', '{{.Image}}') for k in ROOTS}

def hashes(image, kind):
    lines = docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', image,
                   '-c', 'find ' + ROOTS[kind] + ' -type f -exec sha256sum {} +').splitlines()
    return {name.removeprefix(ROOTS[kind]): value for value, name in (line.split(None, 1) for line in lines)}

def stage():
    base = json.loads((ROOT / 'base.json').read_text())
    assert images() == base, 'Production changed before staging'
    for name, value in json.loads((ROOT / 'anchors.json').read_text()).items():
        kind, relative = name.split('/', 1)
        data = subprocess.check_output(['docker', 'exec', 'infra-' + kind + '-1', 'cat', ROOTS[kind] + relative])
        assert digest(data) == value, name
    tests = json.loads((ROOT / 'tests.json').read_text())
    assert tests['api'] >= 4289 and tests['web'] >= 594 and tests['types'] and tests['integration'] >= 63
    assert json.loads((ROOT / 'browser-proof.json').read_text())['passed'] == 6
    result = {}
    changes = {}
    for kind in ROOTS:
        file = ROOT / (kind + '.Dockerfile')
        file.write_text('FROM ' + base[kind] + '\n' + ('ENV WMS_RECEIPT_PLACEMENT_ENABLED=true\n' if kind == 'api' else '') + 'COPY . ' + ROOTS[kind] + '\n')
        tag = 'logoff-' + kind + ':receipt-placement-active-list'
        docker('build', '--network', 'none', '-q', '-f', str(file), '-t', tag, str(ROOT / 'payload' / kind))
        result[kind] = docker('image', 'inspect', tag, '--format', '{{.Id}}')
        previous, candidate = hashes(base[kind], kind), hashes(result[kind], kind)
        expected = {p.relative_to(ROOT / 'payload' / kind).as_posix() for p in (ROOT / 'payload' / kind).rglob('*') if p.is_file()}
        assert set(previous) <= set(candidate)
        assert {n for n in candidate if previous.get(n) != candidate[n]} == expected
        changes[kind] = {n: candidate[n] for n in expected}
    (ROOT / 'verification.json').write_text(json.dumps(dict(base=base, images=result, hashes=changes)))
    print(json.dumps(dict(staged=True, images=result, changed={k: len(v) for k, v in changes.items()})))

def publish():
    locks = []
    for name in ['/run/logoff-wms-release.lock', '/opt/logoff-wms/.release.lock', '/run/logoff-wms-web-release.lock']:
        lock = open(name, 'a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(lock)
    proof = json.loads((ROOT / 'verification.json').read_text())
    pr = json.loads((ROOT / 'pr.json').read_text())
    assert pr['state'] == 'MERGED' and pr['baseRefName'] == 'feature/la_panthera' and pr['headRefName'] == 'fix/receipt-placement-active-list'
    assert json.loads((ROOT / 'isolated-proof.json').read_text())['fullApiHealth']
    assert images() == proof['base'] and not (ROOT / 'published.json').exists()
    environment = (APP / '.env').read_bytes()
    others = {name: docker('inspect', name, '--format', '{{.Id}}') for name in docker('ps', '--format', '{{.Names}}').splitlines() if name not in ['infra-api-1', 'infra-web-1']}
    for kind, image in proof['base'].items():
        docker('tag', image, 'logoff-' + kind + ':before-receipt-placement-active-list')
    def switch(mapping):
        for kind, image in mapping.items():
            docker('tag', image, 'infra-' + kind + ':latest')
        docker('compose', '--env-file', str(APP / '.env'), '-f', str(APP / 'infra/docker-compose.yml'), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web')
    def check():
        assert images() == proof['images']
        env = json.loads(docker('inspect', 'infra-api-1'))[0]['Config']['Env']
        assert 'WMS_RECEIPT_PLACEMENT_ENABLED=true' in env
        assert json.load(urllib.request.urlopen('https://wms.logoff.pro/api/v1/health', timeout=15))['status'] == 'ok'
        for name, value in proof['hashes']['web'].items():
            url = 'https://wms.logoff.pro/' + (name if name != 'index.html' else '') + '?release=active-list'
            assert digest(urllib.request.urlopen(url, timeout=30).read()) == value, name
    try:
        switch(proof['images'])
        for attempt in range(12):
            try:
                check()
                break
            except Exception:
                if attempt == 11:
                    raise
                time.sleep(2)
        assert (APP / '.env').read_bytes() == environment
        assert all(docker('inspect', name, '--format', '{{.Id}}') == value for name, value in others.items())
    except Exception:
        switch(proof['base'])
        raise
    (ROOT / 'published.json').write_text(json.dumps(dict(published=True, at=time.time(), pr=pr['number'], **proof)))
    print('Published active-list fix; health and web hashes verified')

if sys.argv[-1] == 'publish':
    publish()
else:
    stage()
