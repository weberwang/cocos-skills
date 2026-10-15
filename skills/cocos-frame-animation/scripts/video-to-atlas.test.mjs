import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import sharp from "sharp";
import { checkFrameAnimationWorkflowFiles, FRAME_ANIMATION_WORKFLOW_SCHEMA, sha256Bytes as contractSha256Bytes } from "../../cocos-game-asset-integration/scripts/frame-animation-workflow-contract.mjs";
import { parseVideoAtlasArgs, videoAtlasHelp, videoToAtlas, VideoAtlasError } from "./video-to-atlas.mjs";

/** 建立指定颜色的 RGBA PNG，测试不依赖系统安装 ffmpeg。 */
async function solidPng(width, height, color, patches = []) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    pixels.set([...color, 255], pixel * 4);
  }
  for (const patch of patches) {
    pixels.set([...patch.color, 255], (patch.y * width + patch.x) * 4);
  }
  return await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** 生成可注入的 ffprobe/ffmpeg runner，并把假视频帧写入脚本请求的临时目录。 */
function fakeRunner(frameBytes, observed = {}) {
  return async (command, args) => {
    observed.calls ??= [];
    observed.calls.push({ command, args });
    if (command === "ffprobe-test") {
      return {
        exitCode: 0,
        stdout: JSON.stringify(observed.probePayload ?? {
          streams: [{ codec_type: "video", width: 4, height: 2, avg_frame_rate: "24/1", r_frame_rate: "24/1", duration: "1.5" }],
          format: { duration: "1.5" },
        }),
      };
    }
    if (command === "ffmpeg-test") {
      const filterIndex = args.indexOf("-vf");
      observed.filter = args[filterIndex + 1];
      observed.input = args[args.indexOf("-i") + 1];
      const pattern = args.at(-1);
      for (let index = 0; index < frameBytes.length; index += 1) {
        const target = pattern.replace("%08d", String(index).padStart(8, "0"));
        await writeFile(target, frameBytes[index]);
      }
      return { exitCode: 0, stdout: "" };
    }
    throw new Error("unexpected command: " + command);
  };
}

/** 为每项测试创建隔离临时目录，并在测试结束后清理。 */
async function testDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "video-to-atlas-test-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  return directory;
}

/** 在最小 DOM 与手动 requestAnimationFrame 队列中运行预览脚本，以模拟延迟图片加载。 */
function createPreviewHarness(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, "预览页面应包含可执行脚本");
  const rafQueue = [];
  const drawCalls = [];
  const atlas = { complete: false, naturalWidth: 0, listeners: new Map() };
  atlas.addEventListener = (name, callback) => atlas.listeners.set(name, callback);
  const playerContext = {
    clearRect() {},
    drawImage(source, sourceX) { if (source === atlas) drawCalls.push(sourceX); },
  };
  const player = { width: 0, height: 0, getContext: () => playerContext };
  const speed = { value: "1", listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); } };
  const position = { textContent: "" };
  const toggle = { textContent: "", listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); } };
  const thumbnails = { children: [], append(button) { this.children.push(button); } };
  const elements = { atlas, player, speed, position, toggle, thumbnails };
  const document = {
    getElementById(id) { return elements[id]; },
    createElement(tag) {
      if (tag === "canvas") return { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
      return {
        dataset: {},
        listeners: new Map(),
        setAttribute() {},
        addEventListener(name, callback) { this.listeners.set(name, callback); },
        append() {},
      };
    },
  };
  runInNewContext(script, { document, requestAnimationFrame: (callback) => rafQueue.push(callback) });
  return {
    atlas,
    drawCalls,
    step(time) {
      const callback = rafQueue.shift();
      assert.ok(callback, "预览应继续安排 requestAnimationFrame");
      callback(time);
    },
    toggle,
  };
}

