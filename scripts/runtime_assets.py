"""The only bundled runtime dependency is the portable esbuild compiler."""
from pathlib import Path
import json
import subprocess
from functools import lru_cache
EXPECTED={'esbuild-wasm':'0.28.2'}
@lru_cache(maxsize=None)
def prepare_dependencies(root):
    subprocess.run(['node',str(Path(root)/'scripts/prepare-dependencies.mjs')],cwd=root,check=True)
def workspace_directory(root):
    """Use the same .env / saved setting / APP_WORKSPACE precedence as the server."""
    prepare_dependencies(str(Path(root).resolve()))
    value=subprocess.check_output(['node','--input-type=module','-e',
        "import config from './src/config.js'; process.stdout.write(JSON.stringify(config.paths.workspace))"],
        cwd=root,text=True)
    folder=Path(json.loads(value))
    if not folder.is_dir():raise RuntimeError('Configured workspace directory not found: '+str(folder))
    subprocess.run(['node','scripts/compile-workspace.mjs',str(folder)],cwd=root,check=True,stdout=subprocess.DEVNULL)
    return folder

def compiler_files(root):
    root=Path(root)
    prepare_dependencies(str(root.resolve()))
    app=json.loads((root/'package.json').read_text(encoding='utf-8'))
    if app.get('dependencies')!=EXPECTED or app.get('optionalDependencies'):
        raise RuntimeError('Unexpected runtime dependency; update the audited packager')
    base=root/'node_modules/esbuild-wasm'
    package=json.loads((base/'package.json').read_text(encoding='utf-8'))
    if package['version']!=EXPECTED['esbuild-wasm']:
        raise RuntimeError('Run npm ci for the pinned compiler')
    files=[base/p for p in ['package.json','LICENSE.md','lib/browser.js','esbuild.wasm']]
    for file in files:
        if not file.is_file() or file.is_symlink():
            raise RuntimeError('Missing or linked compiler file: '+str(file))
    if (base/'esbuild.wasm').read_bytes()[:4]!=b'\0asm':
        raise RuntimeError('Invalid WebAssembly compiler')
    return files
