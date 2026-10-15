/**
 * 图像生成 尺寸归一化记录的纯合同校验器。
 *
 * 运行时转换由 visual-image-normalization.mjs 负责；本模块不加载 Sharp，
 * 这样 V3/V4 合同校验仍可在没有本地原图时审计结构化事实。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeProjectRelativePath } from "./visual-component-contract.mjs";

/** 归一化记录允许的完成状态。 */
export const IMAGE_NORMALIZATION_STATUS = Object.freeze(["passed"]);
/** 归一化记录允许的操作语义。 */
export const IMAGE_NORMALIZATION_OPERATIONS = Object.freeze(["resize-to-contract", "not-required", "crop-and-resize-to-contract"]);
/** 归一化记录的稳定版本，供生产证据和模板引用。 */
export const IMAGE_NORMALIZATION_SCHEMA = "image-normalization/1";
/** 比例修正记录的稳定版本，确保两次失败证据可被跨阶段复核。 */
export const IMAGE_ASPECT_RATIO_CORRECTION_SCHEMA = "aspect-ratio-correction/1";
/** 比例修正只能由两次目标比例失败触发。 */
export const IMAGE_ASPECT_RATIO_CORRECTION_TRIGGER = "two-generation-attempts-mismatched";
/** 当前 Sharp 工具唯一允许的比例修正策略。 */
export const IMAGE_ASPECT_RATIO_CORRECTION_STRATEGY = "controlled-crop";
/** 归一化最终输出允许的位图格式；透明目标会在下方进一步收紧为 PNG。 */
export const IMAGE_NORMALIZATION_OUTPUT_FORMATS = Object.freeze(["png", "jpeg"]);

/** 判断值是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含可审计内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断值是否为正整数，拒绝字符串和浮点数的隐式转换。 */
function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/** 校验与三份 JSON Schema date-time 一致的 RFC3339 时间。 */
function validDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** 判断焦点坐标是否为合同要求的有限单位区间数字。 */
function unitInterval(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** 使用整数最大公约数复算目标比例的最小整数单位。 */
function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

/** 将嵌套记录按键排序后序列化，避免 JSON 属性顺序造成假冲突。 */
function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** 摘要字段仅供追踪；复制的 normalization_record 以尺寸、路径和操作事实比较。 */
function withoutSummaryDigests(value) {
  if (Array.isArray(value)) return value.map(withoutSummaryDigests);
  if (!isObject(value)) return value;
  const pattern = /(^|[_-])(sha1|sha256|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/i;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !pattern.test(key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))).map(([key, item]) => [key, withoutSummaryDigests(item)]));
}

