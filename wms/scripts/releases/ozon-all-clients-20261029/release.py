"""FIX: exact own-WMS overlay; publication requires merged PR and candidate proofs."""
from pathlib import Path
import subprocess, json, hashlib, sys, fcntl, time, urllib.request, re

ROOT = Path('/opt/logoff-wms/wms/work/ozon-all-clients-20261029')
APP = Path('/opt/logoff-wms/wms')
BASE = {
    'api': 'sha256:52a3c754f319f3a1d00a8246c0eb938c9d2cc0ab2bccf923cfa6b24d96e1dc3f',
    'web': 'sha256:c760940516763188534aeafdc86e24f47026f0a4e4f4f5c62fa52b9c704337d5',
}
ROOTS = {'api': '/app/apps/api/dist/', 'web': '/usr/share/nginx/html/'}
ALLOWED = {
    'api': {'modules/client-requests/ozon-fbo-import.service.js', 'modules/client-requests/ozon-fbo-import.controller.js'},
    'web': {'index.html', 'assets/ozon-all-clients-20261029.js', 'assets/ozon-all-clients-20261029.css'},
}


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def check_base():
    for kind, image in BASE.items():
        assert docker('inspect', 'infra-' + kind + '-1', '--format', '{{.Image}}') == image, 'Production changed: ' + kind


def file_hashes(image, kind):
    lines = docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c',
                   'find ' + ROOTS[kind] + ' -type f -exec sha256sum {} +').splitlines()
    return {line.split(maxsplit=1)[1][len(ROOTS[kind]):]: line.split()[0] for line in lines}


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
    proof = {'base': BASE, 'images': {}, 'hashes': {}, 'exactFileDelta': True}
    for kind in BASE:
        context = ROOT / kind
        expected = {p.relative_to(context / 'payload').as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in (context / 'payload').rglob('*') if p.is_file()}
        assert set(expected) == ALLOWED[kind], 'Unexpected payload file'
        (context / 'Dockerfile').write_text('FROM ' + BASE[kind] + '\nCOPY payload/ ' + ROOTS[kind] + '\n')
        tag = 'logoff-' + kind + ':ozon-all-clients-20261029'
        subprocess.run(['docker', 'build', '--network', 'none', '-t', tag, str(context)], check=True)
        image = docker('image', 'inspect', tag, '--format', '{{.Id}}')
        before, after = file_hashes(BASE[kind], kind), file_hashes(image, kind)
        assert set(before) <= set(after), 'Unexpected removed file'
        assert {name for name in after if before.get(name) != after[name]} == ALLOWED[kind], 'Unexpected image diff'
        assert all(after[name] == digest for name, digest in expected.items()), 'Payload hash mismatch'
        proof['images'][kind], proof['hashes'][kind] = image, expected
    (ROOT / 'verification.json').write_text(json.dumps(proof))
    print(json.dumps(proof))


def publish():
    locks = []
    for name in ['/run/logoff-wms-release.lock', '/opt/logoff-wms/.release.lock', '/run/logoff-wms-web-release.lock']:
        handle = open(name, 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    check_base()
    assert not (ROOT / 'published.json').exists(), 'Already published'
    verification = json.loads((ROOT / 'verification.json').read_text())
    assert verification['base'] == BASE and verification['exactFileDelta']
    pr = json.loads((ROOT / 'pr.json').read_text())
    assert pr['state'] == 'MERGED' and pr['headRefName'] == 'fix/ozon-all-clients-default'
    assert pr['baseRefName'] == 'feature/wb-print-check'
    assert re.fullmatch(r'[0-9a-f]{40}', pr['headRefOid'])
    assert re.fullmatch(r'[0-9a-f]{40}', pr['mergeCommit']['oid'])
    browser = json.loads((ROOT / 'browser-proof.json').read_text())
    api = json.loads((ROOT / 'api-proof.json').read_text())
    assert browser['passed'] >= 5 and browser['syntheticApi'] and browser['webHashes'] == verification['hashes']['web']
    assert api['passed'] >= 5 and api['fullApiHealth'] and api['controllerDecorators']
    assert api['image'] == verification['images']['api'] and api['apiHashes'] == verification['hashes']['api']
    for kind, image in verification['images'].items():
        assert all(file_hashes(image, kind)[n] == h for n, h in verification['hashes'][kind].items())
    others = {n: docker('inspect', n, '--format', '{{.Id}}') for n in docker('ps', '--format', '{{.Names}}').splitlines()
              if n not in ['infra-api-1', 'infra-web-1']}
    for kind, image in BASE.items():
        docker('tag', image, 'logoff-' + kind + ':before-ozon-all-clients-20261029')

    def switch(images):
        for kind, image in images.items():
            docker('tag', image, 'infra-' + kind + ':latest')
        subprocess.run(['docker', 'compose', '--env-file', str(APP / '.env'), '-f', str(APP / 'infra/docker-compose.yml'),
                        'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web'], check=True)

    try:
        switch(verification['images'])
        assert json.loads(public_file('api/v1/health'))['status'] == 'ok'
        for kind, image in verification['images'].items():
            assert docker('inspect', 'infra-' + kind + '-1', '--format', '{{.Image}}') == image
        for name, digest in verification['hashes']['web'].items():
            url = name if name != 'index.html' else '?ozon-all-clients=' + str(pr['number'])
            assert hashlib.sha256(public_file(url)).hexdigest() == digest, 'Public asset mismatch: ' + name
        assert all(docker('inspect', name, '--format', '{{.Id}}') == identity for name, identity in others.items())
    except Exception:
        switch(BASE)
        raise
    verification.update(published=True, at=time.time(), pr=pr['number'], otherContainersUnchanged=True,
                        browserProof=browser, apiProof=api)
    (ROOT / 'published.json').write_text(json.dumps(verification))
    print('Published: health, runtime file hashes, public assets and container isolation verified')


if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ['stage', 'publish']
    stage() if sys.argv[1] == 'stage' else publish()
