"""FIX: guarded exact-overlay build/publication for our WMS, with automatic rollback."""
import fcntl, hashlib, importlib.util, json, os, pathlib, subprocess, sys, tempfile, time, urllib.request

r = pathlib.Path(__file__).resolve().parent
compose = pathlib.Path('/opt/wms-restore/compose.json')
api_files = ['modules/skus/skus.service.js', 'modules/skus/skus.controller.js', 'modules/skus/dto/bulk-update-sku-volume.dto.js']
web_files = ['index.html', 'assets/bulk-volume-search-20261117.js', 'assets/bulk-volume-search-20261117.css']
locks = [open(p, 'a') for p in ['/opt/logoff-wms/.release.lock', '/opt/wms-restore/.release-pr863.lock', '/run/logoff-wms-web-release.lock']]
for lock in locks:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

def run(*args, data=None):
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise RuntimeError('Command failed: ' + args[0] + '\n' + p.stderr.decode(errors='replace')[-1800:])
    return p.stdout

def inspect(name): return json.loads(run('docker', 'inspect', name))[0]
def sha(data): return hashlib.sha256(data).hexdigest()
def filemap(directory): return {p.relative_to(directory).as_posix(): sha(p.read_bytes()) for p in directory.rglob('*') if p.is_file()}
def webmap(prefix):
    text = run(*prefix, 'sh', '-c', 'cd /usr/share/nginx/html && find . -type f -exec sha256sum {} +').decode()
    return {name.removeprefix('./'): digest for digest, name in (line.split('  ', 1) for line in text.splitlines())}
def apimap(name):
    code = "const fs=require('fs'),c=require('crypto'),r='/app/apps/api/dist',o={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())walk(p);else if(e.isFile())o[p.slice(r.length+1)]=c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}}walk(r);console.log(JSON.stringify(o))"
    return json.loads(run('docker', 'exec', name, 'node', '-e', code))
def public(path): return urllib.request.urlopen('https://wms.logoff.pro' + path, timeout=15).read()

captured = json.loads((r / 'containers-before.json').read_text())
before = {row['Name']: inspect(row['Name']) for row in captured}
for row in captured:
    assert (before[row['Name']]['Image'], before[row['Name']]['Id']) == (row['Image'], row['Id']), 'Concurrent release; recapture and review'
baseline = json.loads((r / 'manifest.json').read_text())
assert apimap('wms-local-api') == baseline['artifacts']['api-runtime.tar.gz']['files'], 'API runtime changed'
web_before = json.loads((r / 'web-before.json').read_text())
assert webmap(['docker', 'exec', 'wms-local-web']) == web_before, 'Web runtime changed'
spec = importlib.util.spec_from_file_location('release_baseline', r / 'release_baseline.py')
checks = importlib.util.module_from_spec(spec); spec.loader.exec_module(checks)
checks.verify(r)
api_base = before['/wms-local-api']['Image']; web_base = before['/wms-local-web']['Image']
original = compose.read_bytes(); config = json.loads(original)
for service in ['api', 'web']:
    assert inspect(config['services'][service]['image'])['Id'] == before['/wms-local-' + service]['Image']
api_environment = config['services']['api'].get('environment', {})
assert isinstance(api_environment, dict) and api_environment.get('WMS_BULK_VOLUME_SEARCH_ENABLED', 'true') == 'true', 'Unexpected flag override'

if '--publish' not in sys.argv:
    if not (r / 'candidate').exists(): checks.materialize(r, r / 'candidate')
    for name in api_files:
        (r / 'candidate' / name).write_bytes((r / 'overlay' / 'api' / name).read_bytes())
    checks.check_candidate(r, r / 'candidate', api_base, api_files)
    api_context = r / 'overlay' / 'api'
    (api_context / 'Dockerfile').write_text('FROM ' + api_base + '\nENV WMS_BULK_VOLUME_SEARCH_ENABLED=true\n' + ''.join('COPY ' + name + ' /app/apps/api/dist/' + name + '\n' for name in api_files))
    web_context = r / 'overlay' / 'web'
    (web_context / 'Dockerfile').write_text('FROM ' + web_base + '\n' + ''.join('COPY ' + name + ' /usr/share/nginx/html/' + name + '\n' for name in web_files))
    for service in ['api', 'web']:
        run('docker', 'build', '--pull=false', '--network=none', '-t', 'wms-bulk-volume-' + service + ':20261117', str(r / 'overlay' / service))
    api_image = inspect('wms-bulk-volume-api:20261117')['Id']; web_image = inspect('wms-bulk-volume-web:20261117')['Id']
    temp = run('docker', 'create', api_image, 'true').decode().strip()
    try: run('docker', 'cp', temp + ':/app/apps/api/dist', str(r / 'image-api-verified'))
    finally: run('docker', 'rm', temp)
    api_expected = filemap(r / 'candidate')
    assert filemap(r / 'image-api-verified') == api_expected, 'Unexpected image API delta'
    web_expected = {**web_before, **{name: sha((web_context / name).read_bytes()) for name in web_files}}
    assert webmap(['docker', 'run', '--rm', '--network=none', '--entrypoint', '', web_image]) == web_expected, 'Unexpected image web delta'
    runtime = run('docker', 'run', '--rm', '--network=none', '--entrypoint', 'node', '-e', 'NODE_PATH=/app/apps/api/node_modules', '-e', 'RUNTIME_DIR=/app/apps/api/dist', '-v', str(r / 'runtime.test.cjs') + ':/verify.cjs:ro', api_image, '/verify.cjs')
    assert json.loads(runtime)['passed']
    proof = {'apiBefore': api_base, 'webBefore': web_base, 'apiImage': api_image, 'webImage': web_image, 'apiFiles': api_expected, 'webFiles': web_expected, 'runtime': json.loads(runtime)}
    (r / 'image-proof.json').write_text(json.dumps(proof, indent=2))
    print(json.dumps({k: proof[k] for k in ['apiBefore', 'webBefore', 'apiImage', 'webImage', 'runtime']}), flush=True)
    sys.exit(0)

