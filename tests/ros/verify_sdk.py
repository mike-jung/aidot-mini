#!/usr/bin/env python3
"""Build and relocate the SDK, then test installed nodes on an isolated ROS graph.

Use only in the supplied disposable QA containers. Navigation is simulated.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--node-modules', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('AIDOT_ISOLATED_ROS_QA') != '1':
        parser.error('Run in a disposable container with AIDOT_ISOLATED_ROS_QA=1, never on a physical robot graph')
    family = 'ros' + os.environ['ROS_VERSION']
    distro = os.environ['ROS_DISTRO']
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    evidence = args.output / 'evidence'
    evidence.mkdir(exist_ok=True)
    base_env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1')
    processes = []
    handles = []

    def run(command, name, env=None, cwd=ROOT, timeout=180):
        result = subprocess.run([str(x) for x in command], cwd=cwd, env=env or base_env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        (evidence / (name + '.log')).write_text(result.stdout, encoding='utf-8')
        print(name + ': exit=' + str(result.returncode), flush=True)
        if result.returncode:
            print(result.stdout[-12000:], flush=True)
            result.check_returncode()
        return result.stdout

    def start(command, name, env):
        handle = (evidence / (name + '.log')).open('w', encoding='utf-8')
        handles.append(handle)
        process = subprocess.Popen([str(x) for x in command], cwd='/', env=env, stdout=handle,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(process)
        return process

    def await_ready(predicate, seconds=25):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            for process in processes:
                if process.poll() is not None:
                    raise RuntimeError('ROS process exited early: ' + str(process.args))
            try:
                if predicate():
                    return
            except (OSError, ValueError):
                pass
            time.sleep(.1)
        raise TimeoutError('ROS readiness timeout')

    try:
        syntax = []
        for file in list((ROOT / 'deploy/ros').rglob('*.py')) + list((ROOT / 'deploy/ros1').rglob('*.py')) + list((ROOT / 'deploy/ros2').rglob('*.py')) + list((ROOT / 'tests/ros').rglob('*.py')) + [ROOT / 'scripts/build-ros.py']:
            compile(file.read_bytes(), str(file), 'exec')
            syntax.append(str(file.relative_to(ROOT)))
        (evidence / 'syntax.json').write_text(json.dumps({'passed': len(syntax), 'files': syntax}, indent=2) + '\n')
        build = run([sys.executable, ROOT / 'scripts/build-ros.py', '--family', family, '--compile', '--output', args.output], 'build', timeout=240)
        artifact = json.loads(build.strip().splitlines()[-1])
        assert artifact['compiled'] is True
        with tempfile.TemporaryDirectory(prefix='aidot-ros-relocated-') as temporary:
            temporary = Path(temporary)
            with tarfile.open(artifact['installedArchive']) as archive:
                for member in archive.getmembers():
                    if member.name.startswith('/') or '..' in Path(member.name).parts or member.islnk():
                        raise ValueError('Unexpected archive path')
                    if member.issym() and (member.linkname.startswith('/') or '..' in Path(member.linkname).parts):
                        raise ValueError('Nonportable install symlink')
                archive.extractall(temporary)
            sdk = next(temporary.glob('*-sdk'))
            manifest = json.loads((sdk / 'manifest.json').read_text())
            for relative, expected in manifest['files'].items():
                assert hashlib.sha256((sdk / relative).read_bytes()).hexdigest() == expected, relative
            workspace = Path(artifact['workspace'])
            assert workspace.parent == args.output and workspace.name.startswith('aidot-mini-')
            shutil.rmtree(workspace)
            environment = subprocess.check_output(['bash', '-c', '. "$1/install/setup.bash"; env -0', 'bash', str(sdk)], env=base_env)
            env = dict(item.decode().split('=', 1) for item in environment.split(b'\0') if b'=' in item)
            env.update(BRIDGE_URL='http://127.0.0.1:8912', AIDOT_TEST_ROS_FAMILY=family)
            data = temporary / 'private-state'
            env['BRIDGE_TOKEN_FILE'] = str(data / 'bridge-token')
            env['ROS_LOG_DIR'] = str(temporary / 'ros-logs')
            # Both execution and import lookup must use the relocated installation.
            package = manifest['package']
            package_dir = sdk / 'install/share' / package
            assert ET.parse(package_dir / 'package.xml').findtext('version') == manifest['version']
            import_env = dict(env)
            if family == 'ros1':
                import_env['PYTHONPATH'] = str(sdk / 'install/lib' / package) + os.pathsep + env.get('PYTHONPATH', '')
            origin = run([sys.executable, '-c', 'import aidot_bridge.core; print(aidot_bridge.core.__file__)'], 'installed-import', env=import_env, cwd=temporary).strip()
            assert origin.startswith(str(sdk / 'install')), origin
            run([sys.executable, '-m', 'unittest', 'discover', '-s', ROOT / 'tests/ros', '-v'], 'unit', env=env)
            if family == 'ros1':
                import xmlrpc.client
                start(['roscore'], 'roscore', env)
                await_ready(lambda: xmlrpc.client.ServerProxy(env['ROS_MASTER_URI']).getPid('/aidot_sdk_qa')[0] == 1)
            start([sys.executable, ROOT / 'tests/ros/fake_navigation.py', family], 'navigation', env)
            command = (['roslaunch', package, 'robot.launch'] if family == 'ros1' else ['ros2', 'launch', package, 'robot.launch.py'])
            bridge = start(command + ['data_dir:=' + str(data)], 'bridge', env)

            def ready():
                token = Path(env['BRIDGE_TOKEN_FILE']).read_text().strip()
                req = urllib.request.Request(env['BRIDGE_URL'] + '/v1/state', headers={'Authorization': 'Bearer ' + token})
                with urllib.request.urlopen(req, timeout=1) as response:
                    return json.load(response).get('ready')

            await_ready(ready)
            run(['rosnode', 'list'] if family == 'ros1' else ['ros2', 'node', 'list', '--no-daemon'], 'graph', env=env)
            live = run([sys.executable, ROOT / 'tests/ros/live_bridge.py'], 'live-bridge', env=env)
            app = temporary / 'mini'
            shutil.copytree(ROOT, app, ignore=shutil.ignore_patterns('node_modules', 'dist', '__pycache__', '*.pyc', '.git'))
            shutil.copytree(args.node_modules, app / 'node_modules')
            env['APP_WORKSPACE'] = str(app / 'workspace')
            node_result = run([args.node, app / 'tests/ros/live_mini.mjs'], 'live-mini', env=env, cwd=app)
            os.killpg(bridge.pid, signal.SIGINT)
            assert bridge.wait(timeout=20) == 0, 'Installed launch did not exit cleanly'
            launch_log = (evidence / 'bridge.log').read_text()
            assert 'Traceback' not in launch_log and '[ERROR]' not in launch_log, 'ROS child failed even though launch returned zero'
            if family == 'ros2':
                assert 'process has finished cleanly' in launch_log, 'ROS 2 child completion not confirmed'
            processes.remove(bridge)
            executable = sdk / 'install/lib' / package / 'aidot_robot_bridge'
            parameters = ['_data_dir:=' + str(data)] if family == 'ros1' else ['--ros-args', '-p', 'data_dir:=' + str(data)]
            direct = start([executable] + parameters, 'bridge-sigterm', env)
            await_ready(ready)
            token = Path(env['BRIDGE_TOKEN_FILE']).read_text().strip()
            def ipc(route, body=None):
                request = urllib.request.Request(env['BRIDGE_URL'] + route,
                    data=None if body is None else json.dumps(body).encode(),
                    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=2) as response:return json.load(response)
            pose = ipc('/v1/state')['pose']
            ipc('/v1/navigate', {'commandId': 'sdk-shutdown', 'x': pose['x'] + 4, 'y': pose['y'], 'timeoutSec': 20})
            await_ready(lambda: ipc('/v1/state').get('active', {}).get('state') == 'EXECUTING')
            direct.send_signal(signal.SIGTERM)
            assert direct.wait(timeout=12) == 0, 'Installed node did not handle SIGTERM cleanly'
            journal = json.loads((data / 'ros-command-journal.json').read_text())
            assert journal['history']['sdk-shutdown']['state'] == 'CANCELED', 'Shutdown did not persist actual ROS cancellation'
            assert 'Traceback' not in (evidence / 'bridge-sigterm.log').read_text()
            shutdown = {'passed': 2, 'tests': ['launch and child handle group SIGINT cleanly',
                'installed executable handles SIGTERM during motion and journals real ROS cancellation'],
                'directNodeExit': direct.returncode, 'finalCommandState': journal['history']['sdk-shutdown']['state']}
            print('shutdown: 2 PASS', flush=True)
            summary = {'format': 'aidot-mini-ros-sdk-qa/v1', 'family': family, 'rosDistro': distro,
                       'version': manifest['version'], 'pythonVersion': manifest['pythonVersion'],
                       'architecture': manifest['architecture'], 'sdk': Path(artifact['installedArchive']).name,
                       'sdkSha256': artifact['installedSha256'], 'sourceArchive': Path(artifact['sourceArchive']).name,
                       'sourceArchiveSha256': artifact['sourceSha256'], 'installedPackageVersion': manifest['version'],
                       'installHashesVerified': len(manifest['files']), 'relocatedImport': origin,
                       'originalBuildWorkspaceRemoved': not workspace.exists(), 'launchShutdownExit': bridge.returncode,
                       'pythonSyntaxFiles': len(syntax), 'unitTests': 12,
                       'bridge': json.loads(live.strip().splitlines()[-1]),
                       'mini': json.loads(node_result.strip().splitlines()[-1]),
                       'shutdown': shutdown,
                       'scope': 'Real ROS SDK/install/launch/actions/topics and mini HTTP; simulated navigation, no physical robot'}
            (evidence / 'result.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
            print(json.dumps(summary), flush=True)
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
        for handle in handles:
            handle.close()


if __name__ == '__main__':
    main()
