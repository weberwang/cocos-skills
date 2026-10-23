import { deriveLayoutExecutionPlans } from "../../cocos-game-ui-layout/scripts/widget-layout.mjs";
import { attachLayoutRuntimeSnapshots } from "../../cocos-game-ui-layout/scripts/widget-runtime-test-fixtures.mjs";
import { deriveSpriteGeometry } from "../../cocos-game-ui-layout/scripts/sprite-layout-sizing.mjs";
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

const EMPTY_DOCUMENT_FINGERPRINT = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const STRUCTURAL_FILE_GATE_OPTIONS = { checkFiles: true, projectRoot: "fixture-project" };
/** 为测试清单构造完整的“状态先行、单部件单图”合同。 */
function visualComponentContract(componentId, assetId, sourceFile = assetId === "hero-idle" ? "art/hero.png" : `art/${assetId}.png`, runtimeFile = assetId === "hero-idle" ? "public/assets/hero.png" : `public/assets/${assetId}.png`, referenceTargetSha = EMPTY_DOCUMENT_FINGERPRINT) {
  const regionBounds = assetId === "hero-idle" ? { x: 10, y: 20, width: 64, height: 96 } : { x: 0, y: 0, width: 64, height: 64 };
  const states = [
    { state_id: "default", requirement: "required", reason: "普通可见状态" },
    ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前夹具区域没有该状态" })),
  ];
  const component = { component_id: componentId, atomic_visual_key: `${componentId}-atomic`, role: "visual-component", reusable: true, state_coverage: states, placements: [{ placement_id: `${componentId}-placement-1`, layout_node_id: `${componentId}-layout-node`, bounds: regionBounds, interaction_required: false }] };
  const contract = {
    state_analysis: {
      status: "complete", phase: "before-component-splitting", evidence: "evidence/coverage/state-analysis.md", evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, reference_target_sha256: referenceTargetSha, analysis_id: "analysis-hero-1", completed_at: "2026-08-15T00:00:00Z",
      states,
    },
    component_inventory: { granularity: "single-component", component_count: 1, visible_instance_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [component] },
    expected_assets: [{ asset_id: assetId, asset_scope: "atomic-component", atomic_visual_key: component.atomic_visual_key, component_id: componentId, state_id: "default", source_file: sourceFile, runtime_file: runtimeFile, width: regionBounds.width, height: regionBounds.height }],
    interaction_hotspots: [],
  };
  contract.atomic_image_requirements = deriveAtomicImageRequirements({ id: "region-hero", annotation_number: 2, production_method: "authored-raster", delivery_kind: "raster-image", ...contract });
  return contract;
}

/** 为每个 scene/state 组构造独立 accepted/manual 确认合同，保留组内全部编号身份。 */
function addManualConfirmationRecords(manifest) {
  const target = manifest.reference_target.target_sha256; const candidate = manifest.candidate_identity.sha256;
  const groups = new Map();
  for (const region of manifest.coverage_audit.regions) {
    const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list);
  }
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
  for (const [key, regions] of groups) {
    const [sceneId, stateId] = key.split("\0");
    const suffix = `${safe(sceneId)}-${safe(stateId)}`;
    const shared = { proposal_id: `decomposition-proposal-${suffix}`, proposal_file: `evidence/coverage/${suffix}-proposal.json`, annotation_file: `evidence/coverage/${suffix}-annotation.png`, annotation_mime: "image/png", decision_record_file: `evidence/coverage/${suffix}-decision.json`, user_decision_receipt_file: `.workflow-control/user-resolutions/${suffix}-receipt.json` };
    const confirmationId = `confirmation-${suffix}`;
  for (const region of regions) {
    const components = Array.isArray(region.component_inventory?.components) ? region.component_inventory.components : []; region.decomposition_elements = (region.layout_node_ids ?? []).map((layoutNodeId) => { const component = components.find((item) => item?.placements?.some((placement) => placement?.layout_node_id === layoutNodeId)); const placement = component?.placements?.find((item) => item?.layout_node_id === layoutNodeId); return { element_id: layoutNodeId, element_type: "component", role: component?.role ?? region.owner_type ?? "component", bounds: { ...region.bounds }, scene_id: region.scene_id, state_id: region.state_id, region_id: region.id, component_id: component?.component_id ?? `${region.id}-component`, placement_id: placement?.placement_id ?? `${layoutNodeId}-placement`, parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "测试夹具中的完整视觉元素独立布局" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: region.layer === "background" ? "STRETCH" : "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: region.layer === "background" ? "FULL_BLEED" : "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: false }; });
    const states = [...new Set([region.state_id, ...(Array.isArray(region.state_analysis?.states) ? region.state_analysis.states.map((state) => state.state_id) : [])])].filter(nonEmptyString).sort();
    const requirements = deriveAtomicImageRequirements(region); const assetIds = (Array.isArray(region.asset_ids) ? region.asset_ids : [region.asset_id]).filter(nonEmptyString).sort();
    const text = `确认 ${sceneId}/${stateId} 效果图拆解、生产标签与全部编号定义。`;
    region.confirmation = {
      confirmation_schema: "visual-decomposition-confirmation/1.0", confirmation_id: confirmationId, confirmation_sha256: EMPTY_DOCUMENT_FINGERPRINT, status: "accepted", confirmation_mode: "manual", ...shared, proposal_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_record_sha256: EMPTY_DOCUMENT_FINGERPRINT, user_decision_receipt_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_width: 0, annotation_height: 0, annotation_schema: "effect-image-annotation/png/1", annotation_layout: "image-plus-right-panel", annotation_metadata_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_identity_sha256: EMPTY_DOCUMENT_FINGERPRINT,
      target_sha256: target, scene_id: region.scene_id, state_id: region.state_id, annotation_number: region.annotation_number, region_id: region.id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: region.production_origin ?? null, production_method: region.production_method ?? "", delivery_kind: region.delivery_kind ?? "", production_label: region.implementation_plan.mode === "reuse-existing" ? "复用现有图片" : region.implementation_plan.mode === "runtime-program" ? "程序绘制或动态逻辑" : "新建图片资产", component_ids: components.map((component) => component.component_id).sort(), state_ids: states, asset_requirement_ids: requirements.map((item) => item.requirement_id).sort(), asset_ids: assetIds, user_original_text: text, user_message_sha256: sha256Bytes(Buffer.from(text)), accepted_at: "2026-08-15T00:20:00Z", work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: candidate,
    };
  }
  }
}

/** 判断测试夹具字符串字段是否非空。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 为 AI 位图夹具生成与原始中间图、最终运行时文件和尺寸合同一致的记录。 */
function imageNormalizationRecord({ sourceFile, outputFile, width, height, alpha, sha256 }) {
  return {
    schema: "image-normalization/1",
    status: "passed",
    operation: "not-required",
    source_file: sourceFile,
    source_sha256: sha256,
    source_width: width,
    source_height: height,
    target_width: width,
    target_height: height,
    output_file: outputFile,
    output_sha256: sha256,
    output_width: width,
    output_height: height,
    preserve_alpha: alpha === true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-15T00:00:00Z",
  };
}

