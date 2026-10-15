import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve } from "node:path";
import sharp from "../../cocos-game-workflow-control/scripts/runtime/image-runtime.mjs";
import { ReskinError, field } from "./spine_atlas.mjs";

/** 将图片解码成不预乘的 RGBA 原始缓冲区。 */
export async function decodeRgba(path) {
  try {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: Buffer.from(data), width: info.width, height: info.height };
  } catch (error) {
    throw new ReskinError(`无法读取图片 ${path}：${error.message}`);
  }
}

/** 从 RGBA 原始缓冲区编码真实 PNG，避免扩展名与内容不一致。 */
export async function encodePng(image, path) {
  await mkdir(dirname(path), { recursive: true });
  // raw 输入绕开任何 alpha 合成路径，PMA 像素不会被第二次预乘。
  await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toFile(path);
}

/** 创建全透明 RGBA 图像。 */
export function blankRgba(width, height) { return { width, height, data: Buffer.alloc(width * height * 4) }; }

/** 复制矩形像素并严格检查边界。 */
export function cropRgba(image, left, top, width, height) {
  if (left < 0 || top < 0 || width < 0 || height < 0 || left + width > image.width || top + height > image.height) throw new ReskinError("图片裁剪范围越界");
  const output = blankRgba(width, height);
  for (let y = 0; y < height; y += 1) image.data.copy(output.data, y * width * 4, ((top + y) * image.width + left) * 4, ((top + y) * image.width + left + width) * 4);
  return output;
}

/** 按顺时针角度旋转 RGBA 图像，直接复制四通道像素。 */
export function rotateRgba(image, degrees) {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0) return { ...image, data: Buffer.from(image.data) };
  if (![90, 180, 270].includes(normalized)) throw new ReskinError(`不支持的旋转角度：${degrees}`);
  const width = normalized === 180 ? image.width : image.height;
  const height = normalized === 180 ? image.height : image.width;
  const output = blankRgba(width, height);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    let dx;
    let dy;
    if (normalized === 90) {
      dx = image.height - 1 - y;
      dy = x;
    } else if (normalized === 180) {
      dx = image.width - 1 - x;
      dy = image.height - 1 - y;
    } else {
      dx = y;
      dy = image.width - 1 - x;
    }
    image.data.copy(output.data, (dy * width + dx) * 4, (y * image.width + x) * 4, (y * image.width + x + 1) * 4);
  }
  return output;
}

/** 把源图直接粘贴到目标图，不执行 alpha 合成。 */
export function pasteRgba(target, source, left, top) {
  if (left < 0 || top < 0 || left + source.width > target.width || top + source.height > target.height) throw new ReskinError("图片粘贴范围越界");
  for (let y = 0; y < source.height; y += 1) source.data.copy(target.data, ((top + y) * target.width + left) * 4, y * source.width * 4, (y + 1) * source.width * 4);
}

/** 返回旋转 Cell 的正向尺寸。 */
function uprightSize(cell) { return [90, 270].includes(cell.rotate_degrees) ? [cell.size[1], cell.size[0]] : [...cell.size]; }

/** 判断 RGBA 图是否至少包含一个非透明像素。 */
export function hasVisibleAlpha(image) {
  for (let index = 3; index < image.data.length; index += 4) if (image.data[index] > 0) return true;
  return false;
}

/** 以生成边缘填充 padding 内指定 extrusion 范围，并校验完整尺寸旁路参数。 */
function extrudedCanvas(image, fullSize, padding, extrusion) {
  const [fullWidth, fullHeight] = fullSize;
  if (!Number.isInteger(padding) || !Number.isInteger(extrusion) || padding < 0 || extrusion < 0 || extrusion > padding) throw new ReskinError("extrusion 必须是 0 与 padding 之间的整数");
  // 完整尺寸图不能再扩张；非零参数直接失败，避免 padding/extrusion 看似成功但实际无效。
  if (image.width === fullWidth && image.height === fullHeight) {
    if (padding !== 0 || extrusion !== 0) throw new ReskinError("完整尺寸生成图不能使用非零 padding 或 extrusion；请提供 padding 后的核心尺寸");
    return { ...image, data: Buffer.from(image.data) };
  }
  const coreWidth = fullWidth - padding * 2;
  const coreHeight = fullHeight - padding * 2;
  if (padding <= 0 || coreWidth <= 0 || coreHeight <= 0 || image.width !== coreWidth || image.height !== coreHeight) throw new ReskinError(`生成图尺寸 ${image.width},${image.height} 不符合目标 ${fullWidth},${fullHeight} 或 padding 后尺寸 ${coreWidth},${coreHeight}`);
  const output = blankRgba(fullWidth, fullHeight);
  pasteRgba(output, image, padding, padding);
  if (extrusion === 0) return output;
  // 用钳制到核心边界的源坐标填充四边和四角，保证不引入源 Page 像素。
  for (let y = padding - extrusion; y < padding + image.height + extrusion; y += 1) for (let x = padding - extrusion; x < padding + image.width + extrusion; x += 1) {
    if (x >= padding && x < padding + image.width && y >= padding && y < padding + image.height) continue;
    const sx = Math.min(image.width - 1, Math.max(0, x - padding));
    const sy = Math.min(image.height - 1, Math.max(0, y - padding));
    image.data.copy(output.data, (y * fullWidth + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx + 1) * 4);
  }
  return output;
}

