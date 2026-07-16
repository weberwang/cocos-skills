from __future__ import annotations

import argparse
import hashlib
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from workflow_common import (
    WorkflowError,
    content_hash,
    document_content_hash,
    read_markdown,
    read_yaml,
    workflow_dir,
)


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
    "systems-design",
    "technical-design",
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
    "systems-design",
    "technical-design",
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
        "review_mode": str,
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
    if profile.get("review_mode") not in {"full", "lean"}:
        issues.append(_issue("invalid-review-mode", path, "review_mode 仅支持 full 或 lean，硬门禁不得跳过"))

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


def _rewind_target(workflow: Mapping[str, Any], transition: Mapping[str, Any]) -> str | None:
    """从失效工件声明推导唯一允许的最早回退阶段。"""
    artifact_ids = transition.get("artifact_ids")
    artifacts = workflow.get("artifacts")
    if not isinstance(artifact_ids, list) or not artifact_ids or not isinstance(artifacts, Mapping):
        return None
    stages: list[str] = []
    for artifact_id in artifact_ids:
        artifact = artifacts.get(artifact_id)
        if not isinstance(artifact, Mapping) or artifact.get("stage") not in MAIN_STATES:
            return None
        stages.append(artifact["stage"])
    return min(stages, key=MAIN_STATE_SEQUENCE.index)


def _validate_transitions(
    workflow: Mapping[str, Any], project_root: Path, state_dir: Path, path: Path
) -> list[ValidationIssue]:
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
            is_forward = MAIN_STATE_SEQUENCE.index(to_state) == MAIN_STATE_SEQUENCE.index(from_state) + 1
            is_rewind = (
                MAIN_STATE_SEQUENCE.index(to_state) <= MAIN_STATE_SEQUENCE.index(from_state)
                and from_status == "stale"
                and to_status == "pending"
                and transition["reason"] == "upstream-change"
                and _rewind_target(workflow, transition) == to_state
            )
            valid = valid and ((is_forward and from_status == "passed" and to_status == "pending") or is_rewind)
        if index == 0:
            valid = valid and from_state == "bootstrap" and from_status == "pending"
        if previous is not None:
            valid = valid and previous.get("to_state") == from_state
            valid = valid and previous.get("to_run_status") == from_status
        if not valid:
            issues.append(_issue("invalid-transition", path, f"transitions[{index}] 迁移非法或与前项不连续"))
        issues.extend(
            _validate_existing_paths(
                transition.get("evidence"),
                project_root=project_root,
                state_dir=state_dir,
                path=path,
                field=f"transitions[{index}].evidence",
                missing_code="missing-evidence-path",
            )
        )
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
        if p0.get("require_vertical_slice") is not True:
            issues.append(_issue("vertical-slice-required", path, "P0.require_vertical_slice 必须为 true"))
        if p0.get("visual_design_quality") is not True:
            issues.append(_issue("visual-design-quality-required", path, "P0.visual_design_quality 必须为 true"))
    return issues

VISUAL_KEYS = {"visual", "visual_direction", "scene_concept"}
VISUAL_TYPES = {"visual", "visual-direction", "scene-concept"}
SHA256_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")

# 阶段离开后必须保留可复算的工件和与该工件哈希绑定的总控门禁。
STAGE_ARTIFACTS = (
    ("requirements", "requirements", "requirements.md", "approved", "requirements_version"),
    ("systems-design", "systems-design", "artifacts/systems-design.md", "approved", "systems_design_version"),
    ("technical-design", "technical-design", "artifacts/technical-design.md", "approved", "technical_design_version"),
    ("visual-direction", "visual-direction", "artifacts/visual-direction.md", "frozen", "visual_direction_version"),
    ("scene-concepts", "scene-concepts", "artifacts/scene-concepts.md", "approved", None),
    ("planning", "implementation-plan", "artifacts/implementation-plan.md", "approved", "plan_version"),
    ("production", "game-assets", "artifacts/game-assets.yaml", "approved", "asset_set_version"),
    ("verification", "verification", "artifacts/verification.md", "passed", None),
    ("delivery", "delivery", "artifacts/delivery.md", "passed", None),
)


def _artifact_hash_source(artifact: Mapping[str, Any]) -> dict[str, Any]:
    """返回可复算的工件哈希来源，排除审批对自身哈希的回填字段。"""
    source = dict(artifact)
    source.pop("content_hash", None)
    approval = source.get("approval")
    if isinstance(approval, Mapping):
        normalized_approval = dict(approval)
        normalized_approval.pop("subject_hash", None)
        source["approval"] = normalized_approval
    return source


def _read_artifact(path: Path) -> tuple[dict[str, Any], str | None]:
    """按工件格式读取元数据；Markdown 的正文参与哈希校验。"""
    if path.suffix == ".md":
        return read_markdown(path)
    return read_yaml(path), None


def _artifact_hash_matches(artifact: Mapping[str, Any], body: str | None) -> bool:
    """校验工件哈希，避免 Markdown 正文变更绕过批准门禁。"""
    stored_hash = artifact.get("content_hash")
    expected_hash = (
        document_content_hash(artifact, body)
        if body is not None
        else content_hash(_artifact_hash_source(artifact))
    )
    return isinstance(stored_hash, str) and bool(SHA256_PATTERN.fullmatch(stored_hash)) and stored_hash == expected_hash


