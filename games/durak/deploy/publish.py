"""Isolated static /durak/ release. Password comes only from DURAK_SSH_PASSWORD."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import time

BASE='/var/www/logoff-durak'
CONFIG='/etc/nginx/sites-available/wms.logoff.pro'
SNIPPET='''    # BEGIN LOGOFF DURAK - isolated static game
    location = /durak { return 301 /durak/; }
    location ^~ /durak/ {
        root /var/www/logoff-durak/current;
        index index.html;
        try_files $uri $uri/ =404;
        types {
            text/html html;
            text/css css;
            application/javascript js mjs;
            application/json json;
            image/svg+xml svg;
            application/zip zip;
            text/plain txt;
        }
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'" always;
    }
    # END LOGOFF DURAK

'''

def nginx_config(original):
    # FIX: preserve all existing API/proxy text byte-for-byte and refuse ambiguous configurations.
    anchor='    location /api/ {'
    if original.count(anchor)!=1:
        raise ValueError('Expected exactly one existing WMS API route')
    if original.count(SNIPPET)==1:
        return original
    if '/durak' in original:
        raise ValueError('An unfamiliar durak route already exists; manual review required')
    return original.replace(anchor,SNIPPET+anchor,1)

def allowed(name):
    fixed={'index.html','release.json','CARD-ART-LICENSE.txt','core/rules.mjs',
           'web/app.mjs','web/match.mjs','web/style.css','web/card-finish.css',
           'downloads/LOGOFF-Durak-Windows.zip'}
    return name in fixed or re.fullmatch(r'web/cards/(?:[6-9TJQKA][CDHS]|1B)\.svg',name) is not None

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('site',type=Path)
    parser.add_argument('--publish',action='store_true')
    parser.add_argument('--review',default='')
    args=parser.parse_args()
    site=args.site.resolve()
    files=[]
    for path in site.rglob('*'):
        if path.is_symlink(): raise ValueError('Symlinks cannot be deployed')
        if not path.is_file(): continue
        name=path.relative_to(site).as_posix()
        if not allowed(name): raise ValueError('Unexpected public file: '+name)
        files.append((path,name,path.stat().st_size))
    release=json.loads((site/'release.json').read_text(encoding='utf-8'))
    if not files or not (site/'index.html').is_file(): raise ValueError('Site is incomplete')
    if release.get('windows'):
        archive=site/'downloads/LOGOFF-Durak-Windows.zip'
        if digest(archive)!=release['windows']['sha256']: raise ValueError('Windows archive hash mismatch')
    if args.publish and not re.fullmatch(r'https://github.com/Maxhead2011/wmsFF/pull/\d+',args.review):
        raise ValueError('A reviewed game PR URL is required')
    import paramiko
    client=paramiko.SSHClient()
    client.load_host_keys(str(Path.home()/'.ssh'/'known_hosts'))
    client.connect('159.194.217.147',username='root',password=os.environ['DURAK_SSH_PASSWORD'],timeout=20,look_for_keys=False,allow_agent=False)
    def run(command):
        _,stdout,stderr=client.exec_command(command,timeout=60)
        output=stdout.read().decode('utf-8'); error=stderr.read().decode('utf-8')
        if stdout.channel.recv_exit_status()!=0: raise RuntimeError(error or output or 'Remote command failed')
        return output.strip()
    sftp=client.open_sftp()
    try:
        if run('readlink -f /etc/nginx/sites-enabled/wms.logoff.pro')!=CONFIG:
            raise ValueError('Unexpected enabled WMS configuration')
        original=sftp.open(CONFIG,'r').read().decode('utf-8')
        candidate=nginx_config(original)
        total=sum(size for _,_,size in files)
        free=int(run("df -B1 --output=avail / | tail -1"))
        if total+5*1024**3>free: raise ValueError('Insufficient safe free-space reserve')
        if run('curl -fsS --max-time 15 https://wms.logoff.pro/health')!='ok': raise RuntimeError('WMS is not healthy before deployment')
        print(json.dumps({'files':len(files),'bytes':total,'freeBytes':free,'nginxChange':candidate!=original,'publish':args.publish}),flush=True)
        if not args.publish: return
        stamp=time.strftime('%Y%m%d-%H%M%S',time.gmtime())
        target=BASE+'/releases/'+stamp
        backup=CONFIG+'.before-durak-'+stamp
        # FIX: no replacement of existing release files, and no WMS container/database operations.
        run('test ! -e '+shlex.quote(target)+' && mkdir -p '+shlex.quote(target+'/durak'))
        previous=run('readlink '+shlex.quote(BASE+'/current')+' || true')
        if not previous:
            run('test ! -e '+shlex.quote(BASE+'/current'))
        hashes=[]
        for path,name,size in files:
            remote=target+'/durak/'+name
            run('mkdir -p '+shlex.quote(str(Path(remote).parent).replace('\\','/')))
            sftp.put(str(path),remote)
            sftp.chmod(remote,0o644)
            hashes.append(digest(path)+'  durak/'+name)
            if size>10*1024**2: print('UPLOADED '+name+' '+str(size)+' bytes',flush=True)
        with sftp.open(target+'/MANIFEST.sha256','w') as stream: stream.write('\n'.join(hashes)+'\n')
        run('cd '+shlex.quote(target)+' && sha256sum -c MANIFEST.sha256 >/dev/null')
        # FIX: reject concurrent Nginx changes rather than overwrite them with an older snapshot.
        if sftp.open(CONFIG,'r').read().decode('utf-8')!=original:
            raise RuntimeError('Nginx changed during upload; release uploaded but not activated')
        run('cp -p '+shlex.quote(CONFIG)+' '+shlex.quote(backup))
        switched=False
        try:
            if candidate!=original:
                temporary=CONFIG+'.durak-candidate-'+stamp
                with sftp.open(temporary,'w') as stream: stream.write(candidate)
                sftp.chmod(temporary,0o644)
                run('mv '+shlex.quote(temporary)+' '+shlex.quote(CONFIG))
            run('ln -s '+shlex.quote(target)+' '+shlex.quote(BASE+'/current-'+stamp)+' && mv -Tf '+shlex.quote(BASE+'/current-'+stamp)+' '+shlex.quote(BASE+'/current'))
            switched=True
            run('nginx -t && systemctl reload nginx')
            run('curl -fsS --max-time 20 https://wms.logoff.pro/durak/release.json >/dev/null')
            run('curl -fsS --max-time 20 https://wms.logoff.pro/health >/dev/null')
        except Exception:
            run('cp -p '+shlex.quote(backup)+' '+shlex.quote(CONFIG))
            if switched:
                if previous:
                    run('ln -s '+shlex.quote(previous)+' '+shlex.quote(BASE+'/rollback-'+stamp)+' && mv -Tf '+shlex.quote(BASE+'/rollback-'+stamp)+' '+shlex.quote(BASE+'/current'))
                else: run('unlink '+shlex.quote(BASE+'/current'))
            run('nginx -t && systemctl reload nginx')
            raise
        report={'url':'https://wms.logoff.pro/durak/','target':target,'previous':previous,'nginxBackup':backup,'review':args.review,'windows':bool(release.get('windows'))}
        (site.parent/('deployment-'+stamp+'.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('DURAK_PUBLISHED '+json.dumps(report),flush=True)
    finally:
        sftp.close(); client.close()

if __name__=='__main__': main()
