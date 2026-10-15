import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  FRAME_ANIMATION_REPORT_SCHEMA,
  FRAME_ANIMATION_WORKFLOW_SCHEMA,
  checkFrameAnimationWorkflowFiles,
  sha256Bytes,
  validateFrameAnimationWorkflowContract,
} from "./frame-animation-workflow-contract.mjs";

/** 计算最小 PNG chunk CRC，测试工件只需有可读取的合法图集头。 */
function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造指定 RGBA 尺寸的 PNG，避免测试依赖外部图像库。 */
function minimalPng(width, height) {
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBytes, data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 构造保留 SpriteFrame 左上裁切坐标并转换 UITransform 锚点的测试清单。 */
function creatorContract(animation, cell, frameCount, creatorResourcePath = "animations/hero") {
  const spriteFrames = Array.from({ length: frameCount }, (_, index) => {
    const imageRect = { x: index * cell.width, y: 0, width: cell.width, height: cell.height };
    return {
      index,
      name: `${animation.key}_${String(index).padStart(4, "0")}`,
      asset_type: "SpriteFrame",
      texture_asset_name: animation.texture_key,
      rect: imageRect,
      original_size: { width: cell.width, height: cell.height },
    };
  });
  return {
    schema: "cocos-creator-frame-atlas/2",
    creator: { name: "Cocos Creator", major_version: 3 },
    integration_kind: "descriptive_machine_manifest",
    creator_assets_materialized: false,
    texture: {
      asset_name: animation.texture_key,
      creator_resource_path: creatorResourcePath,
      width: cell.width * frameCount,
      height: cell.height,
      layout: "horizontal",
      frame_count: frameCount,
    },
    coordinate_conversion: {
      sprite_frame_rect_origin: "image-top-left",
      sprite_frame_rect_y_formula: "image_rect_y",
      image_anchor_origin: "top-left",
      creator_anchor_origin: "bottom-left",
      creator_anchor_y_formula: "1 - image_anchor_y / cell_height",
    },
    sprite_frames: spriteFrames,
    node_ui_transform: {
      component_type: "UITransform",
      content_size: { width: cell.width, height: cell.height },
      anchor_point_normalized_bottom_left: {
        x: cell.target_anchor.x / cell.width,
        y: 1 - cell.target_anchor.y / cell.height,
      },
      image_anchor_top_left_pixels: { ...cell.target_anchor },
    },
    animation_clip: {
      asset_type: "AnimationClip",
      name: animation.key,
      playback_component: "Animation",
      sample: animation.frame_rate,
      wrap_mode: animation.loop ? "Loop" : "Normal",
      duration_seconds: frameCount / animation.frame_rate,
      sprite_frame_sequence: spriteFrames.map(({ name }) => name),
    },
    mcp_asset_workflow: {
      protocol: "MCP",
      tool_discovery_method: "tools/list",
      asset_import_refresh_tool: "assetAdvanced_refresh_assets_and_wait",
      asset_info_tool: "project_get_asset_info",
      asset_uuid_tool: "project_query_asset_uuid",
      tool_result_policy: "inspect_each_subtool_and_require_success",
      sprite_frame_subasset_query: { required: true, discovery: "Use a currently listed MCP tool and its inputSchema", asset_type: "SpriteFrame", unavailable_action: "stop_and_report" },
      forbidden_manual_files: [".meta", ".scene", ".prefab"],
    },
  };
}

/** 构造完整视频抽帧合同；四帧用于确认帧数不再受旧三帧网格限制。 */
function buildFixtureFiles() {
  const fps = 12;
  const frameCount = 4;
  const sheet = minimalPng(16, 4);
  const video = Buffer.from("test video bytes");
  const prompt = Buffer.from("A small hero runs in place, side view, transparent background.\n");
  const preview = Buffer.from("<!doctype html><html><head><meta name=\"cocos-atlas-sha256\" content=\"" + sha256Bytes(sheet) + "\"><title>Preview</title></head><body>hero</body></html>\n");
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    index,
    source_timestamp: index / fps,
    source_sha256: sha256Bytes(Buffer.from("source-frame-" + index)),
  }));
  const cell = {
    width: 4,
    height: 4,
    source_anchor: { x: 2, y: 3 },
    content_rect: { x: 0, y: 0, width: 4, height: 4 },
    target_anchor: { x: 2, y: 3 },
    layout: "horizontal",
  };
  const animation = { key: "hero-run", texture_key: "hero-texture", frame_rate: fps, loop: true };
  const report = {
    schema: FRAME_ANIMATION_REPORT_SCHEMA,
    status: "PASS",
    input: {
      video_path: "input/hero.mp4",
      video_sha256: sha256Bytes(video),
      fps,
      remove_background: true,
      width: 4,
      height: 4,
      display_width: 4,
      display_height: 4,
      source_fps: 30,
      duration_seconds: 1,
    },
    cell,
    frames,
    animation,
    cc: creatorContract(animation, cell, frameCount),
    artifacts: {
      sheet: { file: "assets/resources/animations/hero.png", width: 16, height: 4, sha256: sha256Bytes(sheet) },
      preview: { file: "reports/hero-preview.html" },
      report: { file: "reports/hero-atlas.json" },
    },
  };
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  const files = new Map([
    ["evidence/hero-prompt.txt", prompt],
    ["input/hero.mp4", video],
    ["reports/hero-atlas.json", reportBytes],
    ["reports/hero-preview.html", preview],
    ["assets/resources/animations/hero.png", sheet],
  ]);
  const artifact = (file, bytes, extra = {}) => ({ file, sha256: sha256Bytes(bytes), ...extra });
  const contract = {
    schema: FRAME_ANIMATION_WORKFLOW_SCHEMA,
    status: "accepted",
    work_item_id: "work-item-video-atlas",
    candidate_version: "candidate-video-atlas",
    external_operation_authorized: false,
    settings: { fps, width: 4, height: 4, remove_background: true },
    video_prompt: artifact("evidence/hero-prompt.txt", prompt),
    source_video: artifact("input/hero.mp4", video),
    quality_report: artifact("reports/hero-atlas.json", reportBytes),
    preview: artifact("reports/hero-preview.html", preview),
    spritesheet: artifact("assets/resources/animations/hero.png", sheet, { creator_resource_path: "animations/hero" }),
  };
  const asset = {
    texture_key: "hero-texture",
    runtime_outputs: ["assets/resources/animations/hero.png"],
    frame_animation: contract,
  };
  return { files, asset, report, sheet, video };
}

