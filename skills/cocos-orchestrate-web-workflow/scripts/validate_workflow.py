from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from workflow_common import WorkflowError, content_hash, read_yaml, workflow_dir


REQUIRED_FILES = (
    "workflow.yaml",
    "project-profile.yaml",
    "quality-gates.yaml",
    "ownership.yaml",
)
REQUIRED_DIRECTORIES = (
    "tasks",
    "results",
    "art/concepts",
    "art/visual-references",
    "art/runtime-baselines",
    "artifacts",
    "reports/chrome",
)
MAIN_STATES = {
    "bootstrap",
    "requirements",
    "visual-direction",
    "scene-concepts",
    "planning",
    "production",
    "integration",
    "verification",
    "building",
    "delivery",
    "completed",
}
MAIN_STATE_SEQUENCE = (
    "bootstrap",
    "requirements",
    "visual-direction",
    "scene-concepts",
    "planning",
    "production",
    "integration",
    "verification",
    "building",
    "delivery",
    "completed",
)
RUN_STATUSES = {"pending", "running", "passed", "failed", "retrying", "blocked", "stale"}
RUN_STATUS_TRANSITIONS = {
    ("pending", "running"),
    ("pending", "blocked"),
    ("running", "passed"),
    ("running", "failed"),
    ("running", "blocked"),
    ("failed", "retrying"),
    ("failed", "blocked"),
    ("retrying", "running"),
    ("retrying", "failed"),
    ("retrying", "blocked"),
    ("passed", "stale"),
    ("stale", "pending"),
    ("blocked", "pending"),
    ("blocked", "running"),
}


@dataclass(frozen=True)
class ValidationIssue:
    """描述一个可定位、可机器判定的工作流不变量问题。"""

    code: str
    path: str
    message: str


def _issue(code: str, path: Path | str, message: str) -> ValidationIssue:
    """创建字段顺序稳定的校验问题，供 API 与 CLI 共用。"""
    return ValidationIssue(code, str(path), message)


def _matches_type(value: Any, expected_type: type | Any) -> bool:
    """校验字段类型，并阻止 bool 作为 int 子类通过 schema 检查。"""
    if expected_type is int:
        return type(value) is int
    return isinstance(value, expected_type)


def _read_required_files(
    state_dir: Path,
) -> tuple[dict[str, dict[str, Any]], list[ValidationIssue]]:
    """读取四个必需映射文件，并把缺失或损坏转换为结构化问题。"""
    documents: dict[str, dict[str, Any]] = {}
    issues: list[ValidationIssue] = []
    for name in REQUIRED_FILES:
        path = state_dir / name
        if not path.is_file():
            issues.append(_issue("missing-file", path, "缺少必需的工作流状态文件"))
            continue
        try:
            documents[name] = read_yaml(path)
        except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
            issues.append(_issue("invalid-state-file", path, str(error)))
    return documents, issues


def _validate_profile(profile: Mapping[str, Any], path: Path) -> list[ValidationIssue]:
    """校验冻结状态、目标平台以及方向和分辨率之间的关系。"""
    issues: list[ValidationIssue] = []
    required_types = {
        "schema_version": int,
        "project_id": str,
        "engine": Mapping,
        "project_type": str,
        "platform": str,
        "orientation": str,
        "design_resolution": Mapping,
        "capture_profiles": list,
        "fit_policy": Mapping,
        "safe_area": Mapping,
        "project_root": str,
        "cocos_project_file": str,
        "status": str,
        "frozen_at": str,
        "approved_by": str,
        "content_hash": str,
    }
    for field, expected_type in required_types.items():
        if not _matches_type(profile.get(field), expected_type):
            issues.append(_issue("missing-or-invalid-field", path, f"project-profile.{field} 字段缺失或类型错误"))

    if "initial_scene" not in profile or profile.get("initial_scene") is not None and not isinstance(profile.get("initial_scene"), str):
        issues.append(_issue("missing-or-invalid-field", path, "project-profile.initial_scene 必须为 null 或字符串"))

    if profile.get("project_type") != "2d":
        issues.append(_issue("invalid-project-type", path, "project_type 必须为 2d"))
    if profile.get("status") != "frozen":
        issues.append(_issue("profile-not-frozen", path, "项目配置状态必须为 frozen"))

    if profile.get("platform") != "web-mobile":
        issues.append(_issue("invalid-platform", path, "目标平台必须为 web-mobile"))

    if not isinstance(profile.get("approved_by"), str) or not profile.get("approved_by", "").strip():
        issues.append(_issue("missing-approval", path, "approved_by 不得为空"))
    if not isinstance(profile.get("frozen_at"), str) or not profile.get("frozen_at", "").strip():
        issues.append(_issue("missing-approval", path, "frozen_at 不得为空"))

    stored_hash = profile.get("content_hash")
    hash_source = dict(profile)
    hash_source.pop("content_hash", None)
    if not isinstance(stored_hash, str) or stored_hash != content_hash(hash_source):
        issues.append(_issue("profile-hash-mismatch", path, "项目配置内容哈希与当前内容不匹配"))

    orientation = profile.get("orientation")
    resolution = profile.get("design_resolution")
    if orientation not in {"portrait", "landscape"} or not isinstance(resolution, Mapping):
        issues.append(_issue("invalid-orientation-resolution", path, "方向或设计分辨率结构无效"))
        return issues

    width = resolution.get("width")
    height = resolution.get("height")
    if not isinstance(resolution.get("source"), str) or not resolution.get("source", "").strip():
        issues.append(_issue("missing-or-invalid-field", path, "design_resolution.source 不得为空"))
    valid_size = (
        type(width) is int
        and type(height) is int
        and width > 0
        and height > 0
    )
    relation_matches = valid_size and (
        (orientation == "portrait" and width < height)
        or (orientation == "landscape" and width > height)
    )
    if not relation_matches:
        issues.append(
            _issue(
                "orientation-resolution-mismatch",
                path,
                "方向必须与设计分辨率的宽高关系一致",
            )
        )
    return issues


