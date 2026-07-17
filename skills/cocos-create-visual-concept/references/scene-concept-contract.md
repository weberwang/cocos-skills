# 场景高保真效果图契约

每个场景/UI 工件为 `.cocos-workflow/artifacts/scene-concepts/<scene_id>.md`，过程图像与记录位于 `.cocos-workflow/art/concepts/<scene_id>/`。一次任务只能创建或修改一个场景目录和一份工件；禁止批量清单、多场景数组、共享效果图或多页面拼图。

```yaml
schema_version: 3
status: pending # pending | blocked | approved | stale
requirements_hash: sha256:<hash>
project_profile_hash: sha256:<hash>
visual_direction_version: 3
visual_direction_hash: sha256:<hash>
orientation: portrait
design_resolution: {width: 1080, height: 1920, source: approved-default}
frozen_reference_effect_images:
  - {role: game-art-quality-anchor, path: art/visual-references/game-art.png, content_hash: sha256:<hash>}
  - {role: ui-system-quality-anchor, path: art/visual-references/ui-system.png, content_hash: sha256:<hash>}
scene_id: home
scene_loop_id: scene-loop-home
requirement_page_id: home
pencil_draft:
  artifact_path: artifacts/pencil-drafts/home.md
  content_hash: sha256:<approved Pencil artifact hash>
  pencil_source_hash: sha256:<approved Pencil source hash>
design_brief_path: art/concepts/home/design-brief.md
game_art:
  candidate_count: 3
  candidates:
    - {path: art/concepts/home/game-art-candidate-01.png, content_hash: sha256:<hash>, review_path: art/concepts/home/candidate-01-review.yaml}
  selected_path: art/concepts/home/game-art-selected.png
  selected_hash: sha256:<hash>
ui_design:
  editable_source_path: art/concepts/home/ui-final.pen
  editable_source_hash: sha256:<hash>
  exported_layer_path: art/concepts/home/ui-layer.png
  exported_layer_hash: sha256:<hash>
  copy_inventory_path: art/concepts/home/ui-copy.yaml
final_image_path: art/concepts/home/effect-final.png
final_image_hash: sha256:<binary hash>
prompt_path: art/concepts/home/prompt.yaml
prompt_hash: sha256:<hash>
restraint_expression_profile: {context: default, restraint_ratio: 0.8, expression_ratio: 0.2, primary_focal_points_max: 1, secondary_focal_points_max: 1}
refinement_rounds:
  - {round: 1, defect_ids: [D-01], output_path: art/concepts/home/refinement-01.png, output_hash: sha256:<hash>}
quality_review:
  rubric_version: 1
  scores: # 每项 1-5
    frozen-direction-consistency: 5
    pencil-structure-fidelity: 5
    composition-and-storytelling: 5
    game-art-finish: 5
    ui-hierarchy: 5
    typography-and-copy-legibility: 5
    component-and-icon-consistency: 5
    touch-safe-area-and-viewport-fit: 5
    visual-noise-control: 5
    restraint-expression-balance: 5
    asset-decomposability: 5
  average: 5.0
  viewport_evidence: []
  blocking_defects: []
generator: {tool: imagegen, model_or_version: <returned value>, generated_at: <timestamp>}
review: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash and review.subject_hash>
```

## 验收规则

- 任务、工件、提示词和最终图必须形成严格的 `1 task : 1 scene_id : 1 final image` 关系。`changed_paths` 只允许落在当前场景目录、当前工件和分配的结果路径中。
- 总控只允许一个活动 `visual-concept` 任务。当前场景的质量检查和最终人工审核通过前，下一个场景不得生成候选图。
- 两张冻结参考图必须分别承担 `game-art-quality-anchor` 与 `ui-system-quality-anchor`，路径和哈希与冻结视觉方向逐项一致。
- `candidate_count >= 3`，候选构图必须有实质差异；每个候选都具有六维评分和缺陷记录。入选候选六维均不低于 4。
- `restraint_expression_profile` 必须逐字段等于冻结方向中与该已批准页面类型匹配的上下文，或等于 `default`；不得按单场景改写。主/次焦点数量和高对比、高饱和、强动效、重材质的使用位置必须符合该预算。
- `ui_design.editable_source_path` 必须存在；真实文案清单、可编辑文字、图标和组件状态均能从源文件追溯，禁止依赖生成图伪文字。
- `refinement_rounds` 至少一项，每轮必须引用真实缺陷 ID、输出路径和哈希。
- `quality_review.scores` 必须覆盖全部十一项；每项不低于 4，平均分不低于 4.5，且 `blocking_defects` 为空。视口证据必须覆盖项目配置的全部捕获视口。
- `status: approved` 仅在人工审核精确绑定 `final_image_hash` 时允许。视觉方向、需求、配置、Pencil、候选选择、UI 源或最终图变化时批准失效。
