---
name: cocos-plan-project
description: Use when an approved Cocos Creator Web Mobile game's requirements and frozen visual direction must be turned into a human-approved implementation-plan.md that prioritizes a playable core-gameplay prototype, then module-level formal scene loops with per-scene Pencil/high-fidelity design, TypeScript, asset, path-ownership, and single-editor-writer tasks.
---

# Cocos Project Planning

Convert approved inputs into the sole `.cocos-workflow/artifacts/implementation-plan.md` consumed by production and integration. Plan only: do not generate assets, write game code, call Cocos MCP, or modify `workflow.yaml`.

## Validate inputs

1. Read the orchestrator `workflow-contracts.md`, `state-machine.md`, `mcp-safety-policy.md`, and [the plan contract](references/implementation-plan-contract.md).
2. Read `.cocos-workflow/project-profile.yaml`, `requirements.md`, approved systems and technical design artifacts, the frozen visual-direction artifact, and approved scene concepts. Require approved project configuration, requirements, systems design, technical design, visual direction, and concepts.
3. Compare the current requirements, systems-design, and technical-design hashes, `visual_direction.version`, `visual_direction.content_hash`, and concept hashes to their approval records. On any missing or mismatched input, return `blocked` or `stale`; do not create an executable plan.
4. Accept only orchestrator-authorized plan, result, and report paths. The orchestrator is the only writer of `workflow.yaml`.
5. When the task declares a decision-changing update to an approved plan, require a `$grilling` confirmation whose stage and subject hash match `decision_change`; on a missing or mismatched confirmation, return `blocked` and do not create a replacement plan.

## Create the plan

Production order is fixed: **core gameplay prototype → human confirmation → module decomposition → global scaffold → business-flow levels with formal scene loops**. Do not invert this order.

