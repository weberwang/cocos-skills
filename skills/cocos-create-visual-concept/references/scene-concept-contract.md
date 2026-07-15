# 场景效果图契约

每个场景/UI 的工件为 `.cocos-workflow/artifacts/scene-concepts/<scene_id>.md`，图像与记录位于 `.cocos-workflow/art/concepts/<scene_id>/`。工件以 YAML front matter 保存可校验元数据，并用 Markdown 正文说明场景设计；它只包含一个 `scene_id`，从而允许无路径冲突的场景循环独立推进。

```yaml
schema_version: 1
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
review: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

- `scene_id` 与 `requirement_page_id` 必须对应已批准需求页面；`scene_loop_id` 必须对应实施计划中的同场景循环。
- `frozen_reference_effect_images` 必须恰好两项，并与 `visual-direction.md` front matter 中 `reference_effect_images` 的路径和内容哈希逐项一致；不一致时整份清单为 `stale`。
- 每一工件必须有已批准的 Pencil 草图工件、独立图片、提示词、图像哈希和人工审核。Pencil 草图只确认结构、主操作、UI 层级、导航和交互区域；其 `pencil_source_hash` 必须等于草图工件的批准主题哈希。高保真图审核主题哈希必须等于 `image_hash`。
- 高保真图必须复制冻结的视觉方向：不得改变调色板、字体、图标风格、形状语言、材质、光影、动效语言或禁用风格。需要改变其中任一项时，必须重新执行视觉冻结，不得在场景条目中豁免。
- `status: approved` 仅在所有场景审核通过且所有输入冻结值匹配时允许；`content_hash` 使用字段名排序的 UTF-8 JSON，排除自身字段。
- 视觉方向、需求页、项目配置、方向或分辨率变化时，清单和全部对应审核均为 `stale`，必须重做。
