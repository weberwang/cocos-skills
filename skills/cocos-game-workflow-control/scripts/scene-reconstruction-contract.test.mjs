import assert from "node:assert/strict";
import { nativeRenderContract, nativeRuntimeEvidence } from "./native-render-test-fixtures.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDisplayLayerPlanning, validateSceneReconstructionContract, validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
import { validateSceneVisualRouteContract } from "./scene-visual-route-contract.mjs";
import { refreshFixtureLayoutExecution } from "./scene-reconstruction-test-fixtures.mjs";
import { validateSceneAssetUsageContract, validateSceneCombinationPreacceptance, validateV4ProductionGate, validateVisualImplementationPackageBinding } from "./visual-production-contract.mjs"; import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256 } from "./layout_annotation_confirmation.mjs";

import { SHA, LAYOUT_SHA, LAYOUT_DECOMPOSITION_VERSION, allNativeJustification, contract, manifest, displayLayerContract, fidelityCase, effectImageContract, effectImageManifest, textNode, textEffectImageContract, effectImageLayoutResults } from "./scene-reconstruction-test-fixtures.mjs";

test("场景还原合同覆盖整屏构图和 runtime fidelity obligation", () => {
  const value = contract(); delete value.combination_preacceptance; assert.deepEqual(validateSceneReconstructionContract(value, manifest(), { stage: "V3" }), []);
  const missing = structuredClone(contract()); delete missing.coverage_regions[0].fidelity_obligations;
  assert(validateSceneReconstructionContract(missing, manifest(), { stage: "V3" }).some((item) => item.includes("fidelity obligations")));
});

test("场景合同只允许 scene master 常驻层，瞬态弹窗必须拆为独立工作项", () => {
  const missing = structuredClone(contract()); delete missing.display_layer_planning;
  assert(validateSceneReconstructionContract(missing, manifest(), { stage: "V1" }).some((item) => item.includes("display_layer_planning")));

  const transient = structuredClone(contract());
  const layer = transient.display_layer_planning.inventory[0];
  layer.layer_id = "pause-modal"; layer.type = "modal"; layer.persistence = "transient"; layer.in_scene_master = true; layer.states = [{ state_id: "open", required: true }];
  transient.display_layer_planning.scene_master.persistent_layer_ids = ["pause-modal"];
  const masterErrors = validateSceneReconstructionContract(transient, manifest(), { stage: "V1" });
  assert(masterErrors.some((item) => item.includes("瞬态显示层不属于场景工作项")));
});

test("独立 DISPLAY_LAYER 的 V4 仍必须提供宿主场景生命周期轨迹", () => {
  const value = displayLayerContract();
  const layer = value.display_layer_planning.inventory[0];
  delete layer.runtime_replay;
  const targetInfo = { sceneId: "main", stateId: "default", targetSha: SHA, viewport: { width: 390, height: 844 } };
  const errors = validateDisplayLayerPlanning(value.display_layer_planning, targetInfo, { stage: "V4", scope: "display-layer" });
  assert(errors.some((item) => item.includes("runtime_replay")));
  layer.runtime_replay = { status: "passed", host_scene_id: "main", same_screen_combination: true, steps: ["open", "interact", "close", "restore"].map((phase) => ({ phase, evidence: `evidence/display/pause-${phase}.json` })) };
  assert.deepEqual(validateDisplayLayerPlanning(value.display_layer_planning, targetInfo, { stage: "V4", scope: "display-layer" }), []);
});

test("正式实施包门按 executionUnits 区分场景与弹窗验收作用域", async () => {
  const root = await mkdtemp(join(tmpdir(), "display-layer-scope-"));
  const snapshot = {
    ...manifest(),
    schema_version: "1.5",
    effect_image_reconstruction: { applicability: "effect-image" },
    workItemId: "popup-work-item",
    candidateVersion: "candidate-1",
    scene_reconstruction_contract: displayLayerContract(),
  };
  const bytes = JSON.stringify(snapshot);
  const file = "popup-manifest.json";
  await writeFile(join(root, file), bytes);
  const basePackage = {
    visualProductionUnits: [],
    visualManifestFile: file,
    visualManifestSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    workItemId: "popup-work-item",
    candidateVersion: "candidate-1",
    current_stage: "V2",
  };
  const displayErrors = validateVisualImplementationPackageBinding({ ...basePackage, executionUnits: [{ unitType: "DISPLAY_LAYER" }] }, { projectRoot: root });
  assert(!displayErrors.some((item) => item.includes("瞬态显示层不属于场景工作项")), displayErrors.join("\n"));
  const sceneErrors = validateVisualImplementationPackageBinding({ ...basePackage, executionUnits: [{ unitType: "SCENE" }] }, { projectRoot: root });
  assert(sceneErrors.some((item) => item.includes("瞬态显示层不属于场景工作项")), sceneErrors.join("\n"));
});

