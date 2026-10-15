import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getVisualRegionDefinitionAliasConflicts } from "./effect_image_annotation_core.mjs";

/** 在真实清单入口验证默认可用性与显式精确模式，复用领域夹具避免维护两份合同。 */
export function registerVisualManifestUsabilityCases({ validManifest, validateManifest, options, checkManifestFiles, createFixtureFiles, writeConfirmationFixtureFiles }) {
  test("manifest 模式：有效精确清单通过", () => {
    assert.deepEqual(validateManifest(validManifest(), options), []);
  });

  test("manifest 模式：默认接受布局微调且不要求精确差异附件", () => {
    const manifest = validManifest();
    delete manifest.visual_validation;
    const fidelity = manifest.fidelity_cases[0];
    const hero = fidelity.layout_node_results.find((node) => node.layout_node_id === "hero-component-layout-node");
    hero.candidate_bounds.x += 8;
    hero.delta.x = 8;
    const region = fidelity.per_region_results.find((item) => item.region_id === "region-hero");
    region.candidate_measurement.bounds.x += 8;
    region.delta = 8;
    // 这些附件只服务精确像素比对；完整候选画面、确认与生产审计仍保留。
    for (const key of ["side_by_side_evidence", "overlay_evidence", "difference_evidence", "normalization_equivalence", "tolerance_set"]) delete fidelity[key];
    assert.deepEqual(validateManifest(manifest, { ...options, stage: "V4" }), []);
  });

  test("manifest 模式：显式 exact 拒绝超出已声明容差的相同微调", () => {
    const manifest = validManifest();
    const hero = manifest.fidelity_cases[0].layout_node_results.find((node) => node.layout_node_id === "hero-component-layout-node");
    hero.candidate_bounds.x += 8;
    hero.delta.x = 8;
    assert.ok(validateManifest(manifest, { ...options, stage: "V4" }).some((error) => /tolerance|容差/.test(error)));
  });

  test("V4 正式运行门缺少资源消费证据时失败", () => {
    const manifest = validManifest();
    delete manifest.visual_production_gate.runtime_consumption;
    assert(validateManifest(manifest).some((item) => item.includes("runtime_consumption")), "总门必须要求正式 runtime 消费证据");

    const missingAuditConsumption = validManifest();
    delete missingAuditConsumption.production_contract_audit.units[0].runtime_consumption;
    assert(validateManifest(missingAuditConsumption).some((item) => item.includes("runtime_consumption")), "V4 生产审计必须绑定逐区域 runtime 消费身份");
  });

  test("区域别名比较忽略不同或缺失摘要，但仍校验资源身份与共享事实", () => {
    const stateSnake = { status: "complete", phase: "review", evidence: "evidence/state.md", evidence_sha256: "sha256:old", reference_target_sha256: "sha256:target-old", analysis_id: "analysis-1", states: [] };
    const stateCamel = { status: "complete", phase: "review", evidence: "evidence/state.md", evidenceSha256: { stale: true }, referenceTargetSha256: 17, analysisId: "analysis-1", states: [] };
    assert.deepEqual(getVisualRegionDefinitionAliasConflicts({ state_analysis: stateSnake, stateAnalysis: stateCamel }), [], "状态分析摘要漂移不构成合同别名冲突");

    const assetSnake = { asset_id: "hero-idle", sha256: "sha256:old", share_id: "shared-asset" };
    const assetCamel = { asset_id: "hero-idle", file_sha256: null, share_id: "shared-asset" };
    assert.deepEqual(getVisualRegionDefinitionAliasConflicts({ expected_assets: [assetSnake], expectedAssets: [assetCamel] }), [], "缺失或不同的资产摘要不阻断");
    assert.deepEqual(getVisualRegionDefinitionAliasConflicts({ state_analysis: stateSnake, expected_assets: [assetSnake], production_contract: { stateAnalysis: stateCamel, expectedAssets: [assetCamel] } }), [], "同一区域的顶层与嵌套 camel 别名只在摘要上不同时仍一致");

    const changedAsset = { expected_assets: [assetSnake], expectedAssets: [{ ...assetCamel, asset_id: "hero-alt" }] };
    assert(getVisualRegionDefinitionAliasConflicts(changedAsset).some((conflict) => conflict.field === "expected_assets"), "asset_id 真实变化仍拒绝别名不一致");
    const changedShare = { expected_assets: [assetSnake], expectedAssets: [{ ...assetCamel, share_id: "other-share" }] };
    assert(getVisualRegionDefinitionAliasConflicts(changedShare).some((conflict) => conflict.field === "expected_assets"), "share_id 是共享语义，不能被摘要过滤误删");

    const runtime = { kind: "scene", integration_files: [], layout_node_ids: [], description: "", render_contract: { shadow: "enabled" } };
    assert(getVisualRegionDefinitionAliasConflicts({ runtime_implementation: runtime, runtimeImplementation: { ...runtime, render_contract: { shadow: "disabled" } } }).some((conflict) => conflict.field === "runtime_implementation"), "shadow 是实际合同事实，仍参与别名比较");
  });

  test("区域摘要漂移不阻断，布局节点仍需通过实际 proposal 对照", async () => {
    const manifest = validManifest();
    const root = await mkdtemp(join(tmpdir(), "visual-layout-node-facts-"));
    await createFixtureFiles(root);
    await writeConfirmationFixtureFiles(root, manifest);
    const region = manifest.coverage_audit.regions[1];
    region.confirmation.region_definition_sha256 = { stale: true };
    assert(!validateManifest(manifest).some((item) => item.includes("region_definition_sha256")));
    region.layout_node_ids = ["hero-component-layout-node-v2"];
    const errors = await checkManifestFiles(manifest, root);
    assert(errors.some((item) => item.includes("technical_definition 与当前区域不一致") || item.includes("layout_node_ids")), errors.join("\n"));
  });
}
