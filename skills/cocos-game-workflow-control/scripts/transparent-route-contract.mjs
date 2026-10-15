/** 透明路线资格、真实像素和深浅底消费证据共享门；不尝试智能抠图。 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { decodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { inspectTransparencyPixels } from "../../cocos-game-asset-integration/scripts/transparent-raster.mjs";
import { isPlainObject as isObject, nonEmptyString } from "./visual-contract-core.mjs";
import { safeProjectPath } from "./visual-runtime-evidence.mjs";

/** 根据可观察边缘冻结路线，语义名称和 alpha 通道声明不构成资格证明。 */
export const TRANSPARENT_EDGE_PROFILES = Object.freeze(["hard-edge", "semi-transparent", "glow", "soft-shadow", "hair", "glass", "mixed"]);
/** 路线变化须重新确认；真实 Alpha 和独立遮罩不能被自动改成颜色阈值去背。 */
export const TRANSPARENT_ROUTES = Object.freeze(["background-removal", "direct-alpha", "mask-composition"]);

/** 解码像素并统计透明和可见内容，不把通道存在误读为真实透明。 */
function alphaFacts(decoded) {
  const stats = inspectTransparencyPixels(decoded);
  return { transparent: stats.transparent_pixels, partial: stats.partial_alpha_pixels, visible: stats.visible_pixels };
}

/** 读取项目内 PNG 并解码真实像素；任意文件、目录或不可解码图片均失败关闭。 */
function readPng(file, options, errors, label) {
  const path = safeProjectPath(options.projectRoot, file);
  if (!path || !existsSync(path) || !statSync(path).isFile()) { errors.push(`${label} 文件不存在或路径越界`); return null; }
  try {
    const bytes = readFileSync(path);
    const decoded = decodePngRgba(bytes);
    return { ...decoded, ...alphaFacts(decoded) };
  } catch { errors.push(`${label} 必须是可解码真实 PNG`); return null; }
}

/** 校验能力声明与实际生成器身份，声明本身不取代后续输出解码。 */
function validateCapability(generation, errors) {
  const capability = generation.capability;
  if (!isObject(capability)) { errors.push("direct-alpha 缺少明确真实透明输出 capability，必须报告能力缺口"); return; }
  if (capability.supports_true_alpha !== true || capability.output_format !== "png" || !nonEmptyString(capability.evidence)) errors.push("direct-alpha capability 必须明确支持真实 Alpha PNG 并提供能力证据");
  if (!nonEmptyString(capability.tool) || !nonEmptyString(capability.tool_version) || capability.tool !== generation.generator || capability.tool_version !== generation.generator_version) errors.push("direct-alpha capability 必须绑定实际 generator/generator_version");
  if (!Array.isArray(capability.verified_edge_profiles) || !capability.verified_edge_profiles.includes(generation.edge_profile)) errors.push("direct-alpha 当前边缘特征缺少已验证能力，必须报告能力缺口");
}

/** 校验独立遮罩记录；遮罩不能是临时硬抠后丢失原始输入身份的旁路。 */
function validateMask(generation, options, errors) {
  const mask = generation.mask_record;
  if (!isObject(mask)) { errors.push("mask-composition 必须提供独立 mask_record"); return; }
  for (const field of ["source_file", "mask_file", "output_file", "tool", "tool_version", "evidence"]) if (!nonEmptyString(mask[field])) errors.push(`mask_record.${field} 缺失`);
  if (!isObject(mask.parameters)) errors.push("mask_record.parameters 必须记录实际参数");
  if (mask.source_file !== generation.raw_source_file || mask.output_file !== generation.source_file) errors.push("mask_record 输入/输出路径未绑定当前生成原图和透明中间产物");
  if (options.checkFiles === true && options.projectRoot) {
    readPng(mask.mask_file, options, errors, "独立遮罩");
    const rawPath = safeProjectPath(options.projectRoot, mask.source_file);
    try {
      if (!rawPath || !statSync(rawPath).isFile()) throw new Error("missing");
      readFileSync(rawPath);
    } catch { errors.push("独立遮罩原图不存在或路径越界"); }
  }
}

