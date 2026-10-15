/** 判断值是否为效果图生产合同会使用的对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断清单是否含有必须读取本地文件的 图像生成 合同。 */
export function hasImageGenerationRequired(manifest = {}) {
  const candidates = [
    ...(Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : []),
    ...(Array.isArray(manifest?.assets) ? manifest.assets : []),
    ...(Array.isArray(manifest?.production_contract_audit?.units) ? manifest.production_contract_audit.units : []),
  ];
  return candidates.some((item) => isObject(item) && (item.image_generation_required === true || item.production_method === "image-generation" || item.production_contract?.image_generation_required === true));
}

/** 判断 V3/V4 是否必须显式开启文件证据门。 */
export function requiresVisualFileGate(manifest = {}, stage = "V3") {
  const normalizedStage = String(stage).toUpperCase();
  if (!new Set(["V3", "V4"]).has(normalizedStage)) return false;
  return manifest?.effect_image_reconstruction?.applicability === "effect-image" || hasImageGenerationRequired(manifest);
}

/** 返回缺少 checkFiles/projectRoot 时的统一门禁错误；合法文件门返回空值。 */
export function productionFileGateError(manifest, options = {}, stage = "V3") {
  if (!requiresVisualFileGate(manifest, stage)) return "";
  if (options.checkFiles === true && typeof options.projectRoot === "string" && options.projectRoot.trim().length > 0) return "";
  return `[${String(stage).toUpperCase()}] effect-image 或 图像生成 生产校验必须显式使用 checkFiles=true 和 projectRoot；未读取本地源/运行时文件不得放行`;
}
