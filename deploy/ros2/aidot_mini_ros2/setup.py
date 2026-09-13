from setuptools import setup, find_packages
from pathlib import Path
from xml.etree import ElementTree
version = ElementTree.parse(Path(__file__).with_name('package.xml')).findtext('version')
setup(name='aidot_mini_ros2',version=version,packages=find_packages(),
      data_files=[('share/ament_index/resource_index/packages',['resource/aidot_mini_ros2']),
                  ('share/aidot_mini_ros2',['package.xml']),('share/aidot_mini_ros2/launch',['launch/robot.launch.py'])],
      install_requires=['setuptools'],zip_safe=True,maintainer='AiDot',maintainer_email='support@example.invalid',
      description='AiDot ROS 2 robot client bridge',license='Apache-2.0',
      entry_points={'console_scripts':['aidot_robot_bridge = aidot_bridge.ros2:main']})