def _is_safe_relative_path(project_root: Path, state_dir: Path, value: Any) -> tuple[Path | None, str | None]:
    """解析项目内路径并阻止绝对路径、穿越和链接逃逸。"""
    if not isinstance(value, str) or not value.strip():
        return None, "path must be a non-empty string"
    if "\\" in value or re.match(r"^[A-Za-z]:", value):
        return None, "path must use a safe POSIX relative form"
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or ".." in candidate.parts or str(candidate) in {"", "."}:
        return None, "path escapes the project root"

    # 工作流工件使用 .cocos-workflow 相对路径，其余变更仍以项目根目录为基准。
    workflow_prefixes = {"art", "artifacts", "reports", "tasks", "results"}
    workflow_files = {"requirements.md", "project-profile.yaml", "quality-gates.yaml", "ownership.yaml", "workflow.yaml"}
    base = state_dir if candidate.parts[0] in workflow_prefixes or value in workflow_files else project_root
    resolved_root = project_root.resolve()
    resolved_path = (base / Path(*candidate.parts)).resolve()
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError:
        return None, "path resolves outside the project root"
    return resolved_path, None


def _validate_existing_paths(
    value: Any,
    *,
    project_root: Path,
    state_dir: Path,
    path: Path,
    field: str,
    missing_code: str,
) -> list[ValidationIssue]:
    """校验一组声明路径真实存在且没有借助链接或父目录逃逸项目范围。"""
    if not isinstance(value, list):
        return [_issue("invalid-path-list", path, f"{field} 必须为路径列表")]
    issues: list[ValidationIssue] = []
    for index, item in enumerate(value):
        resolved, error = _is_safe_relative_path(project_root, state_dir, item)
        if error is not None:
            issues.append(_issue("unsafe-path", path, f"{field}[{index}] {error}"))
        elif resolved is None or not resolved.exists():
            issues.append(_issue(missing_code, path, f"{field}[{index}] 指向的项目内路径不存在"))
    return issues


def _stage_is_complete(workflow: Mapping[str, Any], stage: str) -> bool:
    """判定阶段已被验收并离开，避免要求当前尚未产出的未来工件。"""
    current_state = workflow.get("state")
    if current_state not in MAIN_STATES:
        return False
    current_index = MAIN_STATE_SEQUENCE.index(current_state)
    stage_index = MAIN_STATE_SEQUENCE.index(stage)
    return current_index > stage_index or (
        current_state == stage and workflow.get("run_status") == "passed"
    )


def _file_hash(path: Path) -> str | None:
    """计算单个二进制文件的 SHA-256，文件不可读时返回空值。"""
    try:
        return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
    except OSError:
        return None


def _validate_visual_reference_effect_images(
    artifact: Mapping[str, Any], artifact_path: Path, state_dir: Path
) -> list[ValidationIssue]:
    """验证冻结视觉方向恰好包含两张已批准的参考效果图。"""
    images = artifact.get("reference_effect_images")
    if not isinstance(images, list) or len(images) != 2:
        return [_issue("invalid-visual-reference-images", artifact_path, "视觉方向必须包含恰好两张参考效果图")]

    issues: list[ValidationIssue] = []
    seen_references: set[tuple[str, str]] = set()
    for index, image in enumerate(images, start=1):
        image_path = image.get("path") if isinstance(image, Mapping) else None
        image_hash = image.get("content_hash") if isinstance(image, Mapping) else None
        valid = (
            isinstance(image, Mapping)
            and isinstance(image_path, str)
            and image_path.startswith("art/visual-references/")
            and isinstance(image.get("purpose"), str)
            and bool(image["purpose"].strip())
            and isinstance(image.get("prompt_hash"), str)
            and bool(SHA256_PATTERN.fullmatch(image["prompt_hash"]))
            and isinstance(image.get("generator"), Mapping)
            and image["generator"].get("tool") == "imagegen"
            and isinstance(image_hash, str)
            and bool(SHA256_PATTERN.fullmatch(image_hash))
            and _file_hash(state_dir / image_path) == image_hash
            and image.get("review_status") == "approved"
        )
        if isinstance(image_path, str) and isinstance(image_hash, str):
            if (image_path, image_hash) in seen_references:
                valid = False
            seen_references.add((image_path, image_hash))
        if not valid:
            issues.append(
                _issue(
                    "invalid-visual-reference-image",
                    artifact_path,
                    f"第 {index} 张参考效果图缺少必要证据或未获批准",
                )
            )
    return issues


