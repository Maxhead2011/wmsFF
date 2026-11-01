"""Exact own-WMS overlay with pinned images, signature checks and rollback."""
from pathlib import Path
import subprocess, json, hashlib, fcntl, time, urllib.request, sys, shutil, zipfile, datetime

ROOT = Path('/opt/logoff-wms/wms/work/receipt-placement-840')
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

def sign():
    unsigned = ROOT / 'unsigned.apk'
    tests = json.loads((ROOT / 'tests.json').read_text())
    assert digest(unsigned.read_bytes()) == tests['unsignedSha256']
    jar = '/opt/logoff-wms-releases/eleonora-release-20260912/apksigner.jar'
    command = '. /opt/logoff-wms/secrets/tsd-signing.env; exec java -jar ' + jar + ' sign --ks "$TSD_KEYSTORE_PATH" --ks-key-alias "$TSD_KEY_ALIAS" --ks-pass env:TSD_KEYSTORE_PASSWORD --key-pass env:TSD_KEY_PASSWORD --out ' + str(ROOT / 'signed.apk') + ' ' + str(unsigned)
    subprocess.run(['sh', '-c', command], check=True)
    verified = subprocess.check_output(['java', '-jar', jar, 'verify', '--verbose', '--print-certs', str(ROOT / 'signed.apk')], text=True)
    certificate = '52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b'
    assert certificate in verified and 'Verified using v2 scheme (APK Signature Scheme v2): true' in verified
    with zipfile.ZipFile(unsigned) as a, zipfile.ZipFile(ROOT / 'signed.apk') as b:
        assert all(a.read(n) == b.read(n) for n in a.namelist())
    dest = ROOT / 'payload/web/downloads'
    dest.mkdir(parents=True, exist_ok=True)
    name = 'logoff-tsd-receipt-placement-252.apk'
    shutil.copyfile(ROOT / 'signed.apk', dest / name)
    shutil.copyfile(ROOT / 'signed.apk', dest / 'logoff-tsd.apk')
    old = json.loads(docker('exec', 'infra-web-1', 'cat', ROOTS['web'] + 'downloads/logoff-tsd.json'))
    assert old['versionCode'] < 252
    metadata = dict(versionCode=252, versionName='0.1.252-receipt-placement',
                    apkUrl='https://wms.logoff.pro/downloads/' + name,
                    sha256=digest((dest / name).read_bytes()), size=(dest / name).stat().st_size,
                    releasedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    releaseNotes='Размещение приёмки на палетах: общий прогресс, проверка завершения и история действий.')
    (dest / 'logoff-tsd.json').write_text(json.dumps(metadata, ensure_ascii=False))
    (ROOT / 'signed-proof.json').write_text(json.dumps(dict(certificate=certificate, payloadUnchanged=True, **metadata)))

def stage():
    base = json.loads((ROOT / 'base.json').read_text())
    assert images() == base, 'Production changed before staging'
    for name, value in json.loads((ROOT / 'anchors.json').read_text()).items():
        kind, relative = name.split('/', 1)
        data = subprocess.check_output(['docker', 'exec', 'infra-' + kind + '-1', 'cat', ROOTS[kind] + relative])
        assert digest(data) == value, name
    tests = json.loads((ROOT / 'tests.json').read_text())
    assert tests['api'] >= 4351 and tests['web'] >= 594 and tests['android'] >= 313 and tests['types']
    assert json.loads((ROOT / 'browser-proof.json').read_text())['passed'] == 6
    sign()
    result = {}
    changes = {}
    for kind in ROOTS:
        file = ROOT / (kind + '.Dockerfile')
        file.write_text('FROM ' + base[kind] + '\n' + ('ENV WMS_RECEIPT_PLACEMENT_ENABLED=true\n' if kind == 'api' else '') + 'COPY . ' + ROOTS[kind] + '\n')
        tag = 'logoff-' + kind + ':receipt-placement-840'
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
    assert pr['state'] == 'MERGED' and pr['baseRefName'] == 'feature/la_panthera' and pr['headRefName'] == 'feature/receipt-placement-controls'
    assert json.loads((ROOT / 'isolated-proof.json').read_text())['fullApiHealth']
    assert images() == proof['base'] and not (ROOT / 'published.json').exists()
    environment = (APP / '.env').read_bytes()
    others = {name: docker('inspect', name, '--format', '{{.Id}}') for name in docker('ps', '--format', '{{.Names}}').splitlines() if name not in ['infra-api-1', 'infra-web-1']}
    for kind, image in proof['base'].items():
        docker('tag', image, 'logoff-' + kind + ':before-receipt-placement-840')
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
            url = 'https://wms.logoff.pro/' + (name if name != 'index.html' else '') + '?release=840'
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
    (ROOT / 'published.json').write_text(json.dumps(dict(published=True, at=time.time(), pr=840, **proof)))
    print('Published PR840, API health, feature flag, web assets and APK252 verified')

if sys.argv[-1] == 'publish':
    publish()
else:
    stage()
