"""TEST: candidate API and Prisma queries use disposable internal PostgreSQL only."""
from pathlib import Path
import subprocess, json, time, base64

ROOT = Path('/opt/logoff-wms/wms/work/ozon-all-clients-20261029')
verification = json.loads((ROOT / 'verification.json').read_text())
image = verification['images']['api']
network, pg, api = 'ozon-all-clients-test', 'ozon-all-clients-test-pg', 'ozon-all-clients-test-api'


def run(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)


assert network not in subprocess.check_output(['docker', 'network', 'ls', '--format', '{{.Name}}'], text=True).splitlines()
assert not {pg, api}.intersection(subprocess.check_output(['docker', 'ps', '-a', '--format', '{{.Names}}'], text=True).splitlines())
run('network', 'create', '--internal', network)
try:
    run('run', '-d', '--name', pg, '--network', network, '-e', 'POSTGRES_PASSWORD=isolated-test',
        '-e', 'POSTGRES_DB=ozon_browse_test', 'postgres:16-alpine')
    ready = False
    for attempt in range(30):
        if subprocess.run(['docker', 'exec', pg, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
            ready = True
            break
        time.sleep(1)
    assert ready, 'Disposable PostgreSQL did not start'
    run('exec', pg, 'createdb', '-U', 'postgres', 'ozon_browse_analytics_test')
    env = ['--network', network, '-e', f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/ozon_browse_test',
           '-e', f'ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/ozon_browse_analytics_test',
           '-e', 'NODE_ENV=test', '-e', 'WMS_MARKETPLACE_WORKSPACES_ENABLED=true', '-e', 'WMS_OZON_FBO_IMPORT_ENABLED=true',
           '-e', 'WMS_LAMODA_ENABLED=true', '-e', 'WMS_LAMODA_FBO_ASSEMBLY_ENABLED=true',
           '-e', 'WMS_LAMODA_SECRET_KEY=' + base64.b64encode(bytes(range(32))).decode(),
           '-e', 'WMS_RECEIPT_CHANNELS_ENABLED=false', '-e', 'NODE_PATH=/app/node_modules:/app/apps/api/node_modules']
    run('run', '--rm', *env, '--entrypoint', 'sh', image, '-c',
        'cd /app/apps/api && pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate')
    result = run('run', '--rm', '-i', *env, '--entrypoint', 'node', image,
                 input=(ROOT / 'postgres.cjs').read_bytes(), capture_output=True)
    print(result.stdout.decode())
    proof = json.loads(result.stdout.decode().splitlines()[-1])
    assert proof['passed'] >= 5 and proof['controllerDecorators']
    run('run', '--rm', *env, '--entrypoint', 'sh', image, '-c',
        'cd /app/apps/api && pnpm exec prisma db push --schema prisma/analytics/schema.prisma --skip-generate')
    run('run', '-d', '--name', api, *env, '-e', 'JWT_ACCESS_SECRET=synthetic-test-access',
        '-e', 'JWT_REFRESH_SECRET=synthetic-test-refresh', '-e', 'API_PORT=3000',
        '-w', '/app/apps/api', '--entrypoint', 'node', image, 'dist/main.js')
    healthy = False
    for attempt in range(40):
        probe = subprocess.run(['docker', 'exec', api, 'node', '-e',
                                "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"],
                               capture_output=True)
        if probe.returncode == 0:
            healthy = True
            break
        time.sleep(1)
    assert healthy, 'Candidate API failed to start against disposable database'
    proof.update(fullApiHealth=True, image=image, apiHashes=verification['hashes']['api'])
    (ROOT / 'api-proof.json').write_text(json.dumps(proof))
    print(json.dumps(proof))
except subprocess.CalledProcessError as error:
    if error.stdout:
        print(error.stdout.decode())
    if error.stderr:
        print(error.stderr.decode())
    raise
finally:
    for name in [api, pg]:
        subprocess.run(['docker', 'rm', '-f', name], check=False, capture_output=True)
    subprocess.run(['docker', 'network', 'rm', network], check=False, capture_output=True)
