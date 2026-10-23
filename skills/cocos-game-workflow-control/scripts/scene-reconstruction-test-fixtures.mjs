import assert from "node:assert/strict";
import { nativeRenderContract, nativeRuntimeEvidence } from "./native-render-test-fixtures.mjs";
import { deriveLayoutExecutionPlans } from "../../cocos-game-ui-layout/scripts/widget-layout.mjs";
import { attachLayoutRuntimeSnapshots } from "../../cocos-game-ui-layout/scripts/widget-runtime-test-fixtures.mjs";
import { fixtureLayoutNodes, registerFixtureV2Layout } from "./v2-layout-source-test-fixtures.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDisplayLayerPlanning, validateSceneReconstructionContract, validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
import { validateSceneVisualRouteContract } from "./scene-visual-route-contract.mjs";
import { validateSceneAssetUsageContract, validateSceneCombinationPreacceptance, validateV4ProductionGate, validateVisualImplementationPackageBinding } from "./visual-production-contract.mjs"; import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256 } from "./layout_annotation_confirmation.mjs";

const SHA = "sha256:" + "a".repeat(64);
const LAYOUT_SHA = "sha256:" + "b".repeat(64);
const LAYOUT_DECOMPOSITION_VERSION = "layout-decomposition-1";

/** 仅派生时统一字段，保留混合命名夹具，确保别名读取的既有测试仍然有效。 */
export function refreshFixtureLayoutExecution(nodes) {
  const executionNodes = deriveLayoutExecutionPlans(nodes.map((node) => ({
    ...node, layout_node_id: node.layout_node_id ?? node.layoutNodeId,
    reference_id: node.reference_id ?? node.referenceId,
    target_bounds: node.target_bounds ?? node.targetBounds,
  })));
  nodes.forEach((node, index) => { node.layout_execution = executionNodes[index].layout_execution; });
}

/** 构造绑定冻结目标的全原生独立视觉分析。 */
function allNativeJustification(overrides = {}) {
  return {
    analysis_method: "independent-visual-analysis",
    analysis_id: "all-native-review-1",
    producer_role: "independent-visual-reviewer",
    target_sha256: SHA,
    analysis_artifact_file: "evidence/route/all-native-analysis.json",
    analysis_artifact_sha256: SHA,
    reviewed_region_ids: ["board", "hud"],
    conclusion: "all-native-eligible",
    reason: "冻结目标仅包含纯色几何与动态数据",
    evidence: ["evidence/route/all-native-analysis.json"],
    ...overrides,
  };
}

