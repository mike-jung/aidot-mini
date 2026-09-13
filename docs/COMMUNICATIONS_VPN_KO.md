# 통신 방식과 aidot-vpn 연계 설계

현재 목적에는 **HTTP로 명시적인 명령 계약, SSE로 가벼운 관리자 상태 구독, MQTT로 선택적인 단말 상태 전송, Socket.IO로 필요한 실시간 웹 화면**을 제공하는 구성이 적합하다. 모든 통신 라이브러리를 core에 강제로 포함할 이유는 없다. 0.3.0은 core 의존성 0개를 유지하고 MQTT.js/Socket.IO를 별도 addon으로 분리했다.

## 통신 수단의 역할

| 구분 | 권장 용도 | 전달 의미와 복구 | 이번 제공 범위 |
|---|---|---|---|
| HTTP/HTTPS | 설정·인증·명령 요청·스냅샷 | 요청 ID와 영속 상태로 재시도 대조 | core + ROBATON 데모 + ROS IPC |
| SSE | 콘솔 상태, 로그·진단 알림 | 서버→브라우저, 짧은 재접속 이력; 범위 밖이면 스냅샷 재조회 | `/admin/events` 구현 |
| MQTT 5 | 여러 단말의 상태·presence, 이후 규격화된 관제 메시지 | 브로커·세션·QoS·expiry와 업무 ACK를 구분 | 선택 telemetry publisher 구현 |
| Socket.IO 4 | 실시간 웹 UI, room별 구독, 이후 협업 화면 | 기본 at-most-once; 복구·인증·업무 저장은 별도 | 선택 읽기 채널·snapshot·권한 재검사 구현 |
| ROS Topic/Action/Service | 로봇 내부 센서·내비게이션·기능 호출 | ROS QoS와 Action 결과 | 실제 ROS1/ROS2 어댑터 |
| VPN | 네트워크 도달성·터널 암호화·접근 범위 | 연결 복구는 업무 오더 복구와 별개 | 기존 aidot-vpn 검토 및 연계 계약 제안 |

같은 이벤트를 SSE·MQTT·Socket.IO 세 경로로 모두 무조건 전송하면 CPU·전력·중복 처리 비용만 늘어난다. 단말은 업무 목적에 필요한 경로만 활성화한다. 영상과 포인트클라우드를 JSON 상태 이벤트에 넣지 않으며, 별도 대용량 전송과 대역폭 정책을 설계한다.

## SSE: 기본 콘솔에 적합한 작은 기능

