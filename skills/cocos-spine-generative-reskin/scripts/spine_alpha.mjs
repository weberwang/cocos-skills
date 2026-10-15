import { ReskinError } from "./spine_atlas.mjs";

/** 统计透明结构的可见像素、包围盒和质心，供不同换皮模式复用。 */
function alphaStats(image) {
  let visible = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
    visible += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  return { visible, minX, minY, maxX, maxY, centroidX: visible ? sumX / visible : 0, centroidY: visible ? sumY / visible : 0 };
}

/** 在统一正向尺寸内计算 alpha IoU、掩码差异、包围盒漂移和质心漂移。 */
function compareAlphaMasks(reference, generated) {
  if (reference.width !== generated.width || reference.height !== generated.height) throw new ReskinError(`结构参考与生成图正向尺寸不一致：${reference.width},${reference.height} vs ${generated.width},${generated.height}`);
  let intersection = 0;
  let union = 0;
  let mismatched = 0;
  let alphaValueMismatched = 0;
  for (let index = 3; index < reference.data.length; index += 4) {
    const sourceVisible = reference.data[index] > 0;
    const generatedVisible = generated.data[index] > 0;
    if (sourceVisible && generatedVisible) intersection += 1;
    if (sourceVisible || generatedVisible) union += 1;
    if (sourceVisible !== generatedVisible) mismatched += 1;
    if (reference.data[index] !== generated.data[index]) alphaValueMismatched += 1;
  }
  const source = alphaStats(reference);
  const result = alphaStats(generated);
  const width = Math.max(1, reference.width);
  const height = Math.max(1, reference.height);
  const bboxDrift = source.visible && result.visible ? Math.max(Math.abs(source.minX - result.minX) / width, Math.abs(source.minY - result.minY) / height, Math.abs(source.maxX - result.maxX) / width, Math.abs(source.maxY - result.maxY) / height) : 1;
  const centroidDrift = source.visible && result.visible ? Math.max(Math.abs(source.centroidX - result.centroidX) / width, Math.abs(source.centroidY - result.centroidY) / height) : 1;
  return { mismatched, alphaValueMismatched, iou: union ? intersection / union : 1, bboxDrift, centroidDrift };
}

/** 创建 alpha 结构合同，严格区分 palette、Mesh 和显式放宽的 constrained-redraw。 */
export function createAlphaContract(thresholds) {
  return function assertAlphaContract(cell, reference, generated) {
    const metrics = compareAlphaMasks(reference, generated);
    if (cell.attachment_type === "mesh" && cell.alpha_lock !== true) throw new ReskinError(`Mesh Cell ${cell.id} 必须锁定 alpha`);
    if (cell.alpha_lock === true && metrics.alphaValueMismatched > 0) throw new ReskinError(`Cell ${cell.id} alpha_lock=true 但 Alpha 通道变化 ${metrics.alphaValueMismatched} 像素`);
    if (cell.mode === "palette-refresh" && metrics.mismatched > thresholds.palette_refresh_max_mask_mismatch) throw new ReskinError(`Cell ${cell.id} palette-refresh alpha 掩码不一致（${metrics.mismatched} 像素）`);
    if (cell.mode === "mesh-safe" && (metrics.iou < thresholds.mesh_safe_min_iou || metrics.bboxDrift > thresholds.mesh_safe_max_bbox_drift)) throw new ReskinError(`Cell ${cell.id} mesh-safe 结构重合不足（IoU=${metrics.iou.toFixed(3)}，包围范围漂移=${metrics.bboxDrift.toFixed(3)}）`);
    if (cell.mode === "constrained-redraw" && (metrics.iou < thresholds.constrained_redraw_min_iou || metrics.centroidDrift > thresholds.constrained_redraw_max_centroid_drift)) throw new ReskinError(`Cell ${cell.id} constrained-redraw 结构重合或方向稳定性不足（IoU=${metrics.iou.toFixed(3)}，质心漂移=${metrics.centroidDrift.toFixed(3)}）`);
  };
}
