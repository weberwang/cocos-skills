---
name: cocos-plan-project
description: Use when an approved Cocos Creator Web Mobile game's requirements, frozen visual direction, and approved scene concepts must be turned into a human-approved implementation-plan.yaml with scene, prefab, TypeScript, asset-dependency, path-ownership, and single-editor-writer tasks.
---

# Cocos Project Planning

Convert approved inputs into the sole `.cocos-workflow/artifacts/implementation-plan.yaml` consumed by production and integration. Plan only: do not generate assets, write game code, call Cocos MCP, or modify `workflow.yaml`.

## Validate inputs

1. Read the orchestrator `workflow-contracts.md`, `state-machine.md`, `mcp-safety-policy.md`, and [the plan contract](references/implementation-plan-contract.md).
2. Read `.cocos-workflow/project-profile.yaml`, `requirements.yaml`, the frozen visual-direction artifact, and approved scene concepts. Require approved project configuration, requirements, visual direction, and concepts.
3. Compare the current `requirements.content_hash`, `visual_direction.version`, `visual_direction.content_hash`, and concept hashes to their approval records. On any missing or mismatched input, return `blocked` or `stale`; do not create an executable plan.
4. Accept only orchestrator-authorized plan, result, and report paths. The orchestrator is the only writer of `workflow.yaml`.

## Create the plan

1. Map every requirement page to a scene or UI state with entry, exit, core interaction, acceptance criteria, and concept reference.
2. Define stable IDs, responsibilities, dependencies, and acceptance criteria for scenes, nodes, prefabs, components, and TypeScript modules. Do not turn unconfirmed gameplay into implementation detail.
3. Build an asset dependency graph including source, import target, consumers, license status, and missing-asset handling. Create integration work only for approved assets.
4. Split production into non-overlapping asset-preparation and code tasks. Code tasks may run in parallel only when `allowed_paths` do not overlap; asset preparation must not use the Cocos editor.
5. Put every Cocos MCP write into one serial `integration` queue. Each batch names one `cocos_writer` and requires query, minimal write, and read-back verification. Do not plan concurrent editor writes, deletion, movement, or default overwrite.
6. Validate the draft, request human approval, and set `approved` only when approver, time, and plan hash are complete.
7. Return the plan artifact, frozen input hashes, ownership checks, dependency checks, and unresolved questions through the assigned result path. The orchestrator accepts it before entering `production`.

## Block and invalidate

- If requirements, visual direction, concepts, or project-profile hashes change, reject plan reuse and mark the plan and downstream outputs `stale`.
- Block on missing initial scene, requirements criteria, asset license, concept approval, path ownership, or single-writer declaration.
- A plan never replaces a human gate; keep `approval.status` `pending` until explicit approval.

## Output requirements

- `implementation-plan.yaml` must carry frozen input versions and `sha256:` hashes and define scenes, prefabs, scripts, asset dependencies, tasks, ownership, and the one Cocos writer.
- Every production or integration task must have `allowed_paths`, `depends_on`, `acceptance_checks`, and expected outputs.
- Follow the orchestrator result contract: a `passed` result has nonempty evidence, returns only authorized paths, and cannot waive P0 failure.
