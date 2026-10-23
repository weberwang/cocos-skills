import { resolve } from "node:path";
import {
  decodeText,
  finitePositive,
  isObject,
  isProjectRelativePath,
  nonEmptyString,
  readBoundArtifact,
  readPngDimensions,
  validateArtifactBinding,
  validateCreatorContract,
  validatePreview,
  validateReportedAnchor,
  validateReportedArtifactPath,
  validateReportedRegion,
  validateSettings,
} from "./frame-atlas-contract-core.mjs";
import { validateCreatorResourcePlacement } from "./creator-resource-location.mjs";
import { imageFrameTimeMatches, readImageFrameSource } from "../../cocos-frame-animation/scripts/image-frame-source.mjs";

/** 图片帧动画 accepted 工作流合同版本。 */
export const IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA = "cocos-image-atlas-workflow/1";

/** Creator 接入清单替换旧假代码后的图片图集报告版本。 */
export const IMAGE_FRAME_ANIMATION_REPORT_SCHEMA = "cocos-image-atlas/2";

/** 图片工作流必须绑定的文件；来源证据另由来源读取器递归复核。 */
export const IMAGE_FRAME_ANIMATION_WORKFLOW_ARTIFACTS = Object.freeze([
  "source_manifest",
  "quality_report",
  "preview",
  "spritesheet",
]);

/** 校验图片 accepted 合同静态结构；不读取本地文件。 */
export function validateImageFrameAnimationWorkflowContract(value, options = {}) {
  const label = options.label ?? "asset.frame_animation";
  const errors = [];
  if (!isObject(value)) {
    errors.push(label + " 必须是对象");
    return errors;
  }
  if (value.schema !== IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA) errors.push(label + ".schema 必须为 " + IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA);
  if (value.status !== "accepted") errors.push(label + ".status 必须为 accepted");
  if (!nonEmptyString(value.work_item_id)) errors.push(label + ".work_item_id 必须是非空字符串");
  if (!nonEmptyString(value.candidate_version)) errors.push(label + ".candidate_version 必须是非空字符串");
  if (nonEmptyString(options.workItemId) && value.work_item_id !== options.workItemId) errors.push(label + ".work_item_id 必须绑定当前 workItemId");
  if (nonEmptyString(options.candidateVersion) && value.candidate_version !== options.candidateVersion) errors.push(label + ".candidate_version 必须绑定当前 candidateVersion");
  validateSettings(value.settings, label, errors);
  if (isObject(value.settings) && Object.hasOwn(value.settings, "loop")) {
    errors.push(label + ".settings.loop 必须省略；循环事实只从 source_manifest 读取");
  }

  // 图片流程只声明已交付的静态证据；兼带视频字段会把不存在的视频来源混入合同。
  for (const field of ["video_prompt", "source_video"]) {
    if (Object.hasOwn(value, field)) errors.push(label + " 图片工作流不得包含视频字段 " + field);
  }
  const externalAuthorization = value.external_operation_authorized ?? value.external_operation_authorization;
  if (externalAuthorization !== undefined && ![false, "not-granted", "none"].includes(externalAuthorization)) {
    errors.push(label + ".external_operation_authorized 必须表示未授权");
  }
  for (const artifact of IMAGE_FRAME_ANIMATION_WORKFLOW_ARTIFACTS) {
    validateArtifactBinding(value[artifact], label + "." + artifact, errors);
  }
  if (isObject(value.spritesheet)) validateCreatorResourcePlacement(
    value.spritesheet.file,
    value.spritesheet.creator_resource_path,
    errors,
    label + ".spritesheet",
  );
  return [...new Set(errors)];
}

/** 比较来源与报告中的文件路径；摘要只作为可选说明保留。 */
function sameFileIdentity(actual, expected) {
  return isObject(actual) && isObject(expected)
    && actual.file === expected.file;
}

/** 按索引和路径比较每个父图快照，拒绝漏父图或错绑来源。 */
function sameParents(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
  return actual.every((parent, index) => isObject(parent) && isObject(expected[index])
    && parent.index === expected[index].index
    && parent.file === expected[index].file);
}

