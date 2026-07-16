from __future__ import annotations

import argparse
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Literal

from workflow_common import WorkflowError, content_hash, utc_now, workflow_dir, write_yaml


def _capture_profiles(
    orientation: Literal["landscape", "portrait"],
) -> list[dict[str, int | str]]:
    """根据冻结方向返回 small、standard、large 三档 Chrome 手机视口。"""
    if orientation == "landscape":
        sizes = ((667, 375), (844, 390), (932, 430))
    else:
        sizes = ((375, 667), (390, 844), (430, 932))
    ids = ("mobile-small", "mobile-standard", "mobile-large")
    return [
        {"id": profile_id, "width": width, "height": height}
        for profile_id, (width, height) in zip(ids, sizes, strict=True)
    ]


def _default_quality_gates() -> dict[str, Any]:
    """返回设计规格批准的三级质量门禁默认值。"""
    return {
        "P0": {
            "waivable": False,
            "typescript_compile_errors": 0,
            "creator_new_errors": 0,
            "chrome_console_errors": 0,
            "failed_required_requests": 0,
            "missing_asset_references": 0,
            "unresolved_components": 0,
            "broken_scene_entries": 0,
            "required_test_pass_rate": 1.0,
            "core_flow_pass_rate": 1.0,
            "build_exit_code": 0,
            "require_index_html": True,
            "require_local_preview": True,
            "require_first_scene_loaded": True,
            "require_delivery_manifest": True,
            "require_checksum": True,
            "require_vertical_slice": True,
            # 视觉规范和单场景效果图必须通过不可豁免的专业设计门槛。
            "visual_design_quality": True,
        },
        "P1": {
            "waivable_by": "human",
            "require_human_design_approval": True,
            "require_visual_direction_match": True,
            "runtime_pixel_diff": {
                "enabled": True,
                "max_changed_ratio": 0.005,
                "pixel_threshold": 10,
                "ignore_dynamic_regions": True,
            },
            "require_canvas_fully_visible": True,
            "allow_unexpected_scrollbars": False,
            "allow_required_ui_clipping": False,
            "allow_required_ui_overlap": False,
            "require_safe_area_compliance": True,
            "require_all_capture_profiles": True,
            "minimum_touch_target_css_px": 44,
            "require_primary_actions_reachable": True,
            "require_scene_navigation_recoverable": True,
            "allow_double_trigger": False,
        },
        "P2": {
            "blocking": False,
            "collect": [
                "initial_load_time_ms",
                "time_to_first_scene_ms",
                "average_fps",
                "p95_frame_time_ms",
                "draw_calls",
                "scene_node_count",
                "texture_count",
                "uncompressed_asset_bytes",
                "build_bytes",
                "zip_bytes",
            ],
        },
    }


