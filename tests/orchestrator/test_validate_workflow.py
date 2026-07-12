import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from init_workflow import initialize_workflow
from workflow_common import content_hash, read_yaml, write_yaml
from validate_workflow import validate_workflow


def _sync_profile_hash_and_gate(state: Path) -> None:
    """同步测试项目配置哈希及其批准门禁绑定。"""
    profile = read_yaml(state / "project-profile.yaml")
    profile_without_hash = dict(profile)
    profile_without_hash.pop("content_hash", None)
    profile["content_hash"] = content_hash(profile_without_hash)
    write_yaml(state / "project-profile.yaml", profile)
    workflow = read_yaml(state / "workflow.yaml")
    workflow["approval_gates"]["project-configuration"]["subject_hash"] = profile["content_hash"]
    write_yaml(state / "workflow.yaml", workflow)


def _make_requirements_state_valid(state: Path) -> None:
    """把初始化状态推进为具备完整 bootstrap 退出证据的 requirements。"""
    profile = read_yaml(state / "project-profile.yaml")
    profile["initial_scene"] = "assets/scenes/Main.scene"
    write_yaml(state / "project-profile.yaml", profile)
    _sync_profile_hash_and_gate(state)
    workflow = read_yaml(state / "workflow.yaml")
    workflow["state"] = "requirements"
    workflow["run_status"] = "pending"
    workflow["transitions"] = [
        {
            "from_state": "bootstrap",
            "to_state": "bootstrap",
            "from_run_status": "pending",
            "to_run_status": "running",
            "timestamp": "2026-07-12T00:00:00+00:00",
            "reason": "bootstrap-started",
            "evidence": ["project-profile.yaml"],
        },
        {
            "from_state": "bootstrap",
            "to_state": "bootstrap",
            "from_run_status": "running",
            "to_run_status": "passed",
            "timestamp": "2026-07-12T00:01:00+00:00",
            "reason": "bootstrap-verified",
            "evidence": ["reports/mcp-capabilities.json"],
        },
        {
            "from_state": "bootstrap",
            "to_state": "requirements",
            "from_run_status": "passed",
            "to_run_status": "pending",
            "timestamp": "2026-07-12T00:02:00+00:00",
            "reason": "bootstrap-complete",
            "evidence": ["reports/mcp-capabilities.json"],
        }
    ]
    write_yaml(state / "workflow.yaml", workflow)
    write_yaml(state / "reports/mcp-capabilities.json", {"tools": ["server_get_info"]})


