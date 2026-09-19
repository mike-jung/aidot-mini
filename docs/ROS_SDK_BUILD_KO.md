# aidot-mini 0.5.1 ROS SDK 빌드

ROS SDK는 웹서버와 별도로 실행하는 ROS 어댑터의 설치 overlay다. ROS 배포판 전체, 내비게이션 플래너, Node 런타임을 중복 포함하지 않는다. ROS 1은 Noetic/Ubuntu 20.04, ROS 2는 Jazzy/Ubuntu 24.04를 기준으로 한다. Noetic은 지원 종료된 기존 장비의 호환 경로다. [ROS 공식 종료 공지](https://discourse.openrobotics.org/t/new-packages-for-noetic-2025-05-29-final/44003)

## 산출물 구분

| 파일 이름 | 내용 |
|---|---|
| `aidot-mini-0.5.1-ros1.tar.gz` | catkin 소스 workspace |
| `aidot-mini-0.5.1-ros2.tar.gz` | ament/colcon 소스 workspace |
| `aidot-mini-0.5.1-ros1-noetic-ubuntu20.04-x86_64-sdk.tar.gz` | Noetic에서 실제 빌드한 install overlay |
| `aidot-mini-0.5.1-ros2-jazzy-ubuntu24.04-x86_64-sdk.tar.gz` | Jazzy에서 실제 빌드한 install overlay |

`--compile`이 없으면 소스 묶음만 만든다. `--compile`은 빌드 성공 후 `install/`을 포함한 SDK 파일을 추가로 만든다. SDK 파일에는 Python 모듈, 실행 진입점, launch 파일, ROS 패키지 메타데이터와 `manifest.json`이 들어 있다. Python 어댑터이므로 C++ 실행 바이너리를 생성하지 않는다. manifest에는 소스·설치 파일 SHA-256, OS/CPU/Python/ROS 버전과 설치된 Debian 패키지 버전을 기록한다. ROS 2 setup.py의 버전은 package.xml에서 읽고, 생성한 두 패키지의 버전은 aidot-mini package.json에서 맞춘다.

## ROS 설치 없이 소스 묶음 만들기

전체 프로젝트 루트에서 실행한다. Python 3만 있으면 패키징할 수 있고, 아래 npm 명령은 같은 Python 빌더를 호출한다.

```bash
npm run build:ros -- --family all
# 같은 동작: python3 scripts/build-ros.py --family all
```

`dist/ros/` 아래 두 소스 tar.gz가 생성된다. `--family ros1` 또는 `ros2`로 한 종류만 만들고, `--output ./dist/robot-source`로 출력 위치를 선택할 수 있다. 소스 묶음만 받은 업체는 압축을 푼 폴더에서 다음을 실행한다. 아래 두 절차는 서로 다른 ROS 환경의 대안이다.

```bash
# Jazzy 소스 묶음을 받은 경우
tar -xzf aidot-mini-0.5.1-ros2.tar.gz
cd aidot-mini-0.5.1-ros2
. /opt/ros/jazzy/setup.bash
colcon build --merge-install
. install/setup.bash
ros2 launch aidot_mini_ros2 robot.launch.py
```

Noetic 소스 묶음은 `ros1` 파일을 풀고 `. /opt/ros/noetic/setup.bash`, `catkin_make install`, `. install/setup.bash`, `roslaunch aidot_mini_ros robot.launch` 순서다. 필요한 메시지·빌드 도구는 다음 절을 따른다. `--merge-install`은 하나의 install prefix에 설치한다. [colcon 공식 build 옵션](https://colcon.readthedocs.io/en/released/reference/verb/build.html)

## 대상 장비에서 빌드

ROS 자체 설치와 저장소 설정은 먼저 완료해야 한다. 다음 명령은 전체 프로젝트에서 SDK 아카이브를 만들 때 필요한 추가 의존성 예다.

```bash
# Ubuntu 24.04 / ROS 2 Jazzy 환경
sudo apt-get install python3-colcon-common-extensions \
  ros-jazzy-rclpy ros-jazzy-nav2-msgs ros-jazzy-geometry-msgs \
  ros-jazzy-sensor-msgs ros-jazzy-std-msgs ros-jazzy-launch-ros

# Ubuntu 20.04 / ROS 1 Noetic 환경: 별도 장비 또는 셸
sudo apt-get install cmake python3-setuptools ros-noetic-catkin \
  ros-noetic-rospy ros-noetic-actionlib ros-noetic-move-base-msgs \
  ros-noetic-geometry-msgs ros-noetic-sensor-msgs \
  ros-noetic-std-msgs ros-noetic-roslaunch
```

```bash
# ROS 1: catkin, rospy, actionlib, move_base_msgs, geometry_msgs,
# sensor_msgs, std_msgs, roslaunch, CMake와 Python 3가 필요하다.
. /opt/ros/noetic/setup.bash
python3 scripts/build-ros.py --family ros1 --compile

# ROS 2: ament_python, colcon, rclpy, nav2_msgs, geometry_msgs,
# sensor_msgs, std_msgs, launch_ros가 필요하다. 별도 셸에서 실행한다.
. /opt/ros/jazzy/setup.bash
python3 scripts/build-ros.py --family ros2 --compile
```

`--output`은 절대 경로로 정규화한다. 스크립트가 소유 표식을 남긴 동일 버전 workspace만 다시 생성하며, 출처가 다른 기존 디렉터리는 삭제하지 않는다. 이전 버전의 생성 폴더에는 표식이 없으므로 새 출력 폴더를 지정한다. 실패한 빌드를 성공으로 취급하지 않도록 명령의 종료 코드를 확인한다. 빌드 실패 시 같은 이름의 과거 SDK가 남아 있을 수 있으므로 stdout의 `compiled: true`와 현재 SHA-256도 확인한다.

## 빌드된 SDK 실행

SDK 압축을 실제 설치 위치에 풀고, 그 디렉터리에서 실행한다.

```bash
# Noetic
. /opt/ros/noetic/setup.bash
. install/setup.bash
roslaunch aidot_mini_ros robot.launch data_dir:="$HOME/.local/state/aidot-mini/robot"

# Jazzy: 별도 셸에서 실행한다.
. /opt/ros/jazzy/setup.bash
. install/setup.bash
ros2 launch aidot_mini_ros2 robot.launch.py data_dir:="$HOME/.local/state/aidot-mini/robot"
```

두 예제는 대안이며 동일 포트에서 동시에 실행하지 않는다. 기존 aidot-mini Linux 런타임은 `./bin/aidot-mini --robot`으로 실행한다. 같은 OS 계정에서 `ROS_BRIDGE_TOKEN_FILE`을 위 data_dir의 `bridge-token`으로 맞춘다. Topic, Action, frame과 서비스 설치는 [DEPLOY_ROS.md](DEPLOY_ROS.md)를 따른다.

x86_64 SDK는 다른 CPU나 Python ABI에 대한 검증을 대신하지 않는다. ARM64 로봇 보드는 해당 배포판에서 소스 workspace를 빌드한다. 순수 Python 어댑터여도 rclpy와 ROS 메시지 지원 라이브러리는 대상 아키텍처에 맞아야 한다.

## 격리된 환경에서 재현

`deploy/ros/qa/Dockerfile.noetic`, `Dockerfile.jazzy`는 공식 이미지 digest를 고정한다. apt 의존성은 빌드 시점 저장소에서 설치하고 그 정확한 버전을 manifest에 기록하므로 저장소가 바뀐 뒤에도 바이트 단위로 동일한 이미지가 나온다고 보장하지 않는다.

프로젝트 루트에서 다음 예제를 실행한다. `LINUX_RELEASE`는 기존 Linux x64 배포 파일을 풀어 놓은 절대 경로다. Docker 명령에 `--privileged`, 호스트 네트워크, 실물 ROS 연결이나 포트 공개를 추가하지 않는다.

```bash
docker build -t aidot-mini-ros-sdk:0.5.1-noetic -f deploy/ros/qa/Dockerfile.noetic .
mkdir -p dist/ros-qa/noetic
docker run --rm --network none \
  -e AIDOT_ISOLATED_ROS_QA=1 \
  -e AIDOT_ROS_BASE_IMAGE=ros:noetic-ros-base-focal@sha256:72b8bc59035dc0a5b8e07aae28c16caa84192971d72d207c72ed734fb1d5e97d \
  -v "$PWD:/source:ro" -v "$PWD/dist/ros-qa/noetic:/out" \
  -v "$LINUX_RELEASE:/linux-release:ro" \
  aidot-mini-ros-sdk:0.5.1-noetic bash -c \
  'python3 /source/tests/ros/verify_sdk.py --output /out --node /linux-release/runtime/bin/node --node-modules /linux-release/app/node_modules'
```

Jazzy는 Dockerfile·이미지 태그·출력 디렉터리를 `jazzy`로 바꾸고 `AIDOT_ROS_BASE_IMAGE`를 Jazzy Dockerfile 첫 줄의 이미지로 맞춘다. 두 컨테이너는 네트워크를 차단한 독립 환경에서 각각 실행한다. 컨테이너 entrypoint가 해당 ROS underlay를 설정한다.

검증기는 새 SDK를 빌드하고 다른 임시 경로로 압축을 푼 뒤 원래 빌드 workspace를 삭제한다. 설치 파일 해시·패키지 버전·설치 경로 import를 검사하고, 실제 `roslaunch`/`ros2 launch`로 실행한다. 기존 12개 장애 단위 시험, 실제 ROS 통신 11개, mini HTTP와 JavaScript 드라이버를 통한 8개 연동 시험과 종료 신호 2개 시험을 수행하고 결과·로그를 `/out/evidence`에 남긴다. 이동·취소·deadline·heartbeat 단절을 확인하지만 시험용 내비게이션 서버를 사용하므로 실물 구동·물리 정지·운영 Nav2 플래너 검증을 뜻하지 않는다. 0.5.0에서 수행한 실제 ROS 실행 이력은 `VALIDATION_ROS_SDK_V050.md`에 있다. 현재 0.5.1은 `VALIDATION_V051.md`를 따른다. 이번 환경에는 설치된 ROS와 컨테이너 엔진이 없어 SDK compile/launch는 재실행하지 않았다. 소스 키트 생성과 `npm run test:ros`의 12개 단위 검사를 실행했다.