/** 将夹具文件写入独立临时项目目录。 */
async function writeFixture() {
  const root = await mkdtemp(join(tmpdir(), "video-atlas-workflow-contract-"));
  const fixture = buildFixtureFiles();
  for (const [file, bytes] of fixture.files) {
    const target = join(root, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return { root, fixture };
}

/** 运行静态与文件门并返回错误文本。 */
async function runGate(root, asset) {
  return checkFrameAnimationWorkflowFiles(asset, {
    projectRoot: root,
    workItemId: "work-item-video-atlas",
    candidateVersion: "candidate-video-atlas",
  });
}

/** 在临时目录上执行单个用例，并确保测试工件被清理。 */
async function withFixture(callback) {
  const { root, fixture } = await writeFixture();
  try { await callback(root, fixture); }
  finally { await rm(root, { recursive: true, force: true }); }
}

/** 重写报告文件并更新 manifest 对应的 SHA。 */
async function writeReport(root, fixture) {
  const bytes = Buffer.from(JSON.stringify(fixture.report, null, 2) + "\n");
  await writeFile(join(root, fixture.asset.frame_animation.quality_report.file), bytes);
  fixture.asset.frame_animation.quality_report.sha256 = sha256Bytes(bytes);
}

/** 绑定共享视频中的固定动画区域，输出 cell 尺寸独立于源区域尺寸。 */
function bindFixtureRegion(fixture) {
  const region = { x: 80, y: 24, width: 160, height: 96 };
  fixture.asset.frame_animation.settings.region = { ...region };
  fixture.report.input.region = { ...region };
  fixture.report.input.display_width = 1366;
  fixture.report.input.display_height = 768;
  fixture.report.settings = { ...fixture.asset.frame_animation.settings, region: { ...region } };
  fixture.report.cell.source_anchor = { x: region.width / 2, y: region.height - 1 };
  fixture.report.cell.content_rect = { x: 0, y: 1, width: 4, height: 2 };
  const targetAnchor = { x: 2, y: 1 + (region.height - 1) * 2 / region.height };
  fixture.report.cell.target_anchor = targetAnchor;
  fixture.report.cc = creatorContract(fixture.report.animation, fixture.report.cell, fixture.report.frames.length);
}

/** 模拟源区域等比缩放后上下留白，根锚点须跟随实际内容矩形变换。 */
function bindFixtureAnchor(fixture) {
  bindFixtureRegion(fixture);
  const anchor = { x: 80, y: 48 };
  fixture.asset.frame_animation.settings.anchor = { ...anchor };
  fixture.report.input.anchor = { ...anchor };
  fixture.report.settings.anchor = { ...anchor };
  fixture.report.cell.source_anchor = { ...anchor };
  fixture.report.cell.content_rect = { x: 0, y: 1, width: 4, height: 2 };
  fixture.report.cell.target_anchor = { x: 2, y: 2 };
  fixture.report.cc = creatorContract(fixture.report.animation, fixture.report.cell, fixture.report.frames.length);
}

test("缺少视频抽帧合同或设置时静态合同失败", () => {
  assert(validateFrameAnimationWorkflowContract(undefined).some((message) => message.includes("必须是对象")));
  const { asset } = buildFixtureFiles();
  delete asset.frame_animation.settings;
  assert(validateFrameAnimationWorkflowContract(asset.frame_animation).some((message) => message.includes("settings")));
});

test("四帧视频抽帧报告通过静态合同和文件门", async () => {
  await withFixture(async (root, fixture) => {
    assert.deepEqual(validateFrameAnimationWorkflowContract(fixture.asset.frame_animation, {
      workItemId: "work-item-video-atlas",
      candidateVersion: "candidate-video-atlas",
    }), []);
    assert.deepEqual(await runGate(root, fixture.asset), []);
  });
});

test("质量报告必须声明 PASS", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.status = "FAIL";
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("quality_report.status 必须为 PASS")));
  });
});