/** 检查报告设置和 accepted settings 完全绑定，避免参数只在报告中自行声明。 */
function validateReportedSettings(report, contract, label, errors) {
  const expected = contract.settings;
  const reported = report.settings;
  if (!isObject(reported)) {
    errors.push(label + ".settings 必须是普通对象");
    return;
  }
  for (const field of ["fps", "width", "height", "remove_background"]) {
    if (reported[field] !== expected?.[field]) errors.push(label + `.settings.${field} 必须等于 frame_animation.settings.${field}`);
  }
  for (const field of ["region", "anchor"]) {
    const actualGeometry = reported[field];
    const expectedGeometry = expected?.[field];
    const geometryFields = field === "region" ? ["x", "y", "width", "height"] : ["x", "y"];
    const sameGeometry = actualGeometry === undefined && expectedGeometry === undefined
      || isObject(actualGeometry) && isObject(expectedGeometry)
        && geometryFields.every((property) => actualGeometry[property] === expectedGeometry[property]);
    if (!sameGeometry) {
      errors.push(label + `.settings.${field} 必须等于 frame_animation.settings.${field}`);
    }
  }
}

/** 从来源清单复算播放槽位数，循环闭合参考不进入图集。 */
function playbackFrameCount(source, label, errors) {
  const count = Math.round(source.duration_ms * source.fps / 1000);
  if (!Number.isSafeInteger(count) || count < 2) {
    errors.push(label + " 来源的 duration_ms/fps 未形成至少两帧的安全播放时长");
    return null;
  }
  return count;
}

/** 校验图片报告与真实来源条目逐帧一致，闭合参考只供循环依赖使用。 */
function validateImageFrames(report, source, sourceFiles, contract, label, errors) {
  const expectedCount = playbackFrameCount(source, label, errors);
  const sourceFrames = Array.isArray(source.frames) ? source.frames : [];
  const byIndex = new Map(sourceFrames.filter((frame) => isObject(frame)).map((frame) => [frame.index, frame]));
  const expectedFrames = expectedCount === null ? [] : Array.from({ length: expectedCount }, (_, index) => byIndex.get(index));
  const frames = report.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    errors.push(label + ".frames 必须包含来源的播放帧");
    return;
  }
  if (expectedCount !== null && frames.length !== expectedCount) {
    errors.push(label + `.frames 数量必须为来源播放帧数 ${expectedCount}，循环闭合参考不进入图集`);
  }
  if (expectedCount !== null && expectedFrames.some((frame) => !frame)) {
    errors.push(label + " 来源清单缺少播放槽位");
    return;
  }

  frames.forEach((frame, position) => {
    if (!isObject(frame)) {
      errors.push(label + `.frames[${position}] 必须是普通 JSON 对象`);
      return;
    }
    if (Object.hasOwn(frame, "source_timestamp")) errors.push(label + `.frames[${position}] 图片来源不得声明 source_timestamp`);
    if (frame.index !== position) errors.push(label + `.frames[${position}].index 必须连续绑定为 ${position}`);
    const expected = expectedFrames[position];
    if (!expected) return;
    const expectedTime = position * 1000 / source.fps;
    if (!imageFrameTimeMatches(frame.game_time_ms, expectedTime)
      || !imageFrameTimeMatches(frame.game_time_ms, expected.game_time_ms)) {
      errors.push(label + `.frames[${position}].game_time_ms 必须绑定来源时间 ${expectedTime}`);
    }
    for (const field of ["source_image", "image", "generation_record"]) {
      if (!sameFileIdentity(frame[field], expected[field])) errors.push(label + `.frames[${position}].${field} 必须与来源清单条目一致`);
    }
    if (!sameParents(frame.parents, expected.parents)) errors.push(label + `.frames[${position}].parents 必须与来源清单中的真实父图快照一致`);
    const finalImage = sourceFiles.get(expected.image?.file);
    if (!Buffer.isBuffer(finalImage?.bytes)) {
      errors.push(label + `.frames[${position}] 的来源最终图必须有真实可读取字节`);
    }
    // 报告中的 frame.width/height 是缩放与留白后的最终 cell 尺寸，不是来源原图尺寸。
    if (frame.width !== contract.settings?.width || frame.height !== contract.settings?.height) {
      errors.push(label + `.frames[${position}].width/height 必须等于输出 cell 和 accepted settings 尺寸`);
    }
  });
  if (source.loop === true && expectedCount !== null) {
    const closure = byIndex.get(expectedCount);
    if (!closure || typeof closure.game_time_ms !== "number" || !Number.isFinite(closure.game_time_ms)
      || Math.abs(closure.game_time_ms - expectedCount * 1000 / source.fps) > 1e-6) {
      errors.push(label + " 循环来源必须保留 index=N 的闭合参考及真实闭合时间");
    }
    if (frames.some((frame) => frame?.index === expectedCount)) {
      errors.push(label + `.frames 不得包含循环闭合参考 index=${expectedCount}`);
    }
  }
}

