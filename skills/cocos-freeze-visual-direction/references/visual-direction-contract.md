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
  commercial_benchmarks: # 3–5 个已发布游戏；仅分析可观察的模式，绝不复制受保护表达
    - title: <game title>
      source_url: <official or reputable public page>
      adopt_patterns: []
      avoid_patterns: []
      use: analysis-only
  color_system:
    tokens: [] # token, hex, role, allowed_surfaces, contrast_notes
    usage_rules: [] # 例如：强调色仅用于主 CTA/奖励；每屏最多一种强调色
    composition: {base_ratio: 0, surface_ratio: 0, accent_ratio: 0, max_simultaneous_accents: 1}
  restraint_expression:
    default: {context: default, restraint_ratio: 0.8, expression_ratio: 0.2, primary_focal_points_max: 1, secondary_focal_points_max: 1}
    contexts: [] # 例如大厅 0.7/0.3、战斗/结算 0.6/0.4；仅按已批准页面类型声明
    restraint_rules: [] # 低饱和背景、有限材质、安静容器、次级信息降噪
    expression_rules: [] # 仅主 CTA、奖励、关键角色或关键事件可使用高对比/动效/材质
  palette: [] # 必须引用 color_system.tokens；name, hex, role, contrast_notes
  typography: [] # role, family_or_fallback, weight, usage
  shape_and_layout: []
  icon_and_illustration: []
  motion_cues: []
  functional_ui_rules: [] # 主操作可辨识、触控区域、信息优先级、状态反馈和文本容量
  accessibility_rules: []
  prohibited: []
quality_rubric:
  minimum_dimension_score: 4 # 1–5
  minimum_average_score: 4.2
  dimensions: [genre_fit, color_discipline, restraint_expression_balance, visual_hierarchy, functional_clarity, production_readiness]
reference_reviews: # 与两张 reference_effect_images 一一对应
  - image_path: art/visual-references/<reference_id>.png
    scores: {genre_fit: 0, color_discipline: 0, restraint_expression_balance: 0, visual_hierarchy: 0, functional_clarity: 0, production_readiness: 0}
    average_score: 0
    verdict: pending # pending | passed | failed
    evidence: []
references: [] # path, purpose, source, license_status, content_hash
reference_effect_images: # 必须恰好两项；视觉冻结阶段生成的全局风格参考图，不是场景概念图
  - path: art/visual-references/<reference_id>.png
    purpose: <global style reference purpose>
    prompt_hash: sha256:<generated prompt hash>
    generator: <recorded ImageGen metadata>
    content_hash: sha256:<image binary hash>
    review_status: pending # pending | approved | rejected
  - path: art/visual-references/<reference_id>.png
    purpose: <global style reference purpose>
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
- `commercial_benchmarks` 必须有 3–5 项；每项均有标题、公开来源、至少一个 `adopt_patterns` 与 `avoid_patterns`，且 `use` 固定为 `analysis-only`。它们只允许用于抽象模式分析，不能作为待复制的素材、品牌或页面布局。
- `color_system.tokens`、`usage_rules` 与 `composition` 必须非空；所有比例在 0–1 之间且三项比例之和为 1，`max_simultaneous_accents` 为正整数。`palette` 中每个颜色必须可追溯到一个 token。缺少角色、用量或对比度说明的颜色不得冻结。
- `restraint_expression.default` 必须包含 0–1 之间且和为 1 的 `restraint_ratio` 与 `expression_ratio`，以及均为非负整数的主/次焦点上限。每个 `contexts` 条目必须声明已批准页面类型及同一组字段；不得为单个场景临时发明比例。`restraint_rules` 与 `expression_rules` 均必须非空，后者只能授权给主 CTA、奖励、关键角色或关键事件。
- `functional_ui_rules` 必须覆盖主操作辨识、触控区域、信息优先级、状态反馈和文本容量；这些规则约束视觉设计，不替代可运行交互的 Chrome 验证。
- `quality_rubric` 的六个固定维度必须完整，`minimum_dimension_score` 为 1–5，`minimum_average_score` 为 1–5。`reference_reviews` 必须恰好两项并逐一对应参考图；所有维度分数不得低于最小值、平均分不得低于阈值、`verdict` 必须为 `passed`，否则不得冻结。
- `reference_effect_images` 必须恰好有两项，且每项的 `path`、`purpose`、`prompt_hash`、`generator`、`content_hash` 与 `review_status` 均非空。图像必须由 `$imagegen` 生成、位于 `art/visual-references/` 下，并与冻结的方向、方向和设计分辨率一致；缺少、额外、被拒绝或未批准的图像均不得冻结。
- 规范化哈希使用字段名排序的 UTF-8 JSON 表示；排除最外层 `content_hash`，不丢弃空数组或空映射。
- `status: frozen` 时，`approval.status` 必须为 `approved`，且 `subject_hash` 等于 `content_hash`。其他状态不得伪造批准人、时间或主题哈希。

## 失效规则

下列任一变化都使冻结失效：需求、系统设计、技术设计或项目配置哈希，方向、分辨率、引用内容或授权状态、任一参考效果图、图像提示词或生成器元数据。写入者将旧工件标为 `superseded` 并在任务结果中请求总控将 `scene-concepts` 至 `completed` 标为失效；禁止本 Skill 改写总控状态。
