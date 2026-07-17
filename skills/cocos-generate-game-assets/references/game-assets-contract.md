# 游戏图片资源契约

每个正式场景拥有一份清单，位于 `.cocos-workflow/artifacts/game-assets/<scene_id>.yaml`；独立图片和元数据位于 `.cocos-workflow/art/assets/<asset_id>/`。它们是待集成的源文件，不代表已经导入 Cocos Editor。

```yaml
schema_version: 3
stage: production
status: pending # pending | blocked | approved | stale
asset_set_version: 1
scene_id: home
implementation_plan_hash: sha256:<approved implementation-plan hash>
source_scene_concepts:
  - {scene_id: home, artifact_path: artifacts/scene-concepts/home.md, content_hash: sha256:<approved scene-concept hash>}
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
      concept_path: art/concepts/home/effect-final.png # 必须等于场景工件 final_image_path
      concept_hash: sha256:<hash> # 必须等于场景工件 final_image_hash
      layer_source_path: art/concepts/home/game-art-selected.png # UI 资源则指向 ui-final.pen
      layer_source_hash: sha256:<hash>
      reference_licenses: []
    fidelity_checks: [] # silhouette、perspective、material、light 或 pixel-grid、nine-slice、states、copy
    license: {status: needs-human-review, evidence: []}
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash and approval.subject_hash>
```

## 必须检查

- `scene_id` 必须与路径目录名、任务 `scene_id` 和所有 `assets[].source.scene_id` 相同；`asset_id`、`output_path` 唯一；每项只服务一个运行时用途和一个独立图像。
- `implementation_plan_hash` 必须等于已批准 `implementation-plan.md` 的内容哈希。`source_scene_concepts` 只能包含本场景一项，且其 `artifact_path` 与 `content_hash` 必须精确等于该场景已批准概念工件。每项 `concept_path`/`concept_hash` 必须精确等于该工件的 `final_image_path`/`final_image_hash`；UI 资源的 `layer_source_path`/`layer_source_hash` 必须精确等于 `ui_design.editable_source_path`/`editable_source_hash`。
- `output_hash` 是图像二进制 SHA-256；提示词、概念、视觉方向、项目配置和许可证证据均必须可追溯。
- `layer_source_path` 必须指向已批准效果图工件中的原画层或可编辑 UI 源。`fidelity_checks` 必须按资源类型覆盖原画还原或 UI 精确导出检查，禁止从最终截图裁切带污染像素的资源。
- 尺寸、方向和设计分辨率必须匹配已批准资产计划与冻结项目配置；未知、冲突或 `needs-human-review` 的许可证不得批准。
- `status: approved` 时，`approval.status` 为 `approved`，`approved_by`、`approved_at` 非空，且 `approval.subject_hash == content_hash`；每项资产均有可用许可证决定和检查证据。

## 场景资源门禁

每份 `game-assets/<scene_id>.yaml` 的批准是该场景的资源门禁。正式代码任务只能引用本场景同一份已批准清单的 `content_hash`。全局 `cocos-integrate-assets` 的 `release` 任务必须引用所有场景已批准清单的路径与哈希，并确认每个资源 ID 都存在于对应清单。单个图片审批、旧清单或未批准清单不能用于 Cocos 导入、节点绑定或把生产阶段推进到 integration。概念、视觉方向、项目配置或资产计划改变时，受影响资产和清单必须置为 `stale` 并重新生成、复核、批准。