/** 校验图片来源质量报告、图集身份、布局和 Cocos 播放证据。 */
function validateImageQualityReport(report, source, sourceFiles, sheetArtifact, contract, asset, label, errors) {
  if (!isObject(report)) {
    errors.push(label + " 解析结果必须是普通 JSON 对象");
    return;
  }
  if (report.schema !== IMAGE_FRAME_ANIMATION_REPORT_SCHEMA) errors.push(label + ".schema 必须为 " + IMAGE_FRAME_ANIMATION_REPORT_SCHEMA);
  if (report.status !== "PASS") errors.push(label + ".status 必须为 PASS");
  if (Object.hasOwn(report, "source_video") || Object.hasOwn(report, "video")) errors.push(label + " 图片报告不得声明视频来源字段");

  const input = isObject(report.input) ? report.input : {};
  for (const field of ["video_path", "source_video", "source_timestamp"]) {
    if (Object.hasOwn(input, field)) errors.push(label + `.input 图片来源不得声明视频字段 ${field}`);
  }
  if (!nonEmptyString(input.source_manifest_path)) errors.push(label + ".input.source_manifest_path 必须是非空字符串");
  else validateReportedArtifactPath(input.source_manifest_path, contract.source_manifest, label + ".input.source_manifest_path", errors);
  if (!finitePositive(input.fps)) errors.push(label + ".input.fps 必须是正有限数字");
  else if (input.fps !== source.fps || input.fps !== contract.settings?.fps) errors.push(label + ".input.fps 必须同时绑定来源 fps 与 settings.fps");
  if (input.display_width !== source.canvas?.width || input.display_height !== source.canvas?.height) {
    errors.push(label + ".input.display_width/display_height 必须等于真实来源 canvas 尺寸");
  }
  if (typeof input.remove_background !== "boolean") errors.push(label + ".input.remove_background 必须是布尔值");
  else if (input.remove_background !== contract.settings?.remove_background) errors.push(label + ".input.remove_background 必须等于 settings.remove_background");
  validateReportedSettings(report, contract, label, errors);
  validateReportedRegion(report, contract.settings, label, errors);
  validateReportedAnchor(report, contract.settings, label, errors);
  validateImageFrames(report, source, sourceFiles, contract, label, errors);

  const cell = report.cell;
  if (!isObject(cell) || !Number.isInteger(cell.width) || cell.width <= 0 || !Number.isInteger(cell.height) || cell.height <= 0) {
    errors.push(label + ".cell 必须包含正整数 width/height");
  } else {
    if (cell.width !== contract.settings?.width) errors.push(label + ".cell.width 必须等于 settings.width");
    if (cell.height !== contract.settings?.height) errors.push(label + ".cell.height 必须等于 settings.height");
    if (!isObject(cell.target_anchor) || !Number.isFinite(cell.target_anchor.x) || !Number.isFinite(cell.target_anchor.y)
      || cell.target_anchor.x < 0 || cell.target_anchor.x > cell.width || cell.target_anchor.y < 0 || cell.target_anchor.y > cell.height) {
      errors.push(label + ".cell.target_anchor 必须位于 cell 范围内");
    }
    if (Number.isInteger(cell.frame_count) && cell.frame_count !== report.frames?.length) errors.push(label + ".cell.frame_count 必须等于报告播放帧数");
  }
  if (cell?.layout !== "horizontal") errors.push(label + ".cell.layout 必须为 horizontal");

  const animation = isObject(report.animation) ? report.animation : {};
  if (typeof source.loop !== "boolean") errors.push(label + " 来源 loop 必须是布尔值");
  else if (animation.loop !== source.loop) errors.push(label + ".animation.loop 必须等于真实来源 loop");
  if (!isObject(report.artifacts?.sheet) || !nonEmptyString(report.artifacts.sheet.file)) errors.push(label + ".artifacts.sheet.file 必须是非空字符串");
  if (!isObject(report.artifacts?.sheet) || !Number.isInteger(report.artifacts.sheet.width) || report.artifacts.sheet.width <= 0
    || !Number.isInteger(report.artifacts.sheet.height) || report.artifacts.sheet.height <= 0) {
    errors.push(label + ".artifacts.sheet 必须包含正整数 width/height");
  }
  if (!nonEmptyString(report.artifacts?.preview?.file)) errors.push(label + ".artifacts.preview.file 必须是非空字符串");
  if (!nonEmptyString(report.artifacts?.report?.file)) errors.push(label + ".artifacts.report.file 必须是非空字符串");
  validateReportedArtifactPath(report.artifacts?.sheet?.file, contract.spritesheet, label + ".artifacts.sheet.file", errors);
  validateReportedArtifactPath(report.artifacts?.preview?.file, contract.preview, label + ".artifacts.preview.file", errors);
  validateReportedArtifactPath(report.artifacts?.report?.file, contract.quality_report, label + ".artifacts.report.file", errors);

  const dimensions = readPngDimensions(sheetArtifact?.bytes);
  const frames = Array.isArray(report.frames) ? report.frames : [];
  if (!dimensions) errors.push(label + " 绑定的 spritesheet 必须是有效 PNG");
  else {
    if (report.artifacts?.sheet?.width !== dimensions.width || report.artifacts?.sheet?.height !== dimensions.height) {
      errors.push(label + ".artifacts.sheet 尺寸与真实 PNG 不一致");
    }
    if (isObject(cell) && Number.isInteger(cell.width) && Number.isInteger(cell.height)
      && dimensions.width !== cell.width * frames.length) {
      errors.push(label + " spritesheet 宽度必须等于 cell.width 乘播放帧数");
    }
    if (isObject(cell) && Number.isInteger(cell.height) && dimensions.height !== cell.height) {
      errors.push(label + " spritesheet 高度必须等于 cell.height");
    }
  }
  validateCreatorContract(report, asset, contract.spritesheet, label, errors);
}

