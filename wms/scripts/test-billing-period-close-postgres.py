import pathlib,subprocess,time,json,sys
def run(*args,input=None):
    return subprocess.run(args,input=input,text=True,check=True,capture_output=True).stdout.strip()
image=sys.argv[2] if len(sys.argv)>2 else run('docker','inspect','--format','{{.Image}}','infra-postgres-1')
cid=run('docker','run','-d','--network','none','--label','codex.task=billing-period-close-tests','-e','POSTGRES_HOST_AUTH_METHOD=trust',image)
try:
    for _ in range(40):
        # TEST: wait for the final TCP listener, not the transient initialization socket.
        r=subprocess.run(['docker','exec',cid,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True)
        if r.returncode==0:break
        time.sleep(.5)
    else:raise RuntimeError('Isolated PostgreSQL did not start')
    def sql(text):return run('docker','exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres',input=text)
    root=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path('/tmp/billing-period-close-tests')
    sql((root/'fixture.sql').read_text());sql((root/'migration.sql').read_text());sql((root/'assert.sql').read_text())
    # Two independent connections: line mutation cannot cross an in-flight close snapshot.
    sql('INSERT INTO "BillingInvoice" VALUES (\'race\',\'c\',\'w\',100,0,\'ISSUED\',NOW(),NULL,NOW()); INSERT INTO "BillingInvoiceItem" VALUES (\'race-item\',\'race\',100);')
    a=subprocess.Popen(['docker','exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    # TEST: let UPDATE acquire the child row first; closure must never wait for that child while holding its parent.
    a.stdin.write("BEGIN; SELECT id FROM \"BillingInvoice\" WHERE id='race' FOR UPDATE; SELECT pg_sleep(1); INSERT INTO \"BillingPeriodClose\" VALUES ('race-close','c','w','2026-10-01','2026-10-03',ARRAY['race'],'[]','hash','Reviewed','u',NOW()); SELECT pg_sleep(2); COMMIT;\n");a.stdin.close();time.sleep(.5)
    b=subprocess.run(['docker','exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres'],input="UPDATE \"BillingInvoiceItem\" SET \"totalRub\"=200 WHERE id='race-item';",text=True,capture_output=True)
    a.wait(timeout=15);assert a.returncode==0;assert b.returncode!=0 and 'WMS_BILLING_PERIOD_CLOSED' in b.stderr
    assert sql("SELECT \"totalRub\" FROM \"BillingInvoiceItem\" WHERE id='race-item';").find('100.00')!=-1
    print(json.dumps({'isolatedPostgres':True,'migration':True,'immutableSnapshots':True,'paymentsAllowed':True,'lateDraftAllowed':True,'concurrentCloseGuard':True,'productionDataChanged':False}))
finally:run('docker','rm','-f',cid)