SSE는 HTTP 연결에서 UTF-8 text/event-stream을 보내는 표준이며 EventSource가 재연결과 Last-Event-ID를 지원한다. 그러나 서버가 이력을 영속 저장하거나 놓친 이벤트를 무한히 복구해 주는 기능까지 표준이 제공하지는 않는다. 브라우저의 기본 EventSource는 임의 Bearer 헤더 설정용 인터페이스가 없으므로 같은 origin의 HttpOnly session cookie로 인증하는 편이 적합하다. 토큰을 query string에 넣으면 로그·히스토리 등에 남을 수 있으므로 피한다. [WHATWG SSE 표준](https://html.spec.whatwg.org/multipage/server-sent-events.html)

이번 구현은 최대 32개 연결, 주소당 4개, 최근 64개 이벤트, 이벤트 4KB를 기본 한도로 둔다. 프로세스 epoch와 sequence를 ID로 쓰고 재시작·이력 범위 초과에는 reset 이벤트를 보낸다. 느린 소비자의 쓰기 버퍼가 차면 연결을 종료하고 다음 연결에서 스냅샷을 받게 한다. 10초 heartbeat와 각 전송 시 권한 재검사로 로그아웃·세션 만료 후 데이터를 계속 보내지 않으며, 종료 시 모든 stream을 닫는다.

관리 UI는 로그인 후 EventSource('/admin/events')를 만들고 status 이벤트를 반영하면 된다. reset에서는 `/admin/status`를 다시 읽는다. 현재 콘솔은 기존 polling UI를 유지하며 SSE API만 추가했으므로 화면 전체를 SSE 방식으로 바꿨다고 표시하지 않는다. 업무 오더의 감사·재실행 근거는 이 짧은 메모리 이력이 아니라 DB/journal이어야 한다.

## MQTT: QoS와 로봇 실행 결과는 별개

MQTT 5의 QoS, session expiry, message expiry, Last Will을 이용하면 상태 전달을 다루기 편하다. QoS 1은 중복될 수 있고 QoS 2의 프로토콜 전달 의미도 모터 동작과 로컬 DB commit을 한 트랜잭션으로 묶어 주지는 않는다. 따라서 로봇 명령에는 commandId, revision, expiresAt, capability, 수락/완료/실패 결과와 영속 중복 제거가 필요하다. 이는 MQTT 수송 기능에 업무 계약을 더하는 설계 판단이다. [OASIS MQTT 5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)

권장 topic은 조직·장치 범위를 명확히 나누고 장치 인증에 맞는 ACL로 publish/subscribe 권한을 제한한다. status는 retained snapshot과 expiry를 조합할 수 있지만 이동 명령을 retained로 남기는 기본 설계는 피한다. 예전 명령이 재가입한 로봇에 다시 전달되는 상황을 막아야 한다. 온라인 status 역시 실제 내비게이션 readiness나 안전 정지 확인과 구별한다.

MQTT.js는 기본 설정에서 QoS 0 메시지를 오프라인 큐에 둘 수 있으므로 단말 상태 publisher는 `queueQoSZero:false`를 명시했다. `protocolVersion:5`도 명시한다. 선택 addon은 상태를 QoS 0/비 retained/10초 expiry로 보내며, 연결이 없으면 버리고 다음 최신 상태를 보낸다. status heartbeat와 LWT에는 제한된 expiry를 적용한다. 원격 broker는 TLS를 요구하고 인증서 검증을 끄지 않는다. [MQTT.js 공식 코드와 옵션](https://github.com/mqttjs/MQTT.js)

이번 addon은 **상태 publisher**이고 MQTT 명령 subscriber·영속 outbox·tenant broker ACL을 완성한 제품은 아니다. 다음 단계에서 명령을 넣을 때는 수신 journal commit 후 accepted를 보내고 실행 결과 outbox를 유지하는 구조가 필요하다. MQTT publisher callback이나 PUBACK를 이동 완료로 바꾸면 안 된다. broker 운영은 Mosquitto의 인증·ACL 또는 조직 표준 broker 정책에 연결하며, 시험용 localhost anonymous broker 설정을 운영 설정으로 복사하지 않는다. [Mosquitto 인증 문서](https://mosquitto.org/documentation/authentication-methods/)

## Socket.IO: 웹 화면용 선택 기능

Socket.IO는 단순 WebSocket과 동일한 프로토콜이 아니며 양쪽에 호환 라이브러리가 필요하다. 공식 문서는 기본 전달을 at-most-once로 설명하고 추가 보장을 애플리케이션이 구현하도록 한다. 일시 연결 복구 기능도 항상 성공한다고 보장하지 않는다. 따라서 연결 복구에 실패하면 offset이나 스냅샷을 대조하고, 오더는 별도의 영속 상태를 조회해야 한다. [전달 보장](https://socket.io/docs/v4/delivery-guarantees/), [연결 상태 복구](https://socket.io/docs/v4/connection-state-recovery/)

이번 addon은 서버 번들·polling fallback·압축을 기본으로 붙이지 않고 WebSocket 전용 읽기 채널을 제공한다. Origin/Host 일치, 지정 origin 목록, 인증 callback, 16KB 입력 한도, 최대 32연결, 8KB telemetry 제한을 둔다. 최신 telemetry는 volatile로 전송하고 session 권한을 다시 확인한다. 변경 명령 RPC는 구현하지 않았다. 이후 room 구독을 추가할 때 client가 room 문자열을 임의 선택하게 두지 말고 권한으로 계산한 robot/tenant 목록에 한정해야 한다.

연결 복구를 켤 경우 middleware를 건너뛰는 설정으로 취소된 권한이 되살아나지 않게 한다. 공식 server options의 skipMiddlewares 의미를 확인하고 재연결 시 권한을 다시 검증한다. 연결 ID를 사용자 신원이나 로봇 식별자로 쓰지 않는다. [Socket.IO server options](https://socket.io/docs/v4/server-options/)

## ROS·무선 통신 연구에서 가져온 판단

ROS core 팀의 2023년 대체 미들웨어 보고서와 개발자 논의는 multicast 발견과 네트워크 구성의 운영 부담을 보여 준다. 이 논의에서 Zenoh가 대안으로 선택되었고 현재 공식 rmw_zenoh 저장소가 제공된다. 다만 “DDS는 사용할 수 없다”거나 “Zenoh가 모든 환경에서 가장 빠르다”는 결론은 아니다. 로봇 내부에서는 기존 DDS 구성을 유지하고 관제에는 좁은 업무 API를 쓰는 것도 설정 부담을 줄이는 선택이다. [Open Robotics 공식 논의](https://discourse.openrobotics.org/t/ros-2-alternative-middleware-report/33771), [rmw_zenoh](https://github.com/ros2/rmw_zenoh)

Zhang 등의 연구는 Ethernet·Wi-Fi·4G와 실제 로봇 실험에서 MQTT·Zenoh·DDS를 비교했으며, 실험 환경에 따라 유리한 구현이 달랐다. 2024년 개정 논문 결과를 2026년의 모든 RMW·장비 성능 순위로 일반화하지 않는다. 이 연구에서 가져올 결정은 실제 로봇의 네트워크·payload·보안 설정으로 지연과 손실을 측정해야 한다는 점이다. [Comparison of Middlewares, Journal of Intelligent & Robotic Systems, 2024](https://arxiv.org/abs/2309.07496)

Lee 등의 2025년 연구는 무선 환경의 큰 payload에서 IP fragmentation, 재전송 시점, buffer burst 문제를 분석하고 DDS 매개변수 조정 효과를 제시한다. 이것은 작은 오더 JSON 전송과 영상·LiDAR 전송을 같은 설정으로 다루면 안 된다는 근거다. 해당 연구의 처리량·지연 수치를 aidot-mini의 성능 측정값으로 제시하지 않는다. [Optimizing ROS 2 Communication for Wireless Robotic Systems](https://arxiv.org/abs/2508.11366)

VPN을 설치해 IP 경로가 생겨도 DDS multicast discovery, ROS1 광고 주소, MTU, NAT, 방화벽, 이름 해석 문제가 자동 해결되지는 않는다. 기본 제품에서는 ROS graph를 로봇 안에 두고 관제 메시지만 VPN 위 HTTP/MQTT로 통과시키는 편이 업체 부담이 적다. 원격 RViz나 ROS graph 공유가 필요한 유지보수 모드는 별도 권한·대역폭·발견 설정으로 제공한다. WireGuard의 네트워크 namespace 문서는 tunnel과 socket/route의 경계를 이해하는 데 유용하다. [WireGuard network namespaces](https://www.wireguard.com/netns/)

## aidot-vpn은 독립 설치가 기본

검토한 Rev1.18.1의 Linux용 Node CLI는 가입·승인·상태 조회·WireGuard 설정 생성을 제공한다. 단말 정보는 `~/.aidotvpn/device.json`에 보관하며, state 조회에는 device별 stateToken이 필요하다. CLI에서 설정 생성과 `wg-quick up` 실행은 분리되어 있고, 앱 필터 정책이나 WSS 설정은 일반 wg-quick 경로에 적합하지 않아 거부한다. 따라서 현재 CLI를 mini에 import하면 Linux 상시 VPN daemon이 완성된다는 식으로 설계하면 안 된다. 근거: `aidot-vpn-rev1.18.1-full.zip`, `client-node/aidot-client.mjs`와 `client-node/README.md`.

VPN은 네트워크 장치·라우팅·방화벽을 다루므로 web application보다 높은 권한을 요구할 수 있다. 이 권한을 mini Node 프로세스에 부여하면 관리자 콘솔이나 AI 작성 모듈의 오류가 tunnel과 host routing까지 영향을 줄 수 있다. VPN 업데이트가 ROS 오더 처리 프로세스를 같이 재시작시키는 것도 좋지 않다. **별도 설치·별도 서비스·별도 키 저장을 기본으로 하고, 묶음 installer와 상태 UI만 연결하는 방식을 권장한다.**

| 대상 | VPN 패키지 | mini 연결 방식 |
|---|---|---|
| 일반 Linux 서버 | 독립 daemon/service | root 소유 Unix socket의 제한된 상태 API |
| ROS1/ROS2 로봇 Linux | 위 Linux VPN 클라이언트 재사용 | ROS 의존성 없이 mini 진단에 연결 |
| Android | VpnService 기반 독립 앱/서비스 또는 기존 SDK | 권한 있는 IPC로 상태 연계; 앱 프로세스 수명 주기 분리 검토 |
| mini 없이 VPN만 필요한 단말 | 독립 설치 가능 | 연결 불필요 |

ROS1용 VPN과 ROS2용 VPN을 별개 구현으로 나눌 필요는 보통 없다. VPN 데이터 경로는 IP 계층이므로 같은 Linux client를 사용하고, ROS 관련 진단·선택적 route profile만 추가하면 된다. Android의 VpnService 수명 주기와 시스템 동의는 Android 측 client가 책임진다. 플랫폼별 권한/서비스 구현을 공통 wire protocol과 분리한다.

## mini ↔ VPN의 제한된 로컬 계약 제안

VPN daemon이 root 또는 필요한 capability만 가진 계정으로 Unix socket을 소유하고 mini에는 전용 그룹을 통한 접근만 허용한다. 초기 연계는 `GetStatus`, `GetVersion`, `GetDiagnostics`처럼 비밀 없는 읽기 기능으로 시작한다. 응답 예시는 연결 상태, 최근 handshake 시각, assigned IP, policy revision, 오류 코드이다. privateKey·PSK·stateToken·전체 wg config는 반환하지 않는다.

가입·재연결·연결 해제 기능은 상태 조회와 권한을 분리하고 변경 이력을 남긴다. mini가 임의 `sudo`, shell command, wg-quick argument, routing table을 전달할 수 있는 API는 만들지 않는다. 원격에서 VPN을 끊는 요청은 이후 복구 통로가 사라질 수 있으므로 제품 차원에서 권한과 로컬 복구 절차를 설계한다. 이는 VPN 클라이언트 통합 다음 단계의 계약이며 이번 mini에 실행용 VPN 제어를 넣지는 않았다.

오프라인에서도 로봇 로컬 상태와 콘솔은 접근 가능해야 한다. VPN 연결 여부만으로 ROS readiness를 true/false로 단정하지 않고, 관제 연결·ROS 연결·위치 신선도·오더 복구 필요 여부를 각각 표시한다. VPN 재연결 후 미완료 명령을 자동 재실행하지 않으며 ROBATON과 journal을 대조한다. 이 방식이면 mini 없이 VPN을 설치할 수 있고, 필요할 때 하나의 제품처럼 사용할 수도 있다.

## 단계별 적용

1. 현재 배포: core SSE, 선택 MQTT/Socket.IO, Linux 패키지, ROS 어댑터, 실제 ROBATON 데모 연동을 제공한다.
2. 제품 계약: ROBATON의 지도·capability·오더 revision·재부팅 복구 규약과 conformance suite를 확정한다.
3. VPN daemon: 기존 가입/stateToken 계약을 재사용하되 플랫폼별 상시 서비스·키 저장·권한 경계를 구현한다.
4. UI 연결: 로봇·관제·VPN 상태를 구분해 표시하고 허용된 복구 작업만 제공한다.
5. 업체 인수: 실제 CPU/OS/ROS/RMW 조합, 무선 재접속, 전원 손실, 디스크 오류, 안전 제어를 현장에서 검증한다.

기술 선택의 우선순위는 신뢰할 수 있는 오더 의미와 복구 절차, 쉬운 업체 설정, 작은 기본 배포, 필요한 통신의 선택 설치 순이다. HTTP·MQTT·Socket.IO·VPN 중 어느 하나가 이 업무 계약을 대신해 주지는 않는다.
