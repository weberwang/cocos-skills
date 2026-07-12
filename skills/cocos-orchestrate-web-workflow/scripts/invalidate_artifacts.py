from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from workflow_common import WorkflowError, read_yaml, utc_now, workflow_dir, write_yaml


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


def invalidate_artifacts(project_root: Path, changed_ids: set[str]) -> set[str]:
    """标记变化产物及其下游为 stale，并持久化可审计迁移记录。"""
    workflow_path = workflow_dir(project_root) / "workflow.yaml"
    workflow = read_yaml(workflow_path)
    if workflow.get("run_status") != "passed":
        raise WorkflowError("只有 passed 工作流可以通过 canonical passed → stale 迁移失效")
    artifacts = workflow["artifacts"]
    invalidated = compute_invalidated_artifacts(artifacts, changed_ids)

    # 只改变状态字段，避免失效传播意外删除仍需审计或复用的产物元数据。
    for artifact_id in invalidated:
        artifacts[artifact_id]["status"] = "stale"
    workflow["transitions"].append(
        {
            "from_state": workflow["state"],
            "to_state": workflow["state"],
            "from_run_status": "passed",
            "to_run_status": "stale",
            "timestamp": utc_now(),
            "reason": "upstream-change",
            "evidence": [f"artifact:{artifact_id}" for artifact_id in sorted(invalidated)],
            "artifact_ids": sorted(invalidated),
        }
    )
    workflow["run_status"] = "stale"
    workflow["updated_at"] = utc_now()
    write_yaml(workflow_path, workflow)
    return invalidated
