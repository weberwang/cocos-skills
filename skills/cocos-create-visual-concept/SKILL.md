---
name: cocos-create-visual-concept
description: Use when an approved Cocos Creator Web Mobile implementation plan assigns a scene or UI with a human-approved Pencil layout draft and needs a reviewable high-fidelity mobile effect image that is strictly bound to the frozen global visual direction before asset or code implementation.
---

# Cocos 创建场景效果图

For each approved scene or UI page, confirm its Pencil layout draft, then generate and review one mobile-oriented high-fidelity concept image. Pencil defines structure and interaction hierarchy only; every visual decision must preserve the frozen global visual inputs exactly. This Skill produces design evidence, not Cocos project changes.

## Boundary

Write only task-assigned paths under `.cocos-workflow/art/concepts/`, `.cocos-workflow/artifacts/scene-concepts/<scene_id>.md`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, Cocos scenes, runtime assets, scripts, or project configuration. Do not call Cocos MCP write operations.

Read the installed `$cocos-orchestrate-web-workflow` `workflow-contracts.md` and `state-machine.md` before work. Use `$imagegen` for every generated effect image; do not substitute an unrecorded generator.

## Procedure

1. Read the assigned task, approved `implementation-plan.md`, approved requirements, frozen `visual-direction.md`, frozen `project-profile.yaml`, approved Pencil draft for each in-scope scene or UI page, and [scene-concept contract](references/scene-concept-contract.md). Reject an input unless the plan task/dependency, draft approval/hash, visual version/hash, profile hash, orientation, and resolution all match.
2. Treat each approved Pencil draft as the fixed layout contract: preserve its page structure, primary action, UI hierarchy, navigation, and interaction regions. Pencil does not authorize a new palette, typography, icon style, material, lighting, or motion language.
3. Derive a stable `scene_id` from each in-scope requirement page. Write a prompt record for each scene using [the prompt template](references/mobile-scene-prompt-template.md). Copy the frozen direction vocabulary, two frozen reference-effect images, and exact mobile resolution verbatim; only add content that is already present in the approved Pencil draft and requirement page.
4. Generate an effect image for each scene with `$imagegen` only after its Pencil draft is explicitly approved. Do not use phone hardware frames, device mockups, unreadable fake text, unrelated watermarks, or a collage of multiple screens unless the approved requirement explicitly asks for them.
5. Store the image, Pencil-draft path/hash and approval, prompt record, generator metadata, frozen-reference image hashes, source hashes, and binary SHA-256 in that scene directory. Record visual defects, text limitations, and any manual-edit need rather than silently claiming fidelity.
6. Run the contract checks for every scene: Pencil-structure consistency, exact visual version/hash binding, and a human comparison against both frozen reference-effect images. Present the complete set for human review. Until explicit approval, keep each review and the manifest pending; a rejected scene remains failed or blocked and is regenerated under the same frozen inputs.
7. After explicit per-scene approval, set the per-scene artifact to `approved`, bind its hash to the visual version/hash, and return `scene_concept_artifact`, checks, screenshots/preview evidence, Pencil approval evidence, and approval evidence to the orchestrator.

## Hard Gates

- Direction, orientation, and resolution originate only from the frozen artifacts. A mismatch is `stale`, not a prompt-edit opportunity.
- Do not generate a high-fidelity image without an approved Pencil draft whose content hash is recorded in the scene entry.
- A scene or UI concept must not add or override global visual-direction fields. Any required visual change returns to `$cocos-freeze-visual-direction` for a new frozen version; it is never approved locally.
- Do not call ImageGen before the global visual direction is frozen.
- Do not move to production on a pending, rejected, missing, or unreviewed scene concept.
- Do not reuse a concept after the frozen visual version, project profile, or requirements page changes; request orchestration invalidation instead.

## Handoff

Pass only approved scene entries with their `scene_id`, Pencil-draft path/hash and approval, image path, content hash, prompt hash, two frozen-reference image hashes, visual version/hash, profile hash, orientation, resolution, and human review. These are reference inputs; later phases must not treat them as Cocos-ready runtime assets.
