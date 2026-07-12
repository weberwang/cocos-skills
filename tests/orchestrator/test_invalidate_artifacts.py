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
            ]
            workflow["artifacts"] = {
                "visual": {
                    "depends_on": [],
                    "status": "passed",
                    "path": "art/visual-direction.yaml",
                },
                "concept": {
                    "depends_on": ["visual"],
                    "status": "passed",
                    "path": "art/concepts/lobby.png",
                },
                "unrelated": {
                    "depends_on": [],
                    "status": "passed",
                    "path": "notes/unrelated.md",
                },
            }
            write_yaml(state / "workflow.yaml", workflow)

            changed = invalidate_artifacts(root, {"visual"})
            updated = read_yaml(state / "workflow.yaml")

            self.assertEqual(changed, {"visual", "concept"})
            self.assertEqual(updated["artifacts"]["concept"]["status"], "stale")
            self.assertEqual(updated["artifacts"]["concept"]["path"], "art/concepts/lobby.png")
            self.assertEqual(updated["artifacts"]["unrelated"]["status"], "passed")
            transition = updated["transitions"][-1]
            self.assertTrue(transition["timestamp"])
            self.assertEqual(transition["reason"], "upstream-change")
            self.assertEqual(transition["artifact_ids"], ["concept", "visual"])
            self.assertEqual(transition["from_state"], "bootstrap")
            self.assertEqual(transition["to_state"], "bootstrap")
            self.assertEqual(transition["from_run_status"], "passed")
            self.assertEqual(transition["to_run_status"], "stale")
            self.assertTrue(transition["evidence"])
            self.assertEqual(updated["run_status"], "stale")

    def test_persisted_invalidation_rejects_unknown_artifact(self) -> None:
        """验证持久化 API 对未知产物 ID 抛出 WorkflowError。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )

            with self.assertRaises(WorkflowError):
                invalidate_artifacts(root, {"missing"})
