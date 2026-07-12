import sys
import tempfile
import unittest
from unittest.mock import patch
from collections import UserDict
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from workflow_common import WorkflowError, content_hash, read_yaml, write_yaml
from init_workflow import initialize_workflow


class WorkflowCommonTests(unittest.TestCase):
    """验证工作流公共文件操作保持确定性并拒绝非法根结构。"""

    def test_yaml_round_trip_and_hash_are_deterministic(self) -> None:
        """验证 YAML 往返读取及普通字典哈希不受键插入顺序影响。"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.yaml"
            first = {"state": "bootstrap", "version": 1}
            second = {"version": 1, "state": "bootstrap"}

            write_yaml(path, first)

            self.assertEqual(read_yaml(path), first)
            self.assertEqual(content_hash(first), content_hash(second))

    def test_read_yaml_rejects_non_mapping_root(self) -> None:
        """验证读取非映射 YAML 根节点时拒绝生成工作流状态。"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.yaml"
            path.write_text("- invalid\n", encoding="utf-8")

            with self.assertRaises(WorkflowError):
                read_yaml(path)

    def test_content_hash_accepts_generic_mapping(self) -> None:
        """验证通用映射与等价普通字典生成相同内容哈希。"""
        data = {"state": "bootstrap", "version": 1}

        self.assertEqual(content_hash(UserDict(data)), content_hash(data))


