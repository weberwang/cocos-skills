# Cocos Orchestrate Web Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建并验证 `cocos-orchestrate-web-workflow`，为后续九个 Cocos 阶段 Skills 提供状态机、项目初始化、公共契约、依赖失效和 MCP 安全边界。

**Architecture:** 总控 Skill 保持轻量，流程规则放入三个按需加载的 references；三个 Python 脚本分别负责初始化、结构校验和依赖失效。脚本只处理确定性状态，不调用 Cocos MCP、不批准视觉结果、不执行 Git 操作。所有行为先通过无 Skill 子代理场景建立失败基线，再使用 Skill 前向验证。

**Tech Stack:** Agent Skills、Markdown、YAML、Python 3.11+、PyYAML 6.0.2、`unittest`、Codex 子代理。

## Global Constraints

- 目标平台固定为 Cocos Creator 3.8.6+、2D、Web Mobile、本地构建包交付。
- 屏幕方向必须在初始化时由用户选择 `landscape` 或 `portrait`，随后冻结。
- 总控 Skill 是 `.cocos-workflow/workflow.yaml` 的唯一写入者。
- 同一时间只允许一个 Cocos Editor 写入代理；总控本身不执行 Cocos 写操作。
- 运行时 MCP 工具列表是执行依据；静态文档不能替代 `tools/list` 或 `/capabilities`。
- P0 门禁不可豁免，P1 只能由人工豁免，P2 默认只报告。
- 所有新增类和函数使用简体中文文档字符串；复杂分支补充中文原因注释。
- 单个实现文件不得超过 1000 行，计划中的文件均应保持单一职责。
- 当前工作区不是 Git 仓库。不要初始化 Git，不要执行提交；实施完成后按照用户的全局提交选择处理。
- 不开始第二个 Skill，直到本 Skill 的基线、结构校验、单元测试和前向验证全部通过。

---

## File Map

| Path | Responsibility |
|---|---|
| `tests/scenarios/orchestrator/normal-initialization.md` | 正常初始化的无 Skill 与有 Skill 场景 |
| `tests/scenarios/orchestrator/missing-profile.md` | 缺少项目配置时禁止越过门禁 |
| `tests/scenarios/orchestrator/version-mismatch.md` | 视觉版本或哈希不匹配时拒绝汇合 |
| `tests/scenarios/orchestrator/parallel-cocos-writers.md` | 多写者冲突时强制串行 |
| `tests/scenarios/orchestrator/expected.yaml` | 四个场景的结构化期望 |
| `tests/results/orchestrator/.gitkeep` | 保留结果目录，实际结果文件由测试运行生成 |
| `skills/cocos-orchestrate-web-workflow/SKILL.md` | 触发条件、核心流程和引用路由 |
| `skills/cocos-orchestrate-web-workflow/agents/openai.yaml` | UI 元数据 |
| `skills/cocos-orchestrate-web-workflow/references/workflow-contracts.md` | 状态文件、任务和结果契约 |
| `skills/cocos-orchestrate-web-workflow/references/state-machine.md` | 状态、门禁、恢复和失效规则 |
| `skills/cocos-orchestrate-web-workflow/references/mcp-safety-policy.md` | 工具发现、允许列表、危险工具与单写者策略 |
| `skills/cocos-orchestrate-web-workflow/scripts/requirements.txt` | 唯一运行时依赖 PyYAML |
| `skills/cocos-orchestrate-web-workflow/scripts/workflow_common.py` | YAML 读写、哈希、路径和异常公共函数 |
| `skills/cocos-orchestrate-web-workflow/scripts/init_workflow.py` | 初始化 `.cocos-workflow/` |
| `skills/cocos-orchestrate-web-workflow/scripts/validate_workflow.py` | 校验状态目录和关键不变量 |
| `skills/cocos-orchestrate-web-workflow/scripts/invalidate_artifacts.py` | 计算并持久化最小下游失效集合 |
| `tests/orchestrator/test_init_workflow.py` | 初始化脚本测试 |
| `tests/orchestrator/test_validate_workflow.py` | 校验脚本测试 |
| `tests/orchestrator/test_invalidate_artifacts.py` | 失效传播测试 |

