import assert from "node:assert/strict"; import { fixtureAlphaCapability, prepareTransparencyFixture } from "./transparent-route-test-fixtures.mjs";
import test from "node:test";
import {
  EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX,
  EFFECT_IMAGE_NEGATIVE_PROMPT,
  EFFECT_IMAGE_GLOBAL_VISUAL_CONSISTENCY_PROMPT,
  buildEffectImageAssetPrompt,
  buildEffectImageFullPrompt,
  buildNineSliceProductionPrompt,
  validateEffectImagePromptContract,
} from "./effect-image-prompt-contract.mjs";
import { validateImageGenerationContract } from "./visual-production-contract.mjs";

const TARGET_FILE = "evidence/visual/sc-main-freeze.png";
const TARGET_SHA = `sha256:${"b".repeat(64)}`;
const CANDIDATE_SHA = `sha256:${"c".repeat(64)}`;
const BASELINE_SHA = `sha256:${"d".repeat(64)}`;
const EFFECT_ASSET_ID = "sc-main-hero-idle";
const GLOBAL_ANCHOR_FILE = "evidence/visual/global-anchor.png";

/** 九宫格小图和边值必须进入实际发送的提示词，不能仅在本地 JSON 记录。 */
test("九宫格生产提示词绑定小图和切片，普通图片不追加该段", () => {
  const decision = { mode: "stretch", reason: "规则底板的角边保持固定", source_size: { width: 96, height: 64 }, borders: { left: 12, right: 12, top: 10, bottom: 10 } };
  const prompt = buildEffectImageFullPrompt({ assetPrompt: "规则底板", expectedAsset: { nine_slice: decision } });
  assert(prompt.includes(buildNineSliceProductionPrompt(decision)));
  assert.match(prompt, /96×64px/);
  assert.match(prompt, /left=12px/);
  assert.equal(buildNineSliceProductionPrompt({ mode: "not-applicable", reason: "固定比例插画" }), "");
  assert.throws(() => buildEffectImageFullPrompt({ assetPrompt: "底板", expectedAsset: { nine_slice: { ...decision, borders: { ...decision.borders, left: 96 } } } }), /非零中心/);
});

/** 记录门要求实际发送的小图切片段，事后声明参数不能替代生成输入。 */
test("九宫格生成记录缺少实际切片提示词时阻断，追加冻结段后通过", () => {
  const decision = { mode: "stretch", reason: "规则底板", source_size: { width: 96, height: 64 }, borders: { left: 12, right: 12, top: 10, bottom: 10 } };
  const record = validEffectRecord();
  const options = { expectedAsset: { nine_slice: decision }, referenceOriginalFile: TARGET_FILE, visual_baseline: GLOBAL_VISUAL_BASELINE };
  const check = () => validateEffectImagePromptContract(validEffectAsset(), { applicability: "effect-image" }, record, { region: effectRegion() }, options);
  assert(check().some((message) => message.includes("小图尺寸和切片生产段")));
  record.full_prompt += `\n\n${buildNineSliceProductionPrompt(decision)}`;
  assert.deepEqual(check(), []);
});

/** 提供当前 effect-image 回归所需的全局静态视觉基线。 */
const GLOBAL_VISUAL_BASELINE = {
  id: "project-global-style",
  version: "2026.08",
  style_fingerprint: BASELINE_SHA,
  document: "docs/visual-baseline.md",
  status: "global-static-baseline-frozen",
  anchor_evidence: [{ path: GLOBAL_ANCHOR_FILE, sha256: BASELINE_SHA }],
};

