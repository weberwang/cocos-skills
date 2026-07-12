# 单场景手机效果图提示词模板

每个 `scene_id` 建立一个独立提示词记录。方括号字段必须由冻结工件或已批准需求填充，禁止以模型偏好替换。

```text
Create one finished 2D mobile game screen concept for [scene_id]: [page purpose].
Canvas: [orientation], exact design resolution [width]x[height]; use the approved mobile safe-area and fit policy.
Global visual direction (copy verbatim): [keywords]; palette [palette]; typography [typography]; shape/layout [shape_and_layout]; icon/illustration [icon_and_illustration]; motion cues [motion_cues].
Scene content: [game context], player action [player action], primary UI [primary_ui], hierarchy [hierarchy].
Accessibility: [accessibility_rules].
Exclude: [prohibited]. No phone frame, no device mockup, no watermark, no multi-screen collage, no unrelated brand, and no illegible placeholder copy.
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
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
prompt: <final prompt>
prompt_hash: sha256:<utf-8 prompt hash>
generator: {tool: imagegen, model_or_version: <returned value>, generated_at: <timestamp>}
```
