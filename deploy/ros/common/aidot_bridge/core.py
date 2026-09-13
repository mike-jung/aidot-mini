"""Bounded, authenticated local IPC shared by ROS 1 and ROS 2 adapters."""
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import secrets
import stat
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

TERMINAL = {'SUCCEEDED', 'CANCELED', 'FAILED', 'TIMED_OUT'}

def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=file.name+'.', dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, allow_nan=False); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    directory = os.open(file.parent, os.O_RDONLY)
    try: os.fsync(directory)
    finally: os.close(directory)

def load_token(path):
    file = Path(path); file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream: stream.write(secrets.token_urlsafe(32) + '\n')
    except FileExistsError: pass
    mode = file.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077:
        raise ValueError('Bridge token must be a private regular file (0600)')
    token = file.read_text().strip()
    if not 32 <= len(token) <= 256 or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError('Invalid bridge token')
    return token

class BridgeError(Exception):
    def __init__(self, status, message):
        self.status = status; super().__init__(message)

class BridgeCore:
    def __init__(self, driver, journal, frame='map', stale_seconds=1.5, watchdog_seconds=2.0, acknowledge_recovery=False):
        self.driver = driver; self.journal = Path(journal); self.frame = frame
        self.lock = threading.RLock(); self.pose = None; self.pose_at = 0; self.battery = None; self.battery_at = 0
        self.stale_seconds = stale_seconds; self.watchdog_seconds = watchdog_seconds
        self.contact_at = time.monotonic(); self.started_at = self.contact_at
        self.history = {}; self.active = None; self.recovery_required = False; self.storage_fault = False
        self.runtime = None
        if self.journal.exists():
            saved = json.loads(self.journal.read_text())
            self.history = saved.get('history', {})
            if len(self.history) > 128: raise ValueError('Command journal is too large')
            self.recovery_required = any(c['state'] not in TERMINAL for c in self.history.values())
            if acknowledge_recovery:
                for command in self.history.values():
                    if command['state'] not in TERMINAL:
                        command.update(state='FAILED', reason='Operator reconciled previous process after confirming robot stop')
                self.recovery_required = False; self.save()

    def save(self):
        atomic_json(self.journal, {'schema': 'aidot-ros-journal/v1', 'history': self.history})

    def persist_result(self):
        try: self.save(); return True
        except OSError:
            self.storage_fault = True; self.recovery_required = True
            # Even when disk writes fail, cancellation must still be attempted.
            if self.active:
                try: self.driver.cancel()
                except Exception: pass
            return False

    def update_pose(self, x, y, yaw, frame):
        if frame != self.frame or not all(not isinstance(v,bool) and isinstance(v, (int,float)) and math.isfinite(v) for v in [x,y,yaw]): return
        with self.lock:
            self.pose = {'x': float(x), 'y': float(y), 'yaw': float(yaw), 'frameId': frame}
            self.pose_at = time.monotonic()

    def update_battery(self, fraction):
        if not isinstance(fraction,bool) and isinstance(fraction, (int,float)) and math.isfinite(fraction) and 0 <= fraction <= 1:
            with self.lock: self.battery = fraction * 100; self.battery_at = time.monotonic()

    def snapshot(self, contact=False):
        with self.lock:
            now = time.monotonic()
            if contact: self.contact_at = now
            fresh = self.pose is not None and now - self.pose_at <= self.stale_seconds
            available = bool(self.driver.available())
            return {'schema': 'aidot-ros-bridge/v1', 'ready': bool(available and fresh and not self.recovery_required),
                    'navigationAvailable': available, 'runtime': self.runtime,
                    'pose': self.pose, 'poseAgeMs': round((now-self.pose_at)*1000) if self.pose else None,
                    'battery': self.battery, 'batteryAgeMs': round((now-self.battery_at)*1000) if self.battery is not None else None,
                    'recoveryRequired': self.recovery_required, 'storageFault': self.storage_fault,
                    'active': dict(self.history[self.active]) if self.active else None,
                    'lastCommand': dict(next(reversed(self.history.values()))) if self.history else None,
                    'capabilities': ['navigateToPose', 'cancelNavigation'], 'frameId': self.frame}

    def navigate(self, body):
        if not isinstance(body, dict) or set(body) - {'commandId','x','y','yaw','frameId','timeoutSec'}:
            raise BridgeError(400, 'Unknown navigation fields')
        command_id = body.get('commandId')
        if not isinstance(command_id,str) or not 1 <= len(command_id) <= 100 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_:-.' for c in command_id):
            raise BridgeError(400, 'Invalid commandId')
        values = [body.get('x'), body.get('y'), body.get('yaw',0), body.get('timeoutSec',120)]
        if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in values): raise BridgeError(400, 'Finite numeric coordinates are required')
        x,y,yaw,timeout = map(float, values)
        if max(abs(x),abs(y)) > 100000 or abs(yaw) > math.pi or not 1 <= timeout <= 3600 or body.get('frameId',self.frame) != self.frame:
            raise BridgeError(400, 'Navigation bounds or frame mismatch')
        goal = {'x':x,'y':y,'yaw':yaw,'frameId':self.frame,'timeoutSec':timeout}
        fingerprint = hashlib.sha256(json.dumps(goal,sort_keys=True).encode()).hexdigest()
        with self.lock:
            self.contact_at = time.monotonic()
            if command_id in self.history:
                existing = self.history[command_id]
                if existing['fingerprint'] != fingerprint: raise BridgeError(409, 'commandId reused with a different goal')
                return dict(existing)
            if self.recovery_required: raise BridgeError(409, 'Previous motion needs operator reconciliation')
            if self.active: raise BridgeError(409, 'Another navigation is active')
            if not self.snapshot()['ready']: raise BridgeError(503, 'Navigation server or fresh localization is unavailable')
            if len(self.history) >= 128: del self.history[next(iter(self.history))]
            command = {'commandId':command_id,'goal':goal,'fingerprint':fingerprint,'state':'DISPATCHING','reason':None}
            self.history[command_id] = command; self.active = command_id
            self.deadline = time.monotonic() + timeout
            try: self.save()  # Write intent before an actuator-facing call.
            except OSError:
                command.update(state='FAILED', reason='Command intent could not be persisted')
                self.active = None; self.storage_fault = True; self.recovery_required = True
                raise BridgeError(503, 'Command journal is unavailable; no goal was dispatched')
            try: self.driver.navigate(goal, lambda state,reason=None: self.report(command_id,state,reason))
            except Exception:
                # The driver may have sent the goal before raising. Do not claim that motion stopped.
                command.update(state='CANCEL_REQUESTED',reason='Driver dispatch outcome is unknown')
                self.recovery_required = True; self.persist_result()
                try: self.driver.cancel()
                except Exception: pass
            return dict(command)

    def report(self, command_id, state, reason=None):
        if state not in {'EXECUTING','UNCERTAIN',*TERMINAL}: return
        with self.lock:
            command = self.history.get(command_id)
            if not command or command['state'] in TERMINAL: return
            if state == 'EXECUTING' and command['state'] == 'CANCEL_REQUESTED': return
            if state == 'CANCELED' and command.get('reason') == 'deadline exceeded': state = 'TIMED_OUT'
            command['state'] = state
            if state == 'UNCERTAIN': self.recovery_required = True
            if reason: command['reason'] = str(reason)[:200]
            if state in TERMINAL and self.active == command_id: self.active = None
            self.persist_result()

    def cancel(self, command_id=None, reason='requested'):
        with self.lock:
            if not self.active: return {'state':'IDLE','confirmedStopped':False}
            if command_id is not None and command_id != self.active: raise BridgeError(409, 'Cancel commandId does not match active navigation')
            command = self.history[self.active]
            if command['state'] != 'CANCEL_REQUESTED':
                command.update(state='CANCEL_REQUESTED',reason=reason); self.persist_result()
                try: self.driver.cancel()
                except Exception: self.recovery_required = True; self.persist_result()
            return dict(command)

    def watchdog(self):
        with self.lock:
            if not self.active: return
            now = time.monotonic()
            if now >= self.deadline: self.cancel(reason='deadline exceeded')
            elif now-self.contact_at > self.watchdog_seconds: self.cancel(reason='robot client heartbeat expired')
            elif self.pose is None or now-self.pose_at > self.stale_seconds: self.cancel(reason='localization expired')

