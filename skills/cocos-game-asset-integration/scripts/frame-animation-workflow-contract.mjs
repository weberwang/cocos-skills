#!/usr/bin/env node
/**
 * Cocos 视频抽帧图集的 accepted 文件合同。
 *
 * 文件门把提示词、源视频、抽帧报告、网页预览和最终图集绑定到同一资产，
 * 并验证报告参数、PNG 布局及 Cocos 帧范围彼此一致。
 */
import { readFile } from "node:fs/promises";
import {
  decodeText,
  finitePositive,
  isObject,
  isProjectRelativePath,
  nonEmptyString,
  readBoundArtifact,
  readPngDimensions,
  validateAnchor,
  validateArtifactBinding,
  validateCreatorContract,
  validatePreview,
  validateRegion,
  validateReportedAnchor,
  validateReportedArtifactPath,
  validateReportedRegion,
  validateSettings,
} from "./frame-atlas-contract-core.mjs";
import { validateCreatorResourcePlacement } from "./creator-resource-location.mjs";
import {
  IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA,
  checkImageFrameAnimationWorkflowFiles,
  validateImageFrameAnimationWorkflowContract,
} from "./image-frame-animation-workflow-contract.mjs";
export { isProjectRelativePath, sha256Bytes } from "./frame-atlas-contract-core.mjs";

/** 视频抽帧工作流 manifest 合同版本。 */
export const FRAME_ANIMATION_WORKFLOW_SCHEMA = "cocos-video-atlas-workflow/1";

/** Creator 接入清单替换旧假代码后的抽帧质量报告 schema。 */
export const FRAME_ANIMATION_REPORT_SCHEMA = "cocos-video-atlas/2";

/** accepted 合同必须绑定的五个文件，顺序用于稳定错误输出。 */
export const FRAME_ANIMATION_WORKFLOW_ARTIFACTS = Object.freeze([
  "video_prompt",
  "source_video",
  "quality_report",
  "preview",
  "spritesheet",
]);