class ValidateWorkflowTests(unittest.TestCase):
    """验证缺失文件、非法迁移数据和多 Cocos 写者都会被拒绝。"""

    def test_initialized_workflow_is_valid(self) -> None:
        """验证初始化生成的工作流满足全部结构与不变量约束。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            self.assertEqual(validate_workflow(root), [])

    def test_initial_scene_rules_follow_bootstrap_phase(self) -> None:
        """验证初始场景在 bootstrap 初期可空，离开后必须是安全相对 scene 路径。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            self.assertEqual(validate_workflow(root), [])

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            workflow = read_yaml(state / "workflow.yaml")
            workflow["state"] = "requirements"
            workflow["run_status"] = "pending"
            write_yaml(state / "workflow.yaml", workflow)
            self.assertIn("invalid-initial-scene", {issue.code for issue in validate_workflow(root)})

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            _make_requirements_state_valid(state)
            self.assertEqual(validate_workflow(root), [])

    def test_transition_rejects_state_skips_invalid_status_and_broken_chain(self) -> None:
        """验证主状态跳级、非法运行状态迁移和不连续链都会被拒绝。"""
        invalid_transitions = (
            [
                {
                    "from_state": "bootstrap", "to_state": "delivery",
                    "from_run_status": "pending", "to_run_status": "pending",
                    "timestamp": "2026-07-12T00:00:00+00:00", "reason": "skip",
                    "evidence": ["evidence.json"],
                }
            ],
            [
                {
                    "from_state": "bootstrap", "to_state": "bootstrap",
                    "from_run_status": "pending", "to_run_status": "passed",
                    "timestamp": "2026-07-12T00:00:00+00:00", "reason": "invalid-status",
                    "evidence": ["evidence.json"],
                }
            ],
            [
                {
                    "from_state": "bootstrap", "to_state": "bootstrap",
                    "from_run_status": "pending", "to_run_status": "running",
                    "timestamp": "2026-07-12T00:00:00+00:00", "reason": "start",
                    "evidence": ["evidence.json"],
                },
                {
                    "from_state": "bootstrap", "to_state": "requirements",
                    "from_run_status": "pending", "to_run_status": "pending",
                    "timestamp": "2026-07-12T00:01:00+00:00", "reason": "broken",
                    "evidence": ["evidence.json"],
                },
            ],
        )
        for transitions in invalid_transitions:
            with self.subTest(transitions=transitions):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(
                        root, "portrait", creator_version="3.8.6", approved_by="tester"
                    )
                    workflow = read_yaml(state / "workflow.yaml")
                    workflow["transitions"] = transitions
                    last = transitions[-1]
                    workflow["state"] = last["to_state"]
                    workflow["run_status"] = last["to_run_status"]
                    write_yaml(state / "workflow.yaml", workflow)
                    self.assertIn("invalid-transition", {issue.code for issue in validate_workflow(root)})

    def test_empty_transition_chain_only_allows_initial_bootstrap_pending(self) -> None:
        """验证 bootstrap running、blocked、passed 都不能伪造为空迁移链。"""
        for run_status in ("running", "blocked", "passed"):
            with self.subTest(run_status=run_status):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(
                        root, "portrait", creator_version="3.8.6", approved_by="tester"
                    )
                    workflow = read_yaml(state / "workflow.yaml")
                    workflow["run_status"] = run_status
                    write_yaml(state / "workflow.yaml", workflow)

                    self.assertIn(
                        "invalid-transition",
                        {issue.code for issue in validate_workflow(root)},
                    )

    def test_bootstrap_exit_requires_mcp_snapshot(self) -> None:
        """验证离开 bootstrap 必须提供非空 MCP 能力快照。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            _make_requirements_state_valid(state)
            (state / "reports/mcp-capabilities.json").unlink()
            self.assertIn("missing-mcp-capabilities", {issue.code for issue in validate_workflow(root)})

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            _make_requirements_state_valid(state)
            self.assertEqual(validate_workflow(root), [])

    def test_missing_project_profile_is_reported(self) -> None:
        """验证缺少项目配置文件时返回缺失文件问题。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            (state / "project-profile.yaml").unlink()
            codes = {issue.code for issue in validate_workflow(root)}
            self.assertIn("missing-file", codes)

    def test_parallel_cocos_writers_are_reported(self) -> None:
        """验证同时存在多个 Cocos 写者时返回唯一写入权问题。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            ownership = read_yaml(state / "ownership.yaml")
            ownership["active_cocos_writers"] = ["agent-a", "agent-b"]
            write_yaml(state / "ownership.yaml", ownership)
            codes = {issue.code for issue in validate_workflow(root)}
            self.assertIn("multiple-cocos-writers", codes)

    def test_non_bootstrap_workflow_requires_profile_creator_version(self) -> None:
        """验证非 bootstrap 状态严格使用项目配置中的正式 Creator 版本。"""
        cases = (
            ("3.8.6", None, False),
            ("3.8.5", None, True),
            ("3.8.6-beta.1", None, True),
            ("3.8.5", "3.8.6", True),
        )
        for profile_version, environment_version, should_fail in cases:
            with self.subTest(
                profile_version=profile_version,
                environment_version=environment_version,
            ):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
                    profile = read_yaml(state / "project-profile.yaml")
                    profile["engine"] = {
                        "name": "Cocos Creator",
                        "version": profile_version,
                    }
                    write_yaml(state / "project-profile.yaml", profile)
                    workflow = read_yaml(state / "workflow.yaml")
                    workflow["state"] = "requirements"
                    if environment_version is not None:
                        workflow["environment"] = {"creator_version": environment_version}
                    write_yaml(state / "workflow.yaml", workflow)

                    codes = {issue.code for issue in validate_workflow(root)}

                    self.assertEqual("unsupported-creator-version" in codes, should_fail)

    def test_non_bootstrap_workflow_requires_creator_engine_name(self) -> None:
        """验证非 bootstrap 状态要求引擎名称精确等于 Cocos Creator。"""
        for engine_name in (None, "Unreal Engine"):
            with self.subTest(engine_name=engine_name):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
                    profile = read_yaml(state / "project-profile.yaml")
                    profile["engine"] = {"version": "3.8.6"}
                    if engine_name is not None:
                        profile["engine"]["name"] = engine_name
                    write_yaml(state / "project-profile.yaml", profile)
                    workflow = read_yaml(state / "workflow.yaml")
                    workflow["state"] = "requirements"
                    write_yaml(state / "workflow.yaml", workflow)

                    codes = {issue.code for issue in validate_workflow(root)}

                    self.assertIn("unsupported-creator-engine", codes)

    def test_oversized_creator_version_is_structured_cli_failure(self) -> None:
        """验证超长数字版本返回结构化问题且 CLI 不因整数转换异常崩溃。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            profile = read_yaml(state / "project-profile.yaml")
            profile["engine"] = {
                "name": "Cocos Creator",
                "version": f"{'9' * 5000}.8.6",
            }
            write_yaml(state / "project-profile.yaml", profile)
            workflow = read_yaml(state / "workflow.yaml")
            workflow["state"] = "requirements"
            write_yaml(state / "workflow.yaml", workflow)

            issues = validate_workflow(root)
            completed = subprocess.run(
                [sys.executable, str(SCRIPTS / "validate_workflow.py"), str(root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertIn("unsupported-creator-version", {issue.code for issue in issues})
            self.assertEqual(completed.returncode, 1)
            self.assertNotIn("Traceback", completed.stderr)

    def test_missing_initialized_directory_is_reported(self) -> None:
        """验证初始化器声明的任一工作目录缺失时返回缺失目录问题。"""
        required_directories = (
            "tasks",
            "results",
            "art/concepts",
            "art/visual-references",
            "art/runtime-baselines",
            "artifacts",
            "reports/chrome",
        )
        for relative in required_directories:
            with self.subTest(relative=relative):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
                    (state / relative).rmdir()

                    codes = {issue.code for issue in validate_workflow(root)}

                    self.assertIn("missing-directory", codes)

    def test_invalid_core_invariants_are_reported(self) -> None:
        """验证非法状态、项目配置和 P0 豁免配置分别产生稳定问题码。"""
        cases = (
            ("workflow.yaml", "state", "unknown", "invalid-main-state"),
            ("project-profile.yaml", "status", "draft", "profile-not-frozen"),
            ("project-profile.yaml", "platform", "native", "invalid-platform"),
            (
                "project-profile.yaml",
                "design_resolution",
                {"width": 1920, "height": 1080},
                "orientation-resolution-mismatch",
            ),
        )
        for file_name, key, value, expected_code in cases:
            with self.subTest(expected_code=expected_code):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
                    document = read_yaml(state / file_name)
                    document[key] = value
                    write_yaml(state / file_name, document)

                    codes = {issue.code for issue in validate_workflow(root)}

                    self.assertIn(expected_code, codes)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            gates = read_yaml(state / "quality-gates.yaml")
            gates["P0"]["waivable"] = True
            write_yaml(state / "quality-gates.yaml", gates)
            codes = {issue.code for issue in validate_workflow(root)}
            self.assertIn("p0-waiver-forbidden", codes)

    def test_task_evidence_and_visual_freeze_are_required(self) -> None:
        """验证 passed 任务证据和视觉依赖版本、哈希均不可缺失。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            workflow = read_yaml(state / "workflow.yaml")
            workflow["task_status"] = {
                "passed-task": {"status": "passed", "evidence": []},
                "visual-task": {
                    "status": "pending",
                    "visual_dependency": {"version": "", "content_hash": ""},
                },
            }
            write_yaml(state / "workflow.yaml", workflow)

            codes = {issue.code for issue in validate_workflow(root)}

            self.assertIn("missing-task-evidence", codes)
            self.assertIn("incomplete-visual-dependency", codes)

    def test_damaged_result_is_reported_once(self) -> None:
        """验证内联与文件任务共用损坏结果时只报告一次读取问题。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            workflow = read_yaml(state / "workflow.yaml")
            workflow["task_status"] = {"task-a": {"status": "pending"}}
            write_yaml(state / "workflow.yaml", workflow)
            tasks = state / "tasks"
            write_yaml(tasks / "task-a.yaml", {"task_id": "task-a", "status": "pending"})
            results = state / "results"
            (results / "task-a.yaml").write_text("- invalid\n", encoding="utf-8")

            issues = validate_workflow(root)

            self.assertEqual(
                sum(issue.code == "invalid-state-file" for issue in issues),
                1,
            )

    def test_task_and_result_require_independent_passed_evidence(self) -> None:
        """验证任务旧证据不能掩盖关联 passed 结果缺少证据。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            workflow = read_yaml(state / "workflow.yaml")
            workflow["task_status"] = {
                "task-a": {"status": "passed", "evidence": ["task.log"]}
            }
            write_yaml(state / "workflow.yaml", workflow)
            results = state / "results"
            write_yaml(results / "task-a.yaml", {"status": "passed", "evidence": []})

            issues = validate_workflow(root)

            self.assertTrue(
                any(
                    issue.code == "missing-task-evidence"
                    and issue.path.endswith("results\\task-a.yaml")
                    for issue in issues
                )
            )

    def test_each_missing_quality_level_is_reported(self) -> None:
        """验证 P0、P1、P2 任一缺失均报告统一质量级别问题码。"""
        for level in ("P0", "P1", "P2"):
            with self.subTest(level=level):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
                    gates = read_yaml(state / "quality-gates.yaml")
                    del gates[level]
                    write_yaml(state / "quality-gates.yaml", gates)

                    codes = {issue.code for issue in validate_workflow(root)}

                    self.assertIn("missing-quality-level", codes)

    def test_canonical_required_fields_and_types_are_validated(self) -> None:
        """验证四个状态文件缺少规范字段或字段类型错误时被逐项拒绝。"""
        cases = (
            ("workflow.yaml", "workflow_id", None, "missing-or-invalid-field"),
            ("workflow.yaml", "active_task_ids", {}, "missing-or-invalid-field"),
            ("project-profile.yaml", "project_type", "3d", "invalid-project-type"),
            ("project-profile.yaml", "approved_by", "", "missing-approval"),
            ("project-profile.yaml", "initial_scene", 42, "missing-or-invalid-field"),
            ("quality-gates.yaml", "schema_version", None, "missing-or-invalid-field"),
            ("ownership.yaml", "conflict_policy", "allow", "invalid-conflict-policy"),
        )
        for file_name, key, value, expected_code in cases:
            with self.subTest(file_name=file_name, key=key):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(
                        root, "portrait", creator_version="3.8.6", approved_by="tester"
                    )
                    document = read_yaml(state / file_name)
                    if value is None:
                        document.pop(key)
                    else:
                        document[key] = value
                    write_yaml(state / file_name, document)

                    self.assertIn(expected_code, {issue.code for issue in validate_workflow(root)})

    def test_profile_hash_and_approval_gate_hash_must_match(self) -> None:
        """验证配置内容哈希及项目批准门禁绑定哈希都不可伪造。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            profile = read_yaml(state / "project-profile.yaml")
            profile["safe_area"]["enabled"] = False
            write_yaml(state / "project-profile.yaml", profile)
            codes = {issue.code for issue in validate_workflow(root)}
            self.assertIn("profile-hash-mismatch", codes)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            workflow = read_yaml(state / "workflow.yaml")
            workflow["approval_gates"]["project-configuration"]["subject_hash"] = "sha256:bad"
            write_yaml(state / "workflow.yaml", workflow)
            self.assertIn(
                "project-approval-mismatch",
                {issue.code for issue in validate_workflow(root)},
            )

    def test_mapping_visual_inputs_require_version_and_sha256_hash(self) -> None:
        """验证映射输入中的全部视觉依赖都要求非空版本和 sha256 哈希。"""
        invalid_inputs = (
            {"visual": {"version": "", "content_hash": "sha256:abc"}},
            {"visual": []},
            {"visual_direction": {"version": 1, "content_hash": ""}},
            {"scene_concept": {"version": 1, "content_hash": "not-a-hash"}},
            [{"type": "visual", "version": 1, "content_hash": ""}],
        )
        for inputs in invalid_inputs:
            with self.subTest(inputs=inputs):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    state = initialize_workflow(
                        root, "portrait", creator_version="3.8.6", approved_by="tester"
                    )
                    workflow = read_yaml(state / "workflow.yaml")
                    workflow["task_status"] = {"visual-task": {"status": "pending", "inputs": inputs}}
                    write_yaml(state / "workflow.yaml", workflow)
                    self.assertIn(
                        "incomplete-visual-dependency",
                        {issue.code for issue in validate_workflow(root)},
                    )

    def test_bootstrap_rejects_unsupported_creator_version(self) -> None:
        """验证初始化状态也必须通过 Creator 正式三段最低版本门禁。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(
                root, "portrait", creator_version="3.8.6", approved_by="tester"
            )
            profile = read_yaml(state / "project-profile.yaml")
            profile["engine"]["version"] = "3.8.5"
            profile_without_hash = dict(profile)
            profile_without_hash.pop("content_hash")
            profile["content_hash"] = content_hash(profile_without_hash)
            write_yaml(state / "project-profile.yaml", profile)
            workflow = read_yaml(state / "workflow.yaml")
            workflow["approval_gates"]["project-configuration"]["subject_hash"] = profile["content_hash"]
            write_yaml(state / "workflow.yaml", workflow)
            self.assertIn(
                "unsupported-creator-version",
                {issue.code for issue in validate_workflow(root)},
            )

    def test_cli_uses_contract_exit_codes(self) -> None:
        """验证 CLI 对有效、普通失败和损坏状态分别返回 0、1、2。"""
        validator = SCRIPTS / "validate_workflow.py"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            valid = subprocess.run(
                [sys.executable, str(validator), str(root)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(valid.returncode, 0)
            self.assertIn("workflow valid", valid.stdout)

            (state / "project-profile.yaml").unlink()
            invalid = subprocess.run(
                [sys.executable, str(validator), str(root)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(invalid.returncode, 1)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait", creator_version="3.8.6", approved_by="tester")
            (state / "workflow.yaml").write_text("- invalid\n", encoding="utf-8")
            damaged = subprocess.run(
                [sys.executable, str(validator), str(root)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(damaged.returncode, 2)
