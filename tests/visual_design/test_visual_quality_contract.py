"""验证游戏原画与 UI 设计质量门槛。"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
VISUAL_SKILL = ROOT / "skills" / "cocos-create-visual-concept" / "SKILL.md"
SCENE_CONTRACT = ROOT / "skills" / "cocos-create-visual-concept" / "references" / "scene-concept-contract.md"
DIRECTION_CONTRACT = ROOT / "skills" / "cocos-freeze-visual-direction" / "references" / "visual-direction-contract.md"
ORCHESTRATOR = ROOT / "skills" / "cocos-orchestrate-web-workflow" / "SKILL.md"


class VisualQualityContractTest(unittest.TestCase):
    """确保正式效果图具备专业探索、精确 UI 和不可豁免验收。"""

    def test_scene_concept_requires_exploration_and_refinement(self) -> None:
        """场景效果图必须包含候选、评审、分层和精修证据。"""
        skill = VISUAL_SKILL.read_text(encoding="utf-8")
        contract = SCENE_CONTRACT.read_text(encoding="utf-8")
        for token in ("至少 3 个", "游戏原画设计师", "UI 设计师", "至少进行 1 轮", "平均分不低于 4.5"):
            self.assertIn(token, skill)
        for token in ("candidate_count", "editable_source_path", "copy_inventory_path", "refinement_rounds", "quality_review"):
            self.assertIn(token, contract)

    def test_direction_covers_game_art_and_ui_systems(self) -> None:
        """冻结方向必须分别定义原画和 UI 生产规范。"""
        contract = DIRECTION_CONTRACT.read_text(encoding="utf-8")
        for token in ("game_art_system", "ui_system", "game-art-quality-anchor", "ui-system-quality-anchor"):
            self.assertIn(token, contract)

    def test_visual_quality_gate_is_non_waivable(self) -> None:
        """总控不得接受低分、伪文字或缺少过程证据的结果。"""
        orchestrator = ORCHESTRATOR.read_text(encoding="utf-8")
        for token in ("视觉质量门禁", "平均分低于 4.5", "生成伪文字", "P0"):
            self.assertIn(token, orchestrator)

    def test_effect_images_are_generated_one_scene_at_a_time(self) -> None:
        """效果图必须按场景串行，不得批量生成全部页面。"""
        skill = VISUAL_SKILL.read_text(encoding="utf-8")
        contract = SCENE_CONTRACT.read_text(encoding="utf-8")
        orchestrator = ORCHESTRATOR.read_text(encoding="utf-8")
        self.assertIn("一次任务只能处理一个", skill)
        self.assertIn("1 task : 1 scene_id : 1 final image", contract)
        self.assertIn("任意时刻最多一个活动", orchestrator)
        self.assertIn("禁止一次派发多个页面", orchestrator)


if __name__ == "__main__":
    unittest.main()
