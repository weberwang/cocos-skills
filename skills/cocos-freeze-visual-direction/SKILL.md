---
name: cocos-freeze-visual-direction
description: Use when approved Cocos Creator Web Mobile requirements, systems design, and technical design need a versioned, hash-bound visual direction and exactly two ImageGen reference effect images that a human must freeze before scene/UI production can proceed.
---

# Cocos 冻结视觉方向

建立可执行的“游戏原画规范 + UI 设计系统”，生成恰好两张职责不同的质量锚点图，再等待人工冻结。两张图分别证明原画完成度和 UI 系统一致性；单场景最终效果图仍由 `$cocos-create-visual-concept` 负责。

## Boundary

Write only the task-assigned `.cocos-workflow/artifacts/visual-direction.md`, exactly two task-assigned generated reference images under `.cocos-workflow/art/visual-references/`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, scenes, runtime assets, scripts, project configuration, or Cocos Editor state. Do not call a Cocos MCP write operation.

Read the installed `$cocos-orchestrate-web-workflow` references `workflow-contracts.md` and `state-machine.md` before work. Follow its task ownership and result contract exactly.

## Procedure

1. Read the assigned task, approved `.cocos-workflow/requirements.md`, approved systems and technical design artifacts, frozen `.cocos-workflow/project-profile.yaml`, and [visual-direction contract](references/visual-direction-contract.md). Block if any required hash, approval, orientation, or design resolution is missing or mismatched.
2. 建立全局设计提案，并同时写清两套可生产规范：游戏原画规范覆盖构图叙事、镜头透视、角色比例与剪影、环境层次、材质、光影、色彩脚本、VFX 和细节密度；UI 系统覆盖栅格、间距、字体层级、组件造型与状态、图标栅格、HUD 规则、触控尺寸、安全区和可访问性。保留每项引用的路径、用途、来源和许可状态。
3. Copy the project profile's `orientation` and complete `design_resolution` into the proposal without alteration. Bind the current requirements, systems-design, technical-design, and project-profile hashes. The proposal must respect the approved design pillars, performance budget, and accessibility constraints; do not infer a different device orientation, canvas size, or adaptation strategy.
4. 使用 `$imagegen` 生成恰好两张移动端质量锚点：一张 `game-art-quality-anchor`，验证原画构图、材质、光影和完成度；一张 `ui-system-quality-anchor`，验证 UI 层级、组件、图标与真实文案的呈现。UI 锚点中的文字和关键图标必须以可编辑设计元素精确重建后导出，不接受生成伪文字。记录职责、提示词哈希、生成器元数据、二进制哈希和审核状态；此阶段不得生成具体业务场景成品。
5. Assign the next monotonic `visual_direction_version`. Calculate `content_hash` from normalized content excluding that field. Any covered-field change, including either reference effect image, requires a new version, hash, and fresh human approval; never edit a frozen version in place.
6. Keep `status: draft` or `blocked` until all required fields, source-reference licenses, both reference effect images, and explicit human approval are available. On approval, write only the actual approver and timestamp, then set `status: frozen`.
7. Return the artifact path, two image paths and hashes, version, validation checks, approval evidence, and downstream invalidation request to the orchestrator. If a prior frozen version changed, request invalidation from `scene-concepts` through `completed`; only the orchestrator performs that write.

## Hard Gates

- Do not freeze without explicit human approval bound to the exact version and `content_hash`.
- The frozen artifact must contain exactly two generated reference effect images. Missing, extra, unreviewed, or hash-mismatched images block freezing.
- 两张参考图的职责必须分别为 `game-art-quality-anchor` 与 `ui-system-quality-anchor`；不得用两张近似原画或两张近似 UI 图代替能力覆盖。
- 原画规范或 UI 系统存在空泛描述、无法落到数值/规则、缺少组件状态、缺少真实文案可读性证据时不得冻结。
- Treat unknown or incompatible reference licensing as blocking.
- Treat a changed requirements, systems-design, technical-design, or project-profile hash, orientation, or resolution as stale; do not reuse the old approval.
- Do not generate scene-specific effects, individual game assets, code, or Cocos scenes in this phase.

## Handoff

The next phase receives only a `frozen` artifact with `visual_direction_version`, `content_hash`, `orientation`, `design_resolution`, exactly two reference effect images, and valid approval. Every downstream visual task must echo those values exactly; otherwise it is stale.