/** 证明 fps 参数传入 ffmpeg，单边尺寸等比缩放且图集像素顺序正确。 */
test("视频抽帧生成单行 Cocos 图集、尺寸与网页预览", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "walk.mp4");
  const outputSheet = join(directory, "walk.png");
  const outputReport = join(directory, "walk.json");
  const outputPreview = join(directory, "walk.html");
  await writeFile(inputVideo, "fake video bytes");
  const frameBytes = await Promise.all([
    solidPng(4, 2, [255, 0, 0]),
    solidPng(4, 2, [0, 0, 255]),
    solidPng(4, 2, [255, 255, 0]),
  ]);
  const observed = {};
  const report = await videoToAtlas({
    inputVideo,
    outputSheet,
    outputReport,
    outputPreview,
    fps: 6,
    width: 2,
    creatorResourcePath: "animations/walk",
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner(frameBytes, observed),
  });

  assert.equal(observed.filter, "fps=6");
  assert.equal(observed.input, inputVideo);
  assert.equal(report.schema, "cocos-video-atlas/2");
  assert.equal(report.status, "PASS");
  assert.equal(report.input.fps, 6);
  assert.equal(report.input.has_audio, false);
  assert.equal(report.input.remove_background, false);
  assert.equal(report.settings.width, 2);
  assert.equal(report.settings.height, 1);
  assert.equal(report.cell.width, 2);
  assert.equal(report.cell.height, 1);
  assert.equal(report.frames.length, 3);
  assert.equal(report.animation.frame_rate, report.input.fps);
  assert.match(report.artifacts.sheet.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(report.cc.texture.width, 6);
  assert.equal(report.cc.texture.height, 1);
  assert.equal(report.cc.sprite_frames.length, 3);
  assert.equal(report.cc.texture.creator_resource_path, "animations/walk");
  assert.deepEqual(report.cc.sprite_frames[2].rect, { x: 4, y: 0, width: 2, height: 1 });

  const decoded = await sharp(await readFile(outputSheet)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual({ width: decoded.info.width, height: decoded.info.height }, { width: 6, height: 1 });
  assert.deepEqual([...decoded.data.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...decoded.data.subarray(8, 12)], [0, 0, 255, 255]);
  assert.deepEqual([...decoded.data.subarray(16, 20)], [255, 255, 0, 255]);
  const preview = await readFile(outputPreview, "utf8");
  assert.match(preview, /抽帧动画/u);
  assert.match(preview, /逐帧缩略图/u);
  assert.match(preview, /<video controls/u);
  assert.match(preview, /src="walk\.png"/u);
  assert.match(preview, new RegExp(`<meta name="cocos-atlas-sha256" content="${report.artifacts.sheet.sha256}">`, "u"));
  assert.match(await readFile(outputReport, "utf8"), /"schema": "cocos-video-atlas\/2"/u);
});

/** 验证带旋转元数据的视频尺寸以自动旋转后的首帧 PNG 为准。 */
test("按旋转视频抽出的首帧尺寸计算图集", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "rotated.mp4");
  const outputSheet = join(directory, "rotated.png");
  await writeFile(inputVideo, "fake rotated video bytes");
  const rotatedFrame = await solidPng(2, 4, [90, 80, 70]);
  const observed = {
    probePayload: {
      streams: [{ codec_type: "video", width: 4, height: 2, avg_frame_rate: "24/1", duration: "1.5", side_data_list: [{ rotation: 90 }] }],
      format: { duration: "1.5" },
    },
  };
  const report = await videoToAtlas({
    inputVideo,
    outputSheet,
    region: { x: 0, y: 0, width: 2, height: 4 },
    fps: 1,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([rotatedFrame], observed),
  });
  assert.deepEqual([report.cell.width, report.cell.height], [2, 4]);
  assert.deepEqual([report.input.display_width, report.input.display_height], [2, 4]);
  assert.deepEqual(report.input.region, { x: 0, y: 0, width: 2, height: 4 }, "区域坐标基于自动旋转后的解码画布");
  const dimensions = await sharp(await readFile(outputSheet)).metadata();
  assert.deepEqual([dimensions.width, dimensions.height], [2, 4]);
});

