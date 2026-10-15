import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { buildSolidBackgroundPrompt, DEFAULT_SOURCE_BACKGROUND_COLOR, validateTransparentBackgroundContract } from "./visual-transparent-background-contract.mjs";
import { validateImageGenerationContract } from "./visual-production-contract.mjs";
import { normalizeImageToContract, runImageNormalizationCli } from "./visual-image-normalization.mjs";
import { validateImageNormalizationContract } from "./visual-image-normalization-contract.mjs";
import { prepareTransparencyFixture } from "./transparent-route-test-fixtures.mjs";

const OUTPUT_SHA = `sha256:${"a".repeat(64)}`;
const SOURCE_SHA = `sha256:${"b".repeat(64)}`;
const FIRST_ATTEMPT_SHA = `sha256:${"c".repeat(64)}`;

/** 在临时目录中创建可控 Alpha 和内容身份的 PNG 原图。 */
async function createPng(file, width, height, alpha = true, color = { r: 20, g: 80, b: 180 }) {
  const channels = alpha ? 4 : 3;
  const background = alpha ? { ...color, alpha: 0.5 } : color;
  await sharp({ create: { width, height, channels, background } }).png().toFile(file);
}

/** 九宫格只归一化完整源帧；显示框尺寸和普通比例裁切不能覆盖冻结的小图合同。 */
test("九宫格归一化保持源帧比例并拒绝显示尺寸或裁框", async () => {
  const root = await mkdtemp(join(tmpdir(), "nine-slice-normalization-"));
  const sourceFile = join(root, "source.png");
  const outputFile = join(root, "output.png");
  const nineSlice = { mode: "stretch", reason: "角边固定的底板", source_size: { width: 96, height: 64 }, borders: { left: 12, right: 12, top: 10, bottom: 10 } };
  try {
    await createPng(sourceFile, 192, 128, false);
    const result = await normalizeImageToContract({ sourceFile, outputFile, targetWidth: 96, targetHeight: 64, nine_slice: nineSlice });
    assert.equal(result.operation, "resize-to-contract");
    assert.equal(result.output_width, 96); assert.equal(result.output_height, 64);
    await assert.rejects(normalizeImageToContract({ sourceFile, outputFile: join(root, "large.png"), targetWidth: 300, targetHeight: 180, nine_slice: nineSlice }), /小图 source_size/);
    await createPng(join(root, "wrong-ratio.png"), 192, 192, false);
    await assert.rejects(normalizeImageToContract({ sourceFile: join(root, "wrong-ratio.png"), outputFile: join(root, "cropped.png"), targetWidth: 96, targetHeight: 64, nine_slice: nineSlice }), /禁止裁切/);
    const logs = [];
    const exit = await runImageNormalizationCli(["--source", sourceFile, "--output", join(root, "cli.png"), "--width", "96", "--height", "64", "--nine-slice-json", JSON.stringify(nineSlice)], { log: (value) => logs.push(value), error: (value) => logs.push(value) });
    assert.equal(exit, 0);
    assert.equal(JSON.parse(logs[0]).output_width, 96);
  } finally { await rm(root, { recursive: true, force: true }); }
});

/** 建立带透明留白和半透明主体的固定 PNG，供裁切完整性测试复用。 */
async function createPaddedAlphaPng(file, width, height, margin = 12) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 20;
      pixels[offset + 1] = 80;
      pixels[offset + 2] = 180;
      pixels[offset + 3] = 160;
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(file);
}

