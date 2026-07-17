# 单场景高质量视觉提示词模板

提示词分为“游戏原画层”和“最终精修”两类。一次生成调用只能引用当前一个 `scene_id`，禁止列出其他页面、请求整套页面、生成多屏拼图或预生成后续场景。方括号字段必须来自冻结工件、批准需求或设计简报，禁止用模型偏好补写。

## 游戏原画候选

```text
Create one production-quality 2D mobile game art layer for [scene_id], without UI or text.
Narrative moment: [moment]. Player focus and visual path: [focus_and_eye_flow].
Canvas: [orientation], exact [width]x[height], with UI reserve zones from the approved Pencil layout [pencil_path] / [hash].
Composition: foreground [foreground], midground [midground], background [background], camera [camera], perspective [perspective], focal hierarchy [hierarchy].
Character and environment direction: [character_environment_rules]. Silhouette and pose: [silhouette_pose].
Material, lighting, color script and VFX: [material_lighting_color_vfx]. Apply frozen color tokens and usage rules [color_system].
Restraint/expression profile: [restraint_expression_profile]. Keep [restraint_ratio] visually restrained; reserve [expression_ratio] for approved focal content only. Never exceed [primary_focal_points_max] primary and [secondary_focal_points_max] secondary focal points.
Frozen game-art system, copy exactly: [art_direction]. Match reference [game_art_anchor_path] / [hash].
Preserve the global palette and prohibited list: [palette]; exclude [prohibited].
No UI, letters, numbers, logo, watermark, phone frame, mockup, collage, sprite sheet or decorative elements that obscure gameplay.
Deliver a single clean game-art layer with readable silhouettes, coherent perspective, controlled detail density and clear asset boundaries.
```

三个候选必须分别填写不同的 `composition_strategy`、镜头与视觉动线，其他冻结字段保持一致。

## UI 精确设计与最终合成

UI 不依赖 ImageGen 生成文字。使用已批准 Pencil 源文件建立可编辑 UI：

```text
Scene purpose: [purpose]. Preserve Pencil structure and interaction regions exactly.
Apply frozen UI system: [grid_spacing], [typography], [component_shapes], [icon_grid], [states], [hud_rules], [functional_ui_rules]. Follow color-token usage and the same restraint/expression profile; reserve accent, glow and motion for approved CTA, reward or key-event states.
Use exact approved copy: [copy_inventory]. No placeholder or invented labels.
Place over selected game-art layer [path] / [hash] while preserving focal subject, primary action and gameplay readability.
Validate safe area, minimum touch targets, contrast, truncation and hierarchy at [capture_profiles].
```

## 记录字段

保存到 `art/concepts/<scene_id>/prompt.yaml`：

```yaml
scene_id: home
requirements_hash: sha256:<hash>
project_profile_hash: sha256:<hash>
visual_direction_version: 3
visual_direction_hash: sha256:<hash>
pencil_draft: {path: art/concepts/home/pencil-draft.pen, content_hash: sha256:<approved hash>}
frozen_reference_effect_images:
  - {role: game-art-quality-anchor, path: art/visual-references/game-art.png, content_hash: sha256:<hash>}
  - {role: ui-system-quality-anchor, path: art/visual-references/ui-system.png, content_hash: sha256:<hash>}
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
game_art_candidate_prompts: []
ui_composition_spec: <exact UI spec>
prompt_hash: sha256:<normalized prompt record hash>
generator: {tool: imagegen, model_or_version: <returned value>, generated_at: <timestamp>}
restraint_expression_profile: <copied frozen default or matching context profile>
```