test("effect-image 布局拆解、双向 region 绑定、V4 几何和 V4 逐节点证据完整通过", () => {
  const sceneContract = effectImageContract();
  const targetManifest = effectImageManifest(sceneContract);
  assert.deepEqual(validateSceneReconstructionContract(sceneContract, targetManifest, { stage: "V3" }), []);
  assert.deepEqual(validateSceneCombinationPreacceptance(sceneContract, "V4", { effectImage: true, manifest: targetManifest }), []);
  const fidelity = fidelityCase({ layout_node_results: effectImageLayoutResults() });
  assert.deepEqual(validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V4" }), []);

  // 同一布局身份也允许使用 layout_decomposition 顶层绑定，供旧布局清单迁移时保持单一结构。
  const direct = structuredClone(sceneContract);
  const directLayout = direct.layout_decomposition;
  delete directLayout.layout_binding;
  Object.assign(directLayout, { target_sha256: SHA, scene_id: "main", state_id: "default", target_viewport: { width: 390, height: 844 }, visual_baseline_version: "1.0.0", layout_contract_version: "layout-2.0", layout_contract_sha256: LAYOUT_SHA, layout_decomposition_version: LAYOUT_DECOMPOSITION_VERSION });
  for (const node of directLayout.layout_nodes) Object.assign(node, { target_sha256: SHA, scene_id: "main", state_id: "default", layout_contract_version: "layout-2.0" });
  assert.deepEqual(validateSceneReconstructionContract(direct, effectImageManifest(direct), { stage: "V3" }), []);
});

test("effect-image 缺少布局节点、反向绑定或越界 bounds 时阻断；普通合同不受影响", () => {
  const missing = effectImageContract();
  delete missing.coverage_regions[0].layout_node_ids;
  const missingErrors = validateSceneReconstructionContract(missing, effectImageManifest(missing), { stage: "V2" });
  assert(missingErrors.some((item) => item.includes("layout_node_ids")));

  const orphan = effectImageContract();
  orphan.coverage_regions[0].layout_node_ids = ["board-surface"];
  const orphanErrors = validateSceneReconstructionContract(orphan, effectImageManifest(orphan), { stage: "V2" });
  assert(orphanErrors.some((item) => item.includes("跨 region") || item.includes("反向声明") || item.includes("错绑")), orphanErrors.join("\n"));

  const outOfBounds = effectImageContract();
  outOfBounds.layout_decomposition.layout_nodes[0].target_bounds.x = -1;
  const boundsErrors = validateSceneReconstructionContract(outOfBounds, effectImageManifest(outOfBounds), { stage: "V2" });
  assert(boundsErrors.some((item) => item.includes("位于冻结目标画布内")));
  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
});

test("effect-image 父子布局允许多层关系，并拒绝缺父、循环和越界", () => {
  const nested = effectImageContract();
  // 承载子项必须显式声明容器，不能再依赖子项数量反向推断节点职责。
  nested.layout_decomposition.layout_nodes[1].is_container = true;
  nested.coverage_regions[1].layoutNodeIds.push("board-inner");
  nested.layout_decomposition.layout_nodes.push({ ...structuredClone(nested.layout_decomposition.layout_nodes[1]), layout_node_id: "board-inner", region_id: "board", reference_id: "board-surface", parent_layout_node_id: "board-surface", parent_target_bounds: { x: 20, y: 160, width: 350, height: 620 }, relative_position: { left: 20, right: 230, top: 20, bottom: 500 }, axis_alignment: { horizontal: "left", vertical: "top" }, self_anchor: "top-left", reference_anchor: "top-left", offset: { x: 20, y: 20 }, target_bounds: { x: 40, y: 180, width: 100, height: 100 } });
  nested.combination_preacceptance.layout_geometry.node_measurements.push({ layout_node_id: "board-inner", target_bounds: { x: 40, y: 180, width: 100, height: 100 }, actual_bounds: { x: 40, y: 180, width: 100, height: 100 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board-inner-layout.json"] });
  refreshFixtureLayoutExecution(nested.layout_decomposition.layout_nodes);
  assert.deepEqual(validateSceneReconstructionContract(nested, effectImageManifest(nested), { stage: "V2" }), []);

  const missingParent = effectImageContract();
  delete missingParent.layout_decomposition.layout_nodes[0].parent_layout_node_id;
  assert(validateSceneReconstructionContract(missingParent, effectImageManifest(missingParent), { stage: "V2" }).some((item) => item.includes("parent_layout_node_id")));

  const cycle = effectImageContract();
  cycle.layout_decomposition.layout_nodes[0].parent_layout_node_id = "board-surface";
  cycle.layout_decomposition.layout_nodes[0].reference_id = "board-surface";
  cycle.layout_decomposition.layout_nodes[0].parent_target_bounds = { x: 20, y: 160, width: 350, height: 620 };
  cycle.layout_decomposition.layout_nodes[1].parent_layout_node_id = "hud-main";
  cycle.layout_decomposition.layout_nodes[1].reference_id = "hud-main";
  cycle.layout_decomposition.layout_nodes[1].parent_target_bounds = { x: 0, y: 0, width: 390, height: 96 };
  assert(validateSceneReconstructionContract(cycle, effectImageManifest(cycle), { stage: "V2" }).some((item) => item.includes("父子布局图存在循环")));

  const childOutside = effectImageContract();
  childOutside.layout_decomposition.layout_nodes[1].parent_layout_node_id = "hud-main";
  childOutside.layout_decomposition.layout_nodes[1].reference_id = "hud-main";
  childOutside.layout_decomposition.layout_nodes[1].parent_target_bounds = { x: 0, y: 0, width: 390, height: 96 };
  assert(validateSceneReconstructionContract(childOutside, effectImageManifest(childOutside), { stage: "V2" }).some((item) => item.includes("child target_bounds")));
});

test("effect-image 相对距离、视觉对齐、offset 和锚点均不得伪造", () => {
  for (const mutate of [
    (node) => { node.relative_position.left += 1; },
    (node) => { node.axis_alignment.horizontal = "right"; },
    (node) => { node.offset.x = 999; },
    (node) => { node.self_anchor = "center-center"; },
    (node) => { node.reference_anchor = "center-center"; },
  ]) {
    const value = effectImageContract();
    mutate(value.layout_decomposition.layout_nodes[0]);
    assert(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V2" }).some((item) => item.includes("relative_position") || item.includes("axis_alignment") || item.includes("offset.x") || item.includes("self_anchor") || item.includes("reference_anchor")));
  }
});

test("effect-image 布局 binding 保留业务版本身份，摘要缺失不阻断", () => {
  const missingResponsiveHash = effectImageContract();
  delete missingResponsiveHash.responsive_contract.layout_contract_binding.layout_contract_sha256;
  assert.deepEqual(validateSceneReconstructionContract(missingResponsiveHash, effectImageManifest(missingResponsiveHash), { stage: "V2" }), []);

  const missingTargetVersion = effectImageContract();
  delete missingTargetVersion.target_conditions.layout_decomposition_version;
  const missingTargetErrors = validateSceneReconstructionContract(missingTargetVersion, effectImageManifest(missingTargetVersion), { stage: "V2" });
  assert(missingTargetErrors.some((item) => item.includes("target_conditions.layout_decomposition_version")), missingTargetErrors.join("\n"));

  const missingDecompositionVersion = effectImageContract();
  delete missingDecompositionVersion.layout_decomposition.layout_binding.layout_decomposition_version;
  const missingDecompositionErrors = validateSceneReconstructionContract(missingDecompositionVersion, effectImageManifest(missingDecompositionVersion), { stage: "V2" });
  assert(missingDecompositionErrors.some((item) => item.includes("layout_decomposition binding") && item.includes("layout_decomposition_version")), missingDecompositionErrors.join("\n"));

  const invalidHash = effectImageContract();
  invalidHash.layout_decomposition.layout_binding.layout_contract_sha256 = "sha256:" + "B".repeat(64);
  const invalidHashErrors = validateSceneReconstructionContract(invalidHash, effectImageManifest(invalidHash), { stage: "V2" });
  assert.equal(invalidHashErrors.some((item) => /SHA-256|sha256|layout_contract_sha256/.test(item)), false, invalidHashErrors.join("\n"));

  const mismatchedBinding = effectImageContract();
  mismatchedBinding.layout_decomposition.layout_binding.layout_decomposition_version = "layout-decomposition-2";
  const mismatchedBindingErrors = validateSceneReconstructionContract(mismatchedBinding, effectImageManifest(mismatchedBinding), { stage: "V2" });
  assert(mismatchedBindingErrors.some((item) => item.includes("两个") || item.includes("不一致")), mismatchedBindingErrors.join("\n"));

  const mismatchedViewport = effectImageContract();
  mismatchedViewport.responsive_contract.layout_contract_binding.target_viewport = { width: 393, height: 852 };
  delete mismatchedViewport.responsive_contract.layout_contract_binding.viewport;
  const mismatchedViewportErrors = validateSceneReconstructionContract(mismatchedViewport, effectImageManifest(mismatchedViewport), { stage: "V2" });
  assert(mismatchedViewportErrors.some((item) => item.includes("viewport") && item.includes("不一致")), mismatchedViewportErrors.join("\n"));

  const mismatchedTarget = effectImageContract();
  mismatchedTarget.target_conditions.layout_contract_sha256 = "sha256:" + "c".repeat(64);
  const mismatchedTargetErrors = validateSceneReconstructionContract(mismatchedTarget, effectImageManifest(mismatchedTarget), { stage: "V2" });
  assert.equal(mismatchedTargetErrors.some((item) => /SHA-256|sha256|layout_contract_sha256/.test(item)), false, mismatchedTargetErrors.join("\n"));

  const rootIdentity = effectImageContract();
  rootIdentity.layout_identity = structuredClone(rootIdentity.layout_decomposition.layout_binding);
  assert.deepEqual(validateSceneReconstructionContract(rootIdentity, effectImageManifest(rootIdentity), { stage: "V2" }), []);
  rootIdentity.layout_identity.layout_decomposition_version = "layout-decomposition-root-drift";
  const rootErrors = validateSceneReconstructionContract(rootIdentity, effectImageManifest(rootIdentity), { stage: "V2" });
  assert(rootErrors.some((item) => item.includes("scene contract root") && item.includes("layout_decomposition_version")), rootErrors.join("\n"));

  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
});

test("V4 正式组合布局几何必须覆盖全部节点并拒绝 unknown 或缺证据", () => {
  const sceneContract = effectImageContract();
  const targetManifest = effectImageManifest(sceneContract);
  const v4Missing = structuredClone(sceneContract);
  v4Missing.combination_preacceptance.layout_geometry.node_measurements.pop();
  const v4Errors = validateSceneCombinationPreacceptance(v4Missing, "V4", { effectImage: true, manifest: targetManifest });
  assert(v4Errors.some((item) => item.includes("缺少 layout node 实际测量")));

  const fidelity = fidelityCase({ layout_node_results: effectImageLayoutResults() });
  fidelity.layout_node_results[1].result = "unknown";
  const fidelityErrors = validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V4" });
  assert(fidelityErrors.some((item) => item.includes("result 不能为 unknown/unverified/missing")));
  const missingEvidence = fidelityCase({ layout_node_results: effectImageLayoutResults() });
  delete missingEvidence.layout_node_results[0].evidence;
  const evidenceErrors = validateStructuredFidelityCases([missingEvidence], targetManifest, { stage: "V4" });
  assert(evidenceErrors.some((item) => item.includes("缺少 layout diff evidence")));
});

test("场景目标和 fidelity DPR 允许动态有效值并拒绝非法声明", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5, 2]) {
    const target = structuredClone(contract());
    target.target_conditions.dpr = dpr;
    assert.deepEqual(validateSceneReconstructionContract(target, manifest(), { stage: "V3" }), [], `target dpr=${dpr}`);
    const fidelity = fidelityCase({ dpr, normalization_equivalence: { viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true }, dpr: { target: dpr, candidate: dpr, equivalent: true }, logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true } } });
    assert.deepEqual(validateStructuredFidelityCases([fidelity], manifest(), { stage: "V4" }), [], `fidelity dpr=${dpr}`);
  }
  for (const dpr of [0, -1, 2.0001, 3, "2", NaN, Infinity]) {
    const target = structuredClone(contract()); target.target_conditions.dpr = dpr;
    assert(validateSceneReconstructionContract(target, manifest(), { stage: "V3" }).some((item) => item.includes("正有限数字且不超过 2")), `target dpr=${dpr}`);
    const fidelity = fidelityCase({ dpr });
    assert(validateStructuredFidelityCases([fidelity], manifest(), { stage: "V4" }).some((item) => item.includes("正有限数字且不超过 2")), `fidelity dpr=${dpr}`);
  }
});

