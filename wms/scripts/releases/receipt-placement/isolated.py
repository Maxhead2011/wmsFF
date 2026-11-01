"""TEST: boot the candidate and place two boxes against disposable PostgreSQL."""
from pathlib import Path
import subprocess, json, time, base64

root = Path('/opt/logoff-wms/wms/work/receipt-placement-840')
image = json.loads((root / 'verification.json').read_text())['images']['api']
network = 'receipt-placement-840-test'
pg = network + '-pg'
app = network + '-api'
def run(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)

assert network not in subprocess.check_output(['docker', 'network', 'ls', '--format', '{{.Name}}'], text=True).splitlines()
run('network', 'create', '--internal', network)
try:
    run('run', '-d', '--name', pg, '--network', network, '--memory', '512m', '-e', 'POSTGRES_PASSWORD=isolated-test', '-e', 'POSTGRES_DB=placement_test', 'postgres:16-alpine')
    for attempt in range(30):
        if subprocess.run(['docker', 'exec', pg, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(1)
    run('exec', pg, 'createdb', '-U', 'postgres', 'placement_analytics_test')
    environment = ['--network', network, '--memory', '1g',
                   '-e', f'DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/placement_test',
                   '-e', f'ANALYTICS_DATABASE_URL=postgresql://postgres:isolated-test@{pg}:5432/placement_analytics_test',
                   '-e', 'NODE_ENV=test', '-e', 'NODE_PATH=/app/apps/api/node_modules:/app/node_modules',
                   '-e', 'WMS_LAMODA_SECRET_KEY=' + base64.b64encode(bytes(range(32))).decode(),
                   '-e', 'WMS_RECEIPT_CHANNELS_ENABLED=false', '-v', str(root) + ':/release:ro', '-w', '/app/apps/api']
    for schema in ['prisma/schema.prisma', 'prisma/analytics/schema.prisma']:
        run('run', '--rm', *environment, '--entrypoint', 'sh', image, '-c', 'pnpm exec prisma db push --schema ' + schema + ' --skip-generate')
    run('run', '--rm', *environment, '--entrypoint', 'node', image, '/release/postgres.cjs')
    run('run', '-d', '--name', app, *environment, '-e', 'JWT_ACCESS_SECRET=synthetic-access-test', '-e', 'JWT_REFRESH_SECRET=synthetic-refresh-test', '-e', 'API_PORT=3000', '--entrypoint', 'node', image, 'dist/main.js')
    for attempt in range(45):
        result = subprocess.run(['docker', 'exec', app, 'node', '-e', "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')throw Error()}).catch(()=>process.exit(1))"], capture_output=True)
        if result.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Candidate failed full Nest health')
    proof = dict(image=image, fullApiHealth=True, syntheticOnly=True, concurrentPlacement=True)
    (root / 'isolated-proof.json').write_text(json.dumps(proof))
    print(json.dumps(proof))
finally:
    subprocess.run(['docker', 'rm', '-f', app, pg], check=False)
    subprocess.run(['docker', 'network', 'rm', network], check=False)