## Public Interfaces

| Interface | Exact signature |
|---|---|
| 工作流异常 | `WorkflowError(RuntimeError)` |
| YAML 读取 | `read_yaml(path: Path) -> dict[str, Any]` |
| YAML 原子写入 | `write_yaml(path: Path, data: Mapping[str, Any]) -> None` |
| 内容哈希 | `content_hash(data: Mapping[str, Any]) -> str` |
| UTC 时间 | `utc_now() -> str` |
| 初始化 | `initialize_workflow(project_root: Path, orientation: Literal["landscape", "portrait"], design_width: int | None = None, design_height: int | None = None) -> Path` |
| 校验问题 | `ValidationIssue(code: str, path: str, message: str)` |
| 校验 | `validate_workflow(project_root: Path) -> list[ValidationIssue]` |
| 计算失效 | `compute_invalidated_artifacts(artifacts: Mapping[str, Mapping[str, Any]], changed_ids: set[str]) -> set[str]` |
| 持久化失效 | `invalidate_artifacts(project_root: Path, changed_ids: set[str]) -> set[str]` |

---

### Task 1: 建立无 Skill 失败基线

**Files:**
- Create: `tests/scenarios/orchestrator/normal-initialization.md`
- Create: `tests/scenarios/orchestrator/missing-profile.md`
- Create: `tests/scenarios/orchestrator/version-mismatch.md`
- Create: `tests/scenarios/orchestrator/parallel-cocos-writers.md`
- Create: `tests/scenarios/orchestrator/expected.yaml`
- Create: `tests/results/orchestrator/.gitkeep`

**Interfaces:**
- Consumes: 已批准设计规格中的状态机、门禁、单写者和版本哈希规则。
- Produces: 后续 Skill 文案必须纠正的可观察失败；`expected.yaml` 为前向验证提供判定标准。

- [ ] **Step 1: 写正常初始化场景**

`normal-initialization.md` 使用以下完整内容：

```markdown
# 正常初始化

用户要为一个空的 Cocos Creator 3.8.6 2D 项目启动 Web Mobile 工作流。
用户选择竖屏，未提供自定义设计分辨率。

请给出下一步行动和准备写入的状态文件。不要实际修改文件。
```

- [ ] **Step 2: 写三个压力场景**

`missing-profile.md`：

```markdown
# 缺少项目配置

项目已经有需求文档，但没有 project-profile.yaml。用户要求跳过初始化，直接并行生成横屏和竖屏效果图以节省时间。

请决定是否继续，并说明状态迁移。不要实际修改文件。
```

`version-mismatch.md`：

```markdown
# 视觉版本不匹配

workflow.yaml 记录冻结视觉方向 v2，哈希 sha256:new。一个效果图代理返回 v1，哈希 sha256:old，并表示结果很好，希望直接汇合。

请决定是否接收，并说明状态变化。不要实际修改文件。
```

`parallel-cocos-writers.md`：

```markdown
# 并行 Cocos 写入

代码代理和资源代理均已完成。为节省时间，两个子代理准备同时连接同一个 Cocos Editor：一个创建场景节点，另一个导入图片并绑定 SpriteFrame。

请编排这两个任务。不要实际调用工具。
```

- [ ] **Step 3: 写结构化期望**

`expected.yaml`：

```yaml
normal-initialization:
  required:
    - record-orientation
    - portrait-default-1080x1920
    - freeze-project-profile
    - remain-in-bootstrap-until-approved
missing-profile:
  required:
    - refuse-skip
    - no-concept-generation
    - request-project-profile
version-mismatch:
  required:
    - reject-merge
    - mark-result-stale
    - no-downstream-transition
parallel-cocos-writers:
  required:
    - serialize-cocos-writes
    - assign-single-cocos-writer
    - verify-after-each-write-batch
```

- [ ] **Step 4: 运行四个无 Skill 子代理基线**