def _validate_workflow_document(
    workflow: Mapping[str, Any], profile: Mapping[str, Any], path: Path
) -> list[ValidationIssue]:
    """逐项校验 canonical workflow 字段及项目批准门禁绑定。"""
    issues: list[ValidationIssue] = []
    required_types = {
        "schema_version": int,
        "workflow_id": str,
        "state": str,
        "run_status": str,
        "active_task_ids": list,
        "completed_task_ids": list,
        "task_status": Mapping,
        "artifacts": Mapping,
        "visual_direction": Mapping,
        "approval_gates": Mapping,
        "invalidated": list,
        "transitions": list,
        "updated_at": str,
    }
    for field, expected_type in required_types.items():
        if not _matches_type(workflow.get(field), expected_type):
            issues.append(_issue("missing-or-invalid-field", path, f"workflow.{field} 字段缺失或类型错误"))
    for field in ("workflow_id", "updated_at"):
        if not isinstance(workflow.get(field), str) or not workflow.get(field, "").strip():
            issues.append(_issue("missing-or-invalid-field", path, f"workflow.{field} 不得为空"))
    if workflow.get("run_status") not in {
        "pending", "running", "passed", "failed", "retrying", "blocked", "stale"
    }:
        issues.append(_issue("invalid-run-status", path, "run_status 不属于允许集合"))
    visual = workflow.get("visual_direction")
    if isinstance(visual, Mapping) and not {"version", "content_hash"}.issubset(visual):
        issues.append(_issue("missing-or-invalid-field", path, "visual_direction 必须包含 version 与 content_hash"))

    gates = workflow.get("approval_gates")
    project_gate = gates.get("project-configuration") if isinstance(gates, Mapping) else None
    expected_hash = profile.get("content_hash")
    if not (
        isinstance(project_gate, Mapping)
        and project_gate.get("status") == "passed"
        and project_gate.get("subject_hash") == expected_hash
        and project_gate.get("approved_by") == profile.get("approved_by")
        and bool(project_gate.get("approved_at"))
    ):
        issues.append(_issue("project-approval-mismatch", path, "项目配置批准门禁必须绑定相同批准者与内容哈希"))
    return issues


def _validate_initial_scene(
    profile: Mapping[str, Any], workflow: Mapping[str, Any], path: Path
) -> list[ValidationIssue]:
    """按 bootstrap 阶段校验初始场景是否为空或安全的项目相对路径。"""
    state = workflow.get("state")
    run_status = workflow.get("run_status")
    scene = profile.get("initial_scene")
    may_be_null = state == "bootstrap" and run_status in {"pending", "running", "blocked"}
    if scene is None and may_be_null:
        return []
    valid = isinstance(scene, str) and bool(scene.strip())
    if valid:
        candidate = PurePosixPath(scene)
        valid = (
            not candidate.is_absolute()
            and not re.match(r"^[A-Za-z]:[\\/]", scene)
            and "\\" not in scene
            and ".." not in candidate.parts
            and candidate.suffix == ".scene"
        )
    return [] if valid else [_issue("invalid-initial-scene", path, "当前阶段必须提供安全的项目相对 .scene 路径")]