test("normalization_equivalence.dpr 必须是有效且相等的 target/candidate 并明确 equivalent=true", () => {
  for (const proof of [{ target: 1, candidate: 2, equivalent: true }, { target: 2, candidate: 2.0001, equivalent: true }, { target: 1, candidate: 1, equivalent: "true" }, { target: 0, candidate: 0, equivalent: true }]) {
    const errors = validateStructuredFidelityCases([fidelityCase({ normalization_equivalence: { ...fidelityCase().normalization_equivalence, dpr: proof } })], manifest(), { stage: "V4" });
    assert(errors.some((item) => item.includes("DPR 等价证明必须使用有效 DPR")), JSON.stringify(proof));
  }
});

test("V1 冲突记录和 V2 拆解图确认/技术拆解/生产合同均为硬门", () => {
  const missingConflict = structuredClone(contract()); delete missingConflict.reference_technical_conflicts;
  assert(validateSceneReconstructionContract(missingConflict, manifest(), { stage: "V1" }).some((item) => item.includes("参考与技术硬约束冲突记录") && item.includes("方案缺失")));
  const missingV2 = structuredClone(contract()); delete missingV2.technical_decomposition;
  const errors = validateSceneReconstructionContract(missingV2, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("V2 还原方案缺少 技术拆解 JSON") && item.includes("应退回阶段=V1/PROPOSAL")), errors.join("\n"));
  assert(errors.every((item) => !item.includes("V2 还原方案缺少 技术拆解 JSON") || item.includes("方案缺失")));
});

test("requiredString 缺失错误保留完整场景上下文、证据和最早退回阶段", () => {
  const value = structuredClone(contract()); delete value.target_conditions.locale;
  const error = validateSceneReconstructionContract(value, manifest(), { stage: "V3" }).find((item) => item.includes("冻结目标 locale"));
  assert(error?.includes("[V3]") && error.includes("scene/state=main/default") && error.includes("annotation_number=*") && error.includes("region_id=*") && error.includes("缺失视觉事实") && error.includes("预期证据=") && error.includes("实际证据=missing") && error.includes("应退回阶段=V1/PROPOSAL") && error.includes("方案缺失"), error);
  const executionError = validateSceneAssetUsageContract({}, {}, "V4")[0];
  assert(executionError?.includes("验收问题") && executionError.includes("应退回阶段=V2/V3"), executionError);
});

/** 覆盖中心点默认锚点、非法坐标，以及非中心例外原因与坐标换算必须同时声明的边界。 */
test("scene_asset_usage 默认使用中心 origin，非中心坐标必须说明原因和换算", () => {
  const baseRegion = contract().coverage_regions[1];
  assert.deepEqual(validateSceneAssetUsageContract(baseRegion, {}, "V4"), []);

  const invalidOrigins = [
    undefined,
    { x: 0.5 },
    { x: "0.5", y: 0.5 },
    { x: NaN, y: 0.5 },
    { x: 1.01, y: 0.5 },
    { x: 0.5, y: -0.01 },
  ];
  for (const origin of invalidOrigins) {
    const region = structuredClone(baseRegion);
    if (origin === undefined) delete region.scene_asset_usage.origin;
    else region.scene_asset_usage.origin = origin;
    assert(validateSceneAssetUsageContract(region, {}, "V4").some((error) => error.includes("origin")), `origin=${String(origin)}`);
  }

  const offCenter = structuredClone(baseRegion);
  offCenter.scene_asset_usage.origin = { x: 0.25, y: 0.5 };
  let errors = validateSceneAssetUsageContract(offCenter, {}, "V4");
  assert(errors.some((error) => error.includes("origin_exception_reason")), errors.join("\n"));
  assert(errors.some((error) => error.includes("origin_coordinate_conversion")), errors.join("\n"));

  offCenter.scene_asset_usage.origin_exception_reason = "目标美术明确要求从左侧边缘对齐";
  errors = validateSceneAssetUsageContract(offCenter, {}, "V4");
  assert(errors.some((error) => error.includes("origin_coordinate_conversion")), errors.join("\n"));
  offCenter.scene_asset_usage.origin_coordinate_conversion = "按目标边界宽度乘以 x=0.25 换算运行时锚点";
  assert.deepEqual(validateSceneAssetUsageContract(offCenter, {}, "V4"), []);
});

