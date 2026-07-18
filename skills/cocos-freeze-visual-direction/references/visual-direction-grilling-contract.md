# 全局视觉方向拷问契约

产物为 `.cocos-workflow/artifacts/visual-direction-brief.md`。它先于视觉规范和质量锚点生成，只冻结设计决策边界，不包含具体场景成品。

```yaml
schema_version: 1
stage: visual-direction
status: pending # pending | blocked | approved | stale
project_profile_hash: sha256:<frozen project profile>
requirements_hash: sha256:<approved requirements>
systems_design_hash: sha256:<approved systems design>
technical_design_hash: sha256:<approved technical design>
visual_boundary:
  target_audience: []
  emotional_experience: []
  game_art_style: []
  ui_style: []
  commercial_quality_benchmarks: []
  shared_visual_language: {character: [], environment: [], ui: []}
  system_constraints:
    color: []
    typography: []
    iconography: []
    materials: []
    lighting: []
    motion: []
  quality_anchor_roles:
    game_art_quality_anchor: []
    ui_system_quality_anchor: []
  restraint_and_focus_budget: []
  device_and_performance_constraints: []
  prohibited_elements: []
  global_invariants: []
  scene_level_variants: []
  acceptance_ids: []
unresolved_questions: []
visual_direction_confirmation:
  status: pending # pending | confirmed
  subject_hash: null
  confirmed_by: null
  confirmed_at: null
  evidence: []
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash, visual_direction_confirmation.subject_hash and approval.subject_hash>
```

- `visual_boundary` 的全部字段必须非空，并明确区分全局强制规则与允许的场景级变化；不得用“高级”“好看”“参考同类游戏”等不可验收描述替代。
- 两张质量锚点只定义职责和通过条件，不在拷问任务中生成。拷问任务不得输出颜色 token、具体设计稿或场景资源。
- `unresolved_questions` 非空时必须为 `blocked`。
- 仅在 `visual_direction_confirmation.status: confirmed`、`visual_direction_confirmation.subject_hash == content_hash` 且 `approval.subject_hash == content_hash` 时，才可设为 `approved`。
- 项目配置、需求、系统设计或技术设计任一哈希变化都会使工件及其下游视觉冻结、规划、生产、集成、验证和交付结果 `stale`。
