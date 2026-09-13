"""ROS 1 move_base action adapter. No synthetic pose or success reports."""
import json
import math
import os
from pathlib import Path
import threading
import time
from .core import BridgeCore, BridgeHttp
from .lifecycle import shutdown_requested

def main():
    import rospy
    import actionlib
    from move_base_msgs.msg import MoveBaseAction, MoveBaseGoal
    from geometry_msgs.msg import PoseWithCovarianceStamped
    from sensor_msgs.msg import BatteryState
    from std_msgs.msg import String
    rospy.init_node('aidot_robot_bridge',disable_signals=True)
    class Driver:
        def __init__(self):
            self.client=actionlib.SimpleActionClient(rospy.get_param('~navigation_action','move_base'),MoveBaseAction)
            self.ready=False;self.checked_at=0
            # actionlib timeouts use ROS time, which can pause under /use_sim_time.
            # Keep that wait outside the IPC/watchdog lock and expire cached readiness.
            def check():
                while not rospy.is_shutdown():
                    self.ready=self.client.wait_for_server(rospy.Duration(0.25));self.checked_at=time.monotonic();time.sleep(0.2)
            threading.Thread(target=check,daemon=True).start()
        def available(self): return self.ready and time.monotonic()-self.checked_at<1.5
        def navigate(self,goal,report):
            message=MoveBaseGoal();message.target_pose.header.frame_id=goal['frameId'];message.target_pose.header.stamp=rospy.Time.now()
            message.target_pose.pose.position.x=goal['x'];message.target_pose.pose.position.y=goal['y']
            message.target_pose.pose.orientation.z=math.sin(goal['yaw']/2);message.target_pose.pose.orientation.w=math.cos(goal['yaw']/2)
            def done(status,result):
                report({3:'SUCCEEDED',2:'CANCELED',8:'CANCELED',4:'FAILED',5:'FAILED'}.get(status,'UNCERTAIN'),f'ROS action status {status}')
            self.client.send_goal(message,done_cb=done,active_cb=lambda:report('EXECUTING'))
        def cancel(self): self.client.cancel_goal()
    directory=Path(rospy.get_param('~data_dir',os.environ.get('AIDOT_ROBOT_DATA_DIR',str(Path.home()/'.local/state/aidot-mini/robot'))))
    core=BridgeCore(Driver(),directory/'ros-command-journal.json',frame=rospy.get_param('~map_frame','map'),acknowledge_recovery=rospy.get_param('~acknowledge_recovery',False))
    core.runtime={'family':'ros1','distribution':os.environ.get('ROS_DISTRO',''),
                  'navigationAction':rospy.resolve_name(rospy.get_param('~navigation_action','move_base')),
                  'poseTopic':rospy.resolve_name(rospy.get_param('~pose_topic','amcl_pose')),
                  'batteryTopic':rospy.resolve_name(rospy.get_param('~battery_topic','battery_state'))}
    def pose(message):
        p=message.pose.pose;q=p.orientation;yaw=math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z))
        core.update_pose(p.position.x,p.position.y,yaw,message.header.frame_id)
    rospy.Subscriber(rospy.get_param('~pose_topic','amcl_pose'),PoseWithCovarianceStamped,pose,queue_size=1)
    rospy.Subscriber(rospy.get_param('~battery_topic','battery_state'),BatteryState,lambda m:core.update_battery(m.percentage),queue_size=1)
    publisher=rospy.Publisher('~state',String,queue_size=1,latch=True)
    http=BridgeHttp(core,directory/'bridge-token',rospy.get_param('~bridge_port',8912));http.start()
    stopped=threading.Event()
    def status_loop():
        while not stopped.wait(1): publisher.publish(String(data=json.dumps(core.snapshot())))
    worker=threading.Thread(target=status_loop,daemon=True);worker.start()
    with shutdown_requested() as stopping:
        rospy.loginfo('AiDot robot bridge is listening on loopback port %s',http.server.server_port)
        try:
            while not rospy.is_shutdown() and not stopping.wait(.2):pass
        finally:
            stopped.set()
            try:
                http.close();worker.join(2)
                # Keep ROS callbacks alive briefly to persist a real cancellation result.
                deadline=time.monotonic()+2
                while core.snapshot()['active'] and not rospy.is_shutdown() and time.monotonic()<deadline:time.sleep(.05)
                if core.snapshot()['active']:rospy.logwarn('Navigation outcome remains unconfirmed during shutdown')
            finally:rospy.signal_shutdown('AiDot robot bridge stopped')

if __name__=='__main__': main()