/** 构造包含一个已验收资源的有效清单。 */
function validManifest() {
  const targetSha = sha256Bytes(minimalPng(390, 844));
  const candidateSha = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  const heroPngSha = sha256Bytes(minimalPng(64, 96));
  const manifest = {
    schema_version: "1.5",
    visual_validation: { mode: "exact" },
    visual_contract_version: "1.0",
    visualStage: "V4",
    visualStageState: "v4-runtime-integration-candidate",
    workItemId: "work-item-1",
    candidateVersion: "candidate-1",
    baseline_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    effect_image_reconstruction: { applicability: "effect-image", lifecycle: "v4-complete" },
    visual_baseline: { id: "fox-world", version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, document: "docs/visual-baseline.md", status: "global-static-baseline-frozen", anchor_evidence: [{ path: "evidence/visual/main-anchor.png", sha256: EMPTY_DOCUMENT_FINGERPRINT }] },
    reference_target: { candidate_id: "mockup-a", original_file: "evidence/visual/mockup.png", target_sha256: targetSha, frozen_at: "2026-08-15T00:00:00Z", status: "reference-target-frozen", scene_ids: ["main-gameplay"], state_ids: ["default"], origin: "provided" },
    candidate_identity: { kind: "git", sha256: candidateSha, diff_fingerprint: "diff-1" },
    contract_reconciliation: {
      decision_id: "reconcile-1", reconciled_at: "2026-08-15T00:10:00Z", target_sha256: targetSha, candidate_sha256: candidateSha, status: "passed", rollback: "V1/module-audit",
      bindings: { gdd: "docs/GDD.md#v1", tdd: "docs/TDD.md#v1", gameplay_visual_contract: "visual-contract:v1", gameplay_function_contract: "function-contract:v1", layout_contract: "layout:v1", module_scene_ownership: "ownership:v1", budget_baseline: "budget:v1" },
      checks: ["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"].map((domain) => ({ domain, status: "passed", evidence: `evidence/reconcile/${domain}.md` })),
    },
  coverage_audit: { version: "1", reference_target_sha256: targetSha, canvases: [{ scene_id: "main-gameplay", state_id: "default", width: 390, height: 844 }], summaries: [{ scene_id: "main-gameplay", state_id: "default", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/summary.md" }], regions: [{ id: "region-background", scene_id: "main-gameplay", state_id: "default", layout_node_ids: ["layout-background"], layer: "background", bounds: { x: 0, y: 0, width: 390, height: 844 }, owner_type: "runtime-rendered", owner_id: "scene-background", production_method: "runtime-program", delivery_kind: "runtime-program", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-background.md" } }, { id: "region-hero", scene_id: "main-gameplay", state_id: "default", layout_node_ids: ["hero-component-layout-node"], layer: "actors", bounds: { x: 10, y: 20, width: 64, height: 96 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", ...visualComponentContract("hero-component", "hero-idle", "art/hero.png", "public/assets/hero.png", targetSha), owner_id: "asset-pipeline", asset_id: "hero-idle", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-hero.md" } }, { id: "region-score", scene_id: "main-gameplay", state_id: "default", layout_node_ids: ["layout-score"], layer: "hud", bounds: { x: 300, y: 10, width: 70, height: 30 }, owner_type: "runtime-data", owner_id: "score-state", production_method: "runtime-program", delivery_kind: "runtime-program", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-score.md" } }] },
    fidelity_cases: [{ id: "main-default", target_sha256: targetSha, candidate_sha256: candidateSha, scene_id: "main-gameplay", state_id: "default", viewport: { width: 390, height: 844 }, dpr: 2, language: "zh-CN", random_seed: 42, input_trace: "traces/main-default.json", animation_sample: "stable-frame:120", layout_contract_version: "1.1.0", visual_baseline_version: "1.0.0", reference_evidence: ["evidence/visual/reference.png"], candidate_evidence: ["evidence/visual/candidate.png"], tolerance: { unit: "logical-px", value: 2 }, exception_ids: [], conclusion: "passed" }],
    budgets: { max_texture_size: 4096, texture_memory_mb: 64, max_atlases: 8, max_frames: 512, animation_sample_fps: 24, max_overdraw: 3, max_draw_calls: 100 },
    assets: [{ id: "hero-idle", texture_key: "hero-idle", origin: "provided", ownership_type: "fixed-production-visual", coverage_region_ids: ["region-hero"], scene_id: "main-gameplay", route: "pixel-art", status: "accepted", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", ...visualComponentContract("hero-component", "hero-idle", "art/hero.png", "public/assets/hero.png", targetSha), visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, source_file: "art/hero.png", license_record: "docs/license.md", runtime_outputs: ["public/assets/hero.png"], sha256: heroPngSha, cocos_evidence: "evidence/cocos.png", gameplay_visual_evidence: "evidence/gameplay.mp4", consistency_evidence: ["evidence/visual/hero-consistency.png"] }],
  };
  const evidenceIdentity = { evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, candidate_sha256: candidateSha, target_sha256: targetSha, baseline_sha256: EMPTY_DOCUMENT_FINGERPRINT, diff_fingerprint: "diff-1" };
  const componentUsage = [{ component_id: "hero-component", state_id: "default", asset_id: "hero-idle", placement_ids: ["hero-component-placement-1"], runtime_file: "public/assets/hero.png", runtime_sha256: heroPngSha, status: "passed" }];
  manifest.assets[0].runtime_consumption = { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage };
  const heroRegion = manifest.coverage_audit.regions[1];
  const heroExpected = heroRegion.expected_assets[0];
  manifest.production_contract_audit = { status: "passed", candidate_version: manifest.candidateVersion, target_sha256: targetSha, audited_at: "2026-08-15T00:30:00Z", units: [{ annotation_number: 2, region_id: "region-hero", observed_method: "authored-raster", observed_delivery_kind: "raster-image", status: "passed", expected_assets: [{ ...heroExpected }], atomic_image_requirements: heroRegion.atomic_image_requirements, actual_assets: [{ asset_id: "hero-idle", file: "public/assets/hero.png", component_id: "hero-component", state_id: "default", asset_scope: "atomic-component", atomic_visual_key: heroExpected.atomic_visual_key, mime_type: "image/png", width: 64, height: 96, alpha: true, sha256: heroPngSha }], runtime_consumption: { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage } }] };
  // V2 人工确认后，F2 只记录可重算的机器验证事实，不再嵌套任何 reviewer 或二次复核工件。
  manifest.visual_production_gate = { status: "passed", v2_status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", evidence: "evidence/f2/machine.json", baselineHash: EMPTY_DOCUMENT_FINGERPRINT, diffFingerprint: "diff-1" }, f3_status: "passed", runtime_replay: { status: "passed", evidence: "evidence/f3/replay.json", ...evidenceIdentity }, fidelity_cases: [{ candidate_sha256: candidateSha, created_at: "2026-08-15T00:31:00Z", freshness_bound: true, evidence: "evidence/fidelity/main.json", ...evidenceIdentity }], candidate_sha256: candidateSha, target_sha256: targetSha, runtime_consumption: { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage }, unapproved_substitution: false };
  manifest.coverage_audit.regions.forEach((region, index) => { region.annotation_number = index + 1; region.ownership_evidence = `evidence/coverage/${region.id}.md`; region.implementation_plan = region.owner_type === "fixed-production-visual" ? { mode: "generate-now", summary: `生成区域 ${region.id}` } : { mode: "runtime-program", summary: `程序实现区域 ${region.id}` }; if (region.owner_type !== "fixed-production-visual") region.runtime_implementation = { kind: "runtime-program", integration_files: [`src/${region.id}.mjs`], layout_node_ids: region.layout_node_ids }; });
  addManualConfirmationRecords(manifest);
  manifest.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(manifest.coverage_audit.regions[1]);
  attachSceneReconstructionContract(manifest);
  return manifest;
}

/** 为旧有基础夹具补齐新版场景合同，保证所有 effect-image 回归都走同一套强制门。 */
function attachSceneReconstructionContract(manifest) {
  const targetSha = manifest.reference_target.target_sha256;
  const candidateSha = manifest.candidate_identity.sha256;
  // 夹具同时覆盖静态原生框体和动态数据，并绑定布局身份，避免路线门再次以静态为由强制产图。
  const layoutContractSha = `sha256:${"3".repeat(64)}`;
  const layoutDecompositionVersion = "1.0.0";
  const regionFacts = manifest.coverage_audit.regions.map((region) => {
    const runtimeOwner = region.owner_type === "fixed-production-visual" ? region.owner_type : region.owner_type;
    const implementationMode = runtimeOwner === "fixed-production-visual" ? region.implementation_plan.mode : "runtime-program";
    const visualRouteAnalysis = runtimeOwner === "fixed-production-visual"
      ? {
        element_type: "sprite",
        visual_complexity: "distinctive",
        distinctive_visual: true,
        observed_features: ["原子位图外观", "冻结构图边界"],
        asset_first_decision: "asset-first",
        selected_route: "image-asset",
        route_reason: "固定美术区域由原子图片资产承载，Scene 只负责组合和运行时邻接关系",
        dynamic_requirements: { is_dynamic: false, description: "固定主角视觉" },
        native_suitability: { eligible: false, primitive_basis: ["not-applicable"], evidence: ["evidence/route/hero-native-not-applicable.json"] },
        reuse_suitability: { eligible: false, exact_asset_identity: "not-applicable", evidence: ["evidence/route/hero-reuse-not-applicable.json"] },
        final_owner: "fixed-production-visual",
        implementation_plan_mode: implementationMode,
        production_method: region.production_method,
        delivery_kind: region.delivery_kind,
      }
      : {
        element_type: region.id === "region-background" ? "panel-frame" : "dynamic-data",
        visual_complexity: "simple", distinctive_visual: false,
        observed_features: region.id === "region-background" ? ["纯色矩形和规则边框"] : ["运行时数据/绘制", "目标布局边界"],
        asset_first_decision: "native-allowed",
        selected_route: "cocos-native",
        route_reason: "运行时区域由 Cocos 对象或程序绘制承担，不生产固定图片资产",
        dynamic_requirements: { is_dynamic: region.id !== "region-background", description: region.id === "region-background" ? "固定纯色框体" : "运行时内容可能变化" },
        native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: region.id === "region-background" ? ["pure-color", "basic-geometry", "regular-line"] : ["dynamic-data"], evidence: [`evidence/route/${region.id}-native.json`] },
        reuse_suitability: { eligible: false, exact_asset_identity: "not-applicable", evidence: [`evidence/route/${region.id}-reuse-not-applicable.json`] },
        final_owner: runtimeOwner,
        implementation_plan_mode: "runtime-program",
        production_method: "runtime-program", delivery_kind: "runtime-program",
      };
    if (runtimeOwner.startsWith("runtime")) { region.runtime_implementation.render_contract = visualRouteAnalysis.native_suitability.render_contract; region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region); }
    return {
      annotation_number: region.annotation_number,
      region_id: region.id,
      scene_id: region.scene_id,
      state_id: region.state_id,
      layout_node_ids: [...(region.layout_node_ids ?? [])],
      target_bounds: { ...region.bounds },
      coordinate_space: "viewport",
      anchor_reference: "main-gameplay.viewport",
      relative_alignment: { horizontal: "target-bound", vertical: "target-bound" },
      z_order: region.layer,
      target_visibility: "visible",
      size_strategy: { width: "target-bound", height: "target-bound", aspect: "preserve" },
      spacing: { surrounding: "declared-by-composition", whitespace: "declared" },
      tolerance_reference: "layout-tolerance",
      typography_facts: { family: "project-font", ownership: "scene-contract" },
      color_facts: { family: "visual-baseline-bound", contrast: "declared" },
      material_texture_facts: { family: "visual-baseline-bound", surface: "declared" },
      lighting_shadow_facts: { treatment: "visual-baseline-bound" },
      decorative_density_facts: { density: "visual-baseline-bound" },
      clipping_cropping_facts: { clipping: "declared", cropping: "forbid" },
      responsive_behavior: { target: "exact", other: "preserve-relative-anchors" },
      implementation_owner: runtimeOwner,
      implementation_plan: region.implementation_plan,
      assembly_analysis: { strategy: "atomic-scene-composition", uses_full_screen_capture: false, allows_atomic_image_assets: true, evidence: [`evidence/route/${region.id}-assembly.json`] },
      visual_route_analysis: visualRouteAnalysis, ...(runtimeOwner.startsWith("runtime") ? { native_runtime_evidence: nativeRuntimeEvidence(visualRouteAnalysis, { candidate: candidateSha, target: targetSha, baseline: manifest.visual_baseline.style_fingerprint, diff: "diff-1" }) } : {}),
      applicable_states: [region.state_id],
      evidence: [region.ownership_evidence],
      tolerance_reference: "layout-tolerance",
      approved_exception_ids: [],
      ...(runtimeOwner !== "fixed-production-visual" ? { fidelity_obligations: { geometry: "target-bound", typography: "target-bound", color: "target-bound", material: "target-bound" } } : {}),
      visual_category: runtimeOwner === "fixed-production-visual" ? (region.component_inventory?.components?.[0]?.role ?? "fixed visual component") : runtimeOwner,
      graphic_semantics: runtimeOwner === "fixed-production-visual" ? (region.component_inventory?.components?.[0]?.atomic_visual_key ?? region.id) : region.id,
      contour_structure: { bounds: { ...region.bounds }, layer: region.layer },
      orientation_perspective: "target-bound orientation and perspective",
      excluded_objects: "同屏其他对象、背景和运行时文字不烘焙进该资产",
      runtime_ownership: "文字、数值、热区和状态由正式 Scene 运行时持有",
      ...(runtimeOwner === "fixed-production-visual" ? { production_method: region.production_method, image_generation_required: region.image_generation_required === true } : {}),
      ...(runtimeOwner === "fixed-production-visual" ? {
        scene_asset_usage: {
          target_display_size: { width: region.bounds.width, height: region.bounds.height },
          intended_scale_range: { min: 1, max: 1 },
          max_dpr: IMAGE_PRODUCTION_DPR,
          padding_policy: "none",
          origin: { x: 0.5, y: 0.5 },
          anchor: "target-bound",
          nine_slice: { policy: "forbid-unless-declared" },
          material: { family: "visual-baseline-bound" },
          composition_region: region.id,
          required_neighbors: [],
          typography_ownership: "scene-contract",
          runtime_foreground_ownership: "formal-scene",
        },
      } : {}),
    };
  });
  const layoutNodes = deriveLayoutExecutionPlans(manifest.coverage_audit.regions.map((region, index) => {
    const bounds = { ...region.bounds }; const parentBounds = { x: 0, y: 0, width: 390, height: 844 }; const left = bounds.x - parentBounds.x; const right = parentBounds.x + parentBounds.width - bounds.x - bounds.width; const top = bounds.y - parentBounds.y; const bottom = parentBounds.y + parentBounds.height - bounds.y - bounds.height;
    /* 测试夹具用预设枚举模拟智能视觉判断，不能通过四边距离反推对齐方向。 */ const horizontal = ["left", "center", "right"][index % 3]; const vertical = ["top", "center", "bottom"][index % 3]; const centerX = bounds.x + bounds.width / 2 - parentBounds.width / 2; const centerY = bounds.y + bounds.height / 2 - parentBounds.height / 2;
    // 资源覆盖夹具刻意保留非对称区域位置，中心参照偏移必须显式声明理由。
    const centerAlignment = { ...(horizontal === "center" ? { horizontal: { mode: "reference", offset: centerX, reason: "此区域按独立内容构图保留中心参照偏移" } } : {}), ...(vertical === "center" ? { vertical: { mode: "reference", offset: centerY, reason: "此区域按独立内容构图保留中心参照偏移" } } : {}) };
    const element = buildDecompositionElements([region])[0]; const spriteGeometry = deriveSpriteGeometry(element, bounds);
    const component = region.component_inventory?.components?.[0]; const placement = component?.placements?.[0]; return { layout_role: element.role, owner_type: element.owner_type, region_layer: element.region_layer, ...(element.visual_route_element_type ? { visual_route_element_type: element.visual_route_element_type } : {}), ...(spriteGeometry ? { sprite_geometry: spriteGeometry } : {}), layout_node_id: region.layout_node_ids[0], element_id: region.layout_node_ids[0], element_type: "component", region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, component_id: component?.component_id ?? `${region.id}-component`, placement_id: placement?.placement_id ?? `${region.layout_node_ids[0]}-placement`, parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "测试夹具中的完整视觉元素独立布局" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: region.layer === "background" ? "STRETCH" : "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: region.layer === "background" ? "FULL_BLEED" : "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: false, coordinate_space: "viewport", reference_id: "viewport", parent_layout_node_id: "viewport", parent_target_bounds: parentBounds, relative_position: { left, right, top, bottom }, axis_alignment: { horizontal, vertical }, ...(Object.keys(centerAlignment).length ? { center_alignment: centerAlignment } : {}), self_anchor: `${vertical}-${horizontal}`, reference_anchor: `${vertical}-${horizontal}`, offset: { x: horizontal === "left" ? left : horizontal === "right" ? -right : centerX, y: vertical === "top" ? top : vertical === "bottom" ? -bottom : centerY }, target_bounds: bounds, size_policy: { mode: "target-bound" }, z_order: index, clip_policy: "none", responsive_rule: "preserve-relative-anchors", planned_test_id: `layout-${region.id}` };
  }));
  const layoutGeometry = {
    component_snapshots: attachLayoutRuntimeSnapshots(layoutNodes, layoutNodes.map((node) => ({ layout_node_id: node.layout_node_id }))),
    formal_layout_structure: "MainGameplayScene/ContainerGraph",
    result: "passed",
    node_measurements: layoutNodes.map((node) => ({ layout_node_id: node.layout_node_id, target_bounds: { ...node.target_bounds }, actual_bounds: { ...node.target_bounds }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: [`evidence/fidelity/${node.layout_node_id}.json`] })),
  };
  manifest.scene_reconstruction_contract = {
    contract_version: "1.0",
    reference_technical_conflicts: [],
    decomposition_annotation: { file: "evidence/v2/decomposition-annotation.png", sha256: EMPTY_DOCUMENT_FINGERPRINT },
    technical_decomposition: { file: "evidence/v2/technical-decomposition.json", sha256: EMPTY_DOCUMENT_FINGERPRINT },
    text_decomposition: { applicability: "not-applicable", reason: "当前测试目标不包含需要独立还原的文本节点" },
    visual_decomposition_confirmation: { confirmation_id: "v2-confirmation", confirmation_sha256: EMPTY_DOCUMENT_FINGERPRINT, confirmation_mode: "manual", status: "passed", proposal_id: "v2-proposal", proposal_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_file: "evidence/v2/decomposition-annotation.png", annotation_sha256: EMPTY_DOCUMENT_FINGERPRINT, target_sha256: targetSha, candidate_identity: { sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint } },
    visual_production_contract: { contract_id: "visual-production-contract-1" },
    visual_production_units: [{ unit_id: "region-hero", region_id: "region-hero", owner: "fixed-production-visual" }],
    coverage_audit: { regions: manifest.coverage_audit.regions.map((region) => ({ id: region.id })) },
    target_conditions: {
      target_sha256: targetSha,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main-gameplay",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 2,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main-default.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: manifest.visual_baseline.version,
      layout_contract_version: "1.1.0",
      layout_contract_sha256: layoutContractSha,
      layout_decomposition_version: layoutDecompositionVersion,
    },
    coverage_regions: regionFacts,
    layout_decomposition: { layout_binding: { target_sha256: targetSha, scene_id: "main-gameplay", state_id: "default", visual_baseline_version: manifest.visual_baseline.version, viewport: { width: 390, height: 844 }, layout_contract_version: "1.1.0", layout_contract_sha256: layoutContractSha, layout_decomposition_version: layoutDecompositionVersion }, layout_nodes: layoutNodes, layout_annotation: { layout_annotation_file: "evidence/v2/layout-annotation.png", layout_annotation_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_annotation_identity_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_review_file: "evidence/v2/layout-review.html", layout_review_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_review_identity_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_nodes_file: "evidence/v2/layout-nodes.json", layout_nodes_sha256: EMPTY_DOCUMENT_FINGERPRINT, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: EMPTY_DOCUMENT_FINGERPRINT, proposal_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_decision_id: "layout-decision-1", target_sha256: targetSha, scene_id: "main-gameplay", state_id: "default", layout_node_ids: layoutNodes.map((node) => node.layout_node_id) }, layout_annotation_confirmation: (() => { const record = { confirmation_schema: "layout-annotation-confirmation/1.0", confirmation_id: "v2-layout-confirmation", status: "accepted", confirmation_mode: "manual", layout_annotation_file: "evidence/v2/layout-annotation.png", layout_annotation_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_annotation_identity_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_review_file: "evidence/v2/layout-review.html", layout_review_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_review_identity_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_nodes_file: "evidence/v2/layout-nodes.json", layout_nodes_sha256: EMPTY_DOCUMENT_FINGERPRINT, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: EMPTY_DOCUMENT_FINGERPRINT, proposal_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: EMPTY_DOCUMENT_FINGERPRINT, layout_decision_id: "layout-decision-1", target_sha256: targetSha, scene_id: "main-gameplay", state_id: "default", user_original_text: "确认布局标注", user_message_sha256: computeLayoutUserMessageSha256("确认布局标注"), decision_record_file: "evidence/v2/layout-decision.json", decision_record_sha256: EMPTY_DOCUMENT_FINGERPRINT, user_decision_receipt_file: "evidence/v2/layout-receipt.json", user_decision_receipt_sha256: EMPTY_DOCUMENT_FINGERPRINT, accepted_at: "2026-01-01T00:00:00Z" }; return { ...record, confirmation_sha256: computeLayoutAnnotationConfirmationSha256(record) }; })() },
    composition: {
      vertical_order: ["region-background", "region-hero", "region-score"],
      inter_region_spacing: { declared: true },
      relative_sizes: { declared: true },
      visual_center_of_gravity: { x: 195, y: 422 },
      whitespace: { declared: true },
      alignments: [{ from: "region-hero", to: "region-score", axis: "viewport", relation: "target-bound" }],
      visual_hierarchy: ["background", "actors", "hud"],
      background_focus_foreground_occlusion: { focus: "region-hero", foreground: ["region-score"] },
    },
    responsive_contract: {
      target_viewport: { width: 390, height: 844 },
      other_viewports: [{ width: 393, height: 852, expected: "preserve-relative-anchors" }],
      relationship_invariants: ["scene order remains stable", "target-bound anchors remain stable"],
      layout_contract_binding: { target_sha256: targetSha, scene_id: "main-gameplay", state_id: "default", visual_baseline_version: manifest.visual_baseline.version, viewport: { width: 390, height: 844 }, layout_contract_version: "1.1.0", layout_contract_sha256: layoutContractSha, layout_decomposition_version: layoutDecompositionVersion, reconstruction_contract_version: "1.0" },
    },
    predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { unit: "logical-px", value: 2 } } }],
    implementation_plan: { resources: ["hero-idle"], layout: ["target-bound-layout"], runtime_objects: ["scene-background", "score-state"], composition: ["main-gameplay-scene"] },
    display_layer_planning: {
      version: "1.0",
      scene_master: { scene_id: "main-gameplay", state_id: "default", target_sha256: targetSha, origin: "provided", viewport: { width: 390, height: 844 }, persistent_layer_ids: ["score-hud"] },
      inventory: [{ layer_id: "score-hud", type: "hud", host_scene_id: "main-gameplay", target_sha256: targetSha, persistence: "persistent", states: [{ state_id: "default", required: true }], in_scene_master: true, trigger: { event: "scene-ready" }, dismiss: { event: "scene-exit" }, input_blocking: false, z_order: 10, backdrop: { mode: "none" }, focus_restore: { mode: "preserve" }, responsive: { rule: "safe-area" }, relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: [] } }],
    },
    combination_preacceptance: { status: "passed", formal_scene_structure: "MainGameplayScene/ContainerGraph", formal_assets: manifest.assets.map((asset) => asset.id), formal_layout_structure: "MainGameplayScene/ContainerGraph", layout_geometry: layoutGeometry, visual_fidelity: { contour: "passed", proportion: "passed", pose: "passed", icon_semantics: "passed", full_scene_composition: "passed" }, redesign_check: "none", layout_calculation_identity: "layout:main-gameplay:1", evidence: ["evidence/visual/combined.png"], target_sha256: targetSha, candidate_sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
  };
  const fidelity = manifest.fidelity_cases[0];
  Object.assign(fidelity, {
    target_identity: { sha256: targetSha },
    candidate_identity: { sha256: manifest.candidate_identity.sha256, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
    original_target_size: { width: 390, height: 844 },
    original_candidate_size: { width: 390, height: 844 },
    normalization_transform: { type: "identity", scale_x: 1, scale_y: 1 },
    normalization_equivalence: {
      viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true },
      dpr: { target: 2, candidate: 2, equivalent: true },
      logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true },
    },
    normalized_comparison_canvas: { width: 390, height: 844 },
    full_viewport_reference: "evidence/visual/reference.png",
    full_viewport_candidate: "evidence/visual/candidate.png",
    side_by_side_evidence: "evidence/fidelity/side-by-side.png",
    overlay_evidence: "evidence/fidelity/overlay.png",
    difference_evidence: "evidence/fidelity/diff.png",
    tolerance_set: { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } },
    per_region_results: manifest.coverage_audit.regions.map((region) => ({ region_id: region.id, target_measurement: { bounds: { ...region.bounds } }, candidate_measurement: { bounds: { ...region.bounds } }, delta: 0, tolerance_reference: "layout-tolerance", tolerance: { id: "layout-tolerance", value: 2 }, result: "passed", evidence: [`evidence/fidelity/${region.id}.json`], exception_ids: [] })),
    layout_node_results: layoutNodes.map((node) => ({ layout_node_id: node.layout_node_id, target_bounds: { ...node.target_bounds }, candidate_bounds: { ...node.target_bounds }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: [`evidence/fidelity/${node.layout_node_id}.json`] })),
  });
  return manifest;
}

