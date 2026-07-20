# 集成契约

集成任务由已批准 `implementation-plan.md` front matter 中的 `integration_batches` 派生。它必须在一个时间只拥有一个 Cocos 编辑器写者，且在每个批次完成后保存读回证据。

```yaml
schema_version: 1
stage: integration
status: pending # pending | running | passed | failed | blocked | stale
integration_mode: release # prototype | release
project_profile_hash: sha256:<当前 project-profile>
requirements_hash: sha256:<当前 requirements>
visual_direction:
  version: 1
  content_hash: sha256:<当前冻结视觉方向>
implementation_plan_hash: sha256:<当前 implementation-plan>
scene_boundaries: [] # 每项含 scene_id、path、content_hash；必须匹配绑定清单
scene_blueprints: [] # 每项含 scene_id、blueprint_hash、节点/组件读回断言路径
code_binding_manifest_hash: sha256:<当前绑定清单>
asset_artifacts: [] # release 时为已批准 artifacts/game-assets/<scene_id>.yaml 的路径与 content_hash；prototype 必须为空
cocos_writer: integration-task-id
capability_snapshot: .cocos-workflow/reports/mcp-capabilities.json
batches: []
changed_paths: []
evidence: []
issues: []
content_hash: sha256:<规范化内容，不含 content_hash 与 approval.subject_hash>
```

## 每批记录

`batches` 每项含 `batch_index`、`task_ids`、`scene_blueprint_ids`、`queries`、`writes`、`resource_refresh`、`resource_ready_checks`、`save_evidence`、`readback_checks`、`status`、`evidence_paths`。`writes` 每项必须记录工具、已声明参数、目标稳定 ID、前置查询证据和是否覆盖。禁止出现未审批的 `overwrite: true`。

`resource_refresh` 必须记录本批资源路径、刷新/编译工具及参数、开始/完成时间、最终状态、编译错误和状态查询证据。`resource_ready_checks` 必须逐项记录资源路径、`.meta` 路径、独立 `.meta` 路径查询工具与证据、文件存在/非空状态、UUID、资源类型、所需子资源 ID 和资源元数据查询证据。没有资源写入的纯节点批次可将两项记为 `not-applicable`；包含资源写入的批次不得为空。

## 不变量

- `cocos_writer` 必须与 `ownership.yaml.active_cocos_writers` 中唯一条目和计划 `path_ownership.cocos_writer` 对应；不一致即阻塞。
- `integration_mode: prototype` 仅允许处理 `vertical_slice.task_ids`，允许占位资源，且 `asset_artifacts` 必须为空；不得把原型结果标记为正式交付。
- `integration_mode: release` 只能在所有正式 scene loops 的人工评审通过后开始；`asset_artifacts` 必须逐项记录已批准的场景资源清单路径和内容哈希，所有导入与绑定的资源 ID 都必须可在对应清单中解析。
- `scene_blueprints` 必须覆盖本次写入的每个正式场景，并绑定实施计划中的同一蓝图哈希。每个场景先完成节点/组件批次：查询、仅创建缺失的声明节点和组件、保存、读回节点 ID、父子关系、组件类型及关键属性；未通过前禁止该场景的资源导入和代码绑定。
- `scene_boundaries` 必须覆盖本次写入的每个正式场景，其内容哈希必须与代码绑定清单和任务输入一致。任何资源导入、组件添加或代码绑定都只能服务于对应边界工件内已归属的功能；未批准、过期或不匹配时停止该场景及后续批次。
- 代码绑定只能作用于蓝图中声明且已读回通过的稳定节点 ID 与组件。节点或组件存在但与蓝图不一致时必须失败并保留证据，禁止用 `overwrite`、移动、删除或额外节点绕过。
- 每个包含资源创建或导入的批次必须先完成该批全部资源写入，再触发一次 AssetDB 刷新/编译并等待明确成功。刷新完成前禁止绑定、使用该批资源或开始下一批；禁止用固定等待时间替代状态查询。
- 能力快照必须为资源批次提供独立 `.meta` 路径查询能力；不得用普通资源查询、UUID 或源文件存在推断 `.meta` 状态。能力缺失时批次为 `blocked`，不得执行资源写入或刷新。
- 资源只有在刷新编译成功，独立路径查询证明 `<资源路径>.meta` 存在且非空，并且资源元数据查询证明 UUID、类型和所需子资源 ID 均有效后才视为 `ready`。执行后发生资源失败、超时、状态未知、`.meta` 缺失/为空或 UUID/子资源为空时整批 `failed`，后续绑定不得执行。
- 绑定读回的 UUID/子资源 ID 必须与同批 `resource_ready_checks` 完全一致；仅存在源文件或 `.meta` 文件不构成可用证据。
- 批次严格按连续升序执行；后一批不得在前一批通过读回检查前开始。
- `changed_paths` 必须在任务的 `allowed_paths` 内；禁止删除、移动和目录外写入。
- `passed` 要求每批都有非空查询、保存、读回和证据。任何 P0 问题、能力缺失或读回失败均阻止 `passed`。
- 能力快照是本次 MCP 工具和参数的唯一依据；静态名称不构成调用许可。
