/**
 * 图像生成透明背景生产合同。
 *
 * 根据可观察边缘和已验证能力选择真实 Alpha、硬边去背或独立遮罩。
 * 复用既有透明图不属于生成路线，实际输出仍须解码和独立视觉检查。
 */

import { TRANSPARENT_EDGE_PROFILES, TRANSPARENT_ROUTES, validateTransparencyPreview, validateTransparencyRoute } from "./transparent-route-contract.mjs";

/** 记录实际源图背景，不能由最终透明需求反推生成器输出能力。 */
export const TRANSPARENT_SOURCE_BACKGROUND_MODES = Object.freeze(["opaque", "transparent"]);
/** 透明目标的最终交付背景模式。 */
export const TRANSPARENT_FINAL_BACKGROUND_MODE = "transparent";
/** 先生成不透明原图，再按需移除背景的透明生产策略。 */
export const TRANSPARENT_BACKGROUND_STRATEGY = "background-removal";
/** 透明目标策略白名单，禁止静默引入其它旁路。 */
export const TRANSPARENT_BACKGROUND_STRATEGIES = TRANSPARENT_ROUTES;
/** 结构化背景移除操作的稳定名称。 */
export const BACKGROUND_REMOVAL_OPERATION = "background-removal";
/** 背景移除最多保留的尝试数，允许失败历史但避免无界重试。 */
export const MAX_BACKGROUND_REMOVAL_ATTEMPTS = 3;
/** 生图阶段使用的默认源图背景颜色；实际变更后必须写回 generation_record。 */
export const DEFAULT_SOURCE_BACKGROUND_COLOR = "#00FF00";

const SOURCE_BACKGROUND_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;
const RGB_BACKGROUND_COLOR_PATTERN = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

/** 将 HEX 或 CSS RGB 颜色规范化为 generation_record 使用的 #RRGGBB。 */
export function normalizeSourceBackgroundColor(color = DEFAULT_SOURCE_BACKGROUND_COLOR) {
  if (typeof color !== "string") throw new TypeError("源图背景色必须是 #RRGGBB 或 rgb(r,g,b) 字符串");
  const value = color.trim();
  if (SOURCE_BACKGROUND_COLOR_PATTERN.test(value)) return value.toUpperCase();
  const match = value.match(RGB_BACKGROUND_COLOR_PATTERN);
  if (!match) throw new TypeError("源图背景色必须是 #RRGGBB 或 rgb(r,g,b) 字符串");
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) throw new TypeError("源图背景色 RGB 通道必须在 0 到 255 之间");
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** 判断颜色是否是生产记录要求的严格 #RRGGBB 格式。 */
function isSourceBackgroundColor(value) {
  return typeof value === "string" && SOURCE_BACKGROUND_COLOR_PATTERN.test(value);
}

/** 将规范化的 HEX 颜色转换为提示词中的 RGB 通道文本。 */
function sourceBackgroundColorToRgb(color) {
  const normalized = normalizeSourceBackgroundColor(color);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset + 1, offset + 3), 16)).join(", ");
}

/** 构建只描述源图不透明纯色背景的提示词，不绑定具体生图供应商或最终输出格式。 */
export function buildSolidBackgroundPrompt(color = DEFAULT_SOURCE_BACKGROUND_COLOR) {
  const normalized = normalizeSourceBackgroundColor(color);
  const rgb = sourceBackgroundColorToRgb(normalized);
  return [
    `背景要求：将参考图或 asset_prompt 中用于描述最终透明边界的区域，在本次原图中统一填充为不透明、无纹理的纯色平涂背景；指定颜色为 ${normalized}（RGB ${rgb}）。`,
    "主体必须完整落入画布并与画布边缘保持间隔；保持主体颜色、材质、光影和边缘形状不变，不把背景或背景阴影烘焙进主体。调用方应在发送提示词前选择与主体明显区分的指定纯色。",
    "背景必须整片均匀不透明；禁止棋盘格、网格、渐变、纹理、背景阴影、环境景物、边框、说明文字或色值文字。",
  ].join("\n");
}

