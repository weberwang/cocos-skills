import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { imagesAtlasHelp, imagesToAtlas, runImagesAtlasCli } from "./images-to-atlas.mjs";

/** 计算来源清单使用的文件 SHA-256。 */
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 生成固定 24×16 RGBA 图片，所有素材均由 Sharp 在测试中合成。 */
async function solidPng(color) {
  const pixels = Buffer.alloc(24 * 16 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset);
  return await sharp(pixels, { raw: { width: 24, height: 16, channels: 4 } }).png().toBuffer();
}

/** 为每个来源帧写入图片与绑定输出 SHA 的本地生成记录。 */
async function writeFrame(directory, index, color, parents = []) {
  const imagePath = `art/frame-${index}.png`;
  const recordPath = `evidence/frame-${index}.generation.json`;
  const imageBytes = await solidPng(color);
  await mkdir(join(directory, "art"), { recursive: true });
  await mkdir(join(directory, "evidence"), { recursive: true });
  await writeFile(join(directory, imagePath), imageBytes);
  const parentRefs = parents.map((parent) => ({ file: parent.image.file, sha256: parent.image.sha256 }));
  const recordBytes = Buffer.from(`${JSON.stringify({
    prompt: `生成第 ${index} 帧`,
    reference_images: parentRefs,
    output_image: { file: imagePath, sha256: sha256(imageBytes) },
  }, null, 2)}\n`);
  await writeFile(join(directory, recordPath), recordBytes);
  return {
    index,
    game_time_ms: index * 1000 / 3,
    kind: index === 0 || index === 3 ? "endpoint" : "inbetween",
    ...(index === 3 ? { reference_only: true } : {}),
    parents: parents.map((parent) => ({ index: parent.index, file: parent.image.file, sha256: parent.image.sha256 })),
    source_image: { file: imagePath, sha256: sha256(imageBytes) },
    image: { file: imagePath, sha256: sha256(imageBytes) },
    generation_record: { file: recordPath, sha256: sha256(recordBytes) },
  };
}

/** 创建循环三帧测试清单，并故意按乱序写入以验证按 index 打包。 */
async function createImageSource(directory, colors = [[220, 20, 10, 255], [10, 30, 230, 255], [0, 0, 0, 0], [20, 210, 30, 255]]) {
  const frame0 = await writeFrame(directory, 0, colors[0]);
  const frame3 = await writeFrame(directory, 3, colors[3], [frame0]);
  const frame1 = await writeFrame(directory, 1, colors[1], [frame0, frame3]);
  const frame2 = await writeFrame(directory, 2, colors[2], [frame1, frame3]);
  const source = {
    schema: "cocos-image-frame-source/1",
    canvas: { width: 24, height: 16 },
    duration_ms: 1000,
    fps: 3,
    loop: true,
    frames: [frame2, frame0, frame3, frame1],
  };
  const manifestPath = join(directory, "source.json");
  await writeFile(manifestPath, `${JSON.stringify(source, null, 2)}\n`);
  return { source, manifestPath };
}

/** 为每项测试创建隔离目录，并在测试完成后清理。 */
async function testDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "images-to-atlas-test-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  return directory;
}

