#!/usr/bin/env python3
"""Deterministic server assets; no secrets, data, npm cache or native binaries."""
import pathlib,zipfile,hashlib,json,sys
root=pathlib.Path(__file__).resolve().parents[2]
from runtime_licenses import validate_licenses
validate_licenses(root/'android')
assets=root/'android/app/src/main/assets';assets.mkdir(parents=True,exist_ok=True)
pkg=json.loads((root/'package.json').read_text())
sys.path.insert(0,str(root/'scripts'))
from runtime_assets import compiler_files, workspace_directory
def safe_source(p, base):
 relative=p.relative_to(base)
 if p.is_symlink():raise SystemExit('Symlinks are not allowed in server assets: '+str(relative))
 if any(part in {'node_modules','.git','data','log','logs','uploads','dist','runtime-cache','__pycache__'} for part in relative.parts):return False
 if p.name.startswith('.env') or p.suffix.lower() in {'.db','.sqlite','.sqlite3','.pem','.key','.p12','.pfx','.jks','.keystore'}:
  raise SystemExit('Private state or credentials are not allowed in server assets: '+str(relative))
 if any(part.startswith('.') and part != '.aidot-cache' for part in relative.parts):return False
 return p.is_file() and p.suffix not in {'.so','.node','.pyc'}
files=[root/name for name in ['start.js','package.json','LICENSE','NOTICE','COPYRIGHT.md']]+compiler_files(root)
for folder in ['src','public','modules/robot-client']:
 files.extend(p for p in (root/folder).rglob('*') if safe_source(p,root/folder))
entries=[(p,p.relative_to(root).as_posix()) for p in files]
workspace=workspace_directory(root)
entries.extend((p,'workspace/'+p.relative_to(workspace).as_posix()) for p in workspace.rglob('*') if safe_source(p,workspace))
if sum(p.stat().st_size for p,_ in entries)>16*1024*1024:raise SystemExit('Server assets exceed the Android extraction limit')
with zipfile.ZipFile(assets/'server.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p,name in sorted(entries,key=lambda pair:pair[1]):
  if p.is_symlink():raise SystemExit('Symlinks are not allowed in server assets')
  info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  content=p.read_bytes()
  if name == 'package.json':
   runtime_pkg={key:value for key,value in pkg.items() if key in {'name','version','description','type','engines','main','dependencies','license','author'}}
   runtime_pkg.update({'private':True,'aidotEdition':'public','aidotDistribution':'android','scripts':{'start':'node start.js'}})
   content=(json.dumps(runtime_pkg,indent=2)+'\n').encode('utf-8')
  z.writestr(info,content)
digest=hashlib.sha256((assets/'server.zip').read_bytes()).hexdigest();(assets/'server.sha256').write_text(digest+'\n')
print(json.dumps({'files':len(entries),'bytes':(assets/'server.zip').stat().st_size,'sha256':digest}))

# Keep bundled runtime notices accessible inside every APK.
import shutil
licenses=root/'android/runtime-licenses'
if licenses.is_dir():
    target=root/'android/app/src/main/assets/licenses'
    if target.exists():shutil.rmtree(target)
    shutil.copytree(licenses,target)
target=assets/'licenses';target.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'docs/third-party/aidot-express-LICENSE',target/'aidot-express-LICENSE')
shutil.copy2(root/'docs/THIRD_PARTY_NOTICES.md',target/'THIRD_PARTY_NOTICES.md')

for notice in ['LICENSE','NOTICE','COPYRIGHT.md']:
    shutil.copy2(root/notice,target/('aidot-mini-'+notice))

shutil.copy2(root/'docs/third-party/aidot-express-NOTICE',target/'aidot-express-NOTICE')

validate_licenses(root/'android', bundled=True)
