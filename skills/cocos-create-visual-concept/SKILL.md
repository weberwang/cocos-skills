---
name: cocos-create-visual-concept
description: Use when a Cocos Creator Web Mobile game has a human-frozen visual direction and needs reviewable, per-scene mobile effect images generated with ImageGen from a repeatable prompt template before implementation planning.
---

# Cocos 创建场景效果图

Generate and review one mobile-oriented concept image per approved scene/page. Preserve the frozen visual inputs exactly; this Skill produces design evidence, not Cocos project changes.

## Boundary

Write only task-assigned paths under `.cocos-workflow/art/concepts/`, `.cocos-workflow/artifacts/scene-concepts.yaml`, and assigned result/report paths. Never write `.cocos-workflow/workflow.yaml`, Cocos scenes, runtime assets, scripts, or project configuration. Do not call Cocos MCP write operations.

Read the installed `$cocos-orchestrate-web-workflow` `workflow-contracts.md` and `state-machine.md` before work. Use `$imagegen` for every generated effect image; do not substitute an unrecorded generator.

## Procedure

1. Read the assigned task, approved requirements, frozen `visual-direction.yaml`, frozen `project-profile.yaml`, and [scene-concept contract](references/scene-concept-contract.md). Reject an input unless visual version/hash, profile hash, orientation, and resolution all match.
2. Derive a stable `scene_id` from each in-scope requirement page. Write a prompt record for each scene using [the prompt template](references/mobile-scene-prompt-template.md). Copy the frozen direction vocabulary and exact mobile resolution; only add page-specific purpose, player action, UI hierarchy, and scene content.
3. Generate an effect image for each scene with `$imagegen`. Do not use phone hardware frames, device mockups, unreadable fake text, unrelated watermarks, or a collage of multiple screens unless the approved requirement explicitly asks for them.
4. Store the image, prompt record, generator metadata, source hashes, and binary SHA-256 in that scene directory. Record visual defects, text limitations, and any manual-edit need rather than silently claiming fidelity.
5. Run the contract checks for every scene. Present the complete set for human review. Until explicit approval, keep each review and the manifest pending; a rejected scene remains failed or blocked and is regenerated under the same frozen inputs.
6. After explicit per-scene approval, set the manifest to `approved`, bind its hash to the visual version/hash, and return artifact, checks, screenshots/preview evidence, and approval evidence to the orchestrator.

## Hard Gates

- Direction, orientation, and resolution originate only from the frozen artifacts. A mismatch is `stale`, not a prompt-edit opportunity.
- Do not call ImageGen before the global visual direction is frozen.
- Do not move to planning on a pending, rejected, missing, or unreviewed scene concept.
- Do not reuse a concept after the frozen visual version, project profile, or requirements page changes; request orchestration invalidation instead.

## Handoff

Pass only approved scene entries with their `scene_id`, image path, content hash, prompt hash, visual version/hash, profile hash, orientation, resolution, and human review. These are reference inputs; later phases must not treat them as Cocos-ready runtime assets.