/** 验证按视觉事实选择的透明路线，以及只有去背路线可以声明的背景参数。 */
export function validateTransparencyRoute(generation, expectedAsset, options = {}) {
  const errors = [];
  const requirements = expectedAsset?.transparency_requirements;
  if (!isObject(generation.parameters) || !Array.isArray(generation.postprocess) || !generation.postprocess.every(nonEmptyString)) errors.push("透明生成必须记录实际 parameters 对象及 postprocess 数组（无后处理用空数组）");
  if (!isObject(requirements) || !TRANSPARENT_ROUTES.includes(requirements.strategy) || !TRANSPARENT_EDGE_PROFILES.includes(requirements.edge_profile)) errors.push("expected_assets.transparency_requirements 必须冻结透明路线与边缘类型");
  if (!TRANSPARENT_EDGE_PROFILES.includes(generation.edge_profile) || !nonEmptyString(generation.edge_evidence)) errors.push("透明生产必须记录 edge_profile 和可观察边缘 edge_evidence");
  if (requirements?.strategy !== generation.transparency_strategy || requirements?.edge_profile !== generation.edge_profile) errors.push("透明路线/边缘类型与已冻结 transparency_requirements 不一致，必须走明确变更流程");
  if (generation.source_has_alpha !== true || typeof generation.raw_source_has_alpha !== "boolean") errors.push("透明生产必须声明 raw_source_has_alpha 和 source_has_alpha=true，并由像素门复核");
  if (generation.transparency_strategy === "background-removal") {
    if (generation.source_background_mode !== "opaque") errors.push("background-removal source_background_mode 必须为 opaque");
    if (generation.edge_profile !== "hard-edge" || generation.color_separation_verified !== true) errors.push("颜色阈值去背只允许已证明主体背景可区分的 hard-edge；复杂透明边缘必须选择适合路线或阻断");
    if (generation.capability !== undefined || generation.mask_record !== undefined) errors.push("去背路线不得混入 direct-alpha capability 或独立遮罩记录");
    let tolerance;
    const attempts = Array.isArray(generation.background_removal_attempts) ? generation.background_removal_attempts : [];
    for (const attempt of attempts) {
      const record = attempt?.evidence;
      const parameters = record?.parameters;
      if (!nonEmptyString(record?.tool) || !nonEmptyString(record?.tool_version)) errors.push("去背尝试必须记录实际工具和版本");
      if (!isObject(parameters) || parameters.edge_profile !== "hard-edge" || parameters.color_separation_verified !== true || !Number.isFinite(parameters.tolerance) || parameters.tolerance < 0 || parameters.tolerance > 64) errors.push("去背尝试必须记录受控硬边参数，颜色容差不得超过 64");
      else { if (tolerance !== undefined && parameters.tolerance > tolerance) errors.push("去背失败后不得不断提高颜色容差损伤边缘，应报告能力缺口或变更路线"); tolerance = parameters.tolerance; }
    }
    const final = attempts.at(-1)?.evidence;
  } else {
    for (const field of ["source_background_color", "background_removal_attempts", "background_removal_max_attempts", "color_separation_verified"]) if (Object.hasOwn(generation, field)) errors.push(`${generation.transparency_strategy} 不得伪造去背字段 ${field}`);
    if (generation.transparency_strategy === "direct-alpha") {
      validateCapability(generation, errors);
      if (generation.source_background_mode !== "transparent" || generation.raw_source_file !== generation.source_file) errors.push("direct-alpha 必须以真实透明原图直接作为 source，不得伪造去背或后处理来源");
      if (generation.mask_record !== undefined) errors.push("direct-alpha 不得混入 mask_record");
    } else if (generation.transparency_strategy === "mask-composition") {
      if (!["opaque", "transparent"].includes(generation.source_background_mode)) errors.push("独立遮罩必须记录实际源图背景模式");
      if (generation.capability !== undefined) errors.push("mask-composition 不得冒充直接透明生成能力");
      validateMask(generation, options, errors);
    }
  }
  if (options.checkFiles === true && options.projectRoot) {
    const source = readPng(generation.source_file, options, errors, "透明 source");
    const output = readPng(expectedAsset.runtime_file, options, errors, "透明 runtime");
    if (source?.partial > 0 && output?.partial === 0) errors.push("透明归一化必须保留原图的真实半透明信息");
    const crop = generation.normalization_record?.aspect_ratio_correction?.crop_rect;
    if (source && crop) {
      // 外部工具的归一化记录也须复核完整主体，避免仅剩几粒半透明像素就放行。
      const bounds = inspectTransparencyPixels(source).bounds;
      if (![crop.left, crop.top, crop.width, crop.height].every(Number.isInteger) || (bounds && (crop.left > bounds.x || crop.top > bounds.y || crop.left + crop.width < bounds.x + bounds.width || crop.top + crop.height < bounds.y + bounds.height))) errors.push("透明归一化 crop_rect 不得裁掉任何可见主体或半透明边缘");
    }
    for (const image of [source, output].filter(Boolean)) {
      if (image.transparent === 0 || image.visible === 0) errors.push("透明路线必须解码出真实透明像素及可见主体；不透明/棋盘格和全透明 PNG 不合格");
      if (["semi-transparent", "glow", "soft-shadow", "glass", "mixed"].includes(generation.edge_profile) && image.partial === 0) errors.push("复杂透明边缘缺少真实半透明像素，不能删除光效或硬抠后交付");
    }
    if (generation.transparency_strategy === "background-removal") {
      const raw = readPng(generation.raw_source_file, options, errors, "去背原图");
      if (raw && raw.transparent > 0) errors.push("颜色去背原图必须实际不透明，不得破坏已有真实透明信息");
    }
  }
  return errors;
}

