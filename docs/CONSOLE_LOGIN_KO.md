# aidot-mini 0.4.1 — ID/Password 콘솔 로그인

0.4.1부터 콘솔의 기본 로그인은 아이디와 비밀번호다. API·자동화용 관리자 키는 유지하며, 콘솔에서는 기존 설치의 계정 전환·복구가 필요할 때만 선택해서 사용한다. 관리자 계정은 기기당 1개다. 클라우드 회원가입이나 외부 인증 서버, 추가 npm 패키지는 필요 없다.

## 새로 설치한 기기

1. `npm start`로 서버를 실행한다.
2. 서버가 실행 중인 기기에서 `http://127.0.0.1:8901`을 연다.
3. 처음 표시되는 **관리자 계정 만들기**에서 사용할 아이디·비밀번호·비밀번호 확인을 입력한다. 아이디 제안 값은 `admin`이며 비밀번호는 직접 정한다. `admin/admin1234` 기본 계정을 만들지 않는다.
4. 등록 후 바로 콘솔이 열린다. 다음 접속부터 아이디와 비밀번호로 로그인한다.

아이디는 영문·숫자·`_.@-` 3~64자이며 대소문자를 구분한다. 비밀번호는 12~128자이며 공백·한글을 사용할 수 있다. 앞뒤 공백을 자동 삭제하지 않는다. **표시/숨김**으로 입력 내용을 확인할 수 있고 브라우저의 계정 자동완성 규약을 사용한다.

익명 최초 등록은 새 설치에서 로컬 주소로 접속했을 때만 허용한다. `HOST=0.0.0.0` 같은 LAN 바인딩에서는 허용하지 않는다. 기존 관리자 키가 이미 있는 설치도 익명 등록을 허용하지 않는다. 기기를 다른 사용자에게 공개하기 전에 계정을 만든다. 같은 OS의 로컬 앱/사용자를 신뢰하는 최초 등록 모델이며 OS 사용자 분리나 앱 격리를 대신하지 않는다.

## 이미 관리자 키로 사용 중인 기기 — 키 복사 없이 전환

실행 중인 서버를 정상 종료하고 **기존 서버와 같은 DATA_DIR·ENV_FILE·OS 사용자**로 실행한다.

```sh
npm run admin:account
```

아이디, 비밀번호, 확인 값을 순서대로 입력한다. 비밀번호는 터미널에 표시되지 않는다. 그다음 `npm start` 또는 기존 로봇 실행 명령으로 다시 기동하고 ID/Password로 로그인한다. DB·기존 키·로봇 연결 설정은 그대로 사용한다.

서버를 중지하기 어려우면 로그인 화면의 **기존 관리자 키로 전환·복구**를 펼쳐 기존 키로 한 번 로그인한다. 바로 열리는 **설정 → 관리자 계정**에서 아이디와 비밀번호를 등록하면 재시작 없이 적용된다. 이후에는 키를 입력할 필요가 없다.

비밀번호를 잊었을 때는 기존 키로 위 복구 절차를 사용하거나, 서버를 중지한 뒤 다음 명령을 실행한다.

```sh
npm run admin:account -- --reset
```

이 명령은 해당 DATA_DIR의 계정을 교체하고 저장된 콘솔 세션을 해제한다. 실행 중인 서버는 메모리에 이전 계정을 가지고 있으므로 반드시 중지 후 실행한다. 손상된 계정 파일은 복구 사본으로 남긴다. 운영 계정의 비밀번호를 명령줄 인자로 전달하지 않는다. 자동 설치에서는 `--stdin`으로 private 표준입력의 JSON `username`·`password` 필드를 받는다.

## 로그인 유지·비밀번호 변경

