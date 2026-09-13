# ROS 로봇 클라이언트 설치와 업체 연동

권장 구성은 하나의 배포 묶음 안에 **aidot-mini + 로봇 클라이언트 + 작은 ROS 어댑터**를 넣고 프로세스는 분리하는 방식이다. ROS 어댑터는 이동 Action을 호출하고 위치·배터리를 읽는다. 웹서버를 ROS 프로세스에 넣거나 원격에 모든 ROS Topic을 공개할 필요가 없다.

소스 묶음과 실제 설치 SDK의 차이, 빌드·재현 명령은 [ROS SDK 빌드 안내](ROS_SDK_BUILD_KO.md)를 참조한다.

## 로봇 업체가 맞출 항목

| 설정 | ROS1 | ROS2 |
|---|---|---|
| 이동 | `move_base_msgs/MoveBaseAction`, 기본 `move_base` | `nav2_msgs/action/NavigateToPose`, 기본 `navigate_to_pose` |
| 위치 | `geometry_msgs/PoseWithCovarianceStamped`, 기본 `amcl_pose` | 같은 메시지, 기본 `amcl_pose` |
| 배터리 | `sensor_msgs/BatteryState`, 기본 `battery_state` | 같은 메시지, 기본 `battery_state` |
| 지도 프레임 | 기본 `map`, 관제 좌표와 동일하게 정합 | 동일 |
| 취소 | move_base Action 취소를 실제 구현 | Nav2 Action 취소를 실제 구현 |

배터리 percentage는 ROS 표준의 0~1 값이다. 현재 poseAgeMs는 ROS 메시지를 수신한 뒤의 monotonic 경과 시간이며 원시 측정 시각을 검증하는 필드는 아니다. 정지 중에도 pose를 주기적으로 공급해야 하고, AMCL이 변화 때만 발행하는 구성은 별도 상태 publisher/TF 변환 노드로 맞춰야 한다. 측정 timestamp·clock skew·TF validity까지 확인하는 업체용 규약은 추가 항목이다. 위치는 실제 localization 결과여야 한다. 이번 어댑터는 TF 좌표 변환을 수행하지 않으므로 지정된 frame의 위치 Topic을 공급해야 한다. 다른 메시지를 쓰는 업체는 작은 변환 노드가 필요하다. 모터 제어·센서·경로 계획·물리적 비상정지는 기존 로봇 제어기의 책임이다. 도킹·리프트·충전·지도 전환은 이번에 구현하지 않았다.

## ROS2 빌드와 실행

로봇에 해당 ROS2 배포판과 rclpy/nav2_msgs/geometry_msgs/sensor_msgs/std_msgs/launch_ros, colcon이 설치되어 있어야 한다. 기존 Nav2 서버가 실제로 동작해야 한다. Ubuntu 24.04 장비는 Jazzy를 기준으로 시작한다.

```sh
. /opt/ros/jazzy/setup.sh
python3 scripts/build-ros.py --family ros2 --compile
. dist/ros/aidot-mini-0.5.1-ros2/install/setup.sh
ros2 launch aidot_mini_ros2 robot.launch.py navigation_action:=navigate_to_pose pose_topic:=amcl_pose battery_topic:=battery_state map_frame:=map
```

Linux 바이너리 묶음에는 `/opt/aidot-mini/ros-src/ros2/src`가 들어 있다. 쓰기 가능한 작업 공간으로 ros2 디렉터리를 복사한 뒤 그 위치에서 `colcon build --merge-install`해도 된다. systemd 배포용 overlay는 `colcon build --merge-install --install-base /opt/aidot-mini/ros`로 운영자가 설치 위치에 대한 권한을 준비한 후 만든다. 개발 작업 공간을 서비스 계정의 쓰기 가능한 코드 영역으로 남기지 않는다.