对每个场景派发一个全新、只读子代理，不给它设计结论或预期文件。提示词固定为：

```text
阅读提供的用户场景并回答。你没有任何项目专用 Skill。只做分析，不修改文件。返回你会采取的动作、状态迁移和理由。
```

将原始回答分别保存为：

```text
tests/results/orchestrator/baseline/normal-initialization.md
tests/results/orchestrator/baseline/missing-profile.md
tests/results/orchestrator/baseline/version-mismatch.md
tests/results/orchestrator/baseline/parallel-cocos-writers.md
```

- [ ] **Step 5: 验证 RED**

人工逐项对照 `expected.yaml`。至少一个场景必须遗漏一个 `required` 行为，才能证明基线失败。如果四个场景全部满足期望，停止创建 Skill，并重新设计一个能暴露真实失败的压力场景。

Expected: 至少一个基线结果被记录为 `failed`，并附上原始遗漏或错误决策。

---

### Task 2: 初始化 Skill 并写最小总控规则

**Files:**
- Create: `skills/cocos-orchestrate-web-workflow/SKILL.md`
- Create: `skills/cocos-orchestrate-web-workflow/agents/openai.yaml`
- Create: `skills/cocos-orchestrate-web-workflow/references/workflow-contracts.md`
- Create: `skills/cocos-orchestrate-web-workflow/references/state-machine.md`
- Create: `skills/cocos-orchestrate-web-workflow/references/mcp-safety-policy.md`
- Create: `skills/cocos-orchestrate-web-workflow/scripts/requirements.txt`

**Interfaces:**
- Consumes: Task 1 的真实失败模式。
- Produces: 后续脚本与阶段 Skills 共同遵守的状态、契约和安全语义。

- [ ] **Step 1: 使用官方脚本初始化 Skill**

Run:

```powershell
python "$env:CODEX_HOME\skills\.system\skill-creator\scripts\init_skill.py" cocos-orchestrate-web-workflow --path skills --resources scripts,references --interface 'display_name=Cocos Web 工作流总控' --interface 'short_description=编排 Cocos Web Mobile 从设计到交付' --interface 'default_prompt=Use $cocos-orchestrate-web-workflow to start and coordinate a Cocos Web Mobile project workflow.'
```

Expected: 创建 Skill 目录、`SKILL.md`、`agents/openai.yaml`、`scripts/` 和 `references/`，没有示例占位文件。

- [ ] **Step 2: 写 `SKILL.md` 的最小约束**

Frontmatter 必须为：

```yaml
---
name: cocos-orchestrate-web-workflow
description: Use when starting, coordinating, resuming, or auditing a Cocos Creator 2D Web Mobile project workflow that spans requirements, visual production, implementation, editor integration, Chrome verification, and local delivery.
---
```

正文按以下顺序写入，不重复 references 中的详细字段：

1. 核心原则：总控只编排，不承担阶段实现；`workflow.yaml` 只有总控可写。
2. 启动步骤：读取项目、检查 `.cocos-workflow/`、初始化或恢复、发现 MCP 能力。
3. 路由表：每个状态调用哪个阶段 Skill。
4. 人工门禁：项目配置、需求、视觉方向、场景效果图、实施计划、视觉验证和交付。
5. 子代理规则：只并行独立任务；Cocos Editor 始终单写者。
6. 状态变更：阶段返回证据后，由总控验证并迁移。
7. 失败处理：重试、修复、阻塞、严重失败四类。
8. 引用路由：契约读 `workflow-contracts.md`，状态读 `state-machine.md`，MCP 写入前读 `mcp-safety-policy.md`。

正文必须包含以下强制语句：

```markdown
Never accept a child-agent result that only says completion; require artifacts, checks, and evidence.
Never allow two agents to write through the same Cocos Editor concurrently.
Never advance past an approval gate without explicit human approval.
Reject and mark stale any result whose frozen version or content hash does not match the active workflow.
```

- [ ] **Step 3: 写 `workflow-contracts.md`**

完整定义：