/** 构造覆盖运行时和固定视觉事实的最小完整场景合同。 */
function contract() {
  const regionFacts = (id, owner) => {
    // 夹具同时覆盖固定美术和动态数据，确保 effect-image 路线门不会把两者混成同一种实现。
    const visualRouteAnalysis = owner === "fixed-production-visual"
      ? {
        element_type: "background-frame",
        visual_complexity: "distinctive",
        distinctive_visual: true,
        observed_features: ["材质纹理", "定制描边"],
        asset_first_decision: "asset-first",
        selected_route: "image-asset",
        route_reason: "具有定制材质和轮廓，外观由固定图片资产承载",
        dynamic_requirements: { is_dynamic: false, description: "固定视觉区域" },
        native_suitability: { eligible: false, primitive_basis: ["not-applicable"], evidence: ["evidence/route/native-not-applicable.json"] },
        reuse_suitability: { eligible: false, exact_asset_identity: "not-applicable", evidence: ["evidence/route/reuse-not-applicable.json"] },
        final_owner: "fixed-production-visual",
        implementation_plan_mode: "generate-now",
        production_method: "authored-raster",
        delivery_kind: "raster-image",
      }
      : {
        element_type: "dynamic-data",
        visual_complexity: "simple",
        distinctive_visual: false,
        observed_features: ["动态数据绑定"],
        asset_first_decision: "native-allowed",
        selected_route: "cocos-native",
        route_reason: "动态数据显示由运行时对象负责，不含独特位图外观",
        dynamic_requirements: { is_dynamic: true, description: "运行时数值可变化" },
        native_suitability: { render_contract: nativeRenderContract(), eligible: true, primitive_basis: ["dynamic-data"], evidence: ["evidence/route/native-hud.json"] },
        reuse_suitability: { eligible: false, exact_asset_identity: "not-applicable", evidence: ["evidence/route/reuse-not-applicable.json"] },
        final_owner: owner,
        implementation_plan_mode: "runtime-program",
        production_method: "runtime-program",
        delivery_kind: "runtime-program",
      };
    return {
    annotation_number: id === "hud" ? 1 : 2,
    region_id: id,
    scene_id: "main",
    state_id: "default",
    target_bounds: { x: id === "hud" ? 0 : 20, y: id === "hud" ? 0 : 160, width: id === "hud" ? 390 : 350, height: id === "hud" ? 96 : 620 },
    coordinate_space: "viewport",
    anchor_reference: "viewport",
    relative_alignment: { horizontal: "center", vertical: "top" },
    z_order: id === "hud" ? 10 : 1,
    target_visibility: "visible",
    size_strategy: { width: "target-bound", height: "target-bound", aspect: "preserve" },
    spacing: { top: 16, bottom: 12, between: 8 },
    typography_facts: { family: "project-font", size: 16, weight: 600, line_height: 20 },
    color_facts: { foreground: "#ffffff", background: "#182333", contrast: "declared" },
    material_texture_facts: { surface: "matte", texture: "panel-noise" },
    lighting_shadow_facts: { shadow: "soft", direction: "top-left" },
    decorative_density_facts: { density: "medium", motifs: ["edge-rivet"] },
    clipping_cropping_facts: { clipping: "none", crop: "forbid" },
    responsive_behavior: { target: "exact", other: "preserve-relative-anchors" },
    implementation_owner: owner,
    implementation_plan: { mode: owner.startsWith("runtime") ? "runtime-program" : "generate-now" },
    assembly_analysis: { strategy: "atomic-scene-composition", uses_full_screen_capture: false, allows_atomic_image_assets: true, evidence: [`evidence/scene/${id}-assembly.json`] },
    visual_route_analysis: visualRouteAnalysis, ...(owner.startsWith("runtime") ? { native_runtime_evidence: nativeRuntimeEvidence(visualRouteAnalysis, { candidate: SHA, target: SHA }) } : {}),
    applicable_states: ["default"],
    evidence: ["evidence/scene/" + id + ".json"],
    tolerance_reference: "layout-tolerance",
    approved_exception_ids: [],
    ...(owner.startsWith("runtime") ? { fidelity_obligations: { geometry: "target-bound", typography: "target-bound", color: "target-bound" } } : {}),
    ...(owner === "fixed-production-visual" ? { scene_asset_usage: { target_display_size: { width: 350, height: 620 }, intended_scale_range: { min: 1, max: 1 }, origin: { x: 0.5, y: 0.5 }, anchor: "target-bound", nine_slice: { policy: "forbid-unless-declared" }, material: { family: "visual-baseline-bound" }, composition_region: id, required_neighbors: [], typography_ownership: "scene-contract", runtime_foreground_ownership: "formal-scene" } } : {}),
    };
  };
  return {
    contract_version: "1.0",
    visual_validation: { mode: "exact" },
    display_layer_planning: {
      version: "1.0",
      scene_master: { scene_id: "main", state_id: "default", target_sha256: SHA, origin: "provided", viewport: { width: 390, height: 844 }, persistent_layer_ids: ["battle-hud"] },
      inventory: [{
        layer_id: "battle-hud", type: "hud", host_scene_id: "main", target_sha256: SHA, persistence: "persistent", states: [{ state_id: "default", required: true }], in_scene_master: true,
        trigger: { event: "scene-ready" }, dismiss: { event: "scene-exit" }, input_blocking: false, z_order: 10, backdrop: { mode: "none" }, focus_restore: { mode: "preserve" }, responsive: { rule: "safe-area" },
        relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: [] },
      }],
    },
    target_conditions: {
      target_sha256: SHA,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 2,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-2.0",
    },
    coverage_regions: [regionFacts("hud", "runtime-program"), regionFacts("board", "fixed-production-visual")],
    reference_technical_conflicts: [],
    decomposition_annotation: { file: "evidence/v2/decomposition-annotation.png", sha256: SHA },
    technical_decomposition: { file: "evidence/v2/technical-decomposition.json", sha256: SHA },
    visual_decomposition_confirmation: { confirmation_id: "v2-confirmation", confirmation_sha256: SHA, confirmation_mode: "manual", status: "passed", proposal_id: "v2-proposal", proposal_sha256: SHA, annotation_file: "evidence/v2/decomposition-annotation.png", annotation_sha256: SHA, target_sha256: SHA, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" } },
    visual_production_contract: { contract_id: "visual-production-contract-1" },
    visual_production_units: [{ unit_id: "board", region_id: "board", owner: "fixed-production-visual" }],
    coverage_audit: { regions: [{ id: "hud" }, { id: "board" }] },
    composition: {
      vertical_order: ["hud", "board"],
      inter_region_spacing: { hud_board: 12 },
      relative_sizes: { hud: "11.4% viewport height", board: "73.5% viewport height" },
      visual_center_of_gravity: { x: 195, y: 430 },
      whitespace: { regions: ["between-hud-board"], permitted: "declared" },
      alignments: [{ from: "hud", to: "board", axis: "horizontal", relation: "center" }],
      visual_hierarchy: ["hud", "board", "background"],
      background_focus_foreground_occlusion: { focus: "board", foreground: ["hud"], occlusion: "hud-over-board" },
    },
    responsive_contract: {
      target_viewport: { width: 390, height: 844 },
      other_viewports: [{ width: 393, height: 852, expected: "preserve-relative-anchors" }],
      relationship_invariants: ["hud remains above board", "board remains centered"],
      layout_contract_binding: { target_sha256: SHA, scene_id: "main", state_id: "default", visual_baseline_version: "1.0.0", reconstruction_contract_version: "1.0" },
    },
    predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { unit: "logical-px", value: 2 } } }],
    implementation_plan: { resources: ["board-surface"], layout: ["target-bound-layout"], runtime_objects: ["hud", "board"], composition: ["main-scene-stack"] },
    combination_preacceptance: { status: "passed", formal_scene_structure: "MainScene/ContainerGraph", layout_calculation_identity: "layout:main:1", evidence: ["evidence/scene/combined.png"], target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1" },
  };
}