test("旧布局合同 target SHA 漂移不阻断真实布局合同", () => {
  const value = structuredClone(contract()); value.responsive_contract.layout_contract_binding.target_sha256 = "sha256:" + "b".repeat(64);
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert.equal(errors.some((item) => item.includes("target SHA") || item.includes("target_sha256")), false, errors.join("\n"));
});

test("V4 fidelity 拒绝字符串 tolerance、尺寸不等价和缺逐区域矩阵", () => {
  const item = { id: "case-1", target_identity: { sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, scene_id: "main", state_id: "default", viewport: { width: 393, height: 852 }, dpr: 2, locale: "zh-CN", seed: 42, input_trace: "trace.json", stable_frame: "frame:1", original_target_size: { width: 390, height: 844 }, original_candidate_size: { width: 393, height: 852 }, normalization_transform: { type: "scale", scale_x: 1, scale_y: 1 }, normalized_comparison_canvas: { width: 390, height: 844 }, full_viewport_reference: "ref.png", full_viewport_candidate: "candidate.png", side_by_side_evidence: "side.png", overlay_evidence: "overlay.png", difference_evidence: "diff.png", tolerance: "any-string", conclusion: "passed" };
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("逐区域结果矩阵")));
  assert(errors.some((value) => value.includes("tolerance 必须是结构化")));
  const complete = structuredClone(item); complete.tolerance = { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } }; complete.per_region_results = [{ region_id: "hud", target_measurement: { width: 100 }, candidate_measurement: { width: 100 }, delta: 0, tolerance: 2, result: "passed", evidence: ["hud.json"] }, { region_id: "board", target_measurement: { width: 100 }, candidate_measurement: { width: 100 }, delta: 0, tolerance: 2, result: "passed", evidence: ["board.json"] }];
  assert(validateStructuredFidelityCases([complete], manifest(), { stage: "V4" }).every((value) => !value.includes("逐区域结果矩阵")));
});

test("Implementation Package 未知 current_stage 不回落", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V9" });
  assert(errors.some((value) => value.includes("current_stage 未知") && value.includes("禁止静默回落")));
});

test("16 项资源 loaded/used 且 missing=0 仍不能掩盖整屏布局差异", () => {
  const fakePass = fidelityCase({
    loaded_assets: 16,
    used_assets: 16,
    missing: 0,
    per_region_results: [
      { region_id: "hud", target_measurement: { width: 390, height: 300 }, candidate_measurement: { width: 64, height: 48 }, delta: { width: 326, height: 252 }, tolerance: { value: 2 }, result: "passed", evidence: ["hud.json"] },
      { region_id: "board", target_measurement: { width: 350, height: 620 }, candidate_measurement: { width: 260, height: 180 }, delta: { width: 90, height: 440 }, tolerance: { value: 2 }, result: "passed", evidence: ["board.json"] },
    ],
  });
  const errors = validateStructuredFidelityCases([fakePass], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("未解释差异") || value.includes("PASS 不能掩盖")));
});

test("HUD、规则、棋盘和工具尺寸位置偏离时 V4 逐区域事实必须失败", () => {
  const item = fidelityCase({ per_region_results: [
    { region_id: "hud", target_measurement: { x: 0, y: 0, width: 390, height: 220 }, candidate_measurement: { x: 4, y: 4, width: 90, height: 24 }, delta: { x: 4, y: 4, width: 300, height: 196 }, tolerance: { value: 2 }, result: "failed", evidence: ["hud.json"] },
    { region_id: "board", target_measurement: { x: 20, y: 180, width: 350, height: 620 }, candidate_measurement: { x: 120, y: 420, width: 160, height: 180 }, delta: { x: 100, y: 240, width: 190, height: 440 }, tolerance: { value: 2 }, result: "failed", evidence: ["board.json"] },
  ], conclusion: "failed" });
  assert(validateStructuredFidelityCases([item], manifest(), { stage: "V4" }).some((value) => value.includes("未解释差异")));
});

test("runtime-program 区域没有完整 fidelity facts 时 V3 阻断", () => {
  const value = structuredClone(contract());
  delete value.coverage_regions[0].typography_facts;
  delete value.coverage_regions[0].fidelity_obligations;
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("typography facts")));
  assert(errors.some((item) => item.includes("fidelity obligations")));
});

test("V2→V3 继续使用旧 target SHA 不触发阶段回退", () => {
  const value = structuredClone(contract());
  value.responsive_contract.layout_contract_binding.target_sha256 = "sha256:" + "f".repeat(64);
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert.equal(errors.some((item) => item.includes("target SHA") || item.includes("target_sha256")), false, errors.join("\n"));
});

test("V4 Fidelity Case 任意字符串 tolerance 不能作为项目容差", () => {
  const errors = validateStructuredFidelityCases([fidelityCase({ tolerance_set: "structured-layout-and-independent-review" })], manifest(), { stage: "V4" });
  assert(errors.some((item) => item.includes("tolerance 必须是结构化")));
});

test("结构化 fidelity 不要求 code/build 摘要，但保留等价证明和 difference evidence", () => {
  const noDiff = fidelityCase(); delete noDiff.candidate_identity.diff_fingerprint; delete noDiff.candidate_identity.sha256;
  assert.equal(validateStructuredFidelityCases([noDiff], manifest(), { stage: "V4" }).some((item) => /SHA|摘要|diff identity/i.test(item)), false);
  const noProof = fidelityCase(); delete noProof.normalization_equivalence;
  assert(validateStructuredFidelityCases([noProof], manifest(), { stage: "V4" }).some((item) => item.includes("等价证明")));
  const nullDiffEvidence = fidelityCase({ difference_evidence: null });
  assert(validateStructuredFidelityCases([nullDiffEvidence], manifest(), { stage: "V4" }).some((item) => item.includes("difference evidence 无效")));
});