/** 验证同一源视频可按不同区域独立生成图集，并识别音视频流顺序。 */
test("同一源帧的不同区域生成独立图集并记录精确区域", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "multi-action.mp4");
  await writeFile(inputVideo, "shared source video");
  const frame = await solidPng(6, 4, [20, 30, 40], [
    { x: 1, y: 1, color: [240, 20, 10] }, { x: 2, y: 1, color: [240, 20, 10] },
    { x: 1, y: 2, color: [240, 20, 10] }, { x: 2, y: 2, color: [240, 20, 10] },
    { x: 4, y: 0, color: [10, 40, 240] }, { x: 5, y: 0, color: [10, 40, 240] },
    { x: 4, y: 1, color: [10, 40, 240] }, { x: 5, y: 1, color: [10, 40, 240] },
    { x: 4, y: 2, color: [10, 40, 240] }, { x: 5, y: 2, color: [10, 40, 240] },
    { x: 4, y: 3, color: [10, 40, 240] }, { x: 5, y: 3, color: [10, 40, 240] },
  ]);
  const probePayload = {
    streams: [
      { codec_type: "audio", duration: "1.5" },
      { codec_type: "video", width: 6, height: 4, avg_frame_rate: "24/1", duration: "1.5" },
    ],
    format: { duration: "1.5" },
  };
  // 为同源视频的每次区域抽帧复用完全相同的媒体流探测事实。
  const runFrames = (frames) => fakeRunner(frames, { probePayload });
  const dependencies = {
    inputVideo,
    fps: 1,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
  };
  const firstRegion = { x: 1, y: 1, width: 2, height: 2 };
  const first = await videoToAtlas({
    ...dependencies,
    region: firstRegion,
    outputSheet: join(directory, "left.png"),
    commandRunner: runFrames([frame]),
  });
  const secondRegion = { x: 4, y: 0, width: 2, height: 4 };
  const second = await videoToAtlas({
    ...dependencies,
    region: secondRegion,
    width: 4,
    outputSheet: join(directory, "right.png"),
    commandRunner: runFrames([frame]),
  });
  const thirdRegion = { x: 0, y: 0, width: 4, height: 2 };
  const third = await videoToAtlas({
    ...dependencies,
    region: thirdRegion,
    height: 4,
    outputSheet: join(directory, "bottom.png"),
    commandRunner: runFrames([frame]),
  });

  assert.deepEqual([first.cell.width, first.cell.height], [2, 2]);
  assert.deepEqual([second.cell.width, second.cell.height], [4, 8]);
  assert.deepEqual([third.cell.width, third.cell.height], [8, 4]);
  assert.deepEqual(first.input.region, firstRegion);
  assert.deepEqual(first.settings.region, firstRegion);
  assert.deepEqual(second.input.region, secondRegion);
  assert.deepEqual(second.settings.region, secondRegion);
  assert.deepEqual(third.input.region, thirdRegion);
  assert.deepEqual(third.settings.region, thirdRegion);
  assert.deepEqual([first.input.display_width, first.input.display_height], [6, 4], "报告使用实际解码画布尺寸");
  assert.equal(first.input.has_audio, true);
  assert.equal(second.input.has_audio, true);
  assert.equal(third.input.has_audio, true);
  assert.equal(first.frames[0].source_sha256, contractSha256Bytes(frame), "源帧身份仍应对应未裁剪的解码 PNG");
  const leftPixels = await sharp(await readFile(join(directory, "left.png"))).raw().toBuffer();
  const rightPixels = await sharp(await readFile(join(directory, "right.png"))).raw().toBuffer();
  const bottomPixels = await sharp(await readFile(join(directory, "bottom.png"))).raw().toBuffer();
  assert.deepEqual([...leftPixels.subarray(0, 4)], [240, 20, 10, 255]);
  assert.deepEqual([...rightPixels.subarray(0, 4)], [10, 40, 240, 255]);
  assert.ok(Math.abs(bottomPixels[0] - 20) <= 1 && bottomPixels[1] === 30 && bottomPixels[2] === 40 && bottomPixels[3] === 255, "高宽单边推导后仍应保留对应区域颜色");
  assert.equal(first.cc.sprite_frames[0].rect.width, 2);
  assert.equal(second.cc.sprite_frames[0].rect.height, 8);
});

