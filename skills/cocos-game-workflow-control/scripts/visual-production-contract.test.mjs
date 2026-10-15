import assert from "node:assert/strict"; import { prepareTransparencyFixture } from "./transparent-route-test-fixtures.mjs";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import test from "node:test";
import {
  auditProductionContract,
  isVisualProductionWork,
  validateComponentAuditEvidence,
  validateVisualF2MachineGate,
  validateImageGenerationContract,
  validateProductionContract,
  validateProductionMethodChangeRequest,
  validateV4ProductionGate,
  validateV4VisualManifest,
  validateVisualComponentContract,
  validateVisualEvidence,
  validateVisualProductionCoverage,
  validateVisualProductionUnits,
  deriveAtomicImageRequirements,
  normalizeProjectRelativePath,
} from "./visual-production-contract.mjs";
import { productionFileGateError, requiresVisualFileGate } from "./visual-file-gate.mjs";
import { declaredPathEntry, registerCrossUnitPath } from "./visual-package-paths.mjs";
import { buildSolidBackgroundPrompt, DEFAULT_SOURCE_BACKGROUND_COLOR } from "./visual-transparent-background-contract.mjs";

const HASH = `sha256:${"a".repeat(64)}`;

/** 阶段重命名后只分类 V2-V4，旧编号不能继续进入正式视觉生产范围。 */
test("视觉生产阶段使用连续的 V2-V4 编号", () => {
  for (const stageId of ["V2", "V3", "V4"]) assert.equal(isVisualProductionWork({ stageId }), true);
  for (const stageId of ["V1", "V5", "V6"]) assert.equal(isVisualProductionWork({ stageId }), false);
});

const IMPLEMENTATION_PACKAGE_SCHEMA = JSON.parse(readFileSync(new URL("../references/implementation-package.schema.json", import.meta.url), "utf8"));

/** 重新从唯一 component×required state 生成稳定的原子生图需求。 */
function refreshAtomicRequirements(region) {
  region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  return region;
}

/** 为单元级回归夹具提供新的 scene/state 确认组绑定。 */
function confirmationGroupFor(region, confirmationId) {
  return { scene_id: region.scene_id ?? "?", state_id: region.state_id ?? "?", confirmation_id: confirmationId, confirmation_sha256: HASH };
}

/** 构造完整状态分析：单部件默认态需要资源，其余状态明确说明不适用。 */
function componentContract(componentId, assetId, sourceFile = `art/${assetId}.png`, runtimeFile = `public/${assetId}.png`) {
  const requiredStates = [{ state_id: "default", requirement: "required", reason: "普通可见状态" }];
  const notApplicable = ["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前单图区域没有该状态" }));
  return refreshAtomicRequirements({
    id: componentId,
    annotation_number: 1,
    owner_type: "fixed-production-visual",
    production_origin: "independent-production",
    production_method: "authored-raster",
    production_label: "复用现有图片",
    delivery_kind: "raster-image",
    image_generation_required: false,
    generation_record_required: false,
    substitution_policy: "forbid",
    bounds: { x: 0, y: 0, width: 64, height: 64 },
    state_analysis: { status: "complete", phase: "before-component-splitting", evidence: "evidence/state-analysis.md", evidence_sha256: HASH, reference_target_sha256: HASH, analysis_id: "analysis-1", completed_at: "2026-08-15T00:00:00Z", states: [...requiredStates, ...notApplicable] },
    component_inventory: { granularity: "single-component", component_count: 1, visible_instance_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [{ component_id: componentId, atomic_visual_key: `${componentId}-visual`, role: "visual-component", reusable: true, state_coverage: [...requiredStates, ...notApplicable], placements: [{ placement_id: `${componentId}-placement-1`, bounds: { x: 0, y: 0, width: 32, height: 32 }, interaction_required: false }] }] },
    expected_assets: [{ asset_id: assetId, asset_scope: "atomic-component", atomic_visual_key: `${componentId}-visual`, component_id: componentId, state_id: "default", source_file: sourceFile, runtime_file: runtimeFile }],
    interaction_hotspots: [],
  });
}

