# aidot-mini 콘솔을 HTTPS로 실행하기

프로젝트 폴더에서 아래 명령을 실행한다. 이미 실행 중인 서버가 있으면 중지한 뒤 다시 시작한다.

```bash
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm start
```

기본 포트에서는 **https://localhost:8901** 또는 **https://127.0.0.1:8901**로 접속한다. 기존 관리자 ID/Password로 로그인하면 된다. 포트를 변경했다면 주소의 8901을 해당 포트로 바꾼다.

첫 명령은 기본적으로 30일 유효한 자체 서명 인증서와 개인키를 `certs/server.crt`, `certs/server.key`에 만들고 `.env`에 다음 설정을 적용한다.

```dotenv
HTTPS_ENABLED=true
TLS_CERT_FILE="./certs/server.crt"
TLS_KEY_FILE="./certs/server.key"
```

`.env`가 없으면 새로 만들고, 있으면 다른 설정과 주석을 보존한 채 HTTPS 설정만 변경한다. 변경 전 파일은 `.env.bak-<시각>-<식별자>`로 백업한다. `ENV_FILE` 환경변수가 지정되어 있으면 그 파일에 적용한다. `.env` 설정은 콘솔에서 저장한 설정보다 우선하며, OS/서비스의 환경변수는 `.env`보다 우선한다. 서로 다른 값이 있으면 명령이 충돌하는 변수명을 알려준다.

`--apply`는 설정을 저장한다. 실행 중인 서버의 프로토콜을 즉시 바꾸거나 서비스를 재시작하지 않으므로 `npm start`로 다시 시작해야 한다. HTTPS 활성화 후 같은 포트의 `http://` 주소는 사용하지 않는다.

## 브라우저의 인증서 경고

이 명령은 로컬 시험용 자체 서명 인증서를 만들며 PC나 브라우저의 신뢰 저장소를 자동 변경하지 않는다. 따라서 처음 접속할 때 브라우저에 신뢰 경고가 나타날 수 있다. 경고 없이 운영하려면 접속할 PC/단말이 신뢰하는 공인 또는 사내 CA가 발급한 인증서를 `TLS_CERT_FILE`과 `TLS_KEY_FILE`에 지정한다. 개인키 `server.key`는 클라이언트에 전달하지 않는다.

인증서 생성은 OpenSSL의 SAN 확장 기능을 사용하고, 적용 전 유효기간·호스트 포함 여부·키 일치를 검사한다. [OpenSSL req](https://docs.openssl.org/3.0/man1/openssl-req/), [Node X509Certificate](https://nodejs.org/api/crypto.html#class-x509certificate).

## 재실행·갱신

유효기간과 호스트가 맞는 기존 인증서는 재사용한다. 같은 명령을 다시 실행해도 불필요하게 인증서나 `.env`를 바꾸지 않는다. 만료되었거나 접속 이름/IP를 추가하려면 명시적으로 갱신한다.

```bash
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply --force
```

`--force`는 기존 인증서·키를 `certs/backup-<시각>-<식별자>/`에 보관한 후 새로 발급한다. 새 인증서 생성이나 검증에 실패하면 기존 인증서와 설정을 유지한다. 갱신한 인증서는 클라이언트에서 신뢰 설정을 다시 확인해야 한다.

추가 옵션과 기존 명령:

```bash
npm run https:cert -- --help
npm run https:cert -- --dir "certs/local-test" --days 30 --apply
npm run cert:dev
```

`cert:dev`도 같은 스크립트를 사용한다. `--apply`를 생략하면 인증서만 생성/확인하고 `.env`를 변경하지 않는다.

## 다른 PC나 로봇에서 접속

인증서에 **서버의 실제 접속 IP/이름**을 넣는다. 아래 IP는 예시이므로 실제 서버 주소로 바꾼다.

```bash
npm run https:cert -- --hosts localhost,127.0.0.1,::1,192.168.10.20,robot.example.internal --apply --force
```

`.env`의 네트워크 설정을 맞춘 뒤 재시작한다.

```dotenv
HOST=0.0.0.0
PORT=8901
ALLOWED_HOSTS=192.168.10.20,robot.example.internal
```

클라이언트에서는 `https://192.168.10.20:8901` 또는 실제 DNS 이름으로 접속한다. 서버 방화벽도 해당 접속을 허용해야 한다. `--hosts`는 인증서의 호스트 목록이며 서버의 `HOST` 바인딩을 변경하지 않는다. 기본 바인딩은 `127.0.0.1`이다. IPv6 loopback으로 직접 접속하려면 `HOST=::1`을 설정하고 `https://[::1]:8901`을 사용한다.

## Windows에서 OpenSSL을 찾지 못할 때

스크립트는 PATH의 `openssl`을 먼저 확인하고, Git for Windows와 OpenSSL의 일반 설치 위치도 확인한다. 사용자 지정 설치는 PowerShell에서 실행 파일 경로를 지정한다.

```powershell
$env:OPENSSL_BIN='C:\Program Files\Git\usr\bin\openssl.exe'
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm start
```

OpenSSL 1.1.1 이상이 필요하다. 설치되어 있지 않으면 Git for Windows 또는 OpenSSL을 설치한다. OpenSSL 실행 파일은 인증서 생성/갱신에 사용하며, 인증서가 준비된 서버의 HTTPS 실행에는 필요하지 않다.

이 안내의 명령은 Node/npm으로 실행하는 소스 배포용이다. npm이 없는 Linux 런타임 배포본은 인증서를 준비하여 환경 설정에 경로를 지정한다. Android APK의 고정 로컬 서버 프로필은 이 CLI의 적용 대상이 아니다.