def _validate_transitions(workflow: Mapping[str, Any], path: Path) -> list[ValidationIssue]:
    """校验 canonical 迁移结构、顺序、连续性及当前状态回放结果。"""
    transitions = workflow.get("transitions")
    if not isinstance(transitions, list):
        return []
    issues: list[ValidationIssue] = []
    if not transitions and not (
        workflow.get("state") == "bootstrap" and workflow.get("run_status") == "pending"
    ):
        return [_issue("invalid-transition", path, "空迁移链只允许初始 bootstrap/pending")]
    required = {
        "from_state", "to_state", "from_run_status", "to_run_status",
        "timestamp", "reason", "evidence",
    }
    previous: Mapping[str, Any] | None = None
    for index, transition in enumerate(transitions):
        valid = isinstance(transition, Mapping) and required.issubset(transition)
        if not valid:
            issues.append(_issue("invalid-transition", path, f"transitions[{index}] 缺少 canonical 字段"))
            continue
        from_state = transition["from_state"]
        to_state = transition["to_state"]
        from_status = transition["from_run_status"]
        to_status = transition["to_run_status"]
        valid = (
            from_state in MAIN_STATES
            and to_state in MAIN_STATES
            and from_status in RUN_STATUSES
            and to_status in RUN_STATUSES
            and isinstance(transition["timestamp"], str)
            and bool(transition["timestamp"].strip())
            and isinstance(transition["reason"], str)
            and bool(transition["reason"].strip())
            and isinstance(transition["evidence"], list)
            and bool(transition["evidence"])
        )
        if from_state == to_state:
            valid = valid and (from_status, to_status) in RUN_STATUS_TRANSITIONS
        elif from_state in MAIN_STATES and to_state in MAIN_STATES:
            valid = valid and MAIN_STATE_SEQUENCE.index(to_state) == MAIN_STATE_SEQUENCE.index(from_state) + 1
            valid = valid and from_status == "passed" and to_status == "pending"
        if index == 0:
            valid = valid and from_state == "bootstrap" and from_status == "pending"
        if previous is not None:
            valid = valid and previous.get("to_state") == from_state
            valid = valid and previous.get("to_run_status") == from_status
        if not valid:
            issues.append(_issue("invalid-transition", path, f"transitions[{index}] 迁移非法或与前项不连续"))
        previous = transition

    if transitions and isinstance(transitions[-1], Mapping):
        last = transitions[-1]
        if last.get("to_state") != workflow.get("state") or last.get("to_run_status") != workflow.get("run_status"):
            issues.append(_issue("invalid-transition", path, "最后迁移结果必须等于 workflow 当前状态"))
    return issues


def _validate_bootstrap_exit_evidence(
    workflow: Mapping[str, Any], state_dir: Path
) -> list[ValidationIssue]:
    """离开 bootstrap 或完成 bootstrap 时要求可解析且非空的 MCP 能力快照。"""
    required = workflow.get("state") != "bootstrap" or workflow.get("run_status") == "passed"
    if not required:
        return []
    path = state_dir / "reports" / "mcp-capabilities.json"
    if not path.is_file():
        return [_issue("missing-mcp-capabilities", path, "缺少 bootstrap 退出所需 MCP 能力快照")]
    try:
        snapshot = read_yaml(path)
    except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
        return [_issue("invalid-mcp-capabilities", path, str(error))]
    tools = snapshot.get("tools")
    capabilities = snapshot.get("capabilities")
    if not tools and not capabilities:
        return [_issue("invalid-mcp-capabilities", path, "MCP 能力快照必须包含非空 tools 或 capabilities")]
    return []


def _creator_version_is_supported(profile: Mapping[str, Any]) -> bool:
    """判断项目配置中的 Creator 版本是否为正式且受支持的三段版本。"""
    engine = profile.get("engine")
    if not isinstance(engine, Mapping):
        return False
    version = engine.get("version")
    if not isinstance(version, str):
        return False
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if match is None:
        return False
    try:
        parsed = tuple(int(part) for part in match.groups())
    except ValueError:
        # Python 会拒绝把超长数字转换为整数，校验器必须将其降级为结构化版本问题。
        return False
    return parsed >= (3, 8, 6)


def _creator_engine_is_supported(profile: Mapping[str, Any]) -> bool:
    """判断项目配置中的引擎名称是否精确声明为 Cocos Creator。"""
    engine = profile.get("engine")
    return isinstance(engine, Mapping) and engine.get("name") == "Cocos Creator"


