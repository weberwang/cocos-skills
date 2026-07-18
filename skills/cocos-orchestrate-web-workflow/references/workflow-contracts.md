# 工作流契约

## 目录结构

```text
.cocos-workflow/
├── workflow.yaml
├── project-profile.yaml
├── quality-gates.yaml
├── ownership.yaml
├── requirements.md
├── artifacts/
│   ├── systems-design.md
│   ├── technical-design.md
│   ├── visual-direction.md
│   ├── implementation-plan.md
│   ├── pencil-drafts/
│   ├── scene-concepts/
│   ├── scene-boundaries/
│   ├── game-assets/
│   ├── generation-requests/
│   └── verification.md
├── tasks/
├── results/
├── art/
│   ├── concepts/
│   ├── visual-references/
│   └── runtime-baselines/
└── reports/human-review/
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
- `review_mode`，仅可为 `full | lean`；只控制补充审查频率，不能跳过硬门禁
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

`P0.require_vertical_slice` 必须为 `true`；它要求 production **先**完成核心玩法原型并获得已批准的垂直切片工件，之后才允许模块拆分、全局骨架与正式场景循环；推进到核心玩法正式场景时必须按正式版本实现，不得以原型替代交付。

`P0.visual_design_quality` 必须为 `true`。它要求冻结视觉方向同时提供可执行的游戏原画规范与 UI 系统、商业基准、颜色 token、克制/发散预算和功能 UI 规则；每个正式场景效果图至少有三个实质不同的原画候选、评审记录、可编辑 UI 源、真实文案、一次缺陷驱动精修和全部捕获视口证据。十一项质量评分（含克制/发散平衡）必须全部不低于 4/5、平均分不低于 4.5/5，且最终人工批准绑定最终图哈希。该门槛不可豁免。

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
- `business_flow_level`：production、integration 或 verification 任务必填；必须等于已批准实施计划中模块或页面所属的业务流等级。
- `decision_change`：可选映射；仅用于已批准 `requirements | systems-design | technical-design | planning` 的决策性返工，必须包含目标 `stage` 与变更材料的 `sha256:` `subject_hash`。事实勘误、文案、资产、实现、验证与交付任务不得声明它。
- `state`、`attempt`、`created_at`。

递归扫描 `inputs` 时，映射键 `visual`、`visual_direction`、`scene_concept`，以及列表项 `type=visual|visual-direction|scene-concept` 都是视觉依赖。每个视觉依赖必须包含非空 `version` 和 `sha256:` `content_hash`；缺失时拒绝派发或验收。

production 开始后，总控必须先完成 `vertical_slice` 核心玩法原型任务并获得人工批准，然后才可派发 `module_decomposition`、`global_scaffold` 与正式场景任务。其后仅派发最低未完成 `business_flow_level` 的任务。同级可在路径无冲突且依赖已满足时并行；后一等级任务必须直接依赖前一等级所有 `completion_task_ids`，并在这些任务的 `passed` 结果、证据和验收检查全部有效后才可派发。`is_core_gameplay: true` 的正式循环必须走完整 场景功能边界拷问 → Pencil → 效果图 → 资源/代码 → 人工评审路径。

每个正式场景在 Pencil 草图开始前必须派发唯一的 `role: grilling`、`kind: scene-boundary-grilling` 任务。该任务只能写 `artifacts/scene-boundaries/<scene_id>.md`、任务结果和报告，必须携带 `scene_boundary` 输入（`scene_id`、`scene_loop_id`、场景蓝图、需求、系统设计、技术设计、实施计划、冻结视觉方向及其哈希），并返回哈希绑定的 `scene_boundary_confirmation`。总控只在确认与人工批准均绑定该边界 `content_hash`、未决问题为空后，才可派发该场景的 `pencil-draft`；Pencil、高保真图、资源/代码及后续绑定/集成必须携带同一边界哈希。该门禁是 P0，原型 `vertical_slice` 例外，正式核心玩法场景不例外。

每个正式场景任务必须在 `inputs` 中携带对应 `scene_blueprint` 的 `scene_id`、内容哈希、节点稳定 ID 清单和组件读回断言。总控在派发正式代码、资源绑定或集成任务前，验证蓝图与实施计划一一对应，且包含场景根、运行时根、Canvas/UI 根、游戏内容根，以及按冻结配置和需求启用的安全区、HUD、弹层、相机、输入节点。缺失节点、组件、父子关系或读回断言均为 P0，任务保持 `blocked`。

验证任务必须携带 `verification_mode: human-review`、冻结 `initial_scene` 与 capture manifest 的人工审核哈希绑定。总控只接受人工审核者提供并签署的操作记录、截图、日志、像素比较和结论；自动预览、Chrome、Cocos MCP、构建产物、静态服务或打包文件的运行记录均不是验证证据。`building` 与 `delivery` 仅生成和校验交付物完整性，不得重新运行游戏。

正式 `visual-concept` 任务必须遵守 `1 task : 1 scene_id : 1 final image`，并按实施计划 `scene_loops` 的顺序串行派发。任意时刻 `active_task_ids` 中最多存在一个 `visual-concept`；当前场景的 `final-human-review` 未通过前，不得派发下一场景的候选生成。验收检查必须包含 `single-scene-scope`、`candidate-count`、`candidate-review`、`editable-ui-source`、`exact-copy`、`refinement-round`、`visual-quality-scores`、`capture-profile-legibility` 和 `final-human-review`。缺失任一项时不得接受结果或启动下一个场景。

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

## 决策拷问门禁

派发 `$grilling` 的只读任务使用 `role: grilling` 并携带 `decision_change`，不需要预先确认。重派发目标阶段时，任务必须保留同一 `decision_change` 并附带 `$grilling` 的 `grilling_confirmation`。确认记录必须包含 `status: confirmed`、`stage`、`subject_hash`、`confirmed_by`、`confirmed_at` 与至少一个项目内 `evidence` 路径；`stage` 和 `subject_hash` 必须分别等于任务的 `decision_change.stage` 与 `decision_change.subject_hash`。

总控验证确认记录后，写入 `workflow.yaml.approval_gates.grilling-<stage>`。该门禁使用 `status: passed`、`approved_by`、`approved_at`、`subject_hash` 和 `evidence`；其阶段和主题哈希必须与 `decision_change` 一致。未通过时，目标阶段保持 `blocked`，不得创建、接受或批准新的阶段工件。总控是唯一可写入该门禁和 `workflow.yaml` 的角色。

## 阶段工件与审批门禁

阶段离开后，总控必须同时校验实际存在的工件及 `workflow.yaml.approval_gates` 中的同名门禁。人可审阅的阶段工件必须保存为 Markdown：文件以 YAML front matter 开始，正文使用 Markdown 标题、段落和列表清晰表达工件内容。唯一视觉方向工件路径为 `artifacts/visual-direction.md`，不得使用 `art/visual-direction.yaml`。

Markdown 工件的 front matter 承载 `schema_version`、`stage`、状态、版本、冻结输入、审批和 `content_hash` 等结构化元数据；正文不得为空。`content_hash` 对不含自身及 `approval.subject_hash` 的 front matter 与完整正文共同计算，因此任何正文修改都会使已有批准失效。机器状态、任务、结果，以及资产、捕获和绑定清单继续使用 YAML。Pencil 草图、场景概念、场景资源清单、集成结果与验证工件均须显式声明 `stage`；禁止依赖非正式路径猜测阶段。

| 完成阶段 | 工件路径 | 工件状态 | 门禁键 |
| --- | --- | --- | --- |
| requirements | `requirements.md` | `approved` | `requirements` |
| systems-design | `artifacts/systems-design.md` | `approved` | `systems-design` |
| technical-design | `artifacts/technical-design.md` | `approved` | `technical-design` |
| visual-direction | `artifacts/visual-direction.md` | `frozen` | `visual-direction` |
| planning | `artifacts/implementation-plan.md` | `approved` | `implementation-plan` |
| production | `artifacts/scene-boundaries/<scene_id>.md` | `approved` | `scene-boundary-<scene_id>` |
| production | `artifacts/game-assets/<scene_id>.yaml` | `approved` | `game-assets` |
| verification | `artifacts/verification.md` | `passed` | `verification` |
| delivery | `artifacts/delivery.md` | `passed` | `delivery` |

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
review_mode: lean
project_root: D:/games/portrait-demo
cocos_project_file: project.json
initial_scene: null
status: frozen
frozen_at: 2026-07-12T10:00:00+08:00
approved_by: human
content_hash: sha256:<hash>
```