def _validate_scene_concept_design_evidence(
    artifact: Mapping[str, Any], artifact_path: Path, frozen_direction: Mapping[str, Any] | None
) -> list[ValidationIssue]:
    """验证场景高保真图继承已批准草图与冻结的全局视觉方向。"""
    issues: list[ValidationIssue] = []
    expected_references = (
        frozen_direction.get("reference_effect_images")
        if isinstance(frozen_direction, Mapping)
        else None
    )
    references_match = (
        isinstance(expected_references, list)
        and len(expected_references) == 2
        and artifact.get("frozen_reference_effect_images")
        == [
            {"path": image.get("path"), "content_hash": image.get("content_hash")}
            for image in expected_references
            if isinstance(image, Mapping)
        ]
    )
    visual_matches = (
        isinstance(frozen_direction, Mapping)
        and artifact.get("visual_direction_version") == frozen_direction.get("visual_direction_version")
        and artifact.get("visual_direction_hash") == frozen_direction.get("content_hash")
        and references_match
    )
    if not visual_matches:
        issues.append(
            _issue(
                "scene-concept-visual-mismatch",
                artifact_path,
                "场景效果图未逐项绑定当前冻结视觉方向及两张参考效果图",
            )
        )

    scenes = artifact.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        return issues + [_issue("invalid-scene-concept-scenes", artifact_path, "场景效果图清单不得为空")]

    for scene in scenes:
        pencil_draft = scene.get("pencil_draft") if isinstance(scene, Mapping) else None
        review = pencil_draft.get("review") if isinstance(pencil_draft, Mapping) else None
        valid_draft = (
            isinstance(pencil_draft, Mapping)
            and isinstance(pencil_draft.get("path"), str)
            and bool(pencil_draft["path"].strip())
            and isinstance(pencil_draft.get("content_hash"), str)
            and bool(SHA256_PATTERN.fullmatch(pencil_draft["content_hash"]))
            and isinstance(review, Mapping)
            and review.get("status") == "approved"
            and review.get("subject_hash") == pencil_draft["content_hash"]
        )
        if not valid_draft:
            issues.append(
                _issue(
                    "invalid-scene-pencil-draft",
                    artifact_path,
                    "场景效果图缺少已批准且哈希绑定的 Pencil 草图",
                )
            )
    return issues


def _validate_business_flow_order(
    artifact: Mapping[str, Any], artifact_path: Path, task_map: Mapping[str, Mapping[str, Any]]
) -> list[ValidationIssue]:
    """校验模块和页面按连续业务流等级串行推进。"""
    levels = artifact.get("business_flow_levels")
    if not isinstance(levels, list) or not levels:
        return [_issue("missing-business-flow-levels", artifact_path, "实施计划必须定义业务流等级")]

    issues: list[ValidationIssue] = []
    level_definitions: dict[int, Mapping[str, Any]] = {}
    module_level: dict[str, int] = {}
    page_level: dict[str, int] = {}
    completion_by_level: dict[int, set[str]] = {}
    for entry in levels:
        if not isinstance(entry, Mapping):
            issues.append(_issue("invalid-business-flow-level", artifact_path, "业务流等级必须为映射"))
            continue
        level = entry.get("level")
        name = entry.get("name")
        module_ids = entry.get("module_ids")
        page_ids = entry.get("page_ids")
        completion_task_ids = entry.get("completion_task_ids")
        valid = (
            type(level) is int
            and level > 0
            and isinstance(name, str)
            and bool(name.strip())
            and isinstance(module_ids, list)
            and bool(module_ids)
            and all(isinstance(item, str) and item.strip() for item in module_ids)
            and isinstance(page_ids, list)
            and bool(page_ids)
            and all(isinstance(item, str) and item.strip() for item in page_ids)
            and isinstance(completion_task_ids, list)
            and bool(completion_task_ids)
            and all(isinstance(item, str) and item.strip() for item in completion_task_ids)
        )
        if not valid or level in level_definitions:
            issues.append(_issue("invalid-business-flow-level", artifact_path, "业务流等级字段缺失、重复或为空"))
            continue
        level_definitions[level] = entry
        completion_by_level[level] = set(completion_task_ids)
        for module_id in module_ids:
            if module_id in module_level:
                issues.append(_issue("duplicate-business-flow-module", artifact_path, f"模块 {module_id} 归属多个业务流等级"))
            module_level[module_id] = level
        for page_id in page_ids:
            if page_id in page_level:
                issues.append(_issue("duplicate-business-flow-page", artifact_path, f"页面 {page_id} 归属多个业务流等级"))
            page_level[page_id] = level

    expected_levels = set(range(1, len(level_definitions) + 1))
    if set(level_definitions) != expected_levels:
        issues.append(_issue("noncontiguous-business-flow-levels", artifact_path, "业务流等级必须从 1 连续递增"))

    modules = artifact.get("module_decomposition", {}).get("modules") if isinstance(artifact.get("module_decomposition"), Mapping) else None
    if not isinstance(modules, list):
        issues.append(_issue("missing-business-flow-modules", artifact_path, "模块拆分必须声明模块业务流等级"))
    else:
        defined_modules: set[str] = set()
        for module in modules:
            module_id = module.get("id") if isinstance(module, Mapping) else None
            level = module.get("business_flow_level") if isinstance(module, Mapping) else None
            if not isinstance(module_id, str) or not module_id.strip() or module_level.get(module_id) != level:
                issues.append(_issue("module-business-flow-mismatch", artifact_path, "模块未与业务流等级清单一致"))
                continue
            defined_modules.add(module_id)
            depends_on = module.get("depends_on", [])
            if not isinstance(depends_on, list) or any(
                module_level.get(dependency_id) is None or module_level[dependency_id] > level
                for dependency_id in depends_on
            ):
                issues.append(_issue("invalid-module-business-flow-dependency", artifact_path, f"模块 {module_id} 依赖未就绪模块"))
        if defined_modules != set(module_level):
            issues.append(_issue("incomplete-business-flow-modules", artifact_path, "业务流等级与模块拆分未一一对应"))

    scene_loops = artifact.get("scene_loops")
    if not isinstance(scene_loops, list):
        issues.append(_issue("missing-business-flow-pages", artifact_path, "场景循环必须声明页面业务流等级"))
    else:
        defined_pages: set[str] = set()
        for loop in scene_loops:
            scene_id = loop.get("scene_id") if isinstance(loop, Mapping) else None
            level = loop.get("business_flow_level") if isinstance(loop, Mapping) else None
            if not isinstance(scene_id, str) or not scene_id.strip() or page_level.get(scene_id) != level:
                issues.append(_issue("page-business-flow-mismatch", artifact_path, "页面未与业务流等级清单一致"))
                continue
            defined_pages.add(scene_id)
        if defined_pages != set(page_level):
            issues.append(_issue("incomplete-business-flow-pages", artifact_path, "业务流等级与页面循环未一一对应"))

    for level, completion_task_ids in completion_by_level.items():
        for task_id in completion_task_ids:
            task = task_map.get(task_id)
            if task is None or task.get("business_flow_level") != level:
                issues.append(_issue("invalid-business-flow-completion", artifact_path, f"等级 {level} 的完成任务 {task_id} 无效"))

    slice_task_ids: set[str] = set()
    slice_def = artifact.get("vertical_slice")
    if isinstance(slice_def, Mapping) and isinstance(slice_def.get("task_ids"), list):
        slice_task_ids = {
            item for item in slice_def["task_ids"] if isinstance(item, str) and item.strip()
        }

    for task_id, task in task_map.items():
        kind = task.get("kind")
        # 核心玩法原型任务不参与业务流等级串行门禁
        if kind in {"core-gameplay-code", "vertical-slice-review"} or task_id in slice_task_ids:
            continue
        level = task.get("business_flow_level")
        depends_on = task.get("depends_on", [])
        if type(level) is not int or level not in level_definitions:
            issues.append(_issue("missing-task-business-flow-level", artifact_path, f"任务 {task_id} 缺少有效业务流等级"))
            continue
        if not isinstance(depends_on, list):
            continue
        if level > 1 and not completion_by_level.get(level - 1, set()).issubset(set(depends_on)):
            issues.append(_issue("missing-business-flow-gate", artifact_path, f"任务 {task_id} 未依赖前一业务流等级完成门禁"))
        for dependency_id in depends_on:
            dependency = task_map.get(dependency_id)
            if dependency is not None and dependency.get("business_flow_level", level) > level:
                issues.append(_issue("invalid-business-flow-dependency", artifact_path, f"任务 {task_id} 依赖更高业务流等级任务"))
        scene_id = task.get("scene_id")
        if isinstance(scene_id, str) and page_level.get(scene_id) != level:
            issues.append(_issue("task-page-business-flow-mismatch", artifact_path, f"任务 {task_id} 与页面 {scene_id} 的业务流等级不一致"))
        for module_id in task.get("module_ids", []):
            if module_level.get(module_id) is None or module_level[module_id] > level:
                issues.append(_issue("task-module-business-flow-mismatch", artifact_path, f"任务 {task_id} 引用了未就绪模块 {module_id}"))
    return issues


