# 工作流契约

## 目录结构

```text
.cocos-workflow/
├── workflow.yaml
├── project-profile.yaml
├── quality-gates.yaml
├── ownership.yaml
├── tasks/
├── results/
├── art/
│   ├── concepts/
│   ├── visual-references/
│   └── runtime-baselines/
├── artifacts/
└── reports/chrome/
```

所有路径均相对项目根目录。初始化器必须先在项目根目录内的唯一临时目录生成完整结构，再通过一次同卷重命名发布为 `.cocos-workflow/`；失败时清理临时目录且不得留下目标目录。

## Canonical 状态文件

### `workflow.yaml`

必须逐项包含：

- `schema_version`
- `workflow_id`
- `state`，初始值为 `bootstrap`
- `run_status`，初始值为 `pending`
- `active_task_ids`
- `completed_task_ids`
- `task_status`
- `artifacts`
- `visual_direction`，包含 `version: null` 与 `content_hash: null`
- `approval_gates`
- `invalidated`
- `transitions`
- `updated_at`

`workflow.yaml` 仅允许总控写入。项目初始化成功时，`approval_gates.project-configuration` 的 canonical 必需字段名称固定为 `status`、`approved_by`、`approved_at`、`subject_hash`；`status` 必须为 `passed`，批准者必须与项目配置一致，`subject_hash` 必须与项目配置内容哈希完全相同。禁止用 `artifact` 或 `content_hash` 替代这些字段。

`transitions` 每项必须包含 `from_state`、`to_state`、`from_run_status`、`to_run_status`、`timestamp`、`reason`、`evidence`。`timestamp` 与 `reason` 非空，`evidence` 是非空列表。主状态只能按状态机顺序前进一步；同一主状态只允许状态机声明的运行状态迁移。迁移链必须前后连续，最后一项结果必须等于当前 `state` 与 `run_status`。空迁移列表只允许唯一初始组合 `state: bootstrap` 且 `run_status: pending`；`bootstrap/running | blocked | passed` 也必须拥有从 `bootstrap/pending` 开始的完整合法迁移链。

### `project-profile.yaml`

必须逐项包含：

- `schema_version`
- `project_id`
- `engine`，其中 `name` 固定为 `Cocos Creator`，`version` 必须是正式三段版本且不低于 `3.8.6`
- `project_type`，固定为 `2d`
- `platform`，固定为 `web-mobile`
- `orientation`，值为 `portrait | landscape`
- `design_resolution`，包含 `width`、`height`、`source`
- `capture_profiles`
- `fit_policy`
- `safe_area`
- `project_root`
- `cocos_project_file`
- `initial_scene`：`bootstrap` 且 `run_status` 为 `pending | running | blocked` 时可为 `null`；`bootstrap/passed` 或任何非 `bootstrap` 状态必须是非空、项目相对、无 `..` 且以 `.scene` 结尾的路径
- `status`，固定为 `frozen`
- `frozen_at`
- `approved_by`
- `content_hash`

初始化 CLI 本身表示用户已经在总控门禁确认方向与分辨率，因此 `creator_version` 和 `approved_by` 都是必填项。`content_hash` 对排除 `content_hash` 字段后的完整配置计算 SHA-256。

### `quality-gates.yaml`

必须包含 `schema_version` 与 `P0`、`P1`、`P2`：

- `P0` 不可豁免；任一失败都停止当前阶段与下游动作。
- `P1` 默认阻塞；只有字段完整、由人类明确批准且仍有效的结构化豁免才可继续。
- `P2` 默认仅报告；可由项目配置升级为阻塞指标。

### `ownership.yaml`

必须逐项包含：

- `schema_version`
- `workflow_writer`，固定为 `cocos-orchestrate-web-workflow`
- `active_cocos_writers`，最多一个活动写者
- `path_owners`
- `conflict_policy`，固定为 `reject-overlap`

路径所有权重叠时拒绝派发；所有 Cocos Editor 写任务即使文件路径不重叠也必须串行。

## 任务派发契约

每个 `.cocos-workflow/tasks/<task_id>.yaml` 必须包含：

