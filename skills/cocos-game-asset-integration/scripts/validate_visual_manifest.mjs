#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { validateAssetResourceLocations } from "./asset-resource-locations.mjs";
import { getVisualRegionDefinitionAliasConflicts, normalizeVisualRegionDefinition, PLAN_COLORS, PLAN_LABELS } from "./effect_image_annotation_core.mjs";
import { annotationProductionContract, decodePngRgba, deriveVisibleAnnotationRows } from "./effect_image_raster.mjs";
import { normalizeAtomicComponents } from "../../cocos-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { productionFileGateError } from "../../cocos-game-workflow-control/scripts/visual-file-gate.mjs";
import { buildVisualConfirmationAuthorityByRegion, validateVisualDecompositionConfirmations } from "../../cocos-game-workflow-control/scripts/visual-decomposition-confirmation.mjs";
import { validateReuseProductionGate } from "../../cocos-game-workflow-control/scripts/visual-confirmation-reuse-gates.mjs";
import { validateFormalAnnotationPng } from "./visual-annotation-evidence.mjs";
import { auditProductionContractByGroups, confirmationAuthorityBase, validateConfirmationGroups, validateImplementationPlan as validateImplementationPlanContract, validateManualConfirmationEvidence, validateReusePlanRelation, validateV4ProductionGateByGroups } from "./visual-manifest-confirmation.mjs";
import { atomicImageRequirementsEqual, auditProductionContract, deriveAtomicImageRequirements, manifestEvidenceIdentity, normalizeComponentExpectedAsset, normalizeProjectRelativePath, resolveOutputMetadata, resolveProductionContract, validateEvidenceIdentity, validateImageGenerationContract, validateProductionAuditShape, validateProductionMethodChangeRequest, validateProductionContract, validateTransparentBackgroundContract, validateVisualComponentContract, validateVisualProductionCoverage, validateV4ProductionGate } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";
import { validateVisualPostApprovalReviewFields } from "../../cocos-game-workflow-control/scripts/visual-human-review-contract.mjs";
import { validateSceneReconstructionGate, validateSceneReconstructionContract, validateStructuredFidelityCases } from "../../cocos-game-workflow-control/scripts/scene-reconstruction-contract.mjs";
import { resolveVisualValidationMode, validateVisualValidationPolicy, validateVisualManifestFidelityCases } from "../../cocos-game-workflow-control/scripts/visual-validation-policy.mjs";
import { GLOBAL_VISUAL_BASELINE_DOCUMENT, validateGlobalVisualBaseline, validateVisualEffectImageOrigin } from "../../cocos-game-workflow-control/scripts/global-visual-consistency-contract.mjs";
import { checkManifestFileEvidence, collectManifestFileEvidenceEntries } from "./global-visual-file-gate.mjs";
import { validateImageGenerationSizeManifest } from "../../cocos-game-workflow-control/scripts/visual-generation-size-contract.mjs";
import { isWorkflowDpr, workflowDprError } from "../../cocos-game-workflow-control/scripts/workflow-dpr-contract.mjs";
import { VISUAL_STAGE_IDS, VISUAL_STAGE_STATES } from "../../cocos-game-workflow-control/scripts/visual-stage-prerequisites.mjs";
import { validateEffectImageLayoutBindings, validatePngLayoutMetadata, validateTechnicalLayoutNodeIds, validateTechnicalRegionLayout, validateV4LayoutMeasurements } from "./validate_visual_layout_mapping.mjs";
import { checkFrameAnimationWorkflowFiles, validateFrameAnimationWorkflowContract } from "./frame-animation-workflow-contract.mjs";
export { computeRegionDefinitionSha256 } from "./effect_image_annotation_core.mjs";
export { atomicImageRequirementsEqual, auditProductionContract, deriveAtomicImageRequirements, manifestEvidenceIdentity, normalizeComponentExpectedAsset, normalizeProjectRelativePath, resolveOutputMetadata, resolveProductionContract, validateEvidenceIdentity, validateImageGenerationContract, validateProductionAuditShape, validateProductionMethodChangeRequest, validateProductionContract, validateVisualComponentContract, validateVisualProductionCoverage, validateV4ProductionGate } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";
export { validateSceneReconstructionGate, validateSceneReconstructionContract, validateStructuredFidelityCases } from "../../cocos-game-workflow-control/scripts/scene-reconstruction-contract.mjs";
export { calculateComponentDisplaySize, validateImageGenerationSizeContract, validateImageGenerationSizeManifest } from "../../cocos-game-workflow-control/scripts/visual-generation-size-contract.mjs";

export const ALLOWED_ROUTES = new Set(["ui-icon-font", "pixel-art", "frame-animation", "skeletal-animation", "scene-tilemap", "vfx-particle-shader", "decorative-full-bleed", "gameplay-environment", "ai-composite-raster"]);
export const ALLOWED_STATUSES = new Set(["planned", "producing", "review", "accepted", "rejected", "replaced"]);
const BASELINE_BOUND_STATUSES = new Set(["producing", "review", "accepted"]);
const SCHEMA_VERSION = "1.5";
// runtime-program 是实现方式，不是免除视觉责任的 owner 类型；它必须继续回填完整场景事实。
const COVERAGE_OWNER_TYPES = new Set(["runtime-program", "runtime-data", "runtime-rendered", "fixed-production-visual"]);
const PRODUCTION_ORIGINS = new Set(["bitmap-decomposition", "independent-production"]);
const RECONCILIATION_DOMAINS = new Set(["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"]);
const AI_REQUIRED_TEXT_FIELDS = ["global_prompt_prefix", "asset_prompt", "state_prompt", "negative_prompt", "model", "model_version"];
const REQUIRED_BUDGETS = new Set(["max_texture_size", "texture_memory_mb", "max_atlases", "max_frames", "animation_sample_fps", "max_overdraw", "max_draw_calls"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** 表示清单无法解析或不满足最低结构约束。 */
export class ManifestValidationError extends Error {}

/** 判断值是否为去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断路径是否试图把当前机器权威清单当作历史复用快照。 */
function isCurrentVisualAssetsManifest(value) { return nonEmptyString(value) && basename(value.replace(/\\/g, "/")).toLowerCase() === "visual-assets.json"; }

/** 验证证据字段是非空项目内路径列表。 */
function validatePathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) errors.push(`${label} 必须是非空路径列表`);
}

/** 计算 PNG chunk 的 CRC-32，拒绝被篡改的编号图证据。 */
function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 验证冻结效果图身份；冻结前候选不允许进入正式清单。 */
function validateReferenceTarget(target, errors, baseline = null) {
  if (!isObject(target)) { errors.push("reference_target 必须是对象"); return null; }
  for (const field of ["candidate_id", "original_file", "frozen_at"]) if (!nonEmptyString(target[field])) errors.push(`reference_target.${field} 必须是非空字符串`);
  if (nonEmptyString(target.frozen_at) && Number.isNaN(Date.parse(target.frozen_at))) errors.push("reference_target.frozen_at 必须是可解析时间");
  if (target.status !== "reference-target-frozen") errors.push("reference_target.status 必须为 reference-target-frozen；裸 frozen 不代表 V2");
  for (const field of ["scene_ids", "state_ids"]) if (!Array.isArray(target[field]) || target[field].length === 0 || !target[field].every(nonEmptyString)) errors.push(`reference_target.${field} 必须是非空字符串列表`);
  // 外部提供的冻结图只记录 provided 身份；只有真正由生成器产出的目标才能声明生成记录。
  errors.push(...validateVisualEffectImageOrigin(target, { label: "reference_target", visual_baseline: baseline, target_sha256: target.target_sha256, output_sha256: target.target_sha256 }));
  return target;
}

/** 验证 V2 冻结后、V3 前的合同回对门。 */
function validateContractReconciliation(gate, errors) {
  if (!isObject(gate)) { errors.push("contract_reconciliation 必须是对象"); return; }
  for (const field of ["decision_id", "reconciled_at", "rollback"]) if (!nonEmptyString(gate[field])) errors.push(`contract_reconciliation.${field} 必须是非空字符串`);
  if (Object.hasOwn(gate, "reviewed_at") || Object.hasOwn(gate, "reviewedAt")) errors.push("contract_reconciliation 禁止使用 reviewed_at；机器回对请使用 reconciled_at");
  if (gate.status !== "passed") errors.push("contract_reconciliation.status 必须为 passed，变化时退回 V1/模块审计");
  const bindings = gate.bindings;
  if (!isObject(bindings)) errors.push("contract_reconciliation.bindings 必须是对象");
  else for (const field of ["gdd", "tdd", "gameplay_visual_contract", "gameplay_function_contract", "layout_contract", "module_scene_ownership", "budget_baseline"]) if (!nonEmptyString(bindings[field])) errors.push(`contract_reconciliation.bindings.${field} 必须是非空字符串`);
  if (!Array.isArray(gate.checks)) { errors.push("contract_reconciliation.checks 必须是数组"); return; }
  const passed = new Set(); const seenDomains = new Set();
  gate.checks.forEach((item, index) => {
    if (!isObject(item) || !RECONCILIATION_DOMAINS.has(item.domain)) errors.push(`contract_reconciliation.checks[${index}].domain 无效`);
    else if (seenDomains.has(item.domain)) errors.push(`contract_reconciliation.checks domain 重复：${item.domain}`);
    else if (item.status !== "passed") errors.push(`contract_reconciliation.checks[${index}] 未通过，必须退回 V1/模块审计`);
    else passed.add(item.domain);
    if (RECONCILIATION_DOMAINS.has(item?.domain)) seenDomains.add(item.domain);
    if (!nonEmptyString(item?.evidence)) errors.push(`contract_reconciliation.checks[${index}].evidence 必须是非空字符串`);
  });
  const missing = [...RECONCILIATION_DOMAINS].filter((item) => !passed.has(item)).sort();
  if (missing.length) errors.push(`contract_reconciliation.checks 缺少已通过领域：${missing.join(", ")}`);
}

/** 检查实施计划与真实资源及布局映射，避免无生产单元的空计划通过。 */
function validateImplementationPlan(plan, region, assetById, baseline, label, errors) {
  return validateImplementationPlanContract(plan, region, assetById, label, errors);
}