/** 构造共享清单身份，保持各还原合同用例的基线一致。 */
function manifest() {
  return { visual_validation: { mode: "exact" }, reference_target: { target_sha256: SHA, scene_ids: ["main"], state_ids: ["default"] }, visual_baseline: { version: "1.0.0" }, coverage_audit: { regions: [{ id: "hud" }, { id: "board" }] }, scene_reconstruction_contract: { predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { value: 2 } } }], coverage_regions: [{ id: "hud", tolerance_reference: "layout-tolerance", approved_exception_ids: [] }, { id: "board", tolerance_reference: "layout-tolerance", approved_exception_ids: [] }] } };
}

/** 将常驻 HUD 夹具转换为独立弹窗工作项合同，并补齐宿主场景上下文。 */
function displayLayerContract() {
  const value = structuredClone(contract());
  const layer = value.display_layer_planning.inventory[0];
  layer.layer_id = "pause-modal";
  layer.type = "modal";
  layer.persistence = "transient";
  layer.in_scene_master = false;
  layer.states = [{ state_id: "open", required: true, contextual_effect_image: { evidence: "evidence/display/pause-open.png", sha256: SHA, origin: "provided", host_scene_id: "main", host_target_sha256: SHA, layer_target_sha256: SHA, viewport: { width: 390, height: 844 }, kind: "host-scene-context", isolated_only: false } }];
  layer.runtime_replay = { status: "passed", host_scene_id: "main", same_screen_combination: true, steps: ["open", "interact", "close", "restore"].map((phase) => ({ phase, evidence: `evidence/display/pause-${phase}.json` })) };
  value.display_layer_planning.scene_master.persistent_layer_ids = [];
  return value;
}

