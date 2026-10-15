import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateNativeRenderContract, validateNativeRuntimeEvidence } from "./native-render-contract.mjs";
import { validateSceneVisualRouteAnalysis, validateSceneVisualRouteContract } from "./scene-visual-route-contract.mjs";
import { nativeRenderContract, nativeRuntimeEvidence } from "./native-render-test-fixtures.mjs";
import { computeRegionDefinitionSha256 } from "../../cocos-game-asset-integration/scripts/effect_image_annotation_core.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造独立静态框体，按钮语义和动态标记均不能代替视觉能力判断。 */
function nativeRegion() {
  return {
    region_id: "button-frame", scene_id: "main", state_id: "default", annotation_number: 1,
    implementation_owner: "runtime-rendered", implementation_plan: { mode: "runtime-program" },
    assembly_analysis: { strategy: "atomic-scene-composition", uses_full_screen_capture: false, allows_atomic_image_assets: true, evidence: ["evidence/assembly.json"] },
    visual_route_analysis: {
      element_type: "button", visual_complexity: "simple", distinctive_visual: false,
      observed_features: ["纯色矩形，2px 规则描边，直角"], asset_first_decision: "native-allowed", selected_route: "cocos-native",
      route_reason: "Graphics 可确定性表达矩形尺寸、填色与规则边框", dynamic_requirements: { is_dynamic: false, description: "静态框体" },
      native_suitability: { eligible: true, primitive_basis: ["pure-color", "basic-geometry", "regular-line"], evidence: ["evidence/graphics-capability.json"], render_contract: nativeRenderContract() },
      reuse_suitability: { eligible: false, evidence: ["无精确资产身份"], exact_asset_identity: "not-applicable" },
      final_owner: "runtime-rendered", implementation_plan_mode: "runtime-program", production_method: "cocos-graphics", delivery_kind: "runtime-drawing",
    },
  };
}

test("静态纯色框体和规则边框可原生实现，元素语义不决定生产路线", () => {
  for (const element_type of ["button", "panel", "simple-geometry", "icon"]) {
    const region = nativeRegion();
    region.visual_route_analysis.element_type = element_type;
    assert.deepEqual(validateSceneVisualRouteAnalysis(region, {}), []);
  }
});

test("特色图标、插画和材质不能通过静动态声明及简单原语获得原生资格", () => {
  for (const is_dynamic of [false, true]) for (const feature of ["复杂特色图标", "插画", "金属材质纹理", "不规则轮廓"]) {
    const region = nativeRegion();
    region.visual_route_analysis.dynamic_requirements.is_dynamic = is_dynamic;
    region.visual_route_analysis.observed_features = [feature];
    const errors = validateSceneVisualRouteAnalysis(region, {});
    assert(errors.some((error) => error.includes("等价性证据")), `${feature}: ${errors.join("\n")}`);
  }
});

test("原生路线必须完整冻结视觉参数，不支持特征、伪原语及漏状态均阻断", () => {
  const frozen = nativeRenderContract();
  for (const field of Object.keys(frozen)) {
    const incomplete = structuredClone(frozen);
    delete incomplete[field];
    assert(validateNativeRenderContract(incomplete).length > 0, field);
  }
  assert(validateNativeRenderContract({ ...frozen, unsupported_features: ["复杂材质"] }).some((error) => error.includes("禁止近似替代")));
  assert(validateNativeRenderContract(frozen, { state_id: "pressed" }).some((error) => error.includes("state_id")));
  const region = nativeRegion();
  region.visual_route_analysis.native_suitability.primitive_basis = ["not-applicable"];
  assert(validateSceneVisualRouteAnalysis(region, {}).some((error) => error.includes("not-applicable 原语")));
  for (const invalid of [{}, 1, null]) {
    region.visual_route_analysis.native_suitability.primitive_basis = invalid;
    assert(validateSceneVisualRouteAnalysis(region, {}).some((error) => error.includes("原生绘制原语")));
  }
});

test("规则渐变必须冻结方向和有序色标，不能把不支持的渐变当简单填色通过", () => {
  const value = nativeRenderContract({ gradient: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] } });
  assert.deepEqual(validateNativeRenderContract(value), []);
  delete value.gradient.angle;
  assert(validateNativeRenderContract(value).some((error) => error.includes("angle")));
  value.gradient.angle = 90;
  value.gradient.stops.reverse();
  assert(validateNativeRenderContract(value).some((error) => error.includes("递增")));
});