test("逐区域 tolerance 只引用场景预声明 ID，容差内可通过、超容差必须失败", () => {
  const within = fidelityCase({ per_region_results: [
    { region_id: "hud", target_measurement: { width: 100, height: 50 }, candidate_measurement: { width: 101, height: 50 }, delta: { width: 1 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud.json"] },
    { region_id: "board", target_measurement: { width: 100, height: 50 }, candidate_measurement: { width: 100, height: 50 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board.json"] },
  ] });
  assert.deepEqual(validateStructuredFidelityCases([within], manifest(), { stage: "V4" }), []);
  const over = structuredClone(within); over.per_region_results[0].candidate_measurement.width = 104; over.per_region_results[0].delta.width = 4;
  assert(validateStructuredFidelityCases([over], manifest(), { stage: "V4" }).some((item) => item.includes("超出预声明 tolerance") && item.includes("验收问题")));
  const localValueOnly = structuredClone(within); delete localValueOnly.per_region_results[0].tolerance_reference;
  assert(validateStructuredFidelityCases([localValueOnly], manifest(), { stage: "V4" }).some((item) => item.includes("预声明 ID")));
});

test("853×1844 对 393×852 未记录归一化变换必须失败", () => {
  const item = fidelityCase({ original_target_size: { width: 853, height: 1844 }, original_candidate_size: { width: 393, height: 852 } });
  delete item.normalization_transform;
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("确定性归一化变换")));
});

test("完整参考图和候选图但缺逐区域矩阵必须失败", () => {
  const item = fidelityCase();
  delete item.per_region_results;
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("逐区域结果矩阵")));
});

test("正式 Scene 使用错误旧布局时 V4 同屏组合预验收失败", () => {
  const value = structuredClone(contract());
  value.combination_preacceptance.formal_scene_structure = "full-screen-image";
  const errors = validateSceneCombinationPreacceptance(value, "V4");
  assert(errors.some((item) => item.includes("禁止使用整屏截图")) && validateSceneCombinationPreacceptance({ ...value, combination_preacceptance: undefined }, "V4").some((item) => item.includes("combination_preacceptance")));
});

test("current_stage=V4 按 V4 解析，不回落为 V3", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V4" });
  assert(errors.some((value) => value.startsWith("[V4]")));
  assert(!errors.some((value) => value.startsWith("[V3]")));
});

test("V4 Implementation Package 使用完整 manifest 快照时继续执行 F2、fidelity 和 runtime gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-v4-gate-"));
  const snapshot = { schema_version: "1.5", effect_image_reconstruction: { applicability: "effect-image" }, workItemId: "work-item", candidateVersion: "candidate-1", reference_target: { target_sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, assets: [], coverage_audit: { regions: [] }, visual_production_gate: { status: "passed" } };
  const bytes = JSON.stringify(snapshot); const file = "manifest.json"; await writeFile(join(root, file), bytes);
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], visualManifestFile: file, visualManifestSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, workItemId: "work-item", candidateVersion: "candidate-1", current_stage: "V4" }, { projectRoot: root, checkFiles: true });
  assert(errors.some((value) => value.includes("F2")), errors.join("\n"));
  assert(errors.some((value) => value.includes("fidelity_cases")), errors.join("\n"));
  assert(errors.some((value) => value.includes("runtime_consumption") || value.includes("runtime replay")), errors.join("\n"));
});

test("V4 Implementation Package 缺少 checkFiles=true 必须明确失败", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V4" }, { checkFiles: false });
  assert(errors.some((value) => value.includes("checkFiles=true") && value.includes("V4 FAIL")), errors.join("\n"));
});

test("完整 reconstruction/layout/V3/V4/F2/F3/V4 happy path 通过场景级门", () => {
  const value = contract();
  const targetManifest = manifest();
  const fidelity = fidelityCase();
  assert.deepEqual(validateSceneReconstructionContract(value, targetManifest, { stage: "V3" }), []);
  assert.deepEqual(validateSceneCombinationPreacceptance(value, "V4"), []);
  assert.deepEqual(validateSceneAssetUsageContract(value.coverage_regions[1], {}, "V4"), []);
  assert.deepEqual(validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V4" }), []);
  const gateManifest = { ...targetManifest, scene_reconstruction_contract: value, fidelity_cases: [fidelity], candidate_identity: { sha256: SHA }, production_contract_audit: { status: "passed" }, visual_production_gate: { status: "passed", v2_status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", baselineHash: SHA, diffFingerprint: "diff-1" }, f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json" }, fidelity_cases: [{ candidate_sha256: SHA, created_at: "2026-08-18T00:00:00Z", freshness_bound: true }], candidate_sha256: SHA, target_sha256: SHA, runtime_consumption: { status: "passed" } } };
  assert.deepEqual(validateV4ProductionGate(gateManifest, { requireSceneReconstruction: true }), []);
});

test("V3 资源阶段不要求正式 Scene 组合或文本 runtime verification", () => {
  const value = textEffectImageContract();
  delete value.combination_preacceptance;
  delete value.text_decomposition.text_nodes[0].runtime_verification;
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
});

test("动态或本地化文本误用 image-text 时阻断", () => {
  const value = textEffectImageContract({
    dynamic: true,
    localizable: true,
    implementation_route: "image-text",
    route_reason: "固定图中文字",
    ownership: "visual-asset",
    required_resources: [{ kind: "image", path: "assets/text/start.png", sha256: SHA }],
    accessible_semantic: { text: "开始游戏", role: "button" },
  });
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(errors.some((item) => item.includes("动态或本地化文本禁止使用 image-text")), errors.join("\n"));
});

test("文本节点未知 region、layout node 或 bounds 漂移时阻断", () => {
  const unknownRegion = textEffectImageContract({ region_id: "missing-region" });
  const regionErrors = validateSceneReconstructionContract(unknownRegion, effectImageManifest(unknownRegion), { stage: "V3" });
  assert(regionErrors.some((item) => item.includes("现有 coverage region")), regionErrors.join("\n"));

  const unknownLayout = textEffectImageContract({ layout_node_id: "missing-layout" });
  const layoutErrors = validateSceneReconstructionContract(unknownLayout, effectImageManifest(unknownLayout), { stage: "V3" });
  assert(layoutErrors.some((item) => item.includes("现有 layout node")), layoutErrors.join("\n"));

  const drifted = textEffectImageContract({ target_bounds: { x: 1, y: 0, width: 390, height: 96 } });
  const driftErrors = validateSceneReconstructionContract(drifted, effectImageManifest(drifted), { stage: "V3" });
  assert(driftErrors.some((item) => item.includes("target_bounds 必须与绑定 layout node 一致")), driftErrors.join("\n"));
});

test("cocos-text 要求字体资源路径，错误 SHA 不阻断", () => {
  const value = textEffectImageContract({ required_resources: [{ kind: "font", path: "assets/fonts/game-sans.woff2", sha256: "sha256:invalid" }] });
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert.equal(errors.some((item) => /SHA-256|sha256/.test(item)), false, errors.join("\n"));
  const missingPath = textEffectImageContract({ required_resources: [{ kind: "font", sha256: "sha256:invalid" }] });
  assert(validateSceneReconstructionContract(missingPath, effectImageManifest(missingPath), { stage: "V3" }).some((item) => item.includes("cocos-text 必须绑定字体资产路径")));
});

