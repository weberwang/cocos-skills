#!/usr/bin/env node
/** 从已校验的图片来源清单生成 Cocos 水平图集、报告和人工预览。 */
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  VideoAtlasError,
  composeHorizontalAtlas,
  createCocosAtlasContract,
  isObject,
  normalizeCommonAtlasOptions,
  nonEmptyString,
  preflightAtlasOutputs,
  processAtlasFrame,
  relativeUrl,
  renderAtlasPreview,
  requireStableContentRect,
  samePath,
  sha256Bytes,
  writeAtlasOutputs,
} from "./frame-atlas-core.mjs";
import { readImageFrameSource } from "./image-frame-source.mjs";

/** Creator 接入清单替换旧假代码后的新图片图集报告 schema。 */
export const IMAGE_ATLAS_SCHEMA = "cocos-image-atlas/2";

/** 按项目根目录解析相对输出，并校验图集、报告与预览的后缀和路径。 */
function normalizeImageAtlasPaths(input, projectRoot) {
  const root = resolve(projectRoot);
  /** 相对输出绑定素材所属项目，避免调用方工作目录改变产物位置。 */
  const resolveProjectPath = (path) => resolve(root, path);
  const sheetValue = input.outputSheet ?? input.output_sheet ?? input["output-sheet"];
  if (!nonEmptyString(sheetValue)) throw new VideoAtlasError("必须提供 output-sheet");
  const outputSheet = resolveProjectPath(sheetValue);
  const outputReportValue = input.outputReport ?? input.output_report ?? input["output-report"] ?? `${outputSheet.replace(/\.png$/iu, "")}.json`;
  const outputPreviewValue = input.outputPreview ?? input.output_preview ?? input["output-preview"] ?? `${outputSheet.replace(/\.png$/iu, "")}.html`;
  if (!nonEmptyString(outputReportValue) || !nonEmptyString(outputPreviewValue)) throw new VideoAtlasError("output-report 和 output-preview 必须是非空路径");
  const outputReport = resolveProjectPath(outputReportValue);
  const outputPreview = resolveProjectPath(outputPreviewValue);
  if (extname(outputSheet).toLowerCase() !== ".png") throw new VideoAtlasError("output-sheet 必须使用 .png 后缀");
  if (extname(outputReport).toLowerCase() !== ".json") throw new VideoAtlasError("output-report 必须使用 .json 后缀");
  if (extname(outputPreview).toLowerCase() !== ".html" && extname(outputPreview).toLowerCase() !== ".htm") throw new VideoAtlasError("output-preview 必须使用 .html 或 .htm 后缀");

  const outputs = [outputSheet, outputReport, outputPreview];
  for (let index = 0; index < outputs.length; index += 1) {
    for (let other = index + 1; other < outputs.length; other += 1) {
      if (samePath(outputs[index], outputs[other])) throw new VideoAtlasError("output-sheet、output-report 和 output-preview 必须使用不同路径");
    }
  }
  return { outputSheet, outputReport, outputPreview };
}