/** 构造多部件默认态区域，用于验证组图、独立资源和合法 atlas。 */
function multiComponentRegion(count, mode = "individual", expectedAssets = null) {
  const regionWidth = Math.max(64, count * 32);
  const states = [{ state_id: "default", requirement: "required", reason: "普通状态" }, ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前组件不适用" }))];
  const components = Array.from({ length: count }, (_, index) => ({ component_id: `component-${index + 1}`, atomic_visual_key: `component-${index + 1}-visual`, role: "button", reusable: true, state_coverage: states, placements: [{ placement_id: `placement-${index + 1}`, bounds: { x: index * 32, y: 0, width: 32, height: 32 }, interaction_required: false }] }));
  const defaultAssets = components.map((component, index) => ({ asset_id: `asset-${index + 1}`, asset_scope: "atomic-component", atomic_visual_key: component.atomic_visual_key, component_id: component.component_id, state_id: "default", source_file: `art/${component.component_id}.png`, runtime_file: `public/${component.component_id}.png` }));
  const suppliedAssets = (expectedAssets ?? defaultAssets).map((asset) => ({
    ...asset,
    asset_scope: asset.asset_scope ?? "atomic-component",
    atomic_visual_key: asset.atomic_visual_key ?? components.find((component) => component.component_id === asset.component_id)?.atomic_visual_key ?? "",
  }));
  return refreshAtomicRequirements({
    owner_type: "fixed-production-visual",
    production_origin: "independent-production",
    production_method: "authored-raster",
    production_label: "复用现有图片",
    delivery_kind: "raster-image",
    image_generation_required: false,
    generation_record_required: false,
    substitution_policy: "forbid",
    annotation_number: 2,
    id: `region-${count}`,
    bounds: { x: 0, y: 0, width: regionWidth, height: 64 },
    state_analysis: { status: "complete", phase: "before-component-splitting", evidence: "evidence/state-analysis.md", evidence_sha256: HASH, reference_target_sha256: HASH, analysis_id: "analysis-1", completed_at: "2026-08-15T00:00:00Z", states },
    component_inventory: { granularity: "reusable-component", component_count: count, visible_instance_count: count, delivery_mode: mode, atlas_allowed: mode === "atlas", created_at: "2026-08-15T00:01:00Z", components },
    expected_assets: suppliedAssets,
    asset_ids: [...new Set(suppliedAssets.map((asset) => asset.asset_id))],
    interaction_hotspots: [],
  });
}

/** 构造不需要 图像生成 的显式独立生产合同。 */
function independentContract(overrides = {}) {
  return {
    production_origin: "independent-production",
    production_method: "cocos-graphics",
    delivery_kind: "runtime-drawing",
    image_generation_required: false,
    generation_record_required: false,
    substitution_policy: "forbid",
    expected_assets: ["hero-runtime"],
    runtime_implementation: { kind: "cocos-graphics", integration_files: ["src/hero-runtime.mjs"] },
    ...overrides,
  };
}

/** 为 图像生成 夹具生成与源图、运行时输出和最终尺寸一致的归一化记录。 */
function normalizationRecordForAsset({ sourceFile, outputFile, width, height, alpha, sha256, operation = "not-required" } = {}) {
  const identitySha = /^sha256:[a-f0-9]{64}$/.test(String(sha256 ?? "")) ? sha256 : HASH;
  return {
    schema: "image-normalization/1",
    status: "passed",
    operation,
    source_file: sourceFile,
    source_sha256: identitySha,
    source_width: width,
    source_height: height,
    target_width: width,
    target_height: height,
    output_file: outputFile,
    output_sha256: identitySha,
    output_width: width,
    output_height: height,
    preserve_alpha: alpha === true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-15T00:00:00Z",
  };
}

/** 构造包含完整输出身份的 图像生成 资产合同，并同步资产与生成记录的归一化事实。 */
function imageGenAsset(overrides = {}) {
  const asset = {
    source_file: "art/hero-cutout.png",
    mime_type: "image/png",
    width: 64,
    height: 96,
    alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" },
    sha256: HASH,
    runtime_outputs: ["public/assets/hero.png"],
    runtime_consumption: { status: "passed", evidence: "evidence/runtime.json", evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" },
    generation_record: {
      record_id: "GEN-1", generator: "image-generation", generator_version: "1", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "imagegen hero",
      global_prompt_prefix: "固定风格", asset_prompt: "主角", state_prompt: "待机", negative_prompt: "文字", full_prompt: `固定风格\n主角\n待机\n${buildSolidBackgroundPrompt(DEFAULT_SOURCE_BACKGROUND_COLOR)}`, source_background_mode: "opaque", source_background_color: DEFAULT_SOURCE_BACKGROUND_COLOR, final_background_mode: "transparent", transparency_strategy: "background-removal", model: "image-generation", model_version: "1", seed: 1,
      raw_source_file: "art/hero-raw.png", raw_source_has_alpha: false, source_file: "art/hero-cutout.png", source_has_alpha: true, reference_inputs: ["docs/reference.png"], postprocess: ["background-removal"], background_removal_attempts: [{ operation: "background-removal", status: "completed", source_file: "art/hero-raw.png", output_file: "art/hero-cutout.png", source_has_alpha: false, output_has_alpha: true, completed_at: "2026-08-15T00:00:00Z", evidence: { record_id: "BR-1", report: "evidence/background-removal.json", solid_background_check: { status: "passed", background_color: DEFAULT_SOURCE_BACKGROUND_COLOR, tolerance: 0, boundary_pixels: 4, matched_boundary_pixels: 4, opaque: true } } }],
    },
    ...overrides,
  };
  // 尺寸合同已经声明时，记录必须指向最终 runtime 输出；负向夹具没有有效尺寸时只保留可审计占位事实。
  const width = Number.isInteger(asset.width) && asset.width > 0 ? asset.width : 64;
  const height = Number.isInteger(asset.height) && asset.height > 0 ? asset.height : 96;
  const sourceFile = asset.source_file ?? "art/hero-cutout.png";
  const outputFile = asset.output_file ?? asset.runtime_outputs?.[0] ?? "public/assets/hero.png";
  const identitySha = /^sha256:[a-f0-9]{64}$/.test(String(asset.sha256 ?? "")) ? asset.sha256 : HASH;
  const inheritedNormalization = asset.generation_record?.normalization_record;
  const inheritedMatchesAsset = inheritedNormalization && typeof inheritedNormalization === "object" && !Array.isArray(inheritedNormalization)
    && inheritedNormalization.source_file === sourceFile && inheritedNormalization.output_file === outputFile
    && inheritedNormalization.source_sha256 === identitySha && inheritedNormalization.output_sha256 === identitySha
    && inheritedNormalization.source_width === width && inheritedNormalization.source_height === height
    && inheritedNormalization.target_width === width && inheritedNormalization.target_height === height
    && inheritedNormalization.output_width === width && inheritedNormalization.output_height === height
    && inheritedNormalization.preserve_alpha === (asset.alpha === true)
    && inheritedNormalization.operation === "not-required";
  const normalization = Object.hasOwn(asset, "normalization_record")
    ? asset.normalization_record
    : (inheritedMatchesAsset ? inheritedNormalization : normalizationRecordForAsset({ sourceFile, outputFile, width, height, alpha: asset.alpha, sha256: identitySha }));
  asset.normalization_record = normalization;
  if (asset.generation_record && typeof asset.generation_record === "object") asset.generation_record = { ...asset.generation_record, normalization_record: normalization };
  if (asset.generation_record) { asset.generation_record.candidate_sha256 ??= HASH; prepareTransparencyFixture(asset.generation_record, asset); }
  return asset;
}

/** 固定回归夹具：①–④、⑦–⑨均声明 图像生成，只有①和⑦交付 PNG。 */
const IMAGEGEN_REGRESSION_FIXTURES = [
  { number: "①", annotation_number: 1, delivery_kind: "raster-image", mime_type: "image/png" },
  { number: "②", annotation_number: 2, delivery_kind: "vector-image", mime_type: "image/svg+xml" },
  { number: "③", annotation_number: 3, delivery_kind: "runtime-drawing", mime_type: "application/graphics" },
  { number: "④", annotation_number: 4, delivery_kind: "vector-image", mime_type: "image/svg+xml" },
  { number: "⑦", annotation_number: 7, delivery_kind: "raster-image", mime_type: "image/png" },
  { number: "⑧", annotation_number: 8, delivery_kind: "runtime-drawing", mime_type: "application/graphics" },
  { number: "⑨", annotation_number: 9, delivery_kind: "vector-image", mime_type: "image/svg+xml" },
];

/** 组装固定回归夹具的完整 V4 清单，确保测试走总门而不是只拼接单项 helper。 */
function v4FixtureManifest(fixture) {
  const componentId = `${fixture.number}-component`;
  const component = componentContract(componentId, fixture.number);
  const region = refreshAtomicRequirements({ ...component, id: fixture.number, annotation_number: fixture.annotation_number, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", expected_assets: [{ ...component.expected_assets[0], mime_type: fixture.mime_type }], asset_id: fixture.number });
  const asset = { ...imageGenAsset({ mime_type: fixture.mime_type, source_file: `art/${fixture.number}.png`, runtime_outputs: [`public/${fixture.number}.png`], generation_record: { ...imageGenAsset().generation_record, annotation_number: fixture.annotation_number, region_id: fixture.number, component_id: componentId, state_id: "default", asset_id: fixture.number, source_file: `art/${fixture.number}.png`, runtime_file: `public/${fixture.number}.png` } }), ...component, id: fixture.number, production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", expected_assets: [{ ...component.expected_assets[0], mime_type: fixture.mime_type }] };
  const identity = { evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const actualAsset = { asset_id: fixture.number, asset_scope: "atomic-component", atomic_visual_key: `${componentId}-visual`, file: `public/${fixture.number}.png`, component_id: componentId, state_id: "default", mime_type: fixture.mime_type, width: 64, height: 96, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" }, sha256: HASH };
  const placementIds = component.component_inventory.components[0].placements.map((placement) => placement.placement_id);
  const runtimeConsumption = { status: "passed", evidence: "runtime.json", ...identity, component_usages: [{ component_id: componentId, state_id: "default", asset_id: fixture.number, placement_ids: placementIds, runtime_file: `public/${fixture.number}.png`, runtime_sha256: HASH, status: "passed" }] };
  const audit = { status: "passed", candidate_version: "candidate-1", target_sha256: HASH, audited_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: fixture.annotation_number, region_id: fixture.number, observed_method: "image-generation", observed_delivery_kind: fixture.delivery_kind, status: "passed", expected_assets: region.expected_assets, atomic_image_requirements: region.atomic_image_requirements, interaction_hotspots: [], actual_assets: [actualAsset], runtime_consumption: runtimeConsumption }] };
  return { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH, diff_fingerprint: "diff-1" }, visual_baseline: { style_fingerprint: HASH }, reference_target: { target_sha256: HASH }, coverage_audit: { regions: [region] }, assets: [asset], production_contract_audit: audit, visual_production_gate: { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", baselineHash: HASH, diffFingerprint: "diff-1" }, f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json", ...identity }, fidelity_cases: [{ candidate_sha256: HASH, created_at: "2026-08-15T00:00:00Z", freshness_bound: true, evidence: "fidelity.json", ...identity }], candidate_sha256: HASH, target_sha256: HASH, runtime_consumption: runtimeConsumption, unapproved_substitution: false } };
}

test("independent-production 显式 graphics 不推断 图像生成", () => {
  assert.deepEqual(validateProductionContract(independentContract()), []);
});

test("generate-now 仍必须显式声明方法，不自动改成 图像生成", () => {
  assert.deepEqual(validateProductionContract(independentContract({ implementation_plan: { mode: "generate-now" } })), []);
});

test("image_generation_required 强制 imagegen 与 raster-image", () => {
  const errors = validateProductionContract(independentContract({ image_generation_required: true, generation_record_required: true, delivery_kind: "vector-image" }), { annotation_number: 1, region_id: "r1" });
  assert(errors.some((item) => item.includes("expected_method=image-generation")));
  assert(errors.some((item) => item.includes("raster-image")));
});

test("SVG、Graphics 和 CanvasTexture 不能等价完成 图像生成", () => {
  for (const delivery_kind of ["vector-image", "runtime-drawing", "runtime-program"]) {
    const errors = validateProductionContract(independentContract({ image_generation_required: true, generation_record_required: true, delivery_kind }), { annotation_number: 2, region_id: "r2" });
    assert(errors.length > 0, delivery_kind);
  }
});

test("图像生成 缺少生成记录和提示词时拒绝", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  const errors = validateImageGenerationContract({}, contract, { stage: "V3", annotation_number: 3, region_id: "r3" });
  assert(errors.some((item) => item.includes("generation_record")));
});

test("V4 图像运行验收检查资源身份和实际消费，摘要错误不阻断", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  const errors = validateImageGenerationContract(imageGenAsset({ width: 0, sha256: "bad", runtime_consumption: null, runtime_consumed: true }), contract, { stage: "V4", annotation_number: 4, region_id: "r4" }, { requireRuntimeConsumption: true });
  assert(errors.some((item) => item.includes("width")));
  assert.equal(errors.some((item) => item.includes("SHA-256")), false, errors.join("\n"));
  assert(errors.some((item) => item.includes("runtime_consumption")));
});

test("生图分类允许不同实际生成器，但仍要求工具身份和版本", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  for (const generator of ["local-render-model", "provider-image-tool", "imagegen"]) {
    const asset = imageGenAsset();
    asset.generation_record.generator = generator;
    assert.deepEqual(validateImageGenerationContract(asset, contract), []);
    delete asset.generation_record.generator_version;
    assert(validateImageGenerationContract(asset, contract).some((error) => error.includes("generator_version")));
    delete asset.generation_record.generator;
    assert(validateImageGenerationContract(asset, contract).some((error) => error.includes("generation_record.generator 缺失")));
  }
});

test("V3 资源门不要求正式运行消费，V4 才要求逐部件 runtime_consumption", () => {
  const region = componentContract("component-v3", "asset-v3");
  const expected = region.expected_assets[0];
  const auditUnit = { actual_assets: [{ ...expected, file: expected.runtime_file, mime_type: "image/png", sha256: HASH, width: 64, height: 64, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" } }] };
  assert.deepEqual(validateComponentAuditEvidence(region, auditUnit, { stage: "V3", annotation_number: 1, region_id: region.id }), []);
  assert(validateComponentAuditEvidence(region, auditUnit, { stage: "V4", annotation_number: 1, region_id: region.id }).some((item) => item.includes("runtime_consumption.component_usages")));
});

test("文件门只对 V3 资源和 V4 正式验收开启，已移除阶段不作为运行门", () => {
  const manifest = { effect_image_reconstruction: { applicability: "effect-image" } };
  assert.equal(requiresVisualFileGate(manifest, "V3"), true);
  assert.equal(requiresVisualFileGate(manifest, "V5"), false);
  assert.equal(requiresVisualFileGate(manifest, "V4"), true);
  assert.equal(productionFileGateError(manifest, {}, "V4").startsWith("[V4]"), true);
});

test("透明硬边去背必须保持已冻结背景与处理记录", () => {
  const asset = imageGenAsset();
  const expectedAsset = { asset_id: "hero", source_file: asset.source_file, runtime_file: asset.runtime_outputs[0], width: 64, height: 96, mime_type: "image/png", alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" } };
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, expected_assets: [expectedAsset] });
  assert.deepEqual(validateImageGenerationContract(asset, contract), []);

  // 直接透明路线不再属于透明生图成功路径，必须由合同明确拒绝。
  const directAlphaAsset = imageGenAsset();
  Object.assign(directAlphaAsset.generation_record, { generator: "local-render-model", full_prompt: "生成完整角色，交付透明 PNG", source_background_mode: "transparent", transparency_strategy: "direct-alpha", raw_source_file: directAlphaAsset.source_file, raw_source_has_alpha: true, postprocess: [], background_removal_attempts: [] });
  const errors = validateImageGenerationContract(directAlphaAsset, contract);
  assert(errors.some((error) => error.includes("direct-alpha") || error.includes("source_background_mode")), errors.join("\n"));
});

test("图像生成 禁止裁切参考图", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  const asset = imageGenAsset({ generation_record: { ...imageGenAsset().generation_record, crop_reference: true } });
  assert(validateImageGenerationContract(asset, contract, { annotation_number: 5, region_id: "r5" }).some((item) => item.includes("禁止裁切参考图")));
});

test("图像生成 只接受 PNG/JPEG，通用 authored-raster 仍不受影响", () => {
  const makeContract = (mime, extension) => {
    const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", expected_assets: [{ asset_id: "imagegen-asset", mime_type: mime, source_file: `art/imagegen.${extension}`, runtime_file: `public/imagegen.${extension}` }] });
    delete contract.runtime_implementation;
    return contract;
  };
  const webpErrors = validateProductionContract(makeContract("image/webp", "webp"), { annotation_number: 10, region_id: "imagegen-webp" });
  assert(webpErrors.some((item) => item.includes("仅允许 image/png 或 image/jpeg")));
  assert.deepEqual(validateProductionContract(makeContract("image/png", "png")), []);
  assert.deepEqual(validateProductionContract(makeContract("image/jpeg", "jpg")), []);
  const authored = independentContract({ production_method: "authored-raster", delivery_kind: "raster-image", expected_assets: [{ asset_id: "authored", mime_type: "image/webp", source_file: "art/authored.webp", runtime_file: "public/authored.webp" }] });
  delete authored.runtime_implementation;
  assert.deepEqual(validateProductionContract(authored), []);
});

test("图像生成 输出 MIME/源运行时后缀拒绝 WebP，PNG 和 JPEG 通过", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  delete contract.runtime_implementation;
  const webpErrors = validateImageGenerationContract(imageGenAsset({ mime_type: "image/webp", source_file: "art/hero.webp", runtime_outputs: ["public/assets/hero.webp"] }), contract, { annotation_number: 11, region_id: "imagegen-output-webp" });
  assert(webpErrors.some((item) => item.includes("仅允许 image/png 或 image/jpeg") || item.includes("扩展名仅允许")));
  const jpg = imageGenAsset({ mime_type: "image/jpeg", source_file: "art/hero.jpg", runtime_outputs: ["public/assets/hero.jpg"], generation_record: { ...imageGenAsset().generation_record, source_file: "art/hero.jpg", runtime_file: "public/assets/hero.jpg", output_file: "public/assets/hero.jpg" } });
  assert(!validateImageGenerationContract(jpg, contract, { annotation_number: 12, region_id: "imagegen-output-jpg" }).some((item) => item.includes("仅允许") || item.includes("扩展名仅允许")));
});