/** 构造不启用效果图还原的普通资源清单。 */
function validOrdinaryManifest() {
  const manifest = validManifest(); manifest.effect_image_reconstruction = { applicability: "not-applicable", lifecycle: "not-applicable" };
  for (const field of ["reference_target", "candidate_identity", "contract_reconciliation", "coverage_audit", "fidelity_cases"]) delete manifest[field];
  delete manifest.assets[0].ownership_type; delete manifest.assets[0].coverage_region_ids;
  return manifest;
}

/** 构造包含完整生成包的 AI 合成栅格清单。 */
function validAiManifest() {
  const manifest = validManifest(); const asset = manifest.assets[0]; const region = manifest.coverage_audit.regions[1]; const width = 64; const height = 96; region.expected_assets[0].width = width; region.expected_assets[0].height = height; asset.expected_assets[0].width = width; asset.expected_assets[0].height = height; manifest.production_contract_audit.units[0].expected_assets[0].width = width; manifest.production_contract_audit.units[0].expected_assets[0].height = height; manifest.production_contract_audit.units[0].actual_assets[0].width = width; manifest.production_contract_audit.units[0].actual_assets[0].height = height; asset.route = "ai-composite-raster"; asset.production_method = "image-generation"; asset.delivery_kind = "raster-image"; asset.image_generation_required = true; asset.generation_record_required = true; asset.source_file = "art/hero-cutout.png"; region.expected_assets[0].source_file = "art/hero-cutout.png"; asset.expected_assets[0].source_file = "art/hero-cutout.png"; asset.output_file = "public/assets/hero.png"; asset.mime_type = "image/png"; asset.width = width; asset.height = height; asset.alpha = true; asset.sha256 = sha256Bytes(minimalPng(width, height)); region.expected_assets[0].alpha = true; asset.expected_assets[0].alpha = true; manifest.production_contract_audit.units[0].expected_assets[0].alpha = true; region.expected_assets[0].sha256 = asset.sha256; asset.expected_assets[0].sha256 = asset.sha256; manifest.production_contract_audit.units[0].expected_assets[0].sha256 = asset.sha256; asset.normalization_record = imageNormalizationRecord({ sourceFile: asset.source_file, outputFile: asset.output_file, width, height, alpha: asset.alpha, sha256: asset.sha256 }); asset.runtime_consumption.runtime_sha256 = asset.sha256; asset.runtime_consumption.component_usages[0].runtime_sha256 = asset.sha256; manifest.production_contract_audit.units[0].actual_assets[0].sha256 = asset.sha256;
  region.expected_assets[0].mime_type = "image/png"; asset.expected_assets[0].mime_type = "image/png"; manifest.production_contract_audit.units[0].expected_assets[0].mime_type = "image/png"; manifest.production_contract_audit.units[0].expected_assets[0].source_file = "art/hero-cutout.png";
  const promptRegion = manifest.scene_reconstruction_contract.coverage_regions.find((item) => item.region_id === "region-hero");
  const assetPrompt = buildEffectImageAssetPrompt({ region: promptRegion, component: promptRegion ? { component_id: "hero-component", role: "visual-component", atomic_visual_key: "hero-component-atomic" } : undefined, state: "default" }).prompt;
  const statePrompt = "状态段：default；严格保持冻结区域状态，不新增文字、数值或运行时热区。";
  const fullPrompt = buildEffectImageFullPrompt({ assetPrompt, statePrompt, expectedAlpha: true, transparencyStrategy: "direct-alpha", edgeProfile: "hard-edge", capability: { supports_true_alpha: true, verified_edge_profiles: ["hard-edge"] } });
  asset.generation_record = { record_id: "gen-hero-1", generator: "image-generation", generator_version: "1", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "fixture: preserve a verified true-alpha PNG through normalization", input_sources: ["prompt:hero-idle"], parameters: { size: `${width}x${height}` }, reconstruction_mode: "reference-faithful", reference_input_mode: "full-reference-guidance", pixel_reuse_policy: "forbid-output-reuse", source_background_mode: "transparent", final_background_mode: "transparent", transparency_strategy: "direct-alpha", global_prompt_prefix: EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, asset_prompt: assetPrompt, state_prompt: statePrompt, negative_prompt: EFFECT_IMAGE_NEGATIVE_PROMPT, full_prompt: fullPrompt, raw_source_file: "art/hero-cutout.png", raw_source_has_alpha: true, source_file: "art/hero-cutout.png", source_has_alpha: true, runtime_file: "public/assets/hero.png", output_file: "public/assets/hero.png", model: "image-model", model_version: "1", seed: 42, reference_inputs: [manifest.reference_target.original_file], style_reference_inputs: ["evidence/visual/ai-reference.png"], postprocess: [], annotation_number: 2, region_id: "region-hero", component_id: "hero-component", state_id: "default", asset_id: "hero-idle", target_sha256: manifest.reference_target.target_sha256, candidate_sha256: manifest.candidate_identity.sha256, diff_fingerprint: manifest.candidate_identity.diff_fingerprint, candidate_version: manifest.candidateVersion, normalization_record: asset.normalization_record };
  asset.origin = "generated";
  Object.assign(asset.generation_record, {
    origin: "generated",
    visual_baseline_id: manifest.visual_baseline.id,
    visual_baseline_version: manifest.visual_baseline.version,
    style_fingerprint: manifest.visual_baseline.style_fingerprint,
    baseline_document: manifest.visual_baseline.document,
    style_reference_inputs: [{ path: manifest.visual_baseline.anchor_evidence[0].path, sha256: manifest.visual_baseline.anchor_evidence[0].sha256 }],
    global_visual_consistency_prompt: "保持当前项目全局视觉语言、颜色材质、光照、线条、装饰密度、UI形状与全局视觉锚点一致，禁止风格迁移、重设计、跨项目风格混用。",
    style_drift_policy: "forbid",
    prompt_sent: true,
    output_sha256: asset.sha256,
    consistency_status: "passed",
    consistency_evidence: { path: "evidence/visual/ai-consistency.json", sha256: EMPTY_DOCUMENT_FINGERPRINT },
  });
  asset.substitution_policy = "user-change-request-only";
  Object.assign(manifest.coverage_audit.regions[1], { production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  Object.assign(manifest.scene_reconstruction_contract.coverage_regions.find((item) => item.region_id === "region-hero").visual_route_analysis, {
    production_method: "image-generation",
    implementation_plan_mode: "generate-now",
  });
  const sceneHeroRegion = manifest.scene_reconstruction_contract.coverage_regions.find((item) => item.region_id === "region-hero");
  sceneHeroRegion.production_method = "image-generation";
  sceneHeroRegion.delivery_kind = "raster-image";
  manifest.coverage_audit.regions[1].atomic_image_requirements = deriveAtomicImageRequirements(manifest.coverage_audit.regions[1]);
  asset.atomic_image_requirements = manifest.coverage_audit.regions[1].atomic_image_requirements;
  configureManifestTransparentFixture(manifest); addManualConfirmationRecords(manifest);
  manifest.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(manifest.coverage_audit.regions[1]);
  Object.assign(manifest.production_contract_audit.units[0], { observed_method: "image-generation", observed_delivery_kind: "raster-image", atomic_image_requirements: manifest.coverage_audit.regions[1].atomic_image_requirements });
  manifest.scene_reconstruction_contract.combination_preacceptance.prompt_contract_binding = [{ record_id: asset.generation_record.record_id, target_sha256: manifest.reference_target.target_sha256, region_id: "region-hero", candidate_sha256: manifest.candidate_identity.sha256, diff_fingerprint: manifest.candidate_identity.diff_fingerprint, generation_record: asset.generation_record }];
  return manifest;
}

/** 构造带完整拆解确认绑定的 AI 位图清单，用于结构和文件证据测试。 */
function bitmapManifest() {
  const manifest = validAiManifest();
  const region = manifest.coverage_audit.regions[1]; region.production_origin = "bitmap-decomposition"; manifest.assets[0].production_origin = "bitmap-decomposition";
  const requirements = deriveAtomicImageRequirements(region);
  const componentIds = region.component_inventory.components.map((component) => component.component_id).sort();
  const stateIds = [...new Set(region.state_analysis.states.map((state) => state.state_id))].sort();
  // bitmap-decomposition 夹具使用新版本人工确认合同；旧 mode 字段故意不再写入，
  // 这样可以同时覆盖 accepted/manual、编号 PNG、中文摘要生产标签的绑定门。
  addManualConfirmationRecords(manifest);
  // 仅供当前旧测试提案读取的非枚举别名不会进入新确认 JSON；正式记录仍严格是 schema 1.0。
  Object.defineProperties(region.confirmation, {
    numbered_image_file: { value: region.confirmation.annotation_file, writable: true, enumerable: false },
    numbered_image_sha256: { value: region.confirmation.annotation_sha256, writable: true, enumerable: false },
    decision_id: { value: "decision-1", writable: true, enumerable: false },
    thread_id: { value: "thread-1", writable: true, enumerable: false },
  });
  return manifest;
}

/** 构造同一 scene 的两个 state 确认组，验证确认文件不会跨组共享。 */
function multiConfirmationGroupManifest() {
  const manifest = bitmapManifest();
  const second = manifest.coverage_audit.regions[2];
  second.state_id = "victory"; /* 当前布局只绑定 default 提案，迁出的胜利态元素不得留在其中。 */ manifest.scene_reconstruction_contract.layout_decomposition.layout_nodes = manifest.scene_reconstruction_contract.layout_decomposition.layout_nodes.filter((node) => node.region_id !== second.id);
  manifest.reference_target.state_ids = ["default", "victory"];
  manifest.coverage_audit.canvases.push({ scene_id: "main-gameplay", state_id: "victory", width: 390, height: 844 });
  manifest.coverage_audit.summaries.push({ scene_id: "main-gameplay", state_id: "victory", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/summary.md" });
  addManualConfirmationRecords(manifest);
  return manifest;
}

/** 计算测试证据文件的 SHA-256 字符串。 */
function sha256Bytes(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 以 workflow 相同的键序列化 metadata，构造正式标注身份字段。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 按 workflow-control ledger 规则计算排除自引用字段后的规范化 SHA。 */
function canonicalSha(value, excludedField) {
  const payload = { ...value };
  if (excludedField) delete payload[excludedField];
  return sha256Bytes(Buffer.from(canonicalJson(payload), "utf8"));
}

/** 计算工作项直接绑定的确认前置文件列表身份。 */
function prerequisiteListSha(files) {
  const normalized = [...new Set((Array.isArray(files) ? files : []).map((item) => String(item).replaceAll("\\", "/")))].sort();
  return sha256Bytes(Buffer.from(canonicalJson(normalized), "utf8"));
}

/** 计算测试 PNG chunk 的 CRC-32，生成不依赖外部图像库的合法位图。 */
function pngCrc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }

/** 生成包含有效 IHDR、IDAT、IEND 和 CRC 的最小 RGBA PNG。 */
function minimalPng(width = 1, height = 1, raw = Buffer.alloc(height * (width * 4 + 1))) {
  const chunk = (type, data) => { const typeBytes = Buffer.from(type, "ascii"); const body = Buffer.concat([typeBytes, data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body)); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** 创建文件检查所需的空夹具。 */ async function createFixtureFiles(root, includeAi = false, manifest = null) {
  const paths = ["docs/visual-baseline.md", "evidence/visual/main-anchor.png", "evidence/visual/mockup.png", "evidence/visual/reference.png", "evidence/visual/candidate.png", "evidence/coverage/summary.md", "evidence/coverage/state-analysis.md", "evidence/coverage/region-background.md", "evidence/coverage/region-hero.md", "evidence/coverage/region-score.md", "art/hero.aseprite", "docs/license.md", "public/assets/hero.png", "evidence/cocos.png", "evidence/gameplay.mp4", "evidence/visual/hero-consistency.png", "src/region-background.mjs", "src/region-score.mjs", "evidence/fidelity/layout-background.json", "evidence/fidelity/hero-component-layout-node.json", "evidence/fidelity/layout-score.json", ...["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"].map((domain) => `evidence/reconcile/${domain}.md`)];
  if (includeAi) paths.push("evidence/visual/ai-reference.png", "evidence/visual/ai-consistency.json", "art/hero-raw.png", "art/hero-cutout.png");
  // 固定视觉合同是 64×96；includeAi 只增加证据文件，不再把输出位图扩大为旧的双倍尺寸。
  for (const path of paths) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, ["evidence/visual/mockup.png"].includes(path) ? minimalPng(390, 844) : ["public/assets/hero.png", "art/hero-raw.png", "art/hero-cutout.png"].includes(path) ? minimalPng(64, 96) : ""); }
  for (const path of ["evidence/runtime/hero.json", "evidence/f2/visual.md", "evidence/f2/production.md", "evidence/f3/replay.json", "evidence/fidelity/main.json", "evidence/visual/hero-consistency.json"]) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, path.endsWith("hero-consistency.json") ? JSON.stringify({ status: "passed" }) : ""); }
  // 独立生产资源必须与冻结原图保持不同内容，文件夹具用非空字节避免把两者误设为同一份证据。
  await writeFile(join(root, "art/hero.aseprite"), "independent-source");
  await writeFile(join(root, "art/hero.png"), minimalPng(64, 96)); if (includeAi && manifest) await writeManifestTransparentFixtures(root, manifest);
}

/** 构造新版不可变位图复用快照；旧 reuse_source 字段不再进入测试合同。 */
function reuseSnapshot(overrides = {}) {
  return {
    schema: "asset-reuse-snapshot/1.0",
    source_asset_id: "hero-idle",
    source_file: "art/hero.png",
    source_manifest_file: "docs/reuse-snapshot.json",
    source_manifest_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    source_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    compatibility_evidence_file: "evidence/visual/hero-consistency.json",
    compatibility_evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    accepted_at: "2026-08-15T00:05:00Z",
    source_status: "accepted",
    ...overrides,
  };
}

/** 为每个 scene/state 组写入独立 accepted/manual 确认三件套及精确 SHA。 */
async function writeConfirmationFixtureFiles(root, manifest, annotationBytes = null) {
  const regions = manifest.coverage_audit.regions.filter((region) => Number.isInteger(region.annotation_number) && region.annotation_number > 0);
  const groups = new Map();
  for (const region of regions) { const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list); }
  const snapshot = (region) => {
    const contract = resolveProductionContract(region);
    const components = Array.isArray(contract.component_inventory?.components) ? contract.component_inventory.components : [];
    const states = [...new Set([region.state_id, ...(Array.isArray(region.state_analysis?.states) ? region.state_analysis.states.map((item) => item?.state_id) : []), ...components.flatMap((component) => (Array.isArray(component?.state_coverage) ? component.state_coverage : []).map((item) => item?.state_id))].filter(nonEmptyString))].sort();
    const requirements = Array.isArray(region.atomic_image_requirements) ? region.atomic_image_requirements : deriveAtomicImageRequirements(region);
    const assetIds = [...new Set([...(Array.isArray(contract.asset_ids) ? contract.asset_ids : []), contract.asset_id, ...(Array.isArray(contract.expected_assets) ? contract.expected_assets.map((item) => item?.asset_id) : [])].filter(nonEmptyString))].sort();
    const labels = { "generate-now": "新建图片资产", "reuse-existing": "复用现有图片", "runtime-program": "程序绘制或动态逻辑" };
    return { annotation_number: region.annotation_number, region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: contract.production_origin ?? null, production_method: contract.production_method ?? "", delivery_kind: contract.delivery_kind ?? "", production_label: region.production_label ?? labels[region.implementation_plan?.mode] ?? contract.production_method ?? "", component_ids: components.map((item) => item?.component_id).filter(nonEmptyString).sort(), state_ids: states, asset_requirement_ids: requirements.map((item) => item.requirement_id).filter(nonEmptyString).sort(), asset_ids: assetIds };
  };
  for (const [key, groupRegions] of groups) {
    const first = groupRegions[0]; const confirmation = first.confirmation;
    const [sceneId, stateId] = key.split("\0");
    const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
    const suffix = `${safe(sceneId)}-${safe(stateId)}`;
    const canvas = manifest.coverage_audit.canvases.find((item) => item?.scene_id === first.scene_id && item?.state_id === first.state_id);
    const sourceBytes = await readFile(join(root, manifest.reference_target.original_file));
    const bytes = Buffer.isBuffer(annotationBytes)
      ? annotationBytes
      : annotationBytes?.[key] ?? renderEffectImageAnnotation(sourceBytes, manifest.reference_target.original_file, canvas, groupRegions);
    const annotationPath = join(root, confirmation.annotation_file);
    await mkdir(dirname(annotationPath), { recursive: true });
    await writeFile(annotationPath, bytes);
    const annotationSha = sha256Bytes(bytes);
    const decodedAnnotation = decodePngRgba(bytes);
    // 非法 PNG 夹具可能没有 metadata；让文件门负责报告正式标注缺失，而不是夹具生成器先崩溃。
    const metadata = decodedAnnotation.metadata ?? {};
    const metadataSha = sha256Bytes(Buffer.from(canonicalJson(metadata), "utf8"));
    const annotationIdentitySha = sha256Bytes(Buffer.from(canonicalJson({ annotation_sha256: annotationSha, width: decodedAnnotation.width, height: decodedAnnotation.height, metadata_sha256: metadataSha, schema: metadata?.schema, layout: metadata?.layout }), "utf8"));
    const regionsSnapshot = groupRegions.map(snapshot);
    const visualRegions = groupRegions.map((region) => { const production = annotationProductionContract(region); return { region_id: region.id, annotation_number: region.annotation_number, mode: region.implementation_plan?.mode, summary: region.implementation_plan?.summary, production_method: production.production_method, production_origin: production.production_origin, delivery_kind: production.delivery_kind, production_label: production.label, ownership_evidence: region.ownership_evidence, region_definition_sha256: computeRegionDefinitionSha256(region), atomic_image_requirements: Array.isArray(region.atomic_image_requirements) ? region.atomic_image_requirements : deriveAtomicImageRequirements(region) }; });
    const canvasSnapshot = { scene_id: canvas.scene_id, state_id: canvas.state_id, width: canvas.width, height: canvas.height };
    const technicalRegions = groupRegions.map((region) => ({ ...technicalRegionSnapshot(region), layout_node_ids: [...(region.layout_node_ids ?? [])] }));
    const technicalLayoutNodeIds = groupRegions.flatMap((region) => region.layout_node_ids ?? []); const decompositionElements = buildDecompositionElements(groupRegions); // 共用实际元素投影，保留 owner/route/九宫格等冻结事实。
    const proposal = { schema_version: "1.5", proposal_kind: "effect-image-decomposition-technical-analysis", proposal_id: confirmation.proposal_id, created_at: "2026-08-15T00:15:00Z", target_sha256: manifest.reference_target.target_sha256, scene_id: first.scene_id, state_id: first.state_id, canvas: canvasSnapshot, annotation_file: confirmation.annotation_file, annotation_mime: "image/png", annotation_sha256: annotationSha, decomposition_elements: decompositionElements, regions: regionsSnapshot, visual_regions: visualRegions, technical_analysis: { schema_version: "1", canvas: canvasSnapshot, layout_node_ids: technicalLayoutNodeIds, decomposition_elements: decompositionElements, regions: technicalRegions } };
    const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    const proposalPath = join(root, confirmation.proposal_file);
    await mkdir(dirname(proposalPath), { recursive: true });
    await writeFile(proposalPath, proposalBytes);
    const proposalSha = sha256Bytes(proposalBytes);
    const userText = first.confirmation.user_original_text;
    const decision = { schema_version: "1.0", confirmation_id: confirmation.confirmation_id, status: "accepted", confirmation_mode: "manual", proposal_id: confirmation.proposal_id, proposal_sha256: proposalSha, user_statement: userText, user_message_sha256: confirmation.user_message_sha256, accepted_at: first.confirmation.accepted_at, target_sha256: manifest.reference_target.target_sha256, work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: manifest.candidate_identity.sha256, regions: regionsSnapshot };
    const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
    const decisionPath = join(root, confirmation.decision_record_file);
    await mkdir(dirname(decisionPath), { recursive: true });
    await writeFile(decisionPath, decisionBytes);
    const decisionSha = sha256Bytes(decisionBytes);
    const receipt = { message_id: `message-${confirmation.confirmation_id}`, thread_id: "thread-visual-1", author_role: "user", user_message_sha256: confirmation.user_message_sha256, decision_record_sha256: decisionSha, accepted_at: first.confirmation.accepted_at, work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: manifest.candidate_identity.sha256, target_sha256: manifest.reference_target.target_sha256, scene_id: first.scene_id, state_id: first.state_id, resolution_id: `resolution-${confirmation.confirmation_id}`, resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", user_statement: userText };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const receiptPath = join(root, confirmation.user_decision_receipt_file);
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, receiptBytes);
    const receiptSha = sha256Bytes(receiptBytes);
    // ledger 是唯一的用户决定权威来源；测试夹具也必须走官方 loader，不能把普通
    // authority 对象塞回 manifest 伪造可信标记。
    const receiptId = `receipt-${confirmation.confirmation_id}`;
    const entry = {
      ...receipt,
      receipt_id: receiptId,
      receipt_file: confirmation.user_decision_receipt_file,
      receipt_sha256: receiptSha,
      entry_sha256: "",
      annotation_file: confirmation.annotation_file,
      annotation_sha256: annotationSha,
      annotation_width: decodedAnnotation.width,
      annotation_height: decodedAnnotation.height,
      annotation_schema: metadata.schema ?? "",
      annotation_layout: metadata.layout ?? "",
      annotation_metadata_sha256: metadataSha,
      annotation_identity_sha256: annotationIdentitySha,
      proposal_id: confirmation.proposal_id,
      proposal_file: confirmation.proposal_file,
      proposal_sha256: proposalSha,
      decision_record_file: confirmation.decision_record_file,
      decision_record_sha256: decisionSha,
    };
    entry.entry_sha256 = canonicalSha(entry, "entry_sha256");
    const ledger = { schema: "user-resolution-ledger/1.0", ledger_id: `ledger-${suffix}`, ledger_sha256: "", work_item_id: manifest.workItemId, entries: [entry] };
    ledger.ledger_sha256 = canonicalSha(ledger, "ledger_sha256");
    const ledgerPath = join(root, `.workflow-control/user-resolutions/${suffix}-ledger.json`);
    await mkdir(dirname(ledgerPath), { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    for (const region of groupRegions) {
      region.confirmation.annotation_sha256 = annotationSha;
      region.confirmation.proposal_sha256 = proposalSha;
      region.confirmation.decision_record_sha256 = decisionSha;
      region.confirmation.confirmation_sha256 = decisionSha;
      region.confirmation.user_decision_receipt_sha256 = receiptSha;
      region.confirmation.annotation_width = decodedAnnotation.width;
      region.confirmation.annotation_height = decodedAnnotation.height;
      region.confirmation.annotation_schema = metadata.schema ?? "";
      region.confirmation.annotation_layout = metadata.layout ?? "";
      region.confirmation.annotation_metadata_sha256 = metadataSha;
      region.confirmation.annotation_identity_sha256 = annotationIdentitySha;
      region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region);
    }
    if (manifest.scene_reconstruction_contract?.target_conditions?.scene_id === sceneId && manifest.scene_reconstruction_contract?.target_conditions?.state_id === stateId) manifest.scene_reconstruction_contract.visual_decomposition_confirmation = first.confirmation;
  }
  // 布局阶段夹具必须是真实 PNG、节点 JSON、决策副本和离线审阅页，文件门不能用空文件模拟人工确认。
  await writeLayoutReviewFixtureArtifacts(root, manifest);
}

/** 从受保护 ledger 读取每个 scene/state 的引用，避免测试直接构造普通 authority。 */
async function loadFixtureAuthority(root, manifest) {
  const groups = new Map();
  for (const region of manifest.coverage_audit?.regions ?? []) {
    if (!Number.isInteger(region?.annotation_number) || region.annotation_number <= 0) continue;
    const key = `${region.scene_id}\0${region.state_id}`;
    const list = groups.get(key) ?? [];
    list.push(region);
    groups.set(key, list);
  }
  if (groups.size === 0) return null;
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
  const refs = [];
  try {
    for (const [key, regions] of groups) {
      const [sceneId, stateId] = key.split("\0");
      const suffix = `${safe(sceneId)}-${safe(stateId)}`;
      const confirmation = regions[0]?.confirmation;
      const ledgerFile = `.workflow-control/user-resolutions/${suffix}-ledger.json`;
      const ledger = JSON.parse(await readFile(join(root, ledgerFile), "utf8"));
      const receiptId = `receipt-${confirmation?.confirmation_id}`;
      const entry = ledger.entries?.find((item) => item?.receipt_id === receiptId);
      if (!entry) return null;
      refs.push({ scene_id: sceneId, state_id: stateId, ledger_file: ledgerFile, receipt_id: receiptId, receipt_sha256: entry.receipt_sha256 });
    }
  } catch {
    // 尚未写入正式 ledger 的测试仍应由正式文件门报告缺失，而不是让测试辅助器伪造 authority。
    return null;
  }
  const prerequisiteFiles = refs.map((item) => item.ledger_file).concat(refs.map((item) => {
    const region = groups.get(`${item.scene_id}\0${item.state_id}`)?.[0];
    return region?.confirmation?.user_decision_receipt_file;
  })).filter(nonEmptyString);
  const normalizedPrerequisites = [...new Set(prerequisiteFiles.map((item) => item.replaceAll("\\", "/")))].sort();
  // loader 要求前置 ledger/receipt 同时存在于真实 Git 基线，测试项目在临时目录中
  // 建立最小仓库并提交受保护文件，不能用普通字段伪造 baselineHash。
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", ["-C", root, "config", "core.autocrlf", "false"]);
  execFileSync("git", ["-C", root, "add", "--", ...normalizedPrerequisites]);
  execFileSync("git", ["-C", root, "-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "commit", "--quiet", "--allow-empty", "-m", "fixture user-resolution ledger"]);
  const baselineHash = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const work = {
    workItemId: manifest.workItemId,
    baselineHash,
    visualConfirmationPrerequisiteFiles: normalizedPrerequisites, visualConfirmationPrerequisiteFilesSha256: prerequisiteListSha(normalizedPrerequisites),
    visualConfirmationAuthorityRefs: refs,
  };
  const loaded = loadVisualConfirmationAuthority(work, { projectRoot: root, manifest, checkFiles: true });
  return loaded.errors.length === 0 ? loaded.authority : null;
}

/** 所有文件门测试均优先注入官方 loader 产生的私有可信 authority。 */
async function checkManifestFiles(manifest, root, options = {}) {
  const authority = options.authority ?? await loadFixtureAuthority(root, manifest);
  const effective = authority ? { ...options, authority } : options;
  return runManifestFileCheck(manifest, root, effective);
}

/** 变更生产方式后同步夹具中的派生需求，测试仍保持与正式合同一一对应。 */
function refreshRegionDerivedContracts(manifest, region) {
  region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  const asset = manifest.assets.find((item) => item?.id === region.asset_id);
  if (asset) asset.atomic_image_requirements = region.atomic_image_requirements;
  const unit = manifest.production_contract_audit?.units?.find((item) => item?.region_id === region.id);
  if (unit) unit.atomic_image_requirements = region.atomic_image_requirements;
}


export { EMPTY_DOCUMENT_FINGERPRINT, STRUCTURAL_FILE_GATE_OPTIONS, visualComponentContract, addManualConfirmationRecords, nonEmptyString, imageNormalizationRecord, validManifest, attachSceneReconstructionContract, validOrdinaryManifest, validAiManifest, bitmapManifest, multiConfirmationGroupManifest, sha256Bytes, canonicalJson, canonicalSha, prerequisiteListSha, pngCrc32, minimalPng, createFixtureFiles, reuseSnapshot, writeConfirmationFixtureFiles, loadFixtureAuthority, checkManifestFiles, refreshRegionDerivedContracts };
