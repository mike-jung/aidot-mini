from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from pathlib import Path

def generate_launch_description():
    defaults={'navigation_action':'navigate_to_pose','pose_topic':'amcl_pose','battery_topic':'battery_state','map_frame':'map',
              'bridge_port':'8912','data_dir':str(Path.home()/'.local/state/aidot-mini/robot'),'acknowledge_recovery':'false'}
    parameters={key:LaunchConfiguration(key) for key in defaults}
    parameters['bridge_port']=ParameterValue(LaunchConfiguration('bridge_port'),value_type=int)
    parameters['acknowledge_recovery']=ParameterValue(LaunchConfiguration('acknowledge_recovery'),value_type=bool)
    return LaunchDescription([DeclareLaunchArgument(k,default_value=v) for k,v in defaults.items()]+[
        Node(package='aidot_mini_ros2',executable='aidot_robot_bridge',name='aidot_robot_bridge',output='screen',parameters=[parameters])])