def _validate_implementation_plan_tasks(
    artifact: Mapping[str, Any], artifact_path: Path
) -> list[ValidationIssue]:
    """验证计划中的核心玩法原型、模块拆分与正式场景设计/代码任务依赖形成不可绕过的 DAG。"""
    tasks = artifact.get("tasks")
    if not isinstance(tasks, list):
        return [_issue("invalid-plan-tasks", artifact_path, "实施计划必须包含 tasks 列表")]
    task_map = {
        task.get("task_id"): task
        for task in tasks
        if isinstance(task, Mapping) and isinstance(task.get("task_id"), str)
    }
    issues: list[ValidationIssue] = []
    issues.extend(_validate_business_flow_order(artifact, artifact_path, task_map))
    issues.extend(_validate_core_gameplay_first(artifact, artifact_path, task_map))

    module_ids = {task_id for task_id, task in task_map.items() if task.get("kind") == "module_decomposition"}
    scaffold_ids = {task_id for task_id, task in task_map.items() if task.get("kind") == "global_scaffold"}
    slice_review_ids = {
        task_id for task_id, task in task_map.items() if task.get("kind") == "vertical-slice-review"
    }
    by_scene: dict[str, dict[str, str]] = {}
    for task_id, task in task_map.items():
        kind = task.get("kind")
        scene_id = task.get("scene_id")
        if kind in {"pencil-draft", "visual-concept", "code", "asset-preparation"}:
            if not isinstance(scene_id, str) or not scene_id.strip():
                issues.append(_issue("missing-task-scene", artifact_path, f"任务 {task_id} 缺少 scene_id"))
                continue
            by_scene.setdefault(scene_id, {})[str(kind)] = task_id
        depends_on = task.get("depends_on")
        # 核心玩法代码与首个垂直切片审阅任务允许空 depends_on；其余正式任务必须声明依赖
        if kind not in {"core-gameplay-code", "vertical-slice-review"} and (
            not isinstance(depends_on, list) or not depends_on
        ):
            issues.append(_issue("missing-task-dependency", artifact_path, f"任务 {task_id} 缺少 depends_on"))

    for task_id in module_ids | scaffold_ids:
        depends_on = set(task_map[task_id].get("depends_on") or [])
        if not slice_review_ids.intersection(depends_on) and not (
            task_map[task_id].get("kind") == "global_scaffold" and module_ids.intersection(depends_on)
        ):
            # 全局骨架可通过依赖模块拆分间接依赖切片；模块拆分必须直接依赖切片审阅
            if task_map[task_id].get("kind") == "module_decomposition":
                issues.append(
                    _issue(
                        "missing-core-gameplay-gate",
                        artifact_path,
                        f"任务 {task_id} 未依赖核心玩法确认门禁",
                    )
                )

    for scene_id, task_ids in by_scene.items():
        pencil_id = task_ids.get("pencil-draft")
        concept_id = task_ids.get("visual-concept")
        for required in ("pencil-draft", "visual-concept", "code", "asset-preparation"):
            if required not in task_ids:
                issues.append(_issue("incomplete-scene-loop", artifact_path, f"场景 {scene_id} 缺少 {required} 任务"))
        if concept_id and pencil_id and pencil_id not in task_map[concept_id].get("depends_on", []):
            issues.append(_issue("missing-pencil-dependency", artifact_path, f"场景 {scene_id} 高保真任务未依赖 Pencil 草图"))
        for kind in ("code", "asset-preparation"):
            task_id = task_ids.get(kind)
            if not task_id:
                continue
            depends_on = task_map[task_id].get("depends_on", [])
            if concept_id not in depends_on:
                issues.append(_issue("missing-visual-concept-dependency", artifact_path, f"场景 {scene_id} 的 {kind} 未依赖高保真图"))
            if kind == "code" and (not module_ids.intersection(depends_on) or not scaffold_ids.intersection(depends_on)):
                issues.append(_issue("missing-code-foundation-dependency", artifact_path, f"场景 {scene_id} 代码任务缺少模块拆分或全局骨架依赖"))
            if kind == "code" and slice_review_ids and not slice_review_ids.intersection(depends_on):
                # 正式代码应直接或经由 scaffold/modules 依赖切片；要求显式依赖其一即可在 core_gameplay_first 校验
                pass
    return issues