test("预览文件必须可读且为 HTML，但摘要陈旧不阻断", async () => {
  await withFixture(async (root, fixture) => {
    await writeFile(join(root, fixture.asset.frame_animation.preview.file), "<html>changed</html>");
    fixture.asset.frame_animation.preview.sha256 = "sha256:stale";
    const errors = await runGate(root, fixture.asset);
    assert.deepEqual(errors, []);
  });
});

test("可读取的视频来源即使摘要不匹配也不会阻断", async () => {
  await withFixture(async (root, fixture) => {
    const replacement = Buffer.from("replacement video bytes");
    await writeFile(join(root, fixture.asset.frame_animation.source_video.file), replacement);
    fixture.asset.frame_animation.source_video.sha256 = "stale-video-digest";
    const errors = await runGate(root, fixture.asset);
    assert.deepEqual(errors, []);
  });
});

test("源视频摘要缺失或错误不阻断文件门", async () => {
  await withFixture(async (root, fixture) => {
    delete fixture.asset.frame_animation.source_video.sha256;
    const errors = await runGate(root, fixture.asset);
    assert.deepEqual(errors, []);
  });
});

test("实际抽帧 FPS 必须绑定 manifest 设置与 Creator AnimationClip", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.input.fps = 15;
    fixture.report.animation.frame_rate = 15;
    fixture.report.cc.animation_clip.sample = 15;
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("input.fps 必须等于 settings.fps")));

    fixture.report.input.fps = 12;
    fixture.report.animation.frame_rate = 10;
    fixture.report.cc.animation_clip.sample = 10;
    await writeReport(root, fixture);
    const mismatchedAnimationErrors = await runGate(root, fixture.asset);
    assert(mismatchedAnimationErrors.some((message) => message.includes("animation.frame_rate 必须等于 input.fps")));
  });
});

test("抽帧 cell 尺寸必须匹配设置且 PNG 尺寸必须匹配帧数", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.cell.width = 8;
    fixture.report.cc.texture.width = 32;
    await writeReport(root, fixture);
    const settingErrors = await runGate(root, fixture.asset);
    assert(settingErrors.some((message) => message.includes("cell.width 必须等于 settings.width")));

    const wrongSizeSheet = minimalPng(20, 4);
    await writeFile(join(root, fixture.asset.frame_animation.spritesheet.file), wrongSizeSheet);
    fixture.asset.frame_animation.spritesheet.sha256 = sha256Bytes(wrongSizeSheet);
    fixture.report.artifacts.sheet.width = 20;
    fixture.report.artifacts.sheet.sha256 = sha256Bytes(wrongSizeSheet);
    fixture.report.cell.width = 4;
    fixture.report.cc.texture.width = 16;
    await writeReport(root, fixture);
    const pngErrors = await runGate(root, fixture.asset);
    assert(pngErrors.some((message) => message.includes("spritesheet 宽度必须等于 cell.width 乘帧数")));
  });
});

