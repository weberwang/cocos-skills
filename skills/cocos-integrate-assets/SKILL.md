---
name: cocos-integrate-assets
description: Use when approved Cocos Creator Web Mobile assets, TypeScript, and binding manifests must be serially imported and bound through Cocos MCP by the single authorized editor writer, with capability discovery, no-overwrite safeguards, and read-back verification after every batch.
---

# Cocos Asset Integration

Perform the only Cocos MCP write phase in an approved plan. Serially import assets and bind produced code, then read back every batch. Write only orchestrator-authorized task paths and integration results or reports; never modify `workflow.yaml`.

## Block before editor writes

1. Read the three orchestrator references, [the integration contract](references/integration-contract.md), project profile, requirements, frozen visual direction, `implementation-plan.md`, code-binding manifest, and asset-production results.
2. Compare project-profile, requirements, visual-direction version and hash, implementation-plan, code-manifest, and every asset-artifact hash. On missing, mismatched, stale, or unapproved input, return `blocked` or `stale` and do not write.
3. Call `/health` and `tools/list` or `/capabilities` and save the current capability snapshot. Block if required import, query, node or component write, or save capability is not explicitly present. Never guess tool names or parameters.
4. Require `ownership.yaml.active_cocos_writers` to contain only this task and require plan `cocos_writer` to name this task. Reject another active writer, parallel batches, and path ownership conflicts.
5. Reject default overwrite, deletion, movement, project-settings change, editor restart or exit, and unauthorized tools. Allow `overwrite: true` only with human approval that names the target, reason, and evidence; otherwise block that item.
6. Read the task `integration_mode`. For `prototype`, allow only the vertical-slice task IDs and placeholder/minimal resources; do not require module decomposition, formal scene design, or a formal asset manifest. For `release`, require a current `artifacts/vertical-slice.md` with `status: passed`, plan-hash match and hash-bound human approval, plus every approved per-scene asset manifest required by the global integration batch. Release integration is global: it begins only after all formal scene loops pass and replaces the prototype implementation. This gate is mandatory in both `full` and `lean` review modes.

## Serial integration protocol

1. For `prototype`, require one `scene_loop_id` in `vertical_slice.scene_ids`. For `release`, require the global integration task to list every completed `scene_loop_id` and approved per-scene asset manifest. Process `integration_batches.batch_index` in order. Query stable IDs for resources, scenes, nodes, and components before each modification.
2. Import only planned, licensed assets with non-conflicting target paths. Read back resource metadata and verify type, path, and reference ID.
3. Apply the binding-manifest `binding_order` with minimal writes to planned nodes, components, properties, and resource references. Do not run opaque bulk scripts.
4. Save the current scene and immediately read back every node, component, property, and asset reference. Run that batch's `readback_checks`. On failure, stop later batches, preserve evidence, and return `failed`; do not continue with improvised repair.
5. Start the next batch only after the previous read-back passes. Write the prototype or global release integration report, scene read-back evidence, and result when complete; the orchestrator performs state transition. Formal scene loops are already complete before release integration starts.

## Result and invalidation

Return frozen input versions and hashes, changed paths, capability snapshot, per-batch commands or methods, import and binding read-backs, scene-save evidence, issues, and unblock conditions. Any change to code, assets, scenes, plan, requirements, or visual direction makes prior integration, verification, build, and delivery results `stale`; rerun required batches.
