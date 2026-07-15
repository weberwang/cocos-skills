"""验证 Cocos 定义游戏 Skill 的静态契约。"""

from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SKILL_PATH = REPOSITORY_ROOT / "skills" / "cocos-define-game" / "SKILL.md"
CONTRACT_PATH = (
    REPOSITORY_ROOT
    / "skills"
    / "cocos-define-game"
    / "references"
    / "requirements-contract.md"
)
SCENARIO_PATH = (
    REPOSITORY_ROOT
    / "tests"
    / "scenarios"
    / "define-game"
    / "ambiguous-mobile-brief.md"
)


class DefineGameSkillContractTest(unittest.TestCase):
    """验证需求定义阶段的边界和必填字段。"""

    def test_skill_has_required_boundaries(self) -> None:
        """Skill 必须保留总控、写入限制和人工批准门禁。"""
        skill = SKILL_PATH.read_text(encoding="utf-8")

        self.assertIn("cocos-orchestrate-web-workflow", skill)
        self.assertIn(".cocos-workflow/requirements.md", skill)
        self.assertIn("workflow.yaml", skill)
        self.assertIn("forbidden", skill)
        self.assertIn("Cocos MCP", skill)
        self.assertIn("human approval", skill)
        self.assertIn("project-profile.yaml", skill)
        self.assertIn("Do not override", skill)

    def test_contract_defines_page_and_acceptance_fields(self) -> None:
        """契约必须让页面流和验收条件具备可执行的最小结构。"""
        contract = CONTRACT_PATH.read_text(encoding="utf-8")

        for field in ("id", "purpose", "entry", "exit", "primary_ui", "player_actions"):
            self.assertIn(field, contract)

        for field in ("priority", "given", "when", "then", "evidence_type"):
            self.assertIn(field, contract)

    def test_contract_requires_frozen_profile_and_approval_hash(self) -> None:
        """批准需求必须绑定冻结配置，并保留可复核的审批与内容哈希。"""
        contract = CONTRACT_PATH.read_text(encoding="utf-8")

        for value in ("draft", "blocked", "approved", "approved_by", "approved_at", "sha256:"):
            self.assertIn(value, contract)
        self.assertIn("unresolved_questions", contract)
        self.assertIn("project-profile.yaml", contract)

    def test_contract_defines_approved_requirements(self) -> None:
        """契约必须定义可审批需求文档的核心字段。"""
        contract = CONTRACT_PATH.read_text(encoding="utf-8")

        for field in (
            "schema_version",
            "requirements_version",
            "status",
            "project_profile_hash",
            "source_inputs",
            "game",
            "scope",
            "pages",
            "acceptance_criteria",
            "unresolved_questions",
            "approval",
            "content_hash",
        ):
            self.assertIn(field, contract)

    def test_ambiguous_brief_lists_missing_questions(self) -> None:
        """场景仅提供自然语言的缺失信息，不向前向代理泄露预期结论。"""
        scenario = SCENARIO_PATH.read_text(encoding="utf-8")

        self.assertIn("未决问题", scenario)
        self.assertNotIn("不得假设", scenario)
        self.assertNotIn("保持待澄清状态", scenario)