/** 构造包含全部冻结视觉事实的 region，确保测试验证事实继承而非字符串长度。 */
function effectRegion() {
  return {
    annotation_number: 2,
    region_id: "SC-MAIN-hero",
    component_id: "hero-character",
    state_id: "idle",
    visual_category: "半身机甲角色立绘",
    graphic_semantics: "角色主体与胸前能源核心",
    contour_structure: "肩甲外轮廓、头盔、双臂和胸甲分区清晰，核心位于胸口中央",
    proportions: "竖向构图，宽高约 3:4；主体占画布约 82%，左右留出均衡边距",
    orientation_perspective: "三分之四侧前视角，身体朝向画面右侧，轻微俯视透视",
    color_material: "深蓝金属装甲、青蓝能量核心、磨砂金属与局部高光边缘",
    lighting_glow: "左上方冷光主光源，右下方柔和阴影，胸口核心有受控青蓝辉光",
    line_decoration_density: "中高密度机械接缝与细线装饰，轮廓线中等粗细",
    transparency_clipping_whitespace: "真实透明背景，角色完整落入画布，头顶和肩侧保留参考图同等留白",
    excluded_objects: "不烘焙背景框体、按钮、数值、标签、鼠标热区或其他角色",
    runtime_ownership: "文字、数值、状态徽标、热区和交互反馈由运行时 Scene 负责，不进入位图",
  };
}

/** 构造可被所有 effect-image 回归用例复制的合法生成记录。 */
function validEffectRecord(overrides = {}) {
  const region = effectRegion();
  const { prompt: assetPrompt } = buildEffectImageAssetPrompt({ region, state: "idle" });
  const statePrompt = "状态：idle；保持冻结 region 中的默认待机姿态，不添加状态专属结构。";
  const fullPrompt = buildEffectImageFullPrompt({ assetPrompt, statePrompt, expectedAlpha: true, transparencyStrategy: "direct-alpha", edgeProfile: "glow", capability: fixtureAlphaCapability() });
  const record = {
    record_id: "GEN-SC-MAIN-HERO-IDLE",
    generator: "fixture-render-tool",
    generator_version: "4",
    created_at: "2026-08-22T00:00:00Z",
    command_or_recipe: "fixture-render-tool effect-image hero idle",
    model: "imagegen-reference-faithful",
    model_version: "4",
    reconstruction_mode: "reference-faithful",
    reference_input_mode: "full-reference-guidance",
    pixel_reuse_policy: "forbid-output-reuse",
    source_background_mode: "opaque",
    source_background_color: "#00FF00",
    final_background_mode: "transparent",
    transparency_strategy: "background-removal",
    global_prompt_prefix: EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX,
    asset_prompt: assetPrompt,
    state_prompt: statePrompt,
    negative_prompt: EFFECT_IMAGE_NEGATIVE_PROMPT,
    full_prompt: fullPrompt,
    origin: "generated",
    visual_baseline_id: GLOBAL_VISUAL_BASELINE.id,
    visual_baseline_version: GLOBAL_VISUAL_BASELINE.version,
    style_fingerprint: GLOBAL_VISUAL_BASELINE.style_fingerprint,
    baseline_document: GLOBAL_VISUAL_BASELINE.document,
    global_visual_consistency_prompt: EFFECT_IMAGE_GLOBAL_VISUAL_CONSISTENCY_PROMPT,
    style_drift_policy: "forbid",
    prompt_sent: true,
    consistency_status: "passed",
    consistency_evidence: { path: "evidence/visual/global-consistency.json", sha256: BASELINE_SHA },
    output_sha256: CANDIDATE_SHA,
    reference_inputs: [TARGET_FILE],
    style_reference_inputs: [{ path: GLOBAL_ANCHOR_FILE, sha256: BASELINE_SHA }],
    target_sha256: TARGET_SHA,
    region_id: region.region_id,
    annotation_number: region.annotation_number,
    component_id: region.component_id,
    asset_id: EFFECT_ASSET_ID,
    state_id: region.state_id,
    candidate_sha256: CANDIDATE_SHA,
    diff_fingerprint: "diff-sc-main-hero",
    candidate_version: "candidate-2026-08-22",
    seed: 42,
    raw_source_file: "art/generated/sc-main-hero-idle-raw.png",
    raw_source_has_alpha: false,
    source_file: "art/generated/sc-main-hero-idle-cutout.png",
    source_has_alpha: true,
    runtime_file: "public/assets/sc-main-hero-idle.png",
    output_file: "public/assets/sc-main-hero-idle.png",
    postprocess: ["background-removal"],
    background_removal_attempts: [{ operation: "background-removal", status: "completed", source_file: "art/generated/sc-main-hero-idle-raw.png", output_file: "art/generated/sc-main-hero-idle-cutout.png", source_has_alpha: false, output_has_alpha: true, completed_at: "2026-08-22T00:00:00Z", evidence: { record_id: "BR-SC-MAIN-HERO-IDLE", report: "evidence/visual/sc-main-hero-background-removal.json", solid_background_check: { status: "passed", background_color: "#00FF00", opaque: true, boundary_pixels: 4, matched_boundary_pixels: 4 } } }],
    ...overrides,
  };
  const asset = validEffectAsset(); record.normalization_record = asset.normalization_record; record.postprocess = []; prepareTransparencyFixture(record, { alpha: true, runtime_file: asset.runtime_file }, { strategy: "direct-alpha", edgeProfile: "glow" }); return Object.assign(record, overrides);
}

