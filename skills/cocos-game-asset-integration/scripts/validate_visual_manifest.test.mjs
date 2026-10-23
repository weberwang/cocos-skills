import assert from "node:assert/strict";
import { nativeRenderContract, nativeRuntimeEvidence } from "../../cocos-game-workflow-control/scripts/native-render-test-fixtures.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { registerVisualManifestUsabilityCases } from "./visual-manifest-usability-cases.mjs";
import { technicalRegionSnapshot } from "./generate_effect_image_annotation.mjs";
import { checkManifestFiles as runManifestFileCheck, computeRegionDefinitionSha256, main, readPngDimensions, validateManifest } from "./validate_visual_manifest.mjs";
import { annotationProductionContract, decodePngRgba } from "./effect_image_raster.mjs";
import { renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs"; import { buildDecompositionElements } from "./decomposition-elements.mjs";
import { deriveAtomicImageRequirements } from "../../cocos-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { buildEffectImageAssetPrompt, buildEffectImageFullPrompt, EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, EFFECT_IMAGE_NEGATIVE_PROMPT, resolveProductionContract } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";
import { configureManifestTransparentFixture, writeManifestTransparentFixtures } from "./visual-manifest-transparent-fixtures.mjs";
import { IMAGE_PRODUCTION_DPR } from "../../cocos-game-workflow-control/scripts/workflow-dpr-contract.mjs";
import { loadVisualConfirmationAuthority } from "../../cocos-game-workflow-control/scripts/visual-confirmation-authority.mjs"; import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256 } from "../../cocos-game-workflow-control/scripts/layout_annotation_confirmation.mjs"; import { writeLayoutReviewFixtureArtifacts } from "./layout-review-fixtures.mjs";
import { CORE_TEMPLATES, OPTIONAL_TEMPLATES } from "../../cocos-game-orchestrator/scripts/project_doc_templates.mjs";

import { EMPTY_DOCUMENT_FINGERPRINT, STRUCTURAL_FILE_GATE_OPTIONS, visualComponentContract, addManualConfirmationRecords, nonEmptyString, imageNormalizationRecord, validManifest, attachSceneReconstructionContract, validOrdinaryManifest, validAiManifest, bitmapManifest, multiConfirmationGroupManifest, sha256Bytes, canonicalJson, canonicalSha, prerequisiteListSha, pngCrc32, minimalPng, createFixtureFiles, reuseSnapshot, writeConfirmationFixtureFiles, loadFixtureAuthority, checkManifestFiles, refreshRegionDerivedContracts } from "./visual-manifest-test-fixtures.mjs";

