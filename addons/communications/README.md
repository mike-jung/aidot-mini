# 선택 통신 addon

기본 aidot-mini에는 추가 npm 의존성이 없다. MQTT와 Socket.IO가 필요한 제품만 이 디렉터리에서 설치한다.

```sh
npm ci --omit=dev --ignore-scripts
```

MQTT.js 5.15.2와 Socket.IO 4.8.3, 전이 의존성은 package-lock.json에 고정한다. addon은 Linux 기본 바이너리에 자동 포함되지 않는다. 코드 통합 시 함께 배포하거나 source 프로젝트에서 사용한다. Android APK 기본 assets도 이 addon을 포함하지 않으며 Android용 addon 검증을 수행한 것으로 표시하지 않는다.

## MQTT telemetry publisher

```js
import {mqttTelemetry} from './mqtt.mjs';
const channel = mqttTelemetry({
  url: 'mqtts://broker.example.internal:8883',
  deviceId: 'robot-001',
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});
// 최신 값만 보낸다. 연결이 없거나 쓰기 버퍼가 차면 false를 반환한다.
channel.publish({battery: 75, pose: {x: 1, y: 2}});
// 종료 시 await channel.close();
```

`aidot/devices/<deviceId>/status`와 `/telemetry`를 사용한다. prefix를 조직 정책에 맞게 변경할 수 있다. stable clientId가 동일한 단말 두 개에서 동시에 사용되지 않게 provisioning한다. password·CA·장치 신원은 외부에서 공급하고 서버의 certificate 검증을 유지한다. remote plaintext broker는 거부한다. 상태 이벤트는 QoS 0, 비 retained, expiry 10초이며 연결 중단 시 오래된 telemetry를 쌓지 않는다.

이 publisher는 MQTT 명령 실행 모듈이 아니다. MQTT 업무 명령은 durable inbox/outbox·권한·ID·expiry·실제 ROS 결과를 포함한 별도 계약으로 추가한다. broker ACL과 인증서 운영은 배포자의 책임이며 로컬 익명 broker는 시험 전용이다.

## Socket.IO 읽기 채널

`socketTelemetry({server, origins, authorize, snapshot, maxClients})`에 이미 만든 Node HTTP/HTTPS server를 전달한다. `origins`는 정확한 허용 origin 목록이고 Origin과 Host도 일치해야 한다. `authorize(auth, request)`는 현재 권한을 확인해 `{id: '...'} ` 또는 null을 반환한다. 한 번 로그인한 결과를 영구 신뢰하는 callback을 넣지 않는다. 기존 session 저장소 또는 검증된 토큰 저장소와 연결한다.

연결 후 client의 `snapshot` 이벤트에 ACK callback으로 현재 상태를 반환한다. `await channel.publish(value)`는 읽기용 `telemetry`를 volatile로 전송한다. API 입력은 16KB, snapshot/telemetry는 8KB, 인증·snapshot callback은 2초로 제한한다. 동시에 publish가 진행 중이면 다음 호출은 false를 반환하므로 발행자는 최신 값으로 재시도한다. 변경 명령 이벤트는 제공하지 않는다.

Socket.IO client를 사용하는 실제 웹 애플리케이션에서 token/session과 인증 오류 표시를 구성한다. 기본 console에 Socket.IO client 번들을 넣지는 않았다. `channel.close()`는 Socket.IO의 공식 close 동작에 따라 **전달한 HTTP server도 닫으므로** 그 server의 수명 주기를 소유하는 코드에서 사용한다. core의 종료 hook과 이중으로 HTTP server를 닫지 않는다. 별도 listener나 단일 shutdown coordinator가 적합하다.

## 실제 통신 시험

```sh
npm ci --ignore-scripts
MOSQUITTO_BIN=/path/to/mosquitto node --test test.mjs
```

시험은 실제 Mosquitto 프로세스와 MQTT5 publisher/subscriber, 실제 Socket.IO client/server를 실행한다. LWT·재연결·오프라인 버림·Origin·인증·snapshot·권한 취소를 확인한다. 제품 broker에 연결하지 않고 loopback 임시 broker를 생성한다. MQTT TLS·상용 broker ACL·대규모 부하·모바일 Socket.IO 호환성은 이 시험의 범위에 포함되지 않는다.