/** 将路径折叠为稳定比较值；合同路径仍由上游项目路径门负责安全校验。 */
function comparablePath(value) {
  if (!nonEmptyString(value)) return "";
  const normalized = normalizeProjectRelativePath(value);
  return (normalized || String(value).replaceAll("\\", "/").replace(/^\.\//, "")).replace(/\/$/, "");
}

/** 从交付路径解析稳定的 PNG/JPEG 格式名。 */
function outputFormat(value) {
  if (/\.png$/i.test(String(value ?? ""))) return "png";
  if (/\.(?:jpe?g)$/i.test(String(value ?? ""))) return "jpeg";
  return "";
}

/** 把 MIME 标识映射为归一化格式，供 expected asset 与最终文件互相核对。 */
function mimeFormat(value) {
  if (value === "image/png") return "png";
  if (value === "image/jpeg" || value === "image/jpg") return "jpeg";
  return "";
}

/** 从 snake_case/camelCase 记录中读取同义字段。 */
function field(value, snake, camel = snake) {
  if (!isObject(value)) return undefined;
  return value[snake] ?? value[camel];
}

/** 从资产或生成记录提取路径数组，供输出绑定检查复用。 */
function collectPaths(value, fields) {
  if (!isObject(value)) return [];
  return fields.flatMap((name) => {
    const item = value[name];
    return Array.isArray(item) ? item : [item];
  }).filter(nonEmptyString).map(comparablePath).filter(Boolean);
}

/** 返回一个生成记录和资产中声明的归一化记录，拒绝静默选择冲突副本。 */
export function getImageNormalizationRecords(asset = {}, generation = {}) {
  return [
    field(generation, "normalization_record", "normalizationRecord"),
    field(asset, "normalization_record", "normalizationRecord"),
  ].filter((value) => value !== undefined);
}

/** 读取当前资产的唯一归一化记录；没有记录时返回 null。 */
export function getImageNormalizationRecord(asset = {}, generation = {}) {
  return getImageNormalizationRecords(asset, generation).find(isObject) ?? null;
}

/** 比较重复记录的交付身份，不把属性书写顺序误判为事实冲突。 */
function sameNormalizationIdentity(left, right) {
  return ["schema", "status", "operation", "source_file", "source_width", "source_height", "target_width", "target_height", "output_file", "output_width", "output_height", "preserve_alpha", "tool", "tool_version", "completed_at"].every((name) => left[name] === right[name])
    && stableSerialize(withoutSummaryDigests(left.aspect_ratio_correction)) === stableSerialize(withoutSummaryDigests(right.aspect_ratio_correction));
}

/** 以交叉乘法比较两个正整数宽高比，避免浮点数舍入导致误放行。 */
export function sameImageAspectRatio(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(positiveInteger)) return false;
  return BigInt(sourceWidth) * BigInt(targetHeight) === BigInt(sourceHeight) * BigInt(targetWidth);
}

/** 为可选的真实文件门解析项目相对路径。 */
function resolveProjectFile(projectRoot, projectFile) {
  if (!nonEmptyString(projectRoot) || !nonEmptyString(projectFile)) return null;
  const normalized = normalizeProjectRelativePath(projectFile);
  return normalized ? resolve(projectRoot, ...normalized.split("/")) : null;
}

/** 从真实 PNG/JPEG 文件读取像素尺寸，供比例修正 attempt 的文件门复算。 */
function imageDimensions(projectRoot, projectFile) {
  const absolute = resolveProjectFile(projectRoot, projectFile);
  if (!absolute) return null;
  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return null;
  }
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    offset += segmentLength;
  }
  return null;
}

/** 对一个字段给出统一的合同错误，减少生产门中的重复分支。 */
function requireField(record, fieldName, errors) {
  if (field(record, fieldName) === undefined) errors.push(`normalization_record.${fieldName} 缺失`);
}

/** 判断当前生成记录是否经过背景移除，以绑定正确的原始生成文件。 */
function usesBackgroundRemovalRoute(generation = {}) {
  return field(generation, "transparency_strategy", "transparencyStrategy") === "background-removal";
}

