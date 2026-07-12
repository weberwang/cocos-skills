# 游戏图片资源契约

清单为 `.cocos-workflow/artifacts/game-assets.yaml`；独立图片和元数据位于 `.cocos-workflow/art/assets/<asset_id>/`。这些是待集成源文件，不是 Cocos Editor 已导入资源。

```yaml
schema_version: 1
status: pending # pending | blocked | approved | stale
asset_set_version: 1
asset_plan_hash: sha256:<approved planning asset-plan hash>
scene_concepts_hash: sha256:<approved scene-concepts hash>
project_profile_hash: sha256:<hash>
visual_direction_version: 3
visual_direction_hash: sha256:<hash>
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
assets:
  - asset_id: home-play-button
    purpose: home primary action
    output_path: art/assets/home-play-button/image.png
    output_hash: sha256:<binary hash>
    dimensions: {width: 512, height: 160}
    background: transparent
    prompt_path: art/assets/home-play-button/prompt.yaml
    prompt_hash: sha256:<hash>
    generator: {tool: imagegen, model_or_version: <returned value>, generated_at: <timestamp>}
    source:
      scene_id: home
      concept_path: art/concepts/home/effect.png
      concept_hash: sha256:<hash>
      reference_licenses: []
    license: {status: needs-human-review, evidence: []}
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

## 必须检查

- `asset_id`、`output_path` 唯一；每项只有一个运行时用途和一个独立图像。
- `output_hash` 是图像二进制 SHA-256；提示词和所有上游来源也必须记录 `sha256:` 哈希。
- `dimensions` 必须匹配批准的资源计划，不可用设计分辨率推断替代；`orientation` 和 `design_resolution` 仍须逐字段等于冻结项目配置。
- `source` 必须引用已批准场景概念并保留所有相关参考许可信息。许可证未知、不兼容或 `needs-human-review` 时不可批准。
- `status: approved` 时，审批主题哈希必须等于清单 `content_hash`，并且每个资源都有可用许可证决定与检查证据。
- 上游概念、视觉方向、项目配置或资源计划变化时，受影响条目和清单为 `stale`，需重新生成和审核。