/** 构造与冻结原图身份分离的独立输出资产。 */
function validEffectAsset(overrides = {}) {
  return {
    source_file: "art/generated/sc-main-hero-idle-cutout.png",
    runtime_file: "public/assets/sc-main-hero-idle.png",
    output_file: "public/assets/sc-main-hero-idle.png",
    mime_type: "image/png",
    width: 128,
    height: 192,
    alpha: true,
    sha256: CANDIDATE_SHA,
    runtime_outputs: ["public/assets/sc-main-hero-idle.png"],
    normalization_record: {
      schema: "image-normalization/1",
      status: "passed",
      operation: "not-required",
      source_file: "art/generated/sc-main-hero-idle-cutout.png",
      source_sha256: CANDIDATE_SHA,
      source_width: 128,
      source_height: 192,
      target_width: 128,
      target_height: 192,
      output_file: "public/assets/sc-main-hero-idle.png",
      output_sha256: CANDIDATE_SHA,
      output_width: 128,
      output_height: 192,
      preserve_alpha: true,
      tool: "sharp",
      tool_version: "0.35.3",
      completed_at: "2026-08-22T00:00:00Z",
    },
    runtime_consumption: {
      status: "passed",
      evidence: "evidence/runtime/sc-main-hero-idle.json",
      evidence_sha256: BASELINE_SHA,
      candidate_sha256: CANDIDATE_SHA,
      target_sha256: TARGET_SHA,
      baseline_sha256: BASELINE_SHA,
      diff_fingerprint: "diff-sc-main-hero",
    },
    ...overrides,
  };
}

/** 构造共享 图像生成 V4 门所需的原子资产合同。 */
function effectImageAssetContract() {
  return {
    applicability: "effect-image",
    production_origin: "independent-production",
    production_method: "image-generation",
    delivery_kind: "raster-image",
    image_generation_required: true,
    generation_record_required: true,
    substitution_policy: "user-change-request-only",
    expected_assets: [{
      asset_id: EFFECT_ASSET_ID,
      component_id: "hero-character",
      state_id: "idle",
      source_file: "art/generated/sc-main-hero-idle-cutout.png",
      runtime_file: "public/assets/sc-main-hero-idle.png",
      mime_type: "image/png",
      width: 128,
      height: 192,
      alpha: true, transparency_requirements: { strategy: "direct-alpha", edge_profile: "glow" },
    }],
  };
}

