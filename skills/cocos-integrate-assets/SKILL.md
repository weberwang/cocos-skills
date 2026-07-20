---
name: cocos-integrate-assets
description: Use when approved Cocos Creator Web Mobile assets, TypeScript, and binding manifests must be serially imported and bound through Cocos MCP by the single authorized editor writer, with capability discovery, no-overwrite safeguards, and read-back verification after every batch.
---

# Cocos Asset Integration

Perform the only Cocos MCP write phase in an approved plan. Serially import assets and bind produced code, then read back every batch. Write only orchestrator-authorized task paths and integration results or reports; never modify `workflow.yaml`.

## Block before editor writes

1. Read the three orchestrator references, [the integration contract](references/integration-contract.md), project profile, requirements, frozen visual direction, `implementation-plan.md`, every approved `artifacts/scene-boundaries/<scene_id>.md`, code-binding manifest, and asset-production results.
2. Compare project-profile, requirements, visual-direction version and hash, implementation-plan, every scene-boundary hash, code-manifest, every scene blueprint hash, and every asset-artifact hash. On missing, mismatched, stale, or unapproved input, return `blocked` or `stale` and do not write.
3. Call `/health` and `tools/list` or `/capabilities` and save the current capability snapshot. 资源批次要求快照明确提供资源创建/导入、AssetDB 刷新、编译状态查询、资源元数据查询和独立 `.meta` 路径查询能力；缺少任一能力时返回 `blocked`，不得开始该批次。节点或绑定批次还必须具备对应查询、组件写入和保存能力。Never guess tool names or parameters.
4. Require `ownership.yaml.active_cocos_writers` to contain only this task and require plan `cocos_writer` to name this task. Reject another active writer, parallel batches, and path ownership conflicts.
5. Reject default overwrite, deletion, movement, project-settings change, editor restart or exit, and unauthorized tools. Allow `overwrite: true` only with human approval that names the target, reason, and evidence; otherwise block that item.
6. Read the task `integration_mode`. For `prototype`, allow only the vertical-slice task IDs and placeholder/minimal resources; do not require module decomposition, formal scene design, or a formal asset manifest. For `release`, require a current `artifacts/vertical-slice.md` with `status: passed`, plan-hash match and hash-bound human approval, plus every approved per-scene asset manifest required by the global integration batch. Release integration is global: it begins only after all formal scene loops pass and replaces the prototype implementation. This gate is mandatory in both `full` and `lean` review modes.

## Serial integration protocol

1. For `prototype`, require one `scene_loop_id` in `vertical_slice.scene_ids`. For `release`, require the global integration task to list every completed `scene_loop_id` and approved per-scene asset manifest. Process `integration_batches.batch_index` in order. Query stable IDs for resources, scenes, nodes, and components before each modification.
2. 在导入任何资源或脚本绑定前，按当前批次的 `scene_blueprint` 查询每个声明节点与组件。只创建缺失的计划节点、按计划父子关系挂接、添加缺失的计划组件并设置已声明属性；已有节点或组件的稳定 ID、父节点或关键属性与蓝图不一致时停止并返回 `failed`，不得覆盖、移动或猜测修复。
3. 保存场景并读回蓝图的节点稳定 ID、父子关系、组件类型和 `required_properties`。场景结构断言全部通过后，才可进入资源创建批次。
4. 在一个资源批次中创建或导入该批全部计划资源，但不得立即绑定或使用。批次写入完成后只触发一次 AssetDB 刷新/编译，记录刷新请求、批次资源路径和开始时间；禁止为每个文件重复刷新。
5. 轮询能力快照声明的导入/编译状态，直到本批次明确返回成功且编辑器不再处理资源。等待期间不得绑定资源、保存含这些资源引用的场景或开始下一批；超时、编译错误、导入失败或状态未知时停止并返回 `failed` 或 `blocked`。
6. 刷新编译成功后，先使用能力快照声明的独立 `.meta` 路径查询逐项验证 `<资源路径>.meta` 存在且非空，再读取资源元数据并验证资源 UUID、类型及所需子资源引用 ID 均非空且与计划一致。不得用源文件存在、UUID 返回或普通资源元数据查询推断 `.meta` 已生成。图片需要 SpriteFrame 时必须确认对应子资源已生成。任一资源未就绪即整批失败，不得使用该批其他资源绕过门禁。
7. Apply the binding-manifest `binding_order` with minimal writes to planned nodes, components, properties, and resource references. 每项绑定都必须引用已通过资源就绪检查的 UUID/子资源 ID，以及已通过读回的蓝图节点与组件；不得向蓝图外节点添加组件。Do not run opaque bulk scripts.
8. Save the current scene and immediately read back every node, component, property, and asset reference. Run that batch's `readback_checks`，并确认绑定引用仍等于刷新编译后读取的 UUID/子资源 ID。On failure, stop later batches, preserve evidence, and return `failed`; do not continue with improvised repair.
9. Start the next batch only after the previous resource-ready gate and binding read-back both pass. Write the prototype or global release integration report, scene read-back evidence, and result when complete; the orchestrator performs state transition. Formal scene loops are already complete before release integration starts.

## Result and invalidation

Return frozen input versions and hashes, changed paths, capability snapshot, per-batch commands or methods, refresh/compilation result, `.meta`/UUID/sub-resource readiness evidence, import and binding read-backs, scene-save evidence, issues, and unblock conditions. Any change to code, assets, scenes, plan, requirements, or visual direction makes prior integration, verification, build, and delivery results `stale`; rerun required batches.