/** 验证去背景先使用裁剪区域，并在显式宽高时等比缩放到透明固定单元格。 */
test("区域先裁剪再去背景且双边尺寸使用透明 contain", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "contained.mp4");
  const outputSheet = join(directory, "contained.png");
  await writeFile(inputVideo, "fake video bytes");
  const patches = [];
  // 区域边框为绿色、内部为红色，区域外为深色；整帧去背景会因画布边缘不匹配而失败。
  for (let y = 1; y <= 4; y += 1) {
    for (let x = 1; x <= 6; x += 1) {
      patches.push({ x, y, color: x === 1 || x === 6 || y === 1 || y === 4 ? [0, 255, 0] : [220, 20, 10] });
    }
  }
  const frame = await solidPng(8, 6, [20, 20, 20], patches);
  const region = { x: 1, y: 1, width: 6, height: 4 };
  const report = await videoToAtlas({
    inputVideo,
    outputSheet,
    region,
    width: 8,
    height: 8,
    removeBackground: true,
    edgeProfile: "hard-edge",
    colorSeparationVerified: true,
    backgroundColor: "#00ff00",
    backgroundTolerance: 0,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame]),
  });

  assert.deepEqual([report.cell.width, report.cell.height], [8, 8]);
  const decoded = await sharp(await readFile(outputSheet)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([decoded.info.width, decoded.info.height], [8, 8]);
  assert.deepEqual([...decoded.data.subarray(0, 4)], [0, 0, 0, 0], "contain 留白应透明");
  const center = (4 * decoded.info.width + 4) * 4;
  assert.ok(decoded.data[center] > decoded.data[center + 1] && decoded.data[center + 3] > 0, "区域内红色主体应在裁剪后保留");
});

/** 验证实际缩放留白矩形和默认/显式锚点都映射到固定输出单元格。 */
test("4x2内容缩放到4x4时记录透明留白和局部锚点", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "anchor-source.mp4");
  await writeFile(inputVideo, "shared source video");
  const frame = await solidPng(4, 2, [230, 80, 30]);
  const dependencies = {
    inputVideo,
    width: 4,
    height: 4,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
  };
  const defaultReport = await videoToAtlas({
    ...dependencies,
    outputSheet: join(directory, "default-anchor.png"),
    commandRunner: fakeRunner([frame]),
  });
  assert.deepEqual(defaultReport.cell.content_rect, { x: 0, y: 1, width: 4, height: 2 });
  assert.deepEqual(defaultReport.cell.source_anchor, { x: 2, y: 1 });
  assert.deepEqual(defaultReport.cell.target_anchor, { x: 2, y: 2 });
  assert.equal(Object.hasOwn(defaultReport.input, "anchor"), false);
  assert.equal(Object.hasOwn(defaultReport.settings, "anchor"), false);
  const defaultPixels = await sharp(await readFile(join(directory, "default-anchor.png"))).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...defaultPixels.data.subarray(0, 4)], [0, 0, 0, 0], "上方留白应透明");
  assert.deepEqual([...defaultPixels.data.subarray((3 * 4) * 4, (3 * 4) * 4 + 4)], [0, 0, 0, 0], "下方留白应透明");

  const anchor = { x: 1.5, y: 0.5 };
  const explicitReport = await videoToAtlas({
    ...dependencies,
    anchor,
    outputSheet: join(directory, "explicit-anchor.png"),
    commandRunner: fakeRunner([frame]),
  });
  assert.deepEqual(explicitReport.cell.source_anchor, anchor);
  assert.deepEqual(explicitReport.cell.target_anchor, { x: 1.5, y: 1.5 });
  assert.deepEqual(explicitReport.input.anchor, anchor);
  assert.deepEqual(explicitReport.settings.anchor, anchor);
  assert.deepEqual(explicitReport.cc.node_ui_transform, {
    component_type: "UITransform",
    content_size: { width: 4, height: 4 },
    anchor_point_normalized_bottom_left: { x: 0.375, y: 0.625 },
    image_anchor_top_left_pixels: { x: 1.5, y: 1.5 },
  });
  const parsed = parseVideoAtlasArgs(["--input-video", "x.mp4", "--output-sheet", "x.png", "--anchor", "1.5,0.5"]);
  assert.deepEqual(parsed.anchor, anchor);
  assert.throws(() => parseVideoAtlasArgs(["--input-video", "x.mp4", "--output-sheet", "x.png", "--anchor", "1,2,3"]), /--anchor/u);
  assert.match(videoAtlasHelp(), /--anchor <x,y>/u);
});