registerVisualManifestUsabilityCases({ validManifest, validateManifest, options: STRUCTURAL_FILE_GATE_OPTIONS, checkManifestFiles, createFixtureFiles, writeConfirmationFixtureFiles });
test("普通 visual manifest fidelity DPR 允许动态有效值并拒绝非法声明", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5, 2]) { const manifest = validManifest(); manifest.fidelity_cases[0].dpr = dpr; assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), [], `fidelity dpr=${dpr}`); }
  for (const dpr of [0, -1, 2.0001, 3, "2", NaN, Infinity]) { const manifest = validManifest(); manifest.fidelity_cases[0].dpr = dpr; assert(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS).some((item) => item.includes("正有限数字且不超过 2")), `fidelity dpr=${dpr}`); }
});
test("visual manifest 独立入口拒绝伪造父子相对几何", () => { for (const mutate of [node => delete node.parent_layout_node_id, node => { node.relative_position.left += 1; }, node => { node.axis_alignment.horizontal = "right"; }, node => { node.offset.x = 999; }, node => { node.self_anchor = "center-center"; }]) { const manifest = validManifest(); mutate(manifest.scene_reconstruction_contract.layout_decomposition.layout_nodes[0]); assert(validateManifest(manifest).some((item) => item.includes("parent_layout_node_id") || item.includes("relative_position") || item.includes("axis_alignment") || item.includes("offset.x") || item.includes("self_anchor")), JSON.stringify(mutate)); } });
test("不保留 visual-assets 1.4 兼容", () => { const manifest = validManifest(); manifest.schema_version = "1.4"; assert(validateManifest(manifest).some((item) => item.includes("schema_version 必须为 1.5"))); });
test("非效果图 1.5 清单通过", () => assert.deepEqual(validateManifest(validOrdinaryManifest()), []));
test("effect-image V2-ready 允许 fidelity case 尚未产生", () => { const manifest = validManifest(); manifest.effect_image_reconstruction.lifecycle = "v2-ready"; manifest.fidelity_cases = []; assert.deepEqual(validateManifest(manifest), []); }); test("V3 资源验收不要求正式 Scene、组合预验收或 runtime consumption", () => { const manifest = validManifest(); manifest.visualStage = "V3"; manifest.visualStageState = "v3-formal-acceptance-complete"; manifest.effect_image_reconstruction.lifecycle = "v2-ready"; manifest.fidelity_cases = []; delete manifest.scene_reconstruction_contract; delete manifest.visual_production_gate; delete manifest.assets[0].runtime_consumption; delete manifest.production_contract_audit.units[0].runtime_consumption; assert.deepEqual(validateManifest(manifest, { stage: "V3", ...STRUCTURAL_FILE_GATE_OPTIONS }), []); });
test("validateManifest 高层硬阻断单一区域 composite，即使 composite_parts 完整也必须退回 V1", () => {
  const manifest = validManifest();
  assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const region = manifest.scene_reconstruction_contract.coverage_regions.find((item) => item.region_id === "region-hero");
  Object.assign(region, {
    implementation_owner: "runtime-program",
    implementation_plan: { mode: "asset-and-scene" },
  });
  Object.assign(region.visual_route_analysis, {
    selected_route: "composite",
    asset_first_decision: "composite-required",
    implementation_plan_mode: "asset-and-scene",
    final_owner: "runtime-program",
    production_method: "runtime-program",
    delivery_kind: "runtime-program",
    composite_parts: [
      { part_id: "hero-appearance", part_role: "appearance", selected_route: "image-asset", final_owner: "fixed-production-visual", production_method: "authored-raster", delivery_kind: "raster-image", evidence: ["evidence/route/hero-appearance.json"] },
      { part_id: "hero-behavior", part_role: "behavior", selected_route: "cocos-native", final_owner: "runtime-program", production_method: "runtime-program", delivery_kind: "runtime-program", evidence: ["evidence/route/hero-behavior.json"] },
    ],
  });
  const errors = validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS);
  assert(errors.some((item) => item.includes("程序逻辑与独立视觉资产必须重新拆解")), errors.join("\n"));
  assert(errors.some((item) => item.includes("禁止单一 composite region 继续生产或验收")), errors.join("\n"));
  assert(errors.some((item) => item.includes("应退回阶段=V1/PROPOSAL")), errors.join("\n"));
});
test("显示层合同拒绝默认主图中的瞬态层和孤立上下文图", () => {
  const transient = validManifest();
  const planning = transient.scene_reconstruction_contract.display_layer_planning;
  const layer = planning.inventory[0]; layer.layer_id = "pause-modal"; layer.type = "modal"; layer.persistence = "transient"; layer.in_scene_master = true; planning.scene_master.persistent_layer_ids = ["pause-modal"]; layer.states = [{ state_id: "open", required: true }];
  assert(validateManifest(transient).some((item) => item.includes("上下文效果图") || item.includes("不得进入默认 scene master") || item.includes("瞬态显示层不属于场景工作项")));
  layer.in_scene_master = false; planning.scene_master.persistent_layer_ids = []; layer.states[0].contextual_effect_image = { evidence: "evidence/display/pause-open.png", sha256: transient.reference_target.target_sha256, origin: "provided", host_scene_id: "main-gameplay", host_target_sha256: transient.reference_target.target_sha256, layer_target_sha256: transient.reference_target.target_sha256, viewport: { width: 390, height: 844 }, kind: "host-scene-context", isolated_only: true };
  assert(validateManifest(transient, { workItemType: "DISPLAY_LAYER" }).some((item) => item.includes("孤立组件图")));
});
test("独立清单入口显式区分场景与弹窗工作项", async () => {
  const transient = validManifest();
  transient.effect_image_reconstruction.lifecycle = "v2-ready";
  transient.fidelity_cases = [];
  const planning = transient.scene_reconstruction_contract.display_layer_planning;
  const layer = planning.inventory[0];
  layer.layer_id = "pause-modal"; layer.type = "modal"; layer.persistence = "transient"; layer.in_scene_master = false;
  planning.scene_master.persistent_layer_ids = [];
  layer.states = [{ state_id: "open", required: true, contextual_effect_image: { evidence: "evidence/display/pause-open.png", sha256: transient.reference_target.target_sha256, origin: "provided", host_scene_id: "main-gameplay", host_target_sha256: transient.reference_target.target_sha256, layer_target_sha256: transient.reference_target.target_sha256, viewport: { width: 390, height: 844 }, kind: "host-scene-context", isolated_only: false } }];
  const displayErrors = validateManifest(transient, { workItemType: "DISPLAY_LAYER" });
  assert(!displayErrors.some((item) => item.includes("瞬态显示层不属于场景工作项")), displayErrors.join("\n"));
  assert(validateManifest(transient, { workItemType: "SCENE" }).some((item) => item.includes("瞬态显示层不属于场景工作项")));
  const root = await mkdtemp(join(tmpdir(), "display-layer-manifest-cli-"));
  const path = join(root, "visual-assets.json");
  await writeFile(path, JSON.stringify(transient));
  const messages = [];
  const originalError = console.error;
  console.error = (...args) => messages.push(args.join(" "));
  try {
    // 夹具仍带 V4 阶段身份，CLI 会因阶段冲突失败；这里专门确认它不再误报场景作用域。
    assert.equal(await main([path, "--stage", "V2", "--work-item-type", "DISPLAY_LAYER"]), 1);
  } finally {
    console.error = originalError;
  }
  assert(!messages.join("\n").includes("瞬态显示层不属于场景工作项"), messages.join("\n"));
});
test("V4 stage 对 v2-ready 清单强制 production_contract_audit", async () => { const root = await mkdtemp(join(tmpdir(), "visual-v4-stage-")); const path = join(root, "visual-assets.json"); const manifest = validManifest(); manifest.effect_image_reconstruction.lifecycle = "v2-ready"; delete manifest.production_contract_audit; await writeFile(path, JSON.stringify(manifest)); assert(validateManifest(manifest, { stage: "V4" }).some((item) => item.includes("production_contract_audit 缺失"))); assert.equal(await main([path, "--stage", "V4", "--check-files", "--project-root", root]), 1); });
test("V3/V4 效果图 API 和 CLI 缺少文件门必须拒绝，显式文件门才可继续结构校验", async () => {
  const v2Ready = validManifest(); v2Ready.effect_image_reconstruction.lifecycle = "v2-ready";
  assert(validateManifest(v2Ready, { stage: "V4" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
  const v4 = validManifest();
  assert(validateManifest(v4, { stage: "V4" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
  const imagegen = validAiManifest(); imagegen.effect_image_reconstruction.lifecycle = "v2-ready";
  const generatedV4 = validAiManifest(); const generatedRoot = await mkdtemp(join(tmpdir(), "visual-manifest-alpha-")); await createFixtureFiles(generatedRoot, true, generatedV4); assert.deepEqual(validateManifest(generatedV4, { stage: "V4", ...STRUCTURAL_FILE_GATE_OPTIONS, projectRoot: generatedRoot }), []); assert(validateManifest(imagegen, { stage: "V4" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
  assert.deepEqual(validateManifest(v4, STRUCTURAL_FILE_GATE_OPTIONS), []);
  assert.deepEqual(validateManifest(imagegen, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const root = await mkdtemp(join(tmpdir(), "visual-file-gate-cli-")); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(v4));
  assert.equal(await main([path, "--stage", "V4"]), 1); assert(validateManifest(v4, { stage: "V5" }).some((item) => item.includes("只能是 V2、V3 或 V4"))); assert((await checkManifestFiles(v4, "fixture-project", { stage: "V5" })).some((item) => item.includes("只能是 V2、V3 或 V4")));
});
test("effect-image 根工作项和候选版本必须使用单一 camelCase 并绑定 V4 audit", () => {
  const missingWorkItem = validManifest(); delete missingWorkItem.workItemId; missingWorkItem.work_item_id = "work-item-1";
  const workErrors = validateManifest(missingWorkItem);
  assert(workErrors.some((item) => item.includes("workItemId")));
  assert(workErrors.some((item) => item.includes("work_item_id")));
  const missingCandidate = validManifest(); delete missingCandidate.candidateVersion; missingCandidate.candidate_version = "candidate-1";
  const candidateErrors = validateManifest(missingCandidate);
  assert(candidateErrors.some((item) => item.includes("candidateVersion")));
  assert(candidateErrors.some((item) => item.includes("candidate_version")));
  const staleCandidate = validManifest(); staleCandidate.effect_image_reconstruction.lifecycle = "v2-ready"; staleCandidate.candidateVersion = "candidate-stale";
  assert(validateManifest(staleCandidate, { stage: "V4" }).some((item) => item.includes("candidateVersion")));
});
test("V4 主入口拒绝错误 Work Item 或过期 candidateVersion 的 Change Request", () => {
  const base = validManifest();
  const request = { status: "ACCEPTED", changeRequestId: "CR-METHOD", workItemId: "wrong-work-item", candidateVersion: base.candidateVersion, candidate_sha256: base.candidate_identity.sha256, target_sha256: base.reference_target.target_sha256, baseline_sha256: base.visual_baseline.style_fingerprint, diff_fingerprint: base.candidate_identity.diff_fingerprint, user_original_text: "用户批准变更生产方式", accepted_at: "2026-08-15T00:40:00Z", production_method_changes: [{ annotation_number: 2, region_id: "region-hero", previous_method: "authored-raster", proposed_method: "reuse" }] };
  base.change_requests = [request];
  assert(validateManifest(base, { stage: "V4" }).some((item) => item.includes("workItemId") && item.includes("不一致")));
  const stale = structuredClone(base); stale.change_requests[0].workItemId = stale.workItemId; stale.change_requests[0].candidateVersion = "candidate-old";
  assert(validateManifest(stale, { stage: "V4" }).some((item) => item.includes("candidateVersion") && item.includes("不一致")));
});
test("V4 complete 必须有全部通过的 fidelity case", () => { const missing = validManifest(); missing.fidelity_cases = []; assert(validateManifest(missing).some((item) => item.includes("fidelity_cases 必须是非空数组"))); const failed = validManifest(); failed.fidelity_cases[0].conclusion = "failed"; assert(validateManifest(failed).some((item) => item.includes("必须全部 passed"))); });
test("V4 F2 摘要缺失、陈旧或格式异常都不阻断验收", () => { for (const [field, value] of [["baselineHash", { stale: true }], ["diffFingerprint", 17]]) { const manifest = validManifest(); manifest.visual_production_gate.f2_machine_validation[field] = value; assert(!validateManifest(manifest).some((item) => item.includes("F2") && item.includes("未绑定当前")), field); } const missing = validManifest(); delete missing.visual_production_gate.f2_machine_validation.baselineHash; assert(!validateManifest(missing).some((item) => item.includes("baselineHash"))); });
test("V4 complete 缺少 V4、F2 或 V4 对象时不得绕过总门", () => {
  for (const [field, marker] of [["production_contract_audit", "production_contract_audit"], ["f2_machine_validation", "F2"], ["visual_production_gate", "V4 production gate"]]) {
    const manifest = validManifest();
    if (field === "f2_machine_validation") delete manifest.visual_production_gate.f2_machine_validation;
    else delete manifest[field];
    assert(validateManifest(manifest).some((item) => item.includes(marker)), field);
  }
});
test("V4 fidelity 必须逐冻结 scene/state 组合覆盖", () => { const manifest = validManifest(); manifest.reference_target.state_ids.push("paused"); manifest.coverage_audit.canvases.push({ scene_id: "main-gameplay", state_id: "paused", width: 390, height: 844 }); manifest.coverage_audit.summaries.push({ scene_id: "main-gameplay", state_id: "paused", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/paused-summary.md" }); manifest.coverage_audit.regions.push({ ...structuredClone(manifest.coverage_audit.regions[0]), id: "region-paused", state_id: "paused" }); assert(validateManifest(manifest).some((item) => item.includes("main-gameplay/paused"))); });
test("项目模板默认生成非效果图 1.5 资源清单", () => { assert(CORE_TEMPLATES["GDD.md"].includes("完整场景与功能清单")); assert(CORE_TEMPLATES["TDD.md"].includes("functional_status")); assert(CORE_TEMPLATES["visual-baseline.md"].includes("不追加 V2/V3/V4 证据")); assert(CORE_TEMPLATES["visual-design.md"].includes("可追加的视觉方向")); assert(CORE_TEMPLATES["visual-design.md"].includes("本文件追加 V2/V3/V4 留痕不会改变基线哈希")); assert(!OPTIONAL_TEMPLATES.assets["asset-license-register.md"].includes("对 `docs/visual-design.md` 计算")); const template = JSON.parse(OPTIONAL_TEMPLATES.assets["visual-assets.json"]); assert.equal(template.schema_version, "1.5"); assert.equal(template.visual_contract_version, "1.0"); assert.equal(template.workItemId, null); assert.equal(template.candidateVersion, null); assert.equal(template.visual_baseline.document, "docs/visual-baseline.md"); assert.deepEqual(template.effect_image_reconstruction, { applicability: "not-applicable", lifecycle: "not-applicable" }); assert(!("reference_target" in template)); });
test("合同回对门仍检查领域结论，但候选摘要漂移不阻断", () => { const missing = validManifest(); missing.contract_reconciliation.checks.pop(); assert(validateManifest(missing).some((item) => item.includes("缺少已通过领域"))); const failed = validManifest(); failed.contract_reconciliation.status = "failed"; assert(validateManifest(failed).some((item) => item.includes("必须为 passed"))); const drifted = validManifest(); drifted.contract_reconciliation.candidate_sha256 = { stale: true }; assert(!validateManifest(drifted).some((item) => item.includes("SHA") || item.includes("sha256"))); });
test("ownership 覆盖规则拒绝运行内容位图化", () => { const manifest = validManifest(); manifest.coverage_audit.regions[2].asset_id = "hero-idle"; assert(validateManifest(manifest).some((item) => item.includes("禁止映射生产位图"))); });
test("覆盖区域要求几何和人工确认文件证据", () => { const bounds = validManifest(); delete bounds.coverage_audit.regions[0].bounds; assert(validateManifest(bounds).some((item) => item.includes("bounds 必须"))); const evidence = validManifest(); delete evidence.coverage_audit.regions[0].confirmation.proposal_file; assert(validateManifest(evidence).some((item) => item.includes("proposal_file"))); });
test("拆解位图保留实际区域身份与人工 accepted 校验，不比较摘要", async () => { const auto = validManifest(); auto.coverage_audit.regions[1].production_origin = "bitmap-decomposition"; delete auto.coverage_audit.regions[1].confirmation.confirmation_schema; assert(validateManifest(auto).some((item) => item.includes("confirmation_schema"))); const missingConfirmation = validManifest(); missingConfirmation.coverage_audit.regions[1].production_origin = "bitmap-decomposition"; missingConfirmation.coverage_audit.regions[1].confirmation = { mode: "USER_DECISION" }; assert(validateManifest(missingConfirmation).some((item) => item.includes("manual accepted") || item.includes("confirmation_schema"))); const confirmed = bitmapManifest(); assert.deepEqual(validateManifest(confirmed, STRUCTURAL_FILE_GATE_OPTIONS), []); const targetDrift = structuredClone(confirmed); targetDrift.coverage_audit.regions[1].confirmation.target_sha256 = { stale: true }; assert(!validateManifest(targetDrift).some((item) => item.includes("target_sha256") || item.includes("重新确认"))); const regionDrift = structuredClone(confirmed); regionDrift.coverage_audit.regions[1].confirmation.region_id = "region-other"; assert(validateManifest(regionDrift).some((item) => item.includes("与覆盖区域不一致"))); const root = await mkdtemp(join(tmpdir(), "visual-confirmation-region-facts-")); await createFixtureFiles(root, true, confirmed); await writeConfirmationFixtureFiles(root, confirmed); const boundsDrift = structuredClone(confirmed); boundsDrift.coverage_audit.regions[1].bounds.width += 1; assert((await checkManifestFiles(boundsDrift, root)).some((item) => item.includes("区域 bounds 不一致")), "真实 bounds 与 proposal 不一致仍失败"); const layerDrift = structuredClone(confirmed); layerDrift.coverage_audit.regions[1].layer = "foreground"; assert((await checkManifestFiles(layerDrift, root)).some((item) => item.includes("technical_definition 与当前区域不一致")), "实际区域事实与 proposal 不一致仍失败"); });
test("独立生产必须使用 accepted/manual 确认且不得伪装拆解", () => { const valid = validManifest(); assert.deepEqual(validateManifest(valid, STRUCTURAL_FILE_GATE_OPTIONS), []); const forged = validManifest(); forged.coverage_audit.regions[1].confirmation.status = "pending"; assert(validateManifest(forged).some((item) => item.includes("status 必须为 accepted"))); });
test("运行数据和运行渲染区域不得声明 production_origin", () => { const manifest = validManifest(); manifest.coverage_audit.regions[0].production_origin = "independent-production"; assert(validateManifest(manifest).some((item) => item.includes("禁止声明 production_origin"))); });
test("coverage 与 fidelity 必须位于冻结目标范围", () => { const coverage = validManifest(); coverage.coverage_audit.regions[0].scene_id = "unknown-scene"; assert(validateManifest(coverage).some((item) => item.includes("scene_id 不在 reference_target"))); const fidelity = validManifest(); fidelity.fidelity_cases[0].state_id = "unknown-state"; assert(validateManifest(fidelity).some((item) => item.includes("state_id 不在 reference_target"))); });
test("coverage 完整性拒绝 1x1、缺目标状态和越界区域", () => { const tiny = validManifest(); tiny.coverage_audit.regions = [{ ...tiny.coverage_audit.regions[0], bounds: { x: 0, y: 0, width: 1, height: 1 } }]; assert(validateManifest(tiny).some((item) => item.includes("并集面积不足"))); const missing = validManifest(); missing.reference_target.state_ids.push("paused"); assert(validateManifest(missing).some((item) => item.includes("缺少目标组合"))); const overflow = validManifest(); overflow.coverage_audit.regions[1].bounds.x = 380; assert(validateManifest(overflow).some((item) => item.includes("bounds 超出目标画布"))); });
test("coverage 重叠矩形不得重复累计为完整画布", () => { const manifest = validManifest(); manifest.coverage_audit.regions = [structuredClone(manifest.coverage_audit.regions[0]), structuredClone(manifest.coverage_audit.regions[0])]; manifest.coverage_audit.regions[0].bounds = { x: 0, y: 0, width: 390, height: 422 }; manifest.coverage_audit.regions[1].id = "region-overlap"; manifest.coverage_audit.regions[1].bounds = { x: 0, y: 0, width: 390, height: 422 }; assert(validateManifest(manifest).some((item) => item.includes("矩形并集面积不足"))); });
test("固定视觉必须映射资源且资产必须反向绑定区域", () => { const missing = validManifest(); missing.coverage_audit.regions[1].asset_id = "unknown"; assert(validateManifest(missing).some((item) => item.includes("缺少已声明正式资源"))); const stale = validManifest(); stale.assets[0].coverage_region_ids = ["region-score"]; assert(validateManifest(stale).some((item) => item.includes("未映射到该资源"))); });
test("固定视觉覆盖映射必须双向完全一致", () => { const manifest = validManifest(); manifest.coverage_audit.regions.push({ ...structuredClone(manifest.coverage_audit.regions[1]), id: "region-hero-shadow" }); assert(validateManifest(manifest).some((item) => item.includes("缺少映射到该资源"))); });
test("资产 coverage_region_ids 不得重复", () => { const manifest = validManifest(); manifest.assets[0].coverage_region_ids.push("region-hero"); assert(validateManifest(manifest).some((item) => item.includes("coverage_region_ids 不得重复"))); });
test("effect-image 清单允许同时包含未映射普通资产", () => { const manifest = validManifest(); const ordinary = { ...manifest.assets[0], id: "boot-logo", texture_key: "boot-logo", scene_id: "boot", runtime_outputs: ["public/assets/boot-logo.png"] }; delete ordinary.ownership_type; delete ordinary.coverage_region_ids; manifest.assets.push(ordinary); assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("孤立还原字段不得伪造映射", () => { const manifest = validManifest(); const isolated = { ...manifest.assets[0], id: "boot-logo", texture_key: "boot-logo", scene_id: "boot", runtime_outputs: ["public/assets/boot-logo.png"], coverage_region_ids: ["region-hero"] }; manifest.assets.push(isolated); assert(validateManifest(manifest).some((item) => item.includes("未被 fixed coverage 引用"))); });
test("人工确认仍要求标注、提案和决定路径，不要求文件摘要", () => { const manifest = validManifest(); manifest.coverage_audit.regions[0].confirmation = { confirmation_schema: "visual-decomposition-confirmation/1.0", status: "accepted", confirmation_mode: "manual" }; const errors = validateManifest(manifest); assert(errors.some((item) => item.includes("proposal_file"))); assert(!errors.some((item) => item.includes("sha256") || item.includes("SHA"))); assert(errors.some((item) => item.includes("decision_record_file"))); });
test("拆解区域身份哈希对属性顺序稳定且拒绝所有权漂移", () => { const manifest = bitmapManifest(); const region = manifest.coverage_audit.regions[1]; const hash = computeRegionDefinitionSha256(region); const reordered = structuredClone(region); reordered.bounds = { height: region.bounds.height, width: region.bounds.width, y: region.bounds.y, x: region.bounds.x }; assert.equal(computeRegionDefinitionSha256(reordered), hash); for (const field of ["owner_id", "asset_id", "production_origin"]) { const changed = structuredClone(region); changed[field] = `${changed[field]}-changed`; assert.notEqual(computeRegionDefinitionSha256(changed), hash); } });
test("拆解资产只有显式 图像生成 才要求 AI 路线且独立生产不得直接复用冻结原图", () => { const bitmap = validManifest(); const region = bitmap.coverage_audit.regions[1]; region.production_origin = "bitmap-decomposition"; region.production_method = "image-generation"; region.delivery_kind = "raster-image"; region.image_generation_required = true; region.generation_record_required = true; const asset = bitmap.assets[0]; asset.production_origin = "bitmap-decomposition"; asset.production_method = "image-generation"; asset.delivery_kind = "raster-image"; asset.image_generation_required = true; asset.generation_record_required = true; assert(validateManifest(bitmap).some((item) => item.includes("route 必须为 ai-composite-raster"))); const independent = validManifest(); independent.assets[0].source_file = independent.reference_target.original_file; assert(validateManifest(independent).some((item) => item.includes("不得直接把冻结效果图"))); });
test("重复合同领域、覆盖和 fidelity ID 失败", () => { const gate = validManifest(); gate.contract_reconciliation.checks.push(structuredClone(gate.contract_reconciliation.checks[0])); assert(validateManifest(gate).some((item) => item.includes("domain 重复"))); const coverage = validManifest(); coverage.coverage_audit.regions.push(structuredClone(coverage.coverage_audit.regions[0])); assert(validateManifest(coverage).some((item) => item.includes("id 重复"))); const fidelity = validManifest(); fidelity.fidelity_cases.push(structuredClone(fidelity.fidelity_cases[0])); assert(validateManifest(fidelity).some((item) => item.includes("id 重复"))); });
test("parity 目标与候选摘要缺失或漂移不阻断", () => { const target = validManifest(); target.fidelity_cases[0].target_sha256 = "bad-target"; delete target.fidelity_cases[0].candidate_sha256; assert(!validateManifest(target).some((item) => item.includes("target_sha256") || item.includes("candidate_sha256"))); });
test("fidelity 必须绑定根视觉基线版本", () => { const manifest = validManifest(); manifest.fidelity_cases[0].visual_baseline_version = "2.0.0"; assert(validateManifest(manifest).some((item) => item.includes("根 visual_baseline.version"))); });
test("所有资源状态都要求场景归属", () => { for (const status of ["planned", "producing", "review", "accepted", "rejected", "replaced"]) { const manifest = validManifest(); manifest.assets[0].status = status; delete manifest.assets[0].scene_id; assert(validateManifest(manifest).some((item) => item.includes("scene_id 或 shared")), status); } });
test("公共资源要求稳定复用或运行必需", () => { const valid = validManifest(); delete valid.assets[0].scene_id; valid.assets[0].shared = true; valid.assets[0].shared_scene_ids = ["main-gameplay", "result"]; assert.deepEqual(validateManifest(valid, STRUCTURAL_FILE_GATE_OPTIONS), []); const oneScene = validManifest(); delete oneScene.assets[0].scene_id; oneScene.assets[0].shared = true; oneScene.assets[0].shared_scene_ids = ["main-gameplay"]; assert(validateManifest(oneScene).some((item) => item.includes("至少两个"))); const runtime = validManifest(); delete runtime.assets[0].scene_id; runtime.assets[0].shared = true; runtime.assets[0].shared_reason = "runtime-required"; assert.deepEqual(validateManifest(runtime, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("场景归属与公共归属不得混用", () => { const manifest = validManifest(); manifest.assets[0].shared = true; manifest.assets[0].shared_scene_ids = ["main-gameplay", "result"]; assert(validateManifest(manifest).some((item) => item.includes("二选一"))); });
test("重复纹理键和输出路径同时报告", () => { const manifest = validManifest(); manifest.assets.push({ ...manifest.assets[0], id: "hero-run" }); const errors = validateManifest(manifest); assert(errors.some((item) => item.includes("texture_key 重复"))); assert(errors.some((item) => item.includes("路径重复"))); });
test("已验收资源要求证据", () => { const manifest = validManifest(); delete manifest.assets[0].cocos_evidence; assert(validateManifest(manifest).some((item) => item.includes("cocos_evidence"))); });
test("视觉基线必须存在且使用明确静态冻结语义", () => { const missing = validManifest(); delete missing.visual_baseline; assert(validateManifest(missing).includes("visual_baseline 必须是对象")); const draft = validManifest(); draft.visual_baseline.status = "draft"; assert(validateManifest(draft).some((item) => item.includes("global-static-baseline-frozen"))); const bare = validManifest(); bare.visual_baseline.status = "frozen"; assert(validateManifest(bare).some((item) => item.includes("global-static-baseline-frozen"))); });
test("风格指纹是可选摘要记录，不限制格式或类型", () => { const manifest = validManifest(); manifest.visual_baseline.style_fingerprint = { stale: true }; assert(!validateManifest(manifest).some((item) => item.includes("style_fingerprint") || item.includes("SHA"))); delete manifest.visual_baseline.style_fingerprint; assert(!validateManifest(manifest).some((item) => item.includes("style_fingerprint"))); });
test("阶段证据文档不得作为冻结基线哈希正文", () => { const manifest = validManifest(); manifest.visual_baseline.document = "docs/visual-design.md"; assert(validateManifest(manifest).some((item) => item.includes("不可变 docs/visual-baseline.md"))); });
test("资源仍绑定基线版本，但摘要漂移不阻断", () => { const staleVersion = validManifest(); staleVersion.assets[0].visual_baseline_version = "2.0.0"; assert(validateManifest(staleVersion).some((item) => item.includes("visual_baseline_version 与"))); const staleDigest = validManifest(); staleDigest.assets[0].style_fingerprint = { stale: true }; assert(!validateManifest(staleDigest).some((item) => item.includes("style_fingerprint") || item.includes("SHA"))); });
test("AI 生成包字段完整", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-ai-package-")); const valid = validAiManifest(); await createFixtureFiles(root, true, valid); assert.deepEqual(validateManifest(valid, { ...STRUCTURAL_FILE_GATE_OPTIONS, projectRoot: root }), []); const manifest = validAiManifest(); delete manifest.assets[0].generation_record.global_prompt_prefix; assert(validateManifest(manifest, { ...STRUCTURAL_FILE_GATE_OPTIONS, projectRoot: root }).some((item) => item.includes("global_prompt_prefix"))); });
test("任意路线使用 generation_record 时必须提供完整公共生成身份", () => { const forged = validManifest(); delete forged.assets[0].source_file; forged.assets[0].generation_record = { x: 1 }; assert(validateManifest(forged).some((item) => item.includes("generation_record.record_id"))); const generated = validManifest(); delete generated.assets[0].source_file; generated.assets[0].generation_record = { record_id: "gen-1", generator: "aseprite-cli", generator_version: "1.3", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "aseprite -b hero.aseprite --save-as hero.png", input_sources: ["spec:hero-idle"], parameters: { scale: 1 } }; assert.deepEqual(validateManifest(generated, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("预算必须是正数", () => { const manifest = validManifest(); manifest.budgets.max_texture_size = null; assert(validateManifest(manifest).some((item) => item.includes("max_texture_size 必须是正数"))); });
test("PNG 必须具备支持的 IHDR 组合和完整扫描行", () => { assert.deepEqual(readPngDimensions(minimalPng(1, 1)), { width: 1, height: 1 }); assert.equal(readPngDimensions(minimalPng(1, 1, Buffer.alloc(0))), null); assert.equal(readPngDimensions(minimalPng(1, 1, Buffer.from([5, 0, 0, 0, 0]))), null); });
test("文件检查仍覆盖存在性与 AI 引用，但文件内容变更不做摘要阻断", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validAiManifest(); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("文件不存在"))); await createFixtureFiles(root, true, manifest); await writeConfirmationFixtureFiles(root, manifest); assert.deepEqual(await checkManifestFiles(manifest, root), []); await writeFile(join(root, "docs/visual-baseline.md"), "修改"); assert(!((await checkManifestFiles(manifest, root)).some((item) => item.includes("SHA-256") || item.includes("sha256")))); });
test("全局锚点和一致性证据的摘要漂移不阻断，但路径仍须存在", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-global-file-gate-"));
  const manifest = validAiManifest();
  await createFixtureFiles(root, true, manifest);
  await writeConfirmationFixtureFiles(root, manifest);
  await writeFile(join(root, "evidence/visual/main-anchor.png"), "anchor-drift");
  assert(!((await checkManifestFiles(manifest, root)).some((item) => item.includes("SHA") || item.includes("sha256"))));
  const missingAnchor = structuredClone(manifest); missingAnchor.visual_baseline.anchor_evidence[0].path = "evidence/visual/missing-anchor.png";
  assert((await checkManifestFiles(missingAnchor, root)).some((item) => item.includes("visual_baseline.anchor_evidence") && item.includes("文件不存在")));
  await writeFile(join(root, "evidence/visual/ai-consistency.json"), JSON.stringify({ status: "passed", details: "changed while digest is stale" }));
  assert(!((await checkManifestFiles(manifest, root)).some((item) => item.includes("SHA") || item.includes("sha256"))));
  const missingConsistency = structuredClone(manifest); missingConsistency.assets[0].generation_record.consistency_evidence = { path: "evidence/visual/missing-consistency.json", sha256: { stale: true } };
  const consistencyErrors = await checkManifestFiles(missingConsistency, root); assert(consistencyErrors.some((item) => item.includes("consistency_evidence") && item.includes("文件不存在")), consistencyErrors.join("\n"));
});
test("V4 check-files 不因旧 F2 baseline 或旧 diff 摘要拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-f2-identity-"));
  await createFixtureFiles(root, true);
  const manifestPath = join(root, "visual-assets.json");
  for (const [field, value] of [["baselineHash", 21], ["diffFingerprint", { stale: true }]]) {
    const manifest = validManifest();
    manifest.visual_production_gate.f2_machine_validation[field] = value;
    await writeConfirmationFixtureFiles(root, manifest);
    assert(!((await checkManifestFiles(manifest, root, { stage: "V4" })).some((item) => item.includes("baselineHash") || item.includes("diffFingerprint"))), `check-files ${field}`);
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert(!validateManifest(JSON.parse(await readFile(manifestPath, "utf8"))).some((item) => item.includes(field)), `CLI 输入 ${field}`);
  }
});
test("V4 文件审计拒绝扩展名伪装的 mjs raster", async () => { const root = await mkdtemp(join(tmpdir(), "visual-fake-raster-")); const manifest = validManifest(); await createFixtureFiles(root); const fake = join(root, "public/assets/fake.mjs"); await mkdir(dirname(fake), { recursive: true }); await writeFile(fake, "export default 1;"); manifest.assets[0].runtime_outputs = ["public/assets/fake.mjs"]; manifest.production_contract_audit.units[0].actual_assets[0].file = "public/assets/fake.mjs"; manifest.production_contract_audit.units[0].actual_assets[0].sha256 = sha256Bytes(Buffer.from("export default 1;")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("不是可解码 PNG/JPEG/WebP"))); });
test("V4 check-files 不得因缺少 production_contract_audit 而静默放行", async () => { const root = await mkdtemp(join(tmpdir(), "visual-v4-audit-")); const manifest = validManifest(); delete manifest.production_contract_audit; await createFixtureFiles(root); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("production_contract_audit 缺失"))); });
test("编号图文件缺失或格式无效时文件检查失败，摘要缺失或陈旧不阻断", async () => { const root = await mkdtemp(join(tmpdir(), "visual-numbered-")); const manifest = validManifest(); manifest.coverage_audit.regions[0].confirmation = { mode: "USER_DECISION", reasons: ["ambiguous-boundary"], numbered_image_file: "evidence/coverage/numbered.png", numbered_image_version: "1", decision_id: "decision-1" }; await createFixtureFiles(root); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("numbered_image_file 文件不存在"))); const path = join(root, "evidence/coverage/numbered.png"); await mkdir(dirname(path), { recursive: true }); await writeFile(path, "changed"); const errors = await checkManifestFiles(manifest, root); assert(errors.some((item) => item.includes("numbered_image_file 必须是") || item.includes("PNG"))); assert(!errors.some((item) => item.includes("numbered_image_sha256"))); });
test("拆解提案、决定记录和标注 PNG 仍验证文件结构与逐项内容，不比较文件摘要", async () => { const root = await mkdtemp(join(tmpdir(), "visual-decomposition-")); const manifest = bitmapManifest(); await createFixtureFiles(root, true, manifest); const region = manifest.coverage_audit.regions[1]; const pairRegions = manifest.coverage_audit.regions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id); const numberedBytes = renderEffectImageAnnotation(minimalPng(390, 844), manifest.reference_target.original_file, manifest.coverage_audit.canvases[0], pairRegions); await writeConfirmationFixtureFiles(root, manifest, numberedBytes); const numberedPath = join(root, region.confirmation.annotation_file); assert.deepEqual(await checkManifestFiles(manifest, root), []); const hidden = Buffer.from(numberedBytes); hidden[hidden.length - 1] ^= 1; await writeFile(numberedPath, hidden); region.confirmation.annotation_sha256 = "malformed-stale"; assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("正式 PNG 标注") || item.includes("CRC"))); await writeConfirmationFixtureFiles(root, manifest, numberedBytes); await writeFile(join(root, region.confirmation.proposal_file), ""); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("proposal_file 必须是可解析 JSON"))); const invalid = bitmapManifest(); await createFixtureFiles(root, true); await writeConfirmationFixtureFiles(root, invalid, minimalPng()); assert((await checkManifestFiles(invalid, root)).some((item) => item.includes("尺寸") || item.includes("标准 PNG") || item.includes("区域标注"))); });
test("文件检查拒绝路径逃逸", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.visual_baseline.document = "../outside.md"; assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("路径逃逸"))); });
test("文件检查拒绝 symlink 真实位置逃逸", async (t) => { const root = await mkdtemp(join(tmpdir(), "visual-symlink-")); const outsideRoot = await mkdtemp(join(tmpdir(), "visual-symlink-outside-")); const outside = join(outsideRoot, "outside.png"); await writeFile(outside, "outside"); const link = join(root, "evidence/visual/escaped.png"); await mkdir(dirname(link), { recursive: true }); try { await symlink(outside, link, "file"); } catch { t.skip("当前 Windows 环境不允许创建 symlink"); return; } const manifest = validManifest(); manifest.visual_baseline.anchor_evidence.push("evidence/visual/escaped.png"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("真实位置逃逸"))); });
test("错误 assets 容器不得绕过 V3/V4 文件检查", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.assets = 42; await createFixtureFiles(root); assert(validateManifest(manifest).includes("assets 必须是数组")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("V4") || item.includes("V4"))); });
test("CLI 对结构错误返回非零", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const path = join(root, "visual-assets.json"); const manifest = validManifest(); manifest.assets = 42; await writeFile(path, JSON.stringify(manifest)); assert.equal(await main([path, "--check-files", "--project-root", root]), 1); });
test("CLI 对 bitmap-decomposition 强制文件证据门", async () => { const root = await mkdtemp(join(tmpdir(), "visual-bitmap-gate-")); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(bitmapManifest())); assert.equal(await main([path]), 2); });
test("独立生产文件不要求与冻结目标字节不同，但不得复用目标路径", async () => { const root = await mkdtemp(join(tmpdir(), "visual-independent-source-")); const manifest = validManifest(); await createFixtureFiles(root); await writeFile(join(root, manifest.assets[0].source_file), minimalPng(390, 844)); assert(!((await checkManifestFiles(manifest, root)).some((item) => item.includes("同 SHA") || item.includes("SHA 相同")))); const samePath = structuredClone(manifest); samePath.assets[0].source_file = samePath.reference_target.original_file; assert((await checkManifestFiles(samePath, root)).some((item) => item.includes("不得直接引用冻结效果图"))); });
test("reuse-existing 只能绑定新版不可变快照且不得改回 generate-now", () => {
  const manifest = validManifest(); const region = manifest.coverage_audit.regions[1];
  region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源" }; region.reuse_snapshot = reuseSnapshot();
  Object.assign(manifest.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" });
  Object.assign(manifest.production_contract_audit.units[0], { observed_method: "reuse", observed_delivery_kind: "existing-asset" });
  refreshRegionDerivedContracts(manifest, region); addManualConfirmationRecords(manifest);
  const invalid = structuredClone(manifest); invalid.coverage_audit.regions[1].reuse_snapshot.source_status = "rejected";
  assert(validateManifest(invalid).some((item) => item.includes("source_status") && item.includes("accepted")));
  const generateNow = structuredClone(manifest); generateNow.coverage_audit.regions[1].implementation_plan.mode = "generate-now";
  assert(validateManifest(generateNow).some((item) => item.includes("production_method=reuse") && item.includes("reuse-existing")));
});
test("reuse 快照缺 schema 或来源字段时拒绝", () => {
  const base = validManifest(); const region = base.coverage_audit.regions[1]; region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源" }; region.reuse_snapshot = reuseSnapshot();
  Object.assign(base.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" }); refreshRegionDerivedContracts(base, region); addManualConfirmationRecords(base);
  const invalidSchema = structuredClone(base); invalidSchema.coverage_audit.regions[1].reuse_snapshot.schema = "asset-reuse-snapshot/0.9";
  assert(validateManifest(invalidSchema).some((item) => item.includes("asset-reuse-snapshot/1.0")));
  const missing = structuredClone(base); delete missing.coverage_audit.regions[1].reuse_snapshot.source_manifest_file;
  assert(validateManifest(missing).some((item) => item.includes("source_manifest_file")));
});
test("reuse-existing 文件身份必须绑定 accepted 源快照、源文件和兼容证据", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-reuse-files-")); const manifest = validManifest(); const region = manifest.coverage_audit.regions[1];
  const sourceBytes = minimalPng(64, 96); const compatibility = JSON.stringify({ status: "passed" });
  const sourceManifest = { status: "accepted", source_file: "art/hero.png", source_sha256: sha256Bytes(sourceBytes) }; const sourceManifestBytes = Buffer.from(JSON.stringify(sourceManifest));
  const snapshot = reuseSnapshot({ source_asset_id: "hero-idle", source_manifest_sha256: sha256Bytes(sourceManifestBytes), source_sha256: sha256Bytes(sourceBytes), compatibility_evidence_sha256: sha256Bytes(Buffer.from(compatibility)) });
  region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源" }; region.reuse_snapshot = snapshot;
  Object.assign(manifest.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" }); Object.assign(manifest.production_contract_audit.units[0], { observed_method: "reuse", observed_delivery_kind: "existing-asset" });
  refreshRegionDerivedContracts(manifest, region); addManualConfirmationRecords(manifest); await createFixtureFiles(root); await writeFile(join(root, "art/hero.png"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.json"), compatibility); await writeFile(join(root, "docs/reuse-snapshot.json"), sourceManifestBytes); await writeConfirmationFixtureFiles(root, manifest);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
  await writeFile(join(root, "art/hero.png"), Buffer.from("source-drift")); const corruptSourceErrors = await checkManifestFiles(manifest, root); assert(corruptSourceErrors.some((item) => item.includes("source_file") && item.includes("真实 PNG/JPEG")), corruptSourceErrors.join("\n"));
  await writeFile(join(root, "art/hero.png"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.json"), JSON.stringify({ status: "rejected" })); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("compatibility evidence")));
  const drifted = { ...sourceManifest, source_file: "art/other.png" }; const driftedBytes = Buffer.from(JSON.stringify(drifted)); await writeFile(join(root, "docs/reuse-snapshot.json"), driftedBytes); snapshot.source_manifest_sha256 = sha256Bytes(driftedBytes); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("source_file") && item.includes("source manifest")));
});
test("拆解人工确认绑定用户原文和 accepted 身份，不要求消息摘要", () => { const missingDigest = bitmapManifest(); const confirmation = missingDigest.coverage_audit.regions[1].confirmation; delete confirmation.user_message_sha256; confirmation.confirmation_sha256 = { stale: true }; confirmation.target_sha256 = 23; assert(!validateManifest(missingDigest).some((item) => item.includes("user_message_sha256") || item.includes("confirmation_sha256") || item.includes("target_sha256"))); const missingText = bitmapManifest(); delete missingText.coverage_audit.regions[1].confirmation.user_original_text; assert(validateManifest(missingText).some((item) => item.includes("user_original_text"))); const forged = bitmapManifest(); forged.coverage_audit.regions[1].confirmation.confirmation_mode = "auto"; assert(validateManifest(forged).some((item) => item.includes("confirmation_mode 必须为 manual"))); });

test("每个 scene/state 组拥有独立 PNG、提案和决定文件并完整覆盖组内编号", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-confirmation-groups-")); const manifest = multiConfirmationGroupManifest(); await createFixtureFiles(root, true, manifest);
  const original = minimalPng(390, 844); const groups = new Map();
  for (const region of manifest.coverage_audit.regions) { const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list); }
  const bytesByGroup = Object.fromEntries([...groups].map(([key, regions]) => [key, renderEffectImageAnnotation(original, manifest.reference_target.original_file, manifest.coverage_audit.canvases.find((canvas) => `${canvas.scene_id}\0${canvas.state_id}` === key), regions)]));
  await writeConfirmationFixtureFiles(root, manifest, bytesByGroup);
  assert.notEqual(manifest.coverage_audit.regions[0].confirmation.annotation_file, manifest.coverage_audit.regions[2].confirmation.annotation_file);
  assert.equal(manifest.scene_reconstruction_contract.layout_decomposition.layout_nodes.length, 2); assert.deepEqual(await checkManifestFiles(manifest, root), []);
});

test("多 scene/state 确认拒绝串组文件和漏组文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-confirmation-group-errors-")); const manifest = multiConfirmationGroupManifest(); await createFixtureFiles(root, true, manifest);
  const original = minimalPng(390, 844); const groups = new Map();
  for (const region of manifest.coverage_audit.regions) { const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list); }
  const bytesByGroup = Object.fromEntries([...groups].map(([key, regions]) => [key, renderEffectImageAnnotation(original, manifest.reference_target.original_file, manifest.coverage_audit.canvases.find((canvas) => `${canvas.scene_id}\0${canvas.state_id}` === key), regions)]));
  await writeConfirmationFixtureFiles(root, manifest, bytesByGroup);
  const first = manifest.coverage_audit.regions[0].confirmation; const second = manifest.coverage_audit.regions[2].confirmation;
  second.annotation_file = first.annotation_file;
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("不得复用其他 scene/state 组")));
  await writeConfirmationFixtureFiles(root, manifest, bytesByGroup);
  second.decision_record_file = "evidence/coverage/missing-victory-decision.json";
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("decision_record_file 文件不存在") || item.includes("decision_record_file")));
});
test("拆解提案前必须绑定已有 ownership 审阅证据", () => { const manifest = bitmapManifest(); delete manifest.coverage_audit.regions[1].ownership_evidence; assert(validateManifest(manifest).some((item) => item.includes("ownership_evidence"))); });
test("reuse 快照文件漂移或来源状态变化时拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-reuse-snapshot-drift-")); const manifest = validManifest(); const region = manifest.coverage_audit.regions[1]; const sourceBytes = minimalPng(64, 96); const compatibility = JSON.stringify({ status: "passed" });
  const sourceManifest = { status: "accepted", source_file: "art/hero.png", source_sha256: sha256Bytes(sourceBytes) }; const sourceManifestBytes = Buffer.from(JSON.stringify(sourceManifest)); const snapshot = reuseSnapshot({ source_asset_id: "hero-idle", source_manifest_sha256: sha256Bytes(sourceManifestBytes), source_sha256: sha256Bytes(sourceBytes), compatibility_evidence_sha256: sha256Bytes(Buffer.from(compatibility)) });
  region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用快照资源" }; region.reuse_snapshot = snapshot; Object.assign(manifest.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" }); Object.assign(manifest.production_contract_audit.units[0], { observed_method: "reuse", observed_delivery_kind: "existing-asset" }); refreshRegionDerivedContracts(manifest, region); addManualConfirmationRecords(manifest);
  await createFixtureFiles(root); await writeFile(join(root, "art/hero.png"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.json"), compatibility); await writeFile(join(root, "docs/reuse-snapshot.json"), sourceManifestBytes); await writeConfirmationFixtureFiles(root, manifest); assert.deepEqual(await checkManifestFiles(manifest, root), []);
  const rejected = structuredClone(manifest); rejected.coverage_audit.regions[1].reuse_snapshot.source_status = "rejected"; assert((await checkManifestFiles(rejected, root)).some((item) => item.includes("source_status") && item.includes("accepted")));
  await writeFile(join(root, "art/hero.png"), Buffer.from("drift")); const corruptSourceErrors = await checkManifestFiles(manifest, root); assert(corruptSourceErrors.some((item) => item.includes("source_file") && item.includes("真实 PNG/JPEG")), corruptSourceErrors.join("\n"));
});

