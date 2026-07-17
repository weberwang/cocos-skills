# 单场景手机效果图提示词模板

每个 `scene_id` 建立一个独立提示词记录。方括号字段必须由冻结工件或已批准需求填充，禁止以模型偏好替换。

```text
Create one finished 2D mobile game screen concept for [scene_id]: [page purpose].
Canvas: [orientation], exact design resolution [width]x[height]; use the approved mobile safe-area and fit policy.
Approved Pencil layout (preserve exactly): [pencil_draft_path] / [pencil_draft_hash]. Keep its structure, primary action, UI hierarchy, navigation, and interaction regions unchanged.
Global visual direction (copy verbatim): [keywords]; commercial benchmark patterns [commercial_benchmarks.adopt_patterns]; palette [palette]; color tokens and usage rules [color_system]; restraint/expression profile [restraint_expression_profile]; typography [typography]; shape/layout [shape_and_layout]; icon/illustration [icon_and_illustration]; motion cues [motion_cues]; functional UI [functional_ui_rules].
Frozen global reference-effect images (match both): [reference_effect_image_1_path] / [reference_effect_image_1_hash]; [reference_effect_image_2_path] / [reference_effect_image_2_hash].
Scene content: [game context], player action [player action], primary UI [primary_ui], hierarchy [hierarchy].
Accessibility: [accessibility_rules].
Quality target: [quality_rubric]. Keep [restraint_ratio] of the screen visually restrained and reserve [expression_ratio] for approved focal content. Never exceed [primary_focal_points_max] primary and [secondary_focal_points_max] secondary focal points. Make the primary action the clearest interactive focal point; use the approved accent budget only for approved interactive or reward states; preserve readable text capacity and state feedback.
Exclude: [prohibited]; benchmark avoid patterns [commercial_benchmarks.avoid_patterns]. Do not introduce a new palette, typography, icon style, material, lighting, or motion language. Do not reproduce brands, characters, assets, screenshots, or page layouts from commercial benchmarks. No phone frame, no device mockup, no watermark, no multi-screen collage, no unrelated brand, and no illegible placeholder copy.
Deliver a single flat screen-effect image for review, not a sprite sheet or Cocos scene.
```

## 记录字段

将模板填充结果保存在 `art/concepts/<scene_id>/prompt.yaml`：

```yaml
scene_id: home
requirements_hash: sha256:<hash>
project_profile_hash: sha256:<hash>
visual_direction_version: 3
visual_direction_hash: sha256:<hash>
pencil_draft: {path: art/concepts/home/pencil-draft.pen, content_hash: sha256:<approved Pencil draft hash>}
frozen_reference_effect_images:
  - {path: art/visual-references/<reference_id>.png, content_hash: sha256:<hash>}
  - {path: art/visual-references/<reference_id>.png, content_hash: sha256:<hash>}
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
prompt: <final prompt>
prompt_hash: sha256:<utf-8 prompt hash>
generator: {tool: imagegen, model_or_version: <returned value>, generated_at: <timestamp>}
quality_rubric: <copied frozen rubric>
restraint_expression_profile: <copied frozen default or matching context profile>
```