proof = json.loads((r / 'image-proof.json').read_text())
assert proof['apiBefore'] == api_base and proof['webBefore'] == web_base
assert inspect('wms-bulk-volume-api:20261117')['Id'] == proof['apiImage']
assert inspect('wms-bulk-volume-web:20261117')['Id'] == proof['webImage']
assert not (r / 'compose-before.json').exists(), 'Publication already attempted'
(r / 'compose-before.json').write_bytes(original); (r / 'compose-before.json').chmod(0o600)
others = set(run('docker', 'ps', '-aq').decode().split()) - {v['Id'][:12] for v in before.values()}
project = before['/wms-local-api']['Config']['Labels']['com.docker.compose.project']
for service in ['api', 'web']:
    run('docker', 'tag', before['/wms-local-' + service]['Image'], 'wms-bulk-volume-' + service + ':before-1022')
    config['services'][service]['image'] = proof[service + 'Image']

def install(content):
    with tempfile.NamedTemporaryFile(dir=compose.parent, delete=False) as f:
        f.write(content); filename = f.name
    os.chmod(filename, 0o600); os.replace(filename, compose)

def up(service, target, enabled):
    name = 'wms-local-' + service; prior = before['/' + name]
    run('docker', 'compose', '-p', project, '-f', str(compose), 'up', '-d', '--no-deps', service)
    current = inspect(name)['NetworkSettings']['Networks']
    for network, connection in prior['NetworkSettings']['Networks'].items():
        if network not in current:
            run('docker', 'network', 'connect', *(['--ip', connection['IPAddress']] if connection.get('IPAddress') else []), network, name)
    after = inspect(name)
    assert after['Image'] == target
    assert set(after['NetworkSettings']['Networks']) == set(prior['NetworkSettings']['Networks'])
    assert after['Mounts'] == prior['Mounts']
    expected_env = dict(x.split('=', 1) for x in prior['Config']['Env'])
    if service == 'api' and enabled: expected_env['WMS_BULK_VOLUME_SEARCH_ENABLED'] = 'true'
    assert dict(x.split('=', 1) for x in after['Config']['Env']) == expected_env, 'Unexpected environment change'

def health():
    for _ in range(45):
        try:
            if json.loads(public('/api/v1/health'))['status'] == 'ok': return
        except Exception: pass
        time.sleep(1)
    raise RuntimeError('Public health did not recover')

try:
    install(json.dumps(config, indent=2).encode())
    up('api', proof['apiImage'], True); health()
    up('web', proof['webImage'], True); health()
    assert apimap('wms-local-api') == proof['apiFiles']
    assert webmap(['docker', 'exec', 'wms-local-web']) == proof['webFiles']
    for name in web_files: assert sha(public('/' if name == 'index.html' else '/' + name)) == proof['webFiles'][name], 'Public file mismatch: ' + name
    after_ids = {inspect('wms-local-' + s)['Id'][:12] for s in ['api', 'web']}
    assert set(run('docker', 'ps', '-aq').decode().split()) - after_ids == others, 'Other containers changed'
    live = run('docker', 'exec', '-i', 'wms-local-api', 'node', data=(r / 'live-read.cjs').read_bytes())
    assert json.loads(live)['passed']
    report = {'pr': 1022, 'apiImage': proof['apiImage'], 'webImage': proof['webImage'], 'apiBefore': api_base, 'webBefore': web_base, 'sourceParityVerified': False, 'changedApi': api_files, 'changedWeb': web_files, 'assetHashes': {n: proof['webFiles'][n] for n in web_files}, 'health': 'ok', 'liveRead': json.loads(live), 'otherContainersPreserved': True, 'mountsAndNetworksPreserved': True, 'onlyEnvironmentChange': 'WMS_BULK_VOLUME_SEARCH_ENABLED=true', 'rollbackTags': ['wms-bulk-volume-api:before-1022', 'wms-bulk-volume-web:before-1022'], 'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    (r / 'published.json').write_text(json.dumps(report, indent=2)); print(json.dumps(report), flush=True)
except Exception:
    install(original); up('api', api_base, False); up('web', web_base, False); health()
    (r / 'rollback.json').write_text(json.dumps({'rolledBack': True})); raise
