from __future__ import annotations

import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from workflow_common import WorkflowError, read_yaml, utc_now, workflow_dir, write_yaml


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
ARTIFACT_STAGE_ALIASES = {
    "requirements": "requirements",
    "visual": "visual-direction",
    "visual-direction": "visual-direction",
    "concept": "scene-concepts",
    "scene-concepts": "scene-concepts",
    "plan": "planning",
    "implementation-plan": "planning",
    "assets": "production",
    "game-assets": "production",
    "code": "production",
    "integration": "integration",
    "verification": "verification",
    "build": "building",
    "delivery": "delivery",
}


def compute_invalidated_artifacts(
    artifacts: Mapping[str, Mapping[str, Any]],
    changed_ids: set[str],
) -> set[str]:
    """从变化产物向下游传播失效，保留无依赖关系的产物状态。"""
    unknown = changed_ids.difference(artifacts)
    if unknown:
        raise WorkflowError(f"未知产物: {', '.join(sorted(unknown))}")

    invalidated = set(changed_ids)
    changed = True
    while changed:
        changed = False
        for artifact_id, artifact in artifacts.items():
            dependencies = set(artifact.get("depends_on", []))
            if artifact_id not in invalidated and dependencies.intersection(invalidated):
                invalidated.add(artifact_id)
                changed = True
    return invalidated


def _artifact_stage(artifact_id: str, artifact: Mapping[str, Any]) -> str:
    """返回产物的规范阶段，拒绝无法安全回退的未声明阶段。"""
    stage = artifact.get("stage", ARTIFACT_STAGE_ALIASES.get(artifact_id))
    if stage not in MAIN_STATE_SEQUENCE or stage in {"bootstrap", "completed"}:
        raise WorkflowError(f"产物 {artifact_id} 缺少可回退的规范 stage")
    return str(stage)


def _rewind_state(
    artifacts: Mapping[str, Mapping[str, Any]], invalidated: set[str]
) -> str:
    """从失效产物中确定最早需重做的主阶段。"""
    return min(
        (_artifact_stage(artifact_id, artifacts[artifact_id]) for artifact_id in invalidated),
        key=MAIN_STATE_SEQUENCE.index,
    )


def _task_ids_for_artifacts(
    workflow: Mapping[str, Any],
    artifacts: Mapping[str, Mapping[str, Any]],
    invalidated: set[str],
) -> set[str]:
    """收集由失效产物显式声明或任务引用关联的任务 ID。"""
    task_ids: set[str] = set()
    for artifact_id in invalidated:
        declared = artifacts[artifact_id].get("task_ids", [])
        if isinstance(declared, list):
            task_ids.update(item for item in declared if isinstance(item, str) and item)

    statuses = workflow.get("task_status", {})
    if not isinstance(statuses, Mapping):
        return task_ids
    for task_id, task in statuses.items():
        if not isinstance(task_id, str) or not isinstance(task, Mapping):
            continue
        references: set[str] = set()
        for field in ("artifact_id", "artifact_ids", "produces"):
            value = task.get(field)
            if isinstance(value, str):
                references.add(value)
            elif isinstance(value, list):
                references.update(item for item in value if isinstance(item, str))
        if references.intersection(invalidated):
            task_ids.add(task_id)
    return task_ids


def _clear_invalidated_task_state(workflow: dict[str, Any], task_ids: set[str]) -> None:
    """将失效任务重新排队，并清除其活动与已完成索引。"""
    statuses = workflow.get("task_status")
    if isinstance(statuses, dict):
        for task_id in task_ids:
            task = statuses.get(task_id)
            if isinstance(task, dict):
                task["status"] = "pending"
    for field in ("active_task_ids", "completed_task_ids"):
        values = workflow.get(field)
        if isinstance(values, list):
            workflow[field] = [item for item in values if item not in task_ids]


