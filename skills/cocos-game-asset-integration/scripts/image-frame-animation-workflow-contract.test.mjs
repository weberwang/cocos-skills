import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { GLOBAL_VISUAL_BASELINE_DOCUMENT } from "../../cocos-game-workflow-control/scripts/global-visual-consistency-contract.mjs";
import {
  IMAGE_FRAME_ANIMATION_REPORT_SCHEMA,
  IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA,
  checkImageFrameAnimationWorkflowFiles,
  validateImageFrameAnimationWorkflowContract,
} from "./image-frame-animation-workflow-contract.mjs";
import {
  checkFrameAnimationWorkflowFiles,
  sha256Bytes,
  validateFrameAnimationWorkflowContract,
} from "./frame-animation-workflow-contract.mjs";
import { checkManifestFiles, validateManifest } from "./validate_visual_manifest.mjs";
import { imagesToAtlas } from "../../cocos-frame-animation/scripts/images-to-atlas.mjs";

const FINGERPRINT = sha256Bytes(Buffer.from("fixture"));
const WORK_ITEM = "work-item-image-atlas";
const CANDIDATE = "candidate-image-atlas";

/** 创建完全本地的 PNG 夹具，测试无需生成服务或真实美术素材。 */
async function createPng(width, height, rgba = [220, 60, 40, 255]) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 },
    },
  }).png().toBuffer();
}

/** 生成真实 JPEG 来源，覆盖图片解码与图集重编码的非 PNG 输入路线。 */
async function createJpeg(width, height, rgba = [220, 60, 40, 255]) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: rgba[0], g: rgba[1], b: rgba[2] },
    },
  }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** 构造保留 SpriteFrame 左上裁切坐标并转换 UITransform 锚点的图片测试清单。 */
