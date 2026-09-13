# ROS 1 and ROS 2 integration

Deploy the aidot-mini server, robot client and ROS bridge as separate processes.
The bridge calls the robot's existing navigation action and reads telemetry.
The robot vendor supplies navigation, localization, motor control and independent
safety controls. This adapter does not implement docking, lifts or charging.

## Robot interface

| Setting | ROS 1 | ROS 2 |
|---|---|---|
| Navigation action | `move_base_msgs/MoveBaseAction`, `move_base` | `nav2_msgs/action/NavigateToPose`, `navigate_to_pose` |
| Pose | `geometry_msgs/PoseWithCovarianceStamped`, `amcl_pose` | Same message and default topic |
| Battery | `sensor_msgs/BatteryState`, `battery_state` | Same message and default topic |
| Map frame | `map` | `map` |
| Cancellation | Implement action cancellation on the robot | Implement action cancellation on the robot |

Battery percentage is 0..1. Supply periodic localization in the configured frame,
including while stationary. The bridge does not perform TF conversion. Pose age
measures time since receipt, not source timestamp accuracy. ROS 2 subscriptions
use BEST_EFFORT/KEEP_LAST 1; configure the robot's domain, namespace and topics.

## Build source kits

From the Full or Public project, with Python 3 installed:

```sh
npm run build:ros -- --family all
```

This creates `dist/ros/aidot-mini-1.0.1-ros1.tar.gz` and
`dist/ros/aidot-mini-1.0.1-ros2.tar.gz`. Source kits are not compiled SDKs.
They include the bridge and installation guide; Node and the base ROS distribution
are installed separately. Node is not required by the Python ROS bridge itself.

## Compile and launch ROS 2

Use a host with the intended ROS 2 SDK, `colcon`, `rclpy`, `nav2_msgs`,
`geometry_msgs`, `sensor_msgs`, `std_msgs` and `launch_ros`. For a Jazzy installation:

```sh
. /opt/ros/jazzy/setup.sh
python3 scripts/build-ros.py --family ros2 --compile
. dist/ros/aidot-mini-1.0.1-ros2/install/setup.sh
ros2 launch aidot_mini_ros2 robot.launch.py navigation_action:=navigate_to_pose pose_topic:=amcl_pose battery_topic:=battery_state map_frame:=map
```

`--compile` also creates an installed SDK archive with the ROS distribution,
OS and architecture in its filename. Its manifest records the build environment.
Use an installed SDK only on a matching OS/CPU/ROS/Python environment; otherwise
build from source on the target. Start the robot's Nav2 server separately.

## Compile and launch ROS 1

ROS 1 support is for existing Noetic installations. Use a sourced Noetic SDK
with `rospy`, `actionlib`, `move_base_msgs`, the telemetry messages and `roslaunch`:

```sh
. /opt/ros/noetic/setup.sh
python3 scripts/build-ros.py --family ros1 --compile
. dist/ros/aidot-mini-1.0.1-ros1/install/setup.sh
roslaunch aidot_mini_ros robot.launch navigation_action:=move_base pose_topic:=amcl_pose battery_topic:=battery_state map_frame:=map
```

Match ROS master and advertised network settings to the robot. Do not expose
the ROS graph as a general remote control API.

## Connect the robot client

The included fleet transport implements the explicit `robaton-demo-v050` contract,
not a universal production fleet protocol. It uses the demo robot identifiers,
map and route constraints. Adapt the transport to your deployment's agreed order
and state protocol before operating a different map or fleet.

```sh
export DATA_DIR=/var/lib/aidot-mini
export ROBOT_PROTOCOL=robaton-demo-v050
export ROBOT_ID=amr-a
export ROBATON_URL=https://fleet.example.internal
export ROBATON_API_TOKEN='<issued-token>'
export ROS_BRIDGE_TOKEN_FILE=/var/lib/aidot-mini/robot/bridge-token
node modules/robot-client/main.mjs
```

Configure the bridge to read the same token file. Packaged Linux installations
can run `./bin/aidot-mini --robot`. The console's robot tab provides configuration,
state, diagnostics, hold and resume controls. Resume requires confirmation that
the robot is stopped and no conflicting goal remains.

The IPC listener is restricted to `127.0.0.1:8912` and requires the bridge token.
It exposes state, navigation and cancellation operations, not arbitrary shell or
ROS topic access. Diagnostic GET requests do not renew the control heartbeat.

## Lifecycle and recovery

Templates under `deploy/robot/` coordinate the server and bridge with systemd.
Configure the ROS environment, overlay, topics and token file in `ros.env`.
The two processes can share a dedicated non-root account. Do not run ROS 1 and
ROS 2 bridges on the same port. Install a VPN client independently of these
processes; use its managed network endpoint as the fleet URL.

HTTP 202 means accepted for processing, not completed movement. ROS action
results determine SUCCEEDED, CANCELED or FAILED. A cancellation request is not
proof of a physical stop. Uncertain outcomes block another goal until recovery.

The bridge retains the latest 128 command records for bounded duplicate handling.
Expired pose/heartbeat/deadline conditions request cancellation. On restart with
an unfinished command, confirm the physical state before one-time recovery with
`acknowledge_recovery:=true`; do not leave that option enabled permanently.
Process crashes, power loss and ROS disconnection require the robot's independent
watchdog and safety control. Verify these behaviors on the actual robot.
