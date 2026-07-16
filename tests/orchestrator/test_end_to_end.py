import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
SKILL = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "SKILL.md"
sys.path.insert(0, str(SCRIPTS))

from workflow_common import read_yaml


class OrchestratorEndToEndTests(unittest.TestCase):
    """验证初始化、批准绑定、校验 CLI 与 Skill 路由形成完整闭环。"""

    def test_cli_initialization_produces_valid_approved_canonical_state(self) -> None:
        """验证 CLI 初始化的规范状态可直接通过校验且门禁绑定一致。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialized = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "init_workflow.py"),
                    str(root),
                    "--orientation", "portrait",
                    "--creator-version", "3.8.6",
                    "--approved-by", "human-reviewer",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            validated = subprocess.run(
                [sys.executable, str(SCRIPTS / "validate_workflow.py"), str(root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(initialized.returncode, 0, initialized.stderr)
            self.assertEqual(validated.returncode, 0, validated.stdout + validated.stderr)
            state = root / ".cocos-workflow"
            profile = read_yaml(state / "project-profile.yaml")
            workflow = read_yaml(state / "workflow.yaml")
            gate = workflow["approval_gates"]["project-configuration"]
            self.assertEqual(profile["approved_by"], "human-reviewer")
            self.assertEqual(gate["approved_by"], "human-reviewer")
            self.assertEqual(gate["subject_hash"], profile["content_hash"])

    def test_skill_uses_only_confirmed_stage_routes(self) -> None:
        """验证总控只路由到已确认的阶段 Skill 名称和交付入口模式。"""
        text = SKILL.read_text(encoding="utf-8")
        for obsolete in (
            "$cocos-project-bootstrap", "$cocos-requirements", "$cocos-visual-direction",
            "$cocos-scene-concepts", "$cocos-implementation-planning", "$cocos-production",
            "$cocos-editor-integration", "$cocos-chrome-verification", "$cocos-web-build",
            "$cocos-local-delivery",
        ):
            self.assertNotIn(obsolete, text)
        for expected in (
            "$cocos-define-game", "$cocos-design-game-systems", "$cocos-define-technical-design",
            "$cocos-freeze-visual-direction",
            "$cocos-create-visual-concept", "$cocos-plan-project",
            "$cocos-generate-game-assets", "$cocos-implement-game",
            "$cocos-integrate-assets", "$cocos-verify-game", "$cocos-deliver-web",
            "entry_mode=build", "entry_mode=package",
        ):
            self.assertIn(expected, text)

    def test_new_design_skills_and_vertical_slice_contract_exist(self) -> None:
        """验证新增设计阶段与垂直切片门禁均具有可调用契约。"""
        root = Path(__file__).parents[2] / "skills"
        for relative in (
            "cocos-design-game-systems/SKILL.md",
            "cocos-design-game-systems/references/systems-design-contract.md",
            "cocos-define-technical-design/SKILL.md",
            "cocos-define-technical-design/references/technical-design-contract.md",
            "cocos-verify-game/references/vertical-slice-contract.md",
        ):
            self.assertTrue((root / relative).is_file(), relative)

    def test_decision_change_grilling_gate_is_limited_to_selected_stages(self) -> None:
        """验证拷问门禁只约束四个决策性阶段，且总控负责写入门禁。"""
        root = Path(__file__).parents[2] / "skills"
        orchestrator = SKILL.read_text(encoding="utf-8")
        contracts = (
            root / "cocos-orchestrate-web-workflow" / "references" / "workflow-contracts.md"
        ).read_text(encoding="utf-8")

        for stage in ("requirements", "systems-design", "technical-design", "planning"):
            self.assertIn(stage, orchestrator)
        self.assertIn("$grilling", orchestrator)
        self.assertIn("grilling-<stage>", contracts)
        self.assertIn("总控是唯一可写入", contracts)

    def test_orchestrator_dispatches_business_flow_levels_in_order(self) -> None:
        """总控只能从低到高派发模块和页面实现任务。"""
        root = Path(__file__).parents[2] / "skills"
        orchestrator = SKILL.read_text(encoding="utf-8")
        contracts = (
            root / "cocos-orchestrate-web-workflow" / "references" / "workflow-contracts.md"
        ).read_text(encoding="utf-8")

        self.assertIn("业务流等级门禁", orchestrator)
        self.assertIn("completion_task_ids", orchestrator)
        self.assertIn("business_flow_level", contracts)


if __name__ == "__main__":
    unittest.main()