/** 验证去背景允许混合动画里的全透明帧，但拒绝整段全空并且不留下文件。 */
test("去背景保留空终态帧并拒绝整段透明动画", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "terminal-empty.mp4");
  await writeFile(inputVideo, "shared source video");
  const foregroundFrame = await solidPng(6, 6, [0, 255, 0], [
    { x: 2, y: 2, color: [255, 0, 0] }, { x: 3, y: 2, color: [255, 0, 0] },
    { x: 2, y: 3, color: [255, 0, 0] }, { x: 3, y: 3, color: [255, 0, 0] },
  ]);
  const emptyFrame = await solidPng(6, 6, [0, 255, 0]);
  const removeBackgroundOptions = {
    inputVideo,
    fps: 1,
    removeBackground: true,
    edgeProfile: "hard-edge",
    colorSeparationVerified: true,
    backgroundColor: "#00ff00",
    backgroundTolerance: 0,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
  };
  const report = await videoToAtlas({
    ...removeBackgroundOptions,
    outputSheet: join(directory, "mixed-frames.png"),
    commandRunner: fakeRunner([foregroundFrame, emptyFrame]),
  });
  assert.equal(report.frames.length, 2);
  assert.equal(report.frames[1].source_timestamp, 1);
  assert.equal(report.frames[1].source_sha256, contractSha256Bytes(emptyFrame));
  const sheet = await sharp(await readFile(join(directory, "mixed-frames.png"))).raw().toBuffer({ resolveWithObject: true });
  // 按图集帧索引读取像素 Alpha，用于区分可见动作帧与空终态帧。
  const alphaOf = (frameIndex, x, y) => sheet.data[(y * sheet.info.width + frameIndex * 6 + x) * 4 + 3];
  assert.ok(alphaOf(0, 2, 2) > 0, "主体帧应保留前景 Alpha");
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) assert.equal(alphaOf(1, x, y), 0, "空终态帧应完整透明");
  }

  const emptyBase = join(directory, "all-empty");
  await assert.rejects(videoToAtlas({
    ...removeBackgroundOptions,
    outputSheet: `${emptyBase}.png`,
    commandRunner: fakeRunner([emptyFrame, emptyFrame]),
  }), /全部透明/u);
  for (const extension of ["png", "json", "html"]) {
    await assert.rejects(readFile(`${emptyBase}.${extension}`), { code: "ENOENT" });
  }
});