ROS2의 위치·배터리 구독은 BEST_EFFORT/KEEP_LAST 1이므로 BEST_EFFORT와 RELIABLE publisher 모두에서 최신 값을 받을 수 있다. 실제 로봇의 Domain ID, namespace, Topic과 frame을 맞춘다. Domain ID는 인증 수단이 아니다. 빌드된 aidot-mini SDK overlay는 표시된 OS·CPU·ROS·Python 환경이 일치할 때 사용한다. 대상 환경이 다르면 소스 workspace에서 다시 빌드한다. 전체 ROS SDK는 별도로 설치한다.

## ROS1 빌드와 실행

```sh
. /opt/ros/noetic/setup.sh
python3 scripts/build-ros.py --family ros1 --compile
. dist/ros/aidot-mini-0.5.1-ros1/install/setup.sh
roslaunch aidot_mini_ros robot.launch navigation_action:=move_base pose_topic:=amcl_pose battery_topic:=battery_state map_frame:=map
```

catkin 패키지는 `cmake -S src/aidot_mini_ros -B build -DCMAKE_INSTALL_PREFIX=/opt/aidot-mini/ros` 후 `cmake --build build --target install`로도 설치할 수 있다. ROS1 master URI와 광고 IP는 기존 로봇 네트워크에 맞춘다. ROS1 master/Topic을 인터넷이나 VPN 전체 가입자에게 개방하지 않는다. Noetic은 이미 지원 종료된 계열이므로 기존 장비를 위한 호환 경로로 한정한다.

## 로봇 클라이언트 연결

이번에 확인한 ROBATON v0.50.0의 규약은 두 가상 로봇 데모다. 이 규약의 실제 구현은 `ROBOT_PROTOCOL=robaton-demo-v050`로 명시한다. 프로덕션 관제 규약이나 VDA5050 구현이라고 표시하지 않는다.

```sh
export DATA_DIR="$HOME/.local/state/aidot-mini"
export ROBOT_PROTOCOL=robaton-demo-v050
export ROBOT_ID=amr-a
export ROBATON_URL=https://fleet.example.internal
export ROBATON_API_TOKEN='<발급된 관제 API 토큰>'
export ROS_BRIDGE_TOKEN_FILE="$DATA_DIR/robot/bridge-token"
node modules/robot-client/main.mjs
```

Linux 바이너리는 마지막 줄 대신 `./bin/aidot-mini --robot`을 사용한다. 데모의 시작 좌표는 amr-a=(-4,-1), amr-b=(4,1)이고 경로·완료 오차 규칙이 매우 엄격하다. 임의 실제 지도에서 그대로 운행시키는 규약이 아니다. 테스트에는 전용 master/domain의 `tests/ros/fake_navigation.py`를 사용한다. 실물 내비게이션과 같은 ROS graph에 시험용 Action 서버를 띄우지 않는다.

`GET /admin/robot`으로 상태를 조회하고 `POST /admin/robot/resume`으로 로컬 보류를 해제할 수 있다. 관리자 인증이 필요하며 브라우저 session 요청에는 CSRF 토큰도 필요하다. 보류 해제는 bridge가 준비되고 활성 목표가 없고 관제 HOLD가 해제된 경우에만 가능하다. 0.4.0의 로봇 탭에서 연결 설정·진단·보류·해제를 수행한다. resume 요청 본문은 `{ "confirmStopped": true }`이며 실제 정지와 관제 보류 해제를 확인해야 한다. 상세 절차는 [로봇 콘솔](ROBOT_CONSOLE_V040_KO.md)을 참고한다.

## 하나의 설치 묶음과 별도 서비스

`deploy/robot/`의 unit을 `/etc/systemd/system`으로 설치하고 `robot-client.conf`를 `aidot-mini.service.d/`에 둔다. `ros.env.example`을 `/etc/aidot-mini/ros.env`로 복사해 실제 배포판·overlay·Topic을 지정한다. 두 서비스는 같은 비특권 계정으로 실행하므로 0600 bridge token을 공유할 수 있다. ROS1과 ROS2 서비스를 동시에 같은 port로 띄우지 않는다.