/** 校验受控裁切记录，确保裁切来自两次真实比例失败而非伪造的尺寸转换。 */
function validateAspectRatioCorrection(record, expectedWidth, expectedHeight, errors, options, generation = {}) {
  const correction = record.aspect_ratio_correction;
  if (record.operation !== "crop-and-resize-to-contract") {
    if (correction !== undefined) errors.push("只有 crop-and-resize-to-contract 才能携带 aspect_ratio_correction");
    return;
  }
  if (!isObject(correction)) {
    errors.push("crop-and-resize-to-contract 必须携带 aspect_ratio_correction");
    return;
  }
  for (const name of ["schema", "status", "trigger", "strategy", "attempts", "focus", "crop_rect"]) {
    if (correction[name] === undefined) errors.push(`normalization_record.aspect_ratio_correction.${name} 缺失`);
  }
  if (correction.schema !== IMAGE_ASPECT_RATIO_CORRECTION_SCHEMA) errors.push(`aspect_ratio_correction.schema 必须为 ${IMAGE_ASPECT_RATIO_CORRECTION_SCHEMA}`);
  if (correction.status !== "passed") errors.push("aspect_ratio_correction.status 必须为 passed");
  if (correction.trigger !== IMAGE_ASPECT_RATIO_CORRECTION_TRIGGER) errors.push("aspect_ratio_correction.trigger 必须为 two-generation-attempts-mismatched");
  if (correction.strategy !== IMAGE_ASPECT_RATIO_CORRECTION_STRATEGY) errors.push("aspect_ratio_correction.strategy 必须为 controlled-crop");

  const attempts = correction.attempts;
  if (!Array.isArray(attempts) || attempts.length !== 2) {
    errors.push("aspect_ratio_correction.attempts 必须恰好包含两次真实 图像生成 attempt");
  } else {
    attempts.forEach((attempt, index) => {
      if (!isObject(attempt)) {
        errors.push(`aspect_ratio_correction.attempts[${index}] 必须是对象`);
        return;
      }
      const allowedAttemptFields = ["attempt_id", "generation_record_id", "generated_at", "file", "sha256", "width", "height"];
      const extraAttemptFields = Object.keys(attempt).filter((fieldName) => !allowedAttemptFields.includes(fieldName));
      if (extraAttemptFields.length) errors.push(`aspect_ratio_correction.attempts[${index}] 包含 Schema 禁止字段：${extraAttemptFields.join("、")}`);
      for (const name of ["attempt_id", "generation_record_id", "generated_at", "file", "width", "height"]) if (attempt[name] === undefined) errors.push(`aspect_ratio_correction.attempts[${index}].${name} 缺失`);
      if (!nonEmptyString(attempt.attempt_id)) errors.push(`aspect_ratio_correction.attempts[${index}].attempt_id 必须是非空字符串`);
      if (!nonEmptyString(attempt.generation_record_id)) errors.push(`aspect_ratio_correction.attempts[${index}].generation_record_id 必须是非空字符串`);
      if (!validDateTime(attempt.generated_at)) errors.push(`aspect_ratio_correction.attempts[${index}].generated_at 必须是 RFC3339 时间`);
      if (!nonEmptyString(attempt.file)) errors.push(`aspect_ratio_correction.attempts[${index}].file 必须是非空路径`);
      if (!positiveInteger(attempt.width) || !positiveInteger(attempt.height)) errors.push(`aspect_ratio_correction.attempts[${index}] 的 width/height 必须是正整数`);
      if (positiveInteger(attempt.width) && positiveInteger(attempt.height) && sameImageAspectRatio(attempt.width, attempt.height, expectedWidth, expectedHeight)) {
        errors.push(`aspect_ratio_correction.attempts[${index}] 不能与目标宽高比一致`);
      }
    });
    if (nonEmptyString(attempts[0]?.file) && nonEmptyString(attempts[1]?.file)
      && comparablePath(attempts[0].file) === comparablePath(attempts[1].file)) errors.push("两次 aspect_ratio_correction attempt 必须是不同的实际文件");
    if (nonEmptyString(attempts[0]?.attempt_id) && nonEmptyString(attempts[1]?.attempt_id)
      && attempts[0].attempt_id === attempts[1].attempt_id) errors.push("两次 aspect_ratio_correction attempt 的 attempt_id 必须唯一");
    if (nonEmptyString(attempts[0]?.generation_record_id) && nonEmptyString(attempts[1]?.generation_record_id)
      && attempts[0].generation_record_id === attempts[1].generation_record_id) errors.push("两次 aspect_ratio_correction attempt 的 generation_record_id 必须唯一");
    const secondAttemptPath = comparablePath(attempts[1]?.file);
    const normalizationSourcePath = comparablePath(record.source_file);
    const generationSourcePath = comparablePath(field(generation, "source_file", "sourceFile"));
    const generationRawSourcePath = comparablePath(field(generation, "raw_source_file", "rawSourceFile"));
    if (usesBackgroundRemovalRoute(generation)) {
      if (!generationRawSourcePath) {
        errors.push("透明背景移除路线必须提供 generation_record.raw_source_file，供第二次 raw 图像生成 attempt 绑定");
      } else if (secondAttemptPath !== generationRawSourcePath) {
        errors.push("透明背景移除路线的第二次 raw 图像生成 attempt 必须绑定 generation_record.raw_source_file");
      }
      // 去背输出是独立的 normalization source；这里仅通过尺寸绑定 raw attempt，不能要求路径或 SHA 相同。
    } else if (generationSourcePath) {
      if (secondAttemptPath !== generationSourcePath) errors.push("普通 图像生成 路线的第二次 raw 图像生成 attempt 必须绑定 generation_record.source_file");
    }
    if (positiveInteger(attempts[1]?.width) && attempts[1].width !== record.source_width) errors.push("第二次 raw 图像生成 attempt 的 width 必须与 normalization_record.source_width 一致");
    if (positiveInteger(attempts[1]?.height) && attempts[1].height !== record.source_height) errors.push("第二次 raw 图像生成 attempt 的 height 必须与 normalization_record.source_height 一致");
    if (options.checkFiles === true && options.projectRoot) {
      attempts.forEach((attempt, index) => {
        if (!isObject(attempt) || !nonEmptyString(attempt.file)) return;
        const actualDimensions = imageDimensions(options.projectRoot, attempt.file);
        if (!actualDimensions || actualDimensions.width !== attempt.width || actualDimensions.height !== attempt.height) errors.push(`aspect_ratio_correction.attempts[${index}] 的实际尺寸与记录不一致`);
      });
    }
  }

  const focus = correction.focus;
  if (!isObject(focus) || !unitInterval(focus.x) || !unitInterval(focus.y)) errors.push("aspect_ratio_correction.focus.x/focus.y 必须是 0 到 1 之间的有限数字");
  const cropRect = correction.crop_rect;
  if (!isObject(cropRect)) {
    errors.push("aspect_ratio_correction.crop_rect 必须是对象");
    return;
  }
  for (const name of ["left", "top", "width", "height"]) if (cropRect[name] === undefined) errors.push(`aspect_ratio_correction.crop_rect.${name} 缺失`);
  if (!Number.isInteger(cropRect.left) || cropRect.left < 0 || !Number.isInteger(cropRect.top) || cropRect.top < 0
    || !positiveInteger(cropRect.width) || !positiveInteger(cropRect.height)) errors.push("aspect_ratio_correction.crop_rect 必须使用非负整数位置和正整数尺寸");
  if (positiveInteger(record.source_width) && positiveInteger(record.source_height) && positiveInteger(cropRect.width) && positiveInteger(cropRect.height)) {
    const divisor = greatestCommonDivisor(expectedWidth, expectedHeight);
    const ratioWidth = expectedWidth / divisor;
    const ratioHeight = expectedHeight / divisor;
    const scale = Math.floor(Math.min(record.source_width / ratioWidth, record.source_height / ratioHeight));
    const expectedCrop = { width: ratioWidth * scale, height: ratioHeight * scale };
    if (!positiveInteger(scale) || cropRect.width !== expectedCrop.width || cropRect.height !== expectedCrop.height) errors.push("crop_rect 必须是源图内目标比例的最大整数矩形");
    if (cropRect.left + cropRect.width > record.source_width || cropRect.top + cropRect.height > record.source_height) errors.push("crop_rect 不得越过 normalization source 的边界");
    if (isObject(focus) && unitInterval(focus.x) && unitInterval(focus.y)) {
      const expectedLeft = Math.floor((record.source_width - expectedCrop.width) * focus.x);
      const expectedTop = Math.floor((record.source_height - expectedCrop.height) * focus.y);
      if (cropRect.left !== expectedLeft || cropRect.top !== expectedTop) errors.push("crop_rect 与 focus 不匹配");
    }
  }
}