test("区域生产合同变化依业务规则校验，不依赖区域摘要", () => {
  const mutations = [
    ["production_method", "image-generation"],
    ["delivery_kind", "vector-image"],
    ["image_generation_required", true],
    ["generation_record_required", true],
    ["substitution_policy", "user-change-request-only"],
  ];
  for (const [field, value] of mutations) {
    const manifest = validManifest();
    manifest.coverage_audit.regions[1][field] = value;
    assert(!validateManifest(manifest).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), field);
  }
  const componentDrift = validManifest();
  componentDrift.coverage_audit.regions[1].component_inventory.component_count = 2;
  assert(!validateManifest(componentDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "component_inventory");
  const assetDrift = validManifest();
  assetDrift.coverage_audit.regions[1].expected_assets[0].asset_id = "hero-alt";
  assert(validateManifest(assetDrift).some((item) => item.includes("expected_assets")), "真实资源映射漂移仍按合同校验");
  const hotspotDrift = validManifest();
  hotspotDrift.coverage_audit.regions[1].interaction_hotspots = [{ hotspot_id: "hero-hit", component_id: "hero-component", bounds: { x: 0, y: 0, width: 10, height: 10 } }];
  assert(!validateManifest(hotspotDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "interaction_hotspots");
  const invalidMethod = validManifest(); invalidMethod.coverage_audit.regions[1].production_method = "";
  assert(validateManifest(invalidMethod).some((item) => item.includes("production_method")), "实际生产方式字段仍受业务合同校验");
});

test("状态分析必需文件路径保留，状态与目标摘要缺失或漂移不阻断", () => {
  const missing = validManifest();
  delete missing.coverage_audit.regions[1].state_analysis.evidence_sha256;
  assert(!validateManifest(missing).some((item) => item.includes("evidence_sha256")), "evidence_sha256");
  const targetDrift = validManifest();
  targetDrift.coverage_audit.regions[1].state_analysis.reference_target_sha256 = EMPTY_DOCUMENT_FINGERPRINT;
  assert(!validateManifest(targetDrift).some((item) => item.includes("reference_target_sha256")), "reference_target_sha256");
  const createdAtMissing = validManifest();
  delete createdAtMissing.coverage_audit.regions[1].component_inventory.created_at;
  assert(validateManifest(createdAtMissing).some((item) => item.includes("created_at")), "created_at");
});

test("--check-files 校验状态分析证据路径，但不阻断文件内容摘要漂移", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-state-analysis-files-"));
  const manifest = validManifest();
  await createFixtureFiles(root);
  await writeConfirmationFixtureFiles(root, manifest);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
  await writeFile(join(root, "evidence/coverage/state-analysis.md"), "changed");
  assert(!((await checkManifestFiles(manifest, root)).some((item) => item.includes("state_analysis.evidence_sha256"))));
  const missing = structuredClone(manifest); missing.coverage_audit.regions[1].state_analysis.evidence = "evidence/coverage/missing-state-analysis.md";
  assert((await checkManifestFiles(missing, root)).some((item) => item.includes("state_analysis.evidence 文件不存在")));
});

