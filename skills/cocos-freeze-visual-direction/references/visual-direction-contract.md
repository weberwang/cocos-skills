# 视觉方向契约

产物为 `.cocos-workflow/artifacts/visual-direction.md`，以 YAML front matter 保存冻结元数据，并用 Markdown 正文说明视觉规范。`workflow.yaml.visual_direction` 仅由总控在验收后更新。

```yaml
schema_version: 3
status: draft # draft | blocked | frozen | superseded
visual_direction_version: 1
requirements_hash: sha256:<approved requirements hash>
systems_design_hash: sha256:<approved systems design hash>
technical_design_hash: sha256:<approved technical design hash>
project_profile_hash: sha256:<frozen project profile hash>
orientation: portrait # 必须与 project-profile 完全一致
design_resolution: {width: 1080, height: 1920, source: approved-default}
direction:
  audience_rationale: <why this fits the approved audience>
  keywords: []
  commercial_benchmarks:
    - {title: <game title>, source_url: <official or reputable public page>, adopt_patterns: [], avoid_patterns: [], use: analysis-only}
  color_system:
    tokens: [] # token, hex, role, allowed_surfaces, contrast_notes
    usage_rules: []
    composition: {base_ratio: 0, surface_ratio: 0, accent_ratio: 0, max_simultaneous_accents: 1}
  restraint_expression:
    default: {context: default, restraint_ratio: 0.8, expression_ratio: 0.2, primary_focal_points_max: 1, secondary_focal_points_max: 1}
    contexts: [] # 仅按已批准页面类型覆盖，例如大厅 0.7/0.3、战斗或结算 0.6/0.4
    restraint_rules: []
    expression_rules: []
  palette: [] # name, hex, role, contrast_notes
  typography: [] # role, family_or_fallback, weight, usage
  shape_and_layout: []
  icon_and_illustration: []
  motion_cues: []
  functional_ui_rules: [] # 主操作、触控区域、信息优先级、状态反馈、文本容量
  accessibility_rules: []
  prohibited: []
  game_art_system:
    composition_and_storytelling: []
    camera_and_perspective: []
    character_proportion_pose_and_silhouette: []
    environment_depth_and_scale: []
    material_and_surface: []
    lighting_and_color_script: []
    vfx_and_atmosphere: []
    detail_density_and_asset_boundaries: []
  ui_system:
    grid_and_spacing: {base_unit: 8, columns: 4, margins: 48, rules: []}
    type_scale: [] # role、family、weight、size、line_height、contrast
    components: [] # id、shape、padding、states、usage
    icon_grid: {canvas: 24, stroke: 2, corner_rule: <rule>, optical_rules: []}
    hud_information_priority: []
    interaction_states: [normal, pressed, disabled, selected]
    minimum_touch_target: {width: 88, height: 88}
    copy_and_localization_rules: []
    safe_area_rules: []
quality_rubric:
  minimum_dimension_score: 4
  minimum_average_score: 4.5
  dimensions: [genre_fit, color_discipline, restraint_expression_balance, visual_hierarchy, functional_clarity, game_art_finish, production_readiness]
reference_reviews:
  - {image_path: art/visual-references/<reference_id>.png, scores: {}, average_score: 0, verdict: pending, evidence: []}
references: [] # path, purpose, source, license_status, content_hash
reference_effect_images: # 必须恰好两项；视觉冻结阶段生成的全局风格参考图，不是场景概念图
  - path: art/visual-references/<reference_id>.png
    role: game-art-quality-anchor
    purpose: <prove composition, material, lighting and production finish>
    prompt_hash: sha256:<generated prompt hash>
    generator: <recorded ImageGen metadata>
    content_hash: sha256:<image binary hash>
    review_status: pending # pending | approved | rejected
  - path: art/visual-references/<reference_id>.png
    role: ui-system-quality-anchor
    purpose: <prove hierarchy, components, icons and exact-copy legibility>
    prompt_hash: sha256:<generated prompt hash>
    generator: <recorded ImageGen metadata>
    content_hash: sha256:<image binary hash>
    review_status: pending # pending | approved | rejected
approval:
  status: pending # pending | approved
  approved_by: null
  approved_at: null
  subject_hash: null
content_hash: sha256:<normalized content excluding content_hash>
```

## 字段规则

- `visual_direction_version` 必须大于同项目已存在的最大版本；冻结版本不可原地修改。
- `requirements_hash`、`systems_design_hash`、`technical_design_hash`、`project_profile_hash`、引用哈希和 `content_hash` 必须为 `sha256:` 值。
- `orientation` 与 `design_resolution` 必须逐字段复制自冻结 `project-profile.yaml`，包括 `source`；不允许模板默认值覆盖它们。
- `references` 每项都必须有非空 `path`、`purpose`、`source`、`license_status` 和 `content_hash`。授权未知或不兼容时为 `blocked`。
- `commercial_benchmarks` 必须有 3–5 项；每项均有标题、公开来源、至少一个 `adopt_patterns` 和 `avoid_patterns`，且 `use` 固定为 `analysis-only`。它们只允许用于抽象模式分析，不能复制素材、品牌或页面布局。
- `color_system.tokens`、`usage_rules` 与 `composition` 必须非空；比例在 0–1 之间且三项之和为 1，`max_simultaneous_accents` 为正整数。`palette` 中每个颜色必须能追溯到一个 token。
- `restraint_expression.default` 必须包含和为 1 的 `restraint_ratio`/`expression_ratio` 和非负的主/次焦点上限；每个 `contexts` 条目必须关联已批准页面类型并有相同字段，禁止为单个场景临时发明比例。克制规则与发散规则均不得为空，发散仅授权给主 CTA、奖励、关键角色或关键事件。
- `functional_ui_rules` 必须覆盖主操作辨识、触控区域、信息优先级、状态反馈和文本容量。
- `reference_effect_images` 必须恰好有两项，且每项的 `path`、`purpose`、`prompt_hash`、`generator`、`content_hash` 与 `review_status` 均非空。图像必须由 `$imagegen` 生成、位于 `art/visual-references/` 下，并与冻结的方向、方向和设计分辨率一致；缺少、额外、被拒绝或未批准的图像均不得冻结。
- `reference_effect_images.role` 必须恰好包含一次 `game-art-quality-anchor` 和一次 `ui-system-quality-anchor`。UI 锚点必须使用真实文案，并保存可编辑文字与关键图标的设计源证据；禁止用生成伪文字证明 UI 质量。
- `game_art_system` 与 `ui_system` 的每个字段均须非空且可执行。组件至少声明 normal、pressed、disabled、selected 四种状态；文字层级必须给出字号、行高和对比规则；触控尺寸必须可被项目视口验证。
- `quality_rubric` 的全部七维必须完整；`reference_reviews` 必须恰好两项并逐一对应锚点图。每个维度不低于最小值、平均分不低于阈值、`verdict` 为 `passed`，否则不得冻结。
- 规范化哈希使用字段名排序的 UTF-8 JSON 表示；排除最外层 `content_hash`，不丢弃空数组或空映射。
- `status: frozen` 时，`approval.status` 必须为 `approved`，且 `subject_hash` 等于 `content_hash`。其他状态不得伪造批准人、时间或主题哈希。

## 失效规则

下列任一变化都使冻结失效：需求、系统设计、技术设计或项目配置哈希，方向、分辨率、引用内容或授权状态、任一参考效果图、图像提示词或生成器元数据。写入者将旧工件标为 `superseded` 并在任务结果中请求总控将 `scene-concepts` 至 `completed` 标为失效；禁止本 Skill 改写总控状态。