`aidot-robot.target`이 웹서버와 ROS 어댑터를 함께 시작한다. 웹서버는 어댑터보다 나중에 시작하고 먼저 종료하므로 취소 요청을 보낼 기회를 갖는다. VPN 서비스는 이 target과 수명 주기를 결합하지 않는다. bridge 재시작만으로 관제 UI까지 강제 중단하지 않도록 Wants/After로 연결한다.

## 명령·장애 의미

IPC는 127.0.0.1:8912에만 바인딩하고, 파일에 저장한 무작위 토큰과 JSON 크기 제한을 적용한다. 임의 shell/Topic/Service 호출 API는 없다. `GET /v1/state`, `POST /v1/state`, `POST /v1/navigate`, `POST /v1/cancel`만 제공한다. GET 상태 조회는 읽기 전용이고, 빈 객체를 보내는 POST 상태 조회만 제어 heartbeat를 갱신한다. 진단 화면이 살아 있다는 이유로 제어 클라이언트의 단절이 숨겨지지 않도록 분리했다. 관리 브라우저가 이 IPC를 직접 호출하는 Origin 요청은 거부한다.

`commandId`와 목표의 지문을 저장한 뒤 ROS를 호출한다. 최근 128개 명령 안에서 같은 ID·같은 목표는 이전 결과를 반환하고 다른 목표는 409를 반환한다. 이것은 무한 기간 exactly-once 보장이 아니다. 운영 규약에서는 서버/로봇의 영속 orderRevision·중복 제거 보존 기간을 합의해야 한다.

HTTP 202는 요청 접수이며 이동 완료가 아니다. ROS가 수락하면 EXECUTING, 실제 Action 결과 후에 SUCCEEDED/CANCELED/FAILED가 된다. 취소 전송 직후에는 CANCEL_REQUESTED이며 정지 확인을 뜻하지 않는다. 완료와 취소가 경합하면 실제 ROS 결과를 보존한다. ROS 결과를 알 수 없으면 UNCERTAIN으로 남겨 후속 이동을 막는다.

위치 1.5초, IPC heartbeat 2초 만료 시 취소를 요청한다. 명령 deadline도 wall monotonic clock으로 확인한다. ROS 시간이 멈춰도 watchdog은 동작한다. ROBATON 클라이언트는 위치·배터리의 신선도를 확인하고 네트워크 오류 중 임의 성공을 생성하지 않는다. 디스크 쓰기 실패 시 새 목표를 보내지 않으며 기존 목표에는 취소를 시도한다.

프로세스가 진행 중 명령을 남기고 재시작되면 자동 재전송하지 않는다. 로봇이 실제 정지했고 controller와 충돌하는 목표가 없음을 운영자가 확인한 뒤 한 번만 `acknowledge_recovery:=true`로 bridge를 시작해 journal을 정리한다. 이 인자를 상시 서비스 설정에 넣지 않는다. 필요하면 로봇 클라이언트의 resume도 별도로 수행한다. **프로세스 강제 종료, 전원 상실, ROS 통신 단절에서 물리적 정지를 보장하는 기능은 아니며, 로봇 자체의 독립 watchdog/안전 제어가 필요하다.**

정상 SIGINT/SIGTERM 종료에서는 HTTP 서비스를 닫고 활성 목표 취소를 요청한 뒤 ROS 통신을 최대 2초 더 유지해 실제 결과를 journal에 반영한다. 중복 종료 신호가 정리 작업을 중단하지 않는다. 이 시간 안에 결과를 확인하지 못하면 미확인 기록을 유지하며 다음 기동에서 복구 확인이 필요하다. SIGKILL·전원 상실·통신 장애에서 정지를 보장하지 않는다.
