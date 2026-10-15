import assert from "node:assert/strict"; import { prepareTransparencyFixture } from "./transparent-route-test-fixtures.mjs";
import test from "node:test";
import {
  BACKGROUND_REMOVAL_OPERATION,
  MAX_BACKGROUND_REMOVAL_ATTEMPTS,
  TRANSPARENT_BACKGROUND_REMOVAL_PROMPT,
  DEFAULT_SOURCE_BACKGROUND_COLOR,
  buildSolidBackgroundPrompt,
  TRANSPARENT_BACKGROUND_STRATEGY,
  validateTransparentBackgroundContract,
} from "./visual-transparent-background-contract.mjs";
import { buildEffectImageFullPrompt } from "./effect-image-prompt-contract.mjs";
import { loadSchema } from "./runtime/schema-contract.mjs";

/** 构造透明背景移除路线所需的完整中间产物、归一化和最终输出事实。 */
function transparentFixture(overrides = {}) {
  const normalizationRecord = {
    schema: "image-normalization/1",
    status: "passed",
    operation: "resize-to-contract",
    source_file: "art/hero-cutout.png",
    source_sha256: `sha256:${"b".repeat(64)}`,
    source_width: 128,
    source_height: 128,
    target_width: 64,
    target_height: 64,
    output_file: "public/hero.png",
    output_sha256: `sha256:${"a".repeat(64)}`,
    output_width: 64,
    output_height: 64,
    preserve_alpha: true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-26T00:00:00Z",
  };
  const generation = {
    source_background_mode: "opaque",
    source_background_color: DEFAULT_SOURCE_BACKGROUND_COLOR,
    final_background_mode: "transparent",
    transparency_strategy: TRANSPARENT_BACKGROUND_STRATEGY,
    full_prompt: TRANSPARENT_BACKGROUND_REMOVAL_PROMPT,
    postprocess: ["background-removal"],
    raw_source_file: "art/hero-raw.png",
    raw_source_has_alpha: false,
    source_file: "art/hero-cutout.png",
    source_has_alpha: true,
    runtime_file: "public/hero.png",
    output_file: "public/hero.png",
    normalization_record: normalizationRecord,
    background_removal_attempts: [{
      operation: BACKGROUND_REMOVAL_OPERATION,
      status: "completed",
      source_file: "art/hero-raw.png",
      output_file: "art/hero-cutout.png",
      source_has_alpha: false,
      output_has_alpha: true,
      completed_at: "2026-08-26T00:00:00Z",
      evidence: { record_id: "BR-HERO-1", report: "evidence/hero-background-removal.json", solid_background_check: { status: "passed", background_color: DEFAULT_SOURCE_BACKGROUND_COLOR, opaque: true, boundary_pixels: 4, matched_boundary_pixels: 4 } },
    }],
  };
  const expectedAsset = { asset_id: "hero", mime_type: "image/png", source_file: "art/hero-cutout.png", runtime_file: "public/hero.png", width: 64, height: 64, alpha: true };
  prepareTransparencyFixture(generation, expectedAsset);
  return {
    expectedAsset,
    contract: { production_method: "image-generation", image_generation_required: true, delivery_kind: "raster-image" },
    asset: { source_file: "art/hero-cutout.png", runtime_outputs: ["public/hero.png"], normalization_record: normalizationRecord },
    generation,
    metadata: { mime_type: "image/png", file: "public/hero.png", alpha: true, width: 64, height: 64 },
    ...overrides,
  };
}

test("背景移除生产成功，允许最终成功记录", () => {
  assert.deepEqual(validateTransparentBackgroundContract(transparentFixture()), []);
});

test("生图提示词要求指定不透明纯色并禁止棋盘背景", () => {
  const prompt = buildEffectImageFullPrompt({ assetPrompt: "冻结 region 资产", expectedAlpha: true, transparencyStrategy: "background-removal", edgeProfile: "hard-edge", colorSeparationVerified: true });
  assert(prompt.includes(DEFAULT_SOURCE_BACKGROUND_COLOR));
  assert(prompt.includes("不透明"));
  assert(prompt.includes("纯色"));
  assert(prompt.includes("禁止棋盘格"));
  assert(!prompt.includes("可直接输出透明 PNG"));
  assert(buildSolidBackgroundPrompt("#ff00ff").includes("#FF00FF"));
  const custom = buildEffectImageFullPrompt({ assetPrompt: "白色角色", expectedAlpha: true, transparencyStrategy: "background-removal", edgeProfile: "hard-edge", colorSeparationVerified: true, backgroundColor: "#000000" });
  assert(custom.includes("#000000"));
  assert(!custom.includes("黑底，白底"));
  assert(!custom.includes(DEFAULT_SOURCE_BACKGROUND_COLOR));
  assert.throws(() => buildSolidBackgroundPrompt("invalid"));
  const scenePrompt = buildEffectImageFullPrompt({ assetPrompt: "完整城市场景", expectedAlpha: false });
  assert(!scenePrompt.includes(DEFAULT_SOURCE_BACKGROUND_COLOR));
  for (const term of ["渐变背景", "纹理背景", "背景阴影", "环境景物", "非指定颜色背景"]) assert(!scenePrompt.includes(term), term);
});

