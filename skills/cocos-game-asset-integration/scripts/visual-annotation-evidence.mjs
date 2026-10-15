import { decodePngRgba } from "./effect_image_raster.mjs";

/** 正式效果图标注只接受 PNG；该常量供资产门和 workflow-control 复用。 */
export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 判断值是否为普通对象，避免把数组或 null 当成标注元数据。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断字符串是否非空。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/**
 * 解码并校验正式标注 PNG 的完整结构和 metadata；不能只凭 8 字节魔数放行。
 * expectedBytes 用于文件门的确定性标准重建比较，传入后必须逐字节一致。
 */
export function validateFormalAnnotationPng(bytes, { label = "annotation_file", expectedBytes = null } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`${label} 必须是 PNG`);
  const decoded = decodePngRgba(bytes);
  const metadata = decoded.metadata;
  if (!isObject(metadata) || metadata.schema !== "effect-image-annotation/png/1" || metadata.layout !== "image-plus-right-panel") throw new Error(`${label} 缺少正式 PNG 标注元数据`);
  if (!Number.isInteger(metadata.original_width) || !Number.isInteger(metadata.original_height) || !Number.isInteger(metadata.panel_width) || metadata.original_width <= 0 || metadata.original_height <= 0 || metadata.panel_width <= 0) throw new Error(`${label} 标注尺寸元数据无效`);
  if (decoded.width !== metadata.original_width + metadata.panel_width || decoded.height !== metadata.output_height || metadata.panel_height !== decoded.height) throw new Error(`${label} 标注画布与右栏尺寸元数据不一致`);
  // 摘要仅作为 PNG 元数据中的可选记录，正式结构以尺寸和可见内容为准。
  if (metadata.panel_content_complete !== true || !Number.isInteger(metadata.visible_row_count) || !Array.isArray(metadata.visible_rows) || metadata.visible_row_count !== metadata.visible_rows.length) throw new Error(`${label} 右栏内容不完整或行数元数据无效`);
  if (!isObject(metadata.panel_content_bounds) || metadata.panel_content_bounds.x !== metadata.original_width || metadata.panel_content_bounds.width !== metadata.panel_width || metadata.panel_content_bounds.height !== decoded.height) throw new Error(`${label} 右栏边界元数据无效`);
  if (!Array.isArray(metadata.regions) || metadata.regions.length === 0) throw new Error(`${label} 缺少正式编号区域元数据`);
  if (expectedBytes !== null && (!Buffer.isBuffer(expectedBytes) || !bytes.equals(expectedBytes))) throw new Error(`${label} 与生成器标准 PNG 不一致`);
  return decoded;
}

/** 返回正式标注 PNG 的完整解码结果；供不希望捕获异常的预检调用。 */
export function decodeFormalAnnotationPng(bytes, options = {}) { return validateFormalAnnotationPng(bytes, options); }