/** 透明目标实际发送给生成器的源图背景要求；保留旧导出名供工作流入口统一引用。 */
export const TRANSPARENT_BACKGROUND_REMOVAL_PROMPT = buildSolidBackgroundPrompt();

const OUTPUT_PATH_FIELDS = ["raw_source_file", "rawSourceFile", "source_file", "sourceFile", "source_files", "sourceFiles", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs", "output_file", "outputFile"];
const FINAL_OUTPUT_PATH_FIELDS = OUTPUT_PATH_FIELDS.filter((field) => !["raw_source_file", "rawSourceFile"].includes(field));
const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g)$/i;
const PNG_FILE_PATTERN = /\.png$/i;

/** 判断值是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否有合同内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断当前 expected asset 是否要求透明图像生成生产。 */
export function requiresTransparentBackgroundProduction(expectedAsset, contract = {}) {
  return expectedAsset?.alpha === true && contract?.image_generation_required === true;
}

/** 判断生成记录是否声明背景移除生产策略。 */
export function isBackgroundRemovalProduction(generation = {}) {
  return generation?.transparency_strategy === TRANSPARENT_BACKGROUND_STRATEGY;
}

/** 收集所有输出路径，确保透明交付不绕过 PNG 合同。 */
function collectOutputPaths(value = {}, fields = OUTPUT_PATH_FIELDS) {
  if (!isObject(value)) return [];
  return fields.flatMap((field) => {
    const item = value[field];
    return Array.isArray(item) ? item : [item];
  }).filter(nonEmptyString);
}

/** 判断提示词是否包含指定色值、不透明纯色和棋盘格禁用要求。 */
export function expressesSolidBackgroundProduction(value, color = DEFAULT_SOURCE_BACKGROUND_COLOR) {
  if (!nonEmptyString(value) || !isSourceBackgroundColor(color)) return false;
  const text = value.toLowerCase();
  const normalized = color.toLowerCase();
  const forbidsCheckerPattern = /(?:禁止|不得|不要|请勿|不应|不可|严禁|no|without|do[ \t]+not|must[ \t]+not)[^。；;\n]{0,24}(?:棋盘格|网格|checker(?:board)?|grid)/i;
  return text.includes(normalized)
    && /不透明|opaque/.test(text)
    && /纯色|平涂|solid[ \t]+color/.test(text)
    && forbidsCheckerPattern.test(text);
}

/** 判断提示词是否满足背景移除生产所需的源图背景合同。 */
export function expressesBackgroundRemovalProduction(value, color = DEFAULT_SOURCE_BACKGROUND_COLOR) {
  return expressesSolidBackgroundProduction(value, color);
}

/** 直接透明提示必须请求真实透明信息并禁止烘焙棋盘底，实际能力仍由像素门证明。 */
export function expressesDirectAlphaProduction(value) {
  return nonEmptyString(value) && /(?:真实透明|真实\s*Alpha|true\s*alpha)/i.test(value)
    && /(?:禁止|不得|without|no)[^。；;\n]{0,24}(?:棋盘格|checkerboard)/i.test(value);
}

