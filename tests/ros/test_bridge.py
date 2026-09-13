"""Failure-focused tests; run with python3 -m unittest discover -s tests/ros."""
import json
from pathlib import Path
import tempfile
import sys
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'deploy/ros/common'))
from aidot_bridge.core import BridgeCore, BridgeError, load_token

class Driver:
    def __init__(self): self.calls=0;self.cancels=0
    def available(self): return True
    def navigate(self,goal,report): self.calls+=1;self.report=report;report('EXECUTING')
    def cancel(self): self.cancels+=1

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.file=Path(self.tmp.name)/'journal.json'
        self.driver=Driver();self.core=BridgeCore(self.driver,self.file)
        self.core.update_pose(0,0,0,'map');self.core.update_battery(0.7)
        self.goal={'commandId':'job-1','x':1,'y':0}
    def tearDown(self): self.tmp.cleanup()
    def test_duplicate_and_conflicting_id(self):
        self.core.navigate(self.goal);self.core.navigate(dict(self.goal,x=1.0))
        self.assertEqual(self.driver.calls,1)
        with self.assertRaises(BridgeError) as error:self.core.navigate(dict(self.goal,x=2))
        self.assertEqual(error.exception.status,409)
    def test_cancel_is_not_completion(self):
        self.core.navigate(self.goal);self.core.cancel('job-1')
        self.assertEqual(self.core.snapshot()['active']['state'],'CANCEL_REQUESTED')
        self.driver.report('EXECUTING');self.assertEqual(self.core.snapshot()['active']['state'],'CANCEL_REQUESTED')
        self.driver.report('CANCELED');self.assertIsNone(self.core.snapshot()['active'])
        self.assertEqual(self.core.snapshot()['lastCommand']['state'],'CANCELED')
    def test_success_racing_cancel_is_not_fabricated_cancellation(self):
        self.core.navigate(self.goal);self.core.cancel();self.driver.report('SUCCEEDED')
        self.assertEqual(self.core.snapshot()['lastCommand']['state'],'SUCCEEDED')
    def test_restart_requires_reconciliation_and_does_not_send(self):
        self.core.navigate(self.goal);driver=Driver();restored=BridgeCore(driver,self.file)
        self.assertTrue(restored.snapshot()['recoveryRequired']);self.assertEqual(driver.calls,0)
        with self.assertRaises(BridgeError):restored.navigate(dict(self.goal,commandId='job-2'))
    def test_journal_failure_prevents_dispatch(self):
        with patch.object(self.core,'save',side_effect=OSError('disk full')):
            with self.assertRaises(BridgeError):self.core.navigate(self.goal)
        self.assertEqual(self.driver.calls,0);self.assertTrue(self.core.storage_fault)
    def test_disk_failure_does_not_prevent_cancel(self):
        self.core.navigate(self.goal)
        with patch.object(self.core,'save',side_effect=OSError('disk full')):self.core.cancel()
        self.assertGreater(self.driver.cancels,0);self.assertTrue(self.core.recovery_required)
    def test_deadline_requires_ros_result(self):
        self.core.navigate(self.goal);self.core.deadline=time.monotonic()-1;self.core.watchdog()
        self.assertEqual(self.core.snapshot()['active']['state'],'CANCEL_REQUESTED')
        self.driver.report('CANCELED');self.assertEqual(self.core.snapshot()['lastCommand']['state'],'TIMED_OUT')
    def test_missing_heartbeat_requests_cancel(self):
        self.core.navigate(self.goal);self.core.contact_at-=3;self.core.watchdog()
        self.assertEqual(self.driver.cancels,1)
        self.assertIn('heartbeat',self.core.snapshot()['active']['reason'])
    def test_stale_pose_rejects_goal_and_cancels_active(self):
        self.core.pose_at-=3
        with self.assertRaises(BridgeError):self.core.navigate(self.goal)
        self.core.update_pose(0,0,0,'map');self.core.navigate(self.goal);self.core.pose_at-=3;self.core.watchdog()
        self.assertEqual(self.driver.cancels,1)
    def test_unknown_outcome_blocks_following_goal(self):
        self.core.navigate(self.goal);self.driver.report('UNCERTAIN')
        self.assertTrue(self.core.snapshot()['recoveryRequired']);self.assertIsNotNone(self.core.snapshot()['active'])
    def test_bounds_frame_and_unexpected_fields(self):
        for goal in [dict(self.goal,x=float('nan')),dict(self.goal,x=True),dict(self.goal,frameId='odom'),dict(self.goal,velocity=10)]:
            with self.assertRaises(BridgeError):self.core.navigate(goal)
        self.assertEqual(self.driver.calls,0)
    def test_private_token_and_no_symlink(self):
        token=Path(self.tmp.name)/'token';self.assertEqual(load_token(token),load_token(token))
        token.chmod(0o644)
        with self.assertRaises(ValueError):load_token(token)
        token.chmod(0o600);link=Path(self.tmp.name)/'link';link.symlink_to(token)
        with self.assertRaises(ValueError):load_token(link)

if __name__=='__main__':unittest.main()