test("冻结生成式图片合同在区域、coverage 和实施包绑定处均禁止静默替换", () => {
  const region = nativeRegion();
  region.image_generation_required = true;
  assert(validateSceneVisualRouteAnalysis(region, {}).some((error) => error.includes("冻结合同禁止自动替换")));
  delete region.image_generation_required;
  const imageRegion = { region_id: "art", visual_route_analysis: { ...region.visual_route_analysis, selected_route: "image-asset" } };
  const contract = { coverage_regions: [region, imageRegion] };
  for (const bound of ["coverage_audit", "visualProductionUnits"]) {
    const manifest = bound === "coverage_audit" ? { coverage_audit: { regions: [{ id: region.region_id, image_generation_required: true }] } } : { visualProductionUnits: [{ region_id: region.region_id, image_generation_required: true }] };
    assert(validateSceneVisualRouteContract(contract, manifest).some((error) => error.includes("冻结合同禁止自动替换")), bound);
  }
});

test("人工确认哈希冻结原生参数，实际装配合同必须精确镜像", () => {
  const region = nativeRegion();
  const bound = { id: region.region_id, production_method: "cocos-graphics", runtime_implementation: { kind: "cocos-graphics", integration_files: ["src/ui.mjs"], render_contract: nativeRenderContract() } };
  const original = computeRegionDefinitionSha256(bound);
  bound.runtime_implementation.render_contract.line_width = 3;
  assert.notEqual(computeRegionDefinitionSha256(bound), original);
  const errors = validateSceneVisualRouteContract({ coverage_regions: [region] }, { coverage_audit: { regions: [bound] } });
  assert(errors.some((error) => error.includes("精确镜像冻结原生参数")));
  const nested = { id: bound.id, production_contract: { production_method: bound.production_method, runtime_implementation: bound.runtime_implementation } };
  assert(validateSceneVisualRouteContract({ coverage_regions: [region] }, { coverage_audit: { regions: [nested] } }).some((error) => error.includes("精确镜像冻结原生参数")));
});

test("V4 原生实际输出和消费须匹配冻结尺寸、颜色、线宽与路线", () => {
  const region = nativeRegion();
  const contract = { target_conditions: { target_sha256: SHA }, candidate_identity: { sha256: SHA } };
  const options = { stage: "V4" };
  assert(validateNativeRuntimeEvidence(region, contract, null, options).some((error) => error.includes("实际输出与运行消费")));
  region.native_runtime_evidence = nativeRuntimeEvidence(region.visual_route_analysis, { candidate: SHA, target: SHA });
  assert.deepEqual(validateNativeRuntimeEvidence(region, contract, null, options), []);
  for (const [field, value] of [["line_width", 3], ["colors", ["#ff0000"]], ["dimensions", { width: 121, height: 48 }]]) {
    const changed = structuredClone(region);
    changed.native_runtime_evidence.render_contract[field] = value;
    assert(validateNativeRuntimeEvidence(changed, contract, null, options).some((error) => error.includes("冻结原生参数不一致")), field);
  }
  region.native_runtime_evidence.observed_method = "authored-raster";
  assert(validateNativeRuntimeEvidence(region, contract, null, options).some((error) => error.includes("交付类型与冻结路线不一致")));
  region.native_runtime_evidence.observed_method = "cocos-graphics";
  region.native_runtime_evidence.candidate_sha256 = "stale-summary";
  assert.deepEqual(validateNativeRuntimeEvidence(region, contract, null, options), []);
});

test("V4 原生消费工件读取真实消费内容，声明通过不能掩盖损坏或参数漂移", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "native-evidence-"));
  try {
    const region = nativeRegion();
    region.native_runtime_evidence = { ...nativeRuntimeEvidence(region.visual_route_analysis, { candidate: SHA, target: SHA }), evidence: "native.json" };
    const report = { ...structuredClone(region.native_runtime_evidence), report_schema: "native-render-consumption/1.0", consumed: true, region_id: region.region_id, scene_id: region.scene_id, state_id: region.state_id };
    const bytes = Buffer.from(JSON.stringify(report));
    await writeFile(join(projectRoot, "native.json"), bytes);
    region.native_runtime_evidence.evidence_sha256 = "stale-summary";
    const contract = { target_conditions: { target_sha256: SHA }, candidate_identity: { sha256: SHA } };
    assert.deepEqual(validateNativeRuntimeEvidence(region, contract, null, { stage: "V4", projectRoot }), []);
    await writeFile(join(projectRoot, "native.json"), "tampered");
    assert(validateNativeRuntimeEvidence(region, contract, null, { stage: "V4", projectRoot }).some((error) => error.includes("可读取的 JSON")));
    // 摘要记录即使陈旧，仍读取并核对工件内真实消费参数。
    report.render_contract.line_width = 5;
    const changedBytes = Buffer.from(JSON.stringify(report));
    await writeFile(join(projectRoot, "native.json"), changedBytes);
    assert(validateNativeRuntimeEvidence(region, contract, null, { stage: "V4", projectRoot }).some((error) => error.includes("运行工件 render_contract")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
