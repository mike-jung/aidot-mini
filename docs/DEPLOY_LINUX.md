# Linux 서버와 로봇 보드 배포

0.5.1은 Node 런타임을 포함한 Linux x64·ARM64 tar.gz와 Debian 패키지를 만든다. 같은 묶음에 ROS1·ROS2 어댑터 소스와 systemd 예제가 들어 있다. 일반 서버는 ROS 없이 웹서버만 실행한다. ROS 패키지는 해당 로봇에 설치된 ROS 배포판의 SDK로 빌드한다.

## 지원 범위

| 대상 | 제공물 | 조건 |
|---|---|---|
| Linux x86_64 | tar.gz, amd64.deb | glibc 2.28+, GLIBCXX 3.4.21+ |
| Linux AArch64 | tar.gz, arm64.deb | 같은 ABI 조건; ARM64 실기 실행은 별도 |
| ROS1 | catkin 패키지 | 기존 Noetic/move_base 장비 유지보수용 |
| ROS2 | ament_python 패키지 | rclpy, Nav2 메시지와 기존 내비게이션 서버 |
| Android | 별도 APK/Bionic 런타임 | Linux glibc 패키지와 호환되지 않음 |
| ARMv7, musl/Alpine, MCU | 이번 바이너리에 미포함 | 해당 ABI용 Node/SQLite 검증 필요 |

ABI 하한은 공급한 ELF의 버전 심벌에서 추출한다. 최저 버전 OS에서의 실행을 대신하는 보장은 아니다. 런타임 출처는 `deploy/linux/runtime-lock.json`의 npm 아키텍처 패키지이며, Node 공식 서명 배포 검증을 완료한 것으로 표시하지 않는다. 패키지 SHA-256과 각 배포 파일 SHA-256을 고정한다. 운영 공급망에서는 조직이 검증한 Node 배포 채널과 서명 정책을 추가한다.

## 소스로 HTTPS 콘솔 시작

```sh
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm start
```

기본 주소는 `https://localhost:8901`이다. `--apply`는 `.env`에 HTTPS 설정을 저장하므로 실행 중인 서버는 재시작한다. 자체 서명 인증서와 LAN 주소 설정은 [HTTPS 콘솔 안내](HTTPS_CONSOLE_KO.md)를 따른다.

## 소스에서 빌드

Python 3, npm, GNU readelf, Debian 패키지는 dpkg-deb가 필요하다. 소스 의존성이 없다면 npm ci를 먼저 실행한다. 전체 프로젝트에서 빌드한다. 먼저 `APP_WORKSPACE`를 지정하면 그 업무 파일을 포함한다. 빌더가 `workspace:compile`을 실행해 캐시와 meta를 자동 준비한다. 설치된 Linux 배포본은 npm 없이 실행한다.

```sh
npm ci --ignore-scripts
# 외부 업무 폴더를 포함할 때만 실제 경로를 지정한다.
# export APP_WORKSPACE=/absolute/path/to/workspace
npm run build:linux -- --arch x64 --download --deb
npm run build:linux -- --arch arm64 --download --deb
```

이미 받은 런타임은 `--runtime-cache /path/to/cache`로 지정한다. 버전·해시가 다르면 빌드는 중단된다. ARM64 묶음 생성은 ARM64 실행 검증을 뜻하지 않는다. 출력은 `dist/linux/`에 생성된다.

## 압축 해제 후 실행

```sh
tar -xzf aidot-mini-0.5.1-linux-x64.tar.gz
cd aidot-mini-0.5.1-linux-x64
./bin/aidot-mini --check
./bin/aidot-mini
```

새 설치는 `http://127.0.0.1:8901`에서 ID/Password 계정을 등록한다. 기존 설치는 서버를 중지한 뒤 `./bin/aidot-mini --admin-account`로 계정을 만든다. 자세한 안내는 [콘솔 로그인](CONSOLE_LOGIN_KO.md)을 참고한다. 데이터 기본 위치는 `${XDG_STATE_HOME:-$HOME/.local/state}/aidot-mini`이다. 설치 디렉터리는 읽기 전용으로 두고 DATA_DIR만 외부 쓰기 영역으로 지정할 수 있다.

`--check`는 CPU/OS, 파일 무결성, 실제 SQLite 쓰기·읽기, 암호 난수 기능을 검사한다. 런타임을 포함하면 최소 소스보다 디스크 사용량이 커진다. 보드에 검증한 Node가 이미 있다면 소스 배포와 `node start.js`를 이용할 수 있다.

## Debian 및 systemd

```sh
sudo dpkg -i aidot-mini_0.5.1_amd64.deb
sudo cp /opt/aidot-mini/deploy/aidot-mini.env.example /etc/aidot-mini/aidot-mini.env
sudo chmod 600 /etc/aidot-mini/aidot-mini.env
sudo systemctl enable --now aidot-mini.service
sudo systemctl status aidot-mini.service
```

설치는 서비스를 자동 시작하지 않는다. `/opt/aidot-mini`에 프로그램을 배치하고 전용 계정과 `/var/lib/aidot-mini`, `/var/log/aidot-mini`를 준비한다. 서비스는 root 권한으로 실행하지 않는다. 환경 설정 파일은 systemd가 읽는다. 인증서 개인키를 별도로 지정하면 `aidot-mini` 계정에 필요한 읽기 권한만 준다.

```ini
HOST=0.0.0.0
PORT=8901
HTTPS_ENABLED=true
TLS_CERT_FILE=/etc/aidot-mini/server.crt
TLS_KEY_FILE=/etc/aidot-mini/server.key
ALLOWED_HOSTS=robot.example.internal
```

LAN 바인딩에는 HTTPS가 필요하다. 인증서 SAN과 접속 이름/IP를 맞춘다. VPN 안에서도 관리자 인증과 HTTP 접근 정책은 유지한다. 계정은 서버를 중지한 상태에서 서비스의 DATA_DIR과 서비스 계정으로 생성한다.

```sh
sudo systemctl stop aidot-mini.service
sudo -u aidot-mini env DATA_DIR=/var/lib/aidot-mini /opt/aidot-mini/bin/aidot-mini --admin-account
sudo systemctl start aidot-mini.service
```

## 업그레이드와 운영

이동 오더를 정지·확인한 뒤 서비스를 내리고 DB·설정·로봇 체크포인트를 함께 백업한다. 새 프로그램을 설치한 후 `--check`, readiness, 실제 로봇 상태를 확인한다. DB migration 후 바이너리만 되돌리는 rollback을 자동으로 안전하다고 간주하지 않는다. 이전 DB와 설정을 함께 복원하는 절차를 준비한다.

전원 손실 중 파일 시스템 동작, eMMC 수명, 열 제한, 장기간 연결 유지, 실제 안전 정지는 보드에서 확인할 항목이다. 이번 시험의 실제 실행 범위와 미실행 항목은 `VALIDATION_V051.md`에 별도로 기록한다. systemd PID1이 없는 시험 환경에서 unit 문법 검사와 추출 실행을 서비스 설치 성공으로 표시하지 않는다.
