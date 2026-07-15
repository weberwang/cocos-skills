# 技术设计契约

工件固定为 `.cocos-workflow/artifacts/technical-design.md`，以 YAML front matter 保存结构化字段，并用 Markdown 正文说明架构决策、风险和验证方式。

```yaml
schema_version: 1
technical_design_version: 1
status: draft # draft | blocked | approved | stale
project_profile_hash: sha256:<frozen project profile>
requirements_hash: sha256:<approved requirements>
systems_design_hash: sha256:<approved systems design>
architecture:
  scene_boundaries: []
  module_boundaries: []
  event_boundaries: []
  resource_strategy: <strategy>
adrs:
  - id: input-routing
    system_ids: []
    risk: high # high | medium | low
    problem: <decision to make>
    options: []
    decision: <selected option>
    consequences: []
    validation: []
performance_budget: {initial_load_ms: 0, p95_frame_ms: 0, draw_calls: 0, build_bytes: 0}
accessibility: {touch_target_css_px: 44, contrast_rules: [], motion_reduction: []}
control_manifest: {required_patterns: [], forbidden_patterns: []}
unresolved_questions: []
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

- 三个输入哈希必须与当前已批准工件一致；`adrs` 的 `id` 唯一，每项均须含问题、备选项、决定、后果和验证方式。
- 每个 `high` 风险系统至少有一条 ADR；性能预算的数值必须为正数，触控目标不得低于 44 CSS 像素。
- `control_manifest` 必须同时包含非空的 `required_patterns` 与 `forbidden_patterns`；`unresolved_questions` 非空时不得批准。
- 仅在人工批准与 `content_hash` 绑定时使用 `status: approved`；任一输入变化均使工件 `stale`。