def _validate_quality_gates(gates: Mapping[str, Any], path: Path) -> list[ValidationIssue]:
    """校验三级质量门禁存在，并禁止 P0 配置可豁免行为。"""
    issues: list[ValidationIssue] = []
    if type(gates.get("schema_version")) is not int:
        issues.append(_issue("missing-or-invalid-field", path, "quality-gates.schema_version 缺失或类型错误"))
    for severity in ("P0", "P1", "P2"):
        if not isinstance(gates.get(severity), Mapping):
            issues.append(_issue("missing-quality-level", path, f"缺少 {severity} 质量门禁"))

    p0 = gates.get("P0")
    if isinstance(p0, Mapping):
        # P0 可以显式声明不可豁免，但任何启用豁免的字段都会破坏硬门禁。
        has_waiver = p0.get("waivable") not in (None, False) or bool(p0.get("waivers"))
        has_waiver = has_waiver or "waivable_by" in p0
        if has_waiver:
            issues.append(_issue("p0-waiver-forbidden", path, "P0 质量门禁不得配置豁免"))
    return issues


VISUAL_KEYS = {"visual", "visual_direction", "scene_concept"}
VISUAL_TYPES = {"visual", "visual-direction", "scene-concept"}
SHA256_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")


def _collect_visual_dependencies(value: Any) -> list[Any]:
    """递归收集映射键和列表类型标记声明的视觉依赖。"""
    dependencies: list[Any] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key in VISUAL_KEYS:
                dependencies.append(child)
            if key in {"visual_dependency", "visual_dependencies"}:
                candidates = child if isinstance(child, list) else [child]
                dependencies.extend(item for item in candidates if isinstance(item, Mapping))
            dependencies.extend(_collect_visual_dependencies(child))
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, Mapping) and item.get("type") in VISUAL_TYPES:
                dependencies.append(item)
            dependencies.extend(_collect_visual_dependencies(item))
    return dependencies


def _visual_dependency_is_frozen(dependency: Any) -> bool:
    """判断单个视觉依赖是否带版本和规范 SHA-256 内容哈希。"""
    if not isinstance(dependency, Mapping):
        return False
    content_hash_value = dependency.get("content_hash")
    return bool(dependency.get("version")) and isinstance(content_hash_value, str) and bool(
        SHA256_PATTERN.fullmatch(content_hash_value)
    )


def _validate_task(
    task_id: str,
    task: Any,
    task_path: Path,
) -> list[ValidationIssue]:
    """独立校验单个任务或结果的通过证据和视觉输入冻结信息。"""
    if not isinstance(task, Mapping):
        return []
    issues: list[ValidationIssue] = []
    status = task.get("status", task.get("state"))
    evidence = task.get("evidence")
    if status == "passed" and not evidence:
        issues.append(
            _issue("missing-task-evidence", task_path, f"passed 任务 {task_id} 必须包含非空 evidence")
        )
    dependencies = _collect_visual_dependencies(task.get("inputs"))
    if "visual_dependency" in task or "visual_dependencies" in task:
        dependencies.extend(_collect_visual_dependencies(task))
    if dependencies and not all(_visual_dependency_is_frozen(item) for item in dependencies):
        issues.append(
            _issue(
                "incomplete-visual-dependency",
                task_path,
                f"任务 {task_id} 的视觉依赖必须包含版本和内容哈希",
            )
        )
    return issues


def _validate_tasks(workflow: Mapping[str, Any], state_dir: Path) -> list[ValidationIssue]:
    """校验内联任务状态以及任务、结果目录中的持久化任务记录。"""
    issues: list[ValidationIssue] = []
    checked_results: set[Path] = set()
    task_status = workflow.get("task_status", {})
    if isinstance(task_status, Mapping):
        for task_id, task in task_status.items():
            result_path = state_dir / "results" / f"{task_id}.yaml"
            if result_path.is_file() and result_path not in checked_results:
                # 标记已经尝试读取，避免损坏结果在目录扫描阶段被重复报告。
                checked_results.add(result_path)
                try:
                    result = read_yaml(result_path)
                    issues.extend(_validate_task(str(task_id), result, result_path))
                except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
                    issues.append(_issue("invalid-state-file", result_path, str(error)))
            issues.extend(_validate_task(str(task_id), task, state_dir / "workflow.yaml"))

    tasks_dir = state_dir / "tasks"
    for task_path in sorted(tasks_dir.glob("*.yaml")) if tasks_dir.is_dir() else ():
        try:
            task = read_yaml(task_path)
        except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
            issues.append(_issue("invalid-state-file", task_path, str(error)))
            continue
        task_id = str(task.get("task_id", task_path.stem))
        result_path = state_dir / "results" / f"{task_id}.yaml"
        if result_path.is_file() and result_path not in checked_results:
            checked_results.add(result_path)
            try:
                result = read_yaml(result_path)
                issues.extend(_validate_task(task_id, result, result_path))
            except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
                issues.append(_issue("invalid-state-file", result_path, str(error)))
        issues.extend(_validate_task(task_id, task, task_path))

    results_dir = state_dir / "results"
    for result_path in sorted(results_dir.glob("*.yaml")) if results_dir.is_dir() else ():
        if result_path in checked_results:
            continue
        try:
            result = read_yaml(result_path)
        except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
            issues.append(_issue("invalid-state-file", result_path, str(error)))
            continue
        issues.extend(_validate_task(result_path.stem, result, result_path))
    return issues