/** 按 alpha 对 RGB 恰好预乘一次。 */
function premultiply(image) {
  const output = { ...image, data: Buffer.from(image.data) };
  for (let index = 0; index < output.data.length; index += 4) {
    const alpha = output.data[index + 3];
    output.data[index] = Math.floor(output.data[index] * alpha / 255);
    output.data[index + 1] = Math.floor(output.data[index + 1] * alpha / 255);
    output.data[index + 2] = Math.floor(output.data[index + 2] * alpha / 255);
    if (alpha === 0) output.data.fill(0, index, index + 4);
  }
  return output;
}

/** 检查生成图是否符合 Cell 的 orig/trim/正向 size 结构合同。 */
export function validateCellImageDimensions(cell, image, padding = 0) {
  const [width, height] = uprightSize(cell);
  const fullSize = (image.width === cell.orig[0] && image.height === cell.orig[1]) || (image.width === width && image.height === height);
  if (fullSize && padding !== 0) throw new ReskinError(`Cell ${cell.id} 完整尺寸生成图不能使用非零 padding：请提供 padding 后的核心尺寸`);
  const valid = fullSize || (padding > 0 && image.width === width - padding * 2 && image.height === height - padding * 2);
  if (!valid) throw new ReskinError(`Cell ${cell.id} 生成图尺寸 ${image.width},${image.height} 不匹配 orig ${cell.orig.join(",")} 或正向 size ${width},${height}`);
}

/**
 * 将生成图归一化为与源 Cell 参考相同的正向裁剪结果，并保留 padding 前核心图。
 * 结构审阅必须比较同一坐标系，不能直接拿未裁剪的 orig 图与源 Region 比较。
 */
export function normalizeCellImage(cell, original, padding = 0, extrusion = 0) {
  const [width, height] = uprightSize(cell);
  validateCellImageDimensions(cell, original, padding);
  let source = original;
  let kind = "full";
  if (source.width === cell.orig[0] && source.height === cell.orig[1]) {
    const [originalWidth, originalHeight] = cell.orig;
    const [offsetX, offsetY] = cell.offset;
    const cropY = originalHeight - offsetY - height;
    if (offsetX < 0 || cropY < 0 || offsetX + width > originalWidth || cropY + height > originalHeight) throw new ReskinError(`Cell ${cell.id} 的 orig/offset 超出生成图范围`);
    source = cropRgba(source, offsetX, cropY, width, height);
    kind = "orig";
  } else if (padding > 0 && source.width === width - padding * 2 && source.height === height - padding * 2) {
    kind = "core";
  }
  return { image: extrudedCanvas(source, [width, height], padding, extrusion), coreImage: source, kind };
}

/** 按 orig/offset/trim/padding/rotate 约束准备 Cell 像素。 */
export function prepareCellImage(cell, original, padding, extrusion, page) {
  const [width, height] = uprightSize(cell);
  let output = normalizeCellImage(cell, original, padding, extrusion).image;
  const pma = String(field(page.fields ?? {}, "pma", "false")).trim().toLowerCase();
  if (["true", "1", "yes"].includes(pma)) output = premultiply(output);
  return rotateRgba(output, cell.rotate_degrees);
}

/** 从源 Page 导出只读 Cell 结构参考，并绑定源参考哈希。 */
export async function extractReferences(manifest, manifestPath, referenceDir, hashFile) {
  await mkdir(referenceDir, { recursive: true });
  const pages = new Map();
  for (const cell of manifest.cells) {
    if (!pages.has(cell.page_index)) {
      const page = manifest.atlas.pages[cell.page_index];
      pages.set(cell.page_index, await decodeRgba(resolve(dirname(manifest.atlas.path), page.name)));
    }
    const source = pages.get(cell.page_index);
    let image = cropRgba(source, cell.xy[0], cell.xy[1], cell.size[0], cell.size[1]);
    if (cell.rotate_degrees) image = rotateRgba(image, -cell.rotate_degrees);
    // 用稳定的 Page/Cell 序号和 ID 哈希命名，避免 a/b、a?b 等清洗后重名。
    const cellIndex = manifest.cells.indexOf(cell);
    const idHash = createHash("sha256").update(cell.id).digest("hex").slice(0, 12);
    const name = `p${String(cell.page_index).padStart(3, "0")}-c${String(cellIndex).padStart(5, "0")}-${idHash}.png`;
    const output = join(referenceDir, name);
    await encodePng(image, output);
    const rel = relative(dirname(manifestPath), output);
    cell.source_reference = rel.startsWith("..") ? resolve(output) : rel.replaceAll("\\", "/");
    cell.source_reference_sha256 = hashFile ? await hashFile(output) : createHash("sha256").update(await readFile(output)).digest("hex");
  }
}

/** 保留 Atlas Page 名称；非 PNG Page 不允许静默改名，必须在 init 阶段 fail closed。 */
export function outputPageName(page) {
  const name = page.name.replaceAll("\\", "/");
  if (extname(name).toLowerCase() !== ".png") throw new ReskinError(`Page ${name} 不是 PNG；为保持 Page 名不能静默改名`);
  return name;
}
