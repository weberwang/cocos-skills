import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from init_workflow import initialize_workflow
from invalidate_artifacts import compute_invalidated_artifacts, invalidate_artifacts
from workflow_common import WorkflowError, read_yaml, write_yaml


class InvalidateArtifactsTests(unittest.TestCase):
    """验证失效只沿真实依赖传播，不扩大到无关产物。"""

    def test_transitive_invalidation_is_minimal(self) -> None:
        """验证变化产物仅使自身及其传递下游失效。"""
        artifacts = {
            "requirements": {"depends_on": [], "status": "passed"},
            "visual": {"depends_on": ["requirements"], "status": "passed"},
            "concept": {"depends_on": ["visual"], "status": "passed"},
            "code": {"depends_on": ["requirements"], "status": "passed"},
            "delivery": {"depends_on": ["concept", "code"], "status": "passed"},
            "unrelated-note": {"depends_on": [], "status": "passed"},
        }

        result = compute_invalidated_artifacts(artifacts, {"visual"})

        self.assertEqual(result, {"visual", "concept", "delivery"})

    def test_persisted_invalidation_marks_stale_without_deleting(self) -> None:
        """验证持久化仅标记状态并保留产物路径。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            workflow = read_yaml(state / "workflow.yaml")
            workflow["state"] = "production"
            workflow["run_status"] = "passed"
            workflow["transitions"] = [
                {
                    "from_state": "bootstrap", "to_state": "bootstrap",
                    "from_run_status": "pending", "to_run_status": "running",
                    "timestamp": "2026-07-12T00:00:00+00:00", "reason": "start",
                    "evidence": ["project-profile.yaml"],
                },
                {
                    "from_state": "bootstrap", "to_state": "bootstrap",
                    "from_run_status": "running", "to_run_status": "passed",
                    "timestamp": "2026-07-12T00:01:00+00:00", "reason": "verified",
                    "evidence": ["reports/mcp-capabilities.json"],
                },
                {
                    "from_state": "bootstrap", "to_state": "requirements",
                    "from_run_status": "passed", "to_run_status": "pending",
                    "timestamp": "2026-07-12T00:02:00+00:00", "reason": "next-stage",
                    "evidence": ["artifacts/requirements.yaml"],
                },
                {
                    "from_state": "requirements", "to_state": "requirements",
                    "from_run_status": "pending", "to_run_status": "running",
                    "timestamp": "2026-07-12T00:03:00+00:00", "reason": "start",
                    "evidence": ["tasks/requirements.yaml"],
                },
                {
                    "from_state": "requirements", "to_state": "requirements",
                    "from_run_status": "running", "to_run_status": "passed",
                    "timestamp": "2026-07-12T00:04:00+00:00", "reason": "verified",
                    "evidence": ["artifacts/requirements.yaml"],
                },
                {
                    "from_state": "requirements", "to_state": "visual-direction",
                    "from_run_status": "passed", "to_run_status": "pending",
                    "timestamp": "2026-07-12T00:05:00+00:00", "reason": "next-stage",
                    "evidence": ["artifacts/visual-direction.yaml"],
                },
                {
                    "from_state": "visual-direction", "to_state": "visual-direction",
                    "from_run_status": "pending", "to_run_status": "running",
                    "timestamp": "2026-07-12T00:06:00+00:00", "reason": "start",
                    "evidence": ["tasks/visual.yaml"],
                },
                {
                    "from_state": "visual-direction", "to_state": "visual-direction",
                    "from_run_status": "running", "to_run_status": "passed",
                    "timestamp": "2026-07-12T00:07:00+00:00", "reason": "verified",
                    "evidence": ["artifacts/visual-direction.yaml"],
                },
                {
                    "from_state": "visual-direction", "to_state": "planning",
                    "from_run_status": "passed", "to_run_status": "pending",
                    "timestamp": "2026-07-12T00:08:00+00:00", "reason": "next-stage",
                    "evidence": ["artifacts/implementation-plan.yaml"],
                },
                {
                    "from_state": "planning", "to_state": "planning",
                    "from_run_status": "pending", "to_run_status": "running",
                    "timestamp": "2026-07-12T00:09:00+00:00", "reason": "start",
                    "evidence": ["tasks/planning.yaml"],
                },
                {
                    "from_state": "planning", "to_state": "planning",
                    "from_run_status": "running", "to_run_status": "passed",
                    "timestamp": "2026-07-12T00:10:00+00:00", "reason": "verified",
                    "evidence": ["artifacts/implementation-plan.yaml"],
                },
                {
                    "from_state": "planning", "to_state": "production",
                    "from_run_status": "passed", "to_run_status": "pending",
                    "timestamp": "2026-07-12T00:14:00+00:00", "reason": "next-stage",
                    "evidence": ["tasks/production.yaml"],
                },
                {
                    "from_state": "production", "to_state": "production",
                    "from_run_status": "pending", "to_run_status": "running",
                    "timestamp": "2026-07-12T00:15:00+00:00", "reason": "start",
                    "evidence": ["tasks/production.yaml"],
                },
                {
                    "from_state": "production", "to_state": "production",
                    "from_run_status": "running", "to_run_status": "passed",
                    "timestamp": "2026-07-12T00:16:00+00:00", "reason": "verified",
                    "evidence": ["results/production.yaml"],
                },
            ]
            workflow["artifacts"] = {
                "visual": {
                    "depends_on": [],
                    "status": "passed",
                    "path": "artifacts/visual-direction.yaml",
                    "stage": "visual-direction",
                    "approval_gate": "visual-direction",
                    "task_ids": ["visual-task"],
                },
                "concept": {
                    "depends_on": ["visual"],
                    "status": "passed",
                    "path": "art/concepts/lobby.png",
                    "stage": "production",
                    "task_ids": ["concept-task"],
                },
                "unrelated": {
                    "depends_on": [],
                    "status": "passed",
                    "path": "notes/unrelated.md",
                },
            }
            workflow["task_status"] = {
                "visual-task": {"status": "passed", "artifact_ids": ["visual"]},
                "concept-task": {"status": "passed", "artifact_ids": ["concept"]},
                "unrelated-task": {"status": "passed", "artifact_ids": ["unrelated"]},
            }
            workflow["active_task_ids"] = ["visual-task", "concept-task"]
            workflow["completed_task_ids"] = ["visual-task", "concept-task", "unrelated-task"]
            workflow["approval_gates"].update(
                {
                    "visual-direction": {"status": "passed"},
                    "unrelated": {"status": "passed"},
                }
            )
            write_yaml(state / "results" / "visual-task.yaml", {"status": "passed"})
            write_yaml(state / "results" / "concept-task.yaml", {"status": "passed"})
            write_yaml(state / "workflow.yaml", workflow)

            changed = invalidate_artifacts(root, {"visual"})
            updated = read_yaml(state / "workflow.yaml")

            self.assertEqual(changed, {"visual", "concept"})
            self.assertEqual(updated["artifacts"]["concept"]["status"], "stale")
            self.assertEqual(updated["artifacts"]["concept"]["path"], "art/concepts/lobby.png")
            self.assertEqual(updated["artifacts"]["unrelated"]["status"], "passed")
            self.assertEqual(updated["task_status"]["visual-task"]["status"], "pending")
            self.assertEqual(updated["task_status"]["concept-task"]["status"], "pending")
            self.assertEqual(updated["task_status"]["unrelated-task"]["status"], "passed")
            self.assertFalse((state / "results" / "visual-task.yaml").exists())
            self.assertFalse((state / "results" / "concept-task.yaml").exists())
            self.assertNotIn("visual-direction", updated["approval_gates"])
            self.assertIn("unrelated", updated["approval_gates"])
            transition = updated["transitions"][-1]
            self.assertTrue(transition["timestamp"])
            self.assertEqual(transition["reason"], "upstream-change")
            self.assertEqual(transition["artifact_ids"], ["concept", "visual"])
            self.assertEqual(transition["from_state"], "production")
            self.assertEqual(transition["to_state"], "visual-direction")
            self.assertEqual(transition["from_run_status"], "stale")
            self.assertEqual(transition["to_run_status"], "pending")
            self.assertTrue(transition["evidence"])
            evidence_path = state / transition["evidence"][0]
            self.assertTrue(evidence_path.is_file())
            self.assertEqual(
                read_yaml(evidence_path)["rewind_state"], "visual-direction"
            )
            self.assertEqual(updated["state"], "visual-direction")
            self.assertEqual(updated["run_status"], "pending")
            self.assertEqual(updated["invalidated"][-1]["rewind_state"], "visual-direction")

    def test_persisted_invalidation_rejects_completed_workflow(self) -> None:
        """验证已交付完成的终态不接受未定义的就地失效操作。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            workflow = read_yaml(state / "workflow.yaml")
            workflow.update({"state": "completed", "run_status": "passed"})
            workflow["artifacts"] = {"requirements": {"depends_on": [], "status": "passed"}}
            write_yaml(state / "workflow.yaml", workflow)

            with self.assertRaises(WorkflowError):
                invalidate_artifacts(root, {"requirements"})

    def test_persisted_invalidation_rejects_unknown_artifact(self) -> None:
        """验证持久化 API 对未知产物 ID 抛出 WorkflowError。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )

            with self.assertRaises(WorkflowError):
                invalidate_artifacts(root, {"missing"})