/** 绑定 V4 入口的冻结目标、区域和候选身份，避免测试只验证孤立 helper。 */
function effectImageValidationContext() {
  return {
    stage: "V4",
    annotation_number: 2,
    region_id: "SC-MAIN-hero",
    region: effectRegion(),
    reference_target: { original_file: TARGET_FILE, target_sha256: TARGET_SHA },
    visual_baseline: GLOBAL_VISUAL_BASELINE,
    effect_image_reconstruction: { applicability: "effect-image" },
  };
}

/** 复用正式生产门要求的当前 target/candidate/diff 身份。 */
function effectImageValidationOptions() {
  return {
    effectImage: true,
    expectedAsset: effectImageAssetContract().expected_assets[0],
    referenceOriginalFile: TARGET_FILE,
    referenceTargetSha: TARGET_SHA,
    identity: { target: TARGET_SHA, candidate: CANDIDATE_SHA, baseline: BASELINE_SHA, diff: "diff-sc-main-hero" },
    candidateVersion: "candidate-2026-08-22",
    visual_baseline: GLOBAL_VISUAL_BASELINE,
  };
}

/** 统一调用共享合同，避免回归测试绕过实际 effect-image 上下文。 */
function validate(record = validEffectRecord(), asset = validEffectAsset(), overrides = {}) {
  const region = effectRegion();
  return validateEffectImagePromptContract(asset, { applicability: "effect-image" }, record, {
    region,
    reference_target: { original_file: TARGET_FILE },
    visual_baseline: GLOBAL_VISUAL_BASELINE,
    ...overrides.context,
  }, {
    effectImage: true,
    referenceOriginalFile: TARGET_FILE,
    referenceTargetSha: TARGET_SHA,
    identity: { target: TARGET_SHA, candidate: CANDIDATE_SHA, diff: "diff-sc-main-hero" },
    candidateVersion: "candidate-2026-08-22",
    visual_baseline: GLOBAL_VISUAL_BASELINE,
    ...overrides.options,
  });
}

test("合法 effect-image 忠实还原记录通过", () => {
  assert.deepEqual(validate(), []);
  const record = validEffectRecord();
  const asset = validEffectAsset({ generation_record: record });
  assert.deepEqual(validateImageGenerationContract(asset, effectImageAssetContract(), effectImageValidationContext(), effectImageValidationOptions()), []);
});

test("alpha=true 直接透明单图必须声明真实源图模式", () => {
  const record = validEffectRecord({ source_background_mode: undefined, full_prompt: buildEffectImageFullPrompt({ assetPrompt: validEffectRecord().asset_prompt, statePrompt: validEffectRecord().state_prompt, expectedAlpha: false }) });
  const errors = validateImageGenerationContract(validEffectAsset({ generation_record: record }), effectImageAssetContract(), effectImageValidationContext(), effectImageValidationOptions());
  assert(errors.some((item) => item.includes("source_background_mode")), errors.join("\n"));

});

test("辉光单图不能通过声明背景移除切换已冻结路线", () => {
  const record = validEffectRecord({ transparency_strategy: "background-removal", edge_profile: "glow" });
  const errors = validateImageGenerationContract(validEffectAsset({ generation_record: record }), effectImageAssetContract(), effectImageValidationContext(), effectImageValidationOptions());
  assert(errors.some((item) => item.includes("hard-edge") || item.includes("冻结")), errors.join("\n"));
});

test("透明提示词按能力与边缘路由，不能默认去背或放行未知边缘", () => {
  assert.throws(() => buildEffectImageFullPrompt({ expectedAlpha: true }));
  assert.throws(() => buildEffectImageFullPrompt({ expectedAlpha: true, transparencyStrategy: "background-removal", edgeProfile: "glow", colorSeparationVerified: true }));
  assert.throws(() => buildEffectImageFullPrompt({ expectedAlpha: true, transparencyStrategy: "mask-composition", edgeProfile: "unknown" }));
  assert.throws(() => buildEffectImageFullPrompt({ expectedAlpha: true, transparencyStrategy: "direct-alpha", edgeProfile: "glow", capability: fixtureAlphaCapability("hard-edge") }));
  const mask = buildEffectImageFullPrompt({ expectedAlpha: true, transparencyStrategy: "mask-composition", edgeProfile: "glass" });
  assert(mask.includes("独立遮罩") && !mask.includes("#00FF00"));
});

