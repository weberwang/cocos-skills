#!/usr/bin/env node
/**
 * 将视频按目标帧率抽取为 Cocos 水平精灵图集，并提供可播放的本地网页预览。
 *
 * ffmpeg/ffprobe 只负责读取视频与按帧率抽样；尺寸归一化、透明 PNG 拼图和
 * 背景移除都在本地完成，且输出在全部校验通过后才写入。
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "../../cocos-game-workflow-control/scripts/runtime/image-runtime.mjs";
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

export { VideoAtlasError };

/** Creator 接入清单替换旧假代码后的新视频图集报告 schema。 */
export const VIDEO_ATLAS_SCHEMA = "cocos-video-atlas/2";

/** 以流方式计算视频 SHA-256，避免大型输入视频完整驻留内存。 */
async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

/** 解析 API/CLI 参数，提前派生输出名并检查输出路径之间的冲突。 */
export function normalizeVideoAtlasOptions(input = {}) {
  if (!isObject(input)) throw new VideoAtlasError("视频图集配置必须是对象");
  const videoValue = input.inputVideo ?? input.input_video ?? input["input-video"];
  const sheetValue = input.outputSheet ?? input.output_sheet ?? input["output-sheet"];
  if (!nonEmptyString(videoValue)) throw new VideoAtlasError("必须提供 input-video");
  if (!nonEmptyString(sheetValue)) throw new VideoAtlasError("必须提供 output-sheet");

  const inputVideo = resolve(videoValue);
  const outputSheet = resolve(sheetValue);
  const outputReportValue = input.outputReport ?? input.output_report ?? input["output-report"] ?? `${outputSheet.replace(/\.png$/iu, "")}.json`;
  const outputPreviewValue = input.outputPreview ?? input.output_preview ?? input["output-preview"] ?? `${outputSheet.replace(/\.png$/iu, "")}.html`;
  if (!nonEmptyString(outputReportValue) || !nonEmptyString(outputPreviewValue)) throw new VideoAtlasError("output-report 和 output-preview 必须是非空路径");
  const outputReport = resolve(outputReportValue);
  const outputPreview = resolve(outputPreviewValue);
  if (extname(outputSheet).toLowerCase() !== ".png") throw new VideoAtlasError("output-sheet 必须使用 .png 后缀");
  if (extname(outputReport).toLowerCase() !== ".json") throw new VideoAtlasError("output-report 必须使用 .json 后缀");
  if (extname(outputPreview).toLowerCase() !== ".html" && extname(outputPreview).toLowerCase() !== ".htm") throw new VideoAtlasError("output-preview 必须使用 .html 或 .htm 后缀");

  const outputs = [outputSheet, outputReport, outputPreview];
  for (let index = 0; index < outputs.length; index += 1) {
    for (let other = index + 1; other < outputs.length; other += 1) {
      if (samePath(outputs[index], outputs[other])) throw new VideoAtlasError("output-sheet、output-report 和 output-preview 必须使用不同路径");
    }
  }

  const commonOptions = normalizeCommonAtlasOptions(input, { outputSheet, defaultFps: 12, defaultLoop: true });
  const commandRunner = input.commandRunner ?? input.runCommand;
  if (commandRunner !== undefined && typeof commandRunner !== "function") throw new VideoAtlasError("commandRunner 必须是函数");

  return Object.freeze({
    inputVideo,
    outputSheet,
    outputReport,
    outputPreview,
    ...commonOptions,
    ffmpegPath: input.ffmpegPath ?? input.ffmpeg ?? "ffmpeg",
    ffprobePath: input.ffprobePath ?? input.ffprobe ?? "ffprobe",
    commandRunner,
  });
}