test("V4 发现字体 fallback 或加载失败时阻断", () => {
  const value = textEffectImageContract();
  value.text_decomposition.text_nodes[0].runtime_verification.fallback_detected = true;
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" });
  assert(errors.some((item) => item.includes("fallback_detected=false")), errors.join("\n"));
});

test("显式 V4 文本验证执行 target/candidate/tolerance 比较并通过", () => {
  const value = textEffectImageContract();
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" }), []);
});

test("显式 V4 文本验证发现超容差差异时阻断", () => {
  const value = textEffectImageContract();
  const runtime = value.text_decomposition.text_nodes[0].runtime_verification;
  runtime.actual_bounds.width = 394;
  runtime.candidate_bounds.width = 394;
  runtime.delta.width = 4;
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" });
  assert(errors.some((item) => item.includes("超出预声明 tolerance")), errors.join("\n"));
});

test("文本实际测试 ID 必须等于规划测试 ID", () => {
  const value = textEffectImageContract();
  value.text_decomposition.text_nodes[0].runtime_verification.actual_test_id = "tests/text/other";
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" });
  assert(errors.some((item) => item.includes("actual_test_id 必须等于 planned_test_id")), errors.join("\n"));
});

test("effect-image 无文本时必须使用 not-applicable 并提供 reason", () => {
  const value = effectImageContract();
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
  delete value.text_decomposition.reason;
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(errors.some((item) => item.includes("not-applicable 必须提供 reason")), errors.join("\n"));
});

test("bitmap-text 和 image-text 成功路径分别绑定所需资源与语义证据", () => {
  const bitmap = textEffectImageContract({
    implementation_route: "bitmap-text",
    route_reason: "有限字符集使用稳定的位图字形",
    required_resources: [
      { kind: "bitmap-font-descriptor", path: "assets/fonts/game.fnt", sha256: SHA },
      { kind: "bitmap-font-texture", path: "assets/fonts/game.png", sha256: SHA },
    ],
    runtime_verification: { ...textNode().runtime_verification, renderer: "bitmap-text" },
  });
  assert.deepEqual(validateSceneReconstructionContract(bitmap, effectImageManifest(bitmap), { stage: "V4" }), []);

  const image = textEffectImageContract({
    implementation_route: "image-text",
    route_reason: "品牌字标是固定图片资产",
    ownership: "visual-asset",
    required_resources: [{ kind: "image", path: "assets/text/start.png", sha256: SHA }],
    accessible_semantic: { text: "开始游戏", role: "button" },
    runtime_verification: {
      renderer: "image-text",
      actual_bounds: { x: 0, y: 0, width: 390, height: 96 },
      target_bounds: { x: 0, y: 0, width: 390, height: 96 },
      candidate_bounds: { x: 0, y: 0, width: 390, height: 96 },
      delta: { x: 0, y: 0, width: 0, height: 0 },
      tolerance_reference: "layout-tolerance",
      glyph_bounds: { x: 120, y: 28, width: 150, height: 38 },
      baseline: 40,
      actual_test_id: "tests/text/hud-title",
      evidence: ["evidence/text/hud-title-image.json"],
      passed: true,
      asset_consumed: true,
      semantic_evidence: ["evidence/text/hud-title-semantic.json"],
    },
  });
  assert.deepEqual(validateSceneReconstructionContract(image, effectImageManifest(image), { stage: "V4" }), []);
});

test("effect-image 每个 coverage region 在资源规划与 V4 运行验收均要求 visual_route_analysis", () => {
  for (const stage of ["V1", "V2", "V3", "V4"]) {
    const value = effectImageContract();
    delete value.coverage_regions[0].visual_route_analysis;
    const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage });
    assert(errors.some((item) => item.includes("visual_route_analysis") && item.includes("region_id=hud")), `${stage}: ${errors.join("\n")}`);
  }
});

test("非整屏原子装配允许图片资产，旧整屏字段不得继续混入视觉路线", () => {
  const value = effectImageContract();
  assert.equal(value.coverage_regions[1].visual_route_analysis.selected_route, "image-asset");
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);

  value.coverage_regions[1].visual_route_analysis.is_full_screen_capture = false;
  const legacyErrors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(legacyErrors.some((item) => item.includes("已从视觉来源路线移除") && item.includes("assembly_analysis")), legacyErrors.join("\n"));
});

test("全程序视觉路线必须提供绑定冻结目标且可复核的独立分析工件", async () => {
  const value = effectImageContract();
  for (const region of value.coverage_regions) {
    region.implementation_owner = "runtime-program";
    region.implementation_plan = { mode: "runtime-program" };
    region.fidelity_obligations = { geometry: "target-bound" };
    region.visual_route_analysis = {
      ...region.visual_route_analysis,
      element_type: "simple-geometry",
      visual_complexity: "simple",
      distinctive_visual: false,
      observed_features: ["纯色基础几何"], dynamic_requirements: { is_dynamic: true, description: "几何状态随运行时数据变化" },
      asset_first_decision: "native-allowed",
      selected_route: "cocos-native",
      final_owner: "runtime-program",
      implementation_plan_mode: "runtime-program",
      production_method: "cocos-graphics",
      delivery_kind: "runtime-drawing",
      native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: ["pure-color", "basic-geometry"], evidence: [`evidence/route/${region.region_id}-native.json`] },
    };
  }
  const missing = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(missing.some((item) => item.includes("all_native_justification")), missing.join("\n"));
  value.all_native_justification = allNativeJustification();
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);

  value.all_native_justification.reviewed_region_ids = ["hud"];
  const incomplete = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(incomplete.some((item) => item.includes("精确覆盖全部 coverage region")), incomplete.join("\n"));

  const projectRoot = await mkdtemp(join(tmpdir(), "all-native-analysis-"));
  const artifact = {
    analysis_schema: "all-native-visual-analysis/1.0",
    analysis_id: "all-native-review-1",
    producer_role: "independent-visual-reviewer",
    target_sha256: SHA,
    reviewed_region_ids: ["board", "hud"],
    conclusion: "all-native-eligible",
    region_findings: ["board", "hud"].map((region_id) => ({ region_id, eligible: true, observed_features: ["纯色基础几何"], primitive_basis: ["pure-color", "basic-geometry"], evidence: [`evidence/${region_id}.json`] })),
  };
  const artifactBytes = Buffer.from(JSON.stringify(artifact)); await writeFile(join(projectRoot, "all-native-analysis.json"), artifactBytes);
  value.all_native_justification = allNativeJustification({ analysis_artifact_file: "all-native-analysis.json", analysis_artifact_sha256: `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}` });
  assert.deepEqual(validateSceneVisualRouteContract(value, null, { stage: "V3", checkFiles: true, projectRoot }), []);

  value.all_native_justification.analysis_artifact_sha256 = "stale-summary-is-optional"; assert.deepEqual(validateSceneVisualRouteContract(value, null, { stage: "V3", checkFiles: true, projectRoot }), []);
  artifact.region_findings[0].eligible = false; await writeFile(join(projectRoot, "all-native-analysis.json"), JSON.stringify(artifact));
  const contentMismatch = validateSceneVisualRouteContract(value, null, { stage: "V3", checkFiles: true, projectRoot }); assert(contentMismatch.some((item) => item.includes("eligible=true")), contentMismatch.join("\n"));
});

