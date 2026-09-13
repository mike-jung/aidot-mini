#!/usr/bin/env python3
"""Reproduce the pinned Termux runtime without installing Termux or executing packages."""
import argparse, hashlib, io, json, pathlib, re, tarfile, urllib.request, zipfile, sys
from elf_runtime import inspect

root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--abi', choices=['x86_64', 'arm64-v8a'], default='x86_64')
p.add_argument('--cache', type=pathlib.Path)
p.add_argument('--from-apk', type=pathlib.Path, help='Restore the exact reviewed runtime from a provided APK, offline')
p.add_argument('--download', action='store_true', help='Download missing pinned packages from the official repository')
args = p.parse_args(); arch = 'aarch64' if args.abi == 'arm64-v8a' else args.abi
if args.from_apk:
    manifest = json.loads((root/'runtime-manifest.json').read_text())
    expected = manifest.get('abis', {}).get(args.abi)
    if not expected: raise SystemExit('No reviewed runtime for this ABI')
    restored = {}
    with zipfile.ZipFile(args.from_apk) as archive:
        for name, checksum in expected.items():
            member = archive.getinfo('lib/'+args.abi+'/'+name)
            if member.file_size > 100*1024*1024: raise SystemExit('Unexpected native file size')
            data = archive.read(member)
            if hashlib.sha256(data).hexdigest() != checksum: raise SystemExit('APK runtime checksum mismatch: '+name)
            restored[name] = data
    output = root/'app/src/main/jniLibs'/args.abi; output.mkdir(parents=True, exist_ok=True)
    for name, data in restored.items():
        target = output/name; target.write_bytes(data); target.chmod(0o755)
    print(json.dumps({'abi': args.abi, 'nativeFiles': len(restored), 'source': 'reviewed APK', 'offline': True}))
    sys.exit(0)
if args.cache is None: p.error('--cache is required when not using --from-apk')
packages = [v for v in json.loads((root/'runtime-packages.json').read_text()) if v['Architecture'] == arch]
if not packages: raise SystemExit('No reviewed package lock for this ABI; provide a pinned package inventory first')
args.cache.mkdir(parents=True, exist_ok=True)
cache = {hashlib.sha256(f.read_bytes()).hexdigest(): f for f in args.cache.glob('*.deb')}
files = {}; aliases = {}
for package in packages:
    digest = package['SHA256']; source = cache.get(digest)
    if source is None:
        if not args.download: raise SystemExit('Missing pinned package: '+package['Filename'])
        source = args.cache/pathlib.PurePosixPath(package['Filename']).name
        url = 'https://packages.termux.dev/apt/termux-main/'+package['Filename']
        with urllib.request.urlopen(url, timeout=60) as response: data = response.read()
        if hashlib.sha256(data).hexdigest() != digest: raise SystemExit('Package checksum mismatch: '+package['Package'])
        source.write_bytes(data)
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest: raise SystemExit('Package checksum mismatch')
    if data[:8] != b'!<arch>\n': raise SystemExit('Invalid Debian archive')
    pos = 8; payload = None
    while pos + 60 <= len(data):
        header = data[pos:pos+60]; name = header[:16].decode().strip().rstrip('/'); size = int(header[48:58]); pos += 60
        if name.startswith('data.tar'): payload = data[pos:pos+size]
        pos += size + size % 2
    if payload is None: raise SystemExit('Missing package data')
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:*') as archive:
        for member in archive:
            name = member.name.removeprefix('./')
            prefix = 'data/data/com.termux/files/usr/'
            if not name.startswith(prefix): continue
            relative = name[len(prefix):]
            if member.issym() and relative.startswith('lib/'):
                aliases[pathlib.PurePosixPath(relative).name] = pathlib.PurePosixPath(member.linkname).name
            if not member.isfile(): continue
            if relative == 'bin/node' or re.fullmatch(r'lib/lib[^/]+\.so(?:\.[0-9]+)*', relative):
                content = archive.extractfile(member).read()
                if content.startswith(b'\x7fELF'): files[pathlib.PurePosixPath(relative).name] = content
if 'node' not in files: raise SystemExit('Node executable missing')
# Include the dependency closure only. Bionic platform libraries remain supplied by Android.
platform = {'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so'}
selected, queue = {}, ['node']
while queue:
    name = queue.pop()
    if name in selected or name in platform: continue
    resolved = name; visited = set()
    while resolved in aliases and resolved not in visited:
        visited.add(resolved); resolved = aliases[resolved]
    if resolved not in files: raise SystemExit('Missing dependency: '+name)
    content = files[resolved]; info = inspect(content); selected[name] = content; queue.extend(info['needed'])
expected = 183 if args.abi == 'arm64-v8a' else 62
output = root/'app/src/main/jniLibs'/args.abi; output.mkdir(parents=True, exist_ok=True)
manifest_file = root/'runtime-manifest.json'; manifest = json.loads(manifest_file.read_text())
checksums = {}
for name, content in sorted(selected.items()):
    info = inspect(content)
    if info['machine'] != expected: raise SystemExit('Wrong ABI: '+name)
    for off, addr, size, align in info['loads']:
        if align < 16384 or off % 16384 != addr % 16384: raise SystemExit('16 KB alignment required: '+name)
    for old in set(info['needed']+info['soname']):
        new = re.sub(r'(\.so)(?:\.[0-9]+)+$', r'\1', old)
        if old != new: content = content.replace(old.encode()+b'\0', new.encode()+b'\0'*(len(old)-len(new)+1))
    for old in info['runpath']:
        if old: content = content.replace(old.encode()+b'\0', b'\0'*(len(old)+1))
    dest = 'libnode_exec.so' if name == 'node' else re.sub(r'(\.so)(?:\.[0-9]+)+$', r'\1', name)
    digest = hashlib.sha256(content).hexdigest(); locked = manifest.get('abis', {}).get(args.abi, {}).get(dest)
    if locked and locked != digest: raise SystemExit('Reproduced runtime differs from reviewed manifest: '+dest)
    target = output/dest; target.write_bytes(content); target.chmod(0o755); checksums[dest] = digest
extra = {f.name for f in output.glob('*.so')} - set(checksums)
if extra: raise SystemExit('Unexpected pre-existing libraries: '+str(sorted(extra)))
manifest.setdefault('abis', {})[args.abi] = checksums
manifest_file.write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps({'abi': args.abi, 'packages': len(packages), 'nativeFiles': len(checksums), 'deviceExecution': 'separate test required'}))
