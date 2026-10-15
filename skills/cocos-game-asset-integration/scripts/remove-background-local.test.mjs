import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { decodePngRgba, encodePngRgba } from "./effect_image_raster.mjs";
import { BackgroundRemovalError, removeBackgroundLocal, removeConnectedBackground, runRemoveBackgroundCli } from "./remove-background-local.mjs";

/** 生成指定颜色的 RGBA 测试图，所有像素默认保持不透明。 */
function solidImage(width, height, color) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = color[0];
    pixels[index * 4 + 1] = color[1];
    pixels[index * 4 + 2] = color[2];
    pixels[index * 4 + 3] = color[3] ?? 255;
  }
  return { width, height, pixels };
}

/** 为单个测试像素写入 RGBA，便于构造主体和封闭同色区域。 */
function setPixel(image, x, y, color) {
  const offset = (y * image.width + x) * 4;
  image.pixels[offset] = color[0];
  image.pixels[offset + 1] = color[1];
  image.pixels[offset + 2] = color[2];
  image.pixels[offset + 3] = color[3] ?? 255;
}

/** 在临时目录中保存合法 RGBA PNG，并返回路径。 */
async function writeImage(root, name, image) {
  const file = join(root, name);
  await writeFile(file, encodePngRgba(image.width, image.height, image.pixels));
  return file;
}

/** 明确标记仅用于纯色硬边样例的去背授权事实。 */
function hardEdgeRemoval(options = {}) {
  return removeBackgroundLocal({ edgeProfile: "hard-edge", colorSeparationVerified: true, requireSolidBackground: true, ...options });
}

/** 创建收集 CLI 输出的最小 console 替身。 */
function outputCollector() {
  const logs = [];
  const errors = [];
  const warnings = [];
  return { logs, errors, warnings, log: (value) => logs.push(value), error: (value) => errors.push(value), warn: (value) => warnings.push(value) };
}

/** 计算测试 PNG 所需的 CRC32，构造器只用于覆盖 RGB+tRNS 解码路径。 */
function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造带 tRNS 的合法 8 位非隔行 PNG，覆盖灰度和 truecolor 两种透明键。 */
function encodePngWithTransparency(width, height, channels, colorType, channelPixels, transparentColor) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(pngCrc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const raw = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * channels + 1)] = 0;
    channelPixels.copy(raw, y * (width * channels + 1) + 1, y * width * channels, (y + 1) * width * channels);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const trns = Buffer.alloc(transparentColor.length * 2);
  transparentColor.forEach((channel, index) => trns.writeUInt16BE(channel, index * 2));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("tRNS", trns),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 构造带 truecolor tRNS 的 PNG，验证 RGB 透明色不会被解码器抹掉。 */
function encodeRgbPngWithTransparency(width, height, rgbPixels, transparentColor) {
  return encodePngWithTransparency(width, height, 3, 2, rgbPixels, transparentColor);
}

/** 构造带 grayscale tRNS 的 PNG，验证灰度透明色也能保留真实 Alpha。 */
function encodeGrayscalePngWithTransparency(width, height, grayPixels, transparentColor) {
  return encodePngWithTransparency(width, height, 1, 0, grayPixels, [transparentColor]);
}

test("边缘连通背景会被清除，封闭同色区域保持不透明", () => {
  const background = [10, 200, 30, 255];
  const image = solidImage(7, 7, background);
  for (let y = 2; y <= 4; y += 1) for (let x = 2; x <= 4; x += 1) setPixel(image, x, y, [230, 40, 50, 255]);
  // 主体内部的同色像素没有接触边缘，验证四连通填充不会误删封闭区域。
  setPixel(image, 3, 3, background);
  const result = removeConnectedBackground(image, { backgroundColor: "#0ac81e", tolerance: 0 });
  assert.equal(result.removedPixels, 40);
  assert.equal(result.pixels[(0 * image.width + 0) * 4 + 3], 0);
  assert.equal(result.pixels[(3 * image.width + 3) * 4 + 3], 255);
  assert.equal(result.pixels[(2 * image.width + 2) * 4 + 3], 255);
});

test("透明边框参与背景连通但不计入删除，内侧纯色背景可以被移除", () => {
  const image = solidImage(5, 5, [0, 255, 0, 0]);
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) setPixel(image, x, y, [0, 255, 0, 255]);
  setPixel(image, 2, 2, [240, 40, 50, 255]);
  const result = removeConnectedBackground(image, { backgroundColor: "#00ff00", tolerance: 0 });
  assert.equal(result.removedPixels, 8);
  assert.equal(result.pixels[3], 0, "原透明边框仍然透明");
  assert.equal(result.pixels[(1 * image.width + 1) * 4 + 3], 0, "透明边框连通到的绿色背景被清除");
  assert.equal(result.pixels[(2 * image.width + 2) * 4 + 3], 255, "主体保持不透明");
});