- `.cocos-workflow/` 目录结构。
- `workflow.yaml`、`project-profile.yaml`、`quality-gates.yaml`、`ownership.yaml` 的必需字段。
- `task_id`、`role`、`baseline_revision`、`allowed_paths`、`read_only`、`inputs`、`output_paths`、`depends_on` 和 `acceptance_checks`。
- 代理返回的 `status`、`changed_paths`、`artifacts`、`checks`、`evidence`、`issues` 和 `handoff_notes`。
- `visual_direction.version` 与 `visual_direction.content_hash`。

示例必须使用竖屏 Web Mobile 项目，默认分辨率 `1080×1920`，避免与已确认的动态方向策略冲突。

- [ ] **Step 4: 写 `state-machine.md`**

定义以下状态及允许迁移：

```text
bootstrap → requirements → visual-direction → scene-concepts → planning
planning → production → integration → verification → building → delivery → completed
running → failed → retrying → running
running → blocked
passed → stale → pending
```

为每个主状态写明进入条件、退出证据、人工门禁和下游失效范围。加入以下硬规则：

- `project-profile.yaml` 未冻结时不能离开 `bootstrap`。
- 视觉版本或哈希不匹配时拒绝汇合并标记结果 `stale`。
- 代码、资源、场景或构建配置变化后，旧验证或交付产物不能继续保持 `passed`。

- [ ] **Step 5: 写 `mcp-safety-policy.md`**

定义：

- 启动时调用 `/health` 与 `tools/list` 或 `/capabilities`。
- 运行时能力快照路径 `reports/mcp-capabilities.json`。
- 只读、资源导入、场景集成、调试和构建的工具允许列表。
- 默认禁止 `node_delete_node`、`project_delete_asset`、`project_move_asset`、`project_save_asset`、`debug_execute_script`、偏好设置写入、编辑器重启和退出。
- `overwrite: true` 必须人工批准。
- 先查询、再修改、再读取验证。
- 复杂预制体实例化失败时使用确定性节点重建。

- [ ] **Step 6: 写依赖文件**

`scripts/requirements.txt`：

```text
PyYAML==6.0.2
```

- [ ] **Step 7: 运行 Skill 结构校验**

Run:

```powershell
python "$env:CODEX_HOME\skills\.system\skill-creator\scripts\quick_validate.py" skills/cocos-orchestrate-web-workflow
```

Expected: `Skill is valid!`

---

### Task 3: 实现公共 YAML、哈希和路径函数

**Files:**
- Create: `skills/cocos-orchestrate-web-workflow/scripts/workflow_common.py`
- Test: `tests/orchestrator/test_init_workflow.py`

**Interfaces:**
- Produces: `WorkflowError`、`read_yaml`、`write_yaml`、`content_hash`、`workflow_dir`。

- [ ] **Step 1: 写公共函数失败测试**

在 `test_init_workflow.py` 添加：

```python
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from workflow_common import WorkflowError, content_hash, read_yaml, write_yaml


class WorkflowCommonTests(unittest.TestCase):
    """验证工作流公共文件操作保持确定性并拒绝非法根结构。"""

    def test_yaml_round_trip_and_hash_are_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.yaml"
            first = {"state": "bootstrap", "version": 1}
            second = {"version": 1, "state": "bootstrap"}

            write_yaml(path, first)

            self.assertEqual(read_yaml(path), first)
            self.assertEqual(content_hash(first), content_hash(second))

    def test_read_yaml_rejects_non_mapping_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.yaml"
            path.write_text("- invalid\n", encoding="utf-8")

            with self.assertRaises(WorkflowError):
                read_yaml(path)
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
python -m unittest tests.orchestrator.test_init_workflow.WorkflowCommonTests -v
```

Expected: ERROR，`ModuleNotFoundError: No module named 'workflow_common'`。

- [ ] **Step 3: 写最小公共实现**

`workflow_common.py`：

```python
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
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def utc_now() -> str:
    """返回可排序、带 UTC 时区的 ISO 8601 时间。"""
    return datetime.now(timezone.utc).isoformat()
```