/** 使用明确项目根读取真实图片来源清单，递归复算图像与生成证据身份。 */
async function loadBoundImageSource(contract, context, label, errors) {
  if (!nonEmptyString(context.projectRoot)) {
    errors.push(label + " 图片来源文件门必须显式提供 projectRoot");
    return null;
  }
  const binding = contract.source_manifest;
  if (!isObject(binding) || !nonEmptyString(binding.file) || !isProjectRelativePath(binding.file)) return null;
  try {
    // 全局清单入口传入 projectPath，它额外检查 symlink/junction；直接调用时由来源读取器复核真实路径。
    const manifestPath = context.resolvePath
      ? context.resolvePath(binding.file)
      : resolve(context.projectRoot, binding.file);
    const loaded = await readImageFrameSource(manifestPath, { projectRoot: context.projectRoot });
    return loaded;
  } catch (error) {
    errors.push(label + ".source_manifest：" + (error?.message ?? String(error)));
    return null;
  }
}

/** 校验图片 accepted 资源的来源清单、质量报告、预览和图集文件。 */
export async function checkImageFrameAnimationWorkflowFiles(asset, context = {}) {
  const label = context.label ?? "asset.frame_animation";
  const contract = asset?.frame_animation;
  const errors = validateImageFrameAnimationWorkflowContract(contract, {
    label,
    workItemId: context.workItemId,
    candidateVersion: context.candidateVersion,
  });
  if (errors.length > 0) return errors;

  const source = await loadBoundImageSource(contract, context, label, errors);
  if (!source) return [...new Set(errors)];
  const artifacts = {};
  for (const key of ["quality_report", "preview", "spritesheet"]) {
    artifacts[key] = await readBoundArtifact(contract[key], label + "." + key, context, errors);
  }
  validatePreview(artifacts.preview, artifacts.spritesheet, label + ".preview", errors);

  if (!artifacts.quality_report) return [...new Set(errors)];
  const reportText = decodeText(artifacts.quality_report.bytes, label + ".quality_report", errors);
  if (reportText === null) return [...new Set(errors)];
  let report;
  try { report = JSON.parse(reportText); }
  catch (error) {
    errors.push(label + ".quality_report 必须是可解析 JSON：" + error.message);
    return [...new Set(errors)];
  }
  if (source) {
    validateImageQualityReport(report, source.source, source.files, artifacts.spritesheet,
      contract, asset, label + ".quality_report", errors);
  }
  return [...new Set(errors)];
}