/** 使用真实合成 PNG 核对来源排序、循环槽位、透明留白和输出锚点。 */
test("图片打包按 index 排列、排除循环闭合帧并保持固定锚点和空终态 Alpha", async (t) => {
  const directory = await testDirectory(t);
  const { manifestPath } = await createImageSource(directory);
  const outputSheet = join(directory, "packed.png");
  const report = await imagesToAtlas({
    sourceManifest: manifestPath,
    projectRoot: directory,
    outputSheet,
    width: 12,
    height: 12,
    anchor: { x: 3, y: 14 },
    creatorResourcePath: "animations/packed",
  });

  assert.equal(report.schema, "cocos-image-atlas/2");
  assert.equal(report.cc.schema, "cocos-creator-frame-atlas/2");
  assert.equal(report.cc.sprite_frames.length, 3);
  assert.equal(report.input.fps, 3, "FPS 必须来自来源清单");
  assert.equal(report.animation.loop, true, "循环必须来自来源清单");
  assert.deepEqual(report.frames.map((frame) => frame.index), [0, 1, 2], "闭合参考 index=N 不能进入图集");
  assert.deepEqual(report.cell.content_rect, { x: 0, y: 2, width: 12, height: 8 });
  assert.deepEqual(report.cell.source_anchor, { x: 3, y: 14 });
  assert.deepEqual(report.cell.target_anchor, { x: 1.5, y: 9 });
  assert.equal(report.frames[2].width, 12);
  assert.equal(report.frames[2].height, 12);

  const atlas = await sharp(await readFile(outputSheet)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([atlas.info.width, atlas.info.height], [36, 12]);
  const pixelAt = (frame, x = 0, y = 2) => [...atlas.data.subarray((y * atlas.info.width + frame * 12 + x) * 4, (y * atlas.info.width + frame * 12 + x) * 4 + 4)];
  assert.deepEqual(pixelAt(0), [220, 20, 10, 255]);
  assert.deepEqual(pixelAt(1), [10, 30, 230, 255]);
  assert.deepEqual(pixelAt(2), [0, 0, 0, 0], "透明终态帧需要保留而不能丢帧");
  assert.deepEqual(pixelAt(0, 0, 0), [0, 0, 0, 0], "等比 contain 的留白区域应透明");

  const preview = await readFile(report.artifacts.preview.file, "utf8");
  assert.match(preview, /checker|棋盘|background/u);
  assert.doesNotMatch(preview, /<video\b/u, "图片来源预览不能伪装成视频面板");
  assert.match(imagesAtlasHelp(), /--source-manifest/u);
  assert.match(imagesAtlasHelp(), /--project-root/u);
  assert.match(imagesAtlasHelp(), /相对路径基于 project-root/u);
  assert.doesNotMatch(imagesAtlasHelp(), /--fps\b|--loop\b/u, "CLI 不得覆盖来源时间轴");
});

/** 从项目目录之外运行 API 和 CLI，确认相对来源与输出都锚定在 project-root。 */
test("API 与 CLI 的相对路径均以 project-root 为根", async (t) => {
  const directory = await testDirectory(t);
  await createImageSource(directory);

  const apiReport = await imagesToAtlas({
    sourceManifest: "source.json",
    projectRoot: directory,
    outputSheet: "api/hero.png",
    outputReport: "api/hero-report.json",
    outputPreview: "api/hero-preview.html",
  });
  assert.equal(apiReport.artifacts.sheet.file, join(directory, "api/hero.png"));
  assert.equal(apiReport.artifacts.report.file, join(directory, "api/hero-report.json"));
  assert.equal(apiReport.artifacts.preview.file, join(directory, "api/hero-preview.html"));
  await readFile(join(directory, "api/hero.png"));

  const stdout = [];
  const stderr = [];
  const exitCode = await runImagesAtlasCli([
    "--source-manifest", "source.json",
    "--project-root", directory,
    "--output-sheet", "cli/hero.png",
  ], {
    log: (value) => stdout.push(value),
    error: (value) => stderr.push(value),
  });
  assert.equal(exitCode, 0, stderr.join("\n"));
  const cliReport = JSON.parse(stdout[0]);
  assert.equal(cliReport.artifacts.sheet.file, join(directory, "cli/hero.png"));
  assert.equal(cliReport.artifacts.report.file, join(directory, "cli/hero.json"));
  assert.equal(cliReport.artifacts.preview.file, join(directory, "cli/hero.html"));
  await readFile(join(directory, "cli/hero.png"));
});

/** 图片字节发生变化时，打包器从真实可解码内容生成图集，不依赖外部摘要。 */
test("图片摘要陈旧时仍按当前真实图片字节打包", async (t) => {
  const directory = await testDirectory(t);
  const { manifestPath } = await createImageSource(directory);
  const changedSource = await solidPng([1, 2, 3, 255]);
  await writeFile(join(directory, "art/frame-0.png"), changedSource);
  const outputSheet = join(directory, "tampered.png");

  const report = await imagesToAtlas({
    sourceManifest: manifestPath,
    projectRoot: directory,
    outputSheet,
  });
  assert.equal(report.status, "PASS");
  // 被改成可见像素的来源帧应进入图集；全透明帧和闭环引用帧仍按内容规则跳过。
  assert.equal(report.frames.length, 3);
  assert.equal((await readFile(outputSheet)).length > 0, true);
  assert.equal((await readFile(join(directory, "tampered.json"))).length > 0, true);
  assert.equal((await readFile(join(directory, "tampered.html"))).length > 0, true);
});

/** 核对输入输出碰撞、覆盖保护及处理后全空失败都不会留下产物。 */
test("拒绝覆盖来源或既有输出，并在全透明失败时不留下半成品", async (t) => {
  const directory = await testDirectory(t);
  const { manifestPath } = await createImageSource(directory);
  const originalSource = await readFile(join(directory, "art/frame-0.png"));
  await assert.rejects(imagesToAtlas({
    sourceManifest: manifestPath,
    projectRoot: directory,
    outputSheet: join(directory, "art/frame-0.png"),
  }), /冲突|覆盖|输出/u);
  assert.deepEqual(await readFile(join(directory, "art/frame-0.png")), originalSource);

  const existingReport = join(directory, "existing.json");
  await writeFile(existingReport, "keep this output");
  await assert.rejects(imagesToAtlas({
    sourceManifest: manifestPath,
    projectRoot: directory,
    outputSheet: join(directory, "existing.png"),
    outputReport: existingReport,
  }), /已存在|覆盖/u);
  assert.equal(await readFile(existingReport, "utf8"), "keep this output");

  const allEmptyRoot = join(directory, "all-empty");
  const emptySource = await createImageSource(allEmptyRoot, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  await assert.rejects(imagesToAtlas({
    sourceManifest: emptySource.manifestPath,
    projectRoot: allEmptyRoot,
    outputSheet: join(allEmptyRoot, "empty.png"),
  }), /全部透明|全空/u);
  for (const path of ["empty.png", "empty.json", "empty.html"]) {
    await assert.rejects(readFile(join(allEmptyRoot, path)), { code: "ENOENT" });
  }
});
