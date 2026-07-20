# 单场景高质量视觉提示词模板

提示词分为“游戏原画层”和“最终精修”两类。一次生成调用只能引用当前一个 `scene_id`，禁止列出其他页面、请求整套页面、生成多屏拼图或预生成后续场景。方括号字段必须来自冻结工件、批准需求或设计简报，禁止用模型偏好补写。

## 编写原则

- **结构清晰，引导方向**：按“目标 → 画面重点 → 视觉方向 → 必要约束 → 自由空间”组织，让模型先理解要解决的问题。
- **抓住关键，不堆细节**：只保留会显著改变构图、风格、用途或验收结果的信息；能用几句话说清楚，就不要扩写。
- **要引导，不要过度限制**：冻结项和业务边界必须明确，其余构图连接、环境细节与表现手法交给模型发挥。
- **减少矛盾与干扰**：合并重复要求，删除无验收意义的辞藻；发现字段冲突时先修正输入，不把冲突原样塞进提示词。

提示词不是冻结工件的全文转录。颜色 token、克制/发散预算等结构化约束应提炼成当前画面真正会用到的结论；路径、哈希和生成元数据保存在记录中，不作为画面描述重复输入。负面约束只保留高风险错误，避免长串禁止词挤压创作空间。

## 游戏原画候选

```text
Goal: Create one production-quality 2D mobile game-art layer for [scene_id], [orientation], exact [width]x[height].
Scene: [moment]. Make [focus] the clear focal point and guide the eye through [eye_flow]. Use [composition_strategy] with [camera_and_depth]; keep the approved UI reserve zones clear.
Direction: [concise_art_direction]. Follow the frozen palette, material and lighting roles [active_visual_tokens], using expressive detail only on [approved_focal_content]. Match the supplied game-art quality anchor.
Constraints: one scene and one image; no UI, text, logo, watermark, device frame or collage. Keep silhouettes readable, perspective coherent and gameplay boundaries clear.
Creative latitude: freely resolve secondary environment details, transitions and atmospheric accents as long as they support the focal hierarchy and frozen direction.
```

三个候选必须分别填写不同的 `composition_strategy`、镜头与视觉动线，其他冻结结论保持一致。不要为了让提示词显得“丰富”而加入未批准的风格词、同义形容词或逐物件微观描述。

## UI 精确设计与最终合成

UI 不依赖 ImageGen 生成文字。使用已批准 Pencil 源文件建立可编辑 UI：

```text
Goal: Build the editable UI for [purpose] over the approved game-art layer while preserving the Pencil structure and interaction regions.
Hierarchy: prioritize [primary_action_and_information]; apply the frozen typography, spacing, component and icon rules [active_ui_rules]. Use accent only for [approved_accent_targets].
Content: use the exact approved copy [copy_inventory], with no placeholder or invented labels.
Quality: preserve the gameplay focal point and verify safe area, touch targets, contrast, truncation and component states at [capture_profiles].
Creative latitude: refine spacing rhythm and visual transitions within the frozen UI system without adding new functions or changing interaction regions.
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
generation_reference_images: # 实际传给 ImageGen 的两张冻结锚点，逐项与上方一致
  - {role: game-art-quality-anchor, path: art/visual-references/game-art.png, content_hash: sha256:<hash>}
  - {role: ui-system-quality-anchor, path: art/visual-references/ui-system.png, content_hash: sha256:<hash>}
candidate_output: {path: art/concepts/home/game-art-candidate-01.png, content_hash: sha256:<output hash>}
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
game_art_candidate_prompts: []
ui_composition_spec: <exact UI spec>
prompt_hash: sha256:<normalized prompt record hash>
generator: {tool: imagegen, model_or_version: <returned value>, generated_at: <timestamp>}
restraint_expression_profile: <copied frozen default or matching context profile>
```
