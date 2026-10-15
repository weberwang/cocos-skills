#!/usr/bin/env node
/**
 * 本地纯色背景移除工具。
 *
 * 工具只处理 PNG 位图：从画布边缘开始，以显式背景色和 RGB 欧氏容差做四连通
 * 填充并清除匹配像素。它不会尝试理解复杂场景、头发、半透明玻璃或发光边缘；
 * 这类素材应改用人工遮罩或专门的前景分割流程。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePngRgba, encodePngRgba } from "./effect_image_raster.mjs";
import { assertTransparencyPreviewPathsAvailable, writeTransparencyPreviews } from "./transparent-raster.mjs";

/** 本工具输出记录的稳定 schema。 */
export const LOCAL_BACKGROUND_REMOVAL_SCHEMA = "background-removal-local/1";
/** 供工作流记录使用的背景移除操作名。 */
export const LOCAL_BACKGROUND_REMOVAL_OPERATION = "background-removal";
/** 已有透明 Alpha 的复用路线，不得伪装成一次背景移除。 */
export const LOCAL_DIRECT_ALPHA_OPERATION = "direct-alpha";
/** 记录本地算法身份；不把算法伪装成模型或外部服务。 */
export const LOCAL_BACKGROUND_REMOVAL_TOOL = "edge-connected-chroma";
/** 本地算法合同版本，算法参数和输出结构变化时递增。 */
export const LOCAL_BACKGROUND_REMOVAL_TOOL_VERSION = "1";

/** PNG 文件签名，输入只允许使用可复核的 PNG 位图。 */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 表示输入参数或像素验证不满足安全条件。 */
export class BackgroundRemovalError extends Error {
  /** 创建可由 API 与 CLI 共同识别的错误。 */
  constructor(message) {
    super(message);
    this.name = "BackgroundRemovalError";
  }
}

/** 判断值是否为普通对象，拒绝数组和 null 作为图片或配置对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断值是否为非空字符串，用于路径和记录字段的严格校验。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断数值是否为有限的非负整数。 */
function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/** 计算字节的 SHA-256，记录使用带算法前缀的稳定格式。 */
export function sha256Bytes(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new BackgroundRemovalError("sha256Bytes 只接受 Buffer");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 把 RGB 数组、对象或十六进制字符串规范为三通道整数。 */
export function parseBackgroundColor(value) {
  let channels;
  if (typeof value === "string") {
    const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
    if (match) channels = [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16),
    ];
  } else if (Array.isArray(value)) {
    channels = value;
  } else if (isObject(value)) {
    channels = [value.r, value.g, value.b];
  }
  if (!Array.isArray(channels) || channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw new BackgroundRemovalError("background_color 必须是 #RRGGBB、[r,g,b] 或 {r,g,b}");
  }
  return Object.freeze(channels.slice(0, 3));
}

/** 校验颜色容差；硬边去背将距离上限限制为 64，避免容差被用来吞掉主体。 */
export function parseColorTolerance(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 64) {
    throw new BackgroundRemovalError("tolerance 必须是 0 到 64 之间的有限数字");
  }
  return value;
}