test("旧透明直出提示词与缺失或不匹配的背景颜色被拒绝", () => {
  const base = transparentFixture();
  for (const change of [{ full_prompt: "直接生成透明背景 PNG" }, { full_prompt: "不透明纯色 #00FF00，添加棋盘格" }, { source_background_color: undefined }, { source_background_color: "green" }, { source_background_color: "#FF00FF" }]) {
    assert(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, ...change } }).length > 0, JSON.stringify(change));
  }
  assert.deepEqual(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, source_background_color: "#FF00FF", full_prompt: buildSolidBackgroundPrompt("#FF00FF"), background_removal_attempts: [{ ...base.generation.background_removal_attempts[0], evidence: { ...base.generation.background_removal_attempts[0].evidence, solid_background_check: { status: "passed", background_color: "#FF00FF", opaque: true, boundary_pixels: 4, matched_boundary_pixels: 4 } } }] } }), []);
});

test("不完整的真实 Alpha 或未知策略记录必须拒绝", () => {
  for (const strategy of ["direct-alpha", "direct-generation", "background-removal-fallback"]) {
    const errors = validateTransparentBackgroundContract({ ...transparentFixture(), generation: { ...transparentFixture().generation, transparency_strategy: strategy } });
    assert(errors.length > 0, `${strategy}: ${errors.join("\n")}`);
  }
});
test("旧 background_mode 和 direct_generation_attempt 字段被拒绝", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, background_mode: "transparent", direct_generation_attempt: { status: "failed" } },
  });
  assert(errors.some((item) => item.includes("background_mode")), errors.join("\n"));
  assert(errors.some((item) => item.includes("direct_generation_attempt")), errors.join("\n"));
});

test("结构化记录是次数权威，命令和 postprocess 重复描述仍通过", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, command_or_recipe: "image-generation hero -> background-removal", postprocess: ["background-removal"] },
  });
  assert.deepEqual(errors, []);
});

test("背景移除允许失败历史，默认和任务上限都禁止无界重试", () => {
  const base = transparentFixture();
  const successful = base.generation.background_removal_attempts[0];
  const failed = { ...successful, status: "failed", output_file: "art/hero-cutout-failed.png", output_has_alpha: false, evidence: { ...successful.evidence, record_id: "BR-HERO-FAILED", report: "evidence/hero-background-removal-failed.json" } };
  assert.deepEqual(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: [failed, successful] } }), []);
  assert.deepEqual(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: [successful, failed, successful] } }), []);
  const tooMany = Array.from({ length: MAX_BACKGROUND_REMOVAL_ATTEMPTS + 1 }, (_, index) => ({ ...successful, status: index === MAX_BACKGROUND_REMOVAL_ATTEMPTS ? "completed" : "failed", output_file: `art/hero-cutout-${index}.png`, output_has_alpha: index === MAX_BACKGROUND_REMOVAL_ATTEMPTS, evidence: { ...successful.evidence, record_id: `BR-HERO-${index}`, report: `evidence/hero-background-removal-${index}.json` } }));
  assert(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: tooMany } }).some((item) => item.includes("最多允许")));
  const configuredFour = Array.from({ length: 4 }, (_, index) => ({ ...successful, status: index === 3 ? "completed" : "failed", output_file: `art/hero-cutout-configured-${index}.png`, output_has_alpha: index === 3, evidence: { ...successful.evidence, record_id: `BR-HERO-CONFIGURED-${index}`, report: `evidence/hero-background-removal-configured-${index}.json` } }));
  configuredFour[3] = successful;
  assert.deepEqual(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_max_attempts: 4, background_removal_attempts: configuredFour } }), []);
  for (const limit of [0, -1, 1.5, "4"]) assert(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_max_attempts: limit } }).some((error) => error.includes("background_removal_max_attempts")));
  const missing = { ...base.generation };
  delete missing.background_removal_attempts;
  assert(validateTransparentBackgroundContract({ ...base, generation: missing }).some((item) => item.includes("background_removal_attempts")));
});

