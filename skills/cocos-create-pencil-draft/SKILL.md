---
name: cocos-create-pencil-draft
description: Use when an approved Cocos Creator Web Mobile implementation plan assigns a scene or UI layout task that must be created in Pencil, reviewed by a human, and recorded as a hash-bound draft before its high-fidelity effect image, assets, or code can proceed.
---

# Cocos 创建 Pencil 草图

Create one structural Pencil draft for one assigned `scene_loop_id`. This task confirms layout and interaction only; it must not create a local visual direction or modify a Cocos project.

## Boundary

Write only task-assigned paths under `.cocos-workflow/art/concepts/<scene_id>/`, `.cocos-workflow/artifacts/pencil-drafts/<scene_id>.md`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, Cocos scenes, assets, scripts, project configuration, or Editor state.

Read the orchestrator contracts and [Pencil draft contract](references/pencil-draft-contract.md) before work.

## Procedure

1. Read the assigned `pencil-draft` task, approved implementation plan, requirements, frozen project profile, and frozen visual direction. Confirm the task owns exactly one `scene_id` and its paths do not overlap another loop.
2. Create or update the assigned Pencil source file and an exported preview. Define only page structure, camera/content zones, primary action, UI hierarchy, navigation, interaction regions, and mobile safe areas. Do not choose a new palette, typography, icon style, material, lighting, or motion language.
3. Save the Pencil source and preview under the assigned scene directory. Record both paths and SHA-256 hashes, frozen input hashes, and a structural/functional review checklist in the per-scene artifact. The checklist must make the primary action, interaction regions, information hierarchy, state-feedback location, and expected text capacity reviewable before high-fidelity generation.
4. Request explicit human approval of the exact Pencil-source hash. Keep the artifact `pending`, `rejected`, or `blocked` until approval is recorded; never infer approval from a preview or successful export.
5. Return artifact, hashes, review evidence, and unblock conditions. A changed draft hash invalidates that scene's high-fidelity concept, assets, code, integration, and verification results; the orchestrator performs state changes.

## Hard Gates

- A Pencil draft must not add or override the frozen global visual direction.
- Do not start `$cocos-create-visual-concept`, asset preparation, or scene/UI code for this loop without the approved Pencil artifact whose `approval.subject_hash` equals `pencil_source_hash`.
- Reject missing source files, previews, hash mismatches, incomplete structural checks, and missing human approval.

## Handoff

Pass approved `scene_id`, `scene_loop_id`, Pencil source and preview paths, hashes, frozen input hashes, structural checklist, and approval evidence to the high-fidelity concept task.
