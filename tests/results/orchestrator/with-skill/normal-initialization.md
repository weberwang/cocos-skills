下一步行动：

1. 读取项目根目录、`project.json` 和现有 `.scene` 文件，确认项目确为 Cocos Creator `3.8.6`、2D 项目。
2. 采用竖屏默认设计分辨率 `1080 × 1920`，`source: approved-default`。
3. 获取并记录实际批准者身份；初始化调用本身视为该批准者已经批准项目方向与默认分辨率。
4. 计算 `project-profile.yaml` 的 SHA-256：计算时排除 `content_hash` 字段。
5. 在项目根目录内的唯一临时目录准备完整 `.cocos-workflow/` 结构，校验后通过一次同卷重命名发布。
6. 初始化后进入 `bootstrap/running`，执行 MCP 健康检查和能力发现，并准备 `.cocos-workflow/reports/mcp-capabilities.json`。
7. 查明安全的项目相对初始场景路径。若不存在 `.scene`，保持在 `bootstrap`，不得标记为 `passed` 或派发下游任务。
8. 仅在初始场景、能力快照、配置哈希和项目配置门禁全部有效后，将 `bootstrap` 标记为 `passed`，再进入 `requirements/pending` 并派发 `$cocos-define-game`。

准备的目录：

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
└── reports/
    └── chrome/
```

准备的 `project-profile.yaml`：

```yaml
schema_version: 1
project_id: <生成的项目 ID>
engine:
  name: Cocos Creator
  version: 3.8.6
project_type: 2d
platform: web-mobile
orientation: portrait
design_resolution:
  width: 1080
  height: 1920
  source: approved-default
capture_profiles: []
fit_policy:
  mode: show-all
  allow_letterbox: true
safe_area:
  enabled: true
project_root: <规范化后的项目根目录>
cocos_project_file: project.json
initial_scene: null
status: frozen
frozen_at: <ISO-8601 时间>
approved_by: <实际批准者>
content_hash: sha256:<排除 content_hash 字段后计算的哈希>
```

`initial_scene: null` 只适用于 `bootstrap/pending | running | blocked`。标记 `bootstrap/passed` 前必须改为非空、项目相对、无 `..` 且以 `.scene` 结尾的路径，并重新计算配置哈希及同步更新项目配置门禁。

准备的 `workflow.yaml` 初始状态：

```yaml
schema_version: 1
workflow_id: <生成的工作流 ID>
state: bootstrap
run_status: pending
active_task_ids: []
completed_task_ids: []
task_status: {}
artifacts: {}
visual_direction:
  version: null
  content_hash: null
approval_gates:
  project-configuration:
    status: passed
    approved_by: <与 project-profile.yaml 完全一致>
    approved_at: <ISO-8601 时间>
    subject_hash: sha256:<与 project-profile.yaml.content_hash 完全一致>
invalidated: []
transitions: []
updated_at: <ISO-8601 时间>
```

`approval_gates.project-configuration` 严格只使用以下 canonical 字段：

```yaml
status:
approved_by:
approved_at:
subject_hash:
```

不得使用 `artifact` 或 `content_hash` 替代。项目配置发生任何变化时，必须重新计算 `project-profile.yaml.content_hash`，并同步更新 `subject_hash`、批准时间和有效批准记录。

准备的 `quality-gates.yaml`：

```yaml
schema_version: 1
P0:
  policy: blocking
  waivable: false
P1:
  policy: blocking
  waiver_requires_human_approval: true
P2:
  policy: report
```

准备的 `ownership.yaml`：

```yaml
schema_version: 1
workflow_writer: cocos-orchestrate-web-workflow
active_cocos_writers: []
path_owners: {}
conflict_policy: reject-overlap
```

允许的状态迁移及记录要求：

```text
bootstrap/pending
→ bootstrap/running
→ bootstrap/passed
→ requirements/pending
```

初始 `bootstrap/pending` 可使用空 `transitions`。一旦进入 `running`，迁移链必须从 `bootstrap/pending` 开始完整记录。每条迁移必须包含：

```yaml
from_state:
to_state:
from_run_status:
to_run_status:
timestamp:
reason:
evidence:
```

其中 `timestamp`、`reason` 不得为空，`evidence` 必须是非空列表，迁移链必须前后连续并回放到当前 `state/run_status`。

离开 `bootstrap` 所需证据：

- `project-profile.yaml` 字段完整，`status: frozen`。
- Creator 版本按语义版本比较满足 `>= 3.8.6`。
- `approved_by` 与 `frozen_at` 非空。
- `content_hash` 校验正确。
- `approval_gates.project-configuration.status: passed`。
- 项目配置门禁的 `approved_by` 与项目配置一致。
- `subject_hash` 与 `project-profile.yaml.content_hash` 完全一致。
- `initial_scene` 是安全的项目相对 `.scene` 路径。
- `.cocos-workflow/reports/mcp-capabilities.json` 根节点为映射，并含非空 `tools` 或 `capabilities`。
- 初始化目录通过完整临时目录和一次同卷重命名发布，没有残留临时目录。
- 所有迁移记录均使用 canonical 七字段、证据非空且链条连续。

在这些证据齐备前，不派发任何阶段 Skill；若缺少初始场景、批准者或有效能力快照，则保持 `bootstrap` 并转为 `blocked`，记录明确解除条件。