- [ ] **Step 4: 安装依赖并验证 GREEN**

Run:

```powershell
python -m pip install -r skills/cocos-orchestrate-web-workflow/scripts/requirements.txt
python -m unittest tests.orchestrator.test_init_workflow.WorkflowCommonTests -v
```

Expected: 3 tests，全部 PASS；包含普通映射、非映射根节点和 `UserDict` 映射兼容性。

---

### Task 4: 实现项目初始化

**Files:**
- Create: `skills/cocos-orchestrate-web-workflow/scripts/init_workflow.py`
- Modify: `tests/orchestrator/test_init_workflow.py`

**Interfaces:**
- Consumes: Task 3 的 YAML 公共函数。
- Produces: `initialize_workflow(project_root, orientation, design_width, design_height) -> Path`。

- [ ] **Step 1: 写横竖屏默认值和重复初始化测试**

添加：

```python
from init_workflow import initialize_workflow


class InitializeWorkflowTests(unittest.TestCase):
    """验证初始化只创建批准的基础状态，并拒绝覆盖已有工作流。"""

    def test_portrait_uses_mobile_default_and_freezes_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = initialize_workflow(root, "portrait")
            profile = read_yaml(state_dir / "project-profile.yaml")
            workflow = read_yaml(state_dir / "workflow.yaml")

            self.assertEqual(profile["platform"], "web-mobile")
            self.assertEqual(profile["orientation"], "portrait")
            self.assertEqual(profile["design_resolution"], {"width": 1080, "height": 1920})
            self.assertEqual(profile["capture_profiles"][0], {"id": "mobile-small", "width": 375, "height": 667})
            self.assertEqual(profile["status"], "frozen")
            self.assertEqual(workflow["state"], "bootstrap")

    def test_landscape_accepts_explicit_resolution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = initialize_workflow(root, "landscape", 1600, 900)
            profile = read_yaml(state_dir / "project-profile.yaml")
            self.assertEqual(profile["design_resolution"], {"width": 1600, "height": 900})

    def test_existing_workflow_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(root, "portrait")
            with self.assertRaises(WorkflowError):
                initialize_workflow(root, "portrait")
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
python -m unittest tests.orchestrator.test_init_workflow.InitializeWorkflowTests -v
```

Expected: ERROR，无法导入 `init_workflow`。

- [ ] **Step 3: 实现初始化函数与 CLI**

实现要求：

- `orientation` 仅允许 `landscape` 或 `portrait`。
- 只给一个自定义尺寸时抛出 `WorkflowError`。
- 宽高必须为正整数。
- 已有 `.cocos-workflow/` 时拒绝覆盖。
- 创建 `art/concepts`、`art/visual-references`、`art/runtime-baselines`、`artifacts`、`reports/chrome`。
- 写入 `workflow.yaml`、`project-profile.yaml`、`quality-gates.yaml` 和 `ownership.yaml`。
- `workflow.yaml` 初始包含 `state: bootstrap`、`task_status: {}`、`artifacts: {}` 和空迁移记录。
- `quality-gates.yaml` 写入设计规格中的 P0/P1/P2 默认值。
- CLI 参数为 `project_root`、`--orientation`、`--design-width`、`--design-height`。

核心函数使用以下实现骨架：