/** 判断合同是否为 图像生成；普通 authored-raster/reuse 路线不受尺寸归一化门影响。 */
function isImageGenerationContract(contract = {}) {
  return contract?.production_method === "image-generation" || contract?.productionMethod === "image-generation"
    || contract?.image_generation_required === true || contract?.imageGenerationRequired === true;
}

/** 校验 图像生成 最终输出是否绑定到一次成功的 Sharp 尺寸归一化。 */
export function validateImageNormalizationContract({ asset = {}, contract = {}, generation = {}, expectedAsset, metadata = {}, options = {} } = {}) {
  if (!isImageGenerationContract(contract)) return [];
  const hasTargetWidth = expectedAsset?.width !== undefined;
  const hasTargetHeight = expectedAsset?.height !== undefined;
  // 没有尺寸合同的通用 图像生成 仍由原有输出门校验；一旦声明任一目标尺寸，就必须完整记录归一化。
  if (!hasTargetWidth && !hasTargetHeight && options.requireTarget !== true) return [];
  const errors = [];
  const expectedWidth = expectedAsset?.width;
  const expectedHeight = expectedAsset?.height;
  if (!positiveInteger(expectedWidth) || !positiveInteger(expectedHeight)) {
    errors.push("expected_assets.width/height 必须是归一化所需的正整数");
    return errors;
  }
  const records = getImageNormalizationRecords(asset, generation);
  if (records.length === 0) return ["图像生成 最终输出缺少 normalization_record，必须先完成尺寸归一化"];
  const record = records[0];
  if (!isObject(record)) return ["normalization_record 必须是对象，不能用字符串或空值代替结构化记录"];
  if (records.length > 1 && records.some((item) => !isObject(item) || !sameNormalizationIdentity(item, record))) errors.push("asset 与 generation_record 的 normalization_record 不一致");
  for (const name of ["schema", "status", "operation", "source_file", "source_width", "source_height", "target_width", "target_height", "output_file", "output_width", "output_height", "preserve_alpha", "tool", "tool_version", "completed_at"]) requireField(record, name, errors);
  if (record.schema !== IMAGE_NORMALIZATION_SCHEMA) errors.push(`normalization_record.schema 必须为 ${IMAGE_NORMALIZATION_SCHEMA}`);
  if (!IMAGE_NORMALIZATION_STATUS.includes(String(record.status ?? "").toLowerCase())) errors.push("normalization_record.status 必须为 passed");
  if (!IMAGE_NORMALIZATION_OPERATIONS.includes(record.operation)) errors.push("normalization_record.operation 只能为 resize-to-contract、not-required 或 crop-and-resize-to-contract");
  if (!nonEmptyString(record.source_file) || !nonEmptyString(record.output_file)) errors.push("normalization_record.source_file/output_file 必须是非空路径");
  if (comparablePath(record.source_file) && comparablePath(record.source_file) === comparablePath(record.output_file)) errors.push("normalization_record.source_file 与 output_file 不得指向同一路径");
  for (const name of ["source_width", "source_height", "target_width", "target_height", "output_width", "output_height"]) if (!positiveInteger(record[name])) errors.push(`normalization_record.${name} 必须是正整数`);
  if (positiveInteger(record.target_width) && record.target_width !== expectedWidth) errors.push("normalization_record.target_width 未匹配 expected_assets.width");
  if (positiveInteger(record.target_height) && record.target_height !== expectedHeight) errors.push("normalization_record.target_height 未匹配 expected_assets.height");
  if (positiveInteger(record.output_width) && record.output_width !== expectedWidth) errors.push("normalization_record.output_width 未匹配 expected_assets.width");
  if (positiveInteger(record.output_height) && record.output_height !== expectedHeight) errors.push("normalization_record.output_height 未匹配 expected_assets.height");
  const sourceMatchesTargetRatio = positiveInteger(record.source_width) && positiveInteger(record.source_height)
    && sameImageAspectRatio(record.source_width, record.source_height, expectedWidth, expectedHeight);
  if (positiveInteger(record.source_width) && positiveInteger(record.source_height) && !sourceMatchesTargetRatio
    && record.operation !== "crop-and-resize-to-contract") errors.push("原图与 expected_assets 宽高比不一致；必须提供两次生成失败证据后执行受控比例修正或完成生成式延展，禁止补边、contain 或拉伸变形");
  if (record.operation === "crop-and-resize-to-contract" && sourceMatchesTargetRatio) errors.push("crop-and-resize-to-contract 只能用于与 expected_assets 宽高比不一致的归一化输入");
  if (record.operation === "not-required" && (record.source_width !== expectedWidth || record.source_height !== expectedHeight)) errors.push("normalization_record.not-required 只能用于原图已满足目标尺寸的情况");
  if (record.operation === "resize-to-contract" && record.source_width === expectedWidth && record.source_height === expectedHeight) errors.push("原图尺寸已满足目标时 operation 必须为 not-required");
  validateAspectRatioCorrection(record, expectedWidth, expectedHeight, errors, options, generation);
  const outputFileFormat = outputFormat(record.output_file);
  if (!IMAGE_NORMALIZATION_OUTPUT_FORMATS.includes(outputFileFormat)) errors.push("归一化 output_file 必须是最终 PNG、JPG 或 JPEG");
  if (typeof record.preserve_alpha !== "boolean") errors.push("normalization_record.preserve_alpha 必须是布尔值");
  if (expectedAsset.alpha === true && record.preserve_alpha !== true) errors.push("透明 expected asset 必须声明 preserve_alpha=true");
  if (expectedAsset.alpha === true && metadata.alpha !== true) errors.push("透明 expected asset 的归一化最终输出必须保留 alpha");
  if (expectedAsset.alpha === true && outputFileFormat !== "png") errors.push("透明 expected asset 的归一化 output_file 必须是 PNG");
  if (expectedAsset.alpha !== true && record.preserve_alpha === true && outputFileFormat === "jpeg") errors.push("JPEG 归一化不能声称保留 Alpha");
  const expectedMimeFormat = mimeFormat(expectedAsset.mime_type);
  if (expectedMimeFormat && outputFileFormat && expectedMimeFormat !== outputFileFormat) errors.push("归一化 output_file 格式必须与 expected_assets.mime_type 一致");
  const metadataMimeFormat = mimeFormat(metadata.mime_type);
  if (metadata.mime_type !== undefined && !IMAGE_NORMALIZATION_OUTPUT_FORMATS.includes(metadataMimeFormat)) errors.push("归一化后的最终输出必须声明 image/png 或 image/jpeg");
  if (metadataMimeFormat && outputFileFormat && metadataMimeFormat !== outputFileFormat) errors.push("归一化 output_file 格式与最终输出 MIME 不一致");
  if (record.tool !== "sharp" || !nonEmptyString(record.tool_version)) errors.push("normalization_record.tool/tool_version 必须记录 Sharp 身份");
  if (!nonEmptyString(record.completed_at) || Number.isNaN(Date.parse(record.completed_at))) errors.push("normalization_record.completed_at 必须是有效时间");
  const expectedRuntime = comparablePath(field(expectedAsset, "runtime_file", "runtimeFile"));
  const expectedSource = comparablePath(field(expectedAsset, "source_file", "sourceFile"));
  const assetOutputs = collectPaths(asset, ["runtime_outputs", "runtimeOutputs", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "output_file", "outputFile", "file", "path"]);
  const generationOutputs = collectPaths(generation, ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "output_file", "outputFile", "file", "path"]);
  const assetSources = collectPaths(asset, ["source_file", "sourceFile", "source_files", "sourceFiles"]);
  const generationSources = collectPaths(generation, ["source_file", "sourceFile", "source_files", "sourceFiles"]);
  const outputPath = comparablePath(record.output_file);
  const sourcePath = comparablePath(record.source_file);
  if (expectedRuntime && outputPath !== expectedRuntime) errors.push("normalization_record.output_file 未匹配 expected_assets.runtime_file");
  if (expectedSource && sourcePath !== expectedSource) errors.push("normalization_record.source_file 未匹配 expected_assets.source_file");
  if (assetOutputs.length > 0 && !assetOutputs.includes(outputPath)) errors.push("manifest asset 的 runtime/output 路径未指向归一化后的 output_file");
  if (generationOutputs.length > 0 && !generationOutputs.includes(outputPath)) errors.push("generation_record 的 runtime/output 路径未指向归一化后的 output_file");
  if (assetSources.length > 0 && !assetSources.includes(sourcePath)) errors.push("manifest asset 的 source_file 未指向归一化记录 source_file");
  if (generationSources.length > 0 && !generationSources.includes(sourcePath)) errors.push("generation_record 的 source_file 未指向归一化记录 source_file");
  if (nonEmptyString(metadata.file) && comparablePath(metadata.file) !== outputPath) errors.push("实际输出 metadata.file 未指向归一化后的 output_file");
  if (metadata.width !== undefined && (metadata.width !== expectedWidth || metadata.height !== expectedHeight)) errors.push("最终实际输出宽高未匹配 expected_assets，必须交付归一化位图");
  if (options.checkFiles === true && options.projectRoot) {
    const actualSource = imageDimensions(options.projectRoot, record.source_file);
    const actualOutput = imageDimensions(options.projectRoot, record.output_file);
    if (!actualSource || actualSource.width !== record.source_width || actualSource.height !== record.source_height) errors.push("归一化 source_file 的实际尺寸与记录不一致");
    if (!actualOutput || actualOutput.width !== record.output_width || actualOutput.height !== record.output_height) errors.push("归一化 output_file 的实际尺寸与记录不一致");
  }
  return [...new Set(errors)];
}