test("runtime_implementation 按生产方法校验，不依赖区域摘要", () => {
  const manifest = validManifest();
  const region = manifest.coverage_audit.regions[1];
  region.runtime_implementation = { kind: "authored-raster", integration_files: ["src/hero.mjs"] };
  assert(validateManifest(manifest).some((item) => item.includes("runtime_implementation")), "文件交付方法不得附带运行时实现");
  assert(!validateManifest(manifest).some((item) => item.includes("region_definition_sha256")));
  const errorsBefore = validateManifest(manifest).filter((item) => item.includes("runtime_implementation"));
  region.runtime_implementation.integration_files = ["src/hero-variant.mjs"];
  assert(validateManifest(manifest).filter((item) => item.includes("runtime_implementation")).length >= errorsBefore.length);
});

test("nested production_contract 与 camel stateAnalysis 纳入同一确认哈希并拒绝别名冲突", async () => {
  const nested = validManifest();
  const region = nested.coverage_audit.regions[1];
  const productionFields = ["production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "expected_assets"];
  region.production_contract = Object.fromEntries(productionFields.map((field) => [field, region[field]]));
  productionFields.forEach((field) => delete region[field]);
  region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region);
  assert.deepEqual(validateManifest(nested, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const methodDrift = structuredClone(nested);
  methodDrift.coverage_audit.regions[1].production_contract.production_method = "reuse";
  assert.notEqual(computeRegionDefinitionSha256(methodDrift.coverage_audit.regions[1]), region.confirmation.region_definition_sha256);
  assert(validateManifest(methodDrift).some((item) => item.includes("reuse-existing") || item.includes("production_method")), "nested production_method 与实现方式不一致仍失败");

  const camel = validManifest();
  const camelRegion = camel.coverage_audit.regions[1];
  camelRegion.stateAnalysis = camelRegion.state_analysis;
  delete camelRegion.state_analysis;
  camelRegion.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(camelRegion);
  assert.deepEqual(validateManifest(camel, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const evidenceDrift = structuredClone(camel);
  evidenceDrift.coverage_audit.regions[1].stateAnalysis.evidence = "evidence/coverage/changed-state-analysis.md";
  assert.notEqual(computeRegionDefinitionSha256(evidenceDrift.coverage_audit.regions[1]), camelRegion.confirmation.region_definition_sha256);
  assert(!validateManifest(evidenceDrift).some((item) => item.includes("region_definition_sha256")), "evidence 路径变更不因旧区域摘要阻断");
  const conflict = structuredClone(camel);
  conflict.coverage_audit.regions[1].state_analysis = structuredClone(conflict.coverage_audit.regions[1].stateAnalysis);
  conflict.coverage_audit.regions[1].state_analysis.evidence = "evidence/coverage/conflicting.md";
  assert(validateManifest(conflict).some((item) => item.includes("区域合同别名取值冲突") && item.includes("state_analysis")));
});

test("camel stateAnalysis 与 snake state_analysis 共用文件存在门，不比较摘要", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-camel-state-files-"));
  const manifest = validManifest();
  const region = manifest.coverage_audit.regions[1];
  region.stateAnalysis = region.state_analysis;
  delete region.state_analysis;
  region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region);
  await createFixtureFiles(root);
  await writeConfirmationFixtureFiles(root, manifest);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
  await writeFile(join(root, "evidence/coverage/state-analysis.md"), "camel-state-drift");
  const errors = await checkManifestFiles(manifest, root);
  assert(!errors.some((item) => item.includes("evidence_sha256")), errors.join("\n"));
  const missing = structuredClone(manifest);
  missing.coverage_audit.regions[1].stateAnalysis.evidence = "evidence/coverage/missing-state-analysis.md";
  missing.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(missing.coverage_audit.regions[1]);
  assert((await checkManifestFiles(missing, root)).some((item) => item.includes("state_analysis.evidence 文件不存在")), "camel stateAnalysis 缺失证据文件必须失败");
});

test("manifest runtime_outputs 按规范化大小写和 ./ 路径识别物理冲突", () => {
  const manifest = validManifest();
  manifest.assets.push({ ...structuredClone(manifest.assets[0]), id: "hero-copy", texture_key: "hero-copy", runtime_outputs: ["PUBLIC/SHARED.PNG"] });
  manifest.assets[0].runtime_outputs = ["public/shared.png"];
  const errors = validateManifest(manifest);
  assert(errors.some((item) => item.includes("runtime_outputs 路径重复") && item.includes("PUBLIC/SHARED.PNG")), errors.join("\n"));
  const dotted = structuredClone(manifest);
  dotted.assets[1].runtime_outputs = ["public/./shared.png"];
  assert(validateManifest(dotted).some((item) => item.includes("runtime_outputs 路径重复")), "./ 别名也必须冲突");
});

test("effect-image 布局节点必须与 coverage 双向绑定且禁止孤立、跨区和重复消费", () => {
  const missing = validManifest(); delete missing.coverage_audit.regions[1].layout_node_ids;
  assert(validateManifest(missing).some((item) => item.includes("layout_node_ids 必须是非空字符串列表")), "区域布局节点不能为空");
  const missingPlacement = validManifest(); delete missingPlacement.coverage_audit.regions[1].component_inventory.components[0].placements[0].layout_node_id;
  assert(validateManifest(missingPlacement).some((item) => item.includes("placement 缺少 layout_node_id") || item.includes("layout_node_id 必须是非空字符串")), "placement 布局节点不能为空");
  const duplicateRegionNode = validManifest(); duplicateRegionNode.coverage_audit.regions[1].layout_node_ids.push("hero-component-layout-node");
  assert(validateManifest(duplicateRegionNode).some((item) => item.includes("layout_node_ids 不得重复")), "区域布局节点不能重复");
  const orphan = validManifest(); orphan.scene_reconstruction_contract.layout_decomposition.layout_nodes.push({ ...structuredClone(orphan.scene_reconstruction_contract.layout_decomposition.layout_nodes[1]), layout_node_id: "orphan-layout-node" });
  assert(validateManifest(orphan).some((item) => item.includes("双向一一对应") || item.includes("未被 coverage region.layout_node_ids 反向声明")), "孤立布局节点必须失败");
  const crossRegion = validManifest(); crossRegion.coverage_audit.regions[1].component_inventory.components[0].placements[0].layout_node_id = "layout-score";
  assert(validateManifest(crossRegion).some((item) => item.includes("只能引用本 region")), "placement 不得跨区域引用布局节点");
  const runtimeCrossRegion = validManifest(); runtimeCrossRegion.coverage_audit.regions[0].runtime_implementation.layout_node_ids = ["hero-component-layout-node"];
  assert(validateManifest(runtimeCrossRegion).some((item) => item.includes("runtime_implementation.layout_node_ids 只能引用本 region")), "runtime 布局实现不得跨区域引用节点");
  const duplicateConsumer = validManifest(); duplicateConsumer.coverage_audit.regions[1].runtime_implementation = { kind: "runtime-program", integration_files: ["src/hero.mjs"], layout_node_ids: ["hero-component-layout-node"] };
  assert(validateManifest(duplicateConsumer).some((item) => item.includes("被重复消费")), "同一节点不得同时由 placement 和 runtime 消费");
});

test("布局拆解绑定 scene、state 和版本，不依赖冻结目标摘要", () => {
  const staleTarget = validManifest(); staleTarget.scene_reconstruction_contract.layout_decomposition.layout_binding.target_sha256 = { stale: true };
  assert(!validateManifest(staleTarget).some((item) => item.includes("target_sha256")), "目标摘要只作记录");
  for (const field of ["scene_id", "state_id", "layout_contract_version"]) {
    const manifest = validManifest(); manifest.scene_reconstruction_contract.layout_decomposition.layout_binding[field] = `drifted-${field}`; const errors = validateManifest(manifest);
    assert(errors.some((item) => item.includes("layout_decomposition") && item.includes("不一致")), `${field} 漂移必须失败`);
  }
});

test("V4 必须记录全部布局节点的逐节点几何差异和证据", () => {
  const missing = validManifest();
  delete missing.fidelity_cases[0].layout_node_results;
  assert(validateManifest(missing).some((item) => item.includes("layout_node_results 必须是非空逐节点几何差异数组")), "缺逐节点布局证据必须失败");
  const incomplete = validManifest(); incomplete.fidelity_cases[0].layout_node_results.pop();
  assert(validateManifest(incomplete).some((item) => item.includes("layout_node_results 缺少布局节点")), "漏布局节点必须失败");
  const forgedDelta = validManifest(); forgedDelta.fidelity_cases[0].layout_node_results[0].candidate_bounds.x += 1;
  assert(validateManifest(forgedDelta).some((item) => item.includes("delta 必须由 candidate_bounds 减 target_bounds")), "伪造布局 delta 必须失败");
});

test("V4资源清单校验实际组件快照，拒绝遗漏与Layout改写RAW尺寸", () => {
  const missing = validManifest();
  delete missing.scene_reconstruction_contract.combination_preacceptance.layout_geometry.component_snapshots;
  assert(validateManifest(missing, STRUCTURAL_FILE_GATE_OPTIONS).some((message) => message.includes("component_snapshots 必须是组件快照数组")));
  const changed = validManifest();
  const snapshots = changed.scene_reconstruction_contract.combination_preacceptance.layout_geometry.component_snapshots;
  const raw = snapshots.find((item) => item.component_snapshot.sprite?.size_mode === "RAW");
  assert(raw, "夹具必须包含普通 RAW 图片");
  raw.component_snapshot.parent_layout = { enabled: true, type: "HORIZONTAL", resize_mode: "CHILDREN", align_horizontal: false, align_vertical: false };
  assert(validateManifest(changed, STRUCTURAL_FILE_GATE_OPTIONS).some((message) => message.includes("普通 RAW 图片不得由父 Layout.CHILDREN")));
  raw.component_snapshot.parent_layout = null;
  raw.component_snapshot.ui_transform.width += 1;
  assert(validateManifest(changed, STRUCTURAL_FILE_GATE_OPTIONS).some((message) => message.includes("UITransform 尺寸必须保持 SpriteFrame 原始 contentSize")));
});


test("产品体积预算非必需且最新初始化模板不生成该字段", () => {
  const manifest = validManifest(); assert(!Object.hasOwn(manifest.budgets, "package_size_mb")); assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []); const template = JSON.parse(OPTIONAL_TEMPLATES.assets["visual-assets.json"]); assert.equal(template.schema_version, "1.5"); assert(!Object.hasOwn(template.budgets, "package_size_mb"));
});