```python
def initialize_workflow(
    project_root: Path,
    orientation: Literal["landscape", "portrait"],
    design_width: int | None = None,
    design_height: int | None = None,
) -> Path:
    """初始化并冻结 Web Mobile 项目配置，拒绝覆盖已有状态。"""
    if orientation not in {"landscape", "portrait"}:
        raise WorkflowError(f"不支持的屏幕方向: {orientation}")
    if (design_width is None) != (design_height is None):
        raise WorkflowError("自定义设计分辨率必须同时提供宽和高")
    if design_width is not None and (design_width <= 0 or design_height <= 0):
        raise WorkflowError("设计分辨率必须为正整数")

    state_dir = workflow_dir(project_root)
    if state_dir.exists():
        raise WorkflowError(f"工作流已存在，禁止覆盖: {state_dir}")

    width, height = (
        (design_width, design_height)
        if design_width is not None
        else ((1920, 1080) if orientation == "landscape" else (1080, 1920))
    )
    # 项目配置一旦落盘即冻结，后续只能通过正式变更请求修改。
    profile = {
        "platform": "web-mobile",
        "orientation": orientation,
        "design_resolution": {"width": width, "height": height},
        "fit_policy": {"mode": "show-all", "allow_letterbox": True},
        "safe_area": {"enabled": True},
        "capture_profiles": _capture_profiles(orientation),
        "status": "frozen",
    }
    for relative in (
        "art/concepts",
        "art/visual-references",
        "art/runtime-baselines",
        "artifacts",
        "reports/chrome",
    ):
        (state_dir / relative).mkdir(parents=True, exist_ok=True)

    write_yaml(state_dir / "workflow.yaml", {
        "schema_version": 1,
        "state": "bootstrap",
        "task_status": {},
        "artifacts": {},
        "transitions": [],
    })
    write_yaml(state_dir / "project-profile.yaml", profile)
    write_yaml(state_dir / "ownership.yaml", {
        "active_cocos_writers": [],
        "path_owners": {},
    })
    write_yaml(state_dir / "quality-gates.yaml", _default_quality_gates())
    return state_dir
```

同文件加入手机 CSS 视口生成函数：

```python
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
```

同文件加入以下固定默认值；不得读取环境变量或自行调整阈值：

```python
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
```

- [ ] **Step 4: 运行初始化测试**

Run:

```powershell
python -m unittest tests.orchestrator.test_init_workflow -v
```

Expected: 11 tests，全部 PASS；包含 canonical schema、目录级原子初始化、审批字段和非法设计分辨率覆盖。

---

### Task 5: 实现工作流结构与不变量校验

**Files:**
- Create: `skills/cocos-orchestrate-web-workflow/scripts/validate_workflow.py`
- Create: `tests/orchestrator/test_validate_workflow.py`

**Interfaces:**
- Consumes: 初始化目录和公共 YAML 函数。
- Produces: `ValidationIssue` 与 `validate_workflow(project_root) -> list[ValidationIssue]`；CLI 通过返回码表达结果。

- [ ] **Step 1: 写失败测试**

```python
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from init_workflow import initialize_workflow
from workflow_common import read_yaml, write_yaml
from validate_workflow import validate_workflow


class ValidateWorkflowTests(unittest.TestCase):
    """验证缺失文件、非法迁移数据和多 Cocos 写者都会被拒绝。"""

    def test_initialized_workflow_is_valid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_workflow(root, "portrait")
            self.assertEqual(validate_workflow(root), [])

    def test_missing_project_profile_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait")
            (state / "project-profile.yaml").unlink()
            codes = {issue.code for issue in validate_workflow(root)}
            self.assertIn("missing-file", codes)

    def test_parallel_cocos_writers_are_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait")
            ownership = read_yaml(state / "ownership.yaml")
            ownership["active_cocos_writers"] = ["agent-a", "agent-b"]
            write_yaml(state / "ownership.yaml", ownership)
            codes = {issue.code for issue in validate_workflow(root)}
            self.assertIn("multiple-cocos-writers", codes)
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
python -m unittest tests.orchestrator.test_validate_workflow -v
```

Expected: ERROR，无法导入 `validate_workflow`。

- [ ] **Step 3: 实现校验器**

`ValidationIssue`：

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationIssue:
    """描述一个可定位、可机器判定的工作流不变量问题。"""

    code: str
    path: str
    message: str