/** 将固定透明 cell 合并为水平图集并输出图片路线专属报告和预览。 */
export async function imagesToAtlas(input = {}) {
  if (!isObject(input)) throw new VideoAtlasError("图片图集配置必须是对象");
  const sourceManifest = input.sourceManifest ?? input.source_manifest ?? input["source-manifest"];
  const projectRoot = input.projectRoot ?? input.project_root ?? input["project-root"];
  if (!nonEmptyString(sourceManifest)) throw new VideoAtlasError("必须提供 source-manifest");
  if (!nonEmptyString(projectRoot)) throw new VideoAtlasError("必须提供 project-root");
  const paths = normalizeImageAtlasPaths(input, projectRoot);

  // readImageFrameSource 已复算来源身份；后续仅使用它返回的已校验字节 Map。
  const loaded = await readImageFrameSource(sourceManifest, { projectRoot });
  const source = loaded.source;
  const frameCount = Math.round(source.duration_ms * source.fps / 1000);
  if (!Number.isSafeInteger(frameCount) || frameCount < 2) throw new VideoAtlasError("来源时间轴必须至少包含两个播放帧");
  const sourceFrames = source.frames
    .filter((frame) => frame.index < frameCount)
    .sort((first, second) => first.index - second.index);
  if (sourceFrames.length !== frameCount || sourceFrames.some((frame, index) => frame.index !== index)) {
    throw new VideoAtlasError("来源帧必须完整覆盖播放槽位 0..N-1");
  }

  const sourceFiles = new Set([loaded.manifestPath]);
  for (const file of loaded.files.values()) sourceFiles.add(file.absolutePath);
  await preflightAtlasOutputs(
    [paths.outputSheet, paths.outputReport, paths.outputPreview],
    [...sourceFiles],
    "图片来源文件",
  );

  // 时间轴永远服从来源清单；即使调用方带入多余的 fps/loop，也不会改变动画定义。
  const sharedOptions = normalizeCommonAtlasOptions({ ...input, fps: source.fps, loop: source.loop }, {
    outputSheet: paths.outputSheet,
    defaultFps: source.fps,
    defaultLoop: source.loop,
  });
  const sourceWidth = source.canvas.width;
  const sourceHeight = source.canvas.height;
  if (sharedOptions.region && (
    sharedOptions.region.x + sharedOptions.region.width > sourceWidth
    || sharedOptions.region.y + sharedOptions.region.height > sourceHeight
  )) {
    throw new VideoAtlasError(`region (${sharedOptions.region.x},${sharedOptions.region.y},${sharedOptions.region.width},${sharedOptions.region.height}) 超出来源画布 ${sourceWidth}x${sourceHeight}`);
  }
  const regionWidth = sharedOptions.region?.width ?? sourceWidth;
  const regionHeight = sharedOptions.region?.height ?? sourceHeight;
  const sourceAnchor = sharedOptions.anchor ?? { x: regionWidth / 2, y: regionHeight - 1 };
  if (sourceAnchor.x > regionWidth || sourceAnchor.y > regionHeight) {
    throw new VideoAtlasError(`anchor (${sourceAnchor.x},${sourceAnchor.y}) 超出区域 ${regionWidth}x${regionHeight}`);
  }
  const cellWidth = sharedOptions.width ?? (sharedOptions.height === null ? regionWidth : Math.max(1, Math.round(regionWidth * sharedOptions.height / regionHeight)));
  const cellHeight = sharedOptions.height ?? (sharedOptions.width === null ? regionHeight : Math.max(1, Math.round(regionHeight * sharedOptions.width / regionWidth)));
  const sheetWidth = cellWidth * frameCount;
  if (cellWidth > sharedOptions.maxAtlasWidth || cellHeight > sharedOptions.maxAtlasHeight) {
    throw new VideoAtlasError(`单帧尺寸 ${cellWidth}x${cellHeight} 超过最大图集尺寸 ${sharedOptions.maxAtlasWidth}x${sharedOptions.maxAtlasHeight}`);
  }
  if (sheetWidth > sharedOptions.maxAtlasWidth) {
    throw new VideoAtlasError(`水平图集尺寸 ${sheetWidth}x${cellHeight} 超过最大尺寸 ${sharedOptions.maxAtlasWidth}x${sharedOptions.maxAtlasHeight}`);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "cocos-image-atlas-"));
  try {
    const frames = [];
    const frameImages = [];
    let contentRect = null;
    for (const frame of sourceFrames) {
      const validatedImage = loaded.files.get(frame.image.file);
      if (!validatedImage || !Buffer.isBuffer(validatedImage.bytes)) {
        throw new VideoAtlasError(`index=${frame.index} 的 image 缺少已校验字节：${frame.image.file}`);
      }
      const processed = await processAtlasFrame(
        validatedImage.bytes,
        frame.index,
        temporaryDirectory,
        sharedOptions,
        cellWidth,
        cellHeight,
      );
      if (contentRect === null) contentRect = processed.contentRect;
      else requireStableContentRect(contentRect, processed.contentRect);
      frameImages.push(processed.image);
      frames.push({
        index: frame.index,
        game_time_ms: frame.game_time_ms,
        source_image: frame.source_image,
        image: frame.image,
        generation_record: frame.generation_record,
        parents: frame.parents,
        width: cellWidth,
        height: cellHeight,
      });
    }
    const sheetBytes = await composeHorizontalAtlas(
      frameImages,
      cellWidth,
      cellHeight,
      sharedOptions.maxAtlasWidth,
      sharedOptions.maxAtlasHeight,
    );
    const sheetHash = sha256Bytes(sheetBytes);
    const targetAnchor = {
      x: contentRect.x + sourceAnchor.x * contentRect.width / regionWidth,
      y: contentRect.y + sourceAnchor.y * contentRect.height / regionHeight,
    };
    const cell = {
      width: cellWidth,
      height: cellHeight,
      source_anchor: sourceAnchor,
      content_rect: contentRect,
      target_anchor: targetAnchor,
      layout: "horizontal",
      frame_count: frames.length,
    };
    const animation = {
      key: sharedOptions.animationKey,
      texture_key: sharedOptions.textureKey,
      frame_rate: source.fps,
      loop: source.loop,
    };
    const cc = createCocosAtlasContract({
      ...sharedOptions,
      fps: source.fps,
      loop: source.loop,
      outputSheet: paths.outputSheet,
    }, cell, frames.length);
    const previewHtml = renderAtlasPreview({
      sheetUrl: relativeUrl(dirname(paths.outputPreview), paths.outputSheet),
      sheetSha256: sheetHash,
      frameCount: frames.length,
      cell,
      fps: source.fps,
      loop: source.loop,
      compareTransparency: true,
    });
    const report = {
      schema: IMAGE_ATLAS_SCHEMA,
      status: "PASS",
      tool: { name: "cocos-images-to-atlas", version: "1" },
      input: {
        source_manifest_path: loaded.manifestPath,
        source_manifest_sha256: loaded.manifestSha256,
        fps: source.fps,
        remove_background: sharedOptions.removeBackground,
        display_width: sourceWidth,
        display_height: sourceHeight,
        ...(sharedOptions.region ? { region: { ...sharedOptions.region } } : {}),
        ...(sharedOptions.anchor ? { anchor: { ...sharedOptions.anchor } } : {}),
      },
      settings: {
        fps: source.fps,
        width: cellWidth,
        height: cellHeight,
        remove_background: sharedOptions.removeBackground,
        ...(sharedOptions.region ? { region: { ...sharedOptions.region } } : {}),
        ...(sharedOptions.anchor ? { anchor: { ...sharedOptions.anchor } } : {}),
      },
      cell,
      frames,
      animation,
      cc,
      artifacts: {
        sheet: { file: paths.outputSheet, width: sheetWidth, height: cellHeight, sha256: sheetHash },
        report: { file: paths.outputReport },
        preview: { file: paths.outputPreview },
      },
    };
    await writeAtlasOutputs([
      [paths.outputSheet, sheetBytes],
      [paths.outputReport, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8")],
      [paths.outputPreview, Buffer.from(previewHtml, "utf8")],
    ]);
    return report;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** 返回图片来源打包 CLI 帮助，明确时间轴只能来自已校验清单。 */
export function imagesAtlasHelp() {
  return `用法：node images-to-atlas.mjs --source-manifest <source.json> --project-root <root> --output-sheet <sheet.png> [选项]

输入与输出：
  --source-manifest <file>      已确认的 cocos-image-frame-source/1 清单（必需）
  --project-root <dir>          来源文件所属项目目录；清单与相对输出均以此为根（必需）
  --output-sheet <file.png>     图集 PNG 的实际导入位置（静态引用默认建议 project-root/assets/animations/）
  --output-report <file.json>   JSON 报告（相对路径基于 project-root；默认与图集同名）
  --output-preview <file.html>  可播放网页（相对路径基于 project-root；默认与图集同名）
  --creator-resource-path <path> 声明 resources.load 动态加载（文件须位于 assets/resources，键须精确对应相对路径）

处理选项：
  --width <pixels>              输出帧宽；单独指定时等比缩放
  --height <pixels>             输出帧高；单独指定时等比缩放
  --region <x,y,width,height>   按固定来源画布区域裁剪
  --anchor <x,y>                区域内动画锚点，默认水平居中、底边向上 1 像素
  --remove-background           移除硬边纯色背景
  --no-remove-background        保留来源 Alpha（默认）
  --edge-profile <hard-edge>    去背景前显式声明硬边纯色背景
  --color-separation-verified  确认主体颜色与去背色已分离
  --background-color <#RRGGBB>  去背景纯色
  --background-tolerance <n>    RGB 容差，默认 24
  --max-width <pixels>          图集最大宽度，默认 16384
  --max-height <pixels>         图集最大高度，默认 16384
  --animation-key <key>         Cocos 动画 key
  --texture-key <key>           Cocos 纹理 key

FPS 与 loop 固定读取来源清单，不能由 CLI 覆盖。预览提供播放、暂停、重播、逐帧选择及透明背景对比。

示例：
  静态引用：node images-to-atlas.mjs --source-manifest source.json --project-root . --output-sheet assets/animations/hero.png --width 128 --height 128 --anchor 384,767 --no-remove-background
  动态加载：node images-to-atlas.mjs --source-manifest source.json --project-root . --output-sheet assets/resources/animations/hero.png --width 128 --height 128 --anchor 384,767 --creator-resource-path animations/hero --no-remove-background
`;
}

/** 读取 CLI 参数，拒绝视频选项、未知参数和缺失值。 */
export function parseImagesAtlasArgs(argv = process.argv.slice(2)) {
  const options = {};
  const valueOptions = new Map([
    ["--source-manifest", "sourceManifest"], ["--project-root", "projectRoot"],
    ["--output-sheet", "outputSheet"], ["--output-report", "outputReport"], ["--output-preview", "outputPreview"],
    ["--width", "width"], ["--height", "height"], ["--region", "region"], ["--anchor", "anchor"],
    ["--background-color", "backgroundColor"], ["--background-tolerance", "backgroundTolerance"],
    ["--max-width", "maxAtlasWidth"], ["--max-height", "maxAtlasHeight"],
    ["--animation-key", "animationKey"], ["--texture-key", "textureKey"], ["--creator-resource-path", "creatorResourcePath"],
    ["--edge-profile", "edgeProfile"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--remove-background") { options.removeBackground = true; continue; }
    if (argument === "--no-remove-background") { options.removeBackground = false; continue; }
    if (argument === "--color-separation-verified") { options.colorSeparationVerified = true; continue; }
    const separator = argument.indexOf("=");
    const name = separator >= 0 ? argument.slice(0, separator) : argument;
    if (!valueOptions.has(name)) throw new VideoAtlasError(`未知参数：${argument}`);
    const value = separator >= 0 ? argument.slice(separator + 1) : argv[++index];
    if (value === undefined || String(value).startsWith("--")) throw new VideoAtlasError(`${name} 缺少值`);
    const key = valueOptions.get(name);
    if (key === "region") {
      const coordinates = String(value).split(",");
      if (coordinates.length !== 4 || coordinates.some((coordinate) => coordinate.trim() === "")) {
        throw new VideoAtlasError("--region 必须按 x,y,width,height 提供四个像素整数");
      }
      options.region = { x: coordinates[0].trim(), y: coordinates[1].trim(), width: coordinates[2].trim(), height: coordinates[3].trim() };
      continue;
    }
    if (key === "anchor") {
      const coordinates = String(value).split(",");
      if (coordinates.length !== 2 || coordinates.some((coordinate) => coordinate.trim() === "")) {
        throw new VideoAtlasError("--anchor 必须按 x,y 提供两个像素坐标");
      }
      const anchor = { x: Number(coordinates[0]), y: Number(coordinates[1]) };
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < 0 || anchor.y < 0) {
        throw new VideoAtlasError("--anchor 坐标必须是非负有限数字");
      }
      options.anchor = anchor;
      continue;
    }
    options[key] = ["width", "height", "backgroundTolerance", "maxAtlasWidth", "maxAtlasHeight"].includes(key) ? Number(value) : String(value);
  }
  return options;
}

/** 执行图片图集 CLI 并将失败统一映射到图片报告 schema。 */
export async function runImagesAtlasCli(argv = process.argv.slice(2), io = console) {
  try {
    const parsed = parseImagesAtlasArgs(argv);
    if (parsed.help) { io.log(imagesAtlasHelp()); return 0; }
    const report = await imagesToAtlas(parsed);
    io.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    io.error(JSON.stringify({ schema: IMAGE_ATLAS_SCHEMA, status: "FAIL", error: error.message }));
    return 2;
  }
}

/** 仅在用户直接执行本文件时启动 CLI，测试导入时不产生进程副作用。 */
const currentFile = resolve(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedFile && currentFile === invokedFile) process.exitCode = await runImagesAtlasCli();