def _clear_invalidated_gates(
    workflow: dict[str, Any],
    artifacts: Mapping[str, Mapping[str, Any]],
    invalidated: set[str],
) -> list[str]:
    """移除失效产物的批准门禁，保留项目配置这一初始化根门禁。"""
    gates = workflow.get("approval_gates")
    if not isinstance(gates, dict):
        return []
    gate_ids = {
        str(artifacts[artifact_id].get("approval_gate", artifact_id))
        for artifact_id in invalidated
    }
    cleared = sorted(gate_id for gate_id in gate_ids if gate_id != "project-configuration" and gate_id in gates)
    for gate_id in cleared:
        gates.pop(gate_id)
    return cleared


def invalidate_artifacts(project_root: Path, changed_ids: set[str]) -> set[str]:
    """失效产物并回退到最早阶段，清除不可复用的任务、结果与门禁。"""
    state_dir = workflow_dir(project_root)
    workflow_path = state_dir / "workflow.yaml"
    workflow = read_yaml(workflow_path)
    if workflow.get("state") == "completed":
        raise WorkflowError("completed 终态必须通过新的工作流运行处理上游变更")
    artifacts = workflow.get("artifacts")
    if not isinstance(artifacts, dict):
        raise WorkflowError("workflow.artifacts 必须是映射")
    invalidated = compute_invalidated_artifacts(artifacts, changed_ids)
    rewind_state = _rewind_state(artifacts, invalidated)
    task_ids = _task_ids_for_artifacts(workflow, artifacts, invalidated)

    # 保留产物元数据便于审计，但所有可执行状态均需回到待重跑状态。
    for artifact_id in invalidated:
        artifacts[artifact_id]["status"] = "stale"
    _clear_invalidated_task_state(workflow, task_ids)
    cleared_gates = _clear_invalidated_gates(workflow, artifacts, invalidated)

    state = workflow.get("state")
    run_status = workflow.get("run_status")
    if state not in MAIN_STATE_SEQUENCE:
        raise WorkflowError(f"未知工作流主状态: {state}")
    if not isinstance(run_status, str):
        raise WorkflowError("workflow.run_status 必须是字符串")
    timestamp = utc_now()
    report_relative = f"reports/invalidation-{uuid.uuid4().hex}.yaml"
    report_path = state_dir / report_relative
    report = {
        "schema_version": 1,
        "timestamp": timestamp,
        "reason": "upstream-change",
        "changed_artifact_ids": sorted(changed_ids),
        "artifact_ids": sorted(invalidated),
        "rewind_state": rewind_state,
        "task_ids": sorted(task_ids),
        "cleared_approval_gates": cleared_gates,
    }
    # 回退迁移只能引用项目内可审计文件，先落盘报告再写入 workflow。
    write_yaml(report_path, report)
    evidence = [report_relative]
    transitions = workflow.get("transitions")
    if not isinstance(transitions, list):
        raise WorkflowError("workflow.transitions 必须是列表")
    if run_status != "stale":
        transitions.append(
            {
                "from_state": state,
                "to_state": state,
                "from_run_status": run_status,
                "to_run_status": "stale",
                "timestamp": timestamp,
                "reason": "upstream-change",
                "evidence": evidence,
                "artifact_ids": sorted(invalidated),
            }
        )
    transitions.append(
        {
            "from_state": state,
            "to_state": rewind_state,
            "from_run_status": "stale",
            "to_run_status": "pending",
            "timestamp": timestamp,
            "reason": "upstream-change",
            "evidence": evidence,
            "artifact_ids": sorted(invalidated),
        }
    )
    workflow["state"] = rewind_state
    workflow["run_status"] = "pending"
    invalidation_log = workflow.get("invalidated")
    if not isinstance(invalidation_log, list):
        raise WorkflowError("workflow.invalidated 必须是列表")
    invalidation_log.append(
        {
            "timestamp": timestamp,
            "reason": "upstream-change",
            "changed_artifact_ids": sorted(changed_ids),
            "artifact_ids": sorted(invalidated),
            "rewind_state": rewind_state,
            "task_ids": sorted(task_ids),
            "cleared_approval_gates": cleared_gates,
        }
    )
    workflow["updated_at"] = timestamp
    try:
        write_yaml(workflow_path, workflow)
    except Exception:
        report_path.unlink(missing_ok=True)
        raise
    for task_id in task_ids:
        result_path = state_dir / "results" / f"{task_id}.yaml"
        if result_path.is_file():
            result_path.unlink()
    return invalidated
