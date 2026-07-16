---
name: cocos-generate-game-assets
description: Use when approved Cocos Creator Web Mobile scene concepts must be decomposed into independent, traceable game image assets with ImageGen, preserved source/license metadata, and hashes before Cocos Editor integration.
---

# Cocos 生成游戏资源

Turn approved concepts into individually usable image source assets. Keep every asset traceable to approved visual inputs; leave importing and scene binding to the integration phase.

## Boundary

Write only task-assigned paths under `.cocos-workflow/art/assets/`, `.cocos-workflow/artifacts/game-assets.yaml`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, `assets/` in the Cocos project, scenes, scripts, project configuration, or Editor state. Do not call a Cocos MCP write operation.

Read the installed `$cocos-orchestrate-web-workflow` `workflow-contracts.md` and `state-machine.md` before work. Use `$imagegen` for generated image assets. Read [game-assets contract](references/game-assets-contract.md) before writing manifests.

## Procedure

1. Read the assigned task, approved implementation asset plan, the approved per-scene `artifacts/scene-concepts/<scene_id>.md` and referenced Pencil-draft artifact, frozen `visual-direction.md`, and frozen `project-profile.yaml`. Block when any required approval, Pencil-draft hash, frozen-reference image hash, visual version/hash, profile hash, orientation, or design resolution does not match.
2. Decompose each approved scene into a declared asset list. One `asset_id` has one intended runtime purpose and one independent output image; do not emit a screen crop, asset atlas, or mixed-purpose sheet unless the approved plan explicitly requires it.
3. Build each asset prompt from the approved final concept, selected game-art layer, editable UI source and frozen direction. Use the asset plan's exact output dimensions; preserve silhouette, material, light direction, edge treatment, palette, icon grid and component state from their source. Generate artwork with `$imagegen`; UI文字、关键图标和几何组件优先从可编辑设计源精确导出，不得用重新生成近似图替代。仅在资源用途要求时使用透明背景。
4. Save each output and metadata under `.cocos-workflow/art/assets/<asset_id>/`. Record source concept path/hash, source reference licenses, generator metadata, final prompt hash, dimensions, alpha/background requirement, and binary SHA-256.
5. Leave `license_status: needs-human-review` unless an authorized human supplies a valid usage decision. Do not infer transferable rights from an image generator or reference image. Present all provenance and license gaps for review.
6. 验证唯一性、尺寸、哈希、来源、冻结绑定、许可和视觉还原度。原画资源检查轮廓、透视、材质、光向与透明边缘；UI 资源检查像素对齐、九宫格安全区、组件状态、图标光学校正和文字精确性。任何一项相对批准效果图有明显漂移时重新导出或定向修正。人工明确批准精确清单哈希后才能设为 `approved`。
7. Return manifest and per-asset evidence to the orchestrator. If concepts, direction, profile, or planned dimensions change, report the affected assets as stale and request orchestration invalidation; do not mutate workflow state.

## Hard Gates

- Never derive visual direction, orientation, or resolution from a new prompt default. They must equal the frozen artifacts exactly.
- Never import, move, rename, or bind an image inside the Cocos project. `$cocos-integrate-assets` owns that later Editor work.
- Never claim a source or license is known without recorded evidence. Unknown license status blocks approval and integration.
- Never reuse an approved asset when an upstream concept, visual direction, profile, or asset-plan hash changes.

## Handoff

Deliver only an approved asset manifest whose entries have stable IDs, source lineage, license decision, dimensions, binary hashes, prompts, and frozen visual bindings. The integration phase must revalidate all of them before Cocos import.
