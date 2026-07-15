---
name: cocos-freeze-visual-direction
description: Use when approved Cocos Creator Web Mobile requirements, systems design, and technical design need a versioned, hash-bound visual direction and exactly two ImageGen reference effect images that a human must freeze before scene/UI production can proceed.
---

# Cocos 冻结视觉方向

Create one reviewable visual-direction contract and exactly two reference effect images, then wait for explicit human freeze approval. The two images establish the global visual style only; per-scene effect images remain the responsibility of `$cocos-create-visual-concept`. This Skill owns neither `workflow.yaml` nor any Cocos project file.

## Boundary

Write only the task-assigned `.cocos-workflow/artifacts/visual-direction.md`, exactly two task-assigned generated reference images under `.cocos-workflow/art/visual-references/`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, scenes, runtime assets, scripts, project configuration, or Cocos Editor state. Do not call a Cocos MCP write operation.

Read the installed `$cocos-orchestrate-web-workflow` references `workflow-contracts.md` and `state-machine.md` before work. Follow its task ownership and result contract exactly.

## Procedure

1. Read the assigned task, approved `.cocos-workflow/requirements.md`, approved systems and technical design artifacts, frozen `.cocos-workflow/project-profile.yaml`, and [visual-direction contract](references/visual-direction-contract.md). Block if any required hash, approval, orientation, or design resolution is missing or mismatched.
2. Build a global visual-direction proposal: audience fit, visual keywords, palette, typography, shapes, composition, icon treatment, motion cues, accessibility contrast rules, prohibited styles, and traceable source-reference usage. Preserve every source-reference path, purpose, source, and license status.
3. Copy the project profile's `orientation` and complete `design_resolution` into the proposal without alteration. Bind the current requirements, systems-design, technical-design, and project-profile hashes. The proposal must respect the approved design pillars, performance budget, and accessibility constraints; do not infer a different device orientation, canvas size, or adaptation strategy.
4. Use `$imagegen` to generate exactly two mobile-oriented reference effect images from the proposal. Use the frozen orientation and design resolution, record each image's purpose, prompt hash, generator metadata, binary SHA-256, and review status, and do not generate scene-specific screens in this phase.
5. Assign the next monotonic `visual_direction_version`. Calculate `content_hash` from normalized content excluding that field. Any covered-field change, including either reference effect image, requires a new version, hash, and fresh human approval; never edit a frozen version in place.
6. Keep `status: draft` or `blocked` until all required fields, source-reference licenses, both reference effect images, and explicit human approval are available. On approval, write only the actual approver and timestamp, then set `status: frozen`.
7. Return the artifact path, two image paths and hashes, version, validation checks, approval evidence, and downstream invalidation request to the orchestrator. If a prior frozen version changed, request invalidation from `scene-concepts` through `completed`; only the orchestrator performs that write.

## Hard Gates

- Do not freeze without explicit human approval bound to the exact version and `content_hash`.
- The frozen artifact must contain exactly two generated reference effect images. Missing, extra, unreviewed, or hash-mismatched images block freezing.
- Treat unknown or incompatible reference licensing as blocking.
- Treat a changed requirements, systems-design, technical-design, or project-profile hash, orientation, or resolution as stale; do not reuse the old approval.
- Do not generate scene-specific effects, individual game assets, code, or Cocos scenes in this phase.

## Handoff

The next phase receives only a `frozen` artifact with `visual_direction_version`, `content_hash`, `orientation`, `design_resolution`, exactly two reference effect images, and valid approval. Every downstream visual task must echo those values exactly; otherwise it is stale.
