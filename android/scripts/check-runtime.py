#!/usr/bin/env python3
"""Check the exact Android native runtime inventory, ELF ABI and 16 KB alignment."""
import pathlib,hashlib,json,struct,sys
from elf_runtime import inspect
from runtime_licenses import validate_licenses
root=pathlib.Path(__file__).resolve().parents[1];native=root/'app/src/main/jniLibs';mf=root/'runtime-manifest.json'
if not mf.is_file():raise SystemExit('Missing android/runtime-manifest.json. Import and verify an Android Node runtime first.')
manifest=json.loads(mf.read_text());errors=[];seen=[]
try:
 validate_licenses(root);validate_licenses(root,bundled=True)
except (OSError,ValueError,KeyError) as error:errors.append(str(error))
for abi,expected in [('x86_64',62),('arm64-v8a',183)]:
 folder=native/abi
 if not (folder/'libnode_exec.so').is_file():continue
 inventory=manifest.get('abis',{}).get(abi)
 if not inventory:errors.append(f'{abi}: missing manifest');continue
 for p in folder.glob('*.so'):
  seen.append(str(p));data=p.read_bytes()
  if inventory.get(p.name)!=hashlib.sha256(data).hexdigest():errors.append(f'{abi}/{p.name}: checksum mismatch')
  if data[:6]!=b'\x7fELF\x02\x01':errors.append(f'{p.name}: expected ELF64 little endian');continue
  if struct.unpack_from('<H',data,18)[0]!=expected:errors.append(f'{p.name}: incorrect ABI')
  phoff=struct.unpack_from('<Q',data,32)[0];entsize,num=struct.unpack_from('<HH',data,54)
  load=[]
  for i in range(num):
   off=phoff+i*entsize;typ=struct.unpack_from('<I',data,off)[0]
   if typ==1:
    offset,addr=struct.unpack_from('<QQ',data,off+8);align=struct.unpack_from('<Q',data,off+48)[0];load.append(align)
    if align<16384 or offset%16384!=addr%16384:errors.append(f'{p.name}: not 16 KB compatible')
  if not load:errors.append(f'{p.name}: no LOAD segments')
  try:
   elf=inspect(data)
   platform={'libc.so','libm.so','libdl.so','liblog.so','libandroid.so'}
   for name in elf['needed']:
    if name not in platform and not (folder/name).is_file():errors.append(f'{abi}/{p.name}: missing dependency {name}')
   if any(elf['runpath']):errors.append(f'{abi}/{p.name}: unexpected runtime search path')
  except (ValueError,IndexError,struct.error) as e:errors.append(f'{p.name}: invalid ELF {e}')
 if set(inventory)!={p.name for p in folder.glob('*.so')}:errors.append(f'{abi}: incomplete native inventory')
if not seen:errors.append('No supported runtime found')
version=manifest.get('nodeVersion','0.0.0');numbers=tuple(map(int,version.split('.')))
if numbers<(22,13,0):errors.append('Node 22.13+ required for node:sqlite')
assets=root/'app/src/main/assets';zipfile=assets/'server.zip'
if not zipfile.is_file() or not (assets/'server.sha256').is_file():errors.append('Run npm run android:assets first')
elif hashlib.sha256(zipfile.read_bytes()).hexdigest()!=(assets/'server.sha256').read_text().strip():errors.append('Asset checksum mismatch')
for error in errors:print('FAIL',error)
print(json.dumps({'nativeFiles':len(seen),'nodeVersion':version,'errors':len(errors)}))
sys.exit(bool(errors))
