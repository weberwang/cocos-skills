---
name: cocos-create-pencil-draft
description: Use when an approved Cocos Creator Web Mobile implementation plan assigns a scene or UI layout task that must be created in Pencil, reviewed by a human, and recorded as a hash-bound draft before its high-fidelity effect image, assets, or code can proceed.
---

# Cocos 创建 Pencil 草图

为一个 `scene_loop_id` 创建可直接进入高保真 UI 设计的 Pencil 结构稿。它必须解决布局、信息架构、真实文案和交互状态，但不得自行创建视觉风格或修改 Cocos 项目。

## Boundary

Write only task-assigned paths under `.cocos-workflow/art/concepts/<scene_id>/`, `.cocos-workflow/artifacts/pencil-drafts/<scene_id>.md`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, Cocos scenes, assets, scripts, project configuration, or Editor state.

Read the orchestrator contracts and [Pencil draft contract](references/pencil-draft-contract.md) before work.

## Procedure

1. Read the assigned `pencil-draft` task, approved implementation plan, requirements, frozen project profile, and frozen visual direction. Confirm the task owns exactly one `scene_id` and its paths do not overlap another loop.
2. 创建或更新 Pencil 源文件和预览。定义页面结构、游戏原画保留区、视线动线、主操作、UI 层级、导航、交互区域和移动端安全区；所有可见文案使用已批准的真实文本，并标注 normal、pressed、disabled、selected 等需要的组件状态。不得选择新的调色板、字体、图标、材质、光影或动效语言。
3. 在 `mobile-small`、`mobile-standard`、`mobile-large` 三个捕获视口检查布局：主操作不得被拇指遮挡，关键触控目标满足冻结最小尺寸，长文案/本地化扩展有明确策略，HUD 不遮挡游戏焦点。用功能视觉检查记录主操作辨识、交互区域、信息层级、状态反馈位置和文本容量。保存源文件、预览、文案清单和视口预览的 SHA-256。
4. Request explicit human approval of the complete Pencil artifact. Keep the artifact `pending`, `rejected`, or `blocked` until `approval.subject_hash` equals its `content_hash`; record `pencil_source_hash` as review evidence, never as an approval substitute.
5. Return artifact, hashes, review evidence, and unblock conditions. A changed draft hash invalidates that scene's high-fidelity concept, assets, code, integration, and verification results; the orchestrator performs state changes.

## Hard Gates

- A Pencil draft must not add or override the frozen global visual direction.
- Do not start `$cocos-create-visual-concept`, asset preparation, or scene/UI code for this loop without the approved Pencil artifact whose `approval.subject_hash` equals `content_hash`.
- Reject missing source files, previews, exact-copy inventory, required component states, three viewport checks, hash mismatches, incomplete structural checks, and missing human approval.

## Handoff

Pass approved `scene_id`, `scene_loop_id`, Pencil source and preview paths, hashes, frozen input hashes, structural checklist, and approval evidence to the high-fidelity concept task.