test("特色按钮皮肤或背景框错误选择 Cocos 原生路线时阻断", () => {
  const button = effectImageContract();
  const buttonRegion = button.coverage_regions[0];
  buttonRegion.visual_route_analysis = {
    ...buttonRegion.visual_route_analysis,
    element_type: "button-skin",
    selected_route: "cocos-native",
    asset_first_decision: "native-allowed",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "cocos-graphics",
    delivery_kind: "runtime-drawing",
    distinctive_visual: true,
    native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: ["basic-geometry"], evidence: ["evidence/route/button-native.json"] },
  };
  buttonRegion.implementation_owner = "runtime-program";
  buttonRegion.fidelity_obligations = { geometry: "target-bound" };
  const buttonErrors = validateSceneReconstructionContract(button, effectImageManifest(button), { stage: "V3" });
  assert(buttonErrors.some((item) => item.includes("独特视觉") && item.includes("等价性")), buttonErrors.join("\n"));

  const frame = effectImageContract();
  const frameRegion = frame.coverage_regions[1];
  frameRegion.visual_route_analysis = {
    ...frameRegion.visual_route_analysis,
    element_type: "background-frame",
    selected_route: "cocos-native",
    asset_first_decision: "native-allowed",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "cocos-graphics",
    delivery_kind: "runtime-drawing",
    distinctive_visual: true,
    native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: ["basic-geometry"], evidence: ["evidence/route/frame-native.json"] },
  };
  frameRegion.implementation_owner = "runtime-program";
  frameRegion.fidelity_obligations = { geometry: "target-bound" };
  const frameErrors = validateSceneReconstructionContract(frame, effectImageManifest(frame), { stage: "V3" });
  assert(frameErrors.some((item) => item.includes("独特视觉") && item.includes("等价性")), frameErrors.join("\n"));
});

test("特色视觉提供精确等价性例外时可以通过原生路线", () => {
  const value = effectImageContract();
  const region = value.coverage_regions[0];
  region.implementation_owner = "runtime-program";
  region.implementation_plan = { mode: "runtime-program" };
  region.fidelity_obligations = { geometry: "target-bound" };
  region.visual_route_analysis = {
    ...region.visual_route_analysis,
    element_type: "button-skin",
    selected_route: "cocos-native",
    asset_first_decision: "native-allowed",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "cocos-graphics",
    delivery_kind: "runtime-drawing",
    distinctive_visual: true,
    native_suitability: {
      eligible: true, render_contract: nativeRenderContract(),
      primitive_basis: ["pure-color", "basic-geometry"],
      evidence: ["evidence/route/button-native.json"],
      equivalence_evidence: ["evidence/route/button-equivalence.json"],
      tolerance_reference: "layout-tolerance",
    },
  };
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
});

test("静态基础几何、动态进度与纹理 Sprite/NineSlice 分别走正确路线", () => {
  const geometry = effectImageContract();
  const geometryRegion = geometry.coverage_regions[1];
  geometryRegion.implementation_owner = "runtime-program";
  geometryRegion.implementation_plan = { mode: "runtime-program" };
  geometryRegion.fidelity_obligations = { geometry: "target-bound" };
  geometryRegion.visual_route_analysis = {
    ...geometryRegion.visual_route_analysis,
    element_type: "simple-geometry", visual_complexity: "simple", distinctive_visual: false,
    observed_features: ["纯色基础几何"],
    asset_first_decision: "native-allowed",
    selected_route: "cocos-native",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "cocos-graphics",
    delivery_kind: "runtime-drawing",
    native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: ["pure-color", "basic-geometry"], evidence: ["evidence/route/geometry-native.json"] },
  };
  geometry.all_native_justification = allNativeJustification();
  assert.deepEqual(validateSceneReconstructionContract(geometry, effectImageManifest(geometry), { stage: "V3" }), []);

  const progress = structuredClone(geometry);
  progress.coverage_regions[1].visual_route_analysis = {
    ...progress.coverage_regions[1].visual_route_analysis,
    element_type: "progress-fill",
    observed_features: ["动态进度填充"],
    dynamic_requirements: { is_dynamic: true, description: "进度值随运行时数据变化" },
    native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: ["progress-fill"], evidence: ["evidence/route/progress-native.json"] },
  };
  assert.deepEqual(validateSceneReconstructionContract(progress, effectImageManifest(progress), { stage: "V3" }), []);

  const texturedAsset = effectImageContract();
  texturedAsset.coverage_regions[1].visual_route_analysis.element_type = "sprite";
  texturedAsset.coverage_regions[1].scene_asset_usage.nine_slice = { policy: "texture-nine-slice", source: "board-surface" };
  assert.deepEqual(validateSceneReconstructionContract(texturedAsset, effectImageManifest(texturedAsset), { stage: "V3" }), []);
  const nineSliceAsset = structuredClone(texturedAsset);
  nineSliceAsset.coverage_regions[1].visual_route_analysis.element_type = "nine-slice";
  assert.deepEqual(validateSceneReconstructionContract(nineSliceAsset, effectImageManifest(nineSliceAsset), { stage: "V3" }), []);
});

