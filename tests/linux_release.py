"""Run a built release: real TLS/HTTP/SQLite, graceful stop and persistence."""
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

root=Path(sys.argv[1]).resolve();launcher=root/'bin/aidot-mini';checks=[]
metadata_before={p:p.read_bytes() for p in (root/'app/workspace').rglob('*.meta.json')}
def check(name,value):
    assert value,name;checks.append(name);print('PASS '+name,flush=True)
with tempfile.TemporaryDirectory(prefix='aidot-linux-') as temp:
    temp=Path(temp);env=os.environ.copy();env.update({'DATA_DIR':str(temp/'data'),'LOG_DIR':str(temp/'log'),'LOG_TO_FILE':'false','HOST':'127.0.0.1','LOG_LEVEL':'error'})
    inspected=subprocess.check_output([str(launcher),'--check'],env=env,text=True)
    check('bundled Node file hashes, CPU, SQLite and crypto',json.loads(inspected)['status']=='passed')
    check('installed application and prepared cache are readable by the service account',all((p.stat().st_mode & (0o005 if p.is_dir() else 0o004)) == (0o005 if p.is_dir() else 0o004) for p in [root/'app',*(root/'app').rglob('*')]))
    cert=temp/'cert.pem';key=temp/'key.pem'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',str(key),'-out',str(cert)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env.update({'PORT':str(port),'HTTPS_ENABLED':'true','TLS_CERT_FILE':str(cert),'TLS_KEY_FILE':str(key)})
    base='https://127.0.0.1:'+str(port);context=ssl.create_default_context(cafile=str(cert));token=None;process=None
    def request(route,body=None,method=None,auth=True):
        headers={'Content-Type':'application/json'}
        if auth and token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try:
            with urllib.request.urlopen(req,context=context,timeout=3) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)
    def start(robot=False):
        global process,token
        process=subprocess.Popen([str(launcher),*(['--robot'] if robot else [])],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        end=time.monotonic()+10
        while time.monotonic()<end:
            if process.poll() is not None:raise AssertionError(process.communicate()[0])
            try:
                if request('/health/ready',auth=False)[0]==200:break
            except (OSError,urllib.error.URLError):pass
            time.sleep(.05)
        else:raise AssertionError('Release did not become ready')
        token=(temp/'data/admin-token').read_text().strip()
    def stop():
        global process
        if process and process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:output=process.communicate(timeout=12)[0]
            except subprocess.TimeoutExpired:process.kill();process.communicate();raise AssertionError('Shutdown timed out')
            check('SIGTERM completes without forced kill',process.returncode==0)
        process=None
    try:
        account={'username':'release-admin','password':'release test password','remember':True}
        setup=subprocess.run([str(launcher),'--admin-account','--stdin'],env=env,input=json.dumps(account),text=True,capture_output=True)
        if setup.returncode:print('Account command exit',setup.returncode,setup.stderr.replace(account['password'],'<redacted>'),flush=True)
        check('bundled account command creates credentials privately',setup.returncode==0 and account['password'] not in setup.stdout+setup.stderr)
        start();check('TLS with CA verification and readiness',request('/health/ready')[0]==200)
        meta_status,meta=request('/admin/metadata')
        records=meta.get('data',{}).get('controllers',[])+meta.get('data',{}).get('services',[])
        check('prepared metadata loaded by the bundled server',meta_status==200 and len(records)==2 and all(item['status']=='loaded' for item in records))
        req=urllib.request.Request(base+'/admin/login',data=json.dumps(account).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,context=context,timeout=5) as response:
            cookie=response.headers['Set-Cookie'];session=json.load(response)['data'];check('ID/password login sets Secure HttpOnly remembered cookie','Secure' in cookie and 'HttpOnly' in cookie and 'Max-Age=604800' in cookie)
        cookie=cookie.split(';')[0]
        def session_request():
            req=urllib.request.Request(base+'/admin/session',headers={'Cookie':cookie})
            with urllib.request.urlopen(req,context=context,timeout=3) as response:return response.status,json.load(response)
        check('password session reads administrator APIs',session_request()[1]['data']['username']=='release-admin')
        check('default public Note API is reachable',request('/api/notes',auth=False)[0]==200)
        check('anonymous administrator API rejected',request('/admin/status',auth=False)[0]==401)
        status,created=request('/api/notes',{'title':'Linux release probe','body':'durable'});check('SQLite HTTP write',status==201);note_id=created['data']['insertId']
        status,updated=request('/api/notes/'+str(note_id),{'title':'Linux updated','body':'durable'},method='PUT');check('generated Note update returns affected count',status==200 and updated['data']=={'rowsAffected':1})
        status,info=request('/admin/status');check('release reports package version',status==200 and info['data']['version']==json.loads((root/'app/package.json').read_text())['version'])
        rss=info['data']['rssMB']
        req=urllib.request.Request(base+'/admin/events',headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(req,context=context,timeout=3) as stream:
            lines=[stream.readline().decode() for _ in range(5)]
            check('authenticated SSE status on bundled server','event: status\n' in lines)
        stop();start();check('committed row survives process restart',request('/api/notes/'+str(note_id))[1]['data']['body']=='durable')
        check('installed metadata is unchanged after restart',bool(metadata_before) and all(p.read_bytes()==content for p,content in metadata_before.items()))
        check('remembered password session survives bundled-server restart',session_request()[0]==200)
        check('stored row can be deleted',request('/api/notes/'+str(note_id),method='DELETE')[0]==200);stop()
        env.update({'ROBOT_PROTOCOL':'robaton-demo-v050','ROBOT_ID':'amr-a','ROBATON_URL':'http://127.0.0.1:9','ROBATON_API_TOKEN':'isolated-demo-token'})
        start(robot=True);status,state=request('/admin/robot');check('packaged robot entrypoint exposes protected diagnostics',status==200 and state['data']['protocol']=='robaton-demo-v050');stop()
        print(json.dumps({'status':'passed','checks':len(checks),'node':json.loads(inspected)['node'],'arch':json.loads(inspected)['arch'],'observedCoreRssMiB':rss,'note':'one rounded host sample, not a benchmark'}))
    finally:
        if process and process.poll() is None:process.terminate();process.wait(timeout=12)