def _validate_core_gameplay_first(
    artifact: Mapping[str, Any],
    artifact_path: Path,
    task_map: Mapping[str, Mapping[str, Any]],
) -> list[ValidationIssue]:
    """确保核心玩法原型优先于模块拆分与正式场景循环。"""
    slice_def = artifact.get("vertical_slice")
    if not isinstance(slice_def, Mapping):
        return [_issue("missing-vertical-slice-definition", artifact_path, "实施计划必须定义核心玩法垂直切片")]

    issues: list[ValidationIssue] = []
    scene_ids = slice_def.get("scene_ids")
    formal_loop_ids = slice_def.get("formal_scene_loop_ids")
    task_ids = slice_def.get("task_ids")
    mode = slice_def.get("implementation_mode")
    if mode != "prototype":
        issues.append(_issue("invalid-vertical-slice-mode", artifact_path, "核心玩法垂直切片必须为 prototype 模式"))
    if not isinstance(scene_ids, list) or not scene_ids or not all(isinstance(item, str) and item.strip() for item in scene_ids):
        issues.append(_issue("invalid-vertical-slice-scenes", artifact_path, "垂直切片必须声明非空 scene_ids"))
    if not isinstance(formal_loop_ids, list) or not formal_loop_ids:
        issues.append(_issue("invalid-vertical-slice-formal-loops", artifact_path, "垂直切片必须映射正式 scene_loop id"))
    if not isinstance(task_ids, list) or not task_ids:
        issues.append(_issue("invalid-vertical-slice-tasks", artifact_path, "垂直切片必须声明原型 task_ids"))

    scene_loops = artifact.get("scene_loops")
    loop_by_id = {
        loop.get("id"): loop
        for loop in scene_loops
        if isinstance(scene_loops, list) and isinstance(loop, Mapping) and isinstance(loop.get("id"), str)
    }
    core_scenes_from_loops: set[str] = set()
    if isinstance(formal_loop_ids, list):
        for loop_id in formal_loop_ids:
            loop = loop_by_id.get(loop_id)
            if loop is None:
                issues.append(_issue("missing-formal-core-scene-loop", artifact_path, f"正式玩法循环 {loop_id} 未定义"))
                continue
            if loop.get("is_core_gameplay") is not True:
                issues.append(
                    _issue(
                        "formal-core-scene-not-marked",
                        artifact_path,
                        f"正式玩法循环 {loop_id} 必须标记 is_core_gameplay",
                    )
                )
            scene_id = loop.get("scene_id")
            if isinstance(scene_id, str):
                core_scenes_from_loops.add(scene_id)
            depends_on = loop.get("depends_on") or []
            slice_review_ids = {
                tid for tid, task in task_map.items() if task.get("kind") == "vertical-slice-review"
            }
            if isinstance(depends_on, list) and slice_review_ids and not slice_review_ids.intersection(depends_on):
                issues.append(
                    _issue(
                        "formal-loop-missing-core-gate",
                        artifact_path,
                        f"正式玩法循环 {loop_id} 未依赖核心玩法确认门禁",
                    )
                )
    if isinstance(scene_ids, list) and core_scenes_from_loops and set(scene_ids) != core_scenes_from_loops:
        issues.append(
            _issue(
                "vertical-slice-formal-scene-mismatch",
                artifact_path,
                "vertical_slice.scene_ids 必须与正式玩法循环 scene_id 集合一致",
            )
        )

    if isinstance(task_ids, list):
        for task_id in task_ids:
            task = task_map.get(task_id)
            if task is None:
                issues.append(_issue("missing-vertical-slice-task", artifact_path, f"垂直切片任务 {task_id} 未定义"))
                continue
            kind = task.get("kind")
            if kind not in {"core-gameplay-code", "integration", "vertical-slice-review"} and not (
                isinstance(kind, str) and kind.startswith("verification")
            ):
                # 允许验证类任务出现在切片路径；禁止正式设计任务混入原型
                if kind in {"pencil-draft", "visual-concept", "module_decomposition", "global_scaffold", "code", "asset-preparation"}:
                    issues.append(
                        _issue(
                            "formal-task-in-prototype-slice",
                            artifact_path,
                            f"正式任务 {task_id}（{kind}）不得进入核心玩法原型路径",
                        )
                    )
    return issues


