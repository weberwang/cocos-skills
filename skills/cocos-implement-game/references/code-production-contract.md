# 代码生产契约

代码阶段的输出由计划任务声明；绑定清单固定为 `.cocos-workflow/artifacts/code-binding-manifest.yaml`。它只描述意图，不能被用作编辑器写入证据。

```yaml
schema_version: 1
status: draft # draft | blocked | passed | failed | stale
project_profile_hash: sha256:<当前 project-profile>
requirements_hash: sha256:<当前 requirements>
visual_direction:
  version: 1
  content_hash: sha256:<当前冻结视觉方向>
implementation_plan_hash: sha256:<当前 implementation-plan>
approved_asset_manifest_hash: null # 无 asset_ids 时可为 null；否则为已批准 game-assets.yaml 的 content_hash
bindings:
  - binding_id: game-controller
    script_path: assets/scripts/GameController.ts
    class_name: GameController
    target:
      scene_id: game
      node_id: game-root
      component: GameController
    properties: []
    asset_ids: []
    binding_order: 1
    readback_assertions: []
tests: []
content_hash: sha256:<规范化内容，不含 content_hash>
```

## 规则

- 每个 `bindings` 项有唯一 `binding_id`、稳定节点 ID、组件类型、脚本路径和连续的 `binding_order`；缺少目标或断言时阻塞集成。
- `properties` 每项含 `name`、`value_source`、`required`；`asset_ids` 只能引用计划内已许可且存在于 `status: approved` 的 `game-assets.yaml` 中的资源。存在任一 `asset_ids` 时，`approved_asset_manifest_hash` 必须等于该清单 `content_hash` 与其审批 `subject_hash`；否则 binding manifest 只能为 `blocked`，不得声称 `passed`。
- `tests` 每项含 `id`、`path`、`command`、`result`、`evidence_path`；必需测试失败时状态不是 `passed`。
- `content_hash` 与所有冻结输入哈希一起写入任务结果。当前输入不同则结果为 `stale`，而不是沿用旧绑定。
- 所有实际代码变更必须属于分配任务的 `allowed_paths`。脚本、测试与清单之外的变更需要总控重新派发。