1. Map every requirement page to a scene or UI state with entry, exit, core interaction, acceptance criteria, and its planned Pencil-draft and high-fidelity-concept task IDs (for the later formal loops).
2. Define exactly one `vertical_slice` as the **first** production gate: select the smallest set of core gameplay `scene_ids` that lets a player complete `start → challenge → resolution`. Set `implementation_mode: prototype`. Plan lightweight `core-gameplay-code → integration → Chrome verification → vertical-slice-review` tasks (placeholder/minimal assets allowed). Do **not** require Pencil drafts, high-fidelity concepts, module decomposition, or global scaffold for this prototype. Map each prototype scene to a later formal `scene_loop` id in `formal_scene_loop_ids`.
3. Only after the vertical-slice review task, create the 模块拆分任务 (`kind: module_decomposition`). Define stable module IDs, `business_flow_level`, responsibilities, public interfaces, owned paths, dependency direction, test boundaries, and acceptance criteria. The task must depend on `vertical-slice-review` and output approved `module_decomposition` and `dependency_graph`; do not turn unconfirmed gameplay into formal module detail.
4. Create one global scaffold code task (`kind: global_scaffold`) after approved `module_decomposition` and before every formal scene loop. It owns only shared bootstrap paths and establishes app entry, scene routing, global state/events, configuration, resource service, error boundary, and test seams. Its acceptance checks must pass before any formal scene-specific code, integration, or Chrome verification starts.
5. Define `business_flow_levels` from the user-visible business flow for **formal** implementation only. Start at level 1 and use consecutive levels only; every level lists its module IDs, page IDs, and completion task IDs. Modules, pages, and tasks in a higher level must wait for every completion task in the preceding level; tasks in the same level may run in parallel only when paths do not overlap. Prototype tasks are excluded from level gates but must finish before any level-1 formal task.
6. Build an asset dependency graph including source, import target, consumers, license status, and missing-asset handling. Asset-preparation can create only a pending manifest; Cocos import and every runtime binding must wait for the exact `game-assets.yaml` approval hash.
7. Generate `.cocos-workflow/artifacts/capture-manifest.yaml` from all frozen `project-profile.capture_profiles`. It must define required routes, replayable interactions, screenshot paths, approved baseline paths, optional masks, and pixel-diff thresholds for `mobile-small`, `mobile-standard`, and `mobile-large`; do not permit a desktop substitute or an omitted profile.
8. Split formal production into non-overlapping asset-preparation and code tasks. Every formal `kind: code` task depends on the approved `module_decomposition` task and names only assigned `module_ids`. Scene-specific formal code also depends on the passed `global_scaffold` task and the vertical-slice gate. Formal code files may run in parallel only when they belong to the same business-flow level and `allowed_paths` do not overlap; a code binding task that names `asset_ids` depends on the approved asset-manifest gate; asset preparation must not use the Cocos editor.
9. Define formal 场景小循环 (`scene_loops`): each scene loop owns one `scene_id` and `business_flow_level`, sets `is_core_gameplay` when the scene is in `vertical_slice.scene_ids`, depends on `vertical-slice-review` + `module_decomposition` + `global_scaffold_task_id`, and orders `pencil-draft → visual-concept → asset-preparation → code → integration → Chrome verification → human-review` inside `production`. Each `visual-concept` task owns exactly one scene and one final image; order these tasks by `scene_loops`, and make every later visual task depend on the prior scene's human review so effect images are never batch-generated. When a loop is core gameplay, it is the **formal version** that replaces the prototype—never ship the prototype as the deliverable. The Pencil draft must be approved before the high-fidelity concept; the concept must bind the frozen visual version/hash and both global reference-effect images before asset preparation or scene/UI code starts. A loop may enter integration only after its module, asset, scaffold, prior business-flow level, and task dependencies pass; it may release the next scene only after all `exit_checks` pass. Shared modules are completed before their consumer scene loops; never let two loops write through Cocos MCP concurrently.
10. Put every Cocos MCP write into one serial `integration` queue. Each batch names one `cocos_writer` and requires query, minimal write, and read-back verification. Do not plan concurrent editor writes, deletion, movement, or default overwrite.
11. Validate the draft, request human approval, and set `approved` only when approver, time, plan hash, core-gameplay prototype definition, scene-loop coverage, business-flow order, formal-core-gameplay mapping, and capture-manifest hash are complete.
12. Return the plan artifact, capture manifest, frozen input hashes, ownership checks, dependency checks, and unresolved questions through the assigned result path. The orchestrator accepts them before entering `production`.

## Block and invalidate

- If requirements, systems design, technical design, visual direction, project-profile hashes, or any completed scene Pencil/high-fidelity design evidence changes, reject plan reuse and mark the plan and downstream outputs `stale`.
- A decision-changing update to an approved plan without a matching `$grilling` confirmation is `blocked`; never infer that confirmation from an implementation-plan approval.
- Block on missing initial scene, requirements criteria, asset license, concept approval, path ownership, or single-writer declaration.
- A plan never replaces a human gate; keep `approval.status` `pending` until explicit approval.

## Output requirements

- `implementation-plan.md` must carry frozen input versions and `sha256:` hashes in YAML front matter and explain the fixed production order, `vertical_slice` prototype gate, `business_flow_levels`, scenes, prefabs, scripts, approved Pencil-draft and high-fidelity-concept dependencies, asset dependencies, `module_decomposition`, `dependency_graph`, formal `scene_loops` (including `is_core_gameplay`), tasks, ownership, the asset-approval join gate, and the one Cocos writer in its body.
- `capture-manifest.yaml` is a planning artifact, not a verification report. It must bind the frozen profile and visual-direction hashes and enumerate all frozen mobile profiles before baseline capture begins.
- Every production or integration task must have `allowed_paths`, `depends_on`, `acceptance_checks`, and expected outputs.
- Follow the orchestrator result contract: a `passed` result has nonempty evidence, returns only authorized paths, and cannot waive P0 failure.