/** 验证 ownership-first 覆盖审计、实现分类及条件编号确认。 */
function validateCoverageAudit(audit, target, assetIds, errors, assetById = new Map(), baseline = null) {
  const fixedMappings = new Map();
  if (!isObject(audit)) { errors.push("coverage_audit 必须是对象"); return fixedMappings; }
  if (!nonEmptyString(audit.version)) errors.push("coverage_audit.version 必须是非空字符串");
  const targetPairs = new Set((target?.scene_ids ?? []).flatMap((sceneId) => (target?.state_ids ?? []).map((stateId) => `${sceneId}\0${stateId}`)));
  const canvases = new Map();
  if (!Array.isArray(audit.canvases)) errors.push("coverage_audit.canvases 必须是数组");
  else audit.canvases.forEach((canvas, index) => {
    const key = `${canvas?.scene_id}\0${canvas?.state_id}`;
    if (!targetPairs.has(key)) errors.push(`coverage_audit.canvases[${index}] 不在冻结目标范围内`);
    if (canvases.has(key)) errors.push(`coverage_audit.canvases scene/state 重复：${canvas?.scene_id}/${canvas?.state_id}`);
    if (!isObject(canvas) || typeof canvas.width !== "number" || canvas.width <= 0 || typeof canvas.height !== "number" || canvas.height <= 0) errors.push(`coverage_audit.canvases[${index}] 必须包含正数 width/height`);
    else canvases.set(key, canvas);
  });
  const summaries = new Map();
  if (!Array.isArray(audit.summaries)) errors.push("coverage_audit.summaries 必须是数组");
  else audit.summaries.forEach((summary, index) => {
    const key = `${summary?.scene_id}\0${summary?.state_id}`;
    if (summaries.has(key)) errors.push(`coverage_audit.summaries scene/state 重复：${summary?.scene_id}/${summary?.state_id}`);
    summaries.set(key, summary);
    if (!targetPairs.has(key)) errors.push(`coverage_audit.summaries[${index}] 不在冻结目标范围内`);
    if (summary?.coverage_ratio !== 1) errors.push(`coverage_audit.summaries[${index}].coverage_ratio 必须为 1`);
    if (!Array.isArray(summary?.uncovered) || summary.uncovered.length !== 0) errors.push(`coverage_audit.summaries[${index}].uncovered 必须为空数组`);
    if (summary?.status !== "passed") errors.push(`coverage_audit.summaries[${index}].status 必须为 passed`);
    if (!nonEmptyString(summary?.evidence)) errors.push(`coverage_audit.summaries[${index}].evidence 必须是非空文件路径`);
  });
  for (const key of targetPairs) { if (!canvases.has(key)) errors.push(`coverage_audit.canvases 缺少目标组合：${key.replace("\0", "/")}`); if (!summaries.has(key)) errors.push(`coverage_audit.summaries 缺少目标组合：${key.replace("\0", "/")}`); }
  if (!Array.isArray(audit.regions) || audit.regions.length === 0) { errors.push("coverage_audit.regions 必须是非空数组"); return fixedMappings; }
  const ids = new Set();
  const annotationNumbers = new Map();
  const coveredRects = new Map();
  audit.regions.forEach((region, index) => {
    const label = `coverage_audit.regions[${index}]`;
    if (!isObject(region)) { errors.push(`${label} 必须是对象`); return; }
    const canonicalRegion = normalizeVisualRegionDefinition(region);
    for (const conflict of getVisualRegionDefinitionAliasConflicts(region)) errors.push(`${label} 区域合同别名取值冲突：${conflict.field}（${conflict.sources.join("/")}）`);
    for (const field of ["id", "scene_id", "state_id", "layer", "owner_id"]) if (!nonEmptyString(region[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (!nonEmptyString(region.ownership_evidence)) errors.push(`${label}.ownership_evidence 必须绑定已有 coverage/ownership 审阅证据`);
    const pair = `${region.scene_id}\0${region.state_id}`;
    if (!Number.isInteger(region.annotation_number) || region.annotation_number <= 0) errors.push(`${label}.annotation_number 必须是同 scene/state 内唯一的正整数`);
    else { const numbers = annotationNumbers.get(pair) ?? new Set(); if (numbers.has(region.annotation_number)) errors.push(`${label}.annotation_number 在 scene/state 内重复`); numbers.add(region.annotation_number); annotationNumbers.set(pair, numbers); }
    if (nonEmptyString(region.scene_id) && !target?.scene_ids?.includes(region.scene_id)) errors.push(`${label}.scene_id 不在 reference_target.scene_ids 范围内`);
    if (nonEmptyString(region.state_id) && !target?.state_ids?.includes(region.state_id)) errors.push(`${label}.state_id 不在 reference_target.state_ids 范围内`);
    if (nonEmptyString(region.id)) { if (ids.has(region.id)) errors.push(`${label}.id 重复：${region.id}`); ids.add(region.id); }
    if (!isObject(region.bounds) || !["x", "y", "width", "height"].every((field) => typeof region.bounds[field] === "number" && Number.isFinite(region.bounds[field])) || region.bounds.width <= 0 || region.bounds.height <= 0) errors.push(`${label}.bounds 必须包含数值 x/y 和正数 width/height`);
    else {
      const key = `${region.scene_id}\0${region.state_id}`; const canvas = canvases.get(key);
      if (!canvas || region.bounds.x < 0 || region.bounds.y < 0 || region.bounds.x + region.bounds.width > canvas.width || region.bounds.y + region.bounds.height > canvas.height) errors.push(`${label}.bounds 超出目标画布`);
      const rectangles = coveredRects.get(key) ?? [];
      rectangles.push(region.bounds);
      coveredRects.set(key, rectangles);
    }
    if (!COVERAGE_OWNER_TYPES.has(canonicalRegion.owner_type)) errors.push(`${label}.owner_type 必须为 runtime-program、runtime-data、runtime-rendered 或 fixed-production-visual`);
    if (canonicalRegion.owner_type === "fixed-production-visual") {
      if (!PRODUCTION_ORIGINS.has(canonicalRegion.production_origin)) errors.push(`${label}.production_origin 必须为 bitmap-decomposition 或 independent-production`);
      const declaredAssetIds = Array.isArray(canonicalRegion.asset_ids)
        ? [...new Set(canonicalRegion.asset_ids.filter(nonEmptyString))]
        : (nonEmptyString(canonicalRegion.asset_id) ? [canonicalRegion.asset_id] : []);
      if (declaredAssetIds.length === 0) errors.push(`${label}.asset_ids/asset_id 必须映射已声明正式原子资源`);
      for (const assetId of declaredAssetIds) {
        if (!assetIds.has(assetId)) errors.push(`${label}.asset_ids 缺少已声明正式资源：${assetId}`);
        else { const items = fixedMappings.get(assetId) ?? []; items.push(region.id); fixedMappings.set(assetId, items); }
      }
    } else {
      if ("asset_id" in region) errors.push(`${label} 运行数据/运行渲染禁止映射生产位图 asset_id`);
      if ("production_origin" in region) errors.push(`${label} 运行数据/运行渲染禁止声明 production_origin`);
    }
    const planMode = validateImplementationPlan(region.implementation_plan, region, assetById, baseline, label, errors);
    // 区域先完成状态分析，再按可复用部件建立资产清单；编号本身不代表资产数量。
    errors.push(...validateVisualComponentContract(region, { stage: "V2", annotation_number: region.annotation_number, region_id: region.id }, { requireImageAssets: true, referenceTargetSha: target?.target_sha256, canvas: canvases.get(pair) }));
    const confirmation = region.confirmation;
    // 效果图的每个编号都必须等待同一套人工 accepted 确认；编号、生产标签和文件身份
    // 由 workflow-control 文件门继续复算，旧 AUTO/USER_DECISION 记录不再兼容。
    validateManualConfirmationEvidence(confirmation, label, errors);
    if (!isObject(confirmation)) errors.push(`${label}.confirmation 必须是 visual-decomposition-confirmation/1.0 人工记录`);
    if (isObject(confirmation) && confirmation.scene_id !== region.scene_id) errors.push(`${label}.confirmation.scene_id 与覆盖区域不一致，必须重新确认`);
    if (isObject(confirmation) && confirmation.state_id !== region.state_id) errors.push(`${label}.confirmation.state_id 与覆盖区域不一致，必须重新确认`);
    if (isObject(confirmation) && confirmation.annotation_number !== region.annotation_number) errors.push(`${label}.confirmation.annotation_number 与覆盖区域不一致，必须重新确认`);
    if (isObject(confirmation) && confirmation.region_id !== region.id) errors.push(`${label}.confirmation.region_id 与覆盖区域不一致，必须重新确认`);
  });
  for (const [key, canvas] of canvases) if (rectangleUnionArea(coveredRects.get(key) ?? []) < canvas.width * canvas.height) errors.push(`coverage_audit ${key.replace("\0", "/")} 的矩形并集面积不足以证明完整覆盖`);
  return fixedMappings;
}

/** 通过横向扫描计算轴对齐矩形并集面积，避免重叠区域被重复累计。 */
function rectangleUnionArea(rectangles) {
  const xs = [...new Set(rectangles.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 1; index < xs.length; index += 1) {
    const left = xs[index - 1]; const right = xs[index];
    const intervals = rectangles.filter((rect) => rect.x < right && rect.x + rect.width > left).map((rect) => [rect.y, rect.y + rect.height]).sort((a, b) => a[0] - b[0]);
    let covered = 0; let start = null; let end = null;
    for (const [nextStart, nextEnd] of intervals) {
      if (start === null) { start = nextStart; end = nextEnd; }
      else if (nextStart <= end) end = Math.max(end, nextEnd);
      else { covered += end - start; start = nextStart; end = nextEnd; }
    }
    if (start !== null) covered += end - start;
    area += (right - left) * covered;
  }
  return area;
}

/** V3 资源审计只接收固定视觉生产单元；运行数据/运行渲染的编号仍由确认文件门覆盖。 */
function fixedVisualAuditManifest(data) {
  if (!isObject(data?.coverage_audit)) return data;
  return { ...data, coverage_audit: { ...data.coverage_audit, regions: (data.coverage_audit.regions ?? []).filter((region) => normalizeVisualRegionDefinition(region).owner_type === "fixed-production-visual") } };
}

/** 验证效果图还原的适用范围和阶段生命周期。 */
function validateReconstructionLifecycle(data, errors) {
  const reconstruction = data.effect_image_reconstruction;
  if (!isObject(reconstruction)) { errors.push("effect_image_reconstruction 必须是对象"); return null; }
  if (reconstruction.applicability === "not-applicable") {
    if (reconstruction.lifecycle !== "not-applicable") errors.push("非效果图项目 lifecycle 必须为 not-applicable");
    for (const field of ["reference_target", "candidate_identity", "contract_reconciliation", "coverage_audit"]) if (data[field] != null) errors.push(`非效果图项目不得声明 ${field}`);
    if (data.fidelity_cases != null && (!Array.isArray(data.fidelity_cases) || data.fidelity_cases.length > 0)) errors.push("非效果图项目 fidelity_cases 必须为空或不存在");
    return reconstruction;
  }
  if (reconstruction.applicability !== "effect-image") { errors.push("effect_image_reconstruction.applicability 必须为 not-applicable 或 effect-image"); return reconstruction; }
  if (!["v2-ready", "v4-complete"].includes(reconstruction.lifecycle)) errors.push("effect-image lifecycle 必须为 v2-ready 或 v4-complete");
  return reconstruction;
}

/** 验证预算字段齐全且为正数。 */
function validateBudgetBlock(budgets, errors) {
  if (!isObject(budgets)) { errors.push("budgets 必须是对象"); return; }
  const missing = [...REQUIRED_BUDGETS].filter((name) => !(name in budgets)).sort();
  if (missing.length) errors.push(`budgets 缺少字段：${missing.join(", ")}`);
  for (const name of [...REQUIRED_BUDGETS].filter((item) => item in budgets)) {
    if (typeof budgets[name] !== "number" || !Number.isFinite(budgets[name]) || budgets[name] <= 0) errors.push(`budgets.${name} 必须是正数`);
  }
}

/** 验证根节点冻结基线的身份、文档和锚点证据。 */
function validateVisualBaseline(baseline, errors) {
  if (!isObject(baseline)) { errors.push("visual_baseline 必须是对象"); return null; }
  for (const field of ["id", "version", "document"]) if (!nonEmptyString(baseline[field])) errors.push(`visual_baseline.${field} 必须是非空字符串`);
  if (nonEmptyString(baseline.document) && baseline.document !== GLOBAL_VISUAL_BASELINE_DOCUMENT) errors.push(`visual_baseline.document 必须指向不可变 ${GLOBAL_VISUAL_BASELINE_DOCUMENT}，阶段证据不得参与哈希`);
  if (baseline.status !== "global-static-baseline-frozen") errors.push("visual_baseline.status 必须为 global-static-baseline-frozen；静态基线冻结不代表 V2 拆解方案完成");
  // 共享合同负责锚点去重、对象格式和全局身份，避免资产文件门与提示词门各自解释基线。
  errors.push(...validateGlobalVisualBaseline(baseline, { label: "visual_baseline" }));
  return baseline;
}

/** 校验资源清单的显式阶段，正式运行直接消费 V2/V3 合同。 */
function validateVisualStageMetadata(data, requestedStage, errors) {
  const stage = data.visualStage ?? data.visual_stage; const state = data.visualStageState ?? data.visual_stage_state; const stageId = String(stage ?? "").toUpperCase();
  const isVisualManifest = data.effect_image_reconstruction?.applicability === "effect-image"; const stageState = String(state ?? "");
  if (!isVisualManifest && stage === undefined && state === undefined) return;
  if (!VISUAL_STAGE_IDS.includes(stageId)) errors.push("visualStage 必须显式使用已知的 V0→V4 阶段，不能从 stageId/文本推断");
  if (!VISUAL_STAGE_STATES.includes(stageState)) errors.push("visualStageState 必须使用有语义的 V0→V4 状态，裸 frozen 或未知状态均失败");
  if (isVisualManifest && !["V2", "V3", "V4"].includes(stageId)) errors.push("effect-image manifest 阶段只能为 V2、V3 或 V4");
  if (stage && requestedStage && stageId !== String(requestedStage).toUpperCase()) errors.push(`visualStage=${stage} 与 --stage=${requestedStage} 冲突`);
  if (stageState === "global-static-baseline-frozen" && stageId === "V2") errors.push("global-static-baseline-frozen 只表示静态基线冻结，不能冒充 v2-production-planning-complete");
  if (isVisualManifest && (!stage || !state)) errors.push("effect-image 清单必须同时提供 visualStage 与 visualStageState，缺失时不允许继续生产");
  if (stageId === "V2" && stageState !== "v2-production-planning-complete") errors.push("V2 必须声明 v2-production-planning-complete，静态基线或笼统 frozen 不足");
  if (stageId === "V3" && stageState !== "v3-formal-acceptance-complete") errors.push("V3 必须声明 v3-formal-acceptance-complete");
  if (stageId === "V4" && stageState !== "v4-runtime-integration-candidate") errors.push("V4 必须声明 v4-runtime-integration-candidate");
}

/** 验证生产中及已验收资源绑定当前根基线。 */
function validateAssetBaselineBinding(asset, baseline, label, errors) {
  for (const [assetField, baselineField] of Object.entries({ visual_baseline_id: "id", visual_baseline_version: "version" })) {
    const value = asset[assetField];
    if (!nonEmptyString(value)) { errors.push(`${label}.${assetField} 必须是非空字符串`); continue; }
    const expected = baseline?.[baselineField];
    if (nonEmptyString(expected) && value !== expected) errors.push(`${label}.${assetField} 与 visual_baseline.${baselineField} 不一致`);
  }
}

/** 验证 AI 合成栅格路线的可复现生成包。 */
function validateAiGenerationRecord(asset, label, errors) {
  const record = asset.generation_record;
  if (!isObject(record)) { errors.push(`${label}.generation_record 必须是对象`); return; }
  for (const field of AI_REQUIRED_TEXT_FIELDS) if (!nonEmptyString(record[field])) errors.push(`${label}.generation_record.${field} 必须是非空字符串`);
  if (!(nonEmptyString(record.seed) || Number.isInteger(record.seed))) errors.push(`${label}.generation_record.seed 必须是非空字符串或整数`);
  validatePathList(record.reference_inputs, `${label}.generation_record.reference_inputs`, errors);
  if (!Array.isArray(record.postprocess) || !record.postprocess.every(nonEmptyString)) errors.push(`${label}.generation_record.postprocess 必须是字符串列表（可为空）`); const contract = resolveProductionContract(asset); const expectedAsset = (Array.isArray(contract.expected_assets) ? contract.expected_assets : []).find((item) => item?.alpha === true); errors.push(...validateTransparentBackgroundContract({ asset, contract, generation: record, expectedAsset, metadata: resolveOutputMetadata(asset) }).map((message) => `${label} ${message}`));
}

/** 验证所有生成路线共享的可执行生成身份与来源，禁止用任意对象冒充来源。 */
function validateGenerationRecord(record, label, errors) {
  if (!isObject(record)) { errors.push(`${label}.generation_record 必须是对象`); return; }
  for (const field of ["record_id", "generator", "generator_version", "created_at", "command_or_recipe"]) if (!nonEmptyString(record[field])) errors.push(`${label}.generation_record.${field} 必须是非空字符串`);
  if (nonEmptyString(record.created_at) && Number.isNaN(Date.parse(record.created_at))) errors.push(`${label}.generation_record.created_at 必须是可解析时间`);
  if (!Array.isArray(record.input_sources) || record.input_sources.length === 0 || !record.input_sources.every(nonEmptyString)) errors.push(`${label}.generation_record.input_sources 必须是非空来源列表`);
  if (!isObject(record.parameters) || Object.keys(record.parameters).length === 0) errors.push(`${label}.generation_record.parameters 必须是非空对象`);
}

/** 验证资源只归属一个具体场景，或满足受控公共资源条件。 */
function validateAssetOwnership(asset, label, errors) {
  const hasScene = nonEmptyString(asset.scene_id);
  const isShared = asset.shared === true;
  if (hasScene === isShared) {
    errors.push(`${label} 必须二选一声明 scene_id 或 shared: true`);
    return;
  }
  if (hasScene) {
    if ("shared_scene_ids" in asset || "shared_reason" in asset) errors.push(`${label} 场景资源不得声明 shared_scene_ids 或 shared_reason`);
    return;
  }
  const sceneIds = asset.shared_scene_ids;
  if (asset.shared_reason === "runtime-required") {
    if (sceneIds !== undefined && (!Array.isArray(sceneIds) || !sceneIds.every(nonEmptyString) || new Set(sceneIds).size !== sceneIds.length)) errors.push(`${label}.shared_scene_ids 必须是无重复的场景 ID 列表`);
    return;
  }
  if (!Array.isArray(sceneIds) || sceneIds.length < 2 || !sceneIds.every(nonEmptyString) || new Set(sceneIds).size !== sceneIds.length) errors.push(`${label}.shared_scene_ids 必须包含至少两个无重复场景 ID`);
}

/** 验证已验收资源具备来源、授权、输出及运行证据。 */
function validateAcceptedAsset(asset, label, errors) {
  const hasSourceFiles = nonEmptyString(asset.source_file) || Array.isArray(asset.source_files) && asset.source_files.length > 0 && asset.source_files.every(nonEmptyString);
  if ("source_files" in asset && (!Array.isArray(asset.source_files) || asset.source_files.length === 0 || !asset.source_files.every(nonEmptyString))) errors.push(`${label}.source_files 必须是非空路径列表`);
  if (!hasSourceFiles && !isObject(asset.generation_record)) errors.push(`${label} accepted 必须提供 source_file/source_files 或 generation_record`);
  if (!hasSourceFiles && isObject(asset.generation_record)) validateGenerationRecord(asset.generation_record, label, errors);
  for (const field of ["license_record", "cocos_evidence", "gameplay_visual_evidence"]) if (!nonEmptyString(asset[field])) errors.push(`${label} accepted 缺少 ${field}`);
  if (!Array.isArray(asset.runtime_outputs) || asset.runtime_outputs.length === 0 || !asset.runtime_outputs.every(nonEmptyString)) errors.push(`${label} accepted 的 runtime_outputs 必须是非空路径列表`);
  validatePathList(asset.consistency_evidence, `${label} accepted 的 consistency_evidence`, errors);
}

/** 返回清单中的全部结构与业务校验错误。 */
export function validateManifest(data, options = {}) {
  const errors = [];
  if (!isObject(data)) return ["清单根节点必须是对象"];
  const workItemType = String(options.workItemType ?? "SCENE").toUpperCase();
  if (!["SCENE", "DISPLAY_LAYER"].includes(workItemType)) errors.push("workItemType 只能是 SCENE 或 DISPLAY_LAYER");
  // 独立清单入口没有实施包上下文，必须由调用方显式提供可信工作项类型；默认继续按场景收紧。
  const displayLayerScope = workItemType === "DISPLAY_LAYER" ? "display-layer" : "scene";
  const visualValidationMode = resolveVisualValidationMode(data, data.scene_reconstruction_contract);
  validateVisualValidationPolicy(errors, "visual_validation", data, data.scene_reconstruction_contract);
  const requestedStage = options.stage === undefined ? null : String(options.stage).toUpperCase();
  if (requestedStage && !["V2", "V3", "V4"].includes(requestedStage)) errors.push("--stage 只能是 V2、V3 或 V4");
  if (data.schema_version !== SCHEMA_VERSION) errors.push(`schema_version 必须为 ${SCHEMA_VERSION}`);
  const baseline = validateVisualBaseline(data.visual_baseline, errors);
  validateVisualStageMetadata(data, requestedStage, errors);
  const reconstruction = validateReconstructionLifecycle(data, errors);
  let target = null; let candidate = null;
  if (reconstruction?.applicability === "effect-image") {
    // 效果图清单必须把当前工作项和候选版本写在根节点；旧 snake_case 字段不再参与解析。
    for (const field of ["workItemId", "candidateVersion"]) {
      if (!nonEmptyString(data[field])) errors.push(`effect-image 清单根字段 ${field} 必须是非空字符串`);
    }
    for (const legacyField of ["work_item_id", "candidate_version"]) {
      if (Object.hasOwn(data, legacyField)) errors.push(`effect-image 清单禁止使用旧根字段 ${legacyField}，请改为 camelCase`);
    }
    target = validateReferenceTarget(data.reference_target, errors, baseline);
    candidate = data.candidate_identity;
    if (!isObject(candidate)) errors.push("candidate_identity 必须是对象");
    else {
      if (!nonEmptyString(candidate.kind)) errors.push("candidate_identity.kind 必须是非空字符串");
    }
    validateContractReconciliation(data.contract_reconciliation, errors);
  }
  validateBudgetBlock(data.budgets, errors);
  if (!Array.isArray(data.assets)) { errors.push("assets 必须是数组"); return errors; }
  // 已解析的结构输入不代表运行证据已落盘；正式文件入口另行强制读取。
  const layoutSourceOptions = { layoutSourceDocuments: options.layoutSourceDocuments, forceLayoutSourceFiles: options.forceLayoutSourceFiles, projectRoot: options.layoutSourceDocuments instanceof Map && options.forceLayoutSourceFiles !== true ? undefined : options.projectRoot };
  const assetIds = new Set(data.assets.filter(isObject).map((item) => item.id).filter(nonEmptyString));
  const assetById = new Map(data.assets.filter(isObject).filter((item) => nonEmptyString(item.id)).map((item) => [item.id, item]));
  const fixedMappings = reconstruction?.applicability === "effect-image" ? validateCoverageAudit(data.coverage_audit, target, assetIds, errors, assetById, baseline) : new Map(); const layoutBindings = reconstruction?.applicability === "effect-image" && requestedStage !== "V3" ? validateEffectImageLayoutBindings(data, errors, { ...options, stage: requestedStage, visual_validation: { mode: visualValidationMode } }) : null;
  const coverageRegions = Array.isArray(data.coverage_audit?.regions) ? data.coverage_audit.regions : [];
  const fixedRegionAssetIds = (region) => (Array.isArray(region?.asset_ids) ? region.asset_ids : [region?.asset_id]).filter(nonEmptyString);
  const bitmapAssetIds = new Set(coverageRegions.filter((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "bitmap-decomposition").flatMap(fixedRegionAssetIds));
  const independentAssetIds = new Set(coverageRegions.filter((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "independent-production").flatMap(fixedRegionAssetIds));
  if (reconstruction?.applicability === "effect-image" && data.fidelity_cases != null && !Array.isArray(data.fidelity_cases)) errors.push("fidelity_cases 必须是数组");
  if (reconstruction?.lifecycle === "v4-complete") {
    validateVisualManifestFidelityCases(data.fidelity_cases, target, candidate, baseline, errors, { requireCompleteCoverage: true, mode: visualValidationMode });
    if (Array.isArray(data.fidelity_cases) && data.fidelity_cases.some((item) => item?.conclusion !== "passed")) errors.push("V4 complete 的 fidelity_cases 必须全部 passed");
  } else if (Array.isArray(data.fidelity_cases) && data.fidelity_cases.length > 0) validateVisualManifestFidelityCases(data.fidelity_cases, target, candidate, baseline, errors, { mode: visualValidationMode });
  const strictProductionContract = reconstruction?.applicability === "effect-image";
  if (strictProductionContract) {
    const stage = requestedStage ?? (reconstruction.lifecycle === "v4-complete" ? "V4" : "V2");
    // V2 拆解图确认之后，清单上的所有后续证据都只能是确定性机器验证；旧复核字段 fail closed。
    errors.push(...validateVisualPostApprovalReviewFields(data, { stage }));
    // V3 只验收资源生产结果；正式 Scene、同屏组合和运行时消费统一留到 V4。
    if (stage !== "V3") errors.push(...validateSceneReconstructionGate(data, { ...layoutSourceOptions, stage, displayLayerScope, requireFinalLayout: stage === "V4" || reconstruction.lifecycle === "v4-complete" || (stage === "V2" && [data.visualStageState, data.visual_stage_state].includes("v2-production-planning-complete")), visual_validation: { mode: visualValidationMode } }));
    const fileGateError = productionFileGateError(data, options, stage);
    if (fileGateError) errors.push(fileGateError);
    errors.push(...validateVisualProductionCoverage(fixedVisualAuditManifest(data), { stage: "V2", requireManualConfirmation: false }));
    errors.push(...validateImageGenerationSizeManifest(data, { stage }));
    const requireAudit = stage === "V3" || stage === "V4" || reconstruction.lifecycle === "v4-complete";
    const requireV4 = stage === "V4" || reconstruction.lifecycle === "v4-complete";
    if (requireV4) { validateV4LayoutMeasurements(data, layoutBindings, errors, { visual_validation: { mode: visualValidationMode } });
      // 显式传入 V4，让生产审计同时校验每个区域的运行时消费身份。
      errors.push(...validateProductionAuditShape(fixedVisualAuditManifest(data), { ...options, stage: "V4", projectRoot: options.projectRoot, checkFiles: options.checkFiles }));
      const structuralGate = { ...data, coverage_audit: isObject(data.coverage_audit) ? { ...data.coverage_audit, regions: [] } : data.coverage_audit };
      errors.push(...validateV4ProductionGate(structuralGate, { ...layoutSourceOptions, requireEvidenceIdentity: true, requireSceneReconstruction: true, displayLayerScope }));
    } else if (requireAudit) {
      errors.push(...validateProductionAuditShape(fixedVisualAuditManifest(data), { ...options, projectRoot: options.projectRoot, checkFiles: options.checkFiles }));
    } else if (isObject(data.production_contract_audit)) errors.push(...validateProductionAuditShape(data));
    const changeContext = { workItemId: data.workItemId, candidateVersion: data.candidateVersion };
    if (isObject(data.production_method_change_request)) errors.push(...validateProductionMethodChangeRequest(data.production_method_change_request, changeContext));
    if (Array.isArray(data.change_requests)) for (const request of data.change_requests) errors.push(...validateProductionMethodChangeRequest(request, changeContext));
  }
  const seen = { id: new Set(), texture_key: new Set(), output: new Set() };
  data.assets.forEach((asset, index) => {
    const label = `assets[${index}]`;
    if (!isObject(asset)) { errors.push(`${label} 必须是对象`); return; }
    validateAssetResourceLocations(asset, errors, label);
    for (const field of ["id", "texture_key", "route", "status"]) if (!nonEmptyString(asset[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (reconstruction?.applicability === "effect-image") {
      const mapped = new Set(fixedMappings.get(asset.id) ?? []);
      const declaresReconstruction = "ownership_type" in asset || "coverage_region_ids" in asset;
      if (mapped.size > 0 && asset.ownership_type !== "fixed-production-visual") errors.push(`${label}.ownership_type 必须为 fixed-production-visual`);
      // bitmap-decomposition 只有在合同显式要求 图像生成 时才绑定 AI 栅格路线。
      const assetContract = strictProductionContract ? resolveProductionContract(asset) : null;
      if (mapped.size > 0 && bitmapAssetIds.has(asset.id) && assetContract?.image_generation_required === true && asset.route !== "ai-composite-raster") errors.push(`${label} 被 bitmap-decomposition 覆盖引用时 route 必须为 ai-composite-raster`);
      if (mapped.size > 0 && (!Array.isArray(asset.coverage_region_ids) || asset.coverage_region_ids.length === 0 || !asset.coverage_region_ids.every(nonEmptyString))) errors.push(`${label}.coverage_region_ids 必须是非空字符串列表`);
      if (mapped.size === 0 && declaresReconstruction) errors.push(`${label} 声明了还原字段但未被 fixed coverage 引用`);
      if (Array.isArray(asset.coverage_region_ids) && new Set(asset.coverage_region_ids).size !== asset.coverage_region_ids.length) errors.push(`${label}.coverage_region_ids 不得重复`);
      if (mapped.size > 0 && Array.isArray(asset.coverage_region_ids) && asset.coverage_region_ids.length > 0 && asset.coverage_region_ids.every(nonEmptyString)) {
      for (const regionId of asset.coverage_region_ids) if (!mapped.has(regionId)) errors.push(`${label}.coverage_region_ids 引用了未映射到该资源的覆盖区域：${regionId}`);
        for (const regionId of mapped) if (!asset.coverage_region_ids.includes(regionId)) errors.push(`${label}.coverage_region_ids 缺少映射到该资源的覆盖区域：${regionId}`);
      }
      if (mapped.size > 0 && independentAssetIds.has(asset.id) && nonEmptyString(target?.original_file)) {
        const sourcePaths = [asset.source_file, ...(Array.isArray(asset.source_files) ? asset.source_files : [])].filter(nonEmptyString);
        if (sourcePaths.some((sourcePath) => sourcePath === target.original_file || resolve(sourcePath) === resolve(target.original_file))) errors.push(`${label} independent-production 不得直接把冻结效果图 original_file 作为 source_file/source_files`);
      }
    } else if ("ownership_type" in asset || "coverage_region_ids" in asset) errors.push(`${label} 非效果图项目不得声明 ownership_type 或 coverage_region_ids`);
    const assetContract = strictProductionContract ? resolveProductionContract(asset) : {};
    if (strictProductionContract && assetContract.owner_type === "fixed-production-visual") {
      errors.push(...validateVisualEffectImageOrigin(asset, {
        label,
        visual_baseline: baseline,
        target_sha256: data.reference_target?.target_sha256,
        output_sha256: asset.sha256 ?? asset.file_sha256,
      }));
      if (assetContract.image_generation_required === true && asset.origin !== "generated") errors.push(`${label} image_generation_required=true 必须声明 origin=generated`);
    }
    if (Object.keys(assetContract).length > 0) {
      const assetContext = { stage: "V2", annotation_number: asset.coverage_annotation_number ?? "?", region_id: asset.coverage_region_id ?? asset.id, observedMethod: assetContract.production_method ?? "unspecified" };
      errors.push(...validateProductionContract(asset, assetContext, { requireComplete: true }));
      if (assetContract.image_generation_required === true) {
        const regionId = asset.coverage_region_id ?? asset.coverageRegionId ?? asset.coverage_region_ids?.[0] ?? asset.coverageRegionIds?.[0];
        const coverageRegion = data.coverage_audit?.regions?.find((item) => (item?.region_id ?? item?.regionId ?? item?.id) === regionId);
        const reconstructionRegion = data.scene_reconstruction_contract?.coverage_regions?.find((item) => (item?.region_id ?? item?.regionId ?? item?.id) === regionId);
        const promptRegion = { ...(coverageRegion ?? {}), ...(reconstructionRegion ?? {}) };
        errors.push(...validateImageGenerationContract(asset, assetContract, { ...assetContext, region: promptRegion }, {
          effectImage: strictProductionContract,
          referenceOriginalFile: data.reference_target?.original_file,
          referenceTargetSha: data.reference_target?.target_sha256,
          visual_baseline: baseline,
          identity: manifestEvidenceIdentity(data),
          candidateVersion: data.candidateVersion,
        }));
      }
    }
    validateAssetOwnership(asset, label, errors);
    if (nonEmptyString(asset.route) && !ALLOWED_ROUTES.has(asset.route)) errors.push(`${label}.route 不在允许列表中：${asset.route}`);
    if (nonEmptyString(asset.status) && !ALLOWED_STATUSES.has(asset.status)) errors.push(`${label}.status 不在允许列表中：${asset.status}`);
    // 视频抽帧资源必须绑定提示词、原视频、图集与预览，防止旧候选混入当前资源。
    if (asset.route === "frame-animation" && asset.status === "accepted") errors.push(...validateFrameAnimationWorkflowContract(asset.frame_animation, { label: `${label}.frame_animation`, workItemId: data.workItemId, candidateVersion: data.candidateVersion }));
    else if (Object.hasOwn(asset, "frame_animation")) errors.push(`${label}.frame_animation 仅允许用于 route=frame-animation 且 status=accepted 的资源`);
    for (const field of ["id", "texture_key"]) if (nonEmptyString(asset[field])) { if (seen[field].has(asset[field])) errors.push(`${label}.${field} 重复：${asset[field]}`); seen[field].add(asset[field]); }
    if (Array.isArray(asset.runtime_outputs)) for (const output of asset.runtime_outputs) if (nonEmptyString(output)) { const normalizedOutput = normalizeProjectRelativePath(output); if (!normalizedOutput) errors.push(`${label}.runtime_outputs 必须是项目内相对路径：${output}`); else { if (seen.output.has(normalizedOutput)) errors.push(`${label}.runtime_outputs 路径重复：${output}`); seen.output.add(normalizedOutput); } }
    if (BASELINE_BOUND_STATUSES.has(asset.status)) { validateAssetBaselineBinding(asset, baseline, label, errors); if (asset.route === "ai-composite-raster" && resolveProductionContract(asset).image_generation_required === true) validateAiGenerationRecord(asset, label, errors); }
    if (asset.status === "accepted") validateAcceptedAsset(asset, label, errors);
  });
  // 同一结构门可能由场景合同和最终运行总门共同触发；错误按文本去重，避免一次调用重复报告。
  return [...new Set(errors)];
}

/** 解析项目内路径，并拒绝逃逸出项目根目录。 */
function projectPath(projectRoot, relativePath) {
  const candidate = resolve(projectRoot, relativePath);
  const rel = relative(resolve(projectRoot), candidate);
  // Windows 不同盘符和任何父级跳转都必须视为逃逸。
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ManifestValidationError(`路径逃逸项目根目录：${relativePath}`);
  const rootReal = nearestExistingRealPath(resolve(projectRoot));
  const candidateReal = nearestExistingRealPath(candidate);
  if (rootReal && candidateReal) {
    const realRel = relative(rootReal, candidateReal);
    if (isAbsolute(realRel) || realRel === ".." || realRel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ManifestValidationError(`路径真实位置逃逸项目根目录：${relativePath}`);
  }
  return candidate;
}

/** 解析文件或最近存在的父目录，用于识别 symlink/junction 的真实越界位置。 */
function nearestExistingRealPath(candidate) {
  let current = candidate;
  while (true) {
    try { return realpathSync(current); } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/** 检查路径是否为普通文件。 */
function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }

/** 读取受支持 PNG 的尺寸；同时校验 chunk、CRC、非交错 RGBA/RGB 扫描行和 IEND。 */
export function readPngDimensions(bytes) {
  if (bytes.length < PNG_SIGNATURE.length + 12 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  let offset = PNG_SIGNATURE.length; let sawIhdr = false; let sawIdat = false; let sawIend = false; const idatChunks = [];
  let width = 0; let height = 0; let channels = 0;
  try {
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) return null;
      const length = bytes.readUInt32BE(offset); const typeStart = offset + 4; const typeEnd = typeStart + 4; const dataStart = typeEnd; const dataEnd = dataStart + length; const crcEnd = dataEnd + 4;
      if (crcEnd > bytes.length) return null;
      const type = bytes.toString("ascii", typeStart, typeEnd);
      if (!/^[A-Za-z]{4}$/.test(type)) return null;
      const chunkData = bytes.subarray(dataStart, dataEnd); const expectedCrc = bytes.readUInt32BE(dataEnd); const actualCrc = pngCrc32(bytes.subarray(typeStart, dataEnd));
      if (actualCrc !== expectedCrc) return null;
      if (type === "IHDR") {
        if (sawIhdr || length !== 13 || bytes.readUInt32BE(dataStart) <= 0 || bytes.readUInt32BE(dataStart + 4) <= 0) return null;
        width = bytes.readUInt32BE(dataStart); height = bytes.readUInt32BE(dataStart + 4);
        const bitDepth = bytes[dataStart + 8]; const colorType = bytes[dataStart + 9]; const compression = bytes[dataStart + 10]; const filterMethod = bytes[dataStart + 11]; const interlace = bytes[dataStart + 12];
        // 生成器只产生 8 位、非交错 RGB/RGBA 图；限制组合后才能可靠计算扫描行长度。
        if (bitDepth !== 8 || ![2, 6].includes(colorType) || compression !== 0 || filterMethod !== 0 || interlace !== 0) return null;
        channels = colorType === 6 ? 4 : 3;
        sawIhdr = true;
      } else if (!sawIhdr) return null;
      if (type === "IDAT") { if (length === 0) return null; sawIdat = true; idatChunks.push(chunkData); }
      if (type === "IEND") {
        if (length !== 0 || !sawIdat) return null;
        sawIend = true; offset = crcEnd; break;
      }
      offset = crcEnd;
    }
    if (!sawIhdr || !sawIdat || !sawIend || offset !== bytes.length) return null;
    const scanlines = inflateSync(Buffer.concat(idatChunks)); const rowLength = 1 + width * channels; const expectedLength = rowLength * height;
    if (scanlines.length !== expectedLength) return null;
    for (let row = 0; row < height; row += 1) if (scanlines[row * rowLength] > 4) return null;
    return { width, height };
  } catch { return null; }
}

/** 检查编号图或冻结目标是否为完整 PNG。 */
function hasMinimalPngStructure(bytes) { return readPngDimensions(bytes) !== null; }

/** 以稳定键序列化原子需求，供提案与当前合同进行直接内容比较。 */
function canonicalAnnotationJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalAnnotationJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).filter((key) => !/(?:sha1|sha256|hash|fingerprint)/iu.test(key)).sort().map((key) => `${JSON.stringify(key)}:${canonicalAnnotationJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 校验 proposal 中的完整技术拆解，防止图示精简时丢失坐标、状态或资源合同。 */
function expectedTechnicalProductionContract(region) {
  const contract = resolveProductionContract(region);
  const display = annotationProductionContract(region);
  return {
    production_origin: contract.production_origin ?? display.production_origin ?? null,
    production_method: contract.production_method ?? display.production_method ?? "",
    delivery_kind: contract.delivery_kind ?? display.delivery_kind ?? "",
    image_generation_required: contract.image_generation_required,
    generation_record_required: contract.generation_record_required,
    substitution_policy: contract.substitution_policy,
    runtime_implementation: contract.runtime_implementation ?? region.runtime_implementation,
    asset_id: contract.asset_id ?? region.asset_id,
    asset_ids: contract.asset_ids ?? region.asset_ids ?? [],
    expected_assets: region.expected_assets ?? contract.expected_assets ?? [],
  };
}

/** 从当前区域重算技术文件中的组件实例平面映射，确保 placement 坐标仍受门禁保护。 */
function expectedTechnicalPlacements(region) {
  const inventory = region.component_inventory ?? resolveProductionContract(region).component_inventory;
  const components = Array.isArray(inventory?.components) ? inventory.components : [];
  return components.flatMap((component) => (Array.isArray(component?.placements) ? component.placements : []).map((placement) => ({ ...placement, component_id: component.component_id })));
}

/** 重算技术文件中的资产映射，避免只验证区域摘要而放过资源漂移。 */
function expectedTechnicalResourceMapping(region) {
  const production = resolveProductionContract(region);
  const requirements = deriveAtomicImageRequirements(region);
  const expectedAssets = region.expected_assets ?? production.expected_assets ?? [];
  const assetIds = [...new Set([
    ...(Array.isArray(region.asset_ids) ? region.asset_ids : []),
    region.asset_id,
    ...(Array.isArray(production.asset_ids) ? production.asset_ids : []),
    production.asset_id,
    ...(Array.isArray(expectedAssets) ? expectedAssets.map((asset) => asset?.asset_id) : []),
  ].filter(nonEmptyString))].sort();
  return {
    asset_id: production.asset_id ?? region.asset_id ?? null,
    asset_ids: assetIds,
    expected_assets: expectedAssets,
    component_assets: requirements.map((requirement) => ({ requirement_id: requirement.requirement_id, component_id: requirement.component_id, state_id: requirement.state_id, asset_id: requirement.asset_id, source_file: requirement.source_file, runtime_file: requirement.runtime_file })),
  };
}

/** 验证技术拆解提案与清单事实一致，确认不能替代具体拆解内容。 */
function validateTechnicalProposal(proposal, regions, canvas, label, errors) {
  const expectedProposalKind = "effect-image-decomposition-technical-analysis";
  // 正式标注必须绑定完整技术文件；缺少类型或命名空间时直接拒绝，不能退回只看用户图示的路径。
  if (proposal?.proposal_kind !== expectedProposalKind) {
    errors.push(`${label}.proposal_kind 必须为 ${expectedProposalKind}，正式效果图标注必须绑定拆解分析技术文件`);
    return;
  }
  const technical = proposal?.technical_analysis;
  if (!isObject(technical)) { errors.push(`${label}.proposal 技术文件缺少 technical_analysis`); return; }
  if (technical.schema_version !== "1") errors.push(`${label}.proposal 技术文件 schema_version 必须为 1`);
  const expectedCanvas = canvas ?? { scene_id: regions[0]?.scene_id, state_id: regions[0]?.state_id, width: undefined, height: undefined };
  for (const [field, expected] of [["scene_id", expectedCanvas.scene_id], ["state_id", expectedCanvas.state_id], ["width", expectedCanvas.width], ["height", expectedCanvas.height]]) {
    if (expected !== undefined && technical.canvas?.[field] !== expected) errors.push(`${label}.proposal 技术文件 canvas.${field} 与当前画布不一致`);
    if (expected !== undefined && proposal.canvas?.[field] !== expected) errors.push(`${label}.proposal.canvas.${field} 与当前画布不一致`);
  }
  if (!isObject(technical.canvas) || !Number.isInteger(technical.canvas.width) || !Number.isInteger(technical.canvas.height)) errors.push(`${label}.proposal 技术文件必须保存完整画布尺寸`);
  if (!isObject(proposal.canvas) || !Number.isInteger(proposal.canvas.width) || !Number.isInteger(proposal.canvas.height)) errors.push(`${label}.proposal 必须保存完整画布尺寸`);
  const technicalRegions = Array.isArray(technical.regions) ? technical.regions : [];
  const actualById = new Map(technicalRegions.map((item) => [item?.region_id, item])); validateTechnicalLayoutNodeIds(technical, regions, label, errors);
  if (technicalRegions.length !== regions.length) errors.push(`${label}.proposal 技术文件区域数量与当前 scene/state 不一致`);
  for (const region of regions) {
    const item = actualById.get(region.id);
    if (!isObject(item)) { errors.push(`${label}.proposal 技术文件缺少区域：${region.id}`); continue; }
    if (canonicalAnnotationJson(item.bounds) !== canonicalAnnotationJson(region.bounds)) errors.push(`${label}.proposal 技术文件 ${region.id} 区域 bounds 不一致`);
    const expectedProduction = expectedTechnicalProductionContract(region);
    if (!isObject(item.production_contract) || !nonEmptyString(item.production_contract.production_method) || !nonEmptyString(item.production_contract.delivery_kind)) errors.push(`${label}.proposal 技术文件 ${region.id} 缺少完整 production_contract`);
    for (const field of ["production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "asset_id", "asset_ids", "expected_assets"]) if (expectedProduction[field] !== undefined && canonicalAnnotationJson(item.production_contract?.[field]) !== canonicalAnnotationJson(expectedProduction[field])) errors.push(`${label}.proposal 技术文件 ${region.id} production_contract.${field} 不一致`);
    if (expectedProduction.runtime_implementation !== undefined && canonicalAnnotationJson(item.production_contract?.runtime_implementation) !== canonicalAnnotationJson(expectedProduction.runtime_implementation)) errors.push(`${label}.proposal 技术文件 ${region.id} runtime_implementation 不一致`);
    const expectedRequirements = deriveAtomicImageRequirements(region);
    if (!Array.isArray(item.atomic_image_requirements) || canonicalAnnotationJson(item.atomic_image_requirements) !== canonicalAnnotationJson(expectedRequirements)) errors.push(`${label}.proposal 技术文件 ${region.id} atomic_image_requirements 不一致`);
    const expectedResourceMapping = expectedTechnicalResourceMapping(region);
    if (!isObject(item.resource_mapping) || canonicalAnnotationJson(item.resource_mapping) !== canonicalAnnotationJson(expectedResourceMapping)) errors.push(`${label}.proposal 技术文件 ${region.id} 资源映射不一致`);
    if (region.owner_type === "fixed-production-visual" && (!isObject(item.component_inventory) || !Array.isArray(item.component_inventory.components ?? []))) errors.push(`${label}.proposal 技术文件 ${region.id} 缺少 component_inventory`);
    const expectedInventory = region.component_inventory ?? resolveProductionContract(region).component_inventory;
    if (expectedInventory !== undefined && canonicalAnnotationJson(item.component_inventory) !== canonicalAnnotationJson(expectedInventory)) errors.push(`${label}.proposal 技术文件 ${region.id} component_inventory 不一致`);
    const expectedComponents = Array.isArray(expectedInventory?.components) ? expectedInventory.components : [];
    if (canonicalAnnotationJson(item.components) !== canonicalAnnotationJson(expectedComponents)) errors.push(`${label}.proposal 技术文件 ${region.id} components 不一致`);
    const expectedPlacements = expectedTechnicalPlacements(region); validateTechnicalRegionLayout(region, item, expectedPlacements, label, errors);
    if (!Array.isArray(item.placements) || canonicalAnnotationJson(item.placements) !== canonicalAnnotationJson(expectedPlacements)) errors.push(`${label}.proposal 技术文件 ${region.id} placement 坐标不一致`);
    const expectedStateAnalysis = region.state_analysis ?? region.stateAnalysis;
    if (expectedStateAnalysis !== undefined && canonicalAnnotationJson(item.state_analysis) !== canonicalAnnotationJson(expectedStateAnalysis)) errors.push(`${label}.proposal 技术文件 ${region.id} state_analysis 不一致`);
    if (!isObject(item.state_analysis) && region.owner_type === "fixed-production-visual") errors.push(`${label}.proposal 技术文件 ${region.id} 缺少 state_analysis`);
    // confirmation 是可变的人工记录，技术定义比较只覆盖区域合同本身。
    const { confirmation: _confirmation, ...technicalDefinition } = region;
    if (canonicalAnnotationJson(item.technical_definition) !== canonicalAnnotationJson(technicalDefinition)) errors.push(`${label}.proposal 技术文件 ${region.id} technical_definition 与当前区域不一致`);
  }
}

/** 校验确定性 PNG 标注；元数据、像素边界和 proposal 必须同时绑定。 */
export function validateAnnotatedPng(bytes, targetBytes, regions, proposal, label, errors, canvas = null) {
  let annotated; let target;
  try { annotated = validateFormalAnnotationPng(bytes, { label }); } catch (error) { errors.push(`${label} 必须是完整正式 PNG 标注：${error.message}`); return; }
  try { target = targetBytes ? decodePngRgba(targetBytes) : null; } catch { errors.push(`${label} 冻结原图无法解码为 PNG`); return; }
  const metadata = annotated.metadata;
  if (!isObject(metadata) || metadata.schema !== "effect-image-annotation/png/1" || metadata.layout !== "image-plus-right-panel") { errors.push(`${label} 缺少正式 PNG 标注元数据，正式流程不接受 SVG`); return; }
  const expectedTarget = canvas ?? target;
  if (!expectedTarget || metadata.original_width !== expectedTarget.width || metadata.original_height !== expectedTarget.height || annotated.width !== metadata.original_width + metadata.panel_width || annotated.height !== metadata.output_height || annotated.height < metadata.original_height || metadata.panel_height !== annotated.height || !(metadata.panel_width > 0)) errors.push(`${label} 必须保留左侧原图尺寸并声明完整右侧说明栏`);
  const expected = regions.slice().sort((left, right) => left.annotation_number - right.annotation_number); const actualRegions = Array.isArray(metadata.regions) ? metadata.regions : []; const actualById = new Map();
  for (const item of actualRegions) { if (!isObject(item) || !nonEmptyString(item.region_id) || actualById.has(item.region_id)) errors.push(`${label} PNG 区域元数据必须包含唯一 region_id`); else actualById.set(item.region_id, item); }
  if (actualById.size !== expected.length) errors.push(`${label} PNG 标注区域数量与当前 scene/state 不一致`);
  const proposalRegions = Array.isArray(proposal?.visual_regions) ? proposal.visual_regions : (Array.isArray(proposal?.regions) ? proposal.regions : (proposal?.region_id ? [proposal] : [])); const proposalById = new Map(proposalRegions.map((item) => [item.region_id, item]));
  validateTechnicalProposal(proposal, expected, canvas ?? (target ? { scene_id: expected[0]?.scene_id, state_id: expected[0]?.state_id, width: target.width, height: target.height } : null), label, errors);
  for (const region of expected) {
    const item = actualById.get(region.id); const plan = region.implementation_plan ?? {}; const production = annotationProductionContract(region); const requirements = deriveAtomicImageRequirements(region);
    if (!item) { errors.push(`${label} 缺少区域标注：${region.id}`); continue; }
    const expectedPlacementIds = normalizeAtomicComponents(region).flatMap((component) => component.placements.map((placement) => placement.placement_id)).sort(); validatePngLayoutMetadata(region, item, expectedTechnicalPlacements(region), label, errors);
    if (item.scene_id !== region.scene_id || item.state_id !== region.state_id || item.annotation_number !== region.annotation_number || item.plan_mode !== plan.mode) errors.push(`${label}.${region.id} scene/state/编号/实现计划不一致`);
    // PNG 内嵌摘要是右栏中文说明的证据，必须与冻结区域合同逐字绑定。
    if (item.summary !== plan.summary) errors.push(`${label}.${region.id} PNG 编号对应的中文摘要与区域合同不一致`);
    if (item.production_method !== production.production_method || item.production_origin !== production.production_origin || item.delivery_kind !== production.delivery_kind || item.production_label !== production.label) errors.push(`${label}.${region.id} PNG 生产标识与 production_method/production_origin 合同不一致`);
    if (!atomicImageRequirementsEqual(item.atomic_image_requirements, requirements)) errors.push(`${label}.${region.id} atomic_image_requirements 不一致`);
    if (JSON.stringify([...(item.placement_ids ?? [])].sort()) !== JSON.stringify(expectedPlacementIds)) errors.push(`${label}.${region.id} placement 原子框元数据与 component_inventory 不一致`);
    const proposalRegion = proposalById.get(region.id);
    if (!proposalRegion || proposalRegion.annotation_number !== region.annotation_number || proposalRegion.mode !== plan.mode || proposalRegion.summary !== plan.summary || proposalRegion.production_method !== production.production_method || proposalRegion.production_origin !== production.production_origin || proposalRegion.delivery_kind !== production.delivery_kind || proposalRegion.production_label !== production.label || !atomicImageRequirementsEqual(proposalRegion.atomic_image_requirements, requirements)) errors.push(`${label}.${region.id} 与 proposal 原子需求、摘要或生产标识不一致`);
  }
  const expectedRows = deriveVisibleAnnotationRows(expected, { regions: actualRegions }); const actualRows = Array.isArray(metadata.visible_rows) ? metadata.visible_rows : [];
  if (metadata.panel_content_complete !== true || metadata.visible_row_count !== expectedRows.length || actualRows.length !== expectedRows.length) errors.push(`${label} PNG 右栏 visible_row_count/用户说明完整性元数据与全部编号不一致`);
  const fontSize = Math.max(1, Math.min(3, Math.floor(expectedTarget.height / 28))); const availableWidth = metadata.panel_width - 24;
  expectedRows.forEach((row, index) => {
    const actualRow = actualRows[index];
    if (!actualRow || actualRow.row_index !== index || actualRow.text !== row.text || actualRow.kind !== row.kind || actualRow.region_id !== row.region_id || actualRow.annotation_number !== row.annotation_number || actualRow.label !== row.label) errors.push(`${label} PNG 右栏第 ${index + 1} 行未精确呈现用户说明`);
    if (actualRow && (actualRow.top < 0 || actualRow.bottom > annotated.height || actualRow.baseline < actualRow.top || actualRow.bottom < actualRow.baseline || annotationTextWidthForValidation(actualRow.text, fontSize) > availableWidth)) errors.push(`${label} PNG 右栏第 ${index + 1} 行边界或宽度越界，禁止静默截断`);
  });
  const frameModes = new Map((metadata.region_frame_modes ?? []).map((item) => [item.region_id, item.parent_frame_drawn]));
  expected.forEach((region) => {
    const hasPlacements = normalizeAtomicComponents(region).some((component) => component.placements.length > 0);
    const expectedParentFrame = !(region.owner_type === "fixed-production-visual" && hasPlacements);
    if (frameModes.get(region.id) !== expectedParentFrame) errors.push(`${label}.${region.id} 父组合框绘制策略与 placement 原子拆解不一致`);
  });
  if (!isObject(metadata.panel_content_bounds) || metadata.panel_content_bounds.x !== metadata.original_width || metadata.panel_content_bounds.width !== metadata.panel_width || metadata.panel_content_bounds.height !== annotated.height) errors.push(`${label} PNG 右栏 panel_content_bounds 不完整`);
  if (!isObject(metadata.plan_labels) || Object.entries(PLAN_LABELS).some(([mode, text]) => metadata.plan_labels[mode] !== text)) errors.push(`${label} PNG 右栏三类实现计划图例元数据不完整`);
}

/** 与栅格渲染器保持相同中英文步进，验证用户说明不会被裁掉。 */
function annotationTextWidthForValidation(value, scale) { return [...String(value ?? "")].reduce((sum, character) => sum + (/[^\x00-\x7f]/u.test(character) ? 18 * scale : 6 * scale), 0); }

/** 读取绑定证据文件，检查项目边界、存在性和实际文件结构；摘要仅作可选记录。 */
async function loadEvidenceFile(projectRoot, label, relativePath, kind, errors) {
  try {
    const path = projectPath(projectRoot, relativePath);
    if (!isFile(path)) { errors.push(`${label} 文件不存在：${relativePath}`); return null; }
    const bytes = await readFile(path);
    if (kind === "json") {
      try {
        const value = JSON.parse(bytes.toString("utf8"));
        if (!isObject(value)) errors.push(`${label} 必须是 JSON 对象`);
        else return { value, bytes };
      } catch (error) { errors.push(`${label} 必须是可解析 JSON：${error.message}`); }
    } else if (kind === "png" && !hasMinimalPngStructure(bytes)) errors.push(`${label} 必须是包含正数 IHDR 尺寸的 PNG`);
    else if (kind === "annotation") {
      try { validateFormalAnnotationPng(bytes, { label }); } catch (error) { errors.push(`${label} 必须是完整正式 PNG 标注：${error.message}`); }
    }
    return { value: null, bytes };
  } catch (error) { errors.push(`${label}：${error.message}`); return null; }
}

/** 校验不可变复用快照的路径证据是否仍在项目内且存在。 */
function checkSnapshotPath(projectRoot, label, value, errors) {
  try { if (!isFile(projectPath(projectRoot, value))) errors.push(`${label} 文件不存在：${value}`); }
  catch (error) { errors.push(`${label}：${error.message}`); }
}

/** 校验不可变复用快照的最小身份，避免把当前机器清单伪装成历史证据。 */
export async function checkReuseSourceFiles(projectRoot, label, source, errors) {
  // 复用证据统一交给 workflow 的不可变快照门，避免资产层和工作流层各自解释两套字段。
  const context = { stage: "V3", annotation_number: "?", region_id: label, expectedMethod: "reuse", observedMethod: "reuse" };
  errors.push(...validateReuseProductionGate({ production_method: "reuse", reuse_snapshot: source, implementation_plan: { mode: "reuse-existing" } }, context, { projectRoot, checkFiles: true }));
}

/** 校验拆解提案和决定记录与当前确认的逐字段交叉绑定。 */
async function checkBitmapEvidenceFiles(projectRoot, label, region, confirmation, target, allRegions, targetBytes, canvas, errors) {
  const annotationFile = confirmation.annotation_file ?? confirmation.numbered_image_file;
  const proposal = await loadEvidenceFile(projectRoot, `${label}.confirmation.proposal_file`, confirmation.proposal_file, "json", errors);
  const decision = await loadEvidenceFile(projectRoot, `${label}.confirmation.decision_record_file`, confirmation.decision_record_file, "json", errors);
  const numbered = await loadEvidenceFile(projectRoot, `${label}.confirmation.annotation_file`, annotationFile, "annotation", errors);
  if (numbered) {
    const pairRegions = allRegions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id);
    if (!numbered.bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) errors.push(`${label}.confirmation.annotation_file 必须是生成器产出的 PNG，正式流程不接受 SVG`);
    else {
      validateAnnotatedPng(numbered.bytes, targetBytes, pairRegions, proposal?.value, `${label}.confirmation.numbered_image_file`, errors, canvas);
    }
  }
  const proposalValue = proposal?.value;
  if (proposalValue) {
    if (!nonEmptyString(proposalValue.created_at) || Number.isNaN(Date.parse(proposalValue.created_at))) errors.push(`${label}.proposal.created_at 必须是可解析时间`);
    if (proposalValue.proposal_id !== confirmation.proposal_id) errors.push(`${label}.proposal.proposal_id 与 confirmation 不一致`);
    const proposalAnnotationFile = proposalValue.annotation_file ?? proposalValue.numbered_image_file;
    const proposalAnnotationMime = proposalValue.annotation_mime ?? proposalValue.numbered_image_mime;
    if (proposalAnnotationFile !== annotationFile || proposalAnnotationMime !== "image/png") errors.push(`${label}.proposal.annotation_file/mime 必须绑定当前 PNG 标注`);
    const expectedRegions = allRegions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id);
    const proposalRegions = Array.isArray(proposalValue.visual_regions) ? proposalValue.visual_regions : (Array.isArray(proposalValue.regions) ? proposalValue.regions : (proposalValue.region_id ? [proposalValue] : []));
    const proposalById = new Map();
    for (const proposalRegion of proposalRegions) {
      if (!nonEmptyString(proposalRegion?.region_id) || proposalById.has(proposalRegion.region_id)) errors.push(`${label}.proposal.regions 必须包含唯一 region_id`);
      else proposalById.set(proposalRegion.region_id, proposalRegion);
    }
    if (proposalValue.scene_id !== region.scene_id) errors.push(`${label}.proposal.scene_id 必须绑定当前覆盖场景`);
    if (proposalValue.state_id !== region.state_id) errors.push(`${label}.proposal.state_id 必须绑定当前覆盖状态`);
    const proposalRegion = proposalById.get(region.id);
    if (!proposalRegion) errors.push(`${label}.proposal 缺少当前覆盖区域：${region.id}`);
    if (proposalRegion?.ownership_evidence !== region.ownership_evidence) errors.push(`${label}.proposal.ownership_evidence 与当前审阅证据不一致`);
    const derivedAtomicRequirements = deriveAtomicImageRequirements(region);
    if (!proposalRegion || !atomicImageRequirementsEqual(proposalRegion.atomic_image_requirements, derivedAtomicRequirements)) errors.push(`${label}.proposal.atomic_image_requirements 与状态分析派生需求不一致`);
    // PNG 标注是整组确定性证据，提案必须覆盖同一 scene/state 的全部区域。
    if (numbered && numbered.bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) && proposalRegions.length > 0 && expectedRegions.some((item) => !proposalById.has(item.id))) errors.push(`${label}.proposal 必须覆盖当前 scene/state 的全部标注区域`);
  }
  const decisionValue = decision?.value;
  // 新确认合同的 decision JSON 由共享确认器按 accepted/manual、全编号快照和实际结构统一审计；
  // 这里只保留 PNG/提案可见证据校验，避免把旧 decision_id/status 字段误当成新合同必需字段。
  if (decisionValue && confirmation.confirmation_schema !== "visual-decomposition-confirmation/1.0") {
    if (nonEmptyString(confirmation.decision_id) && decisionValue.decision_id !== confirmation.decision_id) errors.push(`${label}.decision.decision_id 与 confirmation 不一致`);
    if (decisionValue.status !== "approved") errors.push(`${label}.decision.status 必须为 approved`);
    if (decisionValue.decision_source !== "user-message") errors.push(`${label}.decision.decision_source 必须为 user-message`);
    if (!nonEmptyString(decisionValue.thread_id)) errors.push(`${label}.decision.thread_id 必须是非空字符串`);
    if (!nonEmptyString(decisionValue.work_item_id)) errors.push(`${label}.decision.work_item_id 必须是非空字符串`);
    if (nonEmptyString(confirmation.thread_id) && decisionValue.thread_id !== confirmation.thread_id) errors.push(`${label}.decision.thread_id 与 confirmation 不一致`);
    if (decisionValue.work_item_id !== confirmation.work_item_id) errors.push(`${label}.decision.work_item_id 与 confirmation 不一致`);
    if (!nonEmptyString(decisionValue.decided_by)) errors.push(`${label}.decision.decided_by 必须是非空字符串`);
    if (!nonEmptyString(decisionValue.user_statement)) errors.push(`${label}.decision.user_statement 必须是非空字符串`);
    if (!nonEmptyString(decisionValue.decided_at) || Number.isNaN(Date.parse(decisionValue.decided_at))) errors.push(`${label}.decision.decided_at 必须是可解析时间`);
    if (decisionValue.proposal_id !== confirmation.proposal_id) errors.push(`${label}.decision.proposal_id 与 confirmation 不一致`);
    if (decisionValue.region_id !== confirmation.region_id) errors.push(`${label}.decision.region_id 与 confirmation 不一致`);
    if (decisionValue.region_id !== region.id) errors.push(`${label}.decision.region_id 与覆盖区域不一致`);
    const decidedAt = Date.parse(decisionValue.decided_at); const frozenAt = Date.parse(target?.frozen_at); const proposalCreatedAt = Date.parse(proposalValue?.created_at);
    if (!Number.isNaN(frozenAt) && !Number.isNaN(decidedAt) && decidedAt < frozenAt) errors.push(`${label}.decision.decided_at 不得早于冻结时间`);
    if (!Number.isNaN(proposalCreatedAt) && !Number.isNaN(decidedAt) && decidedAt < proposalCreatedAt) errors.push(`${label}.decision.decided_at 不得早于提案 created_at`);
  }
}

/** 检查全局基线与已验收资源声明的本地文件是否存在。 */
export async function checkManifestFiles(data, projectRoot, options = {}) {
  const errors = [];
  const requestedStage = options.stage === undefined ? null : String(options.stage).toUpperCase(); if (requestedStage && !["V2", "V3", "V4"].includes(requestedStage)) errors.push("--stage 只能是 V2、V3 或 V4"); const lifecycle = data.effect_image_reconstruction?.lifecycle; const stage = requestedStage ?? (lifecycle === "v4-complete" ? "V4" : "V2");
  const isEffectImage = data.effect_image_reconstruction?.applicability === "effect-image";
  const requireAudit = isEffectImage && (["V3", "V4"].includes(stage) || lifecycle === "v4-complete"); const requireV4 = isEffectImage && (stage === "V4" || lifecycle === "v4-complete");
  // V2/V3/V4 文件门直接读取资源清单，不依赖额外草图文件。
  if (isEffectImage) errors.push(...validateVisualPostApprovalReviewFields(data, { stage }));
  const baseline = data.visual_baseline; const target = data.reference_target;
  let referenceTargetFile = null;
  if (isObject(target) && nonEmptyString(target.original_file)) {
    try {
      const path = projectPath(projectRoot, target.original_file);
      if (!isFile(path)) errors.push(`reference_target.original_file 文件不存在：${target.original_file}`);
      else {
        const bytes = await readFile(path); const realPath = nearestExistingRealPath(path);
        referenceTargetFile = { realPath, bytes };
        const dimensions = readPngDimensions(bytes);
        if (!dimensions) errors.push("reference_target.original_file 必须是完整合法 PNG");
        else if (Array.isArray(data.coverage_audit?.canvases)) for (const [index, canvas] of data.coverage_audit.canvases.entries()) if (dimensions.width !== canvas?.width || dimensions.height !== canvas?.height) errors.push(`coverage_audit.canvases[${index}] 尺寸与冻结原图 PNG 不一致`);
      }
    } catch (error) { errors.push(`reference_target.original_file：${error.message}`); }
  }
  const sourceErrors = [];
  if (data.effect_image_reconstruction?.applicability === "effect-image" && data.scene_reconstruction_contract?.layout_decomposition?.layout_source) {
    validateEffectImageLayoutBindings(data, sourceErrors, { ...options, projectRoot, forceLayoutSourceFiles: true, stage });
  }
  errors.push(...sourceErrors);
  const supplementalPaths = collectManifestFileEvidenceEntries(data);
  // 文件门把清单根身份传给共享确认器；逐组校验时再注入该组 authorityByRegion。
  const confirmationAuthority = confirmationAuthorityBase(data, projectRoot, options);
  if (requireV4) {
    errors.push(...validateVisualPostApprovalReviewFields(data, { stage: "V4" }));
    errors.push(...validateProductionAuditShape(data, { ...options, ...confirmationAuthority, projectRoot, checkFiles: true }));
    errors.push(...validateV4ProductionGateByGroups(data, { ...options, ...confirmationAuthority, projectRoot, checkFiles: true, requireEvidenceIdentity: true, identity: manifestEvidenceIdentity(data) }));
  } else if (requireAudit) {
    errors.push(...validateProductionAuditShape(data, { ...options, ...confirmationAuthority, projectRoot, checkFiles: true }));
  }
  if (requireAudit) {
    errors.push(...await auditProductionContractByGroups(data, { ...options, ...confirmationAuthority, projectRoot, checkFiles: true }));
  }
  // 文件门必须调用同一套 accepted/manual 确认硬门；只检查路径格式不能证明人工确认仍绑定当前目标。
  if (data.effect_image_reconstruction?.applicability === "effect-image") errors.push(...validateConfirmationGroups(data, { ...options, ...confirmationAuthority, projectRoot, checkFiles: true, stage }));
  if (Array.isArray(data.coverage_audit?.regions)) for (const [index, region] of data.coverage_audit.regions.entries()) {
    const label = `coverage_audit.regions[${index}]`;
    const canonicalRegion = normalizeVisualRegionDefinition(region);
    for (const conflict of getVisualRegionDefinitionAliasConflicts(region)) errors.push(`coverage_audit.regions[${index}] 区域合同别名取值冲突：${conflict.field}（${conflict.sources.join("/")}）`);
    if (canonicalRegion.owner_type === "fixed-production-visual" && isObject(canonicalRegion.state_analysis) && nonEmptyString(canonicalRegion.state_analysis.evidence)) await loadEvidenceFile(projectRoot, `coverage_audit.regions[${index}].state_analysis.evidence`, canonicalRegion.state_analysis.evidence, "file", errors);
    validateReusePlanRelation(region, label, errors);
    const productionMethod = resolveProductionContract(region).production_method;
    if (productionMethod === "reuse" && region?.implementation_plan?.mode === "reuse-existing" && isObject(region.reuse_snapshot)) await checkReuseSourceFiles(projectRoot, label, region.reuse_snapshot, errors);
    const confirmation = region?.confirmation; const isFormalConfirmation = isObject(confirmation) && confirmation.confirmation_schema === "visual-decomposition-confirmation/1.0";
    const requiresManualDecomposition = canonicalRegion.owner_type === "fixed-production-visual" && canonicalRegion.production_origin === "bitmap-decomposition" && region?.implementation_plan?.mode !== "reuse-existing";
    if (isFormalConfirmation) {
      validateManualConfirmationEvidence(confirmation, label, errors);
      if (nonEmptyString(confirmation.annotation_file)) {
        const canvas = data.coverage_audit?.canvases?.find((item) => item?.scene_id === region.scene_id && item?.state_id === region.state_id);
        await checkBitmapEvidenceFiles(projectRoot, label, region, confirmation, target, data.coverage_audit.regions, referenceTargetFile?.bytes, canvas, errors);
      }
    } else if (requiresManualDecomposition) {
      validateManualConfirmationEvidence(confirmation, label, errors);
      if (isObject(confirmation) && nonEmptyString(confirmation.annotation_file)) {
        const canvas = data.coverage_audit?.canvases?.find((item) => item?.scene_id === region.scene_id && item?.state_id === region.state_id); await checkBitmapEvidenceFiles(projectRoot, label, region, confirmation, target, data.coverage_audit.regions, referenceTargetFile?.bytes, canvas, errors);
      }
    } else if (confirmation?.mode === "USER_DECISION" && nonEmptyString(confirmation.numbered_image_file)) {
      await loadEvidenceFile(projectRoot, `${label}.confirmation.numbered_image_file`, confirmation.numbered_image_file, "png", errors);
    }
  }
  errors.push(...await checkManifestFileEvidence(supplementalPaths, { resolvePath: (path) => projectPath(projectRoot, path), isFile }));
  if (!Array.isArray(data.assets)) return errors; const independentAssetIds = new Set((Array.isArray(data.coverage_audit?.regions) ? data.coverage_audit.regions : []).filter((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "independent-production").flatMap((region) => (Array.isArray(region.asset_ids) ? region.asset_ids : [region.asset_id]).filter(nonEmptyString)));
  if (referenceTargetFile) for (const [index, asset] of data.assets.entries()) {
    if (!isObject(asset) || !independentAssetIds.has(asset.id)) continue;
    const sourcePaths = [asset.source_file, ...(Array.isArray(asset.source_files) ? asset.source_files : [])].filter(nonEmptyString);
    for (const sourcePath of sourcePaths) try {
      const resolvedSource = projectPath(projectRoot, sourcePath);
      if (!isFile(resolvedSource)) continue;
      await readFile(resolvedSource);
      const sourceRealPath = nearestExistingRealPath(resolvedSource);
      if (sourceRealPath === referenceTargetFile.realPath) errors.push(`assets[${index}] independent-production source_file/source_files 不得直接引用冻结效果图 original_file`);
    } catch (error) { errors.push(`assets[${index}].source_file/source_files：${error.message}`); }
  }
  data.assets.forEach((asset, index) => {
    if (!isObject(asset)) return; const assetPaths = []; const contract = resolveProductionContract(asset);
    if (contract.image_generation_required === true) {
      errors.push(...validateEvidenceIdentity(asset.runtime_consumption, { stage: "V2", annotation_number: asset.coverage_annotation_number ?? "?", region_id: asset.coverage_region_id ?? asset.id, expectedMethod: "image-generation", observedMethod: contract.production_method ?? "missing" }, manifestEvidenceIdentity(data), { projectRoot }));
      if (nonEmptyString(asset.source_file)) assetPaths.push(["production_contract.source_file", asset.source_file]);
      if (Array.isArray(asset.source_files)) for (const value of asset.source_files) if (nonEmptyString(value)) assetPaths.push(["production_contract.source_files", value]);
      if (nonEmptyString(asset.output_file)) assetPaths.push(["production_contract.output_file", asset.output_file]);
      if (isObject(asset.output) && nonEmptyString(asset.output.file ?? asset.output.path)) assetPaths.push(["production_contract.output.file", asset.output.file ?? asset.output.path]);
      if (Array.isArray(asset.runtime_outputs)) for (const value of asset.runtime_outputs) if (nonEmptyString(value)) assetPaths.push(["production_contract.runtime_outputs", value]);
      if (isObject(asset.generation_record) && Array.isArray(asset.generation_record.reference_inputs)) for (const value of asset.generation_record.reference_inputs) if (nonEmptyString(value)) assetPaths.push(["production_contract.generation_record.reference_inputs", value]);
    }
    if (asset.status === "accepted") {
      if (nonEmptyString(asset.source_file)) assetPaths.push(["source_file", asset.source_file]);
      if (Array.isArray(asset.source_files)) for (const value of asset.source_files) if (nonEmptyString(value)) assetPaths.push(["source_files", value]);
      for (const field of ["license_record", "cocos_evidence", "gameplay_visual_evidence"]) if (nonEmptyString(asset[field])) assetPaths.push([field, asset[field]]); for (const field of ["runtime_outputs", "consistency_evidence"]) if (Array.isArray(asset[field])) for (const value of asset[field]) if (nonEmptyString(value)) assetPaths.push([field, value]);
    }
    if (asset.route === "ai-composite-raster" && BASELINE_BOUND_STATUSES.has(asset.status) && isObject(asset.generation_record) && Array.isArray(asset.generation_record.reference_inputs)) for (const value of asset.generation_record.reference_inputs) if (nonEmptyString(value)) assetPaths.push(["generation_record.reference_inputs", value]);
    for (const [field, path] of assetPaths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`assets[${index}].${field} 文件不存在：${path}`); } catch (error) { errors.push(`assets[${index}].${field}：${error.message}`); } }
  });
  // 序列帧专用文件门读取报告并核验资源路径与实际帧结构，不要求外部摘要。
  for (const [index, asset] of data.assets.entries()) {
    if (!isObject(asset) || asset.route !== "frame-animation" || asset.status !== "accepted") continue;
    errors.push(...await checkFrameAnimationWorkflowFiles(asset, {
      label: `assets[${index}].frame_animation`,
      projectRoot,
      workItemId: data.workItemId,
      candidateVersion: data.candidateVersion,
      resolvePath: (path) => projectPath(projectRoot, path),
      isFile,
    }));
  }
  for (const [index, asset] of data.assets.entries()) {
    const contract = isObject(asset) ? resolveProductionContract(asset) : {};
    if (contract.image_generation_required !== true) continue;
    const metadata = resolveOutputMetadata(asset); if (!nonEmptyString(metadata.file)) continue;
    try {
      const outputPath = projectPath(projectRoot, metadata.file); if (!isFile(outputPath)) errors.push(`assets[${index}].production_contract.output 文件不存在：${metadata.file}`);
      else await readFile(outputPath);
    } catch (error) { errors.push(`assets[${index}].production_contract.output：${error.message}`); }
  }
  return [...new Set(errors)];
}

/** 读取 JSON 清单，并将解析错误转换为可读异常。 */
export async function loadManifest(path) {
  try { const data = JSON.parse(await readFile(path, "utf8")); if (!isObject(data)) throw new ManifestValidationError("清单根节点必须是对象"); return data; }
  catch (error) { if (error instanceof ManifestValidationError) throw error; throw new ManifestValidationError(`无法读取清单 ${path}：${error.message}`); }
}

/** 解析清单路径、项目根目录、工作项类型和文件检查开关。 */
function parseArgs(argv) {
  const args = { checkFiles: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check-files") args.checkFiles = true;
    else if (token === "--project-root") args.projectRoot = argv[++index];
    else if (token === "--stage") args.stage = String(argv[++index] ?? "").toUpperCase();
    else if (token === "--work-item-type") args.workItemType = String(argv[++index] ?? "").toUpperCase();
    else if (!args.manifest && !token.startsWith("-")) args.manifest = token;
    else throw new ManifestValidationError(`不支持的参数：${token}`);
  }
  if (!args.manifest) throw new ManifestValidationError("缺少 visual-assets.json 路径");
  return args;
}

/** 判断清单是否包含必须先完成文件证据门的效果图拆解区域。 */
function requiresBitmapFileGate(data) {
  return Array.isArray(data?.coverage_audit?.regions) && data.coverage_audit.regions.some((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "bitmap-decomposition");
}

/** 执行清单验证并以退出码表达结果。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv); const data = await loadManifest(args.manifest);
    if (!args.checkFiles && requiresBitmapFileGate(data)) { console.error("检测到 bitmap-decomposition：未运行文件证据校验，不予放行。必须使用 --stage V2 --check-files --project-root ."); return 2; }
    const errors = validateManifest(data, { stage: args.stage, checkFiles: args.checkFiles, forceLayoutSourceFiles: true, projectRoot: args.projectRoot ?? resolve(args.manifest, "..", ".."), workItemType: args.workItemType });
    if (args.checkFiles) errors.push(...await checkManifestFiles(data, args.projectRoot ?? resolve(args.manifest, "..", ".."), { stage: args.stage }));
    const uniqueErrors = [...new Set(errors)];
    if (uniqueErrors.length) { console.error("视觉资源清单无效："); for (const error of uniqueErrors) console.error(`- ${error}`); return 1; }
    console.log("视觉资源清单验证通过。"); return 0;
  } catch (error) { console.error(`视觉资源清单无效：${error.message}`); return 1; }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
