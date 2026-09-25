"""Publish only the tested public-site assets over the pinned web image. No API/DB operations."""
import argparse, fcntl, hashlib, json, pathlib, subprocess, urllib.request, time

BASE = 'sha256:475778f6b2d1fd9b51378d9c0db682d2f0f8345acfb69c64451cc4beedb4c18f'
API = 'sha256:57c41c094bf9e3e45eea8adca8e7d666b17cc2f24432b52cbb149b6e1c5f2cf6'
CONFIG = '0f6ea01db11bebb5750899138101ae324968b9ee4696ad7fa7010821990dc787'
TAG = 'logoff-web:public-light-20260925'
COMPOSE = ['docker', 'compose', '--project-name', 'infra', '--env-file', '/opt/logoff-wms/wms/.env', '-f', '/opt/logoff-wms/wms/infra/docker-compose.yml']

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def image(name):
    return run('docker', 'inspect', '--format', '{{.Image}}', name)

def hashes(container):
    rows = run('docker', 'exec', container, 'find', '/usr/share/nginx/html', '-type', 'f', '-exec', 'sha256sum', '{}', ';')
    return {line.split('  ', 1)[1].removeprefix('/usr/share/nginx/html/'): line.split('  ', 1)[0] for line in rows.splitlines()}

def check_delta(before, after, payload):
    # FIX: old application chunks, downloads, fonts and images must stay untouched.
    for name, digest in before.items():
        if name != 'index.html' and after.get(name) != digest:
            raise ValueError('Existing file changed: ' + name)
    if set(after) - set(before) != set(payload) - set(before):
        raise ValueError('Unexpected added/removed files')
    for name, digest in payload.items():
        if after.get(name) != digest:
            raise ValueError('Payload mismatch: ' + name)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'publish'])
    parser.add_argument('directory', type=pathlib.Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    if not str(root).startswith('/opt/logoff-wms-releases/public-light-20260925'):
        raise ValueError('Unexpected release directory')
    proof = json.loads((root / 'proof.json').read_text())
    payload = {'index.html': proof['indexSha256'], 'assets/public-light-20260925.css': proof['cssSha256']}
    payload.update({'assets/' + name: info['sha256'] for name, info in proof['chunks'].items()})
    for name, digest in payload.items():
        if sha((root / pathlib.Path(name).name).read_bytes()) != digest:
            raise ValueError('Upload hash mismatch: ' + name)
    if image('infra-web-1') != BASE or image('infra-api-1') != API:
        raise ValueError('Production changed; refusing stale release')
    if run(*COMPOSE, 'config', '--hash', 'web') != 'web ' + CONFIG:
        raise ValueError('Web service configuration changed')
    if args.action == 'prepare':
        before = hashes('infra-web-1')
        (root / 'before-files.json').write_text(json.dumps(before, indent=2))
        dockerfile = 'FROM ' + BASE + '\n' + '\n'.join('COPY ' + pathlib.Path(name).name + ' /usr/share/nginx/html/' + name for name in payload) + '\n'
        (root / 'Dockerfile').write_text(dockerfile)
        subprocess.run(['docker', 'build', '--network', 'none', '-t', TAG, str(root)], check=True)
        cid = run('docker', 'create', '--network', 'none', TAG)
        try:
            run('docker', 'start', cid)
            check_delta(before, hashes(cid), payload)
        finally:
            run('docker', 'rm', '-f', cid)
        result = {'preparedImage': run('docker', 'image', 'inspect', '--format', '{{.Id}}', TAG), 'baseWebImage': BASE, 'apiImageUnchanged': API, 'preservedFiles': len(before)-1, 'newAssets': len(payload)-1}
        (root / 'prepared.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))
        return
    prepared = json.loads((root / 'prepared.json').read_text())
    if run('docker', 'image', 'inspect', '--format', '{{.Id}}', TAG) != prepared['preparedImage']:
        raise ValueError('Prepared image changed')
    before = json.loads((root / 'before-files.json').read_text())
    if hashes('infra-web-1') != before:
        raise ValueError('Live public files changed after preparation')
    with open('/opt/logoff-wms/.release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if image('infra-web-1') != BASE or image('infra-api-1') != API:
            raise ValueError('Concurrent release detected')
        api_id = run('docker', 'inspect', '--format', '{{.Id}}', 'infra-api-1')
        run('docker', 'tag', BASE, 'logoff-web:before-public-light-20260925')
        try:
            run('docker', 'tag', TAG, 'infra-web')
            subprocess.run(COMPOSE + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'web'], check=True)
            check_delta(before, hashes('infra-web-1'), payload)
            if run('docker', 'inspect', '--format', '{{.Id}}', 'infra-api-1') != api_id:
                raise ValueError('API container changed')
            for attempt in range(10):
                try:
                    with urllib.request.urlopen('https://wms.logoff.pro/?release=public-light-20260925', timeout=10) as response:
                        if sha(response.read()) != payload['index.html']:
                            raise ValueError('Public index hash mismatch')
                    break
                except Exception:
                    if attempt == 9: raise
                    time.sleep(1)
        except Exception:
            run('docker', 'tag', BASE, 'infra-web')
            subprocess.run(COMPOSE + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'web'], check=True)
            raise
        result = {**prepared, 'published': True, 'apiContainerUnchanged': api_id, 'rollbackImage': 'logoff-web:before-public-light-20260925'}
        (root / 'published.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))

if __name__ == '__main__':
    main()