test("背景移除必须成功且记录完整路径、时间、Alpha 和 evidence", () => {
  const base = transparentFixture();
  const attempt = base.generation.background_removal_attempts[0];
  for (const change of [
    { operation: "remove-background" },
    { status: "failed" },
    { source_file: "" },
    { output_file: "art/hero-raw.png" },
    { completed_at: "not-a-date" },
    { evidence: {} },
    { output_has_alpha: "true" },
    { output_has_alpha: false },
  ]) {
    const errors = validateTransparentBackgroundContract({
      ...base,
      generation: { ...base.generation, background_removal_attempts: [{ ...attempt, ...change }] },
    });
    assert(errors.length > 0, JSON.stringify(change));
  }
});

test("归一化 source_file 必须绑定背景移除输出", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, normalization_record: { ...base.generation.normalization_record, source_file: "art/hero-raw.png" } },
  });
  assert(errors.some((item) => item.includes("normalization_record.source_file")), errors.join("\n"));
});

test("不透明原图允许存在全不透明 Alpha 通道，拒绝透明生成模式", () => {
  const fixture = transparentFixture();
  fixture.generation.raw_source_has_alpha = true;
  fixture.generation.background_removal_attempts[0].source_has_alpha = true;
  assert.deepEqual(validateTransparentBackgroundContract(fixture), []);
  fixture.generation.source_background_mode = "transparent";
  assert(validateTransparentBackgroundContract(fixture).some((error) => error.includes("source_background_mode")));
});
test("三类工作流 Schema 的透明生产和处理历史合同一致", () => {
  const schemas = ["evidence-manifest.schema.json", "implementation-package.schema.json", "work-item.schema.json"].map(loadSchema);
  for (const name of ["transparentBackgroundProductionRecord", "transparentBackgroundRemovalAttempt"]) {
    assert(schemas[0].$defs[name], `缺少 ${name}`);
    for (const schema of schemas.slice(1)) assert.deepEqual(schema.$defs[name], schemas[0].$defs[name]);
  }
  // 背景参数仅属于去背分支，其他透明路线不能被强制要求。
  for (const schema of schemas) {
    const record = schema.$defs.transparentBackgroundProductionRecord;
    assert(record.allOf.some((item) => item.if?.properties?.transparency_strategy?.const === "background-removal"));
    assert(!record.required.includes("source_background_color"));
  }
});

test("alpha=false 与普通非透明路线不触发背景移除合同", () => {
  const fixture = transparentFixture({
    expectedAsset: { asset_id: "background", mime_type: "image/jpeg", source_file: "art/background.jpg", runtime_file: "public/background.jpg", alpha: false },
    contract: { production_method: "image-generation", image_generation_required: true, delivery_kind: "raster-image" },
    metadata: { mime_type: "image/jpeg", file: "public/background.jpg", alpha: false },
  });
  assert.deepEqual(validateTransparentBackgroundContract(fixture), []);
  assert.deepEqual(validateTransparentBackgroundContract({ ...fixture, contract: { production_method: "authored-raster", image_generation_required: false } }), []);
});

test("纯色检查证据绑定最终去背颜色，允许保留不合格原图的失败历史", () => {
  const base = transparentFixture();
  const attempt = base.generation.background_removal_attempts[0];
  const check = { status: "passed", background_color: "#00FF00", opaque: true, boundary_pixels: 12, matched_boundary_pixels: 12 };
  const missingCheck = { ...attempt, evidence: { record_id: "missing-solid-check" } };
  assert(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: [missingCheck] } }).some((error) => error.includes("solid_background_check")));
  const completed = { ...attempt, evidence: { ...attempt.evidence, background_color: "#00FF00", solid_background_check: check } };
  assert.deepEqual(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: [completed] } }), []);
  for (const change of [{ status: "failed" }, { opaque: false }, { background_color: "#FF00FF" }, { matched_boundary_pixels: 11 }, { boundary_pixels: undefined, matched_boundary_pixels: undefined }, { boundary_pixels: 0, matched_boundary_pixels: 0 }]) {
    const invalid = { ...completed, evidence: { ...completed.evidence, solid_background_check: { ...check, ...change } } };
    assert(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: [invalid] } }).length > 0, JSON.stringify(change));
  }
  const failed = { ...attempt, status: "failed", output_has_alpha: false, evidence: { ...attempt.evidence, reason: "背景检查失败", solid_background_check: { ...check, status: "failed", background_color: "#FF00FF", matched_boundary_pixels: 5 } } };
  assert.deepEqual(validateTransparentBackgroundContract({ ...base, generation: { ...base.generation, background_removal_attempts: [failed, completed] } }), []);
});