test("是否移除背景必须是布尔值并与合同设置一致", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.input.remove_background = false;
    await writeReport(root, fixture);
    const mismatchErrors = await runGate(root, fixture.asset);
    assert(mismatchErrors.some((message) => message.includes("input.remove_background 必须等于 settings.remove_background")));

    fixture.report.input.remove_background = "true";
    await writeReport(root, fixture);
    const typeErrors = await runGate(root, fixture.asset);
    assert(typeErrors.some((message) => message.includes("input.remove_background 必须是布尔值")));
  });
});

test("质量报告中的图集 SHA 缺失或陈旧不阻断真实 PNG 结构验收", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.artifacts.sheet.sha256 = "stale";
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert.deepEqual(errors, []);
  });
});

test("Creator SpriteFrame 与 AnimationClip 必须覆盖完整图集", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.cc.animation_clip.sprite_frame_sequence.pop();
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes(".cc.animation_clip 必须用 AnimationClip")), errors.join("\n"));
  });
});

test("spritesheet creator_resource_path 必填且拒绝外部地址和路径逃逸", () => {
  for (const creatorResourcePath of [undefined, "", "../hero.png", "assets\\hero.png", "https://cdn.example/hero.png", "%252e%252e/hero.png"]) {
    const { asset } = buildFixtureFiles();
    if (creatorResourcePath === undefined) delete asset.frame_animation.spritesheet.creator_resource_path;
    else asset.frame_animation.spritesheet.creator_resource_path = creatorResourcePath;
    const errors = validateFrameAnimationWorkflowContract(asset.frame_animation);
    assert(errors.some((message) => message.includes("spritesheet.creator_resource_path 必须是相对 assets/resources 的无扩展 Cocos 资源名")));
  }
});

test("提示词 JSON 必须可解析且网页预览必须是 HTML", async () => {
  await withFixture(async (root, fixture) => {
    const promptFile = "evidence/hero-prompt.json";
    const promptBytes = Buffer.from("{invalid");
    await writeFile(join(root, fixture.asset.frame_animation.video_prompt.file), promptBytes);
    fixture.asset.frame_animation.video_prompt.file = promptFile;
    fixture.asset.frame_animation.video_prompt.sha256 = sha256Bytes(promptBytes);
    await mkdir(dirname(join(root, promptFile)), { recursive: true });
    await writeFile(join(root, promptFile), promptBytes);
    await writeFile(join(root, fixture.asset.frame_animation.preview.file), "not html");
    fixture.asset.frame_animation.preview.sha256 = sha256Bytes(Buffer.from("not html"));
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("video_prompt JSON 格式无效")));
    assert(errors.some((message) => message.includes("preview 必须包含 HTML 根元素")));
  });
});

test("解析成功但根节点不是对象的报告不能通过", async () => {
  await withFixture(async (root, fixture) => {
    const bytes = Buffer.from("null\n");
    await writeFile(join(root, fixture.asset.frame_animation.quality_report.file), bytes);
    fixture.asset.frame_animation.quality_report.sha256 = sha256Bytes(bytes);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("解析结果必须是普通 JSON 对象")));
  });
});

test("Creator 纹理 URL 必须严格等于 spritesheet creator_resource_path", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.cc.texture.creator_resource_path = "assets/other.png";
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("cc.texture.creator_resource_path") && message.includes("严格等于 spritesheet.creator_resource_path")));
  });
});

test("报告相对工件路径必须匹配 manifest，绝对路径作为诊断信息放行", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.artifacts.preview.file = "reports/other-preview.html";
    await writeReport(root, fixture);
    const relativePathErrors = await runGate(root, fixture.asset);
    assert(relativePathErrors.some((message) => message.includes("artifacts.preview.file 必须与 manifest 工件路径一致")));

    fixture.report.artifacts.sheet.file = "C:\\generated\\hero.png";
    fixture.report.artifacts.preview.file = "C:\\generated\\hero-preview.html";
    fixture.report.artifacts.report.file = "C:\\generated\\hero-report.json";
    await writeReport(root, fixture);
    assert.deepEqual(await runGate(root, fixture.asset), []);
  });
});

