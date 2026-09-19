# aidot-mini 1.0.9 Windows 설치·설정·삭제

Windows 배포물은 **Node 런타임을 포함한 사용자별 설치 프로그램과 ZIP**으로 제공합니다. 대상 PC에 Node·npm·Python을 먼저 설치하지 않아도 API를 실행할 수 있습니다. `minimal`은 업무 API용이며, `full`은 관리 콘솔과 로봇 화면을 추가합니다. Vue Product 클라이언트는 Full 소스에서 별도로 개발·빌드합니다. 비공개 Full 소스·게시 설정을 포함한다는 뜻은 아닙니다.

## 설치 방식의 선택

이번 설치 프로그램은 **NSIS Unicode + Modern UI 2**를 사용합니다. 초기 설정 및 삭제 옵션 대화상자를 제공하고, Windows와 Linux 빌드 환경에서 같은 설치 소스로 `.exe`를 만들 수 있기 때문입니다. [NSIS 빌드 문서](https://nsis.sourceforge.io/Docs/AppendixG.html), [사용자 지정 페이지](https://nsis.sourceforge.io/Docs/nsDialogs/Readme.html), [라이선스](https://nsis.sourceforge.io/Docs/AppendixI.html)를 참고했습니다.

Inno Setup도 적합한 대안이지만, 이번 구성은 Linux 빌드 환경에서도 실제 Windows 설치 파일을 생성하는 경로를 통일하기 위해 NSIS를 선택했습니다. MSI의 시스템 전체 설치·관리 정책이 필요한 조직은 해당 배포 정책을 별도로 구성해야 합니다.

내장 Node와 ESM/컴파일러 파일을 그대로 배포하므로 업무 workspace의 동적 로딩을 유지합니다. Node SEA는 이번에 사용하지 않습니다. 검토한 [Node 24 SEA 문서](https://nodejs.org/download/release/v24.9.0/docs/api/single-executable-applications.html)는 개발 중 기능과 단일 CommonJS 진입점·모듈 로딩 차이를 명시합니다. 서버 실행을 위해 별도의 Electron 브라우저 런타임을 추가하지 않습니다.

## Windows 배포물 빌드

소스 루트에서 `npm ci --ignore-scripts` 후 `npm run dist:win` 또는 `npm run dist:win:full`을 실행합니다. Node·Python 3·NSIS는 빌드 PC에만 필요합니다. 일반 사용자는 만들어진 ZIP/설치 프로그램을 사용합니다.

NSIS가 PATH에 없으면 PowerShell에서 실제 컴파일러 경로를 지정합니다.

```powershell
npm run dist:win -- --makensis "C:\Program Files (x86)\NSIS\makensis.exe"
npm run dist:win:full -- --makensis "C:\Program Files (x86)\NSIS\makensis.exe"
```

결과는 기본 `dist/release/`에 생성합니다. `--no-installer`는 ZIP만 만들며 설치 프로그램까지 빌드한 것으로 보고하지 않습니다. Windows 패키지 빌더는 PATH에서 `python` 또는 `python3`를 찾으므로 Python 3 실행 파일이 PATH에서 실행되는지 확인합니다.

## 신규 설치

1. 사용할 `minimal` 또는 `full` Windows x64 설치 프로그램을 실행합니다.
2. 현재 사용자용 설치 위치를 확인합니다. 기본값은 `%LOCALAPPDATA%\Programs\aidot-mini`입니다.
3. 초기 설정 화면에서 포트, SQLite DB 파일명, Note/Product 프로필을 선택합니다.
4. 설치 후 시작 메뉴의 실행 항목 또는 설치 폴더의 `aidot-mini.cmd`로 실행합니다. 종료는 `stop.cmd`를 사용합니다.

관리자 권한, 자동 시작 등록, 방화벽 예외를 기본으로 요구하거나 추가하지 않습니다. 사용자가 실행하기 전에 서버를 자동 기동하지 않습니다. PC에 Node가 이미 설치되어 있어도 배포물에 포함된 Node를 사용합니다.

| 초기 설정 | 의미 |
|---|---|
| 포트 | 1~65535의 정수. 기본 8901. 다른 프로그램이 사용 중이면 사용 가능한 포트를 선택 |
| SQLite DB 파일명 | 관리되는 데이터 경로 안에 생성할 DB 파일. 외부 DB 서버 주소가 아님 |
| Note/Product | 사용할 작은 업무 예제. 실제 배포 업무로 교체 가능 |
| 접속 주소 | 최초에는 `127.0.0.1`. 외부 네트워크 공개는 별도 TLS 설정 후 수행 |

mini는 SQLite 런타임입니다. 이 화면에서 MySQL·MariaDB·PostgreSQL 연결을 설정한 것처럼 표시하지 않습니다. aidot-express로 이식할 때는 해당 호스트의 DB adapter·DDL·접속 설정을 따릅니다.

## 파일 위치와 read/write

| 위치 | 용도 | 일반 삭제 시 |
|---|---|---|
| `%LOCALAPPDATA%\Programs\aidot-mini` | 프로그램·Node·런처·삭제 프로그램 | 설치 manifest의 프로그램 파일 삭제 |
| `%LOCALAPPDATA%\aidot-mini` | 설정·DB·계정·workspace·업로드·로그·컴파일 캐시 | 기본 보존, 전체 삭제 선택 시 제거 |
| 현재 사용자의 시작 메뉴 | 실행·설정·삭제 등 바로가기 | 설치한 항목 삭제 |
| 사용자가 수동 지정한 외부 경로 | 외부 workspace·DB·TLS 인증서 등 | 자동 삭제하지 않음 |

AppData 위치는 현재 Windows 사용자의 환경에서 구합니다. `C:\Users\이름` 같은 경로를 하드코딩하지 않습니다. 한글·공백이 있는 경로에서도 인수를 인용하여 전달합니다. 다른 폴더에서 실행하거나 바로가기를 사용해도 동일한 설정·DB를 인식하도록 런처가 경로를 정합니다.

프로그램 폴더와 사용자 상태를 분리하여 업그레이드 시 DB와 업무 코드를 보호합니다. 설치 폴더를 workspace로 사용하거나 그 안에 변경 데이터를 추가하지 마세요. ZIP도 같은 런처의 사용자 상태 규칙을 따르며, ZIP을 풀어 놓은 폴더가 자동으로 데이터 폴더가 되지는 않습니다.

같은 사용자 아래의 설치형과 ZIP은 기본 상태 위치를 공유할 수 있습니다. 동시에 실행하지 마세요. 별도 개발·검증 인스턴스는 독립 상태 디렉터리와 포트를 명시합니다.

## 재설치·설정 변경

기존 설정과 사용자 DB·계정·workspace는 재설치 시 보존합니다. 설치 프로그램의 기본값이 기존 DB나 업무 파일을 덮어쓰지 않도록 합니다. 실제 설정 변경은 서버를 정지한 후 `configure.cmd`에 변경 인수를 전달합니다. 지정하지 않은 값은 보존합니다. 프로필을 바꾸는 경우 DB 파일명을 함께 명시해야 합니다. 새 업무의 DB migration은 기존 실행 파일을 고치지 말고 새 migration으로 추가합니다.

최소 배포물은 콘솔 파일을 포함하지 않습니다. Full에서 최소 배포물로 전환하면서 사용자 데이터를 보존하면 기존 `public`의 콘솔도 계속 제공됩니다. 최소 배포물에서 Full로 전환하면 없는 화면 파일만 추가하며 기존 업로드와 수정한 화면 파일은 덮어쓰지 않습니다. 데이터를 초기화하려면 삭제 과정에서 전체 데이터 삭제를 명시적으로 선택합니다.

화면 없는 최소 배포물에서도 관리자 인증 API는 동일합니다. 관리자 계정 설정과 업무 API 검증은 동봉 런처의 명령을 사용합니다. Full 화면을 사용하는 경우 로컬 콘솔에서 최초 관리자 계정을 설정할 수 있습니다. 비밀번호를 설치 명령 인수나 공개 설치 로그에 넣지 않습니다.


설치 폴더에서 실행하는 PowerShell 예입니다. `.cmd`는 내장 Node와 설치된 런처를 호출합니다.

```powershell
.\aidot-mini.cmd status
.\stop.cmd
.\configure.cmd --port 8902 --profile product --database product.db
.\aidot-mini.cmd account
.\aidot-mini.cmd start
```

계정 입력은 비공개 표준 입력을 사용한 자동화도 지원합니다. 비밀번호를 명령 인수에 넣지 않습니다. `token` 명령의 결과도 자격 증명이므로 공개 로그에 붙여넣지 않습니다.

```powershell
.\aidot-mini.cmd config
.\aidot-mini.cmd configure --host 0.0.0.0 --tls-cert C:\certs\server.crt --tls-key C:\certs\server.key
```

명령에는 `--data-dir <절대경로>`로 별도 상태 루트를 지정할 수 있습니다. 선택 우선순위는 명시적 인수, `AIDOT_MINI_HOME`, 운영체제 기본값입니다. 여러 인스턴스는 포트와 상태 경로를 모두 분리하며, 해당 경로가 앱 소유 경로인지 확인되지 않으면 삭제하지 않습니다.

관리되는 상태의 하위 경로는 다음과 같습니다.

| 경로 | 내용 |
|---|---|
| `config/installation.json`, `config/settings.json` | 배포 설정·런타임 설정 |
| `db/` | 설정한 SQLite DB |
| `workspaces/note`, `workspaces/product` | 편집 가능한 업무 코드·SQL·migration |
| `public/uploads/` | 업로드 파일 |
| `logs/`, `cache/` | 실행 로그·컴파일 캐시 |
| `accounts/` | 관리자 계정·토큰 |
| `tls/` | 가져온 TLS 인증서·개인키 |
| `state/supervisor.json` | 실행 프로세스 관리 상태 |

## 외부 접속과 TLS

기본 로컬 HTTP는 장치 내부 호출과 최초 설정용입니다. 로봇 관제·다른 PC·모바일 단말에서 접속하려면 서버를 정지하고 다음을 함께 준비합니다.

- 접속할 주소/이름을 포함하는 신뢰 가능한 TLS 인증서와 개인키
- 선택한 host·포트·인증/권한 정책, 필요한 허용 host
- Windows 및 네트워크의 방화벽 정책

인증서 설정 없이 host만 `0.0.0.0`으로 바꾸는 설정은 거절합니다. 런처의 TLS 설정 명령은 인증서와 개인키를 관리되는 상태 폴더에 복사합니다. 복사 전 외부 원본은 전체 삭제 옵션으로도 임의 삭제하지 않습니다.

## 삭제 및 전체 정리

Windows의 앱 제거 또는 설치 폴더의 삭제 프로그램을 실행합니다. 삭제 대화상자의 **사용자 데이터도 모두 제거** 옵션은 기본으로 선택되지 않습니다.

| 선택 | 삭제 결과 |
|---|---|
| 기본: 프로그램만 제거 | 프로그램과 등록 항목·바로가기를 제거. DB·계정·설정·workspace·업로드는 유지 |
| 사용자 데이터도 제거 | 프로그램 제거와 함께 이 설치가 관리하는 상태 루트의 데이터를 삭제 |

전체 삭제 대상에는 상태 루트 안의 사용자가 수정한 업무 코드와 업로드도 포함됩니다. 필요한 데이터는 먼저 백업합니다. 임의 경로 전체를 지우거나 PC에서 `aidot` 이름이 들어간 폴더를 검색하여 삭제하지 않습니다. 설치한 파일 목록과 확인된 애플리케이션 소유 상태 경로를 사용하며, 외부 파일·다른 사용자 데이터는 삭제하지 않습니다.

실행 중인 서버는 먼저 종료합니다. 삭제 프로그램은 앱의 종료 절차와 상태 확인을 사용해야 하며, PC의 모든 `node.exe`를 일괄 종료하는 방식은 사용하지 않습니다. 삭제 실패나 사용 중인 파일을 완료로 숨기지 말고 로그를 확인합니다.

## 무인 설치와 재현 가능한 검증

설치 프로그램은 다음 옵션을 지원합니다. 아래 파일명은 `minimal`의 예입니다. PowerShell에서 `$setup`을 실제 다운로드한 설치 파일 경로로 지정합니다.

```powershell
$setup = '.\aidot-mini-1.0.9-win-x64-minimal-setup.exe'
Start-Process -FilePath $setup -Wait -PassThru -ArgumentList '/S /PORT=8901 /DATABASE=app.db /PROFILE=note'
```

| 인수 | 동작 |
|---|---|
| `/S` | 무인 모드. 대소문자를 그대로 사용 |
| `/PORT=8901` | 최초 포트 |
| `/DATABASE=app.db` | 최초 SQLite 파일명 |
| `/PROFILE=note` 또는 `/PROFILE=product` | 최초 업무 예제 |
| `/STATE_DIR=<절대경로>` | 독립 테스트 등 신규 설치의 상태 경로 지정. 기존 상태의 자동 이동 기능이 아님 |
| `/D=<설치경로>` | 설치 위치 변경. NSIS 규칙에 따라 마지막 인수로 전달 |

재설치는 기존 설정을 보존합니다. 설치 명령만으로 기존 DB 설정을 자동 변경했다고 가정하지 않습니다. 무인 삭제도 기본은 데이터 보존이며, **`/PURGE=1`을 명시한 경우에만 전체 데이터 삭제를 요청**합니다. NSIS 삭제 프로그램이 별도 프로세스로 실행되는 경우 프로세스 종료뿐 아니라 설치 경로·등록 항목의 실제 제거까지 확인합니다.

테스트는 실제 사용자 운영 데이터와 분리한 설치/상태 경로에서 수행합니다. Windows 사용자 계정과 경로 권한을 바꿔 AppData를 검사하며 관리자 계정에서만 통과한 결과로 일반 사용자 설치까지 보장하지 않습니다.

## 릴리스 전 실행 검증 범위

1. Node가 PATH에 없어도 내장 런타임으로 신규 설치·API 기동이 되는지 검사합니다.
2. 초기 설정 화면의 입력·유효성 검사, 무인 설정, 포트 충돌과 잘못된 설정을 확인합니다.
3. 다른 CWD·한글/공백 경로에서 SQLite 쓰기·읽기·재시작 후 보존을 확인합니다.
4. workspace 편집·컴파일 캐시·업로드·로그가 프로그램 폴더 밖의 상태 경로에 생기는지 확인합니다.
5. 재설치/업그레이드로 사용자 DB·설정·업무 코드가 덮어써지지 않는지 확인합니다.
6. 일반 삭제 후 데이터 유지, 재설치 후 복원, 전체 삭제 후 앱 소유 데이터·바로가기·등록 정보 제거를 각각 확인합니다.
7. 삭제 대상 밖에 둔 표식 파일이 보존되는지 확인합니다.

위는 검증 기준입니다. 실제로 완료한 항목·운영체제·제약은 [1.0.9 릴리스 기록](RELEASE_1.0.9_KO.md)에 기록합니다. Linux에서 설치 파일을 컴파일한 것, Wine에서 실행한 것, 실제 Windows에서 설치한 것은 별도로 구분합니다. 서명 여부도 릴리스에서 확인하며, 코드 서명이 없는 파일을 서명된 배포물로 표시하지 않습니다.