function creatorContract(animation, cell, frameCount, creatorResourcePath) {
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
  const texture = {
    asset_name: animation.texture_key,
    width: cell.width * frameCount,
    height: cell.height,
    layout: "horizontal",
    frame_count: frameCount,
  };
  // 静态图集由普通项目资源引用，不伪造 resources.load 标识。
  if (creatorResourcePath !== undefined) texture.creator_resource_path = creatorResourcePath;
  return {
    schema: "cocos-creator-frame-atlas/2",
    creator: { name: "Cocos Creator", major_version: 3 },
    integration_kind: "descriptive_machine_manifest",
    creator_assets_materialized: false,
    texture,
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

/** 把本地合成文件写入临时项目，并返回来源清单使用的真实身份。 */
async function writeFixtureFile(root, file, bytes) {
  const absolutePath = join(root, file);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return { file, sha256: sha256Bytes(bytes) };
}

/** 生成默认静态图集合同；dynamicResources=true 才切换到 resources 动态加载目录。 */
async function createFixtureRoot({ sourceWidth = 4, sourceHeight = 4, cellWidth = 4, cellHeight = 4, sourceFormat = "png", useActualPacker = false, dynamicResources = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "image-atlas-workflow-contract-"));
  const extension = sourceFormat === "jpeg" ? "jpg" : "png";
  const createSourceImage = sourceFormat === "jpeg" ? createJpeg : createPng;
  const frameZero = await writeFixtureFile(root, `art/frame-0.${extension}`, await createSourceImage(sourceWidth, sourceHeight));
  const frameOneRaw = await writeFixtureFile(root, `art/frame-1-raw.${extension}`, await createSourceImage(
    Math.max(1, Math.floor(sourceWidth / 2)), Math.max(1, Math.floor(sourceHeight / 2)), [40, 120, 220, 255],
  ));
  const frameOneFinal = await writeFixtureFile(root, `art/frame-1.${extension}`, await createSourceImage(sourceWidth, sourceHeight, [40, 120, 220, 255]));
  const closure = await writeFixtureFile(root, `art/loop-closure.${extension}`, await createSourceImage(sourceWidth, sourceHeight));

  const writeGenerationRecord = async (index, outputImage, parents) => {
    const value = {
      prompt: `本地测试生成第 ${index} 帧`,
      reference_images: parents.map(({ file, sha256 }) => ({ file, sha256 })),
      output_image: outputImage,
    };
    return writeFixtureFile(root, `records/frame-${index}.json`, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
  };
  const parents = [
    [],
    [{ index: 0, ...frameZero }, { index: 2, ...closure }],
    [{ index: 0, ...frameZero }],
  ];
  const outputImages = [frameZero, frameOneRaw, closure];
  const finalImages = [frameZero, frameOneFinal, closure];
  const repairRecord = await writeFixtureFile(root, "records/frame-1-repair.txt", Buffer.from(
    `问题：原图尺寸与固定画布不同。\n方法：按固定画布规范化并保留完整范围。\n前图：${frameOneRaw.file} ${frameOneRaw.sha256}\n后图：${frameOneFinal.file} ${frameOneFinal.sha256}\n`,
    "utf8",
  ));
  const sourceFrames = [];
  for (let index = 0; index <= 2; index += 1) {
    const generationRecord = await writeGenerationRecord(index, outputImages[index], parents[index]);
    const frame = {
      index,
      game_time_ms: index * 500,
      kind: index === 1 ? "inbetween" : "endpoint",
      parents: parents[index],
      source_image: outputImages[index],
      image: finalImages[index],
      generation_record: generationRecord,
    };
    if (index === 1) frame.repairs = [{ before: frameOneRaw, after: frameOneFinal, record: repairRecord }];
    sourceFrames.push(frame);
  }
  const source = {
    schema: "cocos-image-frame-source/1",
    canvas: { width: sourceWidth, height: sourceHeight },
    duration_ms: 1000,
    fps: 2,
    loop: true,
    // 乱序来源是合法输入；消费者必须按 index 投影为播放序列。
    frames: [sourceFrames[2], sourceFrames[1], sourceFrames[0]],
  };
  const sourceManifestFile = "evidence/image-source.json";
  const sourceManifestBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, "utf8");
  await mkdir(dirname(join(root, sourceManifestFile)), { recursive: true });
  await writeFile(join(root, sourceManifestFile), sourceManifestBytes);

  const sheetFile = dynamicResources ? "assets/resources/animations/image-atlas.png" : "assets/animations/image-atlas.png";
  const creatorResourcePath = dynamicResources ? "animations/image-atlas" : undefined;
  const previewFile = "reports/image-preview.html";
  const reportFile = "reports/image-atlas.json";
  let sheetBytes;
  let previewBytes;
  if (!useActualPacker) {
    sheetBytes = await createPng(cellWidth * 2, cellHeight, [0, 0, 0, 0]);
    await mkdir(dirname(join(root, sheetFile)), { recursive: true });
    await writeFile(join(root, sheetFile), sheetBytes);
    previewBytes = Buffer.from(
      `<!doctype html><html><head><meta name="cocos-atlas-sha256" content="${sha256Bytes(sheetBytes)}"></head><body>local preview</body></html>\n`,
      "utf8",
    );
    await mkdir(dirname(join(root, previewFile)), { recursive: true });
    await writeFile(join(root, previewFile), previewBytes);
  }

  const scale = Math.min(cellWidth / sourceWidth, cellHeight / sourceHeight);
  const contentWidth = Math.round(sourceWidth * scale);
  const contentHeight = Math.round(sourceHeight * scale);
  const contentRect = {
    x: Math.floor((cellWidth - contentWidth) / 2),
    y: Math.floor((cellHeight - contentHeight) / 2),
    width: contentWidth,
    height: contentHeight,
  };
  const settings = {
    fps: 2,
    width: cellWidth,
    height: cellHeight,
    remove_background: false,
    region: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    anchor: { x: sourceWidth / 2, y: sourceHeight - 1 },
  };
  const targetAnchor = {
    x: contentRect.x + settings.anchor.x * contentRect.width / sourceWidth,
    y: contentRect.y + settings.anchor.y * contentRect.height / sourceHeight,
  };
  const actualReport = useActualPacker ? await imagesToAtlas({
    sourceManifest: join(root, sourceManifestFile),
    projectRoot: root,
    outputSheet: join(root, sheetFile),
    outputReport: join(root, reportFile),
    outputPreview: join(root, previewFile),
    width: cellWidth,
    height: cellHeight,
    removeBackground: false,
    region: settings.region,
    anchor: settings.anchor,
    animationKey: "hero-loop",
    textureKey: "hero-loop-texture",
    ...(creatorResourcePath === undefined ? {} : { creatorResourcePath }),
  }) : null;
  if (actualReport) {
    sheetBytes = await readFile(join(root, sheetFile));
    previewBytes = await readFile(join(root, previewFile));
  }
  const artifact = (file, bytes, extra = {}) => ({ file, sha256: sha256Bytes(bytes), ...extra });
  const animation = { key: "hero-loop", texture_key: "hero-loop-texture", frame_rate: 2, loop: true };
  const cc = creatorContract(animation, { width: cellWidth, height: cellHeight, target_anchor: targetAnchor }, 2, creatorResourcePath);
  const contract = {
    schema: IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA,
    status: "accepted",
    work_item_id: WORK_ITEM,
    candidate_version: CANDIDATE,
    settings,
    source_manifest: artifact(sourceManifestFile, sourceManifestBytes),
    quality_report: null,
    preview: artifact(previewFile, previewBytes),
    spritesheet: artifact(sheetFile, sheetBytes, creatorResourcePath === undefined ? {} : { creator_resource_path: creatorResourcePath }),
  };
  const asset = {
    id: "hero-loop",
    texture_key: "hero-loop-texture",
    scene_id: "test-scene",
    route: "frame-animation",
    status: "accepted",
    source_files: [sourceManifestFile],
    license_record: "licenses/image.txt",
    cocos_evidence: "evidence/cocos.txt",
    gameplay_visual_evidence: "evidence/gameplay.txt",
    runtime_outputs: [sheetFile],
    consistency_evidence: ["evidence/consistency.txt"],
    visual_baseline_id: "test-baseline",
    visual_baseline_version: "1.0.0",
    style_fingerprint: FINGERPRINT,
    frame_animation: contract,
  };
  const report = actualReport ?? {
    schema: IMAGE_FRAME_ANIMATION_REPORT_SCHEMA,
    status: "PASS",
    tool: { name: "images-to-atlas", version: "test" },
    input: {
      source_manifest_path: join(root, sourceManifestFile),
      source_manifest_sha256: contract.source_manifest.sha256,
      display_width: sourceWidth,
      display_height: sourceHeight,
      fps: 2,
      remove_background: false,
      region: { ...settings.region },
      anchor: { ...settings.anchor },
    },
    settings: structuredClone(settings),
    cell: {
      width: cellWidth,
      height: cellHeight,
      source_anchor: { ...settings.anchor },
      content_rect: contentRect,
      target_anchor: targetAnchor,
      layout: "horizontal",
      frame_count: 2,
    },
    // 报告 frame 尺寸按最终 cell 记录，原图尺寸由来源 canvas 独立校验。
    frames: [0, 1].map((index) => {
      const frame = sourceFrames[index];
      return {
        index,
        game_time_ms: frame.game_time_ms,
        source_image: structuredClone(frame.source_image),
        image: structuredClone(frame.image),
        generation_record: structuredClone(frame.generation_record),
        parents: structuredClone(frame.parents),
        width: cellWidth,
        height: cellHeight,
      };
    }),
    animation,
    cc,
    artifacts: {
      sheet: { file: join(root, sheetFile), width: cellWidth * 2, height: cellHeight, sha256: sha256Bytes(sheetBytes) },
      preview: { file: join(root, previewFile) },
      report: { file: join(root, "reports/image-atlas.json") },
    },
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(join(root, reportFile)), { recursive: true });
  await writeFile(join(root, reportFile), reportBytes);
  contract.quality_report = artifact(reportFile, reportBytes);

  for (const file of [asset.license_record, asset.cocos_evidence, asset.gameplay_visual_evidence, ...asset.consistency_evidence]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), "local evidence\n", "utf8");
  }
  const anchorBytes = await createPng(1, 1);
  const baselineBytes = Buffer.from("local baseline fixture\n", "utf8");
  const styleFingerprint = sha256Bytes(baselineBytes);
  asset.style_fingerprint = styleFingerprint;
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "evidence/anchor.png"), anchorBytes);
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs/visual-baseline.md"), baselineBytes);
  const manifest = {
    schema_version: "1.5",
    visual_validation: { mode: "exact" },
    visual_contract_version: "1.0.0",
    workItemId: WORK_ITEM,
    candidateVersion: CANDIDATE,
    effect_image_reconstruction: { applicability: "not-applicable", lifecycle: "not-applicable" },
    visual_baseline: {
      id: "test-baseline",
      version: "1.0.0",
      style_fingerprint: styleFingerprint,
      document: GLOBAL_VISUAL_BASELINE_DOCUMENT,
      status: "global-static-baseline-frozen",
      anchor_evidence: [{ path: "evidence/anchor.png", sha256: sha256Bytes(anchorBytes) }],
    },
    budgets: {
      max_texture_size: 1024,
      texture_memory_mb: 64,
      max_atlases: 8,
      max_frames: 64,
      animation_sample_fps: 24,
      max_overdraw: 3,
      max_draw_calls: 100,
    },
    assets: [asset],
  };
  return { root, source, sourceFrames, sourceManifestFile, report, contract, asset, manifest, reportFile };
}

