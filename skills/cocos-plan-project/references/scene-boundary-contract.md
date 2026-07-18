# 场景功能边界契约

每个正式场景在 Pencil 草图开始前，必须由 `$grilling` 写入 `.cocos-workflow/artifacts/scene-boundaries/<scene_id>.md`。工件以 YAML front matter 保存结构化字段，正文用 Markdown 解释取舍与场景职责。

```yaml
schema_version: 1
stage: production
status: pending # pending | blocked | approved | stale
scene_id: menu
scene_loop_id: scene-loop-menu
project_profile_hash: sha256:<frozen profile>
requirements_hash: sha256:<approved requirements>
systems_design_hash: sha256:<approved systems design>
technical_design_hash: sha256:<approved technical design>
implementation_plan_hash: sha256:<approved plan>
visual_direction: {version: 1, content_hash: sha256:<approved visual direction>}
scene_blueprint_hash: sha256:<approved scene blueprint>
functional_boundary:
  purpose: <this scene's sole user-facing responsibility>
  entry_conditions: []
  exit_conditions: []
  player_actions: []
  ui_states: [] # normal | loading | empty | disabled | error | success | paused 等实际状态
  data_contract: {inputs: [], outputs: [], persistence: [], reset_rules: []}
  integrations: {module_ids: [], event_contracts: [], node_ids: []}
  edge_cases: [] # 失败、空态、重试、返回和中断
  out_of_scope: [] # 每项注明接收方 scene_id 或 global module_id
  acceptance_ids: []
unresolved_questions: []
scene_boundary_confirmation:
  status: pending # pending | confirmed
  scene_id: menu
  scene_loop_id: scene-loop-menu
  subject_hash: null
  confirmed_by: null
  confirmed_at: null
  evidence: []
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash, confirmation.subject_hash and approval.subject_hash>
```

- 每个字段必须只描述当前 `scene_id` 的功能；跨场景功能必须在 `out_of_scope` 中写明稳定接收方，禁止模糊共享责任。
- `functional_boundary` 的目的、进出条件、玩家动作、UI 状态、数据契约、集成、边界条件、非范围和验收 ID 必须非空；`unresolved_questions` 非空时为 `blocked`。
- 仅在 `scene_boundary_confirmation.status: confirmed`、其 `scene_id`/`scene_loop_id` 匹配、`subject_hash == content_hash`，且人工 `approval.subject_hash == content_hash` 时，才可设为 `approved`。
- 需求、系统设计、技术设计、实施计划、冻结视觉方向或场景蓝图任一变化都会使边界工件 `stale`。边界工件变化会使该场景的 Pencil 草图、高保真效果图、资源、正式代码、绑定、集成和验证结果全部 `stale`。
