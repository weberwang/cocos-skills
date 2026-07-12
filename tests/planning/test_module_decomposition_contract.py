"""验证实施计划包含独立的模块拆分任务。"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "skills" / "cocos-plan-project" / "SKILL.md"
CONTRACT = ROOT / "skills" / "cocos-plan-project" / "references" / "implementation-plan-contract.md"
IMPLEMENT = ROOT / "skills" / "cocos-implement-game" / "SKILL.md"


class ModuleDecompositionContractTest(unittest.TestCase):
    """确保模块边界先于代码任务被批准。"""

    def test_plan_requires_module_decomposition_task(self) -> None:
        """规划 Skill 必须将模块拆分作为独立任务。"""
        self.assertIn("模块拆分任务", SKILL.read_text(encoding="utf-8"))
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertIn("module_decomposition", contract)
        self.assertIn("module_ids", contract)
        self.assertIn("dependency_graph", contract)

    def test_implementation_depends_on_approved_modules(self) -> None:
        """代码实现只能消费已批准的模块拆分结果。"""
        self.assertIn("module_decomposition", IMPLEMENT.read_text(encoding="utf-8"))
        self.assertIn("approved", IMPLEMENT.read_text(encoding="utf-8"))