def _validate_stage_artifacts(
    workflow: Mapping[str, Any], project_root: Path, state_dir: Path
) -> list[ValidationIssue]:
    """验证已完成阶段的工件内容、审批绑定及总控门禁，拒绝伪造推进。"""
    issues: list[ValidationIssue] = []
    gates = workflow.get("approval_gates")
    for state, gate_name, relative_path, expected_status, version_field in STAGE_ARTIFACTS:
        if not _stage_is_complete(workflow, state):
            continue
        artifact_path = state_dir / relative_path
        if not artifact_path.is_file():
            issues.append(_issue("missing-stage-artifact", artifact_path, f"{state} 阶段缺少必需工件"))
            continue
        try:
            artifact, body = _read_artifact(artifact_path)
        except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
            issues.append(_issue("invalid-state-file", artifact_path, str(error)))
            continue

        valid = (
            type(artifact.get("schema_version")) is int
            and artifact.get("status") == expected_status
            and _artifact_hash_matches(artifact, body)
        )
        if version_field is not None:
            valid = valid and bool(artifact.get(version_field))
        if not valid:
            issues.append(_issue("invalid-stage-artifact", artifact_path, f"{state} 工件的 schema、状态或内容哈希无效"))

        if state == "visual-direction":
            issues.extend(_validate_visual_reference_effect_images(artifact, artifact_path, state_dir))
        if state == "planning":
            issues.extend(_validate_implementation_plan_tasks(artifact, artifact_path))

        if state in {"requirements", "systems-design", "technical-design", "visual-direction", "scene-concepts", "planning", "production"}:
            approval = artifact.get("approval")
            approved_status = "approved"
            valid_approval = (
                isinstance(approval, Mapping)
                and approval.get("status") == approved_status
                and isinstance(approval.get("approved_by"), str)
                and bool(approval.get("approved_by", "").strip())
                and isinstance(approval.get("approved_at"), str)
                and bool(approval.get("approved_at", "").strip())
                and approval.get("subject_hash") == artifact.get("content_hash")
            )
            if not valid_approval:
                issues.append(_issue("invalid-artifact-approval", artifact_path, f"{state} 工件审批未绑定当前内容哈希"))

        gate = gates.get(gate_name) if isinstance(gates, Mapping) else None
        valid_gate = (
            isinstance(gate, Mapping)
            and gate.get("status") == "passed"
            and isinstance(gate.get("approved_by"), str)
            and bool(gate.get("approved_by", "").strip())
            and isinstance(gate.get("approved_at"), str)
            and bool(gate.get("approved_at", "").strip())
            and gate.get("subject_hash") == artifact.get("content_hash")
        )
        if gate is None:
            issues.append(_issue("missing-stage-approval-gate", state_dir / "workflow.yaml", f"{state} 阶段缺少哈希绑定门禁"))
        elif not valid_gate:
            issues.append(_issue("stage-approval-mismatch", state_dir / "workflow.yaml", f"{state} 阶段门禁未绑定当前工件哈希"))

        if state == "visual-direction" and isinstance(workflow.get("visual_direction"), Mapping):
            visual = workflow["visual_direction"]
            if (
                visual.get("version") != artifact.get("visual_direction_version")
                or visual.get("content_hash") != artifact.get("content_hash")
            ):
                issues.append(_issue("visual-direction-mismatch", state_dir / "workflow.yaml", "总控视觉方向与冻结工件不一致"))
    return issues


