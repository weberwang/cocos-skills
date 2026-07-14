---
name: cocos-freeze-visual-direction
description: Use when an approved Cocos Creator Web Mobile game requirements document needs a versioned, hash-bound visual direction that a human must freeze before scene concepts, game assets, or implementation planning can proceed.
---

# Cocos 冻结视觉方向

Create one reviewable visual-direction contract, then wait for explicit human freeze approval. This Skill owns neither `workflow.yaml` nor any Cocos project file.

## Boundary

Write only the task-assigned `.cocos-workflow/artifacts/visual-direction.yaml`, optional task-assigned visual-reference copies under `.cocos-workflow/art/visual-references/`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, scenes, runtime assets, scripts, project configuration, or Cocos Editor state. Do not call a Cocos MCP write operation.

Read the installed `$cocos-orchestrate-web-workflow` references `workflow-contracts.md` and `state-machine.md` before work. Follow its task ownership and result contract exactly.

## Procedure

1. Read the assigned task, approved `.cocos-workflow/requirements.yaml`, approved `artifacts/systems-design.yaml`, approved `artifacts/technical-design.yaml`, frozen `.cocos-workflow/project-profile.yaml`, and [visual-direction contract](references/visual-direction-contract.md). Block if any required hash, approval, orientation, or design resolution is missing or mismatched.
2. Build a global visual-direction proposal: audience fit, visual keywords, palette, typography, shapes, composition, icon treatment, motion cues, accessibility contrast rules, prohibited styles, and traceable reference-image usage. Preserve every reference path, purpose, source, and license status.
3. Copy the project profile's `orientation` and complete `design_resolution` into the proposal without alteration. Bind the current requirements、系统设计、技术设计与项目配置哈希。视觉方向必须体现设计支柱、性能预算和无障碍限制，不得推断不同设备方向、画布尺寸或适配策略。
4. Assign the next monotonic `visual_direction_version`. Calculate `content_hash` from normalized content excluding that field. Any covered-field change requires a new version, hash, and fresh human approval; never edit a frozen version in place.
5. Keep `status: draft` or `blocked` until all required fields, reference licenses, and explicit human approval are available. On approval, write only the actual approver and timestamp, then set `status: frozen`.
6. Return the artifact path, version, hash, validation checks, approval evidence, and downstream invalidation request to the orchestrator. If a prior frozen version changed, request invalidation from `scene-concepts` through `completed`; only the orchestrator performs that write.

## Hard Gates

- Do not freeze without explicit human approval bound to the exact version and `content_hash`.
- Treat unknown or incompatible reference licensing as blocking.
- Treat a changed requirements、systems-design、technical-design、project-profile hash, orientation, or resolution as stale; do not reuse the old approval.
- Do not generate scene effects, individual game assets, code, or Cocos scenes in this phase.

## Handoff

The next phase receives only a `frozen` artifact with `visual_direction_version`, `content_hash`, `orientation`, `design_resolution`, and valid approval. Every downstream visual task must echo those values exactly; otherwise it is stale.