/** 将规范化后的 RGB 颜色编码为记录和证据中使用的稳定十六进制格式。 */
function formatBackgroundColor(backgroundColor) {
  return `#${backgroundColor.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** 判断两个 RGB 颜色是否在给定欧氏容差内。 */
function matchesBackground(pixels, pixelIndex, backgroundColor, tolerance) {
  const offset = pixelIndex * 4;
  const red = pixels[offset] - backgroundColor[0];
  const green = pixels[offset + 1] - backgroundColor[1];
  const blue = pixels[offset + 2] - backgroundColor[2];
  return Math.sqrt(red * red + green * green + blue * blue) <= tolerance;
}

/** 透明像素本身不删除，但作为已知背景通道继续连通到其内侧的纯色背景。 */
function isTraversableBackground(pixels, pixelIndex, backgroundColor, tolerance) {
  return pixels[pixelIndex * 4 + 3] === 0 || matchesBackground(pixels, pixelIndex, backgroundColor, tolerance);
}

/** 校验可处理的 RGBA 图像，防止队列索引溢出或静默接受坏像素。 */
function validateRgbaImage(image) {
  if (!isObject(image) || !nonNegativeInteger(image.width) || image.width <= 0 || !nonNegativeInteger(image.height) || image.height <= 0 || !Buffer.isBuffer(image.pixels) || image.pixels.length !== image.width * image.height * 4) {
    throw new BackgroundRemovalError("image 必须包含正整数 width/height 和匹配尺寸的 RGBA Buffer");
  }
}

/**
 * 从边缘移除连通背景并保留封闭同色像素。
 *
 * 队列只记录符合背景颜色的像素；因此同色区域若被主体完全包围，就不会从边界
 * 进入队列。每个像素最多入队一次，避免大图在重复颜色区域中产生额外内存和时间。
 */
export function removeConnectedBackground(image, options = {}) {
  validateRgbaImage(image);
  const backgroundColor = parseBackgroundColor(options.backgroundColor ?? options.background_color);
  const tolerance = parseColorTolerance(options.tolerance);
  const { width, height, pixels } = image;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  /** 每个可遍历像素只入队一次，边界重复命中也不会重复处理。 */
  function enqueue(index) {
    if (!visited[index] && isTraversableBackground(pixels, index, backgroundColor, tolerance)) {
      visited[index] = 1;
      queue[tail] = index;
      tail += 1;
    }
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const outputPixels = Buffer.from(pixels);
  let removedPixels = 0;
  for (let index = 0; index < total; index += 1) {
    // 透明边框只作为遍历通道；只有原本有 Alpha 的候选像素才计入删除并清空 RGB。
    if (visited[index] && pixels[index * 4 + 3] !== 0) {
      outputPixels.fill(0, index * 4, index * 4 + 4);
      removedPixels += 1;
    }
  }
  return { pixels: outputPixels, removedPixels, backgroundColor, tolerance };
}

/** 统计透明、前景和完全不透明像素，供输出门禁与联系表复核。 */
export function countAlphaPixels(pixels) {
  if (!Buffer.isBuffer(pixels) || pixels.length % 4 !== 0) throw new BackgroundRemovalError("RGBA 像素 Buffer 无效");
  let transparent = 0;
  let foreground = 0;
  let opaque = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index];
    if (alpha === 0) transparent += 1;
    else foreground += 1;
    if (alpha === 255) opaque += 1;
  }
  return { transparent, foreground, opaque };
}

/**
 * 严格模式核验输入是不透明的，且所有画布边缘像素匹配指定背景色。
 *
 * 这项证据只能证明输入满足不透明与边缘颜色条件，不能识别主体内部的棋盘格；
 * 因此复杂背景仍需人工检查或专用前景分割流程。
 */
function inspectSolidBackground(image, backgroundColor, tolerance) {
  const { width, height, pixels } = image;
  const alpha = countAlphaPixels(pixels);
  let boundaryPixels = 0;
  let matchedBoundaryPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && x !== width - 1 && y !== 0 && y !== height - 1) continue;
      boundaryPixels += 1;
      if (matchesBackground(pixels, y * width + x, backgroundColor, tolerance)) matchedBoundaryPixels += 1;
    }
  }
  const opaque = alpha.opaque === width * height;
  return {
    status: opaque && matchedBoundaryPixels === boundaryPixels ? "passed" : "failed",
    background_color: formatBackgroundColor(backgroundColor),
    tolerance,
    boundary_pixels: boundaryPixels,
    matched_boundary_pixels: matchedBoundaryPixels,
    opaque,
    opaque_pixels: alpha.opaque,
    total_pixels: width * height,
  };
}

/** 判断两个绝对路径是否相同，兼容 Windows 文件系统大小写。 */
function sameResolvedPath(left, right) {
  const leftResolved = resolve(left);
  const rightResolved = resolve(right);
  return process.platform === "win32" ? leftResolved.toLowerCase() === rightResolved.toLowerCase() : leftResolved === rightResolved;
}

/** 读取 PNG 色彩类型，判断文件是否实际带 Alpha 通道而非只看像素结果。 */
function pngHasAlphaChannel(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  let colorType = null;
  let transparencyChunk = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return false;
    if (type === "IHDR" && length >= 10) colorType = bytes[dataStart + 9];
    if (type === "tRNS") transparencyChunk = true;
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  return [4, 6].includes(colorType) || transparencyChunk;
}

/** 校验输入、输出和可选记录路径，禁止原图被原地覆盖。 */
function resolvePaths(options) {
  const sourceFile = options.sourceFile ?? options.source_file;
  const outputFile = options.outputFile ?? options.output_file;
  const recordFile = options.recordFile ?? options.record_file;
  if (!nonEmptyString(sourceFile)) throw new BackgroundRemovalError("source_file 必须是非空路径");
  if (!nonEmptyString(outputFile)) throw new BackgroundRemovalError("output_file 必须是非空路径");
  if (!/\.png$/i.test(outputFile)) throw new BackgroundRemovalError("output_file 必须使用 .png 后缀");
  if (sameResolvedPath(sourceFile, outputFile)) throw new BackgroundRemovalError("source_file 与 output_file 不得是同一路径");
  if (recordFile !== undefined && !nonEmptyString(recordFile)) throw new BackgroundRemovalError("record_file 必须是非空路径");
  if (recordFile !== undefined && sameResolvedPath(recordFile, sourceFile)) throw new BackgroundRemovalError("record_file 不得覆盖 source_file");
  if (recordFile !== undefined && sameResolvedPath(recordFile, outputFile)) throw new BackgroundRemovalError("record_file 不得覆盖 output_file");
  return { sourceFile, outputFile, recordFile };
}

/** 判断 RGBA 输入是否包含可复用的透明像素。 */
function hasTransparentPixels(pixels) {
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) return true;
  return false;
}

/** 生成失败原因，供调用方在不抛出像素门禁失败时自动修复。 */
function validationFailures({ reuseAlpha, removedPixels, foregroundPixels, allowEmptyForeground }) {
  const failures = [];
  if (foregroundPixels === 0 && !allowEmptyForeground) failures.push("empty-foreground");
  if (!reuseAlpha && removedPixels === 0) failures.push("zero-deletion");
  return failures;
}

/**
 * 从文件执行一次本地背景移除并生成机器可读记录。
 *
 * 本函数只输出原始像素尺寸的 PNG；比例、裁切和 DPR 归一化交给现有的
 * visual-image-normalization 模块，避免去背景阶段偷偷改变主体边缘或构图。
 * 帧动画调用方可显式允许单帧为空，但须另行验证整段至少包含一帧前景。
 */
export async function removeBackgroundLocal(options = {}) {
  const paths = resolvePaths(options);
  const allowEmptyForeground = options.allowEmptyForeground ?? false;
  if (typeof allowEmptyForeground !== "boolean") throw new BackgroundRemovalError("allowEmptyForeground 必须是布尔值");
  const reuseAlpha = options.reuseExistingAlpha ?? options.reuse_existing_alpha ?? options.reuseAlpha ?? options.reuse_alpha ?? false;
  if (typeof reuseAlpha !== "boolean") throw new BackgroundRemovalError("reuse_existing_alpha 必须是布尔值");
  const requireSolidBackground = options.requireSolidBackground ?? options.require_solid_background ?? !reuseAlpha;
  if (typeof requireSolidBackground !== "boolean") throw new BackgroundRemovalError("require_solid_background 必须是布尔值");
  if (reuseAlpha && requireSolidBackground) throw new BackgroundRemovalError("require_solid_background 与 reuse_existing_alpha 互斥");
  const edgeProfile = options.edgeProfile ?? options.edge_profile;
  const colorSeparationVerified = options.colorSeparationVerified ?? options.color_separation_verified;
  if (!reuseAlpha && edgeProfile !== "hard-edge") throw new BackgroundRemovalError("颜色阈值去背只接受显式 edge_profile='hard-edge'；复杂或未知边缘需要真实 Alpha、遮罩或重新生产");
  if (!reuseAlpha && colorSeparationVerified !== true) throw new BackgroundRemovalError("颜色阈值去背必须显式确认 color_separation_verified=true");
  if (!reuseAlpha && !requireSolidBackground) throw new BackgroundRemovalError("颜色阈值去背必须启用 require_solid_background=true");
  const candidateSha256 = options.candidateSha256 ?? options.candidate_sha256;

  let sourceBytes;
  try {
    sourceBytes = await readFile(paths.sourceFile);
  } catch (error) {
    throw new BackgroundRemovalError(`无法读取 source_file：${error.message}`);
  }
  let source;
  try {
    source = decodePngRgba(sourceBytes);
  } catch (error) {
    throw new BackgroundRemovalError(`source_file 必须是可解码 PNG：${error.message}`);
  }

  const inputAlpha = countAlphaPixels(source.pixels);
  const sourceHasAlpha = pngHasAlphaChannel(sourceBytes);
  let processed;
  let method;
  let backgroundColor = null;
  let tolerance = null;
  let solidBackgroundCheck = null;
  if (reuseAlpha) {
    if (!hasTransparentPixels(source.pixels)) throw new BackgroundRemovalError("reuse_existing_alpha 要求输入包含透明像素");
    processed = { pixels: Buffer.from(source.pixels), removedPixels: 0 };
    method = "reuse-verified-alpha";
  } else {
    if (inputAlpha.opaque !== source.width * source.height) throw new BackgroundRemovalError("颜色阈值去背不接受含透明或半透明像素的输入；请保留真实 Alpha 或选择其他透明路线");
    backgroundColor = parseBackgroundColor(options.backgroundColor ?? options.background_color);
    tolerance = parseColorTolerance(options.tolerance);
    solidBackgroundCheck = inspectSolidBackground(source, backgroundColor, tolerance);
    // 颜色去背仅处理完全不透明且整圈边缘一致的硬边样例，防止阈值碰到半透明轮廓。
    if (solidBackgroundCheck.status !== "passed") {
      const reasons = [];
      if (!solidBackgroundCheck.opaque) reasons.push("输入必须完全不透明");
      if (solidBackgroundCheck.matched_boundary_pixels !== solidBackgroundCheck.boundary_pixels) reasons.push("画布边缘必须匹配指定背景色");
      throw new BackgroundRemovalError(`require_solid_background 检查失败：${reasons.join("；")}`);
    }
    processed = removeConnectedBackground(source, { backgroundColor, tolerance });
    method = "edge-connected-chroma-removal";
  }

  const outputAlpha = countAlphaPixels(processed.pixels);
  // 空白终态属于动画时间轴，只有显式的逐帧调用才允许保留；普通资产仍拒绝误删主体。
  if (outputAlpha.foreground === 0 && !allowEmptyForeground) throw new BackgroundRemovalError("去背会清除全部主体；拒绝生成空透明图，请重新确认硬边背景色与容差");
  const failures = validationFailures({ reuseAlpha, removedPixels: processed.removedPixels, foregroundPixels: outputAlpha.foreground, allowEmptyForeground });
  const status = failures.length === 0 ? "PASS" : "FAIL";
  const outputBytes = encodePngRgba(source.width, source.height, processed.pixels);
  const previewDirectory = options.previewDirectory ?? options.preview_directory ?? `${paths.outputFile}.previews`;
  // 预览目标覆盖任何受保护产物时，在主输出、预览图和记录写入前统一拒绝。
  await assertTransparencyPreviewPathsAvailable({ sourceFile: paths.outputFile, previewDirectory, reservedPaths: [paths.sourceFile, paths.recordFile].filter(Boolean) });
  await mkdir(dirname(paths.outputFile), { recursive: true });
  await writeFile(paths.outputFile, outputBytes);

  // 合法空帧由整段动画预览呈现，单张主体检查页要求可见前景，不能拿空帧冒充普通资产。
  const transparencyPreview = outputAlpha.foreground > 0
    ? await writeTransparencyPreviews({ sourceFile: paths.outputFile, previewDirectory, candidateSha256, reservedPaths: [paths.sourceFile, paths.recordFile].filter(Boolean) })
    : null;
  const completedAt = new Date().toISOString();
  const backgroundRemovalAttempt = reuseAlpha ? null : {
    operation: LOCAL_BACKGROUND_REMOVAL_OPERATION,
    status: status === "PASS" ? "completed" : "failed",
    source_file: paths.sourceFile,
    output_file: paths.outputFile,
    source_has_alpha: sourceHasAlpha,
    output_has_alpha: true,
    completed_at: completedAt,
    evidence: {
      schema: LOCAL_BACKGROUND_REMOVAL_SCHEMA,
      tool: LOCAL_BACKGROUND_REMOVAL_TOOL,
      tool_version: LOCAL_BACKGROUND_REMOVAL_TOOL_VERSION,
      source_sha256: sha256Bytes(sourceBytes),
      output_sha256: sha256Bytes(outputBytes),
      removed_pixels: processed.removedPixels,
      failures,
      parameters: {
        tolerance, edge_profile: edgeProfile, color_separation_verified: colorSeparationVerified,
        ...(allowEmptyForeground ? { allow_empty_foreground: true } : {}),
      },
      background_color: formatBackgroundColor(backgroundColor),
      tolerance,
      validation_status: status,
      ...(solidBackgroundCheck ? { solid_background_check: solidBackgroundCheck } : {}),
    },
  };
  const record = {
    schema: LOCAL_BACKGROUND_REMOVAL_SCHEMA,
    operation: reuseAlpha ? LOCAL_DIRECT_ALPHA_OPERATION : LOCAL_BACKGROUND_REMOVAL_OPERATION,
    status,
    failures,
    validation_status: status,
    method,
    ...(!reuseAlpha ? { tool: LOCAL_BACKGROUND_REMOVAL_TOOL, tool_version: LOCAL_BACKGROUND_REMOVAL_TOOL_VERSION } : {}),
    transparency_strategy: reuseAlpha ? LOCAL_DIRECT_ALPHA_OPERATION : LOCAL_BACKGROUND_REMOVAL_OPERATION,
    source_file: paths.sourceFile,
    source_sha256: sha256Bytes(sourceBytes),
    source_width: source.width,
    source_height: source.height,
    source_has_alpha: sourceHasAlpha,
    source_has_transparent_pixels: inputAlpha.transparent > 0,
    output_file: paths.outputFile,
    output_sha256: sha256Bytes(outputBytes),
    output_width: source.width,
    output_height: source.height,
    output_has_alpha: true,
    transparent_pixels: outputAlpha.transparent,
    foreground_pixels: outputAlpha.foreground,
    allow_empty_foreground: allowEmptyForeground,
    removed_pixels: processed.removedPixels,
    ...(!reuseAlpha ? {
      background_color: formatBackgroundColor(backgroundColor),
      tolerance,
      edge_profile: edgeProfile,
      color_separation_verified: colorSeparationVerified,
    } : {}),
    preserve_dimensions: true,
    normalization_required: true,
    completed_at: completedAt,
    limitation: "颜色阈值只适用于显式确认色彩分离的硬边主体；半透明、辉光、柔和阴影、毛发和玻璃应改走经验证的 Alpha、遮罩、重新生产或 Cocos 特效路线。",
    transparency_preview: { ...transparencyPreview, inspection: { status: "pending" } },
    ...(paths.recordFile ? { record_file: paths.recordFile } : {}),
    ...(backgroundRemovalAttempt ? { background_removal_attempt: backgroundRemovalAttempt } : {}),
    ...(solidBackgroundCheck ? { solid_background_check: solidBackgroundCheck } : {}),
  };
  if (paths.recordFile) {
    await mkdir(dirname(paths.recordFile), { recursive: true });
    await writeFile(paths.recordFile, `${JSON.stringify(record, null, 2)}\n`);
  }
  return record;
}

/** 从参数数组读取带值的 CLI 选项，并拒绝缺失值。 */
function readCliValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new BackgroundRemovalError(`${flag} 缺少参数值`);
  return value;
}

/** 运行 CLI；成功和像素验证失败都输出完整记录，参数错误输出稳定错误对象。 */
export async function runRemoveBackgroundCli(args = process.argv.slice(2), output = console) {
  if (args.includes("--help") || args.includes("-h")) {
    output.log("用法：node remove-background-local.mjs --source input.png --output output.png --background-color '#00aa55' --tolerance 24 --edge-profile hard-edge --color-separation-verified [--record record.json] [--preview-dir previews] [--candidate-sha256 sha256:…]");
    return 0;
  }
  try {
    const record = await removeBackgroundLocal({
      sourceFile: readCliValue(args, "--source"),
      outputFile: readCliValue(args, "--output"),
      backgroundColor: readCliValue(args, "--background-color"),
      tolerance: Number(readCliValue(args, "--tolerance")),
      edgeProfile: readCliValue(args, "--edge-profile"),
      colorSeparationVerified: args.includes("--color-separation-verified"),
      requireSolidBackground: args.includes("--require-solid-background") ? true : undefined,
      reuseExistingAlpha: args.includes("--reuse-alpha"),
      recordFile: readCliValue(args, "--record"),
      previewDirectory: readCliValue(args, "--preview-dir"),
      candidateSha256: readCliValue(args, "--candidate-sha256"),
    });
    output.log(JSON.stringify(record, null, 2));
    if (!record.transparency_preview.candidate_sha256) output.warn?.("透明预览未绑定 workflow candidate_sha256；输出可检查，但不能据此声称候选合同完整。");
    return record.status === "PASS" ? 0 : 1;
  } catch (error) {
    output.error(JSON.stringify({ schema: LOCAL_BACKGROUND_REMOVAL_SCHEMA, status: "FAIL", error: error.message }));
    return 1;
  }
}

/** 仅在直接执行脚本时启动 CLI；被测试或工作流导入时不产生副作用。 */
async function main() {
  const exitCode = await runRemoveBackgroundCli();
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