class InitializeWorkflowTests(unittest.TestCase):
    """验证初始化只创建批准的基础状态，并拒绝覆盖已有工作流。"""

    def test_portrait_uses_mobile_default_and_freezes_profile(self) -> None:
        """验证竖屏初始化采用手机默认分辨率并冻结项目配置。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            profile = read_yaml(state_dir / "project-profile.yaml")
            workflow = read_yaml(state_dir / "workflow.yaml")

            self.assertEqual(profile["platform"], "web-mobile")
            self.assertEqual(profile["orientation"], "portrait")
            self.assertEqual(
                profile["design_resolution"],
                {"width": 1080, "height": 1920, "source": "approved-default"},
            )
            self.assertEqual(
                profile["capture_profiles"][0],
                {"id": "mobile-small", "width": 375, "height": 667},
            )
            self.assertEqual(profile["status"], "frozen")
            self.assertEqual(profile["approved_by"], "tester")
            self.assertTrue(profile["frozen_at"])
            self.assertTrue(profile["content_hash"].startswith("sha256:"))
            self.assertEqual(workflow["state"], "bootstrap")
            self.assertEqual(workflow["run_status"], "pending")
            self.assertEqual(
                workflow["approval_gates"]["project-configuration"]["subject_hash"],
                profile["content_hash"],
            )
            self.assertEqual(workflow["approval_gates"]["project-configuration"]["status"], "passed")

    def test_landscape_accepts_explicit_resolution(self) -> None:
        """验证横屏初始化接受成对提供的自定义设计分辨率。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = initialize_workflow(
                root,
                "landscape",
                creator_version="3.8.6",
                approved_by="tester",
                design_width=1600,
                design_height=900,
            )
            profile = read_yaml(state_dir / "project-profile.yaml")
            self.assertEqual(
                profile["design_resolution"],
                {"width": 1600, "height": 900, "source": "approved-custom"},
            )

    def test_custom_resolution_must_match_frozen_orientation(self) -> None:
        """验证初始化立即拒绝与已选屏幕方向相反的自定义分辨率。"""
        invalid_profiles = (
            ("portrait", 1920, 1080),
            ("landscape", 1080, 1920),
            ("portrait", 1080, 1080),
            ("landscape", 1080, 1080),
        )
        for orientation, width, height in invalid_profiles:
            with self.subTest(orientation=orientation, width=width, height=height):
                with tempfile.TemporaryDirectory() as tmp:
                    with self.assertRaises(WorkflowError):
                        initialize_workflow(
                            Path(tmp),
                            orientation,
                            creator_version="3.8.6",
                            approved_by="tester",
                            design_width=width,
                            design_height=height,
                        )

    def test_existing_workflow_is_not_overwritten(self) -> None:
        """验证重复初始化时拒绝覆盖已有工作流状态。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            with self.assertRaises(WorkflowError):
                initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")

    def test_custom_resolution_requires_positive_plain_integers(self) -> None:
        """验证自定义分辨率拒绝布尔值、非整数类型和非正整数。"""
        invalid_sizes = (
            (True, 900),
            (1600.0, 900),
            ("1600", 900),
            (1600, 0),
        )
        for width, height in invalid_sizes:
            with self.subTest(width=width, height=height):
                with tempfile.TemporaryDirectory() as tmp:
                    with self.assertRaises(WorkflowError):
                        initialize_workflow(
                            Path(tmp),
                            "landscape",
                            creator_version="3.8.6",
                            approved_by="tester",
                            design_width=width,
                            design_height=height,
                        )

    def test_creator_version_and_approver_are_required(self) -> None:
        """验证初始化不能伪造缺失的 Creator 版本或人工批准者。"""
        for creator_version, approved_by in (("", "tester"), ("3.8.6", ""), ("3.8.6", "  ")):
            with self.subTest(creator_version=creator_version, approved_by=approved_by):
                with tempfile.TemporaryDirectory() as tmp:
                    with self.assertRaises(WorkflowError):
                        initialize_workflow(
                            Path(tmp),
                            "portrait",
                            creator_version=creator_version,
                            approved_by=approved_by,
                        )

    def test_creator_version_must_be_supported_release(self) -> None:
        """验证初始化只接受 Cocos Creator 3.8.6+ 正式三段版本。"""
        for version in ("3.8.5", "3.8.6-beta.1", "v3.8.6", ""):
            with self.subTest(version=version):
                with tempfile.TemporaryDirectory() as tmp:
                    with self.assertRaises(WorkflowError):
                        initialize_workflow(
                            Path(tmp),
                            "portrait",
                            creator_version=version,
                            approved_by="tester",
                        )

    def test_initialization_is_directory_atomic_and_cleans_failure(self) -> None:
        """验证任一文件写入失败时目标目录与初始化临时目录都不会残留。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch("init_workflow.write_yaml", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    initialize_workflow(
                        root,
                        "portrait",
                        creator_version="3.8.6",
                        approved_by="tester",
                    )

            self.assertFalse((root / ".cocos-workflow").exists())
            self.assertEqual(list(root.glob(".cocos-workflow.*")), [])

    def test_canonical_schema_and_required_directories_are_complete(self) -> None:
        """验证初始化一次性生成规范要求的全部字段和目录。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            workflow = read_yaml(state / "workflow.yaml")
            profile = read_yaml(state / "project-profile.yaml")
            ownership = read_yaml(state / "ownership.yaml")
            gates = read_yaml(state / "quality-gates.yaml")

            self.assertEqual(
                set(workflow),
                {
                    "schema_version", "workflow_id", "state", "run_status",
                    "active_task_ids", "completed_task_ids", "task_status", "artifacts",
                    "visual_direction", "approval_gates", "invalidated", "transitions",
                    "updated_at",
                },
            )
            self.assertEqual(profile["engine"], {"name": "Cocos Creator", "version": "3.8.6"})
            self.assertEqual(profile["project_type"], "2d")
            self.assertIsNone(profile["initial_scene"])
            self.assertEqual(ownership["workflow_writer"], "cocos-orchestrate-web-workflow")
            self.assertEqual(ownership["conflict_policy"], "reject-overlap")
            self.assertEqual(set(gates), {"schema_version", "P0", "P1", "P2"})
            for relative in (
                "tasks", "results", "art/concepts", "art/visual-references",
                "art/runtime-baselines", "art/assets", "artifacts", "reports/chrome",
            ):
                self.assertTrue((state / relative).is_dir(), relative)
