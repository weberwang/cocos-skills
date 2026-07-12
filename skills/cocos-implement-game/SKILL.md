---
name: cocos-implement-game
description: Use when an approved Cocos Creator Web Mobile implementation plan must be converted into scoped, tested TypeScript game modules and a binding manifest, without using Cocos MCP or editing scenes, prefabs, assets, project settings, or workflow state.
---

# Cocos Game Implementation

Write TypeScript, tests, and a binding manifest from an approved plan. This is a file-only code producer: never call Cocos MCP or edit scenes, prefabs, imported assets, project settings, or `.cocos-workflow/workflow.yaml`. Only `$cocos-integrate-assets` performs editor binding.

## Validate inputs

1. Read the orchestrator contracts and [the code-production contract](references/code-production-contract.md). Read project profile, `requirements.yaml`, frozen visual direction, and approved `implementation-plan.yaml`, including approved `module_decomposition` and `dependency_graph`.
2. Verify `project_profile_hash`, `requirements_hash`, visual-direction `version` and `content_hash`, and plan `content_hash` against current frozen inputs. On mismatch, mark the result `stale` and do not change code.
3. Code-only tasks may execute in parallel with asset generation. Before writing any binding entry with a nonempty `asset_ids`, read `artifacts/game-assets.yaml` and require `status: approved`, a valid human approval whose `subject_hash` equals its `content_hash`, and exact asset IDs. Otherwise leave that binding task `blocked`; do not insert placeholder IDs or unapproved assets.
4. Execute the sole `kind: global_scaffold` task immediately after approved module decomposition. Do not start scene-specific `kind: code` tasks until its app bootstrap, routing, global state/events, configuration, resource service, error boundary, and acceptance checks pass. Then claim only code tasks whose `allowed_paths` belong to this worker and whose `module_ids` are in approved `module_decomposition`. Return path overlaps, undeclared modules, missing `global_scaffold` dependency, or cyclic `dependency_graph` entries to the orchestrator; do not partition or take ownership unilaterally.

## Implement

1. Derive minimal module boundaries from planned scripts, scene interfaces, and acceptance mapping. Keep each file single-purpose; add Simplified Chinese documentation comments for classes, functions, and entity definitions, and explain non-obvious branches in Chinese.
2. Write deterministic TypeScript tests for editor-independent state, rules, and events before the minimum implementation. Keep node paths, component types, asset IDs, and event names in the binding manifest rather than guessing editor objects in business logic.
3. Run the planned TypeScript compile, unit tests, and static checks. Stop and return `failed` on a P0 compilation or required-test failure; never proceed by skipping tests.
4. Generate `.cocos-workflow/artifacts/code-binding-manifest.yaml` with script path, class, target scene or prefab, stable node ID, component, properties, asset dependencies, binding order, and read-back assertions. It declares integration intent; it is not editor evidence.
5. Return changed paths, test evidence, artifact hashes, frozen input hashes, and incomplete bindings. Integration starts only after orchestrator acceptance.

## Prohibitions

- Do not call Cocos MCP, including read-only operations; integration does its own editor queries and writes.
- Do not write `.scene`, `.prefab`, non-code assets, `project.json`, editor configuration, `workflow.yaml`, or paths not authorized by the plan. Code is allowed only in authorized TypeScript paths, including `assets/**/*.ts`.
- Do not import assets, add components, set editor properties, save scenes, overwrite files, or act as a Cocos writer.

## Invalidation

If requirements, frozen visual direction, scene concepts, implementation plan, or asset IDs change, mark code results and the binding manifest `stale`. Do not continue with a patch until a matching plan is reissued. Every `passed` result must satisfy the orchestrator result contract with nonempty compile and test evidence.