test("expected_assets.alpha=false 不触发透明背景移除合同，普通 JPEG 图像生成 仍可通过", () => {
  const expectedAsset = { asset_id: "opaque-image", source_file: "art/opaque.jpg", runtime_file: "public/opaque.jpg", mime_type: "image/jpeg", alpha: false };
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", expected_assets: [expectedAsset] });
  delete contract.runtime_implementation;
  assert.deepEqual(validateProductionContract(contract, { annotation_number: 12, region_id: "opaque-image" }), []);
  const asset = imageGenAsset({ source_file: expectedAsset.source_file, mime_type: expectedAsset.mime_type, alpha: false, runtime_outputs: [expectedAsset.runtime_file], generation_record: { ...imageGenAsset().generation_record, source_file: expectedAsset.source_file, runtime_file: expectedAsset.runtime_file, output_file: expectedAsset.runtime_file } });
  const errors = validateImageGenerationContract(asset, contract, { annotation_number: 12, region_id: "opaque-image" });
  assert(!errors.some((item) => item.includes("透明 图像生成")), errors.join("\n"));
});

test("图像生成 所有多路径入口逐项拒绝非法格式和重复别名", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  delete contract.runtime_implementation;
  const assetSourceFiles = imageGenAsset({ source_files: ["art/hero.png", "art/hero.webp"] });
  const assetErrors = validateImageGenerationContract(assetSourceFiles, contract, { stage: "V3", annotation_number: 13, region_id: "asset-source-files" });
  assert(assetErrors.some((item) => item.includes("扩展名仅允许") && item.includes("source_files")), assetErrors.join("\n"));
  const generationSourceFiles = imageGenAsset({ generation_record: { ...imageGenAsset().generation_record, source_files: ["art/hero.png", "art/hero.webp"] } });
  const generationErrors = validateImageGenerationContract(generationSourceFiles, contract, { stage: "V3", annotation_number: 14, region_id: "generation-source-files" });
  assert(generationErrors.some((item) => item.includes("扩展名仅允许") && item.includes("source_files")), generationErrors.join("\n"));
  const aliasContract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", expected_assets: [{ asset_id: "alias-asset", source_file: "art/alias.png", sourceFile: "art/alias.webp", runtime_file: "public/alias.png", mime_type: "image/png" }] });
  delete aliasContract.runtime_implementation;
  const aliasErrors = validateProductionContract(aliasContract, { stage: "V3", annotation_number: 15, region_id: "expected-asset-alias" });
  assert(aliasErrors.some((item) => item.includes("别名") || item.includes("snake_case")), aliasErrors.join("\n"));

  const packageRegion = refreshAtomicRequirements({ ...multiComponentRegion(1), id: "package-imagegen-alias", annotation_number: 16, production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  packageRegion.expected_assets[0] = { ...packageRegion.expected_assets[0], source_files: ["art/component-1.png", "art/component-1.webp"], mime_type: "image/png" };
  refreshAtomicRequirements(packageRegion);
  const packageUnit = { ...structuredClone(packageRegion), unitId: "PACKAGE-IMAGEGEN-ALIAS", region_id: packageRegion.id, owner: "implementer", ownedPaths: ["art"], outputPaths: ["public"], format: "png" };
  const packageErrors = validateVisualProductionUnits({ visualProductionUnits: [packageUnit] }, { coverage_audit: { regions: [packageRegion] } });
  assert(packageErrors.some((item) => item.includes("source_files") && item.includes("扩展名仅允许")), packageErrors.join("\n"));
});

test("图像生成 source_files/sourceFiles 逐项检查，纯 PNG/JPG/JPEG 通过而混入非法格式失败", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  delete contract.runtime_implementation;
  for (const field of ["source_files", "sourceFiles"]) {
    const valid = imageGenAsset({ [field]: ["art/one.png", "art/two.jpg", "art/three.jpeg"] });
    const validErrors = validateImageGenerationContract(valid, contract, { stage: "V3", annotation_number: 20, region_id: `${field}-valid` });
    assert(!validErrors.some((item) => item.includes("扩展名仅允许") || item.includes("source_files/sourceFiles")), validErrors.join("\n"));
    const validGeneration = imageGenAsset({ generation_record: { ...imageGenAsset().generation_record, [field]: ["art/one.png", "art/two.jpg", "art/three.jpeg"] } });
    const validGenerationErrors = validateImageGenerationContract(validGeneration, contract, { stage: "V3", annotation_number: 20, region_id: `${field}-generation-valid` });
    assert(!validGenerationErrors.some((item) => item.includes("扩展名仅允许") || item.includes("source_files/sourceFiles")), validGenerationErrors.join("\n"));
    const mixed = imageGenAsset({ [field]: ["art/one.png", "art/two.webp", "art/three.jpeg"] });
    const mixedErrors = validateImageGenerationContract(mixed, contract, { stage: "V3", annotation_number: 21, region_id: `${field}-mixed` });
    assert(mixedErrors.some((item) => item.includes("扩展名仅允许") && item.includes(field)), mixedErrors.join("\n"));
    const mixedGeneration = imageGenAsset({ generation_record: { ...imageGenAsset().generation_record, [field]: ["art/one.png", "art/two.webp", "art/three.jpeg"] } });
    const mixedGenerationErrors = validateImageGenerationContract(mixedGeneration, contract, { stage: "V3", annotation_number: 21, region_id: `${field}-generation-mixed` });
    assert(mixedGenerationErrors.some((item) => item.includes("扩展名仅允许") && item.includes(field)), mixedGenerationErrors.join("\n"));
  }
  const conflict = imageGenAsset({ source_files: ["art/one.png"], sourceFiles: ["art/two.webp"] });
  const conflictErrors = validateImageGenerationContract(conflict, contract, { stage: "V3", annotation_number: 22, region_id: "source-file-alias-conflict" });
  assert(conflictErrors.some((item) => item.includes("source_files/sourceFiles") && item.includes("冲突")), conflictErrors.join("\n"));
});

test("图像生成 不得被 output/output_metadata 的合法顶层 MIME 掩盖", () => {
  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  delete contract.runtime_implementation;
  const nestedInvalid = imageGenAsset({
    output: { mime_type: "image/png", file: "public/hero.png" },
    output_metadata: { mime_type: "image/webp", path: "public/hero.webp" },
  });
  const nestedErrors = validateImageGenerationContract(nestedInvalid, contract, { stage: "V4", annotation_number: 23, region_id: "nested-output-metadata" });
  assert(nestedErrors.some((item) => item.includes("output_metadata.mime_type") && item.includes("image/png 或 image/jpeg")), nestedErrors.join("\n"));
  assert(nestedErrors.some((item) => item.includes("output_metadata.path") && item.includes("扩展名仅允许")), nestedErrors.join("\n"));

  const nestedAliasConflict = imageGenAsset({
    output: { mime_type: "image/png", mimeType: "image/webp", file: "public/hero.png", path: "public/hero.webp" },
  });
  const aliasErrors = validateImageGenerationContract(nestedAliasConflict, contract, { stage: "V4", annotation_number: 24, region_id: "nested-output-alias" });
  assert(aliasErrors.some((item) => item.includes("output.mime_type") && item.includes("冲突")), aliasErrors.join("\n"));
  assert(aliasErrors.some((item) => item.includes("output.file/path") && item.includes("冲突")), aliasErrors.join("\n"));

  const manifestAssetConflict = imageGenAsset({ mime_type: "image/png", output_file: "public/asset-a.png", output: { mime_type: "image/jpeg", file: "public/asset-b.png" } });
  const manifestErrors = validateImageGenerationContract(manifestAssetConflict, contract, { stage: "V4", annotation_number: 25, region_id: "manifest-asset-identity" });
  assert(manifestErrors.some((item) => item.includes("统一输出身份MIME") && item.includes("冲突")), manifestErrors.join("\n"));
  assert(manifestErrors.some((item) => item.includes("统一输出身份路径") && item.includes("冲突")), manifestErrors.join("\n"));

  const generationRecordConflict = imageGenAsset({ generation_record: { ...imageGenAsset().generation_record, mime_type: "image/png", output_file: "public/generation-a.png", output: { mime_type: "image/jpeg", file: "public/generation-b.png" } } });
  const generationErrors = validateImageGenerationContract(generationRecordConflict, contract, { stage: "V3", annotation_number: 26, region_id: "generation-record-identity" });
  assert(generationErrors.some((item) => item.includes("统一输出身份MIME") && item.includes("冲突")), generationErrors.join("\n"));
  assert(generationErrors.some((item) => item.includes("统一输出身份路径") && item.includes("冲突")), generationErrors.join("\n"));

  const consistent = imageGenAsset({ output: { mime_type: "image/png", file: "public/assets/hero.png" }, output_metadata: { mimeType: "image/png", path: "public/assets/hero.png" } });
  const consistentErrors = validateImageGenerationContract(consistent, contract, { stage: "V3", annotation_number: 27, region_id: "consistent-output-identity" });
  assert(!consistentErrors.some((item) => item.includes("统一输出身份")), consistentErrors.join("\n"));

  const authored = independentContract({ production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: [{ asset_id: "authored-nested", source_file: "art/authored.webp", runtime_file: "public/authored.webp", output: { mime_type: "image/webp", file: "public/authored.webp" } }] });
  delete authored.runtime_implementation;
  assert.deepEqual(validateProductionContract(authored), []);
});