/** 使用 spawn 的 argv 形式运行命令，不经过 shell 或命令字符串拼接。 */
export async function runExternalCommand(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      rejectPromise(new VideoAtlasError(`无法启动外部命令 ${command}：${error.message}`, { cause: error }));
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => rejectPromise(new VideoAtlasError(`无法启动外部命令 ${command}：${error.message}`, { cause: error })));
    child.once("close", (exitCode, signal) => {
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode, signal };
      if (exitCode !== 0) {
        const detail = result.stderr.toString("utf8").trim();
        rejectPromise(new VideoAtlasError(`${command} 退出码为 ${exitCode ?? "null"}${detail ? `：${detail}` : ""}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

/** 调用默认或注入的命令运行器，并统一检查退出码与 stderr。 */
async function invokeCommand(options, command, args, label) {
  let result;
  try {
    result = await (options.commandRunner ?? runExternalCommand)(command, args, { cwd: dirname(options.inputVideo) });
  } catch (error) {
    throw new VideoAtlasError(`${label}失败：${error.message}`, { cause: error });
  }
  if (typeof result === "string" || Buffer.isBuffer(result)) return Buffer.isBuffer(result) ? result.toString("utf8") : result;
  if (!isObject(result)) throw new VideoAtlasError(`${label}运行器必须返回命令结果`);
  const exitCode = result.exitCode ?? result.code ?? 0;
  if (exitCode !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr ?? "");
    throw new VideoAtlasError(`${label}失败（退出码 ${exitCode}）${stderr.trim() ? `：${stderr.trim()}` : ""}`);
  }
  const stdout = result.stdout ?? "";
  return Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout);
}

/** 解析 ffprobe 输出，按 codec_type 选择视频流并准确统计音轨是否存在。 */
function parseVideoMetadata(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new VideoAtlasError(`ffprobe 返回无效 JSON：${error.message}`);
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const stream = streams.find((candidate) => candidate?.codec_type === "video") ?? null;
  const hasAudio = streams.some((candidate) => candidate?.codec_type === "audio");
  if (!isObject(stream) || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width <= 0 || stream.height <= 0) {
    throw new VideoAtlasError("ffprobe 未返回有效视频流尺寸");
  }
  const duration = Number(stream.duration ?? parsed?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new VideoAtlasError("ffprobe 未返回有效视频时长");
  const sourceFps = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate);
  const rotationValue = stream.side_data_list?.find((entry) => entry?.rotation !== undefined)?.rotation ?? stream.tags?.rotate;
  const rotation = rotationValue === undefined ? 0 : Number(rotationValue);
  const dimensions = Number.isFinite(rotation) ? rotatedDimensions(stream.width, stream.height, rotation) : { width: stream.width, height: stream.height };
  return { width: stream.width, height: stream.height, displayWidth: dimensions.width, displayHeight: dimensions.height, duration, sourceFps, rotation: Number.isFinite(rotation) ? rotation : null, hasAudio };
}

/** 根据 ffprobe 旋转元数据预测 ffmpeg 自动旋转后的显示画布尺寸。 */
function rotatedDimensions(width, height, angleDegrees) {
  const angle = ((angleDegrees % 360) + 360) % 360;
  if (Math.abs(angle - 90) < 0.01 || Math.abs(angle - 270) < 0.01) return { width: height, height: width };
  if (Math.abs(angle) < 0.01 || Math.abs(angle - 180) < 0.01) return { width, height };
  const radians = angle * Math.PI / 180;
  return {
    width: Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))),
    height: Math.ceil(Math.abs(height * Math.cos(radians)) + Math.abs(width * Math.sin(radians))),
  };
}

/** 将 ffprobe 的分数帧率转换为有限正数，无法解析时返回 null。 */
function parseFrameRate(value) {
  if (typeof value !== "string") return null;
  const [numerator, denominator = "1"] = value.split("/");
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** 规范十进制参数，避免科学计数法给 ffmpeg filter 带来平台差异。 */
function formatDecimal(number) {
  return String(Number(number.toFixed(6)));
}

/** 从本地 PNG 帧目录读取 ffmpeg 输出的自然顺序文件列表。 */
async function collectExtractedFrames(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^frame-\d{8}\.png$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((name) => join(directory, name));
}

/** 检查视频和输出不会通过解析路径指向同一文件，且输出默认不覆盖既有文件。 */
async function preflightPaths(options) {
  let inputStats;
  try {
    inputStats = await stat(options.inputVideo);
  } catch (error) {
    throw new VideoAtlasError(`input-video 不可读：${options.inputVideo}（${error.message}）`);
  }
  if (!inputStats.isFile()) throw new VideoAtlasError("input-video 必须是普通文件");
  await preflightAtlasOutputs(
    [options.outputSheet, options.outputReport, options.outputPreview],
    [options.inputVideo],
    "视频输入",
  );
}

/** 生成与帧动画工作流一致的 Creator 资源接入清单。 */
export function createCocosVideoAtlasContract(options, cell, frameCount) {
  return createCocosAtlasContract(options, cell, frameCount);
}

/** 生成沿用共用播放器并带原视频对照栏的预览。 */
export function renderVideoAtlasPreview({ sheetUrl, sheetSha256, videoUrl, frameCount, cell, fps, loop, videoName }) {
  return renderAtlasPreview({
    sheetUrl, sheetSha256, frameCount, cell, fps, loop,
    source: { kind: "video", url: videoUrl, name: videoName },
  });
}

/** 复用帧动画共用处理器完成区域、去背景、contain 与透明 cell 归一化。 */
async function processFrame(frameFile, index, temporaryDirectory, options, targetWidth, targetHeight) {
  const frame = await processAtlasFrame(frameFile, index, temporaryDirectory, options, targetWidth, targetHeight);
  return { index, sourceTimestamp: Number((index / options.fps).toFixed(6)), ...frame };
}

/** 将视频抽帧、可选去背景与尺寸处理后输出水平图集、JSON 报告和 HTML 预览。 */
export async function videoToAtlas(input = {}) {
  const options = normalizeVideoAtlasOptions(input);
  await preflightPaths(options);

  const videoSha256 = await sha256File(options.inputVideo);
  const probeArgs = [
    "-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation:format=duration",
    "-of", "json", options.inputVideo,
  ];
  const probeText = await invokeCommand(options, options.ffprobePath, probeArgs, "ffprobe 媒体探测");
  const metadata = parseVideoMetadata(probeText);
  const estimatedSourceWidth = options.region?.width ?? metadata.displayWidth;
  const estimatedSourceHeight = options.region?.height ?? metadata.displayHeight;
  const estimatedCellWidth = options.width ?? (options.height === null ? estimatedSourceWidth : Math.max(1, Math.round(estimatedSourceWidth * options.height / estimatedSourceHeight)));
  const estimatedCellHeight = options.height ?? (options.width === null ? estimatedSourceHeight : Math.max(1, Math.round(estimatedSourceHeight * options.width / estimatedSourceWidth)));
  if (estimatedCellWidth > options.maxAtlasWidth || estimatedCellHeight > options.maxAtlasHeight) throw new VideoAtlasError(`单帧尺寸 ${estimatedCellWidth}x${estimatedCellHeight} 超过最大图集尺寸 ${options.maxAtlasWidth}x${options.maxAtlasHeight}`);
  const estimatedFrameCount = Math.max(1, Math.ceil(metadata.duration * options.fps));
  if (estimatedFrameCount * estimatedCellWidth > options.maxAtlasWidth) {
    throw new VideoAtlasError(`预计水平图集尺寸 ${estimatedFrameCount * estimatedCellWidth}x${estimatedCellHeight} 超过最大尺寸 ${options.maxAtlasWidth}x${options.maxAtlasHeight}`);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "cocos-video-atlas-"));
  try {
    const framePattern = join(temporaryDirectory, "frame-%08d.png");
    const extractionArgs = [
      "-v", "error", "-nostdin", "-i", options.inputVideo, "-map", "0:v:0",
      "-vf", `fps=${formatDecimal(options.fps)}`,
      "-vsync", "0", "-start_number", "0", framePattern,
    ];
    await invokeCommand(options, options.ffmpegPath, extractionArgs, "ffmpeg 视频抽帧");
    const frameFiles = await collectExtractedFrames(temporaryDirectory);
    if (frameFiles.length === 0) throw new VideoAtlasError("ffmpeg 成功退出但没有生成任何帧");
    // 流旋转元数据在不同编码器中表现不一，首张 PNG 是 ffmpeg 自动旋转后的真实画布依据。
    const firstFrameMetadata = await sharp(frameFiles[0]).metadata();
    if (!Number.isInteger(firstFrameMetadata.width) || !Number.isInteger(firstFrameMetadata.height)) {
      throw new VideoAtlasError("ffmpeg 首帧 PNG 未包含有效尺寸");
    }
    const sourceWidth = firstFrameMetadata.width;
    const sourceHeight = firstFrameMetadata.height;
    if (options.region && (options.region.x + options.region.width > sourceWidth || options.region.y + options.region.height > sourceHeight)) {
      throw new VideoAtlasError(`region (${options.region.x},${options.region.y},${options.region.width},${options.region.height}) 超出首张解码画布 ${sourceWidth}x${sourceHeight}`);
    }
    const regionWidth = options.region?.width ?? sourceWidth;
    const regionHeight = options.region?.height ?? sourceHeight;
    const sourceAnchor = options.anchor ?? { x: regionWidth / 2, y: regionHeight - 1 };
    if (sourceAnchor.x > regionWidth || sourceAnchor.y > regionHeight) {
      throw new VideoAtlasError(`anchor (${sourceAnchor.x},${sourceAnchor.y}) 超出区域 ${regionWidth}x${regionHeight}`);
    }
    const cellWidth = options.width ?? (options.height === null ? regionWidth : Math.max(1, Math.round(regionWidth * options.height / regionHeight)));
    const cellHeight = options.height ?? (options.width === null ? regionHeight : Math.max(1, Math.round(regionHeight * options.width / regionWidth)));
    const sheetWidth = cellWidth * frameFiles.length;
    if (sheetWidth > options.maxAtlasWidth || cellHeight > options.maxAtlasHeight) {
      throw new VideoAtlasError(`水平图集尺寸 ${sheetWidth}x${cellHeight} 超过最大尺寸 ${options.maxAtlasWidth}x${options.maxAtlasHeight}`);
    }

    const frames = [];
    const frameImages = [];
    let contentRect = null;
    for (let index = 0; index < frameFiles.length; index += 1) {
      const frame = await processFrame(frameFiles[index], index, temporaryDirectory, options, cellWidth, cellHeight);
      if (contentRect === null) contentRect = frame.contentRect;
      else requireStableContentRect(contentRect, frame.contentRect);
      frames.push({ index, source_timestamp: frame.sourceTimestamp, source_sha256: frame.sourceSha256, width: cellWidth, height: cellHeight });
      frameImages.push(frame.image);
    }
    const sheetBytes = await composeHorizontalAtlas(frameImages, cellWidth, cellHeight, options.maxAtlasWidth, options.maxAtlasHeight);
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
    const animation = { key: options.animationKey, texture_key: options.textureKey, frame_rate: options.fps, loop: options.loop };
    const cc = createCocosVideoAtlasContract(options, cell, frames.length);
    const previewHtml = renderVideoAtlasPreview({
      sheetUrl: relativeUrl(dirname(options.outputPreview), options.outputSheet),
      sheetSha256: sheetHash,
      videoUrl: relativeUrl(dirname(options.outputPreview), options.inputVideo),
      frameCount: frames.length,
      cell,
      fps: options.fps,
      loop: options.loop,
      videoName: basename(options.inputVideo),
    });
    const report = {
      schema: VIDEO_ATLAS_SCHEMA,
      status: "PASS",
      tool: { name: "cocos-video-to-atlas", version: "1" },
      input: {
        video_path: options.inputVideo,
        video_sha256: videoSha256,
        fps: options.fps,
        remove_background: options.removeBackground,
        width: metadata.width,
        height: metadata.height,
        display_width: sourceWidth,
        display_height: sourceHeight,
        rotation_degrees: metadata.rotation,
        source_fps: metadata.sourceFps,
        duration_seconds: metadata.duration,
        has_audio: metadata.hasAudio,
        ...(options.region ? { region: { ...options.region } } : {}),
        ...(options.anchor ? { anchor: { ...options.anchor } } : {}),
      },
      settings: {
        fps: options.fps,
        width: cellWidth,
        height: cellHeight,
        remove_background: options.removeBackground,
        ...(options.region ? { region: { ...options.region } } : {}),
        ...(options.anchor ? { anchor: { ...options.anchor } } : {}),
      },
      cell,
      frames,
      animation,
      cc,
      artifacts: {
        sheet: { file: options.outputSheet, width: sheetWidth, height: cellHeight, sha256: sheetHash },
        report: { file: options.outputReport },
        preview: { file: options.outputPreview },
      },
    };
    const outputs = [
      [options.outputSheet, sheetBytes],
      [options.outputReport, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8")],
      [options.outputPreview, Buffer.from(previewHtml, "utf8")],
    ];
    await writeAtlasOutputs(outputs);
    return report;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** 返回参数说明，列明抽帧、缩放、背景移除和最大尺寸选项。 */
export function videoAtlasHelp() {
  return `用法：node video-to-atlas.mjs --input-video <video> --output-sheet <sheet.png> [选项]

输入与输出：
  --input-video <file>          输入视频（必需）
  --output-sheet <file.png>     水平图集 PNG 的实际导入位置（静态引用默认建议 assets/animations/）
  --output-report <file.json>   JSON 报告（默认与图集同名）
  --output-preview <file.html>  可播放网页（默认与图集同名）
  --creator-resource-path <path> 声明 resources.load 动态加载（文件须位于 assets/resources，键须精确对应相对路径）

处理选项：
  --fps <number>                抽帧与动画播放帧率，默认 12
  --width <pixels>              输出帧宽；单独指定时等比缩放
  --height <pixels>             输出帧高；单独指定时等比缩放
  --region <x,y,width,height>   按解码画布左上角坐标裁剪区域
  --anchor <x,y>                动画区域内的局部像素锚点，默认水平居中、底边向上 1 像素
  --remove-background           移除背景，默认色为 #00ff00
  --edge-profile <hard-edge>    去背景前显式声明硬边纯色背景
  --color-separation-verified  确认主体颜色与去背色已分离
  --background-color <#RRGGBB>  去背景纯色
  --background-tolerance <n>    RGB 容差，默认 24
  --max-width <pixels>          图集最大宽度，默认 16384
  --max-height <pixels>         图集最大高度，默认 16384
  --animation-key <key>         Cocos 动画 key
  --texture-key <key>           Cocos 纹理 key
  --no-loop                     禁用循环
  --ffmpeg <path>               ffmpeg 可执行文件路径
  --ffprobe <path>              ffprobe 可执行文件路径

示例：
  静态引用：node video-to-atlas.mjs --input-video walk.mp4 --output-sheet assets/animations/hero-attack.png
  动态加载：node video-to-atlas.mjs --input-video walk.mp4 --output-sheet assets/resources/animations/hero-attack.png --creator-resource-path animations/hero-attack
`;
}

/** 读取 CLI 参数，拒绝未知选项和缺失值。 */
export function parseVideoAtlasArgs(argv = process.argv.slice(2)) {
  const options = {};
  const valueOptions = new Map([
    ["--input-video", "inputVideo"], ["--output-sheet", "outputSheet"], ["--output-report", "outputReport"], ["--output-preview", "outputPreview"],
    ["--fps", "fps"], ["--width", "width"], ["--height", "height"], ["--region", "region"], ["--anchor", "anchor"], ["--background-color", "backgroundColor"], ["--background-tolerance", "backgroundTolerance"],
    ["--max-width", "maxAtlasWidth"], ["--max-height", "maxAtlasHeight"], ["--animation-key", "animationKey"], ["--texture-key", "textureKey"], ["--creator-resource-path", "creatorResourcePath"],
    ["--edge-profile", "edgeProfile"], ["--ffmpeg", "ffmpegPath"], ["--ffprobe", "ffprobePath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--remove-background") { options.removeBackground = true; continue; }
    if (argument === "--color-separation-verified") { options.colorSeparationVerified = true; continue; }
    if (argument === "--no-loop") { options.loop = false; continue; }
    const separator = argument.indexOf("=");
    const name = separator >= 0 ? argument.slice(0, separator) : argument;
    if (!valueOptions.has(name)) throw new VideoAtlasError(`未知参数：${argument}`);
    const value = separator >= 0 ? argument.slice(separator + 1) : argv[++index];
    if (value === undefined || String(value).startsWith("--")) throw new VideoAtlasError(`${name} 缺少值`);
    const key = valueOptions.get(name);
    if (key === "region") {
      // CLI 先拆成四个原始坐标字段，再由 API 共用的规范器统一检查整数与边界。
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
    options[key] = ["fps", "width", "height", "backgroundTolerance", "maxAtlasWidth", "maxAtlasHeight"].includes(key) ? Number(value) : String(value);
  }
  return options;
}

/** 执行 CLI 并将错误映射为稳定退出码；导入模块时不会启动命令行。 */
export async function runVideoAtlasCli(argv = process.argv.slice(2), io = console) {
  try {
    const parsed = parseVideoAtlasArgs(argv);
    if (parsed.help) { io.log(videoAtlasHelp()); return 0; }
    const report = await videoToAtlas(parsed);
    io.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    io.error(JSON.stringify({ schema: VIDEO_ATLAS_SCHEMA, status: "FAIL", error: error.message }));
    return 2;
  }
}

/** 仅在用户直接执行本文件时启动 CLI，测试导入时不产生进程副作用。 */
const currentFile = resolve(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedFile && currentFile === invokedFile) process.exitCode = await runVideoAtlasCli();