/** 预览绑定归一化最终输出及同一候选；视觉检查结果独立于 PNG 格式通过。 */
export function validateTransparencyPreview(generation, expectedAsset, options = {}) {
  const preview = generation.transparency_preview;
  if (!isObject(preview)) return ["所有透明路线必须提供 transparency_preview 深浅底预览和视觉检查状态"];
  const errors = [];
  const normalization = generation.normalization_record;
  if (preview.source_file !== expectedAsset.runtime_file || (nonEmptyString(normalization?.output_file) && preview.source_file !== normalization.output_file)) errors.push("transparency_preview 必须绑定归一化最终 runtime_file 路径");
  const runtime = options.checkFiles === true && options.projectRoot ? readPng(preview.source_file, options, errors, "预览源图") : null;
  for (const [mode, color] of [["light", "#F2E9DF"], ["dark", "#16202E"]]) {
    const entry = preview[mode];
    if (!isObject(entry) || !nonEmptyString(entry.file) || entry.background_color !== color) { errors.push(`transparency_preview.${mode} 必须记录 PNG 路径和指定底色`); continue; }
    const image = options.checkFiles === true && options.projectRoot ? readPng(entry.file, options, errors, `${mode} 预览`) : null;
    if (runtime && image) {
      const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      const expected = Buffer.alloc(runtime.pixels.length);
      for (let index = 0; index < expected.length; index += 4) { const alpha = runtime.pixels[index + 3] / 255; for (let channel = 0; channel < 3; channel++) expected[index + channel] = Math.round(runtime.pixels[index + channel] * alpha + rgb[channel] * (1 - alpha)); expected[index + 3] = 255; }
      if (image.width !== runtime.width || image.height !== runtime.height || !isDeepStrictEqual(image.pixels, expected)) errors.push(`${mode} 预览不是当前归一化候选的真实深浅底合成`);
    }
  }
  const inspection = preview.inspection;
  if (!isObject(inspection) || !["pending", "passed"].includes(inspection.status)) errors.push("透明预览必须记录独立 inspection，机器格式通过不能替代视觉检查");
  if (inspection?.status === "passed") {
    if (!nonEmptyString(inspection.evidence)) errors.push("透明视觉检查通过必须提供检查证据");
    for (const check of ["subject_integrity", "background_residue", "color_fringe", "semi_transparency"]) if (inspection.checks?.[check] !== "passed" && !(check === "semi_transparency" && generation.edge_profile === "hard-edge" && inspection.checks?.[check] === "not-applicable")) errors.push(`透明视觉检查 ${check} 未通过`);
  }
  if (String(options.stage).toUpperCase() === "V4" && inspection?.status !== "passed") errors.push("V4 透明素材尚未完成深浅底视觉验收，格式通过不得自动放行");
  return errors;
}
