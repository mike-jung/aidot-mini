#!/usr/bin/env python3
"""Build the reusable API starter without SDKs, runtimes or historical fixtures."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = [
    'check.mjs', 'check-contract.mjs', 'smoke-note.mjs', 'init-workspace.mjs',
    'watch-workspace.mjs', 'compile-workspace.mjs', 'migrate-workspace.mjs',
    'admin-account.mjs', 'admin-token.mjs', 'dev-cert.mjs', 'export-module.mjs',
    'build-starter.py', 'verify-api-example.mjs',
]
DOCS = [
    'AI_API_RULES.md', 'AI_WORKFLOW.md', 'PORTING.md', 'NOTE_COMPATIBILITY_KO.md',
    'DEPLOY_LINUX.md', 'DEPLOY_ROS.md', 'ROS_SDK_BUILD_KO.md',
    'VALIDATION_NOTE_ROUNDTRIP.md', 'VALIDATION_V051.md', 'WORKSPACE_METADATA_KO.md', 'CONSOLE_LOGIN_KO.md', 'HTTPS_CONSOLE_KO.md',
    'CONSOLE_FILES_LOGS_KO.md', 'CONSOLE_V060_EN.md', 'LICENSING.md', 'THIRD_PARTY_NOTICES.md', 'note-table.json', 'note-sqlite.sql', 'note-mariadb.sql',
]

def main():
    version = json.loads((ROOT/'package.json').read_text())['version']
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/f'dist/aidot-mini-{version}-starter.zip')
    args = parser.parse_args()
    package = json.loads((ROOT/'package.json').read_text())
    package['aidotEdition'] = 'public'
    package['description'] = 'Reusable aidot-express-compatible API starter with Note CRUD'
    package['scripts'] = {
        key: value for key, value in package['scripts'].items()
        if key in ['start', 'dev', 'check', 'workspace:init', 'workspace:compile',
                   'admin:token', 'admin:account', 'https:cert', 'cert:dev',
                   'db:migrate', 'port:export', 'contract:check', 'api:verify', 'build:starter']
    }
    package['scripts']['test'] = 'node scripts/smoke-note.mjs'
    package['scripts']['verify'] = 'npm run check && npm run contract:check && npm test'
    selected = {ROOT/p for p in ['README.md', 'AGENTS.md', 'start.js', 'package-lock.json',
                                '.env.example', '.gitignore', 'module.json', 'REVISION.txt', 'LICENSE', 'NOTICE', 'COPYRIGHT.md', 'SECURITY.md']}
    for folder in ['src', 'public', 'workspace', 'examples/note-auth-workspace', 'docs/third-party']:
        selected.update(p for p in (ROOT/folder).rglob('*') if p.is_file())
    selected.update(ROOT/'scripts'/name for name in SCRIPTS)
    selected.update(ROOT/'docs'/name for name in DOCS + [f'aidot-mini-tutorial-v{version}.pptx', f'aidot-mini-tutorial-v{version}_ko.pptx'] if (ROOT/'docs'/name).is_file())
    selected.update((ROOT/'docs').glob('aidot-mini-tutorial-v*.pptx'))
    selected.update(ROOT/name for name in ['tests/helpers/note-api.mjs', 'docs/tutorial/client.mjs'])
    entries = {'package.json': (json.dumps(package, indent=2)+'\n').encode()}
    for p in sorted(selected):
        if not p.exists():
            raise SystemExit('Required starter file missing: '+str(p))
        relative = p.relative_to(ROOT)
        if any(part in ['data', 'log', 'node_modules', '__pycache__'] for part in relative.parts):
            continue
        if p.is_symlink() or p.suffix in ['.db', '.key', '.pem', '.pyc']:
            raise SystemExit('Unexpected private/non-source starter file: '+str(p))
        entries[relative.as_posix()] = p.read_bytes()
    readme = entries['README.md'].decode('utf-8')
    readme = re.sub(r'\n<!-- FULL_PUBLISH_START -->[\s\S]*?<!-- FULL_PUBLISH_END -->\n?', '\n', readme)
    readme = readme.replace(f'# aidot-mini {version}', f'# aidot-mini {version} API Starter', 1)
    readme = readme.replace('npm run build:linux -- --arch x64 --download --deb\n', '')
    readme = readme.replace('npm run build:ros -- --family all\n', '')
    readme += ('\nThis Starter includes the API runtime, console, Note examples and AI rules. '
               'Linux/ROS/Android SDK build tools and publishing tools are available in the '
               'Full or Public source distribution; the deployment guides describe that distribution.\n')
    entries['README.md'] = readme.encode('utf-8')
    manifest = {'format': 'aidot-mini-starter/v1', 'version': package['version'],
                'runtimeIncluded': False, 'install': 'npm ci --ignore-scripts',
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in entries.items()}}
    entries['starter-manifest.json'] = (json.dumps(manifest, indent=2)+'\n').encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr('aidot-mini/'+name, data)
    print(json.dumps({'file': str(args.output), 'files': len(entries),
                      'bytes': args.output.stat().st_size,
                      'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))

if __name__ == '__main__':
    main()