def _validate_vertical_slice_gate(
    workflow: Mapping[str, Any], state_dir: Path
) -> list[ValidationIssue]:
    """确保离开 production 后保留可复算且人工批准的垂直切片证据。"""
    if not _stage_is_complete(workflow, "production"):
        return []

    artifact_path = state_dir / "artifacts" / "vertical-slice.md"
    if not artifact_path.is_file():
        return [_issue("missing-vertical-slice", artifact_path, "离开 production 前必须通过垂直切片门禁")]
    try:
        artifact, body = _read_artifact(artifact_path)
    except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
        return [_issue("invalid-state-file", artifact_path, str(error))]

    plan_path = state_dir / "artifacts" / "implementation-plan.md"
    try:
        plan, _ = _read_artifact(plan_path)
    except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
        return [_issue("invalid-vertical-slice-plan", plan_path, f"无法校验垂直切片计划绑定：{error}")]

    approval = artifact.get("approval")
    valid_artifact = (
        type(artifact.get("schema_version")) is int
        and artifact.get("status") == "passed"
        and _artifact_hash_matches(artifact, body)
        and artifact.get("implementation_plan_hash") == plan.get("content_hash")
    )
    valid_approval = (
        isinstance(approval, Mapping)
        and approval.get("status") == "approved"
        and isinstance(approval.get("approved_by"), str)
        and bool(approval.get("approved_by", "").strip())
        and isinstance(approval.get("approved_at"), str)
        and bool(approval.get("approved_at", "").strip())
        and approval.get("subject_hash") == artifact.get("content_hash")
    )
    gates = workflow.get("approval_gates")
    gate = gates.get("vertical-slice") if isinstance(gates, Mapping) else None
    valid_gate = (
        isinstance(gate, Mapping)
        and gate.get("status") == "passed"
        and gate.get("subject_hash") == artifact.get("content_hash")
        and isinstance(gate.get("approved_by"), str)
        and bool(gate.get("approved_by", "").strip())
        and isinstance(gate.get("approved_at"), str)
        and bool(gate.get("approved_at", "").strip())
    )
    issues: list[ValidationIssue] = []
    if not valid_artifact:
        issues.append(_issue("invalid-vertical-slice", artifact_path, "垂直切片工件状态、计划绑定或内容哈希无效"))
    if not valid_approval:
        issues.append(_issue("invalid-vertical-slice-approval", artifact_path, "垂直切片人工批准未绑定当前内容哈希"))
    if not valid_gate:
        issues.append(_issue("vertical-slice-gate-mismatch", state_dir / "workflow.yaml", "垂直切片总控门禁未绑定当前工件哈希"))
    return issues


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


def _validate_decision_change_gate(
    task_id: str,
    task: Mapping[str, Any],
    workflow: Mapping[str, Any],
    task_path: Path,
    project_root: Path,
    state_dir: Path,
) -> list[ValidationIssue]:
    """校验决策性返工的拷问确认与总控门禁绑定，避免跳过用户确认。"""
    change = task.get("decision_change")
    if change is None:
        return []
    if not isinstance(change, Mapping):
        return [_issue("invalid-decision-change", task_path, f"任务 {task_id} 的 decision_change 必须为映射")]

    stage = change.get("stage")
    subject_hash = change.get("subject_hash")
    valid_change = (
        stage in {"requirements", "systems-design", "technical-design", "planning"}
        and isinstance(subject_hash, str)
        and bool(SHA256_PATTERN.fullmatch(subject_hash))
    )
    if not valid_change:
        return [_issue("invalid-decision-change", task_path, f"任务 {task_id} 的决策变更阶段或主题哈希无效")]
    if task.get("role") == "grilling":
        return []

    confirmation = task.get("grilling_confirmation")
    valid_confirmation = (
        isinstance(confirmation, Mapping)
        and confirmation.get("status") == "confirmed"
        and confirmation.get("stage") == stage
        and confirmation.get("subject_hash") == subject_hash
        and isinstance(confirmation.get("confirmed_by"), str)
        and bool(confirmation.get("confirmed_by", "").strip())
        and isinstance(confirmation.get("confirmed_at"), str)
        and bool(confirmation.get("confirmed_at", "").strip())
        and isinstance(confirmation.get("evidence"), list)
        and bool(confirmation.get("evidence"))
    )
    if not valid_confirmation:
        return [_issue("missing-grilling-confirmation", task_path, f"任务 {task_id} 缺少匹配的拷问确认")]

    gates = workflow.get("approval_gates")
    gate = gates.get(f"grilling-{stage}") if isinstance(gates, Mapping) else None
    valid_gate = (
        isinstance(gate, Mapping)
        and gate.get("status") == "passed"
        and gate.get("subject_hash") == subject_hash
        and gate.get("approved_by") == confirmation.get("confirmed_by")
        and gate.get("approved_at") == confirmation.get("confirmed_at")
        and gate.get("evidence") == confirmation.get("evidence")
    )
    if not valid_gate:
        return [_issue("missing-grilling-gate", task_path, f"任务 {task_id} 缺少匹配的总控拷问门禁")]
    return _validate_existing_paths(
        confirmation["evidence"],
        project_root=project_root,
        state_dir=state_dir,
        path=task_path,
        field="grilling_confirmation.evidence",
        missing_code="missing-grilling-evidence",
    )


