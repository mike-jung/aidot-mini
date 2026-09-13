"""Run against a real ROS adapter and the isolated fake_navigation server.

Environment: BRIDGE_URL, BRIDGE_TOKEN_FILE. The outer harness owns ROS processes.
"""
import json
import os
from pathlib import Path
import time
import urllib.request
import urllib.error

base=os.environ.get('BRIDGE_URL','http://127.0.0.1:8912');token=Path(os.environ['BRIDGE_TOKEN_FILE']).read_text().strip()
results=[]
def request(route='/v1/state',body=None,auth=token):
    req=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,
                              headers={'Authorization':'Bearer '+auth,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=3) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:return error.code,json.load(error)
def until(predicate,seconds=10):
    deadline=time.monotonic()+seconds;last=None
    while time.monotonic()<deadline:
        status,last=request();assert status==200, f'State endpoint {status}: {last}'
        if predicate(last):return last
        time.sleep(.1)
    raise AssertionError('Timed out: '+json.dumps(last))
def check(name,condition):
    assert condition,name;results.append(name);print('PASS '+name,flush=True)

check('unauthenticated IPC rejected',request(auth='incorrect')[0]==401)
state=until(lambda s:s['ready'] and s['battery'] is not None)
check('ROS pose and battery received',abs(state['pose']['x']+4)<.01 and abs(state['battery']-75)<.01)
check('diagnostics expose the actual ROS family and resolved interfaces',state['runtime']['family'] in ['ros1','ros2'] and state['runtime']['poseTopic'].endswith('/amcl_pose') and state['navigationAvailable'] is True)
goal={'commandId':'live-success','x':-3.7,'y':-1.,'timeoutSec':10}
status,value=request('/v1/navigate',goal);check('action dispatch accepted',status==202)
check('conflicting id rejected',request('/v1/navigate',dict(goal,x=0))[0]==409)
state=until(lambda s:s['lastCommand']['state']=='SUCCEEDED')
check('ROS result and measured destination agree',abs(state['pose']['x']+3.7)<.02)
check('completed id replay returns original result',request('/v1/navigate',goal)[1]['state']=='SUCCEEDED')
request('/v1/navigate',{'commandId':'live-cancel','x':4.,'y':-1.,'timeoutSec':30})
until(lambda s:s['active'] and s['active']['state']=='EXECUTING')
status,cancel=request('/v1/cancel',{'commandId':'live-cancel'})
check('cancel acknowledged as request',status==202 and cancel['state'] in ['CANCEL_REQUESTED','CANCELED'])
state=until(lambda s:s['lastCommand']['state']=='CANCELED')
check('ROS cancellation result received',state['active'] is None)
request('/v1/navigate',{'commandId':'live-timeout','x':10.,'y':-1.,'timeoutSec':1})
state=until(lambda s:s['lastCommand']['state']=='TIMED_OUT')
check('deadline produces ROS-confirmed timeout',state['active'] is None)
request('/v1/navigate',{'commandId':'live-heartbeat','x':10.,'y':-1.,'timeoutSec':30})
# Read-only diagnostics must not keep a lost control client alive.
for _ in range(27):request();time.sleep(.1)
state=until(lambda s:s['lastCommand']['state']=='CANCELED')
check('read-only diagnostics do not mask a missing control heartbeat',state['active'] is None)
print(json.dumps({'passed':len(results),'tests':results,'transport':'actual ROS actions/topics; simulated navigation'}))
