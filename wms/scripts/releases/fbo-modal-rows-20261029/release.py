"""FIX: publish only the guarded five-file own-WMS web overlay."""
from pathlib import Path
import subprocess, json, hashlib, sys, fcntl, time, urllib.request, re

ROOT = Path('/opt/logoff-wms/wms/work/fbo-modal-rows-20261029')
APP = Path('/opt/logoff-wms/wms')
BASE = {'api': 'sha256:b99d8dafcf402fbdf04f4baca725a0a680b7ddd8a555126e324dd5263d56b4be',
        'web': 'sha256:3525263c62e19dc4bfd069ae098d5a3d93537e9cabfd45ef15c13e3f30936994'}
WEB_ROOT = '/usr/share/nginx/html/'
ALLOWED = {'index.html', 'assets/fbo-modal-rows-core-20261029.js', 'assets/fbo-modal-rows-ozon-20261029.js',
           'assets/fbo-modal-rows-lamoda-20261029.js', 'assets/fbo-modal-rows-20261029.css'}


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def check_base():
    for kind, image in BASE.items():
        assert docker('inspect', 'infra-' + kind + '-1', '--format', '{{.Image}}') == image, 'Production changed: ' + kind


def hashes(image):
    lines = docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c',
                   'find ' + WEB_ROOT + ' -type f -exec sha256sum {} +').splitlines()
    return {line.split(maxsplit=1)[1][len(WEB_ROOT):]: line.split()[0] for line in lines}


def public_file(name):
    for attempt in range(30):
        try:
            return urllib.request.urlopen('https://wms.logoff.pro/' + name, timeout=15).read()
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)


def stage():
    check_base()
    context = ROOT / 'web'
    expected = {p.relative_to(context / 'payload').as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (context / 'payload').rglob('*') if p.is_file()}
    assert set(expected) == ALLOWED
    (context / 'Dockerfile').write_text('FROM ' + BASE['web'] + '\nCOPY payload/ ' + WEB_ROOT + '\n')
    tag = 'logoff-web:fbo-modal-rows-20261029'
    subprocess.run(['docker', 'build', '--network', 'none', '-t', tag, str(context)], check=True)
    image = docker('image', 'inspect', tag, '--format', '{{.Id}}')
    before, after = hashes(BASE['web']), hashes(image)
    assert set(before) <= set(after), 'Unexpected removed file'
    assert {name for name in after if before.get(name) != after[name]} == ALLOWED, 'Unexpected image delta'
    assert all(after[name] == digest for name, digest in expected.items())
    proof = {'base': BASE, 'image': image, 'webHashes': expected, 'exactFileDelta': True}
    (ROOT / 'verification.json').write_text(json.dumps(proof))
    print(json.dumps(proof))


def publish():
    locks = []
    for name in ['/run/logoff-wms-release.lock', '/opt/logoff-wms/.release.lock', '/run/logoff-wms-web-release.lock']:
        handle = open(name, 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    check_base()
    assert not (ROOT / 'published.json').exists()
    verification = json.loads((ROOT / 'verification.json').read_text())
    assert verification['base'] == BASE and verification['exactFileDelta']
    pr = json.loads((ROOT / 'pr.json').read_text())
    assert pr['state'] == 'MERGED' and pr['headRefName'] == 'fix/fbo-modal-rows'
    assert pr['baseRefName'] == 'feature/wb-print-check'
    assert re.fullmatch(r'[0-9a-f]{40}', pr['headRefOid'])
    assert re.fullmatch(r'[0-9a-f]{40}', pr['mergeCommit']['oid'])
    browser = json.loads((ROOT / 'browser-proof.json').read_text())
    assert browser['passed'] >= 5 and browser['syntheticApi'] and browser['webHashes'] == verification['webHashes']
    actual = hashes(verification['image'])
    assert all(actual[name] == digest for name, digest in verification['webHashes'].items())
    others = {name: docker('inspect', name, '--format', '{{.Id}}')
              for name in docker('ps', '--format', '{{.Names}}').splitlines() if name != 'infra-web-1'}
    docker('tag', BASE['web'], 'logoff-web:before-fbo-modal-rows-20261029')

    def switch(image):
        docker('tag', image, 'infra-web:latest')
        subprocess.run(['docker', 'compose', '--env-file', str(APP / '.env'), '-f', str(APP / 'infra/docker-compose.yml'),
                        'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web'], check=True)

    try:
        switch(verification['image'])
        assert json.loads(public_file('api/v1/health'))['status'] == 'ok'
        assert docker('inspect', 'infra-web-1', '--format', '{{.Image}}') == verification['image']
        for name, digest in verification['webHashes'].items():
            url = name if name != 'index.html' else '?fbo-modal-rows=' + str(pr['number'])
            assert hashlib.sha256(public_file(url)).hexdigest() == digest, 'Public asset mismatch: ' + name
        assert all(docker('inspect', name, '--format', '{{.Id}}') == identity for name, identity in others.items())
    except Exception:
        switch(BASE['web'])
        raise
    verification.update(published=True, at=time.time(), pr=pr['number'], otherContainersUnchanged=True, browserProof=browser)
    (ROOT / 'published.json').write_text(json.dumps(verification))
    print('Published: health, five public files and other-container isolation verified')


if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ['stage', 'publish']
    stage() if sys.argv[1] == 'stage' else publish()