def _validate_task(
    task_id: str,
    task: Any,
    workflow: Mapping[str, Any],
    task_path: Path,
    project_root: Path,
    state_dir: Path,
) -> list[ValidationIssue]:
    """独立校验单个任务或结果的通过证据和视觉输入冻结信息。"""
    if not isinstance(task, Mapping):
        return []
    issues: list[ValidationIssue] = []
    issues.extend(_validate_decision_change_gate(task_id, task, workflow, task_path, project_root, state_dir))
    status = task.get("status", task.get("state"))
    evidence = task.get("evidence")
    if status == "passed" and not evidence:
        issues.append(
            _issue("missing-task-evidence", task_path, f"passed 任务 {task_id} 必须包含非空 evidence")
        )
    if status == "passed" and evidence:
        issues.extend(
            _validate_existing_paths(
                evidence,
                project_root=project_root,
                state_dir=state_dir,
                path=task_path,
                field="evidence",
                missing_code="missing-evidence-path",
            )
        )
    for field, missing_code in (
        ("output_paths", "missing-output-path"),
        ("changed_paths", "missing-changed-path"),
    ):
        if status == "passed" and field in task:
            issues.extend(
                _validate_existing_paths(
                    task[field],
                    project_root=project_root,
                    state_dir=state_dir,
                    path=task_path,
                    field=field,
                    missing_code=missing_code,
                )
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
    if status == "passed" and task.get("kind") in {"code", "asset-preparation"}:
        approvals = task.get("design_approvals")
        valid_approvals = (
            isinstance(approvals, Mapping)
            and isinstance(approvals.get("pencil_source_hash"), str)
            and bool(SHA256_PATTERN.fullmatch(approvals["pencil_source_hash"]))
            and isinstance(approvals.get("visual_concept_hash"), str)
            and bool(SHA256_PATTERN.fullmatch(approvals["visual_concept_hash"]))
        )
        if not valid_approvals:
            issues.append(_issue("missing-design-approvals", task_path, f"任务 {task_id} 缺少已批准的草图和高保真哈希"))
    if status == "passed" and task.get("kind") == "visual-concept":
        concept_path = task.get("scene_concept_artifact")
        if not isinstance(concept_path, str) or not concept_path.startswith("artifacts/scene-concepts/"):
            issues.append(_issue("missing-scene-concept-artifact", task_path, f"任务 {task_id} 缺少场景效果图工件"))
        else:
            try:
                concept, _ = _read_artifact(state_dir / concept_path)
                frozen, _ = _read_artifact(state_dir / "artifacts" / "visual-direction.md")
                expected_references = [
                    {"path": item.get("path"), "content_hash": item.get("content_hash")}
                    for item in frozen.get("reference_effect_images", [])
                    if isinstance(item, Mapping)
                ]
                image_path = concept.get("image_path")
                valid_concept = (
                    concept.get("status") == "approved"
                    and concept.get("visual_direction_version") == frozen.get("visual_direction_version")
                    and concept.get("visual_direction_hash") == frozen.get("content_hash")
                    and concept.get("frozen_reference_effect_images") == expected_references
                    and isinstance(image_path, str)
                    and _file_hash(state_dir / image_path) == concept.get("image_hash")
                    and isinstance(concept.get("generator"), Mapping)
                    and concept["generator"].get("tool") == "imagegen"
                )
                if not valid_concept:
                    issues.append(_issue("invalid-scene-concept-evidence", task_path, f"任务 {task_id} 的效果图未绑定冻结视觉或真实图像"))
            except (WorkflowError, yaml.YAMLError, UnicodeError, OSError):
                issues.append(_issue("invalid-scene-concept-artifact", task_path, f"任务 {task_id} 的效果图工件不可读取"))
    return issues


def _validate_tasks(
    workflow: Mapping[str, Any], project_root: Path, state_dir: Path
) -> list[ValidationIssue]:
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
                    issues.extend(_validate_task(str(task_id), result, workflow, result_path, project_root, state_dir))
                except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
                    issues.append(_issue("invalid-state-file", result_path, str(error)))
            issues.extend(_validate_task(str(task_id), task, workflow, state_dir / "workflow.yaml", project_root, state_dir))

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
                issues.extend(_validate_task(task_id, result, workflow, result_path, project_root, state_dir))
            except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
                issues.append(_issue("invalid-state-file", result_path, str(error)))
        issues.extend(_validate_task(task_id, task, workflow, task_path, project_root, state_dir))

    results_dir = state_dir / "results"
    for result_path in sorted(results_dir.glob("*.yaml")) if results_dir.is_dir() else ():
        if result_path in checked_results:
            continue
        try:
            result = read_yaml(result_path)
        except (WorkflowError, yaml.YAMLError, UnicodeError, OSError) as error:
            issues.append(_issue("invalid-state-file", result_path, str(error)))
            continue
        issues.extend(_validate_task(result_path.stem, result, workflow, result_path, project_root, state_dir))
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
        issues.extend(_validate_transitions(workflow, project_root, state_dir, state_dir / "workflow.yaml"))
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
        issues.extend(_validate_stage_artifacts(workflow, project_root, state_dir))
        issues.extend(_validate_vertical_slice_gate(workflow, state_dir))
        issues.extend(_validate_tasks(workflow, project_root, state_dir))

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