/** 验证区域和锚点严格校验，并以真实解码画布拒绝越界且不落输出。 */
test("拒绝无效或越界区域和锚点且不留下输出", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "invalid-region.mp4");
  await writeFile(inputVideo, "fake video bytes");
  const frame = await solidPng(4, 2, [120, 80, 40]);
  const invalidRegions = [
    { x: 0, y: 0, width: 2 },
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: Number.MAX_SAFE_INTEGER + 1, y: 0, width: 1, height: 1 },
    { x: "bad", y: 0, width: 1, height: 1 },
    null,
  ];
  for (let index = 0; index < invalidRegions.length; index += 1) {
    await assert.rejects(videoToAtlas({
      inputVideo,
      outputSheet: join(directory, `invalid-${index}.png`),
      region: invalidRegions[index],
    }), VideoAtlasError);
  }
  const invalidAnchors = [null, {}, { x: -0.5, y: 0 }, { x: 0, y: Number.NaN }, { x: undefined, y: 0 }];
  for (let index = 0; index < invalidAnchors.length; index += 1) {
    await assert.rejects(videoToAtlas({
      inputVideo,
      outputSheet: join(directory, `invalid-anchor-${index}.png`),
      anchor: invalidAnchors[index],
    }), VideoAtlasError);
  }
  await assert.rejects(videoToAtlas({
    inputVideo,
    outputSheet: join(directory, "unconfirmed.png"),
    removeBackground: true,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame]),
  }), /必须显式指定 edge-profile/u);
  await assert.rejects(videoToAtlas({
    inputVideo,
    outputSheet: join(directory, "unconfirmed-color.png"),
    removeBackground: true,
    edgeProfile: "hard-edge",
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame]),
  }), /必须显式确认 color-separation-verified=true/u);
  await assert.rejects(videoToAtlas({
    inputVideo,
    outputSheet: join(directory, "outside.png"),
    region: { x: 3, y: 0, width: 2, height: 2 },
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame]),
  }), /region.*超出/u);
  await assert.rejects(videoToAtlas({
    inputVideo,
    outputSheet: join(directory, "outside-anchor.png"),
    region: { x: 0, y: 0, width: 2, height: 2 },
    anchor: { x: 2.5, y: 1 },
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame]),
  }), /anchor.*超出/u);
  for (const base of ["invalid-0", "invalid-1", "invalid-2", "invalid-3", "invalid-4", "invalid-5", "invalid-6", "invalid-anchor-0", "invalid-anchor-1", "invalid-anchor-2", "invalid-anchor-3", "invalid-anchor-4", "outside", "outside-anchor", "unconfirmed", "unconfirmed-color"]) {
    for (const extension of ["png", "json", "html"]) {
      await assert.rejects(readFile(join(directory, `${base}.${extension}`)), { code: "ENOENT" });
    }
  }
  const parsed = parseVideoAtlasArgs(["--input-video", "x.mp4", "--output-sheet", "x.png", "--region", "1,2,3,4", "--edge-profile", "hard-edge", "--color-separation-verified"]);
  assert.deepEqual(parsed.region, { x: "1", y: "2", width: "3", height: "4" });
  assert.equal(parsed.edgeProfile, "hard-edge");
  assert.equal(parsed.colorSeparationVerified, true);
  assert.match(videoAtlasHelp(), /--region <x,y,width,height>/u);
  assert.throws(() => parseVideoAtlasArgs(["--input-video", "x.mp4", "--output-sheet", "x.png", "--region", "1,2,3"]), /--region/u);
  assert.throws(() => parseVideoAtlasArgs(["--input-video", "x.mp4", "--output-sheet", "x.png", "--anchor", "bad,1"]), /--anchor/u);
});

