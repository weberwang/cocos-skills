---
name: cocos-implement-game
description: Use when an approved Cocos Creator Web Mobile implementation plan must be converted into scoped, tested TypeScript—first as a core-gameplay prototype, then as formal modules after confirmation—plus a binding manifest, without using Cocos MCP or editing scenes, prefabs, assets, project settings, or workflow state.
---

# Cocos Game Implementation

Write TypeScript, tests, and a binding manifest from an approved plan. This is a file-only code producer: never call Cocos MCP or edit scenes, prefabs, imported assets, project settings, or `.cocos-workflow/workflow.yaml`. Only `$cocos-integrate-assets` performs editor binding.

## Validate inputs

1. Read the orchestrator contracts and [the code-production contract](references/code-production-contract.md). Read project profile, `requirements.md`, approved systems and technical design artifacts, frozen visual direction, and approved `implementation-plan.md`.
2. Verify `project_profile_hash`, `requirements_hash`, systems-design and technical-design hashes, visual-direction `version` and `content_hash`, and plan `content_hash` against current frozen inputs. On mismatch, mark the result `stale` and do not change code.
3. Determine the task kind and production phase:
   - **`kind: core-gameplay-code`（核心玩法原型）**：必须属于 `vertical_slice.scene_ids`；不要求模块拆分、全局骨架、Pencil 草图或高保真效果图；允许占位/最小资源绑定。未完成前不得启动正式模块代码。
   - **正式 `kind: code`**：要求已批准 `module_decomposition` 与 `dependency_graph`、已通过的 `global_scaffold`、以及 `artifacts/vertical-slice.md` 为 `passed` 且哈希绑定人工批准。场景/UI 正式代码还必须具备同场景已批准 Pencil 草图与高保真效果图（含两张全局参考效果图哈希）。
4. Code-only tasks may execute in parallel with asset generation when path ownership allows. Before writing any binding entry with a nonempty `asset_ids`, read `artifacts/game-assets.yaml` and require `status: approved`, a valid human approval whose `subject_hash` equals its `content_hash`, and exact asset IDs. Prototype tasks may leave asset bindings empty or use planned placeholders; formal tasks must not insert unapproved asset IDs.
5. For formal work: execute the sole `kind: global_scaffold` task immediately after approved module decomposition and vertical-slice confirmation. Do not start scene-specific formal `kind: code` until scaffold acceptance checks pass and that scene's Pencil-draft and high-fidelity concept approvals pass. Claim only code tasks whose `allowed_paths` belong to this worker and whose `module_ids` are in approved `module_decomposition`. Return path overlaps, undeclared modules, missing `global_scaffold` dependency, missing design approvals, or cyclic `dependency_graph` entries to the orchestrator; do not partition or take ownership unilaterally.
6. Read `implementation-plan.vertical_slice`. Formal tasks outside the prototype path are blocked until `artifacts/vertical-slice.md` is `passed`, contains a hash-bound human approval, and matches the current plan hash. When implementing an `is_core_gameplay` formal scene, replace the prototype with the formal version—do not treat the prototype as deliverable. `review_mode` cannot waive this production sub-gate.

## Implement

1. Derive minimal module boundaries from planned scripts, scene interfaces, and acceptance mapping. For prototypes, keep the surface area to the core loop only. Keep each file single-purpose; add Simplified Chinese documentation comments for classes, functions, and entity definitions, and explain non-obvious branches in Chinese.
2. Write deterministic TypeScript tests for editor-independent state, rules, and events before the minimum implementation. Keep node paths, component types, asset IDs, and event names in the binding manifest rather than guessing editor objects in business logic.
3. Run the planned TypeScript compile, unit tests, and static checks. Stop and return `failed` on a P0 compilation or required-test failure; never proceed by skipping tests.
4. Generate `.cocos-workflow/artifacts/code-binding-manifest.yaml` with script path, class, target scene or prefab, stable node ID, component, properties, asset dependencies, binding order, and read-back assertions. It declares integration intent; it is not editor evidence. Prototype manifests must mark `implementation_mode: prototype`.
5. Return changed paths, test evidence, artifact hashes, frozen input hashes, and incomplete bindings. Integration starts only after orchestrator acceptance.

## Prohibitions

- Do not call Cocos MCP, including read-only operations; integration does its own editor queries and writes.
- Do not write `.scene`, `.prefab`, non-code assets, `project.json`, editor configuration, `workflow.yaml`, or paths not authorized by the plan. Code is allowed only in authorized TypeScript paths, including `assets/**/*.ts`.
- Do not import assets, add components, set editor properties, save scenes, overwrite files, or act as a Cocos writer.
- Do not start formal module decomposition code, scaffold, or formal scene code before the core-gameplay vertical slice is confirmed.

## Invalidation

If requirements, systems design, technical design, frozen visual direction, scene concepts, implementation plan, or asset IDs change, mark code results and the binding manifest `stale`. Do not continue with a patch until a matching plan is reissued. Every `passed` result must satisfy the orchestrator result contract with nonempty compile and test evidence.