/** 判断 evidence 是否至少包含可追溯内容；空对象不能冒充审计事实。 */
function hasAuditableEvidence(value) {
  if (nonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.length > 0 && value.some(hasAuditableEvidence);
  if (isObject(value)) return Object.entries(value).some(([key, item]) => nonEmptyString(key) && hasAuditableEvidence(item));
  return false;
}

/** 比较两个路径，兼容相对路径、分隔符和 Windows 大小写差异。 */
function samePath(left, right) {
  if (!nonEmptyString(left) || !nonEmptyString(right)) return false;
  return left.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase() === right.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

/** 读取归一化记录，兼容 generation_record 和资产级的 snake/camel 字段。 */
function resolveNormalizationRecord(generation, asset) {
  return generation?.normalization_record
    ?? generation?.normalizationRecord
    ?? asset?.normalization_record
    ?? asset?.normalizationRecord;
}

/** 校验归一化输入与透明生产的当前 source_file 绑定。 */
function validateNormalizationBinding(normalizationRecord, sourceFile, expectedAsset) {
  const errors = [];
  if (!isObject(normalizationRecord)) {
    errors.push("透明图像生成必须提供 normalization_record，证明归一化输入绑定当前 source_file");
    return errors;
  }
  if (!samePath(normalizationRecord.source_file, sourceFile)) errors.push("normalization_record.source_file 必须绑定当前透明 generation_record.source_file");
  if (nonEmptyString(expectedAsset?.runtime_file) && !samePath(normalizationRecord.output_file, expectedAsset.runtime_file)) errors.push("normalization_record.output_file 必须绑定 expected_assets.runtime_file");
  return errors;
}

/** 校验单条背景移除历史记录的输入、输出、时间和可选纯色检查证据。 */
function validateBackgroundRemovalAttempt(attempt, index) {
  const label = `background_removal_attempts[${index}]`;
  const errors = [];
  if (!isObject(attempt)) return [`透明背景 ${label} 必须是对象`];
  if (attempt.operation !== BACKGROUND_REMOVAL_OPERATION) errors.push(`${label}.operation 必须为 ${BACKGROUND_REMOVAL_OPERATION}`);
  if (!["failed", "completed"].includes(attempt.status)) errors.push(`${label}.status 必须为 failed 或 completed`);
  if (!nonEmptyString(attempt.source_file)) errors.push(`${label}.source_file 缺失`);
  else if (!IMAGE_FILE_PATTERN.test(attempt.source_file)) errors.push(`${label}.source_file 必须使用 PNG/JPEG 文件`);
  if (!nonEmptyString(attempt.output_file)) errors.push(`${label}.output_file 缺失`);
  else if (!IMAGE_FILE_PATTERN.test(attempt.output_file)) errors.push(`${label}.output_file 必须使用 PNG/JPEG 文件`);
  if (samePath(attempt.source_file, attempt.output_file)) errors.push(`${label}.source_file 与 output_file 必须不同`);
  if (!nonEmptyString(attempt.completed_at) || Number.isNaN(Date.parse(attempt.completed_at))) errors.push(`${label}.completed_at 必须是有效时间`);
  if (!hasAuditableEvidence(attempt.evidence)) errors.push(`${label}.evidence 必须包含可审计事实`);
  if (typeof attempt.source_has_alpha !== "boolean") errors.push(`${label}.source_has_alpha 必须显式为布尔值`);
  if (typeof attempt.output_has_alpha !== "boolean") errors.push(`${label}.output_has_alpha 必须显式为布尔值`);
  if (attempt.status === "completed" && attempt.output_has_alpha !== true) errors.push(`${label}.output_has_alpha 必须为 true，成功输出必须含 Alpha`);
  return errors;
}

/** 读取任务允许的去背尝试上限；未声明时使用保守默认值。 */
function resolveBackgroundRemovalAttemptLimit(generation, contract) {
  const configured = generation.background_removal_max_attempts ?? contract?.background_removal_max_attempts;
  if (configured === undefined) return MAX_BACKGROUND_REMOVAL_ATTEMPTS;
  return Number.isInteger(configured) && configured >= 1 ? configured : null;
}

/** 严格校验脚本提供的纯色背景检查结果；字段缺失时不把记录当成通过。 */
function validateSolidBackgroundCheck(check, expectedColor, label) {
  const errors = [];
  if (!isObject(check)) return [`${label} 必须是对象`];
  if (check.status !== "passed") errors.push(`${label}.status 必须为 passed`);
  const backgroundColor = check.background_color;
  if (!isSourceBackgroundColor(backgroundColor)) errors.push(`${label}.background_color 必须是 #RRGGBB`);
  else if (expectedColor && normalizeSourceBackgroundColor(backgroundColor) !== expectedColor) errors.push(`${label}.background_color 必须与 generation_record.source_background_color 一致`);
  if (check.opaque !== true) errors.push(`${label}.opaque 必须为 true，源图必须完全不透明`);
  if (!Number.isInteger(check.boundary_pixels) || check.boundary_pixels < 1) errors.push(`${label}.boundary_pixels 必须是正整数`);
  if (!Number.isInteger(check.matched_boundary_pixels) || check.matched_boundary_pixels < 0) errors.push(`${label}.matched_boundary_pixels 必须是非负整数`);
  else if (Number.isInteger(check.boundary_pixels) && check.matched_boundary_pixels !== check.boundary_pixels) errors.push(`${label}.matched_boundary_pixels 必须等于 boundary_pixels`);
  return errors;
}

/** 校验有限次去背历史，并把最后一次成功输出绑定到当前 source_file 与归一化。 */
function validateBackgroundRemovalAttempts(generation, normalizationRecord, contract) {
  const attempts = generation.background_removal_attempts ?? generation.backgroundRemovalAttempts;
  if (!Array.isArray(attempts) || attempts.length < 1) return ["透明背景去背路线必须提供至少一条 background_removal_attempts，并记录最终成功结果"];
  const attemptLimit = resolveBackgroundRemovalAttemptLimit(generation, contract);
  if (attemptLimit === null) return ["background_removal_max_attempts 必须是正整数"];
  if (attempts.length > attemptLimit) return [`background_removal_attempts 最多允许 ${attemptLimit} 次，禁止无界重试`];
  const expectedColor = isSourceBackgroundColor(generation.source_background_color)
    ? normalizeSourceBackgroundColor(generation.source_background_color)
    : null;
  const errors = attempts.flatMap((attempt, index) => validateBackgroundRemovalAttempt(attempt, index));
  const finalIndex = attempts.length - 1;
  const finalAttempt = attempts[finalIndex];
  if (finalAttempt?.status !== "completed") errors.push("background_removal_attempts 必须以成功记录结束，失败或早期结果只能出现在此前");
  if (!samePath(finalAttempt?.source_file, generation.raw_source_file)) errors.push("最终 background_removal_attempts.source_file 必须绑定当前 generation_record.raw_source_file");
  if (typeof finalAttempt?.source_has_alpha === "boolean" && finalAttempt.source_has_alpha !== generation.raw_source_has_alpha) errors.push("最终 background_removal_attempts.source_has_alpha 必须与 generation_record.raw_source_has_alpha 一致");
  if (!samePath(finalAttempt?.output_file, generation.source_file)) errors.push("最终 background_removal_attempts.output_file 必须绑定当前 generation_record.source_file");
  if (!isObject(normalizationRecord) || !samePath(normalizationRecord.source_file, finalAttempt?.output_file)) errors.push("normalization_record.source_file 必须绑定最终背景移除输出");
  const evidenceColors = [finalAttempt?.evidence?.background_color].filter((color) => color !== undefined);
  for (const color of evidenceColors) {
    if (!isSourceBackgroundColor(color) || !expectedColor || normalizeSourceBackgroundColor(color) !== expectedColor) errors.push("最终 background_removal_attempts.evidence.background_color 必须与 generation_record.source_background_color 一致");
  }
  if (finalAttempt?.status === "completed") {
    if (finalAttempt?.evidence?.solid_background_check === undefined) errors.push("最终 background_removal_attempts.evidence 必须包含 solid_background_check");
    else errors.push(...validateSolidBackgroundCheck(finalAttempt.evidence.solid_background_check, expectedColor, "最终 background_removal_attempts.evidence.solid_background_check"));
  }
  return errors;
}

/** 校验按需去背路线，允许有限失败历史但只接受最后一次成功输出。 */
function validateBackgroundRemovalProduction(generation, normalizationRecord, contract) {
  const errors = [];
  if (typeof generation.raw_source_has_alpha !== "boolean") errors.push("background-removal generation_record.raw_source_has_alpha 必须显式为布尔值");
  if (generation.source_has_alpha !== true) errors.push("background-removal generation_record.source_has_alpha 必须为 true");
  const expectedColor = isSourceBackgroundColor(generation.source_background_color)
    ? normalizeSourceBackgroundColor(generation.source_background_color)
    : null;
  const generationChecks = [generation.solid_background_check].filter((check) => check !== undefined);
  generationChecks.forEach((check, index) => errors.push(...validateSolidBackgroundCheck(check, expectedColor, `generation_record.solid_background_check[${index}]`)));
  errors.push(...validateBackgroundRemovalAttempts(generation, normalizationRecord, contract));
  return errors;
}

/** 检查透明 expected asset 的 PNG 交付声明。 */
export function validateTransparentExpectedAssetContract(expectedAsset, contract = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  const requirements = expectedAsset.transparency_requirements;
  if (!isObject(requirements) || !TRANSPARENT_ROUTES.includes(requirements.strategy) || !TRANSPARENT_EDGE_PROFILES.includes(requirements.edge_profile)) errors.push("透明 expected_assets 必须冻结合法 transparency_requirements 策略和边缘类型");
  else if (requirements.strategy === "background-removal" && requirements.edge_profile !== "hard-edge") errors.push("透明 expected_assets 的颜色去背只能冻结 hard-edge，复杂边缘必须选择其他路线或报告能力缺口");
  if (expectedAsset.mime_type !== "image/png") errors.push("透明图像生成 expected_assets 必须声明 mime_type=image/png");
  for (const field of ["source_file", "runtime_file"]) if (!nonEmptyString(expectedAsset[field]) || !PNG_FILE_PATTERN.test(expectedAsset[field])) errors.push(`透明图像生成 expected_assets.${field} 必须使用非空 .png 文件`);
  if (nonEmptyString(expectedAsset.delivery_kind) && expectedAsset.delivery_kind !== "raster-image") errors.push("透明图像生成 expected_assets 必须使用 delivery_kind=raster-image");
  return errors;
}

/** 检查透明图像生成的背景模式、透明策略、源图身份和归一化绑定。 */
export function validateTransparentBackgroundProductionRecord(generation, expectedAsset, contract = {}, normalizationRecord = resolveNormalizationRecord(generation, null)) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (!isObject(generation)) return ["透明图像生成缺少 generation_record，无法证明透明生产"];
  if (!TRANSPARENT_SOURCE_BACKGROUND_MODES.includes(generation.source_background_mode)) errors.push("透明 source_background_mode 必须记录实际 opaque 或 transparent");
  if (generation.final_background_mode !== TRANSPARENT_FINAL_BACKGROUND_MODE) errors.push(`透明 generation_record.final_background_mode 必须为 ${TRANSPARENT_FINAL_BACKGROUND_MODE}`);
  if (Object.hasOwn(generation, "background_mode")) errors.push("透明生成禁止使用含义不明确的 background_mode，必须声明 source_background_mode/final_background_mode");
  if (!TRANSPARENT_BACKGROUND_STRATEGIES.includes(generation.transparency_strategy)) errors.push(`透明 generation_record.transparency_strategy 必须为 ${TRANSPARENT_BACKGROUND_STRATEGIES.join(" 或 ")}`);
  if (isBackgroundRemovalProduction(generation) && !isSourceBackgroundColor(generation.source_background_color)) errors.push("去背 generation_record.source_background_color 必须是 #RRGGBB");
  if (!nonEmptyString(generation.raw_source_file)) errors.push("透明 generation_record.raw_source_file 缺失");
  else if (!IMAGE_FILE_PATTERN.test(generation.raw_source_file)) errors.push("透明 generation_record.raw_source_file 必须使用 PNG/JPEG 文件");
  if (!nonEmptyString(generation.source_file)) errors.push("透明 generation_record.source_file 缺失");
  else if (!PNG_FILE_PATTERN.test(generation.source_file)) errors.push("透明 generation_record.source_file 必须使用 .png 文件");
  const promptEntries = [
    ["full_prompt", generation.full_prompt],
    ["actual_prompt", generation.actual_prompt],
    ["prompt_sent_text", generation.prompt_sent_text],
    ["sent_prompt", generation.sent_prompt],
    ["positive_prompt", generation.positive_prompt],
    ["prompt", generation.prompt],
  ].filter(([, value]) => nonEmptyString(value));
  if (promptEntries.length === 0) errors.push("透明图像生成必须记录实际路线的完整提示词");
  else if (isBackgroundRemovalProduction(generation) && isSourceBackgroundColor(generation.source_background_color)) {
    const expectedColor = normalizeSourceBackgroundColor(generation.source_background_color);
    for (const [field, prompt] of promptEntries) if (!expressesBackgroundRemovalProduction(prompt, expectedColor)) errors.push(`透明 generation_record.${field} 必须包含 ${expectedColor}、不透明纯色背景和棋盘格禁用要求`);
  }
  else if (generation.transparency_strategy === "direct-alpha") {
    for (const [field, prompt] of promptEntries) if (!expressesDirectAlphaProduction(prompt)) errors.push(`direct-alpha generation_record.${field} 必须请求真实 Alpha 并禁止烘焙棋盘格`);
  }
  if (Object.hasOwn(generation, "direct_generation_attempt") || Object.hasOwn(generation, "directGenerationAttempt")) errors.push("透明生产禁止使用 direct_generation_attempt 旧字段");
  if (isBackgroundRemovalProduction(generation)) errors.push(...validateBackgroundRemovalProduction(generation, normalizationRecord, contract));
  if (nonEmptyString(expectedAsset?.source_file) && !samePath(generation.source_file, expectedAsset.source_file)) errors.push("generation_record.source_file 必须绑定 expected_assets.source_file");
  errors.push(...validateNormalizationBinding(normalizationRecord, generation.source_file, expectedAsset));
  return errors;
}

/** 检查透明图像生成最终输出声明；实际 Alpha 仍需由文件门和图像解码复核。 */
export function validateTransparentOutputMetadata(metadata, expectedAsset, contract = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (metadata?.mime_type !== "image/png") errors.push("透明图像生成实际输出必须为 image/png，不能交付 JPEG");
  if (!nonEmptyString(metadata?.file) || !PNG_FILE_PATTERN.test(metadata.file)) errors.push("透明图像生成实际输出文件必须使用非空 .png 后缀");
  if (metadata?.alpha !== true) errors.push("透明图像生成输出必须声明 alpha=true");
  if (nonEmptyString(expectedAsset?.runtime_file) && !samePath(metadata?.file, expectedAsset.runtime_file)) errors.push("透明图像生成实际输出文件必须绑定 expected_assets.runtime_file");
  return errors;
}

/** 汇总透明 expected asset、生产记录、归一化记录和输出元数据的机器校验。 */
export function validateTransparentBackgroundContract({ asset, contract, generation, expectedAsset, metadata, options = {} } = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const normalizationRecord = resolveNormalizationRecord(generation, asset);
  const errors = [
    ...validateTransparentExpectedAssetContract(expectedAsset, contract),
    ...validateTransparentBackgroundProductionRecord(generation, expectedAsset, contract, normalizationRecord),
    ...validateTransparentOutputMetadata(metadata, expectedAsset, contract),
  ];
  if (isObject(generation)) {
    const routeRecord = { ...generation, normalization_record: normalizationRecord };
    errors.push(...validateTransparencyRoute(routeRecord, expectedAsset, options));
    errors.push(...validateTransparencyPreview(routeRecord, expectedAsset, options));
  }
  // 原始不透明中间图可以是 JPEG；透明生产的 source、归一化输出和运行时路径必须是 PNG。
  for (const path of [...collectOutputPaths(asset, FINAL_OUTPUT_PATH_FIELDS), ...collectOutputPaths(generation, FINAL_OUTPUT_PATH_FIELDS)]) if (!PNG_FILE_PATTERN.test(path)) errors.push("透明图像生成 source、去背输出、运行时文件和实际输出必须使用 .png 后缀");
  return [...new Set(errors)];
}