/** 验证非循环预览停在末帧，且再次播放可以从首帧重启。 */
test("非循环网页预览在末帧停止并支持重播", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "attack.mp4");
  const outputSheet = join(directory, "attack.png");
  const outputPreview = join(directory, "attack.html");
  await writeFile(inputVideo, "fake video bytes");
  const frame = await solidPng(4, 2, [180, 40, 30]);
  const report = await videoToAtlas({
    inputVideo,
    outputSheet,
    outputPreview,
    fps: 1,
    loop: false,
    creatorResourcePath: "animations/hero-attack",
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame, frame, frame]),
  });
  assert.equal(report.animation.loop, false);
  assert.equal(report.cc.texture.creator_resource_path, "animations/hero-attack");
  assert.equal(parseVideoAtlasArgs(["--input-video", "x.mp4", "--output-sheet", "x.png", "--creator-resource-path", "animations/hero-attack"]).creatorResourcePath, "animations/hero-attack");
  const preview = await readFile(outputPreview, "utf8");
  assert.match(preview, /"loop":false/u);
  const harness = createPreviewHarness(preview);
  harness.step(0);
  harness.step(1000);
  harness.step(2000);
  assert.deepEqual(harness.drawCalls, [], "图集加载前不应尝试绘制或推进帧");
  harness.atlas.complete = true;
  harness.atlas.naturalWidth = 12;
  harness.atlas.listeners.get("load")();
  assert.deepEqual(harness.drawCalls, [0], "图集加载后应从首帧开始");
  harness.step(10000);
  assert.deepEqual(harness.drawCalls, [0], "加载前流逝的时间不应耗尽非循环动画");
  harness.step(11000);
  assert.deepEqual(harness.drawCalls, [0, 4]);
  harness.step(12000);
  assert.deepEqual(harness.drawCalls, [0, 4, 8]);
  assert.equal(harness.toggle.textContent, "播放");
  harness.toggle.listeners.get("click")();
  assert.equal(harness.drawCalls.at(-1), 0, "末帧再次播放时应回到首帧");
  assert.equal(harness.toggle.textContent, "暂停");
});

/** 验证工具报告、显式 runtime URL、网页 SHA 与项目文件门可直接对接。 */
test("工具输出可直接通过视频图集工作流文件门", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "source.mp4");
  const outputSheet = join(directory, "assets", "resources", "animations", "hero-attack.png");
  const outputReport = join(directory, "reports", "hero-attack.json");
  const outputPreview = join(directory, "public", "hero-attack.html");
  const promptFile = join(directory, "prompts", "hero-attack.txt");
  const sourceVideoBytes = Buffer.from("fake video bytes");
  await writeFile(inputVideo, sourceVideoBytes);
  await mkdir(join(directory, "prompts"), { recursive: true });
  await writeFile(promptFile, "角色向前挥剑，动作循环自然，绿色纯色背景。");
  const frame = await solidPng(6, 4, [190, 90, 25]);
  const region = { x: 1, y: 1, width: 4, height: 2 };
  const anchor = { x: 1.5, y: 0.5 };
  await videoToAtlas({
    inputVideo,
    outputSheet,
    outputReport,
    outputPreview,
    region,
    anchor,
    fps: 2,
    creatorResourcePath: "animations/hero-attack",
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([frame, frame]),
  });
  const relativeFiles = {
    prompt: "prompts/hero-attack.txt",
    source: "source.mp4",
    report: "reports/hero-attack.json",
    preview: "public/hero-attack.html",
    sheet: "assets/resources/animations/hero-attack.png",
  };
  // 读取文件后计算合同要求的内容摘要，避免文件门测试依赖伪造哈希。
  const shaFor = async (path) => contractSha256Bytes(await readFile(join(directory, path)));
  const frameAnimation = {
    schema: FRAME_ANIMATION_WORKFLOW_SCHEMA,
    status: "accepted",
    work_item_id: "work-item-video-atlas",
    candidate_version: "candidate-1",
    settings: { fps: 2, width: 4, height: 2, remove_background: false, region, anchor },
    video_prompt: { file: relativeFiles.prompt, sha256: await shaFor(relativeFiles.prompt) },
    source_video: { file: relativeFiles.source, sha256: await shaFor(relativeFiles.source) },
    quality_report: { file: relativeFiles.report, sha256: await shaFor(relativeFiles.report) },
    preview: { file: relativeFiles.preview, sha256: await shaFor(relativeFiles.preview) },
    spritesheet: {
      file: relativeFiles.sheet,
      sha256: await shaFor(relativeFiles.sheet),
      creator_resource_path: "animations/hero-attack",
    },
  };
  const asset = {
    texture_key: "hero-attack",
    runtime_outputs: [relativeFiles.sheet],
    frame_animation: frameAnimation,
  };
  assert.deepEqual(await checkFrameAnimationWorkflowFiles(asset, {
    projectRoot: directory,
    workItemId: "work-item-video-atlas",
    candidateVersion: "candidate-1",
  }), []);
  assert.equal(JSON.parse(await readFile(outputReport, "utf8")).cc.texture.creator_resource_path, "animations/hero-attack");
});