test("RGB+tRNS 输入解码为真实透明 Alpha，并可进入 direct-alpha 复用", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-trns-"));
  try {
    const rgb = Buffer.from([12, 34, 56, 240, 40, 50]);
    const sourceBytes = encodeRgbPngWithTransparency(2, 1, rgb, [12, 34, 56]);
    const decoded = decodePngRgba(sourceBytes);
    assert.equal(decoded.pixels[3], 0);
    assert.equal(decoded.pixels[7], 255);
    const source = join(root, "source.png");
    await writeFile(source, sourceBytes);
    const record = await removeBackgroundLocal({ sourceFile: source, outputFile: join(root, "reused.png"), reuseExistingAlpha: true });
    assert.equal(record.status, "PASS");
    assert.equal(record.operation, "direct-alpha");
    assert.equal(record.source_has_alpha, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grayscale+tRNS 输入解码为真实透明 Alpha", () => {
  const decoded = decodePngRgba(encodeGrayscalePngWithTransparency(2, 1, Buffer.from([34, 240]), 34));
  assert.equal(decoded.pixels[3], 0);
  assert.equal(decoded.pixels[7], 255);
});

test("严格模式验证不透明纯色边界并写入检查证据", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-solid-check-"));
  try {
    const image = solidImage(5, 5, [10, 20, 30, 255]);
    for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) setPixel(image, x, y, [240, 40, 50, 255]);
    const source = await writeImage(root, "source.png", image);
    const record = await hardEdgeRemoval({
      sourceFile: source,
      outputFile: join(root, "output.png"),
      recordFile: join(root, "record.json"),
      backgroundColor: "#0a141e",
      tolerance: 0,
    });
    assert.equal(record.status, "PASS");
    assert.deepEqual(record.solid_background_check, {
      status: "passed",
      background_color: "#0a141e",
      tolerance: 0,
      boundary_pixels: 16,
      matched_boundary_pixels: 16,
      opaque: true,
      opaque_pixels: 25,
      total_pixels: 25,
    });
    assert.deepEqual(record.background_removal_attempt.evidence.solid_background_check, record.solid_background_check);
    assert.deepEqual(JSON.parse(await readFile(join(root, "record.json"), "utf8")).solid_background_check, record.solid_background_check);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("硬边去背拒绝棋盘边缘、透明输入和错误颜色且不写文件", async () => {
  const cases = [
    {
      name: "checkerboard-edge",
      image: (() => {
        const image = solidImage(4, 4, [10, 20, 30, 255]);
        setPixel(image, 0, 0, [240, 240, 240, 255]);
        return image;
      })(),
    },
    {
      name: "transparent-input",
      image: (() => {
        const image = solidImage(4, 4, [10, 20, 30, 255]);
        setPixel(image, 0, 0, [10, 20, 30, 0]);
        return image;
      })(),
    },
    {
      name: "wrong-color",
      image: solidImage(4, 4, [240, 40, 50, 255]),
    },
  ];
  const root = await mkdtemp(join(tmpdir(), "background-removal-solid-reject-"));
  try {
    for (const entry of cases) {
      const source = await writeImage(root, `${entry.name}.png`, entry.image);
      const output = join(root, `${entry.name}.output.png`);
      const recordFile = join(root, `${entry.name}.record.json`);
      await assert.rejects(
        () => hardEdgeRemoval({
          sourceFile: source,
          outputFile: output,
          recordFile,
          backgroundColor: "#0a141e",
          tolerance: 0,
        }),
        (error) => error instanceof BackgroundRemovalError && /(require_solid_background 检查失败|不接受含透明)/.test(error.message),
      );
      await assert.rejects(access(output));
      await assert.rejects(access(recordFile));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("严格纯色模式与复用透明 Alpha 互斥", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-solid-conflict-"));
  try {
    const image = solidImage(2, 2, [10, 20, 30, 0]);
    const source = await writeImage(root, "source.png", image);
    const output = join(root, "output.png");
    await assert.rejects(
      () => removeBackgroundLocal({ sourceFile: source, outputFile: output, reuseExistingAlpha: true, requireSolidBackground: true }),
      /require_solid_background 与 reuse_existing_alpha 互斥/,
    );
    await assert.rejects(access(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("缺少显式颜色或非法容差会被参数门拒绝", () => {
  const image = solidImage(2, 2, [1, 2, 3, 255]);
  assert.throws(() => removeConnectedBackground(image, { tolerance: 2 }), /background_color/);
  assert.throws(() => removeConnectedBackground(image, { backgroundColor: "#010203" }), /tolerance/);
  assert.throws(() => removeConnectedBackground(image, { backgroundColor: "#010203", tolerance: -1 }), /tolerance/);
  assert.throws(() => removeConnectedBackground(image, { backgroundColor: "#010203", tolerance: 65 }), /0 到 64/);
});

test("颜色阈值路线要求显式硬边与色彩分离确认，并拒绝部分透明输入", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-edge-profile-"));
  try {
    const source = await writeImage(root, "solid.png", solidImage(3, 3, [10, 20, 30, 255]));
    const base = { sourceFile: source, outputFile: join(root, "output.png"), backgroundColor: "#0a141e", tolerance: 0 };
    await assert.rejects(() => removeBackgroundLocal(base), /edge_profile='hard-edge'/);
    await assert.rejects(() => removeBackgroundLocal({ ...base, edgeProfile: "unknown", colorSeparationVerified: true }), /edge_profile='hard-edge'/);
    await assert.rejects(() => removeBackgroundLocal({ ...base, edgeProfile: "hard-edge", colorSeparationVerified: false }), /color_separation_verified=true/);
    await assert.rejects(() => removeBackgroundLocal({ ...base, edgeProfile: "hard-edge", colorSeparationVerified: true, tolerance: 65 }), /0 到 64/);

    const partial = solidImage(3, 3, [10, 20, 30, 255]);
    setPixel(partial, 1, 1, [240, 40, 50, 128]);
    const partialSource = await writeImage(root, "partial.png", partial);
    await assert.rejects(() => hardEdgeRemoval({ ...base, sourceFile: partialSource }), /不接受含透明或半透明像素/);
    await assert.rejects(access(base.outputFile));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("全图清除会被拒绝，且不匹配纯色边界时不会生成失败产物", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-validation-"));
  try {
    const allBackground = await writeImage(root, "all-background.png", solidImage(4, 4, [10, 20, 30, 255]));
    await assert.rejects(() => hardEdgeRemoval({ sourceFile: allBackground, outputFile: join(root, "all-deleted.png"), backgroundColor: "#0a141e", tolerance: 0 }), /清除全部主体/);
    await assert.rejects(access(join(root, "all-deleted.png")));

    const mismatch = await writeImage(root, "mismatch.png", solidImage(4, 4, [240, 40, 50, 255]));
    await assert.rejects(() => hardEdgeRemoval({ sourceFile: mismatch, outputFile: join(root, "no-deletion.png"), backgroundColor: "#0a141e", tolerance: 0 }), /require_solid_background 检查失败/);
    await assert.rejects(access(join(root, "no-deletion.png")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** 帧动画可有合法空终态，但显式允许空帧也不能绕过纯色边界与硬边检查。 */
test("调用方可显式允许空透明单帧且保留去背景边界约束", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-empty-frame-"));
  try {
    const source = await writeImage(root, "empty-frame.png", solidImage(4, 4, [10, 20, 30, 255]));
    const output = join(root, "empty-frame-alpha.png");
    const record = await hardEdgeRemoval({
      sourceFile: source, outputFile: output, backgroundColor: "#0a141e", tolerance: 0,
      allowEmptyForeground: true,
    });
    assert.equal(record.status, "PASS");
    assert.equal(record.foreground_pixels, 0);
    assert.equal(record.transparent_pixels, 16);
    assert.equal(record.allow_empty_foreground, true);
    assert.equal(record.background_removal_attempt.evidence.parameters.allow_empty_foreground, true);
    const image = decodePngRgba(await readFile(output));
    assert(image.pixels.every((value) => value === 0));

    await assert.rejects(hardEdgeRemoval({
      sourceFile: source, outputFile: join(root, "bad-option.png"), backgroundColor: "#0a141e", tolerance: 0,
      allowEmptyForeground: "true",
    }), /allowEmptyForeground/u);
    const mismatch = await writeImage(root, "mismatch.png", solidImage(4, 4, [200, 20, 30, 255]));
    await assert.rejects(hardEdgeRemoval({
      sourceFile: mismatch, outputFile: join(root, "mismatch-alpha.png"), backgroundColor: "#0a141e", tolerance: 0,
      allowEmptyForeground: true,
    }), /require_solid_background/u);
    await assert.rejects(access(join(root, "mismatch-alpha.png")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("已有透明像素可显式复用且不要求重新指定背景颜色", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-alpha-"));
  try {
    const image = solidImage(3, 2, [0, 0, 0, 0]);
    setPixel(image, 1, 0, [230, 40, 50, 255]);
    setPixel(image, 1, 1, [230, 40, 50, 200]);
    const source = await writeImage(root, "source.png", image);
    const record = await removeBackgroundLocal({ sourceFile: source, outputFile: join(root, "reused.png"), reuseExistingAlpha: true });
    assert.equal(record.status, "PASS");
    assert.equal(record.operation, "direct-alpha");
    assert.equal(record.transparency_strategy, "direct-alpha");
    assert.equal(record.method, "reuse-verified-alpha");
    assert.equal(record.removed_pixels, 0);
    assert.equal(record.source_has_transparent_pixels, true);
    assert.equal(record.source_has_alpha, true);
    assert.equal(record.background_removal_attempt, undefined);
    assert.equal(record.output_sha256.startsWith("sha256:"), true);
    assert.deepEqual(decodePngRgba(await readFile(record.output_file)).pixels, image.pixels);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("API 拒绝原地覆盖，成功记录保留原尺寸和输入输出哈希", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-paths-"));
  try {
    const sourceImage = solidImage(4, 4, [10, 20, 30, 255]);
    setPixel(sourceImage, 1, 1, [240, 40, 50, 255]);
    const source = await writeImage(root, "source.png", sourceImage);
    await assert.rejects(() => hardEdgeRemoval({ sourceFile: source, outputFile: source, backgroundColor: "#0a141e", tolerance: 0 }), /不得是同一路径/);
    const output = join(root, "output.png");
    const record = await hardEdgeRemoval({ sourceFile: source, outputFile: output, backgroundColor: "#0a141e", tolerance: 0, recordFile: join(root, "record.json") });
    assert.equal(record.source_width, 4);
    assert.equal(record.source_height, 4);
    assert.equal(record.output_width, 4);
    assert.equal(record.output_height, 4);
    assert.match(record.source_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(record.output_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(record.source_has_alpha, true);
    assert.equal(record.output_has_alpha, true);
    assert.equal(record.background_removal_attempt.status, "completed");
    assert.equal(record.background_removal_attempt.operation, "background-removal");
    assert.equal(record.background_removal_attempt.source_has_alpha, true);
    assert.equal(record.background_removal_attempt.output_has_alpha, true);
    assert.equal(record.tool_version, "1");
    assert.deepEqual(record.background_removal_attempt.evidence.parameters, { tolerance: 0, edge_profile: "hard-edge", color_separation_verified: true });
    assert.equal(record.transparency_preview.inspection.status, "pending");
    assert.equal(JSON.parse(await readFile(join(root, "record.json"), "utf8")).schema, "background-removal-local/1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI 输出记录、可选深浅底预览并对失败状态返回非零码", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-cli-"));
  try {
    const helpCollector = outputCollector();
    assert.equal(await runRemoveBackgroundCli(["--help"], helpCollector), 0);
    assert.match(helpCollector.logs[0], /--edge-profile hard-edge/);

    const image = solidImage(3, 3, [10, 20, 30, 255]);
    setPixel(image, 1, 1, [240, 240, 240, 255]);
    const source = await writeImage(root, "source.png", image);
    const collector = outputCollector();
    const code = await runRemoveBackgroundCli([
      "--source", source,
      "--output", join(root, "output.png"),
      "--background-color", "#0a141e",
      "--tolerance", "0",
      "--edge-profile", "hard-edge",
      "--color-separation-verified",
      "--record", join(root, "record.json"),
      "--preview-dir", join(root, "previews"),
    ], collector);
    assert.equal(code, 0);
    assert.equal(collector.errors.length, 0);
    const cliRecord = JSON.parse(collector.logs[0]);
    assert.equal(cliRecord.status, "PASS");
    assert.equal(cliRecord.solid_background_check.status, "passed");
    assert.equal(cliRecord.output_width, 3);
    assert.equal(cliRecord.transparency_preview.light.file.endsWith("output.light.png"), true);
    assert.equal((await readFile(cliRecord.transparency_preview.light.file)).length > 0, true);
    assert.equal((await readFile(cliRecord.transparency_preview.dark.file)).length > 0, true);
    assert.match(collector.warnings[0], /未绑定 workflow candidate_sha256/);

    const failedCollector = outputCollector();
    const failedOutput = join(root, "failed.png");
    const failedCode = await runRemoveBackgroundCli(["--source", source, "--output", failedOutput, "--background-color", "#f0f0f0", "--tolerance", "0", "--edge-profile", "hard-edge", "--color-separation-verified"], failedCollector);
    assert.equal(failedCode, 1);
    assert.equal(failedCollector.logs.length, 0);
    assert.match(JSON.parse(failedCollector.errors[0]).error, /require_solid_background 检查失败/);
    await assert.rejects(access(failedOutput));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("深浅底预览路径与源图或记录文件冲突时在写出前拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "background-removal-preview-conflict-"));
  try {
    const sourceImage = solidImage(4, 4, [10, 20, 30, 255]);
    setPixel(sourceImage, 1, 1, [240, 40, 50, 255]);
    const source = await writeImage(root, "source.light.png", sourceImage);
    const output = join(root, "source.png");
    await assert.rejects(() => hardEdgeRemoval({ sourceFile: source, outputFile: output, backgroundColor: "#0a141e", tolerance: 0, previewDirectory: root }), /透明预览路径不得覆盖/);
    await assert.rejects(() => access(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
