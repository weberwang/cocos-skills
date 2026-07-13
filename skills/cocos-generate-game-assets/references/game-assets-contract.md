# 游戏图片资源契约

清单位于 `.cocos-workflow/artifacts/game-assets.yaml`；独立图片和元数据位于 `.cocos-workflow/art/assets/<asset_id>/`。它们是待集成的源文件，不代表已经导入 Cocos Editor。

```yaml
schema_version: 1
status: pending # pending | blocked | approved | stale
asset_set_version: 1
asset_plan_hash: sha256:<approved planning asset-plan hash>
scene_concept_hash: sha256:<approved per-scene scene-concept hash>
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

- `asset_id`、`output_path` 唯一；每项只服务一个运行时用途和一个独立图像。
- `output_hash` 是图像二进制 SHA-256；提示词、概念、视觉方向、项目配置和许可证证据均必须可追溯。
- 尺寸、方向和设计分辨率必须匹配已批准资产计划与冻结项目配置；未知、冲突或 `needs-human-review` 的许可证不得批准。
- `status: approved` 时，`approval.status` 为 `approved`，`approved_by`、`approved_at` 非空，且 `approval.subject_hash == content_hash`；每项资产均有可用许可证决定和检查证据。

## 生产汇合门禁

完整 `game-assets.yaml` 的批准是生产汇合门禁。`cocos-integrate-assets` 和任何包含 `asset_ids` 的代码绑定都必须引用同一份 `content_hash`，并确认资源 ID 存在于已批准清单。单个图片审批、旧清单或未批准清单不能用于 Cocos 导入、节点绑定或把生产阶段推进到 integration。概念、视觉方向、项目配置或资产计划改变时，受影响资产和清单必须置为 `stale` 并重新生成、复核、批准。