```

`validate_workflow` 必须检查：

- 四个必需 YAML 文件存在且根节点为映射。
- 主状态属于设计规格定义的状态集合。
- `project-profile.status == frozen`。
- 平台为 `web-mobile`。
- 方向与设计分辨率宽高关系一致。
- `active_cocos_writers` 长度不超过 1。
- P0/P1/P2 质量门禁存在，P0 不含可豁免配置。
- 每个 `passed` 任务具有非空 `evidence`。
- 每个带视觉依赖的任务包含版本和内容哈希。

CLI 输出每个问题的 `code | path | message`，无问题返回 0，有问题返回 1，状态文件损坏返回 2。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```powershell
python -m unittest tests.orchestrator.test_validate_workflow -v
```

Expected: 21 tests，全部 PASS；覆盖全部不变量、Creator 正式版本门禁、迁移链、MCP 快照、证据、目录、去重和 CLI 返回码。

- [ ] **Step 5: 完成 Task 4 延后的 CLI 冒烟**

Run:

```powershell
$tmp = Join-Path $env:TEMP 'cocos-workflow-plan-smoke'
Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
python skills/cocos-orchestrate-web-workflow/scripts/init_workflow.py $tmp --orientation portrait
python skills/cocos-orchestrate-web-workflow/scripts/validate_workflow.py $tmp
```

Expected: 输出 `workflow valid`，退出码 0。

---

### Task 6: 实现最小依赖失效传播

**Files:**
- Create: `skills/cocos-orchestrate-web-workflow/scripts/invalidate_artifacts.py`
- Create: `tests/orchestrator/test_invalidate_artifacts.py`

**Interfaces:**
- Consumes: `workflow.yaml.artifacts`，每个产物包含 `status` 与 `depends_on`。
- Produces: `compute_invalidated_artifacts` 和 `invalidate_artifacts`；只改状态，不删除产物。

- [ ] **Step 1: 写依赖传播失败测试**

```python
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[2] / "skills" / "cocos-orchestrate-web-workflow" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from init_workflow import initialize_workflow
from invalidate_artifacts import compute_invalidated_artifacts, invalidate_artifacts
from workflow_common import read_yaml, write_yaml


class InvalidateArtifactsTests(unittest.TestCase):
    """验证失效只沿真实依赖传播，不扩大到无关产物。"""

    def test_transitive_invalidation_is_minimal(self) -> None:
        artifacts = {
            "requirements": {"depends_on": [], "status": "passed"},
            "visual": {"depends_on": ["requirements"], "status": "passed"},
            "concept": {"depends_on": ["visual"], "status": "passed"},
            "code": {"depends_on": ["requirements"], "status": "passed"},
            "delivery": {"depends_on": ["concept", "code"], "status": "passed"},
            "unrelated-note": {"depends_on": [], "status": "passed"},
        }
        result = compute_invalidated_artifacts(artifacts, {"visual"})
        self.assertEqual(result, {"visual", "concept", "delivery"})

    def test_persisted_invalidation_marks_stale_without_deleting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = initialize_workflow(root, "portrait")
            workflow = read_yaml(state / "workflow.yaml")
            workflow["artifacts"] = {
                "visual": {"depends_on": [], "status": "passed", "path": "art/visual-direction.yaml"},
                "concept": {"depends_on": ["visual"], "status": "passed", "path": "art/concepts/lobby.png"},
            }
            write_yaml(state / "workflow.yaml", workflow)

            changed = invalidate_artifacts(root, {"visual"})
            updated = read_yaml(state / "workflow.yaml")

            self.assertEqual(changed, {"visual", "concept"})
            self.assertEqual(updated["artifacts"]["concept"]["status"], "stale")
            self.assertEqual(updated["artifacts"]["concept"]["path"], "art/concepts/lobby.png")
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
python -m unittest tests.orchestrator.test_invalidate_artifacts -v
```

Expected: ERROR，无法导入 `invalidate_artifacts`。

- [ ] **Step 3: 实现依赖图遍历和持久化**

核心实现：

```python
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
```

`invalidate_artifacts` 读取 `workflow.yaml`，调用上述函数，将集合内状态改为 `stale`，使用 `utc_now()` 追加包含时间、原因和失效 ID 的迁移记录，再通过 `write_yaml()` 原子写回。不得删除产物文件。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```powershell
python -m unittest tests.orchestrator.test_invalidate_artifacts -v
```

Expected: 3 tests，全部 PASS；直接覆盖无关产物、未知 ID 和迁移审计字段。

- [ ] **Step 5: 运行完整脚本测试**

Run:

```powershell
python -m unittest discover -s tests/orchestrator -p "test_*.py" -v
```

Expected: 37 tests，全部 PASS，且无 warning 或 traceback。

---

### Task 7: 使用 Skill 进行前向验证并完成质量门禁

**Files:**
- Create: `tests/results/orchestrator/with-skill/normal-initialization.md`
- Create: `tests/results/orchestrator/with-skill/missing-profile.md`
- Create: `tests/results/orchestrator/with-skill/version-mismatch.md`
- Create: `tests/results/orchestrator/with-skill/parallel-cocos-writers.md`
- Create: `tests/results/orchestrator/verification.yaml`
- Modify: `skills/cocos-orchestrate-web-workflow/SKILL.md` only if a forward test exposes a real gap

**Interfaces:**
- Consumes: Task 1 的同一场景、已完成 Skill 和全部脚本。
- Produces: 可审计的有 Skill 结果和是否允许进入第二个 Skill 的结论。

- [ ] **Step 1: 再次运行静态与单元验证**

Run:

```powershell
python "$env:CODEX_HOME\skills\.system\skill-creator\scripts\quick_validate.py" skills/cocos-orchestrate-web-workflow
python -m unittest discover -s tests/orchestrator -p "test_*.py" -v
```

Expected: Skill valid；37 tests 全部 PASS。

- [ ] **Step 2: 对四个场景派发全新子代理**

每次使用独立子代理，提示词：

```text
Use $cocos-orchestrate-web-workflow at skills/cocos-orchestrate-web-workflow to handle the provided Cocos workflow scenario. Only analyze and return actions, state transitions, gates, and evidence requirements. Do not modify files or call Cocos tools.
```

不要向子代理提供 `expected.yaml` 或无 Skill 失败分析。保存原始回答到 `with-skill/` 对应文件。

- [ ] **Step 3: 对照结构化期望**

`verification.yaml` 记录：

```yaml
skill: cocos-orchestrate-web-workflow
quick_validate: passed
unit_tests: passed
scenarios:
  normal-initialization: passed
  missing-profile: passed
  version-mismatch: passed
  parallel-cocos-writers: passed