test("alpha=true 单图拒绝 JPEG 透明交付", () => {
  const expectedAsset = { ...effectImageAssetContract().expected_assets[0], mime_type: "image/jpeg", source_file: "art/generated/sc-main-hero-idle.jpg", runtime_file: "public/assets/sc-main-hero-idle.jpg" };
  const contract = { ...effectImageAssetContract(), expected_assets: [expectedAsset] };
  const options = { ...effectImageValidationOptions(), expectedAsset };
  const errors = validateImageGenerationContract(validEffectAsset({ mime_type: "image/jpeg", source_file: expectedAsset.source_file, runtime_file: expectedAsset.runtime_file, output_file: expectedAsset.runtime_file, generation_record: validEffectRecord({ source_file: expectedAsset.source_file, runtime_file: expectedAsset.runtime_file, output_file: expectedAsset.runtime_file }) }), contract, effectImageValidationContext(), options);
  assert(errors.some((item) => item.includes("image/png") || item.includes("JPEG")), errors.join("\n"));
});

test("缺 reconstruction_mode 时失败", () => {
  const { reconstruction_mode, ...record } = validEffectRecord();
  const errors = validate(record);
  assert(errors.some((item) => item.includes("reconstruction_mode")));
});

test("缺完整冻结原图 reference_inputs 时失败", () => {
  const errors = validate({ ...validEffectRecord(), reference_inputs: ["evidence/visual/style-supplement.png"] });
  assert(errors.some((item) => item.includes("reference_inputs") && item.includes("完整冻结效果图")));
});

test("实际 reference input 忽略摘要变化但保留路径、顺序和裁切约束", () => {
  const inputs = [{ file: TARGET_FILE, sha256: `sha256:${"a".repeat(64)}`, crop: { x: 0, y: 0, width: 390, height: 844 } }];
  const withoutDigest = [{ file: TARGET_FILE, crop: { x: 0, y: 0, width: 390, height: 844 } }];
  const staleDigest = [{ file: TARGET_FILE, sha256: { malformed: true }, crop: { x: 0, y: 0, width: 390, height: 844 } }];
  assert.deepEqual(validate(validEffectRecord({ reference_inputs: inputs, actual_reference_inputs: withoutDigest })), []);
  assert.deepEqual(validate(validEffectRecord({ reference_inputs: inputs, actual_reference_inputs: staleDigest })), []);

  const changedPath = validate(validEffectRecord({ reference_inputs: inputs, actual_reference_inputs: [{ ...withoutDigest[0], file: "evidence/visual/other.png" }] }));
  assert(changedPath.some((item) => item.includes("actual_reference_inputs 必须与真实发送的 reference_inputs 一致")), changedPath.join("\n"));
  const changedCrop = validate(validEffectRecord({ reference_inputs: inputs, actual_reference_inputs: [{ ...withoutDigest[0], crop: { x: 1, y: 0, width: 390, height: 844 } }] }));
  assert(changedCrop.some((item) => item.includes("actual_reference_inputs 必须与真实发送的 reference_inputs 一致")), changedCrop.join("\n"));
});

test("正向提示‘必须重新设计该角色’失败", () => {
  const assetPrompt = "必须重新设计该角色";
  const statePrompt = "状态：idle";
  const errors = validate({ ...validEffectRecord(), asset_prompt: assetPrompt, state_prompt: statePrompt, full_prompt: buildEffectImageFullPrompt({ assetPrompt, statePrompt }) });
  assert(errors.some((item) => item.includes("重新设计")));
});

