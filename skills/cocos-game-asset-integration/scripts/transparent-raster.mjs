import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { decodePngRgba, encodePngRgba } from "./effect_image_raster.mjs";

/** 将 alpha<255 的像素视为透明信息，兼容纯透明与半透明边缘。 */
export function inspectTransparencyPixels(image) {
  if (!image || typeof image !== "object" || !Number.isInteger(image.width) || image.width <= 0
    || !Number.isInteger(image.height) || image.height <= 0 || !Buffer.isBuffer(image.pixels)
    || image.pixels.length !== image.width * image.height * 4) {
    throw new TypeError("image 必须包含正整数宽高和匹配尺寸的 RGBA Buffer");
  }

  let transparentPixels = 0;
  let partialAlphaPixels = 0;
  let visiblePixels = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < image.width * image.height; index += 1) {
    const alpha = image.pixels[index * 4 + 3];
    if (alpha < 255) transparentPixels += 1;
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
    if (alpha === 0) continue;
    visiblePixels += 1;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    transparent_pixels: transparentPixels,
    partial_alpha_pixels: partialAlphaPixels,
    visible_pixels: visiblePixels,
    bounds: maxX < 0 ? { x: 0, y: 0, width: 0, height: 0 } : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}

/** 以固定前缀记录预览和源图的真实字节身份。 */
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 按当前平台的路径大小写规则比较可能冲突的产物路径。 */
function samePath(left, right) {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === "win32" ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight;
}

/** 从候选文件名生成稳定的深浅底预览路径。 */
function previewPaths(sourceFile, previewDirectory) {
  if (typeof sourceFile !== "string" || sourceFile.trim() === "") throw new TypeError("sourceFile 必须是非空路径");
  if (typeof previewDirectory !== "string" || previewDirectory.trim() === "") throw new TypeError("previewDirectory 必须是非空路径");
  if (!/\.png$/i.test(sourceFile)) throw new TypeError("透明预览 sourceFile 必须是 PNG");
  const stem = basename(sourceFile, extname(sourceFile));
  return {
    directory: previewDirectory,
    light: join(previewDirectory, `${stem}.light.png`),
    dark: join(previewDirectory, `${stem}.dark.png`),
  };
}

/** 在写文件前检查预览彼此之间及调用方保留路径是否冲突。 */
export function assertTransparencyPreviewPathsSafe({ sourceFile, previewDirectory, reservedPaths = [] } = {}) {
  const paths = previewPaths(sourceFile, previewDirectory);
  if (!Array.isArray(reservedPaths) || reservedPaths.some((path) => typeof path !== "string" || path.trim() === "")) {
    throw new TypeError("reservedPaths 必须是非空字符串路径数组");
  }
  const pathsToProtect = [sourceFile, ...reservedPaths];
  for (const previewFile of [paths.light, paths.dark]) {
    if (pathsToProtect.some((protectedFile) => samePath(previewFile, protectedFile))) {
      throw new Error("透明预览路径不得覆盖源图、交付物、记录文件或另一张预览");
    }
  }
  if (samePath(paths.light, paths.dark)) throw new Error("深浅底预览不能写入同一路径");
  return { light: paths.light, dark: paths.dark };
}

/** 深浅预览已有文件也视为冲突，避免覆盖其他候选留下的可视证据。 */
export async function assertTransparencyPreviewPathsAvailable(options = {}) {
  const files = assertTransparencyPreviewPathsSafe(options);
  for (const file of [files.light, files.dark]) {
    try {
      await access(file);
      throw new Error(`透明预览文件已存在，拒绝覆盖：${file}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

/**
 * 读取实际 PNG Alpha 并生成深浅底检查图；可选候选摘要仅随输出记录。
 */
export async function writeTransparencyPreviews({ sourceFile, previewDirectory, candidateSha256, reservedPaths = [] } = {}) {
  const files = await assertTransparencyPreviewPathsAvailable({ sourceFile, previewDirectory, reservedPaths });
  const bytes = await readFile(sourceFile);
  const image = decodePngRgba(bytes);
  const stats = inspectTransparencyPixels(image);
  if (stats.visible_pixels === 0) throw new Error("透明预览源图没有可见主体像素");

  const backgrounds = {
    light: { color: [242, 233, 223], hex: "#F2E9DF" },
    dark: { color: [22, 32, 46], hex: "#16202E" },
  };
  // 将源 Alpha 用于深浅底合成；预览自身输出为不透明 PNG，便于人工检查边缘色差。
  const makeComposite = (background) => {
    const pixels = Buffer.alloc(image.pixels.length);
    for (let offset = 0; offset < image.pixels.length; offset += 4) {
      const alpha = image.pixels[offset + 3] / 255;
      pixels[offset] = Math.round(image.pixels[offset] * alpha + background[0] * (1 - alpha));
      pixels[offset + 1] = Math.round(image.pixels[offset + 1] * alpha + background[1] * (1 - alpha));
      pixels[offset + 2] = Math.round(image.pixels[offset + 2] * alpha + background[2] * (1 - alpha));
      pixels[offset + 3] = 255;
    }
    return pixels;
  };

  const lightBytes = encodePngRgba(image.width, image.height, makeComposite(backgrounds.light.color));
  const darkBytes = encodePngRgba(image.width, image.height, makeComposite(backgrounds.dark.color));
  await mkdir(dirname(files.light), { recursive: true });
  const createdFiles = [];
  try {
    await writeFile(files.light, lightBytes, { flag: "wx" });
    createdFiles.push(files.light);
    await writeFile(files.dark, darkBytes, { flag: "wx" });
    createdFiles.push(files.dark);
  } catch (error) {
    await Promise.all(createdFiles.map((file) => rm(file, { force: true })));
    throw error;
  }

  return {
    ...(candidateSha256 ? { candidate_sha256: candidateSha256 } : {}),
    source_file: sourceFile,
    source_sha256: sha256(bytes),
    light: { file: files.light, sha256: sha256(lightBytes), background_color: backgrounds.light.hex },
    dark: { file: files.dark, sha256: sha256(darkBytes), background_color: backgrounds.dark.hex },
  };
}