class BridgeHttp:
    def __init__(self, core, token_file, port=8912):
        token = load_token(token_file); self.core = core; self.stopped = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def setup(self): super().setup(); self.connection.settimeout(2)
            def log_message(self, *args): pass
            def respond(self,status,value):
                data=json.dumps(value,allow_nan=False).encode();self.send_response(status)
                self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            def handle_request(self):
                try:
                    if self.headers.get('Origin') or self.headers.get('Sec-Fetch-Site')=='cross-site': raise BridgeError(403,'Browser access is not allowed')
                    if not hmac.compare_digest(self.headers.get('Authorization','').encode(), ('Bearer '+token).encode()): raise BridgeError(401,'Bridge authentication required')
                    if self.command=='GET' and self.path=='/v1/state': return self.respond(200,core.snapshot())
                    if self.command!='POST' or self.path not in ['/v1/state','/v1/navigate','/v1/cancel']: raise BridgeError(404,'Unknown bridge endpoint')
                    size=int(self.headers.get('Content-Length','0'))
                    if not 1 <= size <= 4096 or self.headers.get('Transfer-Encoding'): raise BridgeError(413,'Body must contain 1 to 4096 bytes')
                    if self.headers.get_content_type()!='application/json': raise BridgeError(415,'Use application/json')
                    body=json.loads(self.rfile.read(size))
                    if not isinstance(body,dict): raise BridgeError(400,'Expected an object')
                    if self.path=='/v1/state':
                        if body: raise BridgeError(400,'Heartbeat polling expects an empty object')
                        return self.respond(200,core.snapshot(contact=True))
                    if self.path=='/v1/navigate': return self.respond(202,core.navigate(body))
                    if set(body)-{'commandId'}: raise BridgeError(400,'Unknown cancellation fields')
                    return self.respond(202,core.cancel(body.get('commandId')))
                except BridgeError as e: self.respond(e.status,{'error':str(e)})
                except (ValueError,TimeoutError): self.respond(400,{'error':'Invalid request'})
                except (BrokenPipeError,ConnectionResetError): pass
                except Exception: self.respond(500,{'error':'Bridge request failed'})
            do_GET=handle_request
            do_POST=handle_request
        self.server=HTTPServer(('127.0.0.1',port),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        def watch():
            while not self.stopped.wait(0.1): core.watchdog()
        self.watch=threading.Thread(target=watch,daemon=True)
    def start(self): self.thread.start();self.watch.start()
    def close(self):
        self.core.cancel(reason='ROS bridge shutdown');self.stopped.set()
        self.server.shutdown();self.server.server_close();self.thread.join(3);self.watch.join(3)