test("网页预览保留 HTML 检查但不要求图集 SHA meta", async () => {
  await withFixture(async (root, fixture) => {
    const badPreview = Buffer.from("<html><head><meta name=\"cocos-atlas-sha256\" content=\"sha256:" + "0".repeat(64) + "\"></head></html>");
    await writeFile(join(root, fixture.asset.frame_animation.preview.file), badPreview);
    fixture.asset.frame_animation.preview.sha256 = sha256Bytes(badPreview);
    const errors = await runGate(root, fixture.asset);
    assert.deepEqual(errors, []);
  });
});

/** 区域必须使用完整的安全整数像素，避免越界和隐式坐标修正。 */
test("静态合同拒绝缺项、负数、零尺寸和非整数区域", () => {
  const invalidRegions = [
    null,
    {},
    { x: 0, y: 0, width: 4 },
    { x: -1, y: 0, width: 4, height: 4 },
    { x: 0, y: 0.5, width: 4, height: 4 },
    { x: 0, y: 0, width: 0, height: 4 },
    { x: 0, y: 0, width: "4", height: 4 },
    { x: Number.MAX_SAFE_INTEGER + 1, y: 0, width: 4, height: 4 },
  ];
  for (const region of invalidRegions) {
    const { asset } = buildFixtureFiles();
    asset.frame_animation.settings.region = region;
    assert(validateFrameAnimationWorkflowContract(asset.frame_animation).some((message) => message.includes("settings.region")));
  }
});

/** 同一视频的裁剪区域可以远大于输出 cell，文件门核对各自职责。 */
test("区域坐标、源尺寸与独立输出尺寸一致时通过文件门", async () => {
  await withFixture(async (root, fixture) => {
    bindFixtureRegion(fixture);
    await writeReport(root, fixture);
    assert.deepEqual(await runGate(root, fixture.asset), []);
  });
});

/** 共享视频的 SHA 相同不足以区分动画，区域也必须与清单绑定一致。 */
test("文件门拒绝清单、输入报告与抽帧设置的区域不一致", async () => {
  for (const target of ["input", "settings"]) {
    await withFixture(async (root, fixture) => {
      bindFixtureRegion(fixture);
      fixture.report[target].region.x += 1;
      await writeReport(root, fixture);
      const errors = await runGate(root, fixture.asset);
      assert(errors.some((message) => message.includes(target + ".region") && message.includes("settings.region")));
    });
  }
});

/** 任一侧有裁剪时都要完整记录，防止遗漏区域后冒用另一动画的产物。 */
test("区域模式不能遗漏清单或报告的区域绑定", async () => {
  for (const target of ["manifest", "input", "settings"]) {
    await withFixture(async (root, fixture) => {
      bindFixtureRegion(fixture);
      if (target === "manifest") delete fixture.asset.frame_animation.settings.region;
      else delete fixture.report[target].region;
      await writeReport(root, fixture);
      const errors = await runGate(root, fixture.asset);
      assert(errors.some((message) => message.includes("region")));
    });
  }
});

/** 裁剪框以自动旋转后的显示画布为准，不能套用编码前宽高。 */
test("区域必须位于报告的真实显示画布内", async () => {
  for (const mutation of [
    (fixture) => { fixture.report.input.display_width = 200; },
    (fixture) => { fixture.report.input.display_height = 100; },
    (fixture) => { delete fixture.report.input.display_width; },
    (fixture) => { fixture.report.input.region.height = 0; },
  ]) {
    await withFixture(async (root, fixture) => {
      bindFixtureRegion(fixture);
      mutation(fixture);
      await writeReport(root, fixture);
      const errors = await runGate(root, fixture.asset);
      assert(errors.some((message) => message.includes("input.region") || message.includes("display_")));
    });
  }
});

/** 动画根可位于区域中心或半像素位置，但必须是有限且完整的局部坐标。 */
test("静态合同拒绝无效局部锚点", () => {
  for (const anchor of [null, {}, { x: -1, y: 0 }, { x: 1, y: Infinity }, { x: "1", y: 2 }]) {
    const { asset } = buildFixtureFiles();
    asset.frame_animation.settings.anchor = anchor;
    assert(validateFrameAnimationWorkflowContract(asset.frame_animation).some((message) => message.includes("settings.anchor")));
  }
});

