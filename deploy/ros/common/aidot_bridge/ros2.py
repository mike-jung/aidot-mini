"""ROS 2 Nav2 NavigateToPose adapter, compatible with the standard action contract."""
import json
import math
import os
import time
from pathlib import Path
from .core import BridgeCore, BridgeHttp
from .lifecycle import shutdown_requested

def main(args=None):
    import rclpy
    from rclpy.node import Node
    from rclpy.action import ActionClient
    from rclpy.clock import Clock, ClockType
    from rclpy.qos import QoSProfile, ReliabilityPolicy
    from rclpy.signals import SignalHandlerOptions
    from nav2_msgs.action import NavigateToPose
    from geometry_msgs.msg import PoseWithCovarianceStamped
    from sensor_msgs.msg import BatteryState
    from std_msgs.msg import String
    rclpy.init(args=args,signal_handler_options=SignalHandlerOptions.NO);node=Node('aidot_robot_bridge')
    defaults={'navigation_action':'navigate_to_pose','pose_topic':'amcl_pose','battery_topic':'battery_state','map_frame':'map','bridge_port':8912,
              'data_dir':os.environ.get('AIDOT_ROBOT_DATA_DIR',str(Path.home()/'.local/state/aidot-mini/robot')),'acknowledge_recovery':False}
    for key,value in defaults.items(): node.declare_parameter(key,value)
    config=lambda key:node.get_parameter(key).value
    class Driver:
        def __init__(self):
            self.client=ActionClient(node,NavigateToPose,config('navigation_action'));self.handle=None;self.cancel_requested=False
        def available(self): return self.client.server_is_ready()
        def navigate(self,goal,report):
            self.handle=None;self.cancel_requested=False
            message=NavigateToPose.Goal();message.pose.header.frame_id=goal['frameId'];message.pose.header.stamp=node.get_clock().now().to_msg()
            message.pose.pose.position.x=float(goal['x']);message.pose.pose.position.y=float(goal['y'])
            message.pose.pose.orientation.z=math.sin(goal['yaw']/2);message.pose.pose.orientation.w=math.cos(goal['yaw']/2)
            def finished(future):
                try:
                    result=future.result();state={4:'SUCCEEDED',5:'CANCELED',6:'FAILED'}.get(result.status,'UNCERTAIN')
                    if state=='SUCCEEDED' and getattr(result.result,'error_code',0)!=0:state='FAILED'
                    report(state,f'ROS action status {result.status}, error {getattr(result.result,"error_code",0)}')
                except Exception: report('UNCERTAIN','ROS result could not be confirmed')
            def accepted(future):
                try:
                    self.handle=future.result()
                    if not self.handle.accepted: report('FAILED','Navigation goal rejected');return
                    report('EXECUTING');self.handle.get_result_async().add_done_callback(finished)
                    if self.cancel_requested:self.handle.cancel_goal_async()
                except Exception:report('UNCERTAIN','ROS goal acceptance could not be confirmed')
            self.client.send_goal_async(message).add_done_callback(accepted)
        def cancel(self):
            self.cancel_requested=True
            if self.handle is not None and self.handle.accepted:self.handle.cancel_goal_async()
    directory=Path(config('data_dir'));driver=Driver()
    core=BridgeCore(driver,directory/'ros-command-journal.json',frame=config('map_frame'),acknowledge_recovery=config('acknowledge_recovery'))
    core.runtime={'family':'ros2','distribution':os.environ.get('ROS_DISTRO',''),
                  'navigationAction':config('navigation_action'),'poseTopic':node.resolve_topic_name(config('pose_topic')),
                  'batteryTopic':node.resolve_topic_name(config('battery_topic'))}
    def pose(message):
        p=message.pose.pose;q=p.orientation;yaw=math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z))
        core.update_pose(p.position.x,p.position.y,yaw,message.header.frame_id)
    sensor_qos=QoSProfile(depth=1,reliability=ReliabilityPolicy.BEST_EFFORT)
    node.create_subscription(PoseWithCovarianceStamped,config('pose_topic'),pose,sensor_qos)
    node.create_subscription(BatteryState,config('battery_topic'),lambda m:core.update_battery(m.percentage),sensor_qos)
    publisher=node.create_publisher(String,'~/state',1)
    node.create_timer(1,lambda:publisher.publish(String(data=json.dumps(core.snapshot()))),clock=Clock(clock_type=ClockType.STEADY_TIME))
    http=BridgeHttp(core,directory/'bridge-token',config('bridge_port'));http.start()
    with shutdown_requested() as stopping:
        node.get_logger().info(f'AiDot robot bridge is listening on loopback port {http.server.server_port}')
        try:
            while rclpy.ok() and not stopping.is_set():rclpy.spin_once(node,timeout_sec=.2)
        except (KeyboardInterrupt,rclpy.executors.ExternalShutdownException):pass
        finally:
            try:
                http.close()
                # The context must remain alive until a cancellation result can arrive.
                deadline=time.monotonic()+2
                while core.snapshot()['active'] and rclpy.ok() and time.monotonic()<deadline:rclpy.spin_once(node,timeout_sec=.05)
                if core.snapshot()['active']:node.get_logger().warning('Navigation outcome remains unconfirmed during shutdown')
            finally:
                node.destroy_node();rclpy.try_shutdown()

if __name__=='__main__':main()