- `task_id`：工作流内唯一且不可复用。
- `role`：执行阶段职责。
- `baseline_revision`：仓库修订或工作区基线标识。
- `allowed_paths`：唯一可修改的项目相对路径；只读任务使用空列表。
- `read_only`：是否禁止写入。
- `inputs`：可为映射或列表。
- `output_paths`：预期输出路径。
- `depends_on`：必须先通过的任务 ID。
- `acceptance_checks`：总控必须复核的确定性检查。
- `state`、`attempt`、`created_at`。

递归扫描 `inputs` 时，映射键 `visual`、`visual_direction`、`scene_concept`，以及列表项 `type=visual|visual-direction|scene-concept` 都是视觉依赖。每个视觉依赖必须包含非空 `version` 和 `sha256:` `content_hash`；缺失时拒绝派发或验收。

## 代理返回契约

每个 `.cocos-workflow/results/<task_id>.yaml` 必须包含：

- `task_id`、`baseline_revision` 及所有输入的冻结版本和哈希。
- `status`：`passed | failed | blocked | stale`。
- `changed_paths`：实际修改的项目相对路径。
- `artifacts`：产物路径、类型、版本及内容哈希。
- `checks`：检查名、命令或方法、结果和摘要。
- `evidence`：日志、截图、报告或读回证据路径。
- `issues`：包含检查 ID、严重级别、状态、描述、证据、处置及解除条件。
- `handoff_notes`：给下游的约束与上下文。

`passed` 结果必须包含非空证据。`changed_paths` 越界、证据缺失、冻结版本不匹配或 P0 失败时拒绝验收。P1 只有绑定具体检查与工件哈希的有效人工豁免才可继续；P2 默认仅报告。

## 阶段工件与审批门禁

阶段离开后，总控必须同时校验实际存在的工件及 `workflow.yaml.approval_gates` 中的同名门禁。唯一视觉方向工件路径为 `artifacts/visual-direction.yaml`，不得使用 `art/visual-direction.yaml`。

| 完成阶段 | 工件路径 | 工件状态 | 门禁键 |
| --- | --- | --- | --- |
| requirements | `requirements.yaml` | `approved` | `requirements` |
| visual-direction | `artifacts/visual-direction.yaml` | `frozen` | `visual-direction` |
| planning | `artifacts/implementation-plan.yaml` | `approved` | `implementation-plan` |
| production | `artifacts/game-assets.yaml` | `approved` | `game-assets` |
| verification | `artifacts/verification.yaml` | `passed` | `verification` |
| delivery | `artifacts/delivery.yaml` | `passed` | `delivery` |

每个已完成阶段的工件必须具有有效 `schema_version`、`content_hash` 和阶段要求的状态；需要人工批准的工件还必须具有 `approval.status`、`approved_by`、`approved_at` 与等于 `content_hash` 的 `approval.subject_hash`。门禁必须严格使用 `status: passed`、非空 `approved_by`、非空 `approved_at` 和等于同一工件 `content_hash` 的 `subject_hash`。为避免审批哈希自引用，工件的 `content_hash` 计算排除顶层 `content_hash` 以及 `approval.subject_hash`。

`passed` 任务和结果中的 `evidence`、`changed_paths`、`output_paths` 必须是实际存在的项目内 POSIX 相对路径；绝对路径、盘符、`..`、反斜杠和解析后越过项目根目录的符号链接均为 P0。过渡 `evidence` 同样必须指向真实项目内文件，不能使用字符串、外部路径或伪造的工件 ID 替代。

## 项目配置示例

```yaml
schema_version: 1
project_id: portrait-demo
engine: {name: Cocos Creator, version: 3.8.6}
project_type: 2d
platform: web-mobile
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
capture_profiles: []
fit_policy: {mode: show-all, allow_letterbox: true}
safe_area: {enabled: true}
project_root: D:/games/portrait-demo
cocos_project_file: project.json
initial_scene: null
status: frozen
frozen_at: 2026-07-12T10:00:00+08:00
approved_by: human
content_hash: sha256:<hash>
```