test("语义相似图标没有精确身份时不得 reuse，混合区域必须退回 V1 重新拆分", () => {
  const similar = effectImageContract();
  const region = similar.coverage_regions[1];
  region.visual_route_analysis = {
    ...region.visual_route_analysis,
    element_type: "icon",
    selected_route: "image-asset",
    asset_first_decision: "asset-first",
    implementation_plan_mode: "reuse-existing",
    production_method: "reuse",
    delivery_kind: "existing-asset",
    reuse_suitability: { eligible: true, exact_asset_identity: { reason: "semantic-similar icon" }, evidence: ["evidence/route/icon-similar.json"] },
  };
  const similarErrors = validateSceneReconstructionContract(similar, effectImageManifest(similar), { stage: "V3" });
  assert(similarErrors.some((item) => item.includes("精确资产 ID") && item.includes("语义相似不等价")), similarErrors.join("\n"));

  // 独立 image-asset 与 cocos-native region 仍是合法混合场景合同，两者不再包装为单一区域路线。
  const independentRoutes = effectImageContract();
  assert.deepEqual(validateSceneReconstructionContract(independentRoutes, effectImageManifest(independentRoutes), { stage: "V3" }), []);

  const composite = effectImageContract();
  composite.coverage_regions[1].visual_route_analysis = {
    ...composite.coverage_regions[1].visual_route_analysis,
    selected_route: "composite",
    asset_first_decision: "composite-required",
    implementation_plan_mode: "asset-and-scene",
    final_owner: "runtime-program",
    production_method: "runtime-program",
    delivery_kind: "runtime-program",
  };
  composite.coverage_regions[1].implementation_owner = "runtime-program";
  composite.coverage_regions[1].fidelity_obligations = { geometry: "target-bound" };
  const compositeErrors = validateSceneReconstructionContract(composite, effectImageManifest(composite), { stage: "V3" });
  assert(compositeErrors.some((item) => item.includes("程序逻辑与独立视觉资产必须重新拆解")), compositeErrors.join("\n"));
  assert(compositeErrors.some((item) => item.includes("禁止单一 composite region 继续生产或验收")), compositeErrors.join("\n"));
  assert(compositeErrors.some((item) => item.includes("应退回阶段=V1/PROPOSAL")), compositeErrors.join("\n"));

  composite.coverage_regions[1].visual_route_analysis.composite_parts = [
    { part_id: "board-appearance", part_role: "appearance", selected_route: "image-asset", final_owner: "fixed-production-visual", production_method: "authored-raster", delivery_kind: "raster-image", evidence: ["evidence/route/board-appearance.json"] },
    { part_id: "board-behavior", part_role: "behavior", selected_route: "cocos-native", final_owner: "runtime-program", production_method: "runtime-program", delivery_kind: "runtime-program", evidence: ["evidence/route/board-behavior.json"] },
  ];
  const completeCompositeErrors = validateSceneReconstructionContract(composite, effectImageManifest(composite), { stage: "V3" });
  assert(completeCompositeErrors.some((item) => item.includes("程序逻辑与独立视觉资产必须重新拆解")), completeCompositeErrors.join("\n"));
  assert(completeCompositeErrors.some((item) => item.includes("禁止单一 composite region 继续生产或验收")), completeCompositeErrors.join("\n"));

  composite.coverage_regions[1].visual_route_analysis.composite_parts[0] = {
    ...composite.coverage_regions[1].visual_route_analysis.composite_parts[0],
    selected_route: "cocos-native",
    final_owner: "runtime-program",
    production_method: "cocos-graphics",
    delivery_kind: "runtime-drawing",
  };
  const stillBlocked = validateSceneReconstructionContract(composite, effectImageManifest(composite), { stage: "V3" });
  assert(stillBlocked.some((item) => item.includes("程序逻辑与独立视觉资产必须重新拆解")), stillBlocked.join("\n"));

  for (const [index, route] of [[1, "image-asset"], [0, "cocos-native"]]) {
    const legalRouteWithLegacyParts = effectImageContract();
    legalRouteWithLegacyParts.coverage_regions[index].visual_route_analysis.composite_parts = structuredClone(composite.coverage_regions[1].visual_route_analysis.composite_parts);
    const errors = validateSceneReconstructionContract(legalRouteWithLegacyParts, effectImageManifest(legalRouteWithLegacyParts), { stage: "V3" });
    assert(errors.some((item) => item.includes("程序逻辑与独立视觉资产必须重新拆解")), `${route}: ${errors.join("\n")}`);
    assert(errors.some((item) => item.includes("禁止单一区域闭环")), `${route}: ${errors.join("\n")}`);
    assert(errors.some((item) => item.includes("应退回阶段=V1/PROPOSAL")), `${route}: ${errors.join("\n")}`);
  }
});

test("文本视觉路线委托 text_decomposition，普通非 effect-image 合同仍不受新路线门影响", () => {
  const value = textEffectImageContract();
  value.coverage_regions[0].visual_route_analysis = {
    ...value.coverage_regions[0].visual_route_analysis,
    element_type: "text", dynamic_requirements: { is_dynamic: false, description: "固定标题文本" },
    text_decomposition_ref: "hud.title.label",
  };
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
});

test("visual_route_analysis 必须与 coverage/实施计划/实施包字段一致", () => {
  const value = effectImageContract();
  value.coverage_regions[1].implementation_plan.mode = "runtime-program";
  const planErrors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(planErrors.some((item) => item.includes("implementation_plan.mode") && item.includes("visual_route_analysis")), planErrors.join("\n"));

  const boundManifest = effectImageManifest(effectImageContract());
  boundManifest.coverage_audit.regions[1].production_method = "cocos-graphics";
  const methodErrors = validateSceneReconstructionContract(boundManifest.scene_reconstruction_contract, boundManifest, { stage: "V3" });
  assert(methodErrors.some((item) => item.includes("coverage_audit region") && item.includes("production_method")), methodErrors.join("\n"));
});

test("三份场景 Schema 同步分离 assembly_analysis 与 visual_route_analysis，摘要仅作可选记录", () => {
  const paths = [
    "skills/cocos-game-workflow-control/references/evidence-manifest.schema.json",
    "skills/cocos-game-workflow-control/references/implementation-package.schema.json",
    "skills/cocos-game-workflow-control/references/work-item.schema.json",
  ];
  const schemas = paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
  const required = schemas.map((schema) => schema.$defs.sceneCoverageRegion.required);
  assert(required.every((fields) => fields.includes("visual_route_analysis")));
  assert(required.every((fields) => fields.includes("assembly_analysis")));
  assert.deepEqual(required[0], required[1]);
  assert.deepEqual(required[1], required[2]);
  assert.deepEqual(schemas[0].$defs.sceneVisualRouteAnalysis, schemas[1].$defs.sceneVisualRouteAnalysis);
  assert.deepEqual(schemas[1].$defs.sceneVisualRouteAnalysis, schemas[2].$defs.sceneVisualRouteAnalysis);
  assert.deepEqual(schemas[0].$defs.allNativeJustification, schemas[1].$defs.allNativeJustification);
  assert.deepEqual(schemas[1].$defs.allNativeJustification, schemas[2].$defs.allNativeJustification);
  assert(schemas.every((schema) => !schema.$defs.allNativeJustification.required.includes("analysis_artifact_sha256")) && schemas.every((schema) => Object.hasOwn(schema.$defs.allNativeJustification.properties, "analysis_artifact_sha256")));
  assert(schemas.every((schema) => schema.$defs.allNativeJustification.required.includes("reviewed_region_ids")));
  assert(schemas.every((schema) => schema.$defs.sceneCoverageRegion.properties.visual_route_analysis.$ref === "#/$defs/sceneVisualRouteAnalysis"));
  assert(schemas.every((schema) => schema.$defs.sceneCoverageRegion.properties.assembly_analysis.$ref === "#/$defs/assemblyAnalysis"));
  assert(schemas.every((schema) => !schema.$defs.sceneVisualRouteAnalysis.required.includes("is_full_screen_capture")));
  assert(schemas.every((schema) => !Object.hasOwn(schema.$defs.sceneVisualRouteAnalysis.properties, "is_full_screen_capture")));
  assert(schemas.every((schema) => !schema.$defs.sceneVisualRouteAnalysis.properties.asset_first_decision.enum.includes("composite-required")));
  assert(schemas.every((schema) => !schema.$defs.sceneVisualRouteAnalysis.properties.selected_route.enum.includes("composite")));
  assert(schemas.every((schema) => !schema.$defs.sceneVisualRouteAnalysis.properties.implementation_plan_mode.enum.includes("asset-and-scene")));
  assert(schemas.every((schema) => !Object.hasOwn(schema.$defs.sceneVisualRouteAnalysis.properties, "composite_parts")));
});