/** 构造同条件的结构化 fidelity case；差异夹具只替换逐区域目标/候选事实。 */
function fidelityCase(overrides = {}) {
  const base = {
    id: "case-1",
    target_identity: { sha256: SHA },
    candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" },
    scene_id: "main",
    state_id: "default",
    viewport: { width: 390, height: 844 },
    dpr: 2,
    locale: "zh-CN",
    seed: 42,
    input_trace: "trace.json",
    stable_frame: "frame:1",
    original_target_size: { width: 390, height: 844 },
    original_candidate_size: { width: 390, height: 844 },
    normalization_transform: { type: "identity", scale_x: 1, scale_y: 1 },
    normalized_comparison_canvas: { width: 390, height: 844 },
    normalization_equivalence: {
      viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true },
      dpr: { target: 2, candidate: 2, equivalent: true },
      logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true },
    },
    full_viewport_reference: "ref.png",
    full_viewport_candidate: "candidate.png",
    side_by_side_evidence: "side.png",
    overlay_evidence: "overlay.png",
    difference_evidence: "diff.png",
    tolerance_set: { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } },
    per_region_results: [
      { region_id: "hud", target_measurement: { width: 390, height: 96 }, candidate_measurement: { width: 390, height: 96 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud.json"], exception_ids: [] },
      { region_id: "board", target_measurement: { width: 350, height: 620 }, candidate_measurement: { width: 350, height: 620 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board.json"], exception_ids: [] },
    ],
    conclusion: "passed",
  };
  return { ...base, ...overrides };
}

/** 构造带布局拆解、V4 几何证据和 V4 逐节点证据的 effect-image 合同。 */
function effectImageContract() {
  const value = structuredClone(contract());
  value.effect_image_reconstruction = { applicability: "effect-image" };
  value.text_decomposition = { applicability: "not-applicable", reason: "当前冻结画面没有可见文本节点" };
  value.target_conditions.layout_contract_sha256 = LAYOUT_SHA;
  value.target_conditions.layout_decomposition_version = LAYOUT_DECOMPOSITION_VERSION;
  value.coverage_regions[0].layout_node_ids = ["hud-main"];
  value.coverage_regions[1].layoutNodeIds = ["board-surface"];
  value.responsive_contract.layout_contract_binding.viewport = { width: 390, height: 844 };
  value.responsive_contract.layout_contract_binding.layout_contract_version = "layout-2.0";
  value.responsive_contract.layout_contract_binding.layout_contract_sha256 = LAYOUT_SHA;
  value.responsive_contract.layout_contract_binding.layout_decomposition_version = LAYOUT_DECOMPOSITION_VERSION;
  value.layout_decomposition = {
    layout_binding: {
      target_sha256: SHA,
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-2.0",
      layout_contract_sha256: LAYOUT_SHA,
      layout_decomposition_version: LAYOUT_DECOMPOSITION_VERSION,
    },
    layout_nodes: [
      {
        layout_node_id: "hud-main",
        region_id: "hud",
        ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FLEX", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
        reference_id: "viewport",
        parent_layout_node_id: "viewport",
        parent_target_bounds: { x: 0, y: 0, width: 390, height: 844 },
        relative_position: { left: 0, right: 0, top: 0, bottom: 748 },
        axis_alignment: { horizontal: "left", vertical: "top" },
        self_anchor: "top-left",
        reference_anchor: "top-left",
        offset: { x: 0, y: 0 },
        target_bounds: { x: 0, y: 0, width: 390, height: 96 },
        z_order: 10,
      },
      {
        layout_node_id: "board-surface",
        region_id: "board",
        ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FLEX", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
        reference_id: "viewport",
        parent_layout_node_id: "viewport",
        parent_target_bounds: { x: 0, y: 0, width: 390, height: 844 },
        relative_position: { left: 20, right: 20, top: 160, bottom: 64 },
        axis_alignment: { horizontal: "left", vertical: "bottom" },
        self_anchor: "bottom-left",
        reference_anchor: "bottom-left",
        offset: { x: 20, y: -64 },
        target_bounds: { x: 20, y: 160, width: 350, height: 620 },
        z_order: 1,
      },
    ],
    layout_annotation: { layout_annotation_file: "evidence/v2/layout-annotation.png", layout_annotation_sha256: SHA, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA, layout_review_file: "evidence/v2/layout-review.html", layout_review_sha256: SHA, layout_review_identity_sha256: SHA, layout_nodes_file: "evidence/v2/layout-nodes.json", layout_nodes_sha256: SHA, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default", layout_node_ids: ["hud-main", "board-surface"] }, layout_annotation_confirmation: (() => { const record = { confirmation_schema: "layout-annotation-confirmation/1.0", confirmation_id: "v2-layout-confirmation", status: "accepted", confirmation_mode: "manual", layout_annotation_file: "evidence/v2/layout-annotation.png", layout_annotation_sha256: SHA, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA, layout_review_file: "evidence/v2/layout-review.html", layout_review_sha256: SHA, layout_review_identity_sha256: SHA, layout_nodes_file: "evidence/v2/layout-nodes.json", layout_nodes_sha256: SHA, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default", user_original_text: "确认布局标注", user_message_sha256: computeLayoutUserMessageSha256("确认布局标注"), decision_record_file: "evidence/v2/layout-decision.json", decision_record_sha256: SHA, user_decision_receipt_file: "evidence/v2/layout-receipt.json", user_decision_receipt_sha256: SHA, accepted_at: "2026-01-01T00:00:00Z" }; return { ...record, confirmation_sha256: computeLayoutAnnotationConfirmationSha256(record) }; })(),
  };
  const fixtureNodes = value.layout_decomposition.layout_nodes;
  refreshFixtureLayoutExecution(fixtureNodes);
  registerFixtureV2Layout(value, fixtureNodes);
  const sourceNodes = fixtureLayoutNodes(value);
  value.combination_preacceptance.formal_assets = ["hud-main", "board-surface"];
  value.combination_preacceptance.visual_fidelity = { contour: "passed", proportion: "passed", pose: "passed", icon_semantics: "passed", full_scene_composition: "passed" };
  value.combination_preacceptance.redesign_check = "none";
  value.combination_preacceptance.layout_geometry = {
    component_snapshots: attachLayoutRuntimeSnapshots(sourceNodes, sourceNodes.map((node) => ({ layout_node_id: node.layout_node_id ?? node.layoutNodeId }))),
    formal_layout_structure: "MainScene/LayoutContract",
    missing_node_ids: [],
    extra_node_ids: [],
    orphan_node_ids: [],
    node_measurements: [
      { layout_node_id: "hud-main", target_bounds: { x: 0, y: 0, width: 390, height: 96 }, actual_bounds: { x: 0, y: 0, width: 390, height: 96 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud-layout.json"] },
      { layout_node_id: "board-surface", target_bounds: { x: 20, y: 160, width: 350, height: 620 }, actual_bounds: { x: 20, y: 160, width: 350, height: 620 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board-layout.json"] },
    ],
    result: "passed",
  };
  return value;
}

/** 构造 effect-image 清单快照；V4 必须使用完整 scene contract。 */
function effectImageManifest(sceneContract) {
  return {
    ...manifest(),
    effect_image_reconstruction: { applicability: "effect-image" },
    scene_reconstruction_contract: sceneContract, visualStageState: "v2-production-planning-complete",
  };
}

/** 构造完整文本节点；测试只把一个 HUD 布局节点作为文本容器，避免改变既有布局夹具。 */
function textNode(overrides = {}) {
  return {
    text_node_id: "hud.title.label",
    region_id: "hud",
    layout_node_id: "hud-main",
    content: "开始游戏",
    semantic_role: "primary-action-label",
    dynamic: false,
    localizable: false,
    target_bounds: { x: 0, y: 0, width: 390, height: 96 },
    typography_target: {
      font_identity: { status: "resolved", confidence: "high", family: "Game Sans" },
      font_size: 32,
      font_size_unit: "logical-px",
      font_weight: 600,
      font_style: "normal",
      line_height: 38,
      letter_spacing: -1,
      alignment: "center",
      baseline: 40,
      fill: "#ffffff",
      stroke: { enabled: true, color: "#15233c", width: 3 },
      shadow: { enabled: false },
      wrap: { mode: "none", width: 390 },
      expected_line_count: 1,
      reference_pixel_bounds: { x: 0, y: 0, width: 585, height: 144 },
      target_glyph_bounds: { x: 120, y: 28, width: 150, height: 38 },
      reference_dpr: 2,
      logical_coordinate_space: "viewport-logical",
    },
    implementation_route: "cocos-text",
    route_reason: "文案固定但仍由 Cocos Text 渲染，便于后续本地化和字号调整",
    ownership: "scene-runtime",
    required_resources: [{ kind: "font", path: "assets/fonts/game-sans.woff2", sha256: SHA }],
    tolerance_reference: "layout-tolerance",
    approved_exception_ids: [],
    runtime_verification: {
      renderer: "cocos-text",
      font_loaded: true,
      fallback_detected: false,
      actual_bounds: { x: 0, y: 0, width: 390, height: 96 },
      glyph_bounds: { x: 120, y: 28, width: 150, height: 38 },
      baseline: 40,
      actual_test_id: "tests/text/hud-title",
      evidence: ["evidence/text/hud-title.json"],
      passed: true,
      target_bounds: { x: 0, y: 0, width: 390, height: 96 },
      candidate_bounds: { x: 0, y: 0, width: 390, height: 96 },
      delta: { x: 0, y: 0, width: 0, height: 0 },
      tolerance_reference: "layout-tolerance",
    },
    planned_test_id: "tests/text/hud-title",
    ...overrides,
  };
}

/** 构造带文本拆解的效果图合同，用于验证文本独立门而不改变普通合同语义。 */
function textEffectImageContract(nodeOverrides = {}) {
  const value = effectImageContract();
  value.text_decomposition = { applicability: "has-text", text_nodes: [textNode(nodeOverrides)] };
  return value;
}

/** 给 fidelity case 增加与布局节点一一对应的差异证据。 */
function effectImageLayoutResults() {
  return [
    { layout_node_id: "hud-main", target_bounds: { x: 0, y: 0, width: 390, height: 96 }, candidate_bounds: { x: 0, y: 0, width: 390, height: 96 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud-layout-diff.json"] },
    { layoutNodeId: "board-surface", targetBounds: { x: 20, y: 160, width: 350, height: 620 }, candidateBounds: { x: 20, y: 160, width: 350, height: 620 }, delta: { x: 0, y: 0, width: 0, height: 0 }, toleranceReference: "layout-tolerance", result: "passed", evidence: ["board-layout-diff.json"] },
  ];
}


export { SHA, LAYOUT_SHA, LAYOUT_DECOMPOSITION_VERSION, allNativeJustification, contract, manifest, displayLayerContract, fidelityCase, effectImageContract, effectImageManifest, textNode, textEffectImageContract, effectImageLayoutResults };