/** 构造与生产门一致的归一化记录。 */
function normalizationRecord(overrides = {}) {
  return {
    schema: "image-normalization/1",
    status: "passed",
    operation: "resize-to-contract",
    source_file: "art/hero-original.png",
    source_sha256: SOURCE_SHA,
    source_width: 100,
    source_height: 50,
    target_width: 200,
    target_height: 100,
    output_file: "public/hero.png",
    output_sha256: OUTPUT_SHA,
    output_width: 200,
    output_height: 100,
    preserve_alpha: true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

/** 读取真实 attempt 的完整身份，测试夹具与运行时/Schema 使用同一字段集合。 */
async function attemptDescriptor(file, attemptId, generationRecordId, generatedAt) {
  const metadata = await sharp(file).metadata();
  const sha256 = `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
  return { attempt_id: attemptId, generation_record_id: generationRecordId, generated_at: generatedAt, file, sha256, width: metadata.width, height: metadata.height };
}

/** 构造受控裁切记录夹具，覆盖两次比例失败、焦点和最大整数裁切矩形。 */
function cropNormalizationRecord(overrides = {}) {
  return normalizationRecord({
    operation: "crop-and-resize-to-contract",
    source_file: "art/attempt-two.png",
    source_sha256: SOURCE_SHA,
    source_width: 1672,
    source_height: 941,
    target_width: 1920,
    target_height: 1080,
    output_file: "public/hero.png",
    output_width: 1920,
    output_height: 1080,
    aspect_ratio_correction: {
      schema: "aspect-ratio-correction/1",
      status: "passed",
      trigger: "two-generation-attempts-mismatched",
      strategy: "controlled-crop",
      attempts: [
        { attempt_id: "ATTEMPT-ONE", generation_record_id: "GEN-ONE", generated_at: "2026-08-25T00:00:00.000Z", file: "art/attempt-one.png", sha256: FIRST_ATTEMPT_SHA, width: 1672, height: 941 },
        { attempt_id: "ATTEMPT-TWO", generation_record_id: "GEN-TWO", generated_at: "2026-08-25T00:01:00.000Z", file: "art/attempt-two.png", sha256: SOURCE_SHA, width: 1672, height: 941 },
      ],
      focus: { x: 0.5, y: 0.5 },
      crop_rect: { left: 4, top: 2, width: 1664, height: 936 },
    },
    ...overrides,
  });
}

/** 构造与裁切记录尺寸相符的 图像生成 合同夹具。 */
function cropFixture(overrides = {}) {
  const record = cropNormalizationRecord();
  const expectedAsset = { asset_id: "hero", source_file: record.source_file, runtime_file: record.output_file, mime_type: "image/png", width: 1920, height: 1080, alpha: true };
  const asset = { source_file: record.source_file, output_file: record.output_file, runtime_outputs: [record.output_file], mime_type: "image/png", width: 1920, height: 1080, alpha: true, sha256: OUTPUT_SHA, normalization_record: record };
  const generation = { source_file: record.source_file, output_file: record.output_file, normalization_record: record };
  return { expectedAsset, asset, generation, contract: { production_method: "image-generation", image_generation_required: true }, metadata: { mime_type: "image/png", file: record.output_file, width: 1920, height: 1080, alpha: true, sha256: OUTPUT_SHA }, ...overrides };
}

/** 构造一条同时绑定原图、最终输出和生成记录的 图像生成 夹具。 */
function normalizedFixture(overrides = {}) {
  const expectedAsset = {
    asset_id: "hero",
    source_file: "art/hero-original.png",
    runtime_file: "public/hero.png",
    mime_type: "image/png",
    width: 200,
    height: 100,
    alpha: true,
  };
  const asset = {
    source_file: "art/hero-original.png",
    output_file: "public/hero.png",
    runtime_outputs: ["public/hero.png"],
    mime_type: "image/png",
    width: 200,
    height: 100,
    alpha: true,
    sha256: OUTPUT_SHA,
    normalization_record: normalizationRecord(),
  };
  const generation = {
    source_file: "art/hero-original.png",
    output_file: "public/hero.png",
    normalization_record: normalizationRecord(),
    ...overrides,
  };
  return { expectedAsset, asset, generation, contract: { production_method: "image-generation", image_generation_required: true }, metadata: { mime_type: "image/png", file: "public/hero.png", width: 200, height: 100, alpha: true, sha256: OUTPUT_SHA } };
}

/** 生成唯一透明背景移除路线的完整记录，并把归一化源绑定到去背输出。 */
function transparentGeneration() {
  return {
    source_background_mode: "opaque",
    final_background_mode: "transparent",
    transparency_strategy: "background-removal",
    source_background_color: DEFAULT_SOURCE_BACKGROUND_COLOR,
    raw_source_file: "art/hero-raw.png",
    raw_source_has_alpha: false,
    source_file: "art/hero-cutout.png",
    source_has_alpha: true,
    full_prompt: `生成独立角色。\n${buildSolidBackgroundPrompt(DEFAULT_SOURCE_BACKGROUND_COLOR)}`,
    command_or_recipe: "imagegen hero -> background-removal once",
    postprocess: ["background-removal"],
    record_id: "GEN-HERO",
    background_removal_attempts: [{ operation: "background-removal", status: "completed", source_file: "art/hero-raw.png", output_file: "art/hero-cutout.png", source_has_alpha: false, output_has_alpha: true, completed_at: "2026-08-25T00:00:00.000Z", evidence: { provider_status: "completed", solid_background_check: { status: "passed", background_color: DEFAULT_SOURCE_BACKGROUND_COLOR, tolerance: 0, boundary_pixels: 4, matched_boundary_pixels: 4, opaque: true } } }],
  };
}

test("同宽高比缩放到精确尺寸并保留 Alpha", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.png");
    await createPng(source, 100, 50, true);
    const record = await normalizeImageToContract({ sourceFile: source, outputFile: output, targetWidth: 200, targetHeight: 100, requireAlpha: true });
    const metadata = await sharp(output).metadata();
    assert.equal(record.operation, "resize-to-contract");
    assert.equal(metadata.width, 200);
    assert.equal(metadata.height, 100);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(record.preserve_alpha, true);
    assert(record.source_alpha_stats.partial_alpha_pixels > 0);
    assert(record.alpha_stats.partial_alpha_pixels > 0);
    assert.equal(record.transparency_preview.inspection.status, "pending");
    assert.equal(record.transparency_preview.light.background_color, "#F2E9DF");
    assert.equal(record.transparency_preview.dark.background_color, "#16202E");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("尺寸已正确时记录 not-required 且仍输出 PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.png");
    await createPng(source, 200, 100, true);
    const record = await normalizeImageToContract({ sourceFile: source, outputFile: output, targetWidth: 200, targetHeight: 100, requireAlpha: true });
    assert.equal(record.operation, "not-required");
    assert.equal((await sharp(output).metadata()).format, "png");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("不透明 图像生成 可归一化为 JPEG 并保留确定性尺寸记录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.jpg");
    await createPng(source, 100, 50, false);
    const record = await normalizeImageToContract({ sourceFile: source, outputFile: output, targetWidth: 200, targetHeight: 100 });
    const metadata = await sharp(output).metadata();
    assert.equal(record.operation, "resize-to-contract");
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 200);
    assert.equal(metadata.height, 100);
    assert.equal(metadata.hasAlpha, false);
    assert.equal(record.preserve_alpha, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("宽高比不匹配且没有两次失败证据时拒绝归一化", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    await createPng(source, 100, 60, true);
    await assert.rejects(() => normalizeImageToContract({ sourceFile: source, outputFile: join(directory, "normalized.png"), targetWidth: 200, targetHeight: 100, requireAlpha: true }), /宽高比不一致/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("1672×941 两次比例失败可按中心焦点裁成 1664×936 并归一化到 1920×1080", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const firstAttempt = join(directory, "attempt-one.png");
    const source = join(directory, "attempt-two.png");
    const output = join(directory, "normalized.png");
    // 第一次生成允许使用不同输出尺寸；只要两次都未命中目标比例即可进入受控裁切。
    await createPng(firstAttempt, 100, 60, true);
    await createPaddedAlphaPng(source, 1672, 941);
    const record = await normalizeImageToContract({
      sourceFile: source,
      outputFile: output,
      targetWidth: 1920,
      targetHeight: 1080,
      requireAlpha: true,
      candidateSha256: SOURCE_SHA,
      aspect_ratio_correction: { attempts: [await attemptDescriptor(firstAttempt, "ATTEMPT-ONE", "GEN-ONE", "2026-08-25T00:00:00.000Z"), await attemptDescriptor(source, "ATTEMPT-TWO", "GEN-TWO", "2026-08-25T00:01:00.000Z")], focus: { x: 0.5, y: 0.5 } },
    });
    const metadata = await sharp(output).metadata();
    assert.equal(record.operation, "crop-and-resize-to-contract");
    assert.deepEqual(record.aspect_ratio_correction.crop_rect, { left: 4, top: 2, width: 1664, height: 936 });
    assert.equal(record.aspect_ratio_correction.attempts.length, 2);
    assert.deepEqual(record.aspect_ratio_correction.focus, { x: 0.5, y: 0.5 });
    assert.equal(metadata.width, 1920);
    assert.equal(metadata.height, 1080);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(Object.hasOwn(record.transparency_preview, "candidate_sha256"), false);
    assert.equal(record.alpha_stats.partial_alpha_pixels > 0, true);
    assert.deepEqual(validateImageNormalizationContract({
      expectedAsset: { asset_id: "hero", source_file: source, runtime_file: output, mime_type: "image/png", width: 1920, height: 1080, alpha: true },
      asset: { source_file: source, output_file: output, runtime_outputs: [output], sha256: record.output_sha256, normalization_record: record },
      generation: { source_file: source, output_file: output, normalization_record: record },
      contract: { production_method: "image-generation", image_generation_required: true },
      metadata: { file: output, mime_type: "image/png", width: 1920, height: 1080, alpha: true, sha256: record.output_sha256 },
    }), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("透明路线以两次原始输出作证据、去背输出作源图并在裁切后保留 Alpha", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const rawAttemptOne = join(directory, "attempt-one.png");
    const rawAttemptTwo = join(directory, "attempt-two.png");
    const source = join(directory, "hero-cutout.png");
    const output = join(directory, "normalized.png");
    await createPng(rawAttemptOne, 1672, 941, false);
    await createPng(rawAttemptTwo, 1672, 941, false, { r: 21, g: 80, b: 180 });
    await createPaddedAlphaPng(source, 1672, 941);

    const record = await normalizeImageToContract({
      sourceFile: source,
      outputFile: output,
      targetWidth: 1920,
      targetHeight: 1080,
      requireAlpha: true,
      candidateSha256: SOURCE_SHA,
      // attempts 始终记录两次不透明原始 图像生成 输出；去背后的 source 才是归一化输入。
      aspect_ratio_correction: { attempts: [await attemptDescriptor(rawAttemptOne, "RAW-ATTEMPT-ONE", "RAW-GEN-ONE", "2026-08-25T00:00:00.000Z"), await attemptDescriptor(rawAttemptTwo, "RAW-ATTEMPT-TWO", "RAW-GEN-TWO", "2026-08-25T00:01:00.000Z")], focus: { x: 0.5, y: 0.5 } },
    });
    const baseGeneration = transparentGeneration();
    const generation = {
      ...baseGeneration,
      raw_source_file: rawAttemptTwo,
      source_file: source,
      output_file: output,
      runtime_file: output,
      normalization_record: record,
      background_removal_attempts: [{
        ...baseGeneration.background_removal_attempts[0],
        source_file: rawAttemptTwo,
        output_file: source,
      }],
    };
    const expectedAsset = { asset_id: "hero", source_file: source, runtime_file: output, mime_type: "image/png", width: 1920, height: 1080, alpha: true };
    const asset = { source_file: source, output_file: output, runtime_outputs: [output], mime_type: "image/png", width: 1920, height: 1080, alpha: true, sha256: record.output_sha256, normalization_record: record };
    const metadata = { mime_type: "image/png", file: output, width: 1920, height: 1080, alpha: true, sha256: record.output_sha256 };
    prepareTransparencyFixture(generation, expectedAsset);
    assert.notEqual(record.aspect_ratio_correction.attempts[1].file, record.source_file);
    assert.equal(record.aspect_ratio_correction.attempts[1].width, record.source_width);
    assert.equal(record.aspect_ratio_correction.attempts[1].height, record.source_height);
    assert.deepEqual(validateImageNormalizationContract({ expectedAsset, asset, generation, contract: { production_method: "image-generation", image_generation_required: true }, metadata }), []);
    assert.deepEqual(validateTransparentBackgroundContract({ asset, contract: { production_method: "image-generation", image_generation_required: true }, generation, expectedAsset, metadata }), []);
    assert.equal((await sharp(output).metadata()).hasAlpha, true);

    const wrongRawGeneration = { ...generation, raw_source_file: source };
    assert(validateImageNormalizationContract({ expectedAsset, asset, generation: wrongRawGeneration, contract: { production_method: "image-generation", image_generation_required: true }, metadata }).length > 0);
    assert(validateTransparentBackgroundContract({ asset, contract: { production_method: "image-generation", image_generation_required: true }, generation: wrongRawGeneration, expectedAsset, metadata }).length > 0);
    const wrongSourceGeneration = { ...generation, source_file: rawAttemptTwo };
    assert(validateImageNormalizationContract({ expectedAsset, asset, generation: wrongSourceGeneration, contract: { production_method: "image-generation", image_generation_required: true }, metadata }).length > 0);
    assert(validateTransparentBackgroundContract({ asset, contract: { production_method: "image-generation", image_generation_required: true }, generation: wrongSourceGeneration, expectedAsset, metadata }).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("比例修正保留 attempt 绑定/裁切/焦点检查，摘要变化不阻断", () => {
  const fixture = cropFixture();
  const base = fixture.asset.normalization_record;
  const invalidRecords = [
    { ...base, aspect_ratio_correction: { ...base.aspect_ratio_correction, attempts: base.aspect_ratio_correction.attempts.slice(0, 1) } },
    { ...base, aspect_ratio_correction: { ...base.aspect_ratio_correction, attempts: base.aspect_ratio_correction.attempts.map((attempt, index) => index === 1 ? { ...attempt, width: 1673 } : attempt) } },
    { ...base, aspect_ratio_correction: { ...base.aspect_ratio_correction, attempts: base.aspect_ratio_correction.attempts.map((attempt, index) => index === 1 ? { ...attempt, file: "art/other.png" } : attempt) } },
    { ...base, aspect_ratio_correction: { ...base.aspect_ratio_correction, crop_rect: { ...base.aspect_ratio_correction.crop_rect, width: 1663 } } },
    { ...base, aspect_ratio_correction: { ...base.aspect_ratio_correction, focus: { x: 1.1, y: 0.5 } } },
  ];
  for (const record of invalidRecords) {
    const errors = validateImageNormalizationContract({ ...fixture, asset: { ...fixture.asset, normalization_record: record }, generation: fixture.generation, metadata: fixture.metadata });
    assert(errors.length > 0, "非法比例修正记录不应通过合同");
  }
  const staleDigests = {
    ...base,
    source_sha256: "missing-or-stale",
    output_sha256: "missing-or-stale",
    aspect_ratio_correction: { ...base.aspect_ratio_correction, attempts: base.aspect_ratio_correction.attempts.map((attempt) => ({ ...attempt, sha256: "missing-or-stale" })) },
  };
  const digestErrors = validateImageNormalizationContract({ ...fixture, asset: { ...fixture.asset, normalization_record: staleDigests }, generation: fixture.generation, metadata: fixture.metadata });
  assert.equal(digestErrors.some((item) => /SHA|摘要/i.test(item)), false, digestErrors.join("\n"));
});

test("透明目标拒绝没有 Alpha 的原图", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    await createPng(source, 100, 50, false);
    await assert.rejects(() => normalizeImageToContract({ sourceFile: source, outputFile: join(directory, "normalized.png"), targetWidth: 200, targetHeight: 100, requireAlpha: true }), /alpha<255|Alpha/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PNG 声明 Alpha 通道但像素全不透明时拒绝透明目标", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-opaque-alpha-"));
  try {
    const source = join(directory, "opaque-alpha-channel.png");
    await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 20, g: 80, b: 180, alpha: 1 } } }).png().toFile(source);
    assert.equal((await sharp(source).metadata()).hasAlpha, true);
    await assert.rejects(
      () => normalizeImageToContract({ sourceFile: source, outputFile: join(directory, "normalized.png"), targetWidth: 200, targetHeight: 100, requireAlpha: true }),
      /没有 alpha<255 的像素/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("透明归一化 CLI 生成预览且不要求 workflow 候选摘要", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-cli-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.png");
    await createPng(source, 2, 1, true);
    const logs = [];
    const warnings = [];
    const errors = [];
    const exitCode = await runImageNormalizationCli([
      "--source", source, "--output", output, "--width", "2", "--height", "1", "--require-alpha",
    ], { log: (value) => logs.push(value), warn: (value) => warnings.push(value), error: (value) => errors.push(value) });
    assert.equal(exitCode, 0);
    assert.equal(errors.length, 0);
    assert.deepEqual(warnings, []);
    const record = JSON.parse(logs[0]);
    assert.equal(Object.hasOwn(record.transparency_preview, "candidate_sha256"), false);
    assert.equal(record.transparency_preview.inspection.status, "pending");
    assert.match(record.transparency_preview.source_sha256, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("透明图裁切会切掉任何 alpha>0 主体像素时拒绝写入", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocos-image-normalization-crop-alpha-"));
  try {
    const firstAttempt = join(directory, "attempt-one.png");
    const source = join(directory, "attempt-two.png");
    const output = join(directory, "normalized.png");
    await createPng(firstAttempt, 100, 60, false);
    await createPng(source, 1672, 941, true);
    const attempts = [
      await attemptDescriptor(firstAttempt, "CROP-ONE", "CROP-GEN-ONE", "2026-08-25T00:00:00.000Z"),
      await attemptDescriptor(source, "CROP-TWO", "CROP-GEN-TWO", "2026-08-25T00:01:00.000Z"),
    ];
    await assert.rejects(() => normalizeImageToContract({
      sourceFile: source,
      outputFile: output,
      targetWidth: 1920,
      targetHeight: 1080,
      requireAlpha: true,
      aspect_ratio_correction: {
        attempts,
        focus: { x: 0.5, y: 0.5 },
      },
    }), /会切除 alpha>0 的主体像素/);
    await assert.rejects(() => readFile(output));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("契约拒绝缺少、失败或错误的归一化记录", () => {
  const fixture = normalizedFixture();
  for (const current of [
    { asset: { ...fixture.asset, normalization_record: undefined }, generation: { ...fixture.generation, normalization_record: undefined } },
    { asset: { ...fixture.asset, normalization_record: null }, generation: {} },
    { asset: { ...fixture.asset, normalization_record: normalizationRecord({ status: "failed" }) }, generation: {} },
    { asset: { ...fixture.asset, normalization_record: normalizationRecord({ output_file: "public/wrong.png" }) }, generation: {} },
    { asset: { ...fixture.asset, normalization_record: normalizationRecord({ schema: "image-normalization/0" }) }, generation: {} },
  ]) {
    const errors = validateImageNormalizationContract({ ...fixture, ...current });
    assert(errors.length > 0);
  }
});

test("视觉生产契约门接线后拒绝失败或错误归一化记录", () => {
  const fixture = normalizedFixture();
  for (const normalization of [normalizationRecord({ status: "failed" }), normalizationRecord({ output_file: "public/wrong.png" })]) {
    const asset = { ...fixture.asset, generation_record: { ...fixture.generation, normalization_record: normalization } };
    const errors = validateImageGenerationContract(asset, fixture.contract, { stage: "V3", annotation_number: 1, region_id: "hero" }, { expectedAsset: fixture.expectedAsset, checkFiles: false });
    assert(errors.some((item) => item.includes("normalization_record")), errors.join("\n"));
  }
});

test("背景移除路线在有效归一化后通过", () => {
  const fixture = normalizedFixture();
  fixture.expectedAsset = { ...fixture.expectedAsset, source_file: "art/hero-cutout.png" };
  fixture.asset = { ...fixture.asset, source_file: "art/hero-cutout.png", normalization_record: normalizationRecord({ source_file: "art/hero-cutout.png" }) };
  fixture.generation = { ...fixture.generation, ...transparentGeneration(), normalization_record: normalizationRecord({ source_file: "art/hero-cutout.png" }) };
  prepareTransparencyFixture(fixture.generation, fixture.expectedAsset);
  assert.deepEqual(validateImageNormalizationContract(fixture), []);
  assert.deepEqual(validateTransparentBackgroundContract({ asset: fixture.asset, contract: fixture.contract, generation: fixture.generation, expectedAsset: fixture.expectedAsset, metadata: fixture.metadata }), []);
});

test("alpha=false 的 图像生成 和普通非 图像生成 路线不误触透明 Alpha 门", () => {
  const fixture = normalizedFixture();
  fixture.expectedAsset = { ...fixture.expectedAsset, alpha: false };
  fixture.asset = { ...fixture.asset, alpha: false, normalization_record: normalizationRecord({ preserve_alpha: false }) };
  fixture.generation = { ...fixture.generation, normalization_record: normalizationRecord({ preserve_alpha: false }) };
  fixture.metadata = { ...fixture.metadata, alpha: false };
  assert.deepEqual(validateImageNormalizationContract(fixture), []);
  assert.deepEqual(validateImageNormalizationContract({ ...fixture, contract: { production_method: "authored-raster" } }), []);

  // 不透明路线沿用已有 JPEG 合同；只有透明 expected asset 才会进一步收紧为 PNG。
  const jpegRecord = normalizationRecord({ source_file: "art/hero.jpg", output_file: "public/hero.jpg", preserve_alpha: false });
  const jpegFixture = {
    ...normalizedFixture(),
    expectedAsset: { ...normalizedFixture().expectedAsset, source_file: "art/hero.jpg", runtime_file: "public/hero.jpg", mime_type: "image/jpeg", alpha: false },
    asset: { ...normalizedFixture().asset, source_file: "art/hero.jpg", output_file: "public/hero.jpg", runtime_outputs: ["public/hero.jpg"], mime_type: "image/jpeg", alpha: false, normalization_record: jpegRecord },
    generation: { ...normalizedFixture().generation, source_file: "art/hero.jpg", output_file: "public/hero.jpg", normalization_record: jpegRecord },
    metadata: { ...normalizedFixture().metadata, file: "public/hero.jpg", mime_type: "image/jpeg", alpha: false },
  };
  assert.deepEqual(validateImageNormalizationContract(jpegFixture), []);
});