test("正向提示‘将图标重新设计为补给箱’失败", () => {
  const assetPrompt = "将图标重新设计为补给箱";
  const statePrompt = "状态：idle";
  const errors = validate({ ...validEffectRecord(), asset_prompt: assetPrompt, state_prompt: statePrompt, full_prompt: buildEffectImageFullPrompt({ assetPrompt, statePrompt }) });
  assert(errors.some((item) => item.includes("重新设计")));
});

test("正向提示‘不得重新设计’通过", () => {
  const base = validEffectRecord();
  const assetPrompt = `${base.asset_prompt}\n不得重新设计`;
  const statePrompt = base.state_prompt;
  assert.deepEqual(validate({ ...base, asset_prompt: assetPrompt, full_prompt: buildEffectImageFullPrompt({ assetPrompt, statePrompt, expectedAlpha: true, transparencyStrategy: "direct-alpha", edgeProfile: "glow", capability: fixtureAlphaCapability() }) }), []);
});

test("negative_prompt 包含‘重新设计’不触发正向指令误报", () => {
  assert(EFFECT_IMAGE_NEGATIVE_PROMPT.includes("重新设计"));
  assert.deepEqual(validate(), []);
});

test("crop_reference=true 继续失败", () => {
  const errors = validate({ ...validEffectRecord(), crop_reference: true });
  assert(errors.some((item) => item.includes("禁止裁切")));
});

test("source_file 等于冻结效果图时失败", () => {
  const errors = validate(validEffectRecord(), validEffectAsset({ source_file: TARGET_FILE }));
  assert(errors.some((item) => item.includes("不得等于冻结效果图")));
});

test("普通非 effect-image 图像生成 不受重建字段影响", () => {
  const asset = {
    source_file: "art/ordinary.png",
    mime_type: "image/png",
    width: 64,
    height: 64,
    alpha: true,
    sha256: `sha256:${"a".repeat(64)}`,
    runtime_outputs: ["public/assets/ordinary.png"],
    runtime_consumption: { status: "passed", evidence: "evidence/runtime/ordinary.json", evidence_sha256: `sha256:${"a".repeat(64)}`, candidate_sha256: `sha256:${"a".repeat(64)}`, target_sha256: `sha256:${"b".repeat(64)}`, baseline_sha256: `sha256:${"d".repeat(64)}`, diff_fingerprint: "diff-ordinary" },
    generation_record: {
      record_id: "GEN-ORDINARY",
      generator: "fixture-render-tool",
      generator_version: "1",
      created_at: "2026-08-22T00:00:00Z",
      command_or_recipe: "fixture-render-tool ordinary",
      global_prompt_prefix: "普通风格提示",
      asset_prompt: "普通装饰图",
      state_prompt: "默认态",
      negative_prompt: "无文字",
      model: "ordinary-model",
      model_version: "1",
      reference_inputs: ["docs/reference.png"],
      postprocess: ["保留透明边缘"],
      seed: 1,
    },
  };
  const contract = { production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true };
  assert.deepEqual(validateImageGenerationContract(asset, contract, { annotation_number: 1, region_id: "ordinary" }), []);
});

test("旧错误 SC-MAIN V4 提示词被新门禁确定性拒绝", () => {
  const oldPrompt = "必须重新设计该角色，做成更有游戏感的通用科幻图标";
  const record = validEffectRecord({ global_prompt_prefix: oldPrompt, asset_prompt: "机甲角色", full_prompt: `${oldPrompt}\n机甲角色` });
  const errors = validateImageGenerationContract(validEffectAsset({ generation_record: record }), effectImageAssetContract(), effectImageValidationContext(), effectImageValidationOptions());
  assert(errors.some((item) => item.includes("[V4]") && item.includes("根因=执行问题") && (item.includes("重新设计") || item.includes("canonical")) && item.includes("应退回阶段=V3/V4")));
});
