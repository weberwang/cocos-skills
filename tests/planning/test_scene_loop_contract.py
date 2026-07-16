"""验证实施计划按场景组织小循环。"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
PLAN_SKILL = ROOT / "skills" / "cocos-plan-project" / "SKILL.md"
PLAN_CONTRACT = ROOT / "skills" / "cocos-plan-project" / "references" / "implementation-plan-contract.md"
INTEGRATE_SKILL = ROOT / "skills" / "cocos-integrate-assets" / "SKILL.md"
VERIFY_SKILL = ROOT / "skills" / "cocos-verify-game" / "SKILL.md"


class SceneLoopContractTest(unittest.TestCase):
    """确保每个场景以可验证的小循环交付。"""

    def test_plan_declares_scene_loops(self) -> None:
        """规划必须定义按场景的循环任务和退出门禁。"""
        self.assertIn("场景小循环", PLAN_SKILL.read_text(encoding="utf-8"))
        contract = PLAN_CONTRACT.read_text(encoding="utf-8")
        self.assertIn("scene_loops", contract)
        self.assertIn("scene_id", contract)
        self.assertIn("business_flow_level", contract)
        self.assertIn("business_flow_levels", contract)
        self.assertIn("exit_checks", contract)
        self.assertIn("global_scaffold", contract)
        self.assertIn("global_scaffold_task_id", contract)
        self.assertIn("pencil-draft", contract)
        self.assertIn("visual-concept", contract)
        self.assertIn("两张参考效果图", contract)

    def test_integration_and_verification_consume_scene_loop(self) -> None:
        """集成和验证均须以场景循环为最小交付单位。"""
        self.assertIn("scene_loop_id", INTEGRATE_SKILL.read_text(encoding="utf-8"))
        self.assertIn("scene_loop_id", VERIFY_SKILL.read_text(encoding="utf-8"))

    def test_global_scaffold_precedes_scene_loops(self) -> None:
        """全局骨架须在任一场景循环前通过。"""
        plan = PLAN_SKILL.read_text(encoding="utf-8")
        self.assertIn("global scaffold code task", plan)
        self.assertIn("global_scaffold", plan)
        self.assertIn("pencil-draft → visual-concept", plan)