/** 校验 accepted 资源的视频抽帧合同；不访问文件系统。 */
function validateVideoFrameAnimationWorkflowContract(value, options = {}) {
  const label = options.label ?? "asset.frame_animation";
  const errors = [];
  if (!isObject(value)) {
    errors.push(label + " 必须是对象");
    return errors;
  }
  if (value.schema !== FRAME_ANIMATION_WORKFLOW_SCHEMA) errors.push(label + ".schema 必须为 " + FRAME_ANIMATION_WORKFLOW_SCHEMA);
  if (value.status !== "accepted") errors.push(label + ".status 必须为 accepted");
  if (!nonEmptyString(value.work_item_id)) errors.push(label + ".work_item_id 必须是非空字符串");
  if (nonEmptyString(options.workItemId) && value.work_item_id !== options.workItemId) errors.push(label + ".work_item_id 必须绑定当前 workItemId");
  if (nonEmptyString(options.candidateVersion) && value.candidate_version !== options.candidateVersion) errors.push(label + ".candidate_version 必须绑定当前 candidateVersion");
  validateSettings(value.settings, label, errors);

  // 旧 manifest 若保留外部授权字段，仍必须明确保持未授权状态。
  const externalAuthorization = value.external_operation_authorized ?? value.external_operation_authorization;
  if (externalAuthorization !== undefined && ![false, "not-granted", "none"].includes(externalAuthorization)) {
    errors.push(label + ".external_operation_authorized 必须表示未授权");
  }
  for (const artifact of FRAME_ANIMATION_WORKFLOW_ARTIFACTS) {
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

/** 按 schema 路由 accepted 合同，保持现有入口供全局清单继续调用。 */
export function validateFrameAnimationWorkflowContract(value, options = {}) {
  if (value?.schema === IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA) {
    return validateImageFrameAnimationWorkflowContract(value, options);
  }
  return validateVideoFrameAnimationWorkflowContract(value, options);
}

/** 视频提示词允许纯文本或 JSON；JSON 扩展名必须包含有效 JSON。 */
function validateVideoPrompt(artifact, label, errors) {
  if (!artifact) return;
  const text = decodeText(artifact.bytes, label, errors);
  if (text === null || !artifact.file.toLowerCase().endsWith(".json")) return;
  try { JSON.parse(text); }
  catch (error) { errors.push(label + " JSON 格式无效：" + error.message); }
}

/** 检查抽帧报告的参数、帧序、图集文件和尺寸绑定。 */
function validateQualityReport(report, sheetArtifact, contract, asset, label, errors) {
  if (!isObject(report)) {
    errors.push(label + " 解析结果必须是普通 JSON 对象");
    return;
  }
  if (report.schema !== FRAME_ANIMATION_REPORT_SCHEMA) errors.push(label + ".schema 必须为 " + FRAME_ANIMATION_REPORT_SCHEMA);
  if (report.status !== "PASS") errors.push(label + ".status 必须为 PASS");

  const settings = contract.settings;
  const input = isObject(report.input) ? report.input : {};
  if (!nonEmptyString(input.video_path)) errors.push(label + ".input.video_path 必须是非空字符串");
  if (!finitePositive(input.fps)) errors.push(label + ".input.fps 必须是正有限数字");
  else if (finitePositive(settings?.fps) && input.fps !== settings.fps) errors.push(label + ".input.fps 必须等于 settings.fps");
  if (typeof input.remove_background !== "boolean") errors.push(label + ".input.remove_background 必须是布尔值");
  else if (typeof settings?.remove_background === "boolean" && input.remove_background !== settings.remove_background) {
    errors.push(label + ".input.remove_background 必须等于 settings.remove_background");
  }
  validateReportedRegion(report, settings, label, errors);

  const frames = report.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    errors.push(label + ".frames 必须至少包含一帧");
    return;
  }
  for (const [index, frame] of frames.entries()) {
    if (!isObject(frame)) {
      errors.push(label + ".frames[" + index + "] 必须是普通 JSON 对象");
      continue;
    }
    if (frame.index !== index) errors.push(label + ".frames[" + index + "].index 必须连续绑定为 " + index);
    if (typeof frame.source_timestamp !== "number" || !Number.isFinite(frame.source_timestamp) || frame.source_timestamp < 0) {
      errors.push(label + ".frames[" + index + "].source_timestamp 必须是非负有限秒数");
    }
    if (index > 0 && typeof frame.source_timestamp === "number" && typeof frames[index - 1]?.source_timestamp === "number"
      && frame.source_timestamp <= frames[index - 1].source_timestamp) {
      errors.push(label + ".frames.source_timestamp 必须严格递增");
    }
  }

  const cell = report.cell;
  if (!isObject(cell) || !Number.isInteger(cell.width) || cell.width <= 0 || !Number.isInteger(cell.height) || cell.height <= 0) {
    errors.push(label + ".cell 必须包含正整数 width/height");
  } else {
    if (Number.isInteger(settings?.width) && cell.width !== settings.width) errors.push(label + ".cell.width 必须等于 settings.width");
    if (Number.isInteger(settings?.height) && cell.height !== settings.height) errors.push(label + ".cell.height 必须等于 settings.height");
    const anchor = cell.target_anchor;
    if (!isObject(anchor) || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
      || anchor.x < 0 || anchor.x > cell.width || anchor.y < 0 || anchor.y > cell.height) {
      errors.push(label + ".cell.target_anchor 必须位于 cell 范围内");
    }
  }
  if (cell?.layout !== "horizontal") errors.push(label + ".cell.layout 必须为 horizontal");
  validateReportedAnchor(report, settings, label, errors);

  const reportedSheet = report.artifacts?.sheet;
  if (!isObject(reportedSheet) || !nonEmptyString(reportedSheet.file)) errors.push(label + ".artifacts.sheet.file 必须是非空字符串");
  if (!isObject(reportedSheet) || !Number.isInteger(reportedSheet.width) || reportedSheet.width <= 0
    || !Number.isInteger(reportedSheet.height) || reportedSheet.height <= 0) {
    errors.push(label + ".artifacts.sheet 必须包含正整数 width/height");
  }
  if (!nonEmptyString(report.artifacts?.preview?.file)) errors.push(label + ".artifacts.preview.file 必须是非空字符串");
  if (!nonEmptyString(report.artifacts?.report?.file)) errors.push(label + ".artifacts.report.file 必须是非空字符串");
  validateReportedArtifactPath(reportedSheet?.file, contract.spritesheet, label + ".artifacts.sheet.file", errors);
  validateReportedArtifactPath(report.artifacts?.preview?.file, contract.preview, label + ".artifacts.preview.file", errors);
  validateReportedArtifactPath(report.artifacts?.report?.file, contract.quality_report, label + ".artifacts.report.file", errors);

  const dimensions = readPngDimensions(sheetArtifact?.bytes);
  if (!dimensions) errors.push(label + " 绑定的 spritesheet 必须是有效 PNG");
  else {
    if (reportedSheet?.width !== dimensions.width || reportedSheet?.height !== dimensions.height) {
      errors.push(label + ".artifacts.sheet 尺寸与真实 PNG 不一致");
    }
    if (isObject(cell) && Number.isInteger(cell.width) && Number.isInteger(cell.height)
      && dimensions.width !== cell.width * frames.length) {
      errors.push(label + " spritesheet 宽度必须等于 cell.width 乘帧数");
    }
    if (isObject(cell) && Number.isInteger(cell.height) && dimensions.height !== cell.height) {
      errors.push(label + " spritesheet 高度必须等于 cell.height");
    }
  }
  validateCreatorContract(report, asset, contract.spritesheet, label, errors);
}

/** 校验 accepted 资源的五个绑定文件与抽帧报告内容。 */
async function checkVideoFrameAnimationWorkflowFiles(asset, context = {}) {
  const label = context.label ?? "asset.frame_animation";
  const errors = [];
  const contractErrors = validateFrameAnimationWorkflowContract(asset?.frame_animation, {
    label,
    workItemId: context.workItemId,
    candidateVersion: context.candidateVersion,
  });
  errors.push(...contractErrors);
  if (contractErrors.length > 0) return errors;

  const contract = asset.frame_animation;
  const artifacts = {};
  for (const key of FRAME_ANIMATION_WORKFLOW_ARTIFACTS) {
    artifacts[key] = await readBoundArtifact(contract[key], label + "." + key, context, errors);
  }
  validateVideoPrompt(artifacts.video_prompt, label + ".video_prompt", errors);
  validatePreview(artifacts.preview, artifacts.spritesheet, label + ".preview", errors);

  const reportArtifact = artifacts.quality_report;
  if (!reportArtifact) return [...new Set(errors)];
  let report;
  try { report = JSON.parse(reportArtifact.bytes.toString("utf8")); }
  catch (error) {
    errors.push(label + ".quality_report 必须是可解析 JSON：" + error.message);
    return [...new Set(errors)];
  }
  validateQualityReport(report, artifacts.spritesheet, contract, asset, label + ".quality_report", errors);
  return [...new Set(errors)];
}

/** 按 accepted schema 路由文件证据检查，不要求图片路线构造视频字段。 */
export async function checkFrameAnimationWorkflowFiles(asset, context = {}) {
  if (asset?.frame_animation?.schema === IMAGE_FRAME_ANIMATION_WORKFLOW_SCHEMA) {
    return checkImageFrameAnimationWorkflowFiles(asset, context);
  }
  return checkVideoFrameAnimationWorkflowFiles(asset, context);
}

/** 为现有调用方提供简短别名。 */
export const validateFrameAnimationContract = validateFrameAnimationWorkflowContract;
export const checkFrameAnimationFiles = checkFrameAnimationWorkflowFiles;