def initialize_workflow(
    project_root: Path,
    orientation: Literal["landscape", "portrait"],
    *,
    creator_version: str,
    approved_by: str,
    review_mode: Literal["full", "lean"] = "lean",
    design_width: int | None = None,
    design_height: int | None = None,
) -> Path:
    """初始化并冻结 Web Mobile 项目配置，拒绝覆盖已有状态。"""
    if not isinstance(creator_version, str) or not creator_version.strip():
        raise WorkflowError("Creator 版本不得为空")
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", creator_version.strip())
    try:
        parsed_version = tuple(int(part) for part in match.groups()) if match else None
    except ValueError:
        parsed_version = None
    if parsed_version is None or parsed_version < (3, 8, 6):
        raise WorkflowError("Creator 版本必须为正式三段版本且不低于 3.8.6")
    if not isinstance(approved_by, str) or not approved_by.strip():
        raise WorkflowError("人工批准者不得为空")
    if review_mode not in {"full", "lean"}:
        raise WorkflowError("审阅强度仅支持 full 或 lean；硬门禁不可跳过")
    if orientation not in {"landscape", "portrait"}:
        raise WorkflowError(f"不支持的屏幕方向: {orientation}")
    if (design_width is None) != (design_height is None):
        raise WorkflowError("自定义设计分辨率必须同时提供宽和高")
    if design_width is not None:
        # 使用精确类型判断，避免 bool 作为 int 子类被误当成合法尺寸。
        if (
            type(design_width) is not int
            or type(design_height) is not int
            or design_width <= 0
            or design_height <= 0
        ):
            raise WorkflowError("设计分辨率必须为正整数")
        relation_matches = (
            orientation == "portrait" and design_width < design_height
        ) or (
            orientation == "landscape" and design_width > design_height
        )
        if not relation_matches:
            raise WorkflowError("自定义设计分辨率必须与冻结的屏幕方向一致")

    resolved_root = project_root.resolve()
    if not resolved_root.is_dir():
        raise WorkflowError(f"项目根目录不存在: {resolved_root}")
    state_dir = workflow_dir(resolved_root)
    if state_dir.exists():
        raise WorkflowError(f"工作流已存在，禁止覆盖: {state_dir}")

    width, height = (
        (design_width, design_height)
        if design_width is not None
        else ((1920, 1080) if orientation == "landscape" else (1080, 1920))
    )
    now = utc_now()
    # 项目配置一旦落盘即冻结，后续只能通过正式变更请求修改。
    profile = {
        "schema_version": 1,
        "project_id": resolved_root.name,
        "engine": {"name": "Cocos Creator", "version": creator_version.strip()},
        "project_type": "2d",
        "platform": "web-mobile",
        "orientation": orientation,
        "design_resolution": {
            "width": width,
            "height": height,
            "source": "approved-custom" if design_width is not None else "approved-default",
        },
        "capture_profiles": _capture_profiles(orientation),
        "fit_policy": {"mode": "show-all", "allow_letterbox": True},
        "safe_area": {"enabled": True},
        # 审阅强度只影响补充审查频率，不能绕过任何人工批准或 P0 门禁。
        "review_mode": review_mode,
        "project_root": str(resolved_root),
        "cocos_project_file": "project.json",
        "initial_scene": None,
        "status": "frozen",
        "frozen_at": now,
        "approved_by": approved_by.strip(),
    }
    profile["content_hash"] = content_hash(profile)

    workflow = {
        "schema_version": 1,
        "workflow_id": f"wf-{uuid.uuid4()}",
        "state": "bootstrap",
        "run_status": "pending",
        "active_task_ids": [],
        "completed_task_ids": [],
        "task_status": {},
        "artifacts": {},
        "visual_direction": {"version": None, "content_hash": None},
        "approval_gates": {
            "project-configuration": {
                "status": "passed",
                "approved_by": approved_by.strip(),
                "approved_at": now,
                "subject_hash": profile["content_hash"],
            }
        },
        "invalidated": [],
        "transitions": [],
        "updated_at": now,
    }
    ownership = {
        "schema_version": 1,
        "workflow_writer": "cocos-orchestrate-web-workflow",
        "active_cocos_writers": [],
        "path_owners": {},
        "conflict_policy": "reject-overlap",
    }
    quality_gates = {"schema_version": 1, **_default_quality_gates()}

    # 先在项目根目录内构建完整目录，再通过同卷重命名一次发布，避免半初始化状态。
    temp_dir = Path(tempfile.mkdtemp(prefix=".cocos-workflow.", dir=resolved_root))
    try:
        for relative in (
            "tasks",
            "results",
            "art/concepts",
            "art/assets",
            "art/visual-references",
            "art/runtime-baselines",
            "artifacts",
            "reports/chrome",
        ):
            (temp_dir / relative).mkdir(parents=True, exist_ok=True)

        write_yaml(temp_dir / "workflow.yaml", workflow)
        write_yaml(temp_dir / "project-profile.yaml", profile)
        write_yaml(temp_dir / "ownership.yaml", ownership)
        write_yaml(temp_dir / "quality-gates.yaml", quality_gates)
        temp_dir.replace(state_dir)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return state_dir


def main() -> None:
    """解析命令行参数并初始化项目工作流。"""
    parser = argparse.ArgumentParser(description="初始化 Cocos Web Mobile 项目工作流")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--orientation", required=True, choices=("landscape", "portrait"))
    parser.add_argument("--creator-version", required=True)
    parser.add_argument("--approved-by", required=True)
    parser.add_argument("--review-mode", choices=("full", "lean"), default="lean")
    parser.add_argument("--design-width", type=int)
    parser.add_argument("--design-height", type=int)
    args = parser.parse_args()
    initialize_workflow(
        args.project_root,
        args.orientation,
        creator_version=args.creator_version,
        approved_by=args.approved_by,
        review_mode=args.review_mode,
        design_width=args.design_width,
        design_height=args.design_height,
    )


if __name__ == "__main__":
    main()