- 선택하지 않음: 브라우저 세션 쿠키를 사용하고 기본 최대 60분 동안 유효하다. 서버를 재시작하면 로그인이 해제된다. 브라우저의 탭/세션 복원 정책에 따라 창을 닫아도 쿠키가 복구될 수 있지만 서버 만료 시간은 연장되지 않는다.
- **이 기기에서 로그인 유지** 선택: 기본 최대 7일. 브라우저가 쿠키를 보존하고 동일한 DATA_DIR을 사용하면 서버를 재시작해도 복원된다. 자동으로 무기한 연장하지 않는다.
- 로그아웃: 현재 세션을 메모리와 저장 파일에서 해제한다.
- **설정 → 관리자 계정**: 현재 비밀번호를 확인한 뒤 아이디/비밀번호를 변경한다. 현재 화면에는 새 세션을 발급하고 다른 콘솔 세션은 모두 해제한다. 기존 SSE 연결은 다음 송신/heartbeat 때 종료된다(기본 최대 약 10초).
- 관리자 키로 인증한 세션은 계정 복구 권한을 가진다. 따라서 이전 키도 계속 비공개로 보관한다. 계정 변경은 API 키를 회전시키거나 이미 접수된 로봇 오더를 취소하는 동작이 아니다.

`.env`의 선택 설정:

```ini
# Default session lifetime, 1–1440 minutes
ADMIN_SESSION_MINUTES=60
# Remembered session lifetime, 1–30 days
ADMIN_REMEMBER_DAYS=7
```

계정·기억된 세션은 기본 `DATA_DIR/admin-account.json`에 저장한다. `ADMIN_ACCOUNT_FILE`로 경로를 바꿀 수 있다. 계정 설정은 SQL 업무 DB와 분리되어 Controller·Service·SQL 이식에 포함되지 않는다. 백업 시 이 파일과 기존 `admin-token`은 비공개로 취급한다.

## Linux·ROS·Android

Linux 런타임 포함 배포에서도 같은 계정 명령을 제공한다.

```sh
# Stop the server first; the launcher selects its normal DATA_DIR.
./bin/aidot-mini --admin-account
# Recover an existing account:
./bin/aidot-mini --admin-account --reset
```

systemd 예시:

```sh
sudo systemctl stop aidot-mini.service
sudo -u aidot-mini env DATA_DIR=/var/lib/aidot-mini /opt/aidot-mini/bin/aidot-mini --admin-account
sudo systemctl start aidot-mini.service
```

커스텀 `ADMIN_ACCOUNT_FILE`·`ENV_FILE`을 사용한다면 계정 명령에도 같은 값을 전달한다. ROS 모듈은 인증 변경 대상이 아니며 기존 로봇 프로파일의 DATA_DIR을 그대로 지정한다.

Android 소스 빌드에는 같은 로그인 화면과 서버 코드가 포함된다. 신규 설치는 WebView에서 계정을 등록한다. 기존 설치는 앱의 관리자 키 복사 버튼으로 한 번 전환할 수 있다. 이번 변경은 소스·서버 assets 변경이며 **이미 설치된 0.4.0 APK의 화면이 자동 변경되지는 않는다**. 새 소스로 APK를 빌드하고 기존과 같은 서명으로 업데이트해야 한다. 기존 앱을 삭제하면 기기 내 데이터가 사라질 수 있으므로 업데이트 문제를 해결하려고 앱을 삭제하지 않는다.

## 설계 근거와 검증

현재 지원 하한인 Node 22에서도 사용 가능한 비동기 `crypto.scrypt`를 사용한다. OWASP가 제시한 메모리 절약 조합 `N=2^14, r=8, p=5`를 선택하여 별도 네이티브 의존성을 추가하지 않았다. 16바이트 무작위 salt와 일정 시간 비교를 사용한다. 비밀번호 계산은 한 번에 1개로 제한하여 동시 로그인 요청의 메모리 증가를 제한한다. [Node crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

쿠키에는 `HttpOnly`, `SameSite=Strict`를 적용하고 HTTPS에서는 `Secure`도 적용한다. 인증 문자열을 localStorage에 저장하지 않는다. 무작위 세션 ID의 SHA-256 값만 파일에 저장하며, 계정 revision과 기존 API 키 fingerprint에 세션을 연결한다. 비밀번호 변경·키 변경·만료 시 이전 세션을 복원하지 않는다. CSRF·Origin·Host 검사 및 로그인 시도 제한을 유지한다. [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

실제 완료한 시험과 완료하지 못한 시험은 [VALIDATION_V041.md](VALIDATION_V041.md), 원본 로그는 `validation/v041/`을 참고한다. 기존 0.4.0 튜토리얼의 관리자 키 로그인 단계는 이 문서로 대체한다.
