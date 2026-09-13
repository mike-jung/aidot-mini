#!/usr/bin/env python3
"""Build small ROS source kits and, with --compile, installed SDK overlays."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = {'ros1': ('aidot_mini_ros', 'noetic'), 'ros2': ('aidot_mini_ros2', 'jazzy')}
IGNORE = shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo')


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def archive(directory, destination):
    temporary = destination.with_suffix(destination.suffix + '.tmp')
    try:
        with tarfile.open(temporary, 'w:gz') as out:
            out.add(directory, arcname=directory.name,
                    filter=lambda item: None if '__pycache__' in Path(item.name).parts or item.name.endswith(('.pyc', '.pyo')) else item)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def os_release():
    file = Path('/etc/os-release')
    return dict(line.split('=', 1) for line in file.read_text().splitlines() if '=' in line) if file.exists() else {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/ros')
    parser.add_argument('--family', choices=['ros1', 'ros2', 'all'], default='all')
    parser.add_argument('--compile', action='store_true', help='Build using the sourced ROS SDK and also package its install tree')
    args = parser.parse_args()
    if args.compile and (args.family == 'all' or os.environ.get('ROS_VERSION') != args.family[-1] or not os.environ.get('ROS_DISTRO')):
        parser.error('--compile requires one --family and that ROS environment to be sourced')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    for family, (package, default_distro) in FAMILIES.items():
        if args.family not in ['all', family]:
            continue
        name = f'aidot-mini-{version}-{family}'
        workspace = args.output / name
        identity = {'format': 'aidot-ros-workspace/v1', 'name': name}
        marker = workspace / '.aidot-ros-workspace.json'
        if workspace.exists():
            if workspace.is_symlink() or not marker.is_file() or json.loads(marker.read_text()) != identity:
                parser.error(f'Refusing to replace an unowned directory: {workspace}; choose a fresh --output')
            shutil.rmtree(workspace)
        target = workspace / 'src' / package
        shutil.copytree(ROOT / 'deploy' / family / package, target, ignore=IGNORE)
        marker.write_text(json.dumps(identity) + '\n')
        shutil.copytree(ROOT / 'deploy/ros/common/aidot_bridge', target / 'aidot_bridge', ignore=IGNORE)
        package_xml = target / 'package.xml'
        tree = ET.parse(package_xml)
        tree.getroot().find('version').text = version
        tree.write(package_xml, encoding='utf-8', xml_declaration=True)
        if family == 'ros1':
            (target / 'scripts/aidot_robot_bridge').chmod(0o755)
        for guide in ['DEPLOY_ROS.md', 'ROBOT_CONSOLE_V040_KO.md', 'ROS_SDK_BUILD_KO.md']:
            if (ROOT / 'docs' / guide).is_file():
                shutil.copy2(ROOT / 'docs' / guide, workspace / guide)
        for notice in ['LICENSE', 'NOTICE', 'COPYRIGHT.md']:
            shutil.copy2(ROOT / notice, workspace / notice)
        commands = ('catkin_make install\n. install/setup.bash\nroslaunch aidot_mini_ros robot.launch' if family == 'ros1' else
                    'colcon build --merge-install\n. install/setup.bash\nros2 launch aidot_mini_ros2 robot.launch.py')
        (workspace / 'README.md').write_text(
            f'# aidot-mini {version} / {family} source workspace\n\n'
            f'Requires the target ROS SDK and navigation message dependencies. Run from this directory:\n\n'
            f'```bash\n. /opt/ros/{default_distro}/setup.bash\n{commands}\n```\n\n'
            'This is a source kit, not a compiled install tree or a complete ROS distribution. '
            'The aidot-mini web server and Node runtime are distributed separately. '
            'See DEPLOY_ROS.md for topic, action, frame, token and service configuration.\n', encoding='utf-8')
        source_archive = args.output / (name + '.tar.gz')
        archive(workspace, source_archive)
        result = {'family': family, 'workspace': str(workspace), 'sourceArchive': str(source_archive),
                  'sourceSha256': sha(source_archive), 'compiled': False}
        if args.compile:
            commands = ([['cmake', '-S', str(target), '-B', str(workspace / 'build'),
                          '-DCMAKE_INSTALL_PREFIX=' + str(workspace / 'install'),
                          '-DPYTHON_EXECUTABLE=' + sys.executable, '-DCATKIN_ENABLE_TESTING=OFF'],
                         ['cmake', '--build', str(workspace / 'build'), '--target', 'install']] if family == 'ros1' else
                        [[sys.executable, '-m', 'colcon', 'build', '--merge-install', '--packages-select', package]])
            for command in commands:
                subprocess.run(command, cwd=workspace, check=True)
            distro = os.environ['ROS_DISTRO']
            release = {key: value.strip('"') for key, value in os_release().items()}
            platform_tag = re.sub(r'[^a-zA-Z0-9_.-]', '_', release.get('ID', sys.platform) + release.get('VERSION_ID', '') + '-' + platform.machine())
            sdk_name = name + '-' + distro + '-' + platform_tag + '-sdk'
            with tempfile.TemporaryDirectory(prefix='aidot-ros-sdk-') as temporary:
                sdk = Path(temporary) / sdk_name
                shutil.copytree(workspace / 'install', sdk / 'install', symlinks=True, ignore=IGNORE)
                for notice in ['LICENSE', 'NOTICE']:
                    shutil.copy2(workspace / notice, sdk / notice)
                for guide in workspace.glob('*.md'):
                    if guide.name != 'README.md':
                        shutil.copy2(guide, sdk / guide.name)
                launch = 'roslaunch aidot_mini_ros robot.launch' if family == 'ros1' else 'ros2 launch aidot_mini_ros2 robot.launch.py'
                (sdk / 'README.md').write_text(
                    f'# aidot-mini {version} / {distro} installed SDK overlay\n\n'
                    f'Built for {platform_tag}, Python {platform.python_version()}. Requires the matching ROS distribution and dependencies; '
                    'this archive does not contain the ROS distribution, Node, Nav2/move_base planners, or a robot firmware.\n\n'
                    f'Extract to the intended location, then from this directory:\n\n```bash\n. /opt/ros/{distro}/setup.bash\n. install/setup.bash\n{launch}\n```\n\n'
                    'For a different OS, ROS distribution, Python ABI or architecture, build the source kit on that target. '
                    'manifest.json records the build inputs, installed file hashes and dependency versions.\n', encoding='utf-8')
                manifest = {'format': 'aidot-mini-ros-sdk/v1', 'version': version, 'package': package,
                            'family': family, 'rosDistro': distro, 'architecture': platform.machine(),
                            'pythonVersion': platform.python_version(), 'os': release,
                            'baseImage': os.environ.get('AIDOT_ROS_BASE_IMAGE'), 'commands': commands,
                            'sourceArchiveSha256': sha(source_archive),
                            'sourceFiles': {f.relative_to(target).as_posix(): sha(f) for f in sorted(target.rglob('*')) if f.is_file() and '__pycache__' not in f.parts and f.suffix not in ['.pyc', '.pyo']},
                            'files': {f.relative_to(sdk).as_posix(): sha(f) for f in sorted(sdk.rglob('*')) if f.is_file()}}
                if shutil.which('dpkg-query'):
                    manifest['debianPackages'] = subprocess.check_output(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\n'], text=True).splitlines()
                (sdk / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
                installed_archive = args.output / (sdk_name + '.tar.gz')
                archive(sdk, installed_archive)
            result.update(compiled=True, installedArchive=str(installed_archive), installedSha256=sha(installed_archive))
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
