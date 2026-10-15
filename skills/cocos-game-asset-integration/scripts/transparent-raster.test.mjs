import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodePngRgba, encodePngRgba } from "./effect_image_raster.mjs";
import { assertTransparencyPreviewPathsSafe, inspectTransparencyPixels, writeTransparencyPreviews } from "./transparent-raster.mjs";

/** 构造便于检查 Alpha 统计的固定小型 RGBA 样例。 */
function sampleImage() {
  const pixels = Buffer.from([
    0, 0, 0, 0,       240, 80, 20, 255,
    240, 80, 20, 128, 240, 80, 20, 32,
  ]);
  return { width: 2, height: 2, pixels };
}

test("Alpha 统计包含半透明像素并计算非空主体边界", () => {
  assert.deepEqual(inspectTransparencyPixels(sampleImage()), {
    transparent_pixels: 3,
    partial_alpha_pixels: 2,
    visible_pixels: 3,
    bounds: { x: 0, y: 0, width: 2, height: 2 },
  });
});

test("空主体边界稳定返回零尺寸范围", () => {
  const image = { width: 2, height: 1, pixels: Buffer.alloc(8) };
  assert.deepEqual(inspectTransparencyPixels(image), {
    transparent_pixels: 2,
    partial_alpha_pixels: 0,
    visible_pixels: 0,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  });
});

test("深浅底预览保留可选候选记录并正确合成半透明像素", async () => {
  const directory = await mkdtemp(join(tmpdir(), "transparent-raster-"));
  try {
    const sourceFile = join(directory, "glow.png");
    const previewDirectory = join(directory, "previews");
    const sourceBytes = encodePngRgba(2, 2, sampleImage().pixels);
    await writeFile(sourceFile, sourceBytes);
    const record = await writeTransparencyPreviews({
      sourceFile,
      previewDirectory,
      candidateSha256: "candidate-after-edit",
    });
    assert.equal(record.candidate_sha256, "candidate-after-edit");
    assert.match(record.source_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(record, {
      candidate_sha256: "candidate-after-edit",
      source_file: sourceFile,
      source_sha256: `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
      light: { file: join(previewDirectory, "glow.light.png"), sha256: record.light.sha256, background_color: "#F2E9DF" },
      dark: { file: join(previewDirectory, "glow.dark.png"), sha256: record.dark.sha256, background_color: "#16202E" },
    });
    const light = decodePngRgba(await readFile(record.light.file));
    const dark = decodePngRgba(await readFile(record.dark.file));
    assert.deepEqual([...light.pixels.subarray(8, 11)], [241, 156, 121]);
    assert.deepEqual([...dark.pixels.subarray(8, 11)], [131, 56, 33]);
    assert.equal(inspectTransparencyPixels(light).transparent_pixels, 0);
    assert.equal(inspectTransparencyPixels(dark).transparent_pixels, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("候选哈希缺失时显式记录绑定缺口，不伪造候选身份", async () => {
  const directory = await mkdtemp(join(tmpdir(), "transparent-raster-unbound-"));
  try {
    const sourceFile = join(directory, "item.png");
    await writeFile(sourceFile, encodePngRgba(1, 1, Buffer.from([20, 80, 120, 128])));
    const record = await writeTransparencyPreviews({ sourceFile, previewDirectory: join(directory, "previews") });
    assert.equal(Object.hasOwn(record, "candidate_sha256"), false);
    assert.match(record.source_sha256, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("深浅预览覆盖源图、交付物或相互覆盖时写前拒绝", async () => {
  const directory = await mkdtemp(join(tmpdir(), "transparent-raster-paths-"));
  try {
    const sourceFile = join(directory, "item.png");
    await writeFile(sourceFile, encodePngRgba(1, 1, Buffer.from([20, 80, 120, 128])));
    assert.deepEqual(assertTransparencyPreviewPathsSafe({ sourceFile, previewDirectory: directory }), {
      light: join(directory, "item.light.png"), dark: join(directory, "item.dark.png"),
    });
    await assert.rejects(() => writeTransparencyPreviews({
      sourceFile,
      previewDirectory: join(directory, "previews"),
      reservedPaths: [join(directory, "previews", "item.light.png")],
    }), /不得覆盖/);
    await assert.rejects(access(join(directory, "previews", "item.light.png")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("预览目标已存在时拒绝覆盖且不留下另一张半成品", async () => {
  const directory = await mkdtemp(join(tmpdir(), "transparent-raster-existing-"));
  try {
    const sourceFile = join(directory, "item.png");
    const previewDirectory = join(directory, "previews");
    await writeFile(sourceFile, encodePngRgba(1, 1, Buffer.from([20, 80, 120, 128])));
    await mkdir(previewDirectory, { recursive: true });
    const lightFile = join(previewDirectory, "item.light.png");
    const original = Buffer.from("belongs-to-another-candidate");
    await writeFile(lightFile, original);
    await assert.rejects(() => writeTransparencyPreviews({ sourceFile, previewDirectory }), /已存在，拒绝覆盖/);
    assert.deepEqual(await readFile(lightFile), original);
    await assert.rejects(access(join(previewDirectory, "item.dark.png")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("非法 RGBA 输入与没有可见主体的预览源均失败", async () => {
  assert.throws(() => inspectTransparencyPixels({ width: 1, height: 1, pixels: Buffer.alloc(3) }), /RGBA Buffer/);
  const directory = await mkdtemp(join(tmpdir(), "transparent-raster-empty-"));
  try {
    const sourceFile = join(directory, "empty.png");
    await writeFile(sourceFile, encodePngRgba(1, 1, Buffer.alloc(4)));
    await assert.rejects(() => writeTransparencyPreviews({ sourceFile, previewDirectory: join(directory, "previews") }), /没有可见主体/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
