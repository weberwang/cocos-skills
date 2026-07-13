# 视觉方向契约

产物为 `.cocos-workflow/artifacts/visual-direction.yaml`。`workflow.yaml.visual_direction` 仅由总控在验收后更新。

```yaml
schema_version: 1
status: draft # draft | blocked | frozen | superseded
visual_direction_version: 1
requirements_hash: sha256:<approved requirements hash>
project_profile_hash: sha256:<frozen project profile hash>
orientation: portrait # 必须与 project-profile 完全一致
design_resolution: {width: 1080, height: 1920, source: approved-default}
direction:
  audience_rationale: <why this fits the approved audience>
  keywords: []
  palette: [] # name, hex, role, contrast_notes
  typography: [] # role, family_or_fallback, weight, usage
  shape_and_layout: []
  icon_and_illustration: []
  motion_cues: []
  accessibility_rules: []
  prohibited: []
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
- `requirements_hash`、`project_profile_hash`、引用哈希和 `content_hash` 必须为 `sha256:` 值。
- `orientation` 与 `design_resolution` 必须逐字段复制自冻结 `project-profile.yaml`，包括 `source`；不允许模板默认值覆盖它们。
- `references` 每项都必须有非空 `path`、`purpose`、`source`、`license_status` 和 `content_hash`。授权未知或不兼容时为 `blocked`。
- `reference_effect_images` 必须恰好有两项，且每项的 `path`、`purpose`、`prompt_hash`、`generator`、`content_hash` 与 `review_status` 均非空。图像必须由 `$imagegen` 生成、位于 `art/visual-references/` 下，并与冻结的方向、方向和设计分辨率一致；缺少、额外、被拒绝或未批准的图像均不得冻结。
- 规范化哈希使用字段名排序的 UTF-8 JSON 表示；排除最外层 `content_hash`，不丢弃空数组或空映射。
- `status: frozen` 时，`approval.status` 必须为 `approved`，且 `subject_hash` 等于 `content_hash`。其他状态不得伪造批准人、时间或主题哈希。

## 失效规则

下列任一变化都使冻结失效：需求哈希、项目配置哈希、方向、分辨率、引用内容或授权状态、任一参考效果图、图像提示词或生成器元数据。写入者将旧工件标为 `superseded` 并在任务结果中请求总控将 `planning` 至 `completed` 标为失效；禁止本 Skill 改写总控状态。