/** 证明启用去背景时复用本地算法，输出透明背景并保留前景像素。 */
test("可选纯色背景移除生成透明帧", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "greenscreen.mp4");
  const outputSheet = join(directory, "transparent.png");
  await writeFile(inputVideo, "fake video bytes");
  const greenFrame = await solidPng(6, 6, [0, 255, 0], [
    { x: 2, y: 2, color: [255, 0, 0] },
    { x: 3, y: 2, color: [255, 0, 0] },
    { x: 2, y: 3, color: [255, 0, 0] },
    { x: 3, y: 3, color: [255, 0, 0] },
  ]);
  const report = await videoToAtlas({
    inputVideo,
    outputSheet,
    fps: 1,
    removeBackground: true,
    edgeProfile: "hard-edge",
    colorSeparationVerified: true,
    backgroundColor: "#00ff00",
    backgroundTolerance: 0,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([greenFrame]),
  });

  assert.equal(report.input.remove_background, true);
  assert.equal(report.settings.remove_background, true);
  const decoded = await sharp(await readFile(outputSheet)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...decoded.data.subarray(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...decoded.data.subarray((2 * decoded.info.width + 2) * 4, (2 * decoded.info.width + 2) * 4 + 4)], [255, 0, 0, 255]);
});

/** 证明零帧、最大图集尺寸和输入/输出冲突均会失败且不写图集。 */
test("拒绝空抽帧、超限图集和视频路径输出冲突", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "source.mp4");
  await writeFile(inputVideo, "fake video bytes");
  const dependencies = {
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([]),
  };
  await assert.rejects(videoToAtlas({ inputVideo, outputSheet: join(directory, "empty.png"), ...dependencies }), /没有生成任何帧/u);

  const sourcePng = await solidPng(4, 2, [200, 10, 20]);
  const limitedSheet = join(directory, "too-wide.png");
  await assert.rejects(videoToAtlas({
    inputVideo,
    outputSheet: limitedSheet,
    maxAtlasWidth: 8,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([sourcePng, sourcePng, sourcePng]),
  }), /超过最大尺寸/u);

  const conflictPath = join(directory, "same.png");
  await writeFile(conflictPath, "video stored with png suffix");
  await assert.rejects(videoToAtlas({
    inputVideo: conflictPath,
    outputSheet: conflictPath,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: fakeRunner([sourcePng]),
  }), /视频输入路径不得与输出路径冲突/u);
  await assert.rejects(readFile(limitedSheet), { code: "ENOENT" });
});

/** 证明 ffmpeg 非零退出被作为抽帧错误报告，且不留下输出文件。 */
test("报告 ffmpeg 执行失败", async (t) => {
  const directory = await testDirectory(t);
  const inputVideo = join(directory, "broken.mp4");
  const outputSheet = join(directory, "broken.png");
  await writeFile(inputVideo, "fake video bytes");
  // 将探测命令与抽帧命令分别模拟，验证 ffmpeg 失败不会生成报告或图集。
  const commandRunner = async (command) => command === "ffprobe-test"
    ? { exitCode: 0, stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 4, height: 2, avg_frame_rate: "24/1", duration: "1" }] }) }
    : { exitCode: 1, stderr: "decoder failed" };
  await assert.rejects(videoToAtlas({
    inputVideo,
    outputSheet,
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner,
  }), (error) => error instanceof VideoAtlasError && /ffmpeg 视频抽帧失败/u.test(error.message));
  await assert.rejects(readFile(outputSheet), { code: "ENOENT" });
});
