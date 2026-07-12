# 场景效果图契约

清单为 `.cocos-workflow/artifacts/scene-concepts.yaml`，图像与记录位于 `.cocos-workflow/art/concepts/<scene_id>/`。

```yaml
schema_version: 1
status: pending # pending | blocked | approved | stale
requirements_hash: sha256:<hash>
project_profile_hash: sha256:<hash>
visual_direction_version: 3
visual_direction_hash: sha256:<hash>
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
scenes:
  - scene_id: home
    requirement_page_id: home
    image_path: art/concepts/home/effect.png
    image_hash: sha256:<binary hash>
    prompt_path: art/concepts/home/prompt.yaml
    prompt_hash: sha256:<hash>
    generator: {tool: imagegen, generated_at: <timestamp>}
    review: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

- `scene_id` 与 `requirement_page_id` 必须唯一且对应已批准需求页面。
- 每一场景必须有独立图片、提示词、图像哈希和人工审核。审核主题哈希必须等于该场景 `image_hash`。
- `status: approved` 仅在所有场景审核通过且所有输入冻结值匹配时允许；`content_hash` 使用字段名排序的 UTF-8 JSON，排除自身字段。
- 视觉方向、需求页、项目配置、方向或分辨率变化时，清单和全部对应审核均为 `stale`，必须重做。
