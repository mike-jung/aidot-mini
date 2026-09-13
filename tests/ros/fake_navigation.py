"""Test-only navigation server: real ROS transport/actions, simulated movement.

Never run on a physical robot; use an isolated ROS master/domain.
"""
import argparse
import math
import threading
import time

p=argparse.ArgumentParser();p.add_argument('family',choices=['ros1','ros2']);args=p.parse_args()
class Simulation:
    def __init__(self):self.x=-4.;self.y=-1.;self.lock=threading.Lock()
    def step(self,x,y):
        with self.lock:
            distance=math.hypot(x-self.x,y-self.y);step=min(distance,0.021)
            if distance:self.x+=(x-self.x)*step/distance;self.y+=(y-self.y)*step/distance
            return distance<=0.005
sim=Simulation()

if args.family=='ros1':
    import rospy
    import actionlib
    from move_base_msgs.msg import MoveBaseAction,MoveBaseResult,MoveBaseFeedback
    from geometry_msgs.msg import PoseWithCovarianceStamped
    from sensor_msgs.msg import BatteryState
    rospy.init_node('aidot_test_navigation')
    pose=rospy.Publisher('amcl_pose',PoseWithCovarianceStamped,queue_size=1)
    battery=rospy.Publisher('battery_state',BatteryState,queue_size=1)
    def publish(_):
        message=PoseWithCovarianceStamped();message.header.frame_id='map';message.header.stamp=rospy.Time.now()
        with sim.lock:message.pose.pose.position.x=sim.x;message.pose.pose.position.y=sim.y
        message.pose.pose.orientation.w=1.;pose.publish(message)
        message=BatteryState();message.percentage=.75;battery.publish(message)
    timer=rospy.Timer(rospy.Duration(.05),publish)
    def execute(goal):
        while not rospy.is_shutdown():
            if server.is_preempt_requested():server.set_preempted(MoveBaseResult());return
            if sim.step(goal.target_pose.pose.position.x,goal.target_pose.pose.position.y):server.set_succeeded(MoveBaseResult());return
            feedback=MoveBaseFeedback();feedback.base_position.header.frame_id='map'
            with sim.lock:feedback.base_position.pose.position.x=sim.x;feedback.base_position.pose.position.y=sim.y
            server.publish_feedback(feedback);time.sleep(.03)
    server=actionlib.SimpleActionServer('move_base',MoveBaseAction,execute_cb=execute,auto_start=False);server.start()
    print('READY ROS1 test navigation',flush=True);rospy.spin()
else:
    import rclpy
    from rclpy.node import Node
    from rclpy.action import ActionServer,CancelResponse,GoalResponse
    from rclpy.callback_groups import ReentrantCallbackGroup
    from rclpy.executors import MultiThreadedExecutor
    from rclpy.qos import qos_profile_sensor_data
    from nav2_msgs.action import NavigateToPose
    from geometry_msgs.msg import PoseWithCovarianceStamped
    from sensor_msgs.msg import BatteryState
    rclpy.init();node=Node('aidot_test_navigation');group=ReentrantCallbackGroup()
    pose=node.create_publisher(PoseWithCovarianceStamped,'amcl_pose',qos_profile_sensor_data)
    battery=node.create_publisher(BatteryState,'battery_state',qos_profile_sensor_data)
    def publish():
        message=PoseWithCovarianceStamped();message.header.frame_id='map';message.header.stamp=node.get_clock().now().to_msg()
        with sim.lock:message.pose.pose.position.x=sim.x;message.pose.pose.position.y=sim.y
        message.pose.pose.orientation.w=1.;pose.publish(message)
        message=BatteryState();message.percentage=.75;battery.publish(message)
    node.create_timer(.05,publish,callback_group=group)
    def execute(goal):
        while rclpy.ok():
            if goal.is_cancel_requested:goal.canceled();return NavigateToPose.Result()
            if sim.step(goal.request.pose.pose.position.x,goal.request.pose.pose.position.y):goal.succeed();return NavigateToPose.Result()
            feedback=NavigateToPose.Feedback();feedback.current_pose.header.frame_id='map'
            with sim.lock:feedback.current_pose.pose.position.x=sim.x;feedback.current_pose.pose.position.y=sim.y
            goal.publish_feedback(feedback);time.sleep(.03)
        return NavigateToPose.Result()
    server=ActionServer(node,NavigateToPose,'navigate_to_pose',execute_callback=execute,
                        goal_callback=lambda _:GoalResponse.ACCEPT,cancel_callback=lambda _:CancelResponse.ACCEPT,callback_group=group)
    executor=MultiThreadedExecutor(num_threads=4);executor.add_node(node)
    print('READY ROS2 test navigation',flush=True)
    try:executor.spin()
    except KeyboardInterrupt:pass
    finally:executor.shutdown();node.destroy_node();rclpy.try_shutdown()