/** 用坐标变换验收锚点，避免文件格式通过而 Cocos 绑定留白边缘。 */
test("文件门检查局部锚点与缩放留白的实际变换", async () => {
  await withFixture(async (root, fixture) => {
    bindFixtureAnchor(fixture);
    await writeReport(root, fixture);
    assert.deepEqual(await runGate(root, fixture.asset), []);
    fixture.report.cell.target_anchor.y = 4;
    fixture.report.cc = creatorContract(fixture.report.animation, fixture.report.cell, fixture.report.frames.length);
    await writeReport(root, fixture);
    assert((await runGate(root, fixture.asset)).some((message) => message.includes("target_anchor") && message.includes("变换")));
  });
});

/** 清单、报告和实际内容矩形均参与绑定，不能单独改声明隐藏锚点漂移。 */
test("局部锚点绑定不能缺失、越界或与缩放内容不一致", async () => {
  for (const mutation of [
    (fixture) => { fixture.report.input.anchor.x += 1; },
    (fixture) => { delete fixture.report.settings.anchor; },
    (fixture) => { delete fixture.asset.frame_animation.settings.anchor; },
    (fixture) => { fixture.report.cell.source_anchor.y = 100; },
    (fixture) => { fixture.report.cell.content_rect.height = 5; },
    (fixture) => { delete fixture.report.cell.source_anchor; },
  ]) {
    await withFixture(async (root, fixture) => {
      bindFixtureAnchor(fixture);
      mutation(fixture);
      await writeReport(root, fixture);
      assert((await runGate(root, fixture.asset)).some((message) => message.includes("anchor") || message.includes("content_rect")));
    });
  }
});

/** 每份报告都须记录缩放布局，不能删掉字段绕过默认根点的变换校验。 */
test("整画布和区域报告均不能省略源锚点及内容矩形", async () => {
  for (const useRegion of [false, true]) {
    await withFixture(async (root, fixture) => {
      if (useRegion) bindFixtureRegion(fixture);
      delete fixture.report.cell.source_anchor;
      delete fixture.report.cell.content_rect;
      await writeReport(root, fixture);
      const errors = await runGate(root, fixture.asset);
      assert(errors.some((message) => message.includes("source_anchor")));
      assert(errors.some((message) => message.includes("content_rect")));
    });
  }
});

/** 未声明自定义根点时，即使目标点和 Cocos origin 自洽也不能替换默认根点。 */
test("默认源锚点必须绑定区域或整画布的底部中心", async () => {
  for (const useRegion of [false, true]) {
    await withFixture(async (root, fixture) => {
      if (useRegion) bindFixtureRegion(fixture);
      fixture.report.cell.source_anchor.y = 0;
      const target = fixture.report.cell.target_anchor;
      target.y = fixture.report.cell.content_rect.y;
      fixture.report.cc = creatorContract(fixture.report.animation, fixture.report.cell, fixture.report.frames.length);
      await writeReport(root, fixture);
      assert((await runGate(root, fixture.asset)).some((message) => message.includes("source_anchor") && message.includes("默认")));
    });
  }
});

test("SpriteFrame.rect 保留图像左上坐标，UITransform 锚点才转换到左下原点", async () => {
  await withFixture(async (root, fixture) => {
    assert.deepEqual(await runGate(root, fixture.asset), []);
    fixture.report.cc.sprite_frames[0].rect.y = 1;
    fixture.report.cc.node_ui_transform.anchor_point_normalized_bottom_left.y = 0.75;
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("像素矩形和 SpriteFrame")));
    assert(errors.some((message) => message.includes("左上像素到左下归一化锚点")));
  });
});

test("Creator 纹理导入与 SpriteFrame 子资源查询必须走 MCP", async () => {
  await withFixture(async (root, fixture) => {
    assert.deepEqual(await runGate(root, fixture.asset), []);
    fixture.report.cc.mcp_asset_workflow.sprite_frame_subasset_query.required = false;
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("cc.mcp_asset_workflow") && message.includes("禁止手写 .meta/.scene/.prefab")));
  });
});

/** 批量响应只用于调度，逐项成功状态才构成真实资产操作证据。 */
test("MCP 批量调用必须逐项确认子工具成功", async () => {
  await withFixture(async (root, fixture) => {
    fixture.report.cc.mcp_asset_workflow.tool_result_policy = "trust_batch_success";
    await writeReport(root, fixture);
    const errors = await runGate(root, fixture.asset);
    assert(errors.some((message) => message.includes("cc.mcp_asset_workflow")));
  });
});