test("V4 actual、runtime usage 和 runtime_outputs 的 snake/camel 别名冲突必须失败", () => {
  const region = refreshAtomicRequirements({ ...multiComponentRegion(1), id: "v4-alias-region", annotation_number: 17, production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  region.expected_assets[0] = { ...region.expected_assets[0], mime_type: "image/png", width: 1, height: 1, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" }, sha256: HASH };
  refreshAtomicRequirements(region);
  const expected = region.expected_assets[0];
  const placementIds = region.component_inventory.components[0].placements.map((placement) => placement.placement_id);
  const auditUnit = {
    actual_assets: [{ ...expected, file: expected.runtime_file, path: "public/component-1.webp", mime_type: "image/png", mimeType: "image/webp", sha256: HASH }],
    runtime_consumption: {
      component_usages: [{ component_id: expected.component_id, state_id: expected.state_id, asset_id: expected.asset_id, placement_ids: placementIds, runtime_file: expected.runtime_file, runtimeFile: "public/component-1.webp", runtime_sha256: HASH, status: "passed" }],
    },
  };
  const errors = validateComponentAuditEvidence(region, auditUnit, { stage: "V4", annotation_number: 17, region_id: region.id });
  assert(errors.some((item) => item.includes("file/path")), errors.join("\n"));
  assert(errors.some((item) => item.includes("mime_type/mimeType") || item.includes("mimeType")), errors.join("\n"));
  assert(errors.some((item) => item.includes("runtime_file/runtimeFile") || item.includes("runtimeFile")), errors.join("\n"));

  const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  delete contract.runtime_implementation;
  const outputAliasErrors = validateImageGenerationContract(imageGenAsset({ runtime_outputs: ["public/hero.png"], runtimeOutputs: ["public/hero.webp"] }), contract, { stage: "V4", annotation_number: 18, region_id: "runtime-output-alias" });
  assert(outputAliasErrors.some((item) => item.includes("runtime_outputs/runtimeOutputs") || item.includes("runtimeOutputs")), outputAliasErrors.join("\n"));
});

test("图像生成 PNG/JPEG 通过且 authored-raster 的 WebP/AVIF/GIF/BMP 不误伤", () => {
  const imageGenContract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  delete imageGenContract.runtime_implementation;
  for (const extension of ["png", "jpg", "jpeg"]) {
    const asset = imageGenAsset({ mime_type: extension === "png" ? "image/png" : "image/jpeg", source_file: `art/valid.${extension}`, runtime_outputs: [`public/valid.${extension}`] });
    const errors = validateImageGenerationContract(asset, imageGenContract, { stage: "V3", annotation_number: 19, region_id: `imagegen-${extension}` });
    assert(!errors.some((item) => item.includes("仅允许") || item.includes("扩展名仅允许")), errors.join("\n"));
  }
  for (const [extension, mime_type] of [["webp", "image/webp"], ["avif", "image/avif"], ["gif", "image/gif"], ["bmp", "image/bmp"]]) {
    const contract = independentContract({ production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: [{ asset_id: `authored-${extension}`, mime_type, source_file: `art/authored.${extension}`, runtime_file: `public/authored.${extension}` }] });
    delete contract.runtime_implementation;
    assert.deepEqual(validateProductionContract(contract), [], extension);
  }
});

test("图像生成 错误包含阶段、annotation number、region ID、期望和观察方法", () => {
  const errors = validateProductionContract(independentContract({ image_generation_required: true }), { stage: "V4", annotation_number: 6, region_id: "r6" });
  assert.match(errors[0], /\[V4\].*annotation_number=6.*region_id=r6.*expected_method=.*observed_method=/);
});

test("visualProductionUnits 拒绝重复编号和输出冲突", () => {
  const units = [
    { unitId: "U1", annotation_number: 1, region_id: "r1", production_origin: "independent-production", production_method: "cocos-graphics", delivery_kind: "runtime-drawing", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["r1"], owner: "a", ownedPaths: ["src/a"], outputPaths: ["public/shared.svg"] },
    { unitId: "U2", annotation_number: 1, region_id: "r2", production_origin: "independent-production", production_method: "cocos-graphics", delivery_kind: "runtime-drawing", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["r2"], owner: "b", ownedPaths: ["src/b"], outputPaths: ["public/shared.svg"] },
  ];
  const errors = validateVisualProductionUnits({ visualProductionUnits: units }, null, { allowedPaths: ["src", "public"], pathMatches: (path, pattern) => path === pattern || path.startsWith(`${pattern}/`) });
  assert(errors.some((item) => item.includes("重复")));
  assert(errors.some((item) => item.includes("输出路径与其他单元冲突")));
});

test("V4 production_contract_audit 必须逐区域匹配合同", async () => {
  const manifest = {
    coverage_audit: { regions: [{ id: "r1", annotation_number: 1, owner_type: "fixed-production-visual", production_method: "cocos-graphics", delivery_kind: "runtime-drawing", production_origin: "independent-production", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["a"] }] },
    production_contract_audit: { status: "passed", candidate_version: "c1", audited_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: 1, region_id: "r1", production_method: "authored-svg", delivery_kind: "vector-image", actual_assets: ["a"], status: "passed" }] },
  };
  const errors = await auditProductionContract(manifest, { checkFiles: false });
  assert(errors.some((item) => item.includes("V4 实际生产方式")));
});

test("V4 拒绝缺少 runtime replay 和 freshness fidelity cases", () => {
  const errors = validateV4ProductionGate({ visual_production_gate: { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", baselineHash: HASH, diffFingerprint: "diff-1" }, f3_status: "failed" } });
  assert(errors.some((item) => item.includes("runtime replay")));
  assert(errors.some((item) => item.includes("fidelity_cases")));
});

test("V4 通过要求 freshness、消费和无未批准替换", () => {
  const evidence = { status: "passed", evidence: "runtime.json", evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const gate = { production_contract_audit: { status: "passed" }, visual_production_gate: { status: "passed", v2_status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", baselineHash: HASH, diffFingerprint: "diff-1" }, f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json" }, fidelity_cases: [{ candidate_sha256: HASH, created_at: "2026-08-15T00:00:00Z", freshness_bound: true }], runtime_consumption: evidence, unapproved_substitution: false } };
  gate.visual_production_gate.candidate_sha256 = HASH; gate.visual_production_gate.target_sha256 = HASH;
  assert.deepEqual(validateV4ProductionGate(gate), []);
});

test("production method 变更必须绑定 ACCEPTED Change Request、区域、候选、原文和时间", () => {
  const pending = validateProductionMethodChangeRequest({ status: "PENDING", changeRequestId: "CR-1", workItemId: "WI-1", production_method_changes: [{ annotation_number: 1, region_id: "r1", previous_method: "cocos-graphics", proposed_method: "image-generation" }] });
  assert(pending.some((item) => item.includes("ACCEPTED")));
  const accepted = { status: "ACCEPTED", changeRequestId: "CR-1", workItemId: "WI-1", candidateVersion: "c2", candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1", user_original_text: "用户批准改为 图像生成", accepted_at: "2026-08-15T00:00:00Z", production_method_changes: [{ annotation_number: 1, region_id: "r1", previous_method: "cocos-graphics", proposed_method: "image-generation" }] };
  assert.deepEqual(validateProductionMethodChangeRequest(accepted), []);
});

test("image_generation_required=false 不因 independent-production 或 generate-now 推断 图像生成", () => {
  const contract = independentContract({ production_method: "authored-svg", delivery_kind: "vector-image", expected_assets: [{ asset_id: "svg", source_file: "art/svg.svg", runtime_file: "public/svg.svg" }] });
  delete contract.runtime_implementation;
  const errors = validateProductionContract(contract, { annotation_number: 9, region_id: "r9" });
  assert.deepEqual(errors, []);
});

test("编号②的六个顶部按钮不能由一张横向组图冒充", () => {
  const group = multiComponentRegion(6, "individual", [{ asset_id: "top-buttons-group", component_id: "top-buttons-group", state_id: "default", source_file: "art/top-buttons.png", runtime_file: "public/top-buttons.png" }]);
  const errors = validateVisualComponentContract(group, { stage: "V3", annotation_number: 2, region_id: "top-buttons-region" });
  assert(errors.some((item) => item.includes("component_id=component-1") && item.includes("expected_count=1") && item.includes("observed_count=0")));
});

test("编号⑧的三个底部表面和编号⑨的三个动作图标必须按部件独立交付", () => {
  for (const [annotation, count] of [[8, 3], [9, 3]]) {
    const shared = Array.from({ length: count }, (_, index) => ({ asset_id: "horizontal-group", component_id: `component-${index + 1}`, state_id: "default", source_file: "art/horizontal-group.png", runtime_file: "public/horizontal-group.png" }));
    const errors = validateVisualComponentContract(multiComponentRegion(count, "individual", shared), { stage: "V3", annotation_number: annotation, region_id: `region-${annotation}` });
    assert(errors.some((item) => item.includes("横向组图") || item.includes("共享同一源/运行文件")), String(annotation));
  }
});

test("正确的六个独立按钮资源通过，单图区域可显式声明不适用状态", () => {
  assert.deepEqual(validateVisualComponentContract(multiComponentRegion(6), { stage: "V3", annotation_number: 2, region_id: "top-buttons-region" }), []);
  assert.deepEqual(validateVisualComponentContract(multiComponentRegion(1), { stage: "V3", annotation_number: 3, region_id: "single-region" }), []);
});

test("重复视觉部件只登记一个原子组件并用多个 placements 表达", () => {
  const region = multiComponentRegion(1);
  const component = region.component_inventory.components[0];
  component.placements = [0, 1, 2].map((index) => ({ placement_id: `surface-placement-${index + 1}`, bounds: { x: index * 32, y: 0, width: 32, height: 32 }, interaction_required: false }));
  region.bounds.width = 96;
  region.component_inventory.visible_instance_count = 3;
  region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  assert.equal(region.component_inventory.component_count, 1);
  assert.equal(region.expected_assets.length, 1);
  assert.equal(region.atomic_image_requirements.length, 1);
  assert.deepEqual(validateVisualComponentContract(region, { stage: "V3", annotation_number: 8, region_id: "bottom-surfaces" }), []);
});

test("缺少 selected 或 victory/defeat 状态分析时拒绝，不能只写 default", () => {
  const region = multiComponentRegion(1);
  region.state_analysis.states = region.state_analysis.states.filter((state) => !["selected", "victory", "defeat"].includes(state.state_id));
  const errors = validateVisualComponentContract(region, { stage: "V3", annotation_number: 3, region_id: "missing-states" });
  assert(errors.some((item) => item.includes("缺少 selected 状态分析")));
  assert(errors.some((item) => item.includes("缺少 victory 状态分析")));
  assert(errors.some((item) => item.includes("缺少 defeat 状态分析")));
});

test("交互热区不计入视觉资产，合法 atlas 必须逐部件有唯一切片", () => {
  const atlasAssets = Array.from({ length: 6 }, (_, index) => ({ asset_id: "top-buttons-atlas", component_id: `component-${index + 1}`, state_id: "default", source_file: "art/top-buttons-atlas.png", runtime_file: "public/top-buttons-atlas.png", atlas_slice: { atlas_asset_id: "top-buttons-atlas", slice_id: `button-${index + 1}-default`, atlas_size: { width: 192, height: 32 }, rect: { x: index * 32, y: 0, width: 32, height: 32 } } }));
  const atlas = multiComponentRegion(6, "atlas", atlasAssets);
  atlas.component_inventory.components[0].placements[0].interaction_required = true;
  atlas.interaction_hotspots = [{ hotspot_id: "button-1-hit", component_id: "component-1", placement_id: "placement-1", bounds: { x: 0, y: 0, width: 32, height: 32 } }];
  assert.deepEqual(validateVisualComponentContract(atlas, { stage: "V3", annotation_number: 2, region_id: "top-buttons-atlas" }), []);
  const duplicatedSlice = structuredClone(atlas); duplicatedSlice.expected_assets[1].atlas_slice.slice_id = duplicatedSlice.expected_assets[0].atlas_slice.slice_id;
  assert(validateVisualComponentContract(duplicatedSlice, { stage: "V3", annotation_number: 2, region_id: "top-buttons-atlas" }).some((item) => item.includes("atlas_slice identity")));
  const hotArea = structuredClone(multiComponentRegion(1)); hotArea.expected_assets[0].asset_kind = "hit-area";
  assert(validateVisualComponentContract(hotArea, { stage: "V3", annotation_number: 3, region_id: "hot-area" }).some((item) => item.includes("交互热区")));
});

test("V4 atlas actual_assets 必须复核 V3 切片身份", () => {
  const region = multiComponentRegion(2, "atlas", [
    { asset_id: "atlas", component_id: "component-1", state_id: "default", source_file: "art/atlas.png", runtime_file: "public/atlas.png", sha256: HASH, atlas_slice: { atlas_asset_id: "atlas", slice_id: "one", atlas_size: { width: 40, height: 20 }, rect: { x: 0, y: 0, width: 20, height: 20 } } },
    { asset_id: "atlas", component_id: "component-2", state_id: "default", source_file: "art/atlas.png", runtime_file: "public/atlas.png", sha256: HASH, atlas_slice: { atlas_asset_id: "atlas", slice_id: "two", atlas_size: { width: 40, height: 20 }, rect: { x: 20, y: 0, width: 20, height: 20 } } },
  ]);
  const baseUnit = { actual_assets: region.expected_assets.map((asset) => ({ ...asset })), runtime_consumption: { component_usages: [{ component_id: "component-1", state_id: "default", asset_id: "atlas", placement_ids: ["placement-1"], runtime_file: "public/atlas.png", runtime_sha256: HASH, status: "passed", atlas_slice: region.expected_assets[0].atlas_slice }, { component_id: "component-2", state_id: "default", asset_id: "atlas", placement_ids: ["placement-2"], runtime_file: "public/atlas.png", runtime_sha256: HASH, status: "passed", atlas_slice: region.expected_assets[1].atlas_slice }] } };
  assert.deepEqual(validateComponentAuditEvidence(region, baseUnit, { stage: "V4", annotation_number: 2, region_id: "atlas" }), []);
  const stale = structuredClone(baseUnit); stale.actual_assets[1].atlas_slice.slice_id = "wrong";
  assert(validateComponentAuditEvidence(region, stale, { stage: "V4", annotation_number: 2, region_id: "atlas" }).some((item) => item.includes("atlas_slice identity")));
  const undersized = new Map([["atlas", { id: "atlas", width: 32, height: 20 }]]);
  assert(validateComponentAuditEvidence(region, baseUnit, { stage: "V4", annotation_number: 2, region_id: "atlas" }, { manifestAssets: undersized }).some((item) => item.includes("尺寸不一致")));
});

test("固定回归夹具①–④⑦–⑨只允许①⑦ PNG，错误交付被 V4/F2/V4 拒绝", async () => {
  for (const fixture of IMAGEGEN_REGRESSION_FIXTURES) {
    const contract = independentContract({ production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, expected_assets: [{ asset_id: fixture.number, mime_type: fixture.mime_type }] });
    const asset = imageGenAsset({ mime_type: fixture.mime_type });
    const v3Errors = validateImageGenerationContract(asset, contract, { stage: "V3", annotation_number: fixture.annotation_number, region_id: fixture.number });
    const region = { id: fixture.number, annotation_number: fixture.annotation_number, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "forbid", expected_assets: [{ asset_id: fixture.number, mime_type: fixture.mime_type }] };
    const v4Errors = await auditProductionContract({ coverage_audit: { regions: [region] }, production_contract_audit: { status: "passed", candidate_version: "fixture", audited_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: fixture.annotation_number, region_id: fixture.number, observed_method: "image-generation", observed_delivery_kind: fixture.delivery_kind, status: "passed", expected_assets: [fixture.number], actual_assets: [{ file: `art/${fixture.number}.png`, mime_type: fixture.mime_type }], runtime_consumption: { status: "passed" } }] } }, { checkFiles: false });
    if (["①", "⑦"].includes(fixture.number)) assert.deepEqual(v3Errors, [], fixture.number);
    else {
      assert(v3Errors.length > 0, `${fixture.number} V3 must reject non-PNG`);
      assert(v4Errors.length > 0, `${fixture.number} V4 must reject non-PNG`);
    }
    const f2Errors = validateVisualF2MachineGate({ status: "failed", validationMode: "MACHINE", baselineHash: HASH, diffFingerprint: "diff-1" }, { stage: "F2" });
    assert(f2Errors.length > 0, `${fixture.number} F2 must reject failed machine validation`);
    const gateErrors = validateV4ProductionGate({ visual_production_gate: { status: "failed", v3_status: "passed", implementation_package_status: "passed", v4_status: "failed", f2_status: "failed", f3_status: "failed" } });
    assert(gateErrors.length > 0, `${fixture.number} V4 must reject failed upstream gate`);
    const totalErrors = await validateV4VisualManifest(v4FixtureManifest(fixture));
    assert(totalErrors.some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")), `${fixture.number} V4 缺少文件门必须拒绝`);
  }
});

test("F2/V4 Evidence 缺少显式文件门必须拒绝", () => {
  const manifest = v4FixtureManifest(IMAGEGEN_REGRESSION_FIXTURES[0]);
  const pkg = { visualProductionUnits: [{ unitId: "U-1" }] };
  const evidence = { gateResults: { F2: manifest.visual_production_gate.f2_machine_validation, F3: { runtime_replay: manifest.visual_production_gate.runtime_replay } }, visual_production_gate: manifest.visual_production_gate };
  assert(validateVisualEvidence(evidence, pkg, { manifest, diffFingerprint: "diff-1" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
});

/** 构造带 production contract 的实施包夹具，专门覆盖逐部件路径绑定。 */
function implementationPackageFixture() {
  const region = refreshAtomicRequirements({ ...multiComponentRegion(2), id: "package-region", annotation_number: 2, production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid" });
  const unit = { ...structuredClone(region), unitId: "PACKAGE-1", region_id: "package-region", decomposition_confirmation_id: "confirm-package", decomposition_confirmation_sha256: HASH, owner: "implementer", ownedPaths: ["art", "public"], outputPaths: ["art", "public"], format: "png" };
  return { region, pkg: { visualProductionUnits: [unit], visualDecompositionConfirmations: [confirmationGroupFor(region, "confirm-package")] }, manifest: { coverage_audit: { regions: [region] } } };
}

/** 构造无图片输出的运行时实现区域，用于路径所有权和方法互斥回归。 */
function runtimeRegionFixture(annotationNumber = 1, regionId = `runtime-region-${annotationNumber}`, assetId = `runtime-asset-${annotationNumber}`) {
  return { id: regionId, annotation_number: annotationNumber, scene_id: "main-gameplay", state_id: "default", owner_type: "runtime-rendered", production_origin: "independent-production", production_method: "cocos-graphics", production_label: "程序绘制或动态逻辑", delivery_kind: "runtime-drawing", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", runtime_implementation: { kind: "cocos-graphics", integration_files: ["src/components/main.mjs"] } };
}

/** 构造带 ownedPaths/allowedPaths 的运行时实施包，便于区分合法文件与旁路路径。 */
function runtimePackageFixture(integrationFile = "src/components/main.mjs") {
  const region = runtimeRegionFixture();
  const unit = { ...structuredClone(region), unitId: "RUNTIME-PACKAGE-1", region_id: region.id, decomposition_confirmation_id: "confirm-runtime", decomposition_confirmation_sha256: HASH, owner: "implementer", ownedPaths: ["src/components"], outputPaths: ["public"], format: "runtime-program" };
  unit.runtime_implementation = { kind: "cocos-graphics", integration_files: [integrationFile] };
  return { pkg: { visualProductionUnits: [unit], visualDecompositionConfirmations: [confirmationGroupFor(region, "confirm-runtime")] }, manifest: { coverage_audit: { regions: [region] } } };
}

test("Implementation Package 不能偷偷替换部件 asset_id 或 source/runtime 文件", () => {
  const base = implementationPackageFixture();
  const swappedId = structuredClone(base.pkg); swappedId.visualProductionUnits[0].expected_assets[0].asset_id = "asset-secret";
  const idErrors = validateVisualProductionUnits(swappedId, base.manifest);
  assert(idErrors.some((item) => item.includes("asset_id 与 coverage 不一致")), idErrors.join("\n"));
  const swappedFile = structuredClone(base.pkg); swappedFile.visualProductionUnits[0].expected_assets[1].runtime_file = "public/secret.png";
  const fileErrors = validateVisualProductionUnits(swappedFile, base.manifest);
  assert(fileErrors.some((item) => item.includes("runtime_file 与 coverage 不一致")), fileErrors.join("\n"));
});

test("Implementation Package 的来源、图像生成 开关和替换策略必须逐字段匹配 coverage", () => {
  const base = implementationPackageFixture();
  for (const [field, value] of [["production_origin", "bitmap-decomposition"], ["image_generation_required", true], ["generation_record_required", true], ["substitution_policy", "user-change-request-only"]]) {
    const changed = structuredClone(base.pkg); changed.visualProductionUnits[0][field] = value;
    const errors = validateVisualProductionUnits(changed, base.manifest);
    assert(errors.some((item) => item.includes(`${field} 与 coverage 不一致`)), `${field}: ${errors.join("\n")}`);
  }
});

test("runtime_implementation.integration_files 重排等价、重复失败，文件方法与运行时方法互斥", () => {
  const runtime = runtimeRegionFixture();
  runtime.runtime_implementation.integration_files = ["src/components/b.mjs", "src/components/a.mjs"];
  assert.deepEqual(validateVisualComponentContract(runtime, { stage: "V3", annotation_number: 1, region_id: runtime.id }), []);
  const reordered = structuredClone(runtime);
  reordered.runtime_implementation.integration_files.reverse();
  assert.deepEqual(validateVisualComponentContract(reordered, { stage: "V3", annotation_number: 1, region_id: runtime.id }), []);
  const duplicate = structuredClone(runtime);
  duplicate.runtime_implementation.integration_files.push("src/components/./a.mjs");
  assert(validateVisualComponentContract(duplicate, { stage: "V3", annotation_number: 1, region_id: runtime.id }).some((item) => item.includes("integration_files 不得重复")));

  const authored = multiComponentRegion(1);
  Object.assign(authored, { production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", runtime_implementation: { kind: "cocos-graphics", integration_files: ["src/components/main.mjs"] } });
  const authoredErrors = validateVisualComponentContract(authored, { stage: "V3", annotation_number: 1, region_id: "authored-route" });
  assert(authoredErrors.some((item) => item.includes("文件交付不得携带 runtime_implementation")), authoredErrors.join("\n"));
  const nullRuntime = validateProductionContract({ ...authored, runtime_implementation: null }, { stage: "V3", annotation_number: 1, region_id: "authored-null-route" });
  assert(nullRuntime.some((item) => item.includes("文件交付不得携带 runtime_implementation")), nullRuntime.join("\n"));
  const missingRuntime = structuredClone(runtime);
  delete missingRuntime.runtime_implementation;
  const missingErrors = validateVisualComponentContract(missingRuntime, { stage: "V3", annotation_number: 1, region_id: "runtime-route" });
  assert(missingErrors.some((item) => item.includes("必须声明 runtime_implementation")), missingErrors.join("\n"));
});

test("Implementation Package 拒绝 ../../outside.mjs 和未授权 sibling，接受合法 owned path", () => {
  const valid = runtimePackageFixture();
  const options = { allowedPaths: ["src/components", "public"], pathMatches: (path, pattern) => path === pattern || path.startsWith(`${pattern}/`) };
  assert.deepEqual(validateVisualProductionUnits(valid.pkg, valid.manifest, options), []);
  const escaped = runtimePackageFixture("../../outside.mjs");
  const escapedErrors = validateVisualProductionUnits(escaped.pkg, escaped.manifest, options);
  assert(escapedErrors.some((item) => item.includes("../../outside.mjs") && item.includes("项目内相对路径")), escapedErrors.join("\n"));
  const sibling = runtimePackageFixture("src/sibling.mjs");
  const siblingErrors = validateVisualProductionUnits(sibling.pkg, sibling.manifest, options);
  assert(siblingErrors.some((item) => item.includes("超出 allowedPaths") || item.includes("ownedPaths 未覆盖")), siblingErrors.join("\n"));
});

test("图像生成 跨单元即使同 owner 同 share_id 也禁止共享 source/runtime/output", () => {
  const registry = new Map();
  const errors = [];
  const first = { unitId: "IMAGEGEN-1", owner: "implementer", production_method: "image-generation", image_generation_required: true };
  const second = { unitId: "IMAGEGEN-2", owner: "implementer", production_method: "image-generation", image_generation_required: true };
  for (const kind of ["source_file", "runtime_file", "outputPaths"]) {
    registerCrossUnitPath(registry, `public/shared-${kind}.png`, kind, first, "same-share", (message) => errors.push(message));
    registerCrossUnitPath(registry, `public/shared-${kind}.png`, kind, second, "same-share", (message) => errors.push(message));
  }
  assert.equal(errors.length, 3, errors.join("\n"));
  assert(errors.every((item) => item.includes("与其他单元冲突") && item.includes("public/shared-")), errors.join("\n"));
});

test("visualOutputPaths 对象必须单选 file/path 且 share_id/shareId 不能并存", () => {
  assert.equal(declaredPathEntry({ file: "public/a.png", path: "public/b.png" }).valid, false);
  assert.equal(declaredPathEntry({ path: "public/a.png", share_id: "a", shareId: "b" }).valid, false);
  const fixture = runtimePackageFixture();
  fixture.pkg.visualProductionUnits[0].outputPaths = [{ file: "public/a.png", path: "public/b.png" }];
  const filePathErrors = validateVisualProductionUnits(fixture.pkg, fixture.manifest);
  assert(filePathErrors.some((item) => item.includes("只能声明 file 或 path 之一")), filePathErrors.join("\n"));
  fixture.pkg.visualProductionUnits[0].outputPaths = [{ path: "public/a.png", share_id: "a", shareId: "b" }];
  const shareErrors = validateVisualProductionUnits(fixture.pkg, fixture.manifest);
  assert(shareErrors.some((item) => item.includes("share_id 与 shareId 不得同时声明")), shareErrors.join("\n"));
  const outputSchema = IMPLEMENTATION_PACKAGE_SCHEMA.$defs.visualOutputPaths.items.oneOf[1];
  assert(outputSchema.allOf.some((rule) => JSON.stringify(rule).includes("share_id") && JSON.stringify(rule).includes("shareId")));
});

test("项目路径规范化拒绝 Windows 物理别名并保留合法点号文件名", () => {
  assert.equal(normalizeProjectRelativePath("PUBLIC/./Foo.PNG"), "public/foo.png");
  assert.equal(normalizeProjectRelativePath(".well-known/Foo.Bar"), ".well-known/foo.bar");
  assert.equal(normalizeProjectRelativePath("public/foo~bar.png"), "public/foo~bar.png");
  for (const path of ["public/foo.png.", "public/foo.png ", "public/foo.png:ads", "public/foo\u0000.png", "public/<foo>.png", "public/foo>bar.png", "public/foo\"bar.png", "public/foo|bar.png", "public/foo?bar.png", "public/foo*bar.png", "public/PH98F1~1", "public/foo~12.png", "public/VISUAL~1.MJS"]) {
    assert.equal(normalizeProjectRelativePath(path), null, path);
  }
  for (const device of ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9", "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³", "CONIN$", "CONOUT$", "CLOCK$"]) {
    assert.equal(normalizeProjectRelativePath(`public/${device}`), null, device);
    assert.equal(normalizeProjectRelativePath(`public/${device}.txt`), null, device);
  }
  const longAndAlias = multiComponentRegion(2);
  longAndAlias.expected_assets[0].source_file = "art/visual-long-name.png";
  longAndAlias.expected_assets[1].source_file = "art/VISUAL~1.png";
  const aliasErrors = validateVisualComponentContract(longAndAlias, { stage: "V3", annotation_number: 2, region_id: "path-alias" });
  assert(aliasErrors.some((item) => item.includes("expected_assets[1]") && item.includes("项目内相对路径")), aliasErrors.join("\n"));
});

test("跨单元路径祖先/后代重叠必须拒绝，同一单元 share_id 不一致也不得由首条声明授权", () => {
  const first = runtimePackageFixture("src/components/first.mjs");
  const second = runtimePackageFixture("src/components/second.mjs");
  second.pkg.visualProductionUnits[0].unitId = "RUNTIME-PACKAGE-2";
  second.pkg.visualProductionUnits[0].region_id = "runtime-region-2";
  second.pkg.visualProductionUnits[0].annotation_number = 2;
  second.manifest.coverage_audit.regions[0].id = "runtime-region-2";
  second.manifest.coverage_audit.regions[0].annotation_number = 2;
  first.pkg.visualProductionUnits[0].outputPaths = ["public"];
  second.pkg.visualProductionUnits[0].outputPaths = ["public/assets/x.png"];
  const overlapErrors = validateVisualProductionUnits({ visualProductionUnits: [first.pkg.visualProductionUnits[0], second.pkg.visualProductionUnits[0]] }, { coverage_audit: { regions: [first.manifest.coverage_audit.regions[0], second.manifest.coverage_audit.regions[0]] } });
  assert(overlapErrors.some((item) => item.includes("outputPaths 路径与其他单元冲突") && item.includes("public/assets/x.png")), overlapErrors.join("\n"));

  const mismatch = implementationPackageFixture();
  mismatch.pkg.visualProductionUnits[0].outputPaths = [{ path: "public/component-1.png", share_id: "output-share" }, "public"];
  mismatch.pkg.visualProductionUnits[0].expected_assets[0].share_id = "asset-share";
  const mismatchErrors = validateVisualProductionUnits(mismatch.pkg, mismatch.manifest);
  assert(mismatchErrors.some((item) => item.includes("同一单元既有声明的 share_id 不一致")), mismatchErrors.join("\n"));
});

test("Implementation Package 跨单元按规范化路径拒绝 PUBLIC/SHARED.PNG 与 public/shared.png，合法 share_id 可共享", () => {
  const first = implementationPackageFixture();
  const secondRegion = structuredClone(first.region);
  secondRegion.id = "package-region-2";
  secondRegion.annotation_number = 3;
  const secondUnit = structuredClone(first.pkg.visualProductionUnits[0]);
  secondUnit.unitId = "PACKAGE-2";
  secondUnit.region_id = secondRegion.id;
  secondUnit.annotation_number = 3;
  first.pkg.visualProductionUnits[0].outputPaths = ["art", "public", "PUBLIC/SHARED.PNG"];
  secondUnit.outputPaths = ["art", "public", "public/./shared.png"];
  const conflict = validateVisualProductionUnits({ visualProductionUnits: [first.pkg.visualProductionUnits[0], secondUnit], visualDecompositionConfirmations: [confirmationGroupFor(first.region, "confirm-package"), confirmationGroupFor(secondRegion, "confirm-package")] }, { coverage_audit: { regions: [first.region, secondRegion] } });
  assert(conflict.some((item) => item.includes("输出路径与其他单元冲突")), conflict.join("\n"));
  assert(conflict.some((item) => item.includes("source_file 路径与其他单元冲突")), conflict.join("\n"));

  const shared = implementationPackageFixture();
  const sharedRegion = structuredClone(shared.region);
  sharedRegion.id = "package-region-shared";
  sharedRegion.annotation_number = 3;
  refreshAtomicRequirements(sharedRegion);
  const sharedUnit = structuredClone(shared.pkg.visualProductionUnits[0]);
  sharedUnit.unitId = "PACKAGE-SHARED-2";
  sharedUnit.id = sharedRegion.id;
  sharedUnit.region_id = sharedRegion.id;
  sharedUnit.annotation_number = 3;
  refreshAtomicRequirements(sharedUnit);
  sharedUnit.owner = shared.pkg.visualProductionUnits[0].owner;
  const shareId = "shared-visual-output";
  for (const asset of sharedRegion.expected_assets) asset.share_id = shareId;
  for (const asset of shared.region.expected_assets) asset.share_id = shareId;
  for (const asset of sharedUnit.expected_assets) asset.share_id = shareId;
  for (const asset of shared.pkg.visualProductionUnits[0].expected_assets) asset.share_id = shareId;
  shared.pkg.visualProductionUnits[0].outputPaths = [{ path: "PUBLIC", share_id: shareId }];
  sharedUnit.outputPaths = [{ path: "public/.", share_id: shareId }];
  const sharedErrors = validateVisualProductionUnits({ visualProductionUnits: [shared.pkg.visualProductionUnits[0], sharedUnit], visualDecompositionConfirmations: [confirmationGroupFor(shared.region, "confirm-package"), confirmationGroupFor(sharedRegion, "confirm-package")] }, { coverage_audit: { regions: [shared.region, sharedRegion] } });
  assert.deepEqual(sharedErrors, [], sharedErrors.join("\n"));
});

/** 构造一个所有 expected asset 均具备独立 图像生成 记录的多部件区域。 */
function multiImageGenerationManifest(count = 6) {
  const region = refreshAtomicRequirements({ ...multiComponentRegion(count), id: "multi-image-region", annotation_number: 2, production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  const identity = { evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const assets = region.expected_assets.map((expected, index) => {
    const asset = { id: expected.asset_id, source_file: expected.source_file, mime_type: "image/png", width: 32, height: 32, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" }, sha256: HASH, runtime_outputs: [expected.runtime_file], runtime_consumption: { status: "passed", evidence: "evidence/runtime.json", ...identity }, generation_record: { ...imageGenAsset().generation_record, record_id: `GEN-${index + 1}`, annotation_number: region.annotation_number, region_id: region.id, component_id: expected.component_id, state_id: expected.state_id, asset_id: expected.asset_id, source_file: expected.source_file, runtime_file: expected.runtime_file } };
    if (index > 0) delete asset.generation_record;
    return asset;
  });
  return { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH, diff_fingerprint: "diff-1" }, visual_baseline: { style_fingerprint: HASH }, reference_target: { target_sha256: HASH }, coverage_audit: { regions: [region] }, assets };
}

test("六按钮只有第一张有 generation_record 时，V3 必须逐部件拒绝其余五张", () => {
  const errors = validateVisualProductionCoverage(multiImageGenerationManifest(6), { stage: "V3" });
  assert(errors.some((item) => item.includes("component_id=component-2") && item.includes("generation_record")), errors.join("\n"));
  assert(errors.some((item) => item.includes("component_id=component-6") && item.includes("generation_record")), errors.join("\n"));
});

test("多部件 图像生成 不得复用同一个 generation_record.record_id", () => {
  const manifest = multiImageGenerationManifest(2);
  manifest.assets[1].generation_record = { ...structuredClone(manifest.assets[0].generation_record), component_id: "component-2", asset_id: "asset-2", source_file: "art/component-2.png", runtime_file: "public/component-2.png" };
  const errors = validateVisualProductionCoverage(manifest, { stage: "V3" });
  assert(errors.some((item) => item.includes("record_id=GEN-1") && item.includes("component_id=component-2")), errors.join("\n"));
});

test("V4 文件门不按 RGBA 像素摘要拒绝不同 ID/路径的重复 PNG", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-raster-dedupe-")); await mkdir(join(root, "evidence"), { recursive: true }); await writeFile(join(root, "evidence/runtime.json"), "runtime");
  const png = encodePngRgba(2, 2, Buffer.alloc(16, 128)); const pngSha = "stale-summary-is-optional"; const identity = { evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const region = refreshAtomicRequirements({ ...multiComponentRegion(2), id: "duplicate-pixels", annotation_number: 5, production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  region.expected_assets = region.expected_assets.map((asset, index) => ({ ...asset, mime_type: "image/png", width: 2, height: 2, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" }, sha256: pngSha, source_file: `art/unique-${index + 1}.png`, runtime_file: `public/unique-${index + 1}.png` })); region.asset_ids = region.expected_assets.map((asset) => asset.asset_id); refreshAtomicRequirements(region);
  const assets = region.expected_assets.map((expected, index) => {
    const normalization = normalizationRecordForAsset({ sourceFile: expected.source_file, outputFile: expected.runtime_file, width: 2, height: 2, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" }, sha256: pngSha });
    return { id: expected.asset_id, texture_key: expected.asset_id, source_file: expected.source_file, production_origin: region.production_origin, production_method: region.production_method, delivery_kind: region.delivery_kind, image_generation_required: true, generation_record_required: true, substitution_policy: region.substitution_policy, expected_assets: [expected], mime_type: "image/png", width: 2, height: 2, alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" }, sha256: pngSha, normalization_record: normalization, runtime_outputs: [expected.runtime_file], runtime_consumption: { status: "passed", evidence: "evidence/runtime.json", ...identity }, generation_record: { ...imageGenAsset().generation_record, record_id: `DEDUP-GEN-${index + 1}`, annotation_number: 5, region_id: region.id, component_id: expected.component_id, state_id: expected.state_id, asset_id: expected.asset_id, source_file: expected.source_file, runtime_file: expected.runtime_file, output_file: expected.runtime_file, normalization_record: normalization } };
  });
  await mkdir(join(root, "public"), { recursive: true }); for (const expected of region.expected_assets) await writeFile(join(root, expected.runtime_file), png);
  const actualAssets = region.expected_assets.map((expected) => ({ ...expected, file: expected.runtime_file })); const usages = region.expected_assets.map((expected) => ({ component_id: expected.component_id, state_id: expected.state_id, asset_id: expected.asset_id, placement_ids: [expected.component_id === "component-1" ? "placement-1" : "placement-2"], runtime_file: expected.runtime_file, runtime_sha256: pngSha, status: "passed" }));
  const manifest = { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH, diff_fingerprint: "diff-1" }, visual_baseline: { style_fingerprint: HASH }, reference_target: { target_sha256: HASH }, coverage_audit: { regions: [region] }, assets, production_contract_audit: { status: "passed", candidate_version: "candidate-1", candidate_sha256: HASH, target_sha256: HASH, audited_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: 5, region_id: region.id, observed_method: "image-generation", observed_delivery_kind: "raster-image", status: "passed", expected_assets: region.expected_assets, actual_assets: actualAssets, runtime_consumption: { status: "passed", evidence: "evidence/runtime.json", ...identity, component_usages: usages } }] } };
  const errors = await auditProductionContract(manifest, { projectRoot: root, checkFiles: true });
  assert.equal(errors.some((item) => /相同位图像素|SHA-256|摘要/.test(item)), false, errors.join("\n"));
  assert(errors.some((item) => item.includes("文件不存在") || item.includes("实际尺寸与记录不一致")), errors.join("\n"));
});

test("atlas 禁止同一图集内完全相同或重叠 rect，且热区变体不能伪装资产", () => {
  const region = multiComponentRegion(2, "atlas", [
    { asset_id: "atlas", component_id: "component-1", state_id: "default", asset_kind: "visual", atlas_slice: { atlas_asset_id: "atlas", slice_id: "one", atlas_size: { width: 40, height: 40 }, rect: { x: 0, y: 0, width: 20, height: 20 } } },
    { asset_id: "atlas", component_id: "component-2", state_id: "default", asset_kind: "visual", atlas_slice: { atlas_asset_id: "atlas", slice_id: "two", atlas_size: { width: 40, height: 40 }, rect: { x: 10, y: 10, width: 20, height: 20 } } },
  ]);
  const overlapErrors = validateVisualComponentContract(region, { stage: "V3", annotation_number: 2, region_id: "atlas-overlap" });
  assert(overlapErrors.some((item) => item.includes("rect 不能重叠")), overlapErrors.join("\n"));
  const duplicateRect = structuredClone(region); duplicateRect.expected_assets[1].atlas_slice.rect = { x: 0, y: 0, width: 20, height: 20 };
  const duplicateErrors = validateVisualComponentContract(duplicateRect, { stage: "V3", annotation_number: 2, region_id: "atlas-duplicate" });
  assert(duplicateErrors.some((item) => item.includes("rect 不能完全相同")), duplicateErrors.join("\n"));
  const hotspot = structuredClone(multiComponentRegion(1)); hotspot.component_inventory.components[0].role = "interaction_hotspot"; hotspot.expected_assets[0].asset_kind = "interaction hotspot";
  const hotspotErrors = validateVisualComponentContract(hotspot, { stage: "V3", annotation_number: 3, region_id: "hotspot-variant" });
  assert(hotspotErrors.some((item) => item.includes("交互热区")), hotspotErrors.join("\n"));
});

test("individual 文件按规范化项目相对路径去重并拒绝绝对路径/逃逸", () => {
  const normalized = multiComponentRegion(2, "individual", [
    { asset_id: "asset-1", component_id: "component-1", state_id: "default", source_file: "art/shared.png", runtime_file: "public/a.png" },
    { asset_id: "asset-2", component_id: "component-2", state_id: "default", source_file: "ART/SHARED.PNG", runtime_file: "public/b.png" },
  ]);
  const duplicateErrors = validateVisualComponentContract(normalized, { stage: "V3", annotation_number: 2, region_id: "path-duplicate" });
  assert(duplicateErrors.some((item) => item.includes("共享同一源/运行文件")), duplicateErrors.join("\n"));
  const unsafe = structuredClone(multiComponentRegion(1)); unsafe.expected_assets[0].source_file = "../outside.png";
  const unsafeErrors = validateVisualComponentContract(unsafe, { stage: "V3", annotation_number: 3, region_id: "path-escape" });
  assert(unsafeErrors.some((item) => item.includes("项目内相对路径")), unsafeErrors.join("\n"));
});

test("atlas slice 拒绝负坐标与越过 atlas_size 边界", () => {
  const negative = multiComponentRegion(1, "atlas", [{ asset_id: "atlas", component_id: "component-1", state_id: "default", atlas_slice: { atlas_asset_id: "atlas", slice_id: "negative", atlas_size: { width: 32, height: 32 }, rect: { x: -1, y: 0, width: 8, height: 8 } } }]);
  const negativeErrors = validateVisualComponentContract(negative, { stage: "V3", annotation_number: 2, region_id: "atlas-negative" });
  assert(negativeErrors.some((item) => item.includes("x/y 必须大于等于 0")), negativeErrors.join("\n"));
  const overflow = structuredClone(negative);
  overflow.expected_assets[0].atlas_slice.rect = { x: 24, y: 0, width: 9, height: 8 };
  const overflowErrors = validateVisualComponentContract(overflow, { stage: "V3", annotation_number: 2, region_id: "atlas-overflow" });
  assert(overflowErrors.some((item) => item.includes("越过 atlas_size 边界")), overflowErrors.join("\n"));
});

test("V4 actual_assets 和 runtime usage 按 runtime_file 绑定，runtime SHA 仅为可选摘要", async () => {
  const base = v4FixtureManifest(IMAGEGEN_REGRESSION_FIXTURES[0]);
  const sourceSubstitution = structuredClone(base);
  sourceSubstitution.production_contract_audit.units[0].actual_assets[0].file = "art/①.png";
  const sourceErrors = await auditProductionContract(sourceSubstitution, { checkFiles: false });
  assert(sourceErrors.some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")), sourceErrors.join("\n"));
  const missingFile = structuredClone(base);
  delete missingFile.production_contract_audit.units[0].runtime_consumption.component_usages[0].runtime_file;
  const missingFileErrors = await auditProductionContract(missingFile, { checkFiles: false });
  assert(missingFileErrors.some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")), missingFileErrors.join("\n"));
  const wrongSha = structuredClone(base);
  wrongSha.production_contract_audit.units[0].runtime_consumption.component_usages[0].runtime_sha256 = `sha256:${"b".repeat(64)}`;
  const wrongShaErrors = await auditProductionContract(wrongSha, { checkFiles: false });
  assert(wrongShaErrors.some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")), wrongShaErrors.join("\n"));
  assert.equal(wrongShaErrors.some((item) => item.includes("SHA-256")), false, wrongShaErrors.join("\n"));
});

test("图像生成 区域强制 individual，atlas/横向组图不能作为位图交付", () => {
  const atlas = multiComponentRegion(6, "atlas");
  Object.assign(atlas, { production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  const errors = validateVisualComponentContract(atlas, { stage: "V3", annotation_number: 2, region_id: "top-buttons-region" });
  assert(errors.some((item) => item.includes("图像生成 只能使用 individual") && item.includes("component_id=?")), errors.join("\n"));
});

test("interaction_hotspots 必须与 interaction_required 部件一一对应且不携带资产身份", () => {
  const missing = multiComponentRegion(1);
  missing.component_inventory.components[0].placements[0].interaction_required = true;
  const missingErrors = validateVisualComponentContract(missing, { stage: "V3", annotation_number: 2, region_id: "hotspot-missing" });
  assert(missingErrors.some((item) => item.includes("component_id=component-1") && item.includes("必须且只能对应一个 hotspot")), missingErrors.join("\n"));

  const orphan = structuredClone(missing);
  orphan.interaction_hotspots = [{ hotspot_id: "hit-1", component_id: "ghost", placement_id: "ghost-placement", bounds: { x: 0, y: 0, width: 8, height: 8 }, asset_id: "fake" }];
  const orphanErrors = validateVisualComponentContract(orphan, { stage: "V3", annotation_number: 2, region_id: "hotspot-orphan" });
  assert(orphanErrors.some((item) => item.includes("component_id=ghost") && item.includes("悬空")), orphanErrors.join("\n"));
  assert(orphanErrors.some((item) => item.includes("不得声明 asset_id")), orphanErrors.join("\n"));

  const duplicate = structuredClone(missing);
  duplicate.interaction_hotspots = [
    { hotspot_id: "hit-1", component_id: "component-1", placement_id: "placement-1", bounds: { x: 0, y: 0, width: 8, height: 8 } },
    { hotspot_id: "hit-1", component_id: "component-1", placement_id: "placement-1", bounds: { x: 1, y: 1, width: 8, height: 8 } },
  ];
  const duplicateErrors = validateVisualComponentContract(duplicate, { stage: "V3", annotation_number: 2, region_id: "hotspot-duplicate" });
  assert(duplicateErrors.some((item) => item.includes("hotspot_id 重复") || item.includes("只能对应一个 hotspot")), duplicateErrors.join("\n"));

  const explicitNoHotspot = multiComponentRegion(1);
  explicitNoHotspot.interaction_hotspots = [{ hotspot_id: "unexpected", component_id: "component-1", placement_id: "placement-1", bounds: { x: 0, y: 0, width: 8, height: 8 } }];
  const explicitNoHotspotErrors = validateVisualComponentContract(explicitNoHotspot, { stage: "V3", annotation_number: 2, region_id: "hotspot-not-required" });
  assert(explicitNoHotspotErrors.some((item) => item.includes("非 interactive placement")), explicitNoHotspotErrors.join("\n"));
});

test("Implementation Package 的状态、部件、资产和热区顺序不影响语义比较，但合同漂移必须失败", () => {
  const base = implementationPackageFixture();
  assert.deepEqual(validateVisualProductionUnits(base.pkg, base.manifest), []);
  const reordered = structuredClone(base.pkg);
  const unit = reordered.visualProductionUnits[0];
  unit.state_analysis.states.reverse();
  unit.component_inventory.components.reverse();
  unit.expected_assets.reverse();
  unit.interaction_hotspots.reverse();
  assert.deepEqual(validateVisualProductionUnits(reordered, base.manifest), []);

  const drift = structuredClone(base.pkg);
  drift.visualProductionUnits[0].state_analysis.analysis_id = "analysis-drift";
  const driftErrors = validateVisualProductionUnits(drift, base.manifest);
  assert(driftErrors.some((item) => item.includes("state_analysis 必须与 coverage 区域语义一致")), driftErrors.join("\n"));
});

test("Implementation Package 不能过滤或偷换冻结透明路线", () => {
  const base = implementationPackageFixture();
  const frozen = { strategy: "direct-alpha", edge_profile: "glow" };
  base.region.expected_assets[0].alpha = true;
  base.region.expected_assets[0].transparency_requirements = frozen;
  base.pkg.visualProductionUnits[0].expected_assets[0].alpha = true;
  base.pkg.visualProductionUnits[0].expected_assets[0].transparency_requirements = { ...frozen };
  assert.deepEqual(validateVisualProductionUnits(base.pkg, base.manifest), []);
  base.pkg.visualProductionUnits[0].expected_assets[0].transparency_requirements = { strategy: "background-removal", edge_profile: "hard-edge" };
  assert(validateVisualProductionUnits(base.pkg, base.manifest).some((error) => error.includes("expected_assets")));
});

test("状态分析完成时间必须严格早于部件清单创建时间", () => {
  const equal = multiComponentRegion(1);
  equal.component_inventory.created_at = "2026-08-15T00:00:00Z";
  const equalErrors = validateVisualComponentContract(equal, { stage: "V3", annotation_number: 3, region_id: "state-order-equal" });
  assert(equalErrors.some((item) => item.includes("必须早于") && item.includes("state-order-equal")), equalErrors.join("\n"));
  const earlier = structuredClone(equal);
  earlier.component_inventory.created_at = "2026-08-16T00:00:00Z";
  assert.deepEqual(validateVisualComponentContract(earlier, { stage: "V3", annotation_number: 3, region_id: "state-order-earlier" }), []);
  const reversed = structuredClone(equal);
  reversed.component_inventory.created_at = "2026-08-14T00:00:00Z";
  const errors = validateVisualComponentContract(reversed, { stage: "V3", annotation_number: 3, region_id: "state-order-reversed" });
  assert(errors.some((item) => item.includes("annotation_number=3") && item.includes("region_id=state-order-reversed") && item.includes("必须先完成状态分析再拆解")), errors.join("\n"));
});

test("Implementation Package schema 与生产合同方法/交付枚举保持一致", () => {
  const unit = IMPLEMENTATION_PACKAGE_SCHEMA.$defs.visualProductionUnit;
  assert.deepEqual(unit.properties.production_method.enum, ["image-generation", "authored-raster", "authored-svg", "cocos-graphics", "runtime-program", "reuse"]);
  assert.deepEqual(unit.properties.delivery_kind.enum, ["raster-image", "vector-image", "runtime-drawing", "runtime-program", "existing-asset"]);
  const conditions = JSON.stringify(unit.allOf);
  const schemaText = JSON.stringify(IMPLEMENTATION_PACKAGE_SCHEMA);
  for (const pair of [["image-generation", "raster-image"], ["authored-raster", "raster-image"], ["authored-svg", "vector-image"], ["cocos-graphics", "runtime-drawing"], ["runtime-program", "runtime-program"], ["reuse", "existing-asset"]]) {
    assert(conditions.includes(`\"${pair[0]}\"`) && conditions.includes(`\"${pair[1]}\"`), `${pair[0]} delivery constraint missing`);
  }
  assert(schemaText.includes("image_generation_required") && schemaText.includes("atlas_allowed") && schemaText.includes("atlas_slice") && schemaText.includes("runtime_implementation"));
  assert(schemaText.includes("imageNormalizationRecord") && schemaText.includes("imageGenerationRecord"), "图像生成 尺寸归一化记录 schema 未接入实施包");
});