/** 重写质量报告及合同 SHA，让测试只触发所改报告字段的绑定规则。 */
async function rewriteReport(fixture) {
  const bytes = Buffer.from(`${JSON.stringify(fixture.report, null, 2)}\n`, "utf8");
  await writeFile(join(fixture.root, fixture.reportFile), bytes);
  fixture.contract.quality_report.sha256 = sha256Bytes(bytes);
}

/** 重写来源清单并同步报告与 accepted SHA，验证底层来源语义仍会复核。 */
async function rewriteSource(fixture) {
  const bytes = Buffer.from(`${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");
  await writeFile(join(fixture.root, fixture.sourceManifestFile), bytes);
  fixture.contract.source_manifest.sha256 = sha256Bytes(bytes);
  fixture.report.input.source_manifest_sha256 = fixture.contract.source_manifest.sha256;
  await rewriteReport(fixture);
}

/** 在临时项目内运行图片合同文件门，并在结束时删除合成工件。 */
async function withFixture(callback, options) {
  const fixture = await createFixtureRoot(options);
  try { await callback(fixture); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
}

/** 构造用于静态入口测试的图片合同，不生成或读取本地资源。 */
function imageContract() {
  const artifact = (file, extra = {}) => ({ file, sha256: FINGERPRINT, ...extra });
  return {
    schema: IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA,
    status: "accepted",
    work_item_id: WORK_ITEM,
    candidate_version: CANDIDATE,
    settings: { fps: 2, width: 8, height: 8, remove_background: false },
    source_manifest: artifact("evidence/source.json"),
    quality_report: artifact("reports/image-atlas.json"),
    preview: artifact("reports/image-preview.html"),
    spritesheet: artifact("assets/animations/image-atlas.png"),
  };
}

test("图片 accepted schema 按固定接口通过现有静态合同入口", () => {
  const contract = imageContract();
  assert.deepEqual(validateFrameAnimationWorkflowContract(contract, {
    workItemId: WORK_ITEM,
    candidateVersion: CANDIDATE,
  }), []);
});

test("图片 accepted 合同拒绝错误候选、缺失工件和伪造视频字段", () => {
  const wrongCandidate = imageContract();
  wrongCandidate.candidate_version = "stale-candidate";
  assert(validateImageFrameAnimationWorkflowContract(wrongCandidate, { candidateVersion: CANDIDATE }).some((item) => item.includes("candidateVersion")));

  const missing = imageContract();
  delete missing.source_manifest;
  assert(validateImageFrameAnimationWorkflowContract(missing).some((item) => item.includes("source_manifest")));

  const mixed = imageContract();
  mixed.source_video = { file: "input/fake.mp4", sha256: FINGERPRINT };
  assert(validateImageFrameAnimationWorkflowContract(mixed).some((item) => item.includes("不得包含视频字段")));
});

test("图片图集默认使用普通资产目录，resources 加载必须同时绑定文件与报告键", async () => {
  const ordinary = imageContract();
  assert.deepEqual(validateImageFrameAnimationWorkflowContract(ordinary), []);

  const undeclaredResources = imageContract();
  undeclaredResources.spritesheet.file = "assets/resources/animations/image-atlas.png";
  assert(validateImageFrameAnimationWorkflowContract(undeclaredResources).some((item) => item.includes("只有显式动态加载的资源才可放入 assets/resources")));

  const misplacedKey = imageContract();
  misplacedKey.spritesheet.creator_resource_path = "animations/image-atlas";
  assert(validateImageFrameAnimationWorkflowContract(misplacedKey).some((item) => item.includes("仅用于 resources 动态加载")));

  await withFixture(async (fixture) => {
    assert.deepEqual(await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root }), []);
  }, { dynamicResources: true });
});

test("图片报告不能单方面声明 resources 加载键", async () => {
  await withFixture(async (fixture) => {
    fixture.report.cc.texture.creator_resource_path = "animations/image-atlas";
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("必须同时声明或同时省略")));
  });
});

test("图片 accepted 工作流真实通过合同、validateManifest 与 checkManifestFiles 入口", async () => {
  await withFixture(async (fixture) => {
    assert.deepEqual(validateImageFrameAnimationWorkflowContract(fixture.contract, {
      workItemId: WORK_ITEM,
      candidateVersion: CANDIDATE,
    }), []);
    assert.deepEqual(await checkImageFrameAnimationWorkflowFiles(fixture.asset, {
      projectRoot: fixture.root,
      workItemId: WORK_ITEM,
      candidateVersion: CANDIDATE,
    }), []);
    assert.deepEqual(validateManifest(fixture.manifest), []);
    assert.deepEqual(await checkManifestFiles(fixture.manifest, fixture.root), []);
  });
});

test("24x16 来源缩放到 12x12 cell 时，frame 尺寸保持输出尺寸并校验真实留白锚点", async () => {
  await withFixture(async (fixture) => {
    assert.deepEqual(await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root }), []);
    assert.deepEqual(fixture.report.cell.content_rect, { x: 0, y: 2, width: 12, height: 8 });
    assert.deepEqual(fixture.report.cell.target_anchor, { x: 6, y: 9.5 });
    assert.deepEqual(fixture.report.frames.map(({ width, height }) => [width, height]), [[12, 12], [12, 12]]);
  }, { sourceWidth: 24, sourceHeight: 16, cellWidth: 12, cellHeight: 12 });
});

test("真实 imagesToAtlas 的 JPEG 来源输出可进入 accepted 文件门", async () => {
  await withFixture(async (fixture) => {
    const finalImage = await readFile(join(fixture.root, fixture.sourceFrames[0].image.file));
    assert.equal((await sharp(finalImage).metadata()).format, "jpeg");
    assert.equal(fixture.report.schema, IMAGE_FRAME_ANIMATION_REPORT_SCHEMA);
    assert.deepEqual(await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root }), []);
    assert.deepEqual(validateManifest(fixture.manifest), []);
    assert.deepEqual(await checkManifestFiles(fixture.manifest, fixture.root), []);
  }, { sourceWidth: 24, sourceHeight: 16, cellWidth: 12, cellHeight: 12, sourceFormat: "jpeg", useActualPacker: true });
});

test("图片合同的报告工件经 junction 指向项目外时文件门拒绝读取", async () => {
  await withFixture(async (fixture) => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "image-atlas-outside-"));
    try {
      const outsideReport = join(outsideRoot, "image-atlas.json");
      const junctionPath = join(fixture.root, "reports/foreign");
      await symlink(outsideRoot, junctionPath, "junction");
      fixture.contract.quality_report.file = "reports/foreign/image-atlas.json";
      fixture.report.artifacts.report.file = outsideReport;
      const bytes = Buffer.from(`${JSON.stringify(fixture.report, null, 2)}\n`, "utf8");
      await writeFile(outsideReport, bytes);
      fixture.contract.quality_report.sha256 = sha256Bytes(bytes);
      const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, {
        projectRoot: fixture.root,
        resolvePath: (file) => join(fixture.root, file),
      });
      assert(errors.some((item) => item.includes("逃逸") || item.includes("项目根目录")));
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

test("真实循环闭合帧不进入播放图集，Cocos 只覆盖来源的普通槽位", async () => {
  await withFixture(async (fixture) => {
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert.deepEqual(errors, []);
    assert.equal(fixture.report.frames.length, 2);
    assert.equal(fixture.source.frames.find(({ index }) => index === 2).game_time_ms, 1000);
    assert.equal(fixture.report.cc.animation_clip.sprite_frame_sequence.length, 2);
  });
});

test("替换来源图像或生成记录后不以摘要复算阻断", async () => {
  await withFixture(async (fixture) => {
    await writeFile(join(fixture.root, "art/frame-0.png"), await createPng(4, 4, [1, 2, 3, 255]));
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert.deepEqual(errors, []);
  });

  await withFixture(async (fixture) => {
    const recordPath = join(fixture.root, "records/frame-1.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    record.prompt = "被篡改的生成记录";
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert.deepEqual(errors, []);
  });
});

test("源父图与修图链身份被重新声明后，来源合同仍拒绝错误证据", async () => {
  await withFixture(async (fixture) => {
    const frame = fixture.source.frames.find(({ index }) => index === 1);
    frame.parents[0] = { index: 0, file: "art/frame-1.png", sha256: frame.image.sha256 };
    await rewriteSource(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("父图") || item.includes("reference") || item.includes("parent")));
  });

  await withFixture(async (fixture) => {
    const frame = fixture.source.frames.find(({ index }) => index === 1);
    frame.repairs[0].before = { ...frame.repairs[0].before, file: "art/not-the-source.png" };
    await rewriteSource(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("修图") || item.includes("repair") || item.includes("不存在") || item.includes("before") || item.includes("未连接")), errors.join("\n"));
  });
});

test("报告游戏时间仍与真实来源绑定且来源清单摘要不构成验收门", async () => {
  await withFixture(async (fixture) => {
    fixture.report.frames[1].game_time_ms += 1;
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("game_time_ms")));
  });

  await withFixture(async (fixture) => {
    fixture.report.frames[0].game_time_ms = -1e-7;
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("game_time_ms")));
  });

  await withFixture(async (fixture) => {
    fixture.report.input.source_manifest_sha256 = "stale-source-summary";
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert.deepEqual(errors, []);
  });
});

test("FPS、loop、region 和 anchor 必须与真实来源及 accepted 设置一致", async () => {
  await withFixture(async (fixture) => {
    fixture.report.input.fps = 3;
    fixture.report.animation.frame_rate = 3;
    fixture.report.cc.animation_clip.sample = 3;
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("input.fps")));
  });

  await withFixture(async (fixture) => {
    fixture.report.animation.loop = false;
    fixture.report.cc.animation_clip.wrap_mode = "Normal";
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("animation.loop")));
  });

  await withFixture(async (fixture) => {
    fixture.report.settings.region.x = 1;
    fixture.report.input.region.x = 1;
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("region")));
  });

  await withFixture(async (fixture) => {
    fixture.report.cell.target_anchor.x = 1;
    await rewriteReport(fixture);
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes("anchor")));
  });
});

test("报告仍检查实际结构和路径，图集与预览不按文件摘要拒绝", async () => {
  await withFixture(async (fixture) => {
    await writeFile(join(fixture.root, fixture.reportFile), "{}\n", "utf8");
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert(errors.some((item) => item.includes(".schema") || item.includes(".status") || item.includes(".frames")));
  });

  await withFixture(async (fixture) => {
    await writeFile(join(fixture.root, fixture.contract.spritesheet.file), await createPng(8, 4, [1, 2, 3, 255]));
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert.deepEqual(errors, [], "尺寸有效的新图集不因外部摘要陈旧而失败");
  });

  await withFixture(async (fixture) => {
    await writeFile(join(fixture.root, fixture.contract.preview.file), "<html>changed preview</html>\n", "utf8");
    const errors = await checkImageFrameAnimationWorkflowFiles(fixture.asset, { projectRoot: fixture.root });
    assert.deepEqual(errors, [], "仍为 HTML 的预览文件不因摘要陈旧而失败");
  });

  for (const creatorResourcePath of ["../atlas", "https://example.invalid/atlas", "assets\\atlas"]) {
    const contract = imageContract();
    contract.spritesheet.creator_resource_path = creatorResourcePath;
    assert(validateFrameAnimationWorkflowContract(contract).some((item) => item.includes("creator_resource_path")));
  }
});

test("现有全局 accepted 文件门按图片 schema 路由且不要求视频字段", async () => {
  await withFixture(async (fixture) => {
    assert.deepEqual(await checkFrameAnimationWorkflowFiles(fixture.asset, {
      projectRoot: fixture.root,
      workItemId: WORK_ITEM,
      candidateVersion: CANDIDATE,
    }), []);
    assert.equal(Object.hasOwn(fixture.contract, "source_video"), false);
    assert.equal(Object.hasOwn(fixture.contract, "video_prompt"), false);
  });
});
