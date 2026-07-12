from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


class WorkflowError(RuntimeError):
    """表示工作流状态文件不完整、损坏或违反确定性约束。"""


def workflow_dir(project_root: Path) -> Path:
    """返回项目内唯一的工作流状态目录。"""
    return project_root.resolve() / ".cocos-workflow"


def read_yaml(path: Path) -> dict[str, Any]:
    """读取 YAML 映射；拒绝空文件和非映射根节点。"""
    if not path.is_file():
        raise WorkflowError(f"缺少状态文件: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise WorkflowError(f"YAML 根节点必须是映射: {path}")
    return data


def write_yaml(path: Path, data: Mapping[str, Any]) -> None:
    """原子写入稳定排序的 UTF-8 YAML，避免中断留下半写状态。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = yaml.safe_dump(dict(data), allow_unicode=True, sort_keys=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(payload, encoding="utf-8")
    temp_path.replace(path)


def content_hash(data: Mapping[str, Any]) -> str:
    """计算与映射插入顺序无关的 SHA-256 内容哈希。"""
    payload = json.dumps(dict(data), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def utc_now() -> str:
    """返回可排序、带 UTC 时区的 ISO 8601 时间。"""
    return datetime.now(timezone.utc).isoformat()
