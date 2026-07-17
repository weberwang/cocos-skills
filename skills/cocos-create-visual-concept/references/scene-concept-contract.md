# 场景效果图契约

每个场景/UI 的工件为 `.cocos-workflow/artifacts/scene-concepts/<scene_id>.md`，图像与记录位于 `.cocos-workflow/art/concepts/<scene_id>/`。工件以 YAML front matter 保存可校验元数据，并用 Markdown 正文说明场景设计；它只包含一个 `scene_id`，从而允许无路径冲突的场景循环独立推进。

```yaml
schema_version: 3
status: pending # pending | blocked | approved | stale
requirements_hash: sha256:<hash>
project_profile_hash: sha256:<hash>
visual_direction_version: 3
visual_direction_hash: sha256:<hash>
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
frozen_reference_effect_images: # 必须逐项复制 visual-direction.md 中恰好两张参考效果图的 path 与 content_hash
  - {path: art/visual-references/<reference_id>.png, content_hash: sha256:<hash>}
  - {path: art/visual-references/<reference_id>.png, content_hash: sha256:<hash>}
scene_id: home
scene_loop_id: scene-loop-home
requirement_page_id: home
pencil_draft:
  artifact_path: artifacts/pencil-drafts/home.md
  content_hash: sha256:<approved Pencil artifact hash>
  pencil_source_hash: sha256:<approved Pencil source hash>
image_path: art/concepts/home/effect.png
image_hash: sha256:<binary hash>
prompt_path: art/concepts/home/prompt.yaml
prompt_hash: sha256:<hash>
generator: {tool: imagegen, generated_at: <timestamp>}
restraint_expression_profile: {context: default, restraint_ratio: 0.8, expression_ratio: 0.2, primary_focal_points_max: 1, secondary_focal_points_max: 1}
functional_visual_checks: # 与 Pencil 的结构及冻结 functional_ui_rules 一致
  primary_action_identifiable: false
  interaction_regions_preserved: false
  hierarchy_readable: false
  state_feedback_visible: false
  text_capacity_respected: false
quality_review:
  scores: {genre_fit: 0, color_discipline: 0, restraint_expression_balance: 0, visual_hierarchy: 0, functional_clarity: 0, production_readiness: 0}
  average_score: 0
  verdict: pending # pending | passed | failed
  evidence: []
review: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

- `scene_id` 与 `requirement_page_id` 必须对应已批准需求页面；`scene_loop_id` 必须对应实施计划中的同场景循环。
- `frozen_reference_effect_images` 必须恰好两项，并与 `visual-direction.md` front matter 中 `reference_effect_images` 的路径和内容哈希逐项一致；不一致时整份清单为 `stale`。
- 每一工件必须有已批准的 Pencil 草图工件、独立图片、提示词、图像哈希和人工审核。Pencil 草图只确认结构、主操作、UI 层级、导航和交互区域；其 `pencil_source_hash` 必须等于草图工件的批准主题哈希。高保真图审核主题哈希必须等于 `image_hash`。
- 高保真图必须复制冻结的视觉方向：不得改变调色板、字体、图标风格、形状语言、材质、光影、动效语言或禁用风格。需要改变其中任一项时，必须重新执行视觉冻结，不得在场景条目中豁免。
- `restraint_expression_profile` 必须逐字段等于冻结方向中与该已批准页面类型匹配的上下文，或逐字段等于 `default`；不得按单场景改写。图像的主/次焦点数量、背景与容器的克制程度、高对比/高饱和/动效的使用位置均必须符合该预算。
- `functional_visual_checks` 五项必须全部为 `true`：主操作可辨识、草图交互区域未改变、信息层级可读、状态反馈可见、文本容量符合要求。任一项失败时，场景不可批准。
- `quality_review` 必须使用冻结 `quality_rubric` 的固定六维评分；每项分数不得低于 `minimum_dimension_score`，平均分不得低于 `minimum_average_score`，并且 `verdict` 为 `passed`。泛泛的“好看”评价不是证据。
- `status: approved` 仅在所有场景审核通过且所有输入冻结值匹配时允许；`content_hash` 使用字段名排序的 UTF-8 JSON，排除自身字段。
- 视觉方向、需求页、项目配置、方向或分辨率变化时，清单和全部对应审核均为 `stale`，必须重做。