def validate_workflow(project_root: Path) -> list[ValidationIssue]:
    """校验工作流结构与跨文件不变量，并返回全部可定位问题。"""
    state_dir = workflow_dir(project_root)
    documents, issues = _read_required_files(state_dir)
    for relative in REQUIRED_DIRECTORIES:
        path = state_dir / relative
        if not path.is_dir():
            issues.append(_issue("missing-directory", path, "缺少初始化工作流必需目录"))

    profile = documents.get("project-profile.yaml")
    workflow = documents.get("workflow.yaml")
    if workflow is not None:
        issues.extend(_validate_workflow_document(workflow, profile or {}, state_dir / "workflow.yaml"))
        issues.extend(_validate_initial_scene(profile or {}, workflow, state_dir / "project-profile.yaml"))
        issues.extend(_validate_transitions(workflow, state_dir / "workflow.yaml"))
        issues.extend(_validate_bootstrap_exit_evidence(workflow, state_dir))
        if workflow.get("state") not in MAIN_STATES:
            issues.append(
                _issue("invalid-main-state", state_dir / "workflow.yaml", "主状态不属于允许集合")
            )
        if not _creator_engine_is_supported(profile or {}):
            issues.append(
                _issue(
                    "unsupported-creator-engine",
                    state_dir / "project-profile.yaml",
                    "引擎名称必须精确为 Cocos Creator",
                )
            )
        if not _creator_version_is_supported(profile or {}):
            issues.append(
                _issue(
                    "unsupported-creator-version",
                    state_dir / "project-profile.yaml",
                    "Creator 版本必须为正式三段版本且不低于 3.8.6",
                )
            )
        issues.extend(_validate_tasks(workflow, state_dir))

    if profile is not None:
        issues.extend(_validate_profile(profile, state_dir / "project-profile.yaml"))

    ownership = documents.get("ownership.yaml")
    if ownership is not None:
        ownership_types = {
            "schema_version": int,
            "workflow_writer": str,
            "active_cocos_writers": list,
            "path_owners": Mapping,
            "conflict_policy": str,
        }
        for field, expected_type in ownership_types.items():
            if not _matches_type(ownership.get(field), expected_type):
                issues.append(
                    _issue("missing-or-invalid-field", state_dir / "ownership.yaml", f"ownership.{field} 字段缺失或类型错误")
                )
        if ownership.get("workflow_writer") != "cocos-orchestrate-web-workflow":
            issues.append(_issue("invalid-workflow-writer", state_dir / "ownership.yaml", "workflow_writer 必须为总控 Skill"))
        if ownership.get("conflict_policy") != "reject-overlap":
            issues.append(_issue("invalid-conflict-policy", state_dir / "ownership.yaml", "conflict_policy 必须为 reject-overlap"))
        writers = ownership.get("active_cocos_writers")
        if not isinstance(writers, list):
            issues.append(
                _issue("invalid-cocos-writers", state_dir / "ownership.yaml", "active_cocos_writers 必须为列表")
            )
        elif len(writers) > 1:
            issues.append(
                _issue(
                    "multiple-cocos-writers",
                    state_dir / "ownership.yaml",
                    "同一时间最多允许一个 Cocos Editor 写者",
                )
            )

    gates = documents.get("quality-gates.yaml")
    if gates is not None:
        issues.extend(_validate_quality_gates(gates, state_dir / "quality-gates.yaml"))
    return issues


def main() -> int:
    """解析项目根目录，打印校验结果并返回约定的进程状态码。"""
    parser = argparse.ArgumentParser(description="校验 Cocos Web Mobile 工作流状态")
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()

    issues = validate_workflow(args.project_root)
    if not issues:
        print("workflow valid")
        return 0
    for issue in issues:
        print(f"{issue.code} | {issue.path} | {issue.message}")
    return 2 if any(issue.code == "invalid-state-file" for issue in issues) else 1


if __name__ == "__main__":
    sys.exit(main())