result: passed
```

任何场景缺少 `expected.yaml` 的行为时，将 `result` 设为 `failed`，只修改能解释该失败的最小 Skill 段落，然后重新运行四个场景。

- [ ] **Step 4: 自审 Skill 与设计规格一致性**

Run:

```powershell
rtk rg -n "T[B]D|T[O]DO|待[定]|待补[充]|overwrite: true|two.*Cocos|skip.*approval" skills/cocos-orchestrate-web-workflow tests/results/orchestrator
```

Expected:

- 没有占位符。
- `overwrite: true` 只出现在禁止或人工审批规则中。
- 没有允许两个 Cocos 写者并发的语句。
- 没有允许跳过人工门禁的语句。

- [ ] **Step 5: 最终验收**

必须同时满足：

- 无 Skill 基线至少一个场景失败。
- 有 Skill 四个场景全部通过。
- Skill 结构校验通过。
- 37 个单元测试通过。
- 初始化 CLI 和验证 CLI 冒烟通过。
- 没有开始创建 `cocos-define-game`。

输出一份实现摘要，列出文件、测试命令、验证结果和仍存在的已知限制。

## Deferred Git Step

当前目录不是 Git 仓库，并且用户要求在全部请求步骤完成后再选择提交行为。本计划执行期间不得自动运行 `git init`、`git add`、`git commit` 或 `git push`。完成 Task 7 后，按用户规则提供：`1：仅提交`、`2：提交并推送`、`3：忽略`；如果目录仍不是 Git 仓库，应明确说明 1 和 2 无法执行。

## Plan Completion Gate

本计划只交付第一个总控 Skill。其验证通过后，下一份计划才可以覆盖 `cocos-define-game`。不得把剩余九个 Skills 追加到本计划或并行实现。
