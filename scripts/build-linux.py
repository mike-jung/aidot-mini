#!/usr/bin/env python3
"""Build relocatable Linux releases and optional Debian packages. No host install."""
import argparse, hashlib, json, os, pathlib, re, shutil, struct, subprocess, tarfile, tempfile
from runtime_assets import compiler_files, workspace_directory

ROOT = pathlib.Path(__file__).resolve().parents[1]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--arch',choices=['x64','arm64'],required=True)
    p.add_argument('--runtime-cache',type=pathlib.Path,default=ROOT/'runtime-cache/linux')
    p.add_argument('--output',type=pathlib.Path,default=ROOT/'dist/linux')
    p.add_argument('--download',action='store_true')
    p.add_argument('--deb',action='store_true')
    args=p.parse_args()
    lock=json.loads((ROOT/'deploy/linux/runtime-lock.json').read_text())
    runtime=lock['archives'][args.arch];args.runtime_cache.mkdir(parents=True,exist_ok=True)
    archive=args.runtime_cache/runtime['file']
    if not archive.exists() and args.download:
        npm=json.loads(subprocess.check_output(['node','--input-type=module','-e',
            "import {npmCommand} from './scripts/prepare-dependencies.mjs'; console.log(JSON.stringify(npmCommand()))"],cwd=ROOT,text=True))
        subprocess.run([npm['command'],*npm['args'],'pack','--ignore-scripts','--pack-destination',str(args.runtime_cache),runtime['package']],cwd=ROOT,check=True)
    if not archive.is_file():p.error('Runtime missing; supply --runtime-cache or use --download')
    if sha(archive)!=runtime['sha256']:raise SystemExit('Pinned runtime archive checksum mismatch')
    version=json.loads((ROOT/'package.json').read_text())['version']
    args.output.mkdir(parents=True,exist_ok=True)
    name=f'aidot-mini-{version}-linux-{args.arch}'
    with tempfile.TemporaryDirectory(prefix='aidot-build-') as temporary:
        release=pathlib.Path(temporary)/name
        (release/'runtime/bin').mkdir(parents=True)
        with tarfile.open(archive) as source:
            for src,dst in [('package/bin/node','runtime/bin/node'),('package/LICENSE','runtime/LICENSE')]:
                entry=source.getmember(src)
                if not entry.isfile():raise SystemExit('Expected regular runtime files')
                (release/dst).write_bytes(source.extractfile(entry).read())
        node=release/'runtime/bin/node';node.chmod(0o755)
        elf=node.read_bytes()[:64]
        if elf[:6]!=b'\x7fELF\x02\x01' or struct.unpack_from('<H',elf,18)[0]!={'x64':62,'arm64':183}[args.arch]:raise SystemExit('Runtime ELF architecture mismatch')
        symbols=subprocess.check_output(['readelf','--version-info',str(node)],text=True)
        abi={prefix:max(set(re.findall(prefix+r'_(\d+(?:\.\d+)+)',symbols)),key=lambda value:tuple(map(int,value.split('.')))) for prefix in ['GLIBC','GLIBCXX']}
        app=release/'app';app.mkdir()
        for folder in ['src','public','modules']:
            if (ROOT/folder).exists():shutil.copytree(ROOT/folder,app/folder,ignore=shutil.ignore_patterns('__pycache__','*.pyc','node_modules'))
        shutil.copytree(workspace_directory(ROOT),app/'workspace',ignore=shutil.ignore_patterns('__pycache__','*.pyc','node_modules'))
        for item in compiler_files(ROOT):
            destination=app/item.relative_to(ROOT);destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(item,destination)
        for file in ['start.js','package.json','LICENSE','NOTICE','COPYRIGHT.md']:shutil.copy2(ROOT/file,app/file)
        (app/'scripts').mkdir()
        for file in ['admin-token.mjs','admin-account.mjs','check-install.mjs','migrate-workspace.mjs','compile-workspace.mjs','dev-cert.mjs']:shutil.copy2(ROOT/'scripts'/file,app/'scripts'/file)
        # Installed application code is read-only to the service account. In
        # particular, build-time cache files start private (0700/0600).
        for item in [app,*app.rglob('*')]:
            if item.is_symlink():raise SystemExit('Symlinks are not allowed in packaged application assets')
            item.chmod(0o755 if item.is_dir() else 0o644)
        (release/'bin').mkdir();shutil.copy2(ROOT/'deploy/linux/aidot-mini',release/'bin/aidot-mini');(release/'bin/aidot-mini').chmod(0o755)
        shutil.copytree(ROOT/'deploy/linux',release/'deploy',ignore=shutil.ignore_patterns('aidot-mini'))
        shutil.copytree(ROOT/'deploy/robot',release/'deploy/robot')
        (release/'deploy/robot/aidot-ros-bridge').chmod(0o755)
        for family,package in [('ros1','aidot_mini_ros'),('ros2','aidot_mini_ros2')]:
            destination=release/'ros-src'/family/'src'/package
            shutil.copytree(ROOT/'deploy'/family/package,destination)
            shutil.copytree(ROOT/'deploy/ros/common/aidot_bridge',destination/'aidot_bridge',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
            if family=='ros1':(destination/'scripts/aidot_robot_bridge').chmod(0o755)
        for file in ['USAGE.md', 'DEPLOY_LINUX.md', 'DEPLOY_ROS.md']:
            if (ROOT/'docs'/file).is_file():shutil.copy2(ROOT/'docs'/file,release/file)
        shutil.copytree(ROOT/'docs/third-party',release/'third-party')
        shutil.copy2(ROOT/'docs/THIRD_PARTY_NOTICES.md',release/'THIRD_PARTY_NOTICES.md')
        files={f.relative_to(release).as_posix():sha(f) for f in sorted(release.rglob('*')) if f.is_file()}
        manifest={'format':'aidot-mini-linux/v1','version':version,'arch':args.arch,'nodeVersion':lock['nodeVersion'],'runtimeSource':runtime['package'],'runtimeArchiveSha256':runtime['sha256'],'minimumGlibc':abi['GLIBC'],'minimumGlibcxx':abi['GLIBCXX'],'files':files}
        (release/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        target=args.output/(name+'.tar.gz')
        with tarfile.open(target,'w:gz') as out:out.add(release,arcname=name)
        results=[{'file':str(target),'bytes':target.stat().st_size,'sha256':sha(target)}]
        if args.deb:
            debroot=pathlib.Path(temporary)/'deb';(debroot/'DEBIAN').mkdir(parents=True)
            shutil.copytree(release,debroot/'opt/aidot-mini')
            (debroot/'usr/lib/systemd/system').mkdir(parents=True)
            shutil.copy2(ROOT/'deploy/linux/aidot-mini.service',debroot/'usr/lib/systemd/system/aidot-mini.service')
            arch={'x64':'amd64','arm64':'arm64'}[args.arch]
            (debroot/'DEBIAN/control').write_text(f'Package: aidot-mini\nVersion: {version}\nArchitecture: {arch}\nMaintainer: AiDot\nDepends: libc6 (>= 2.28), libstdc++6, libgcc-s1, adduser\nDescription: Small device web server and optional robot client\n Includes pinned Node runtime; ROS dependencies are installed separately.\n')
            (debroot/'DEBIAN/postinst').write_text('#!/bin/sh\nset -eu\nif [ "$1" = configure ]; then\n getent passwd aidot-mini >/dev/null || adduser --system --group --home /var/lib/aidot-mini --no-create-home aidot-mini\n install -d -m 0700 -o aidot-mini -g aidot-mini /var/lib/aidot-mini /var/log/aidot-mini\n install -d -m 0750 /etc/aidot-mini\n if [ -d /run/systemd/system ]; then systemctl daemon-reload; fi\nfi\n')
            (debroot/'DEBIAN/postinst').chmod(0o755)
            (debroot/'DEBIAN/prerm').write_text('#!/bin/sh\nset -eu\nif [ -d /run/systemd/system ]; then systemctl stop aidot-mini.service || true; fi\n')
            (debroot/'DEBIAN/prerm').chmod(0o755)
            deb=args.output/f'aidot-mini_{version}_{arch}.deb'
            subprocess.run(['dpkg-deb','--build','--root-owner-group',str(debroot),str(deb)],check=True)
            results.append({'file':str(deb),'bytes':deb.stat().st_size,'sha256':sha(deb)})
        print(json.dumps(results,indent=2))

if __name__=='__main__':main()
