---
name: cocos-plan-project
description: Use when an approved Cocos Creator Web Mobile game's requirements and frozen visual direction must be turned into a human-approved implementation-plan.yaml with per-scene Pencil/high-fidelity design tasks, scene, prefab, TypeScript, asset-dependency, path-ownership, and single-editor-writer tasks.
---

# Cocos Project Planning

Convert approved inputs into the sole `.cocos-workflow/artifacts/implementation-plan.yaml` consumed by production and integration. Plan only: do not generate assets, write game code, call Cocos MCP, or modify `workflow.yaml`.

## Validate inputs

1. Read the orchestrator `workflow-contracts.md`, `state-machine.md`, `mcp-safety-policy.md`, and [the plan contract](references/implementation-plan-contract.md).
2. Read `.cocos-workflow/project-profile.yaml`, `requirements.yaml`, approved systems and technical design artifacts, the frozen visual-direction artifact, and approved scene concepts. Require approved project configuration, requirements, systems design, technical design, visual direction, and concepts.
3. Compare the current requirements, systems-design, and technical-design hashes, `visual_direction.version`, `visual_direction.content_hash`, and concept hashes to their approval records. On any missing or mismatched input, return `blocked` or `stale`; do not create an executable plan.
4. Accept only orchestrator-authorized plan, result, and report paths. The orchestrator is the only writer of `workflow.yaml`.

## Create the plan

1. Map every requirement page to a scene or UI state with entry, exit, core interaction, acceptance criteria, and its planned Pencil-draft and high-fidelity-concept task IDs.
2. Create a dedicated 模块拆分任务 (`kind: module_decomposition`) before any `kind: code` task. Define stable module IDs, responsibilities, public interfaces, owned paths, dependency direction, test boundaries, and acceptance criteria for scenes, nodes, prefabs, components, and TypeScript modules. The task must output approved `module_decomposition` and `dependency_graph`; do not turn unconfirmed gameplay into implementation detail.
3. Create one global scaffold code task (`kind: global_scaffold`) after approved `module_decomposition` and before every scene loop. It owns only shared bootstrap paths and establishes app entry, scene routing, global state/events, configuration, resource service, error boundary, and test seams. Its acceptance checks must pass before any scene-specific code, integration, or Chrome verification starts.
4. Build an asset dependency graph including source, import target, consumers, license status, and missing-asset handling. Asset-preparation can create only a pending manifest; Cocos import and every runtime binding must wait for the exact `game-assets.yaml` approval hash.
5. Generate `.cocos-workflow/artifacts/capture-manifest.yaml` from all frozen `project-profile.capture_profiles`. It must define required routes, replayable interactions, screenshot paths, approved baseline paths, optional masks, and pixel-diff thresholds for `mobile-small`, `mobile-standard`, and `mobile-large`; do not permit a desktop substitute or an omitted profile.
6. Split production into non-overlapping asset-preparation and code tasks. Every code task depends on the approved `module_decomposition` task and names only assigned `module_ids`. Scene-specific code also depends on the passed `global_scaffold` task. Code files may run in parallel only when `allowed_paths` do not overlap, but a code binding task that names `asset_ids` depends on the approved asset-manifest gate; asset preparation must not use the Cocos editor.
7. Define 场景小循环 (`scene_loops`): each scene loop owns one `scene_id`, depends on `global_scaffold_task_id`, and orders `pencil-draft → visual-concept → asset-preparation → code → integration → Chrome verification → human-review` inside `production`. The Pencil draft must be approved before the high-fidelity concept; the concept must bind the frozen visual version/hash and both global reference-effect images before asset preparation or scene/UI code starts. A loop may enter integration only after its module, asset, scaffold, and task dependencies pass; it may release the next scene only after all `exit_checks` pass. Shared modules are completed before their consumer scene loops; never let two loops write through Cocos MCP concurrently.
8. Define exactly one `vertical_slice`: select the smallest set of MVP scene loops that lets a player complete `start → challenge → resolution`; require real assets, code, serial integration, all mobile Chrome profiles, play evidence, and a hash-bound human approval. Every non-slice scene loop must explicitly depend on this gate; no review mode may waive it.
9. Put every Cocos MCP write into one serial `integration` queue. Each batch names one `cocos_writer` and requires query, minimal write, and read-back verification. Do not plan concurrent editor writes, deletion, movement, or default overwrite.
10. Validate the draft, request human approval, and set `approved` only when approver, time, plan hash, scene-loop coverage, vertical-slice definition, and capture-manifest hash are complete.
11. Return the plan artifact, capture manifest, frozen input hashes, ownership checks, dependency checks, and unresolved questions through the assigned result path. The orchestrator accepts them before entering `production`.

## Block and invalidate

- If requirements, systems design, technical design, visual direction, project-profile hashes, or any completed scene Pencil/high-fidelity design evidence changes, reject plan reuse and mark the plan and downstream outputs `stale`.
- Block on missing initial scene, requirements criteria, asset license, concept approval, path ownership, or single-writer declaration.
- A plan never replaces a human gate; keep `approval.status` `pending` until explicit approval.

## Output requirements

- `implementation-plan.yaml` must carry frozen input versions and `sha256:` hashes and define scenes, prefabs, scripts, approved Pencil-draft and high-fidelity-concept dependencies, asset dependencies, `module_decomposition`, `dependency_graph`, `scene_loops`, `vertical_slice`, tasks, ownership, the asset-approval join gate, and the one Cocos writer.
- `capture-manifest.yaml` is a planning artifact, not a verification report. It must bind the frozen profile and visual-direction hashes and enumerate all frozen mobile profiles before baseline capture begins.
- Every production or integration task must have `allowed_paths`, `depends_on`, `acceptance_checks`, and expected outputs.
- Follow the orchestrator result contract: a `passed` result has nonempty evidence, returns only authorized paths, and cannot waive P0 failure.
