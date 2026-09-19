#!/usr/bin/env python3
"""Build a source starter, excluding installed dependencies and private data."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {'node_modules', 'data', 'log', 'logs', 'dist', 'runtime-cache', '.aidot-cache', '__pycache__', '.git', '.cache', 'uploads', 'enterprise', 'certs'}
POLICY = ROOT / 'scripts/starter-files.json'

def starter_readme(version):
    return f'''# aidot-mini {version} — AI API Starter

AI가 작성한 Controller · Service · named SQL을 실제로 컴파일하고 HTTP로 실행·검증하는 최소 소스 패키지입니다. Full과 동일한 서버 런타임과 인증·업로드·DB 계약을 사용합니다. Node.js 22.19 이상과 `esbuild-wasm` 한 개의 직접 의존성이 필요합니다.

## 바로 실행

```sh
npm ci --ignore-scripts
npm start
```

기본 Note API: `GET http://127.0.0.1:8901/api/notes`. 기본 DB·실행 상태는 `data/`에 생성됩니다. 이 패키지는 API 실행용이므로 브라우저 콘솔과 Vue 클라이언트가 없으며 `/`는 404를 반환합니다.

## AI가 새 API를 작성할 때

1. [API 작성 규칙](docs/AI_API_RULES.md)을 읽고 요청 경로·입력·테이블·권한·오류 응답을 정의합니다.
2. 기본 `workspace/controller`, `workspace/service`, `workspace/sql`에 업무 코드를 작성합니다. 새 스키마는 `workspace/migrations`에 추가합니다. 실행된 migration을 수정하지 않습니다.
3. `npm run check`와 `npm run contract:check`로 문법·declaration 계약을 확인합니다. `npm run workspace:verify -- --workspace ./my-workspace --cases ./my-cases.json`으로 생성한 API의 실제 HTTP 동작도 검증합니다.
4. Express에 복사할 때는 [이식 규칙](docs/PORTING.md)에 따라 Controller·Service·SQL의 `@aidot/...` import를 그대로 유지합니다. 대상 DB와 계정·환경 설정은 별도로 준비합니다.

별도 업무 폴더는 `npm run workspace:init -- ./my-workspace --empty`로 만듭니다. `.env`에 `APP_WORKSPACE=./my-workspace`와 별도 `DATA_DIR=./data/my-api`를 설정한 뒤 실행합니다. 기존 `DB_MIGRATIONS_DIR` 설정이 있으면 새 업무의 migrations 경로와 일치시킵니다. `npm run workspace:compile`은 선택한 업무 코드를 컴파일하고 metadata를 생성합니다.

## 포함된 실제 API 예제

- 기본 Note: `npm start`. 인증이 필요한 Note 예제는 `examples/note-auth-workspace`에 있습니다.
- Product 페이지·이미지 업로드: `npm run start:product`. 조회는 공개, 쓰기와 업로드는 관리자 권한이 필요합니다. 계정 생성은 `npm run product:account`, API용 키 확인은 동일한 `DATA_DIR` 설정의 `npm run admin:token`을 사용합니다.
- Product 계약과 JSON 응답 규칙: [Product API RULES](docs/AI_API_RULES_PRODUCT.md).

## 검증 명령

```sh
npm run verify
npm run product:contract
npm run workspace:verify -- --workspace examples/product-workspace --migrations examples/product-database --cases docs/AI_WORKSPACE_CASES.json
```

`verify`는 소스 문법·metadata 계약과 포함된 Note/Product HTTP 예제를 확인합니다. `api:verify`는 Note, `product:verify`는 Product용입니다. `workspace:verify`는 지정한 workspace의 임시 복사본과 별도 DB에서 서버를 시작하고 HTTP case를 실행합니다. `--cases`를 생략하면 서버 기동·health·metadata만 확인하며 업무 동작 검증 완료로 표시하지 않습니다. [Product case 예제](docs/AI_WORKSPACE_CASES.json)를 기준으로 새 업무에 맞는 case를 작성하고 실제로 실행한 범위만 보고합니다.

`workspace:verify`는 동일한 컴파일러로 별도 프로세스에서 먼저 컴파일하고 그 프로세스를 종료한 뒤, 같은 캐시를 사용하는 원본 API 서버를 시작합니다. 컴파일 중 일시적으로 필요한 메모리는 여전히 존재하며 실행 환경별 고정 RSS를 보장하지 않습니다.

`EXPRESS_PROJECT_ROOT`에 별도로 설치한 Express 1.45.8 Full 경로를 지정하면 `product:contract`로 동일한 업무 파일을 교차 검증할 수 있습니다. Express 서버나 DB 드라이버는 이 ZIP에 포함하지 않습니다. [Starter 범위와 검증 보고 기준](docs/AI_STARTER.md)을 참고하세요.

## 배포 범위와 크기

API 런타임·컴파일러 설정·작은 업무 예제·작성 규칙만 포함합니다. Node 실행 파일과 npm 설치 결과도 ZIP에 포함하지 않습니다. Full의 브라우저 UI·Vue·ROS/Android·통신 어댑터·게시 도구·과거 검증 자료는 제외합니다. 소스 ZIP을 줄인 것이며 Node와 컴파일러의 실행 메모리를 별도로 축소했다고 주장하지 않습니다.

`npm run build:starter`로 이 최소 패키지를 다시 만들 수 있습니다. 빌더는 `scripts/starter-files.json`에 검토된 정확한 경로만 포함하므로 새 업무 파일을 배포하려면 목록을 검토하여 추가하거나 `npm run port:export`를 사용합니다. 계정·DB·업로드·캐시는 배포 파일에 넣지 않습니다.

[현재 Starter 안내](docs/AI_STARTER.md) · [Apache License 2.0](LICENSE) · [저작권](COPYRIGHT.md) · [NOTICE](NOTICE) · [타사 고지](docs/THIRD_PARTY_NOTICES.md)
'''

def starter_agents():
    return '''# aidot-mini AI API Starter

Read `docs/AI_API_RULES.md`; for Product also read `docs/AI_API_RULES_PRODUCT.md`.

- This is a minimal API execution package. Write business code in Controller, Service and named SQL files; use the existing runtime, DB adapter and framework aliases.
- Preserve method-level authentication, role checks, validation and response envelopes. Do not rebuild shared runtime components to implement ordinary business APIs.
- Let the loader generate metadata. Add migrations without changing already applied migration files or existing user data.
- Default `npm start` selects Note; Product is explicit via `npm run start:product`. Use `.env` to select a separate generated workspace and its data/migrations.
- Run check and contract:check, then workspace:verify with HTTP cases for the actual generated API. Without cases, workspace:verify checks startup only. Built-in api:verify and product:verify cover only their named examples.
- No browser console or frontend is included. Use an HTTP client. Full and standalone frontend distributions provide those assets separately.
- Keep credentials, local .env, databases, uploads, node_modules and runtime caches outside source archives. Report the host, OS, Node, database and tests actually executed.
'''

def checked_source(name):
    # No recursive discovery: new local files stay outside the archive until reviewed.
    if not isinstance(name, str) or not name or re.search(r'[\\\x00-\x1f:]', name):
        raise SystemExit('Unsafe starter path: ' + str(name))
    parts = name.split('/')
    if any(part in {'', '.', '..'} for part in parts) or set(parts) & FORBIDDEN:
        raise SystemExit('Private or unsafe starter path: ' + name)
    p = ROOT
    for part in parts:
        p /= part
        if p.is_symlink():
            raise SystemExit('Linked starter source: ' + name)
    private_env = p.name.startswith('.env') and p.name != '.env.example'
    if private_env or re.search(r'\.(db(?:-wal|-shm)?|sqlite|key|pem|pyc|keystore|p12|apk|zip)$', name, re.I):
        raise SystemExit('Private/non-source starter file: ' + name)
    if not p.is_file() or p.stat().st_nlink != 1:
        raise SystemExit('Required unlinked starter file missing: ' + name)
    return p

def main():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / f'dist/aidot-mini-v{version}-starter.zip')
    args = parser.parse_args()
    policy = json.loads(POLICY.read_text(encoding='utf-8'))
    if policy.get('policyVersion') != 1 or len(set(policy['files'])) != len(policy['files']):
        raise SystemExit('Invalid/duplicate starter file policy')
    selected = [checked_source(name) for name in policy['files']]
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    package['description'] = 'Minimal AI API execution Starter for portable Controller, Service and named SQL'
    package['aidotEdition'] = 'public'
    package['aidotDistribution'] = 'starter'
    package['repository'] = {'type': 'git', 'url': 'https://github.com/mike-jung/aidot-mini.git'}
    package['scripts'] = {key: value for key, value in package['scripts'].items() if key in policy['scripts']}
    package['scripts']['test'] = 'node scripts/smoke-note.mjs && node scripts/verify-product.mjs'
    package['scripts']['verify'] = 'npm run check && npm run contract:check && npm test'
    entries = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in selected}
    entries['package.json'] = (json.dumps(package, indent=2) + '\n').encode()
    entries['README.md'] = starter_readme(version).encode('utf-8')
    entries['AGENTS.md'] = starter_agents().encode('utf-8')
    manifest = {
        'format': 'aidot-mini-starter/v3', 'version': version,
        'edition': 'public', 'distribution': 'starter',
        'purpose': 'minimal AI-generated API execution and verification',
        'nodeRuntimeIncluded': False, 'apiRuntimeIncluded': True,
        'browserConsoleIncluded': False, 'vueClientIncluded': False,
        'install': 'npm ci --ignore-scripts',
        'start': 'npm start',
        'reference': {'repository': 'mike-jung/aidot-express', 'version': '1.45.8', 'source': 'user-supplied final full archive'},
        'files': {name: hashlib.sha256(data).hexdigest() for name, data in entries.items()},
    }
    entries['starter-manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr('aidot-mini/' + name, data)
    print(json.dumps({'file': str(args.output), 'files': len(entries), 'bytes': args.output.stat().st_size,
                      'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))

if __name__ == '__main__':
    main()
