#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DPR_POLICY, IMAGE_PRODUCTION_DPR, RUNTIME_MAX_DPR, isDeviceDprInput, isImageProductionDpr, isWorkflowDpr, workflowDprError } from "../../cocos-game-workflow-control/scripts/workflow-dpr-contract.mjs";
import { DESIGN_RESOLUTIONS } from "./fixed-design-viewport.mjs";
import { layoutNodeIdentityProjection, validateEffectImageParentChildLayoutNodes } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";
import { resolveVisualValidationMode, validateVisualValidationPolicy } from "../../cocos-game-workflow-control/scripts/visual-validation-policy.mjs";
import { matchesRepresentativeViewport, measuredOrientation, resolveOrientationCoverage } from "../../cocos-game-workflow-control/scripts/orientation-validation-scope.mjs";
import { validateUiInteractionTree, validateUiLayout } from "../../cocos-game-asset-integration/scripts/ui-layout-organization.mjs";
import { hasSpriteRendering } from "./display-node-role.mjs";
import { validateLayoutRuntimeSnapshots } from "./widget-runtime.mjs";

const ROOT_REQUIRED = ["schema_version", "contract_id", "contract_version", "scope", "fidelity", "frozen_visual_target", "logicalViewportSpace", "designResolutionPolicy", "canvasBackingPolicy", "runtimeDprPolicy", "maxRuntimeDpr", "scaleMode", "cameraViewportPolicy", "cameraZoomPolicy", "cameraOriginPolicy", "inputCoordinatePolicy", "safeAreaPolicy", "resizePolicy", "orientationPolicy", "textResolutionPolicy", "assetResolutionPolicy", "performanceBudget", "representativeViewports", "requiredRuntimeEvidence", "targets", "coordinate_spaces", "regions", "layout_nodes", "content", "platform_insets", "scrolling", "dynamic_content", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases", "evidence_matrix"];
const REQUIRED_EVIDENCE_AXES = new Set(["breakpoint-neighbors", "width", "height", "orientation", "text-scale", "localization", "safe-area", "action-state", "dpr", "dynamic-values", "scene-lifecycle", "overlay-keyboard-scroll"]);
const REQUIRED_PROGRAMMATIC_TEXT_LANGUAGES = ["en", "zh-CN", "ja", "ru", "es"];
const REQUIRED_RUNTIME_EVIDENCE_FIELDS = ["viewportRect", "canvasRect", "designTransform", "logicalSize", "backingSize", "cssDisplaySize", "rawDevicePixelRatio", "effectiveDevicePixelRatio", "logicalToCssScale", "cssToPhysicalScale", "cameraViewport", "cameraZoom", "cameraOrigin", "safeArea", "edgeGaps", "backgroundCoverage", "keyUiRects", "inputHitResults", "resizeTrajectory", "pageReloaded", "screenshot", "sceneId", "stateId", "layoutContractVersion", "visualBaselineVersion"];

/** 判断值是否为合同允许的对象类型。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断字符串是否包含实际内容。 */
function isString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 判断合同是否显式声明效果图还原，供各阶段共用同一冻结语义。 */
function isEffectImageContract(document) { return document?.effect_image_reconstruction?.applicability === "effect-image"; }
/** 判断数值字段类型。 */
function isNumber(value) { return typeof value === "number" && Number.isFinite(value); }
/** 判断尺寸是正数或有意义的表达式。 */
function isDimension(value) { return (isNumber(value) && value > 0) || isString(value); }
/** 判断断点条件值是否有效。 */
function isCondition(value) { return (isNumber(value) && value >= 0) || isString(value); }
/** 只追加一次诊断，保证命令输出稳定。 */
function appendUnique(items, value) { if (!items.includes(value)) items.push(value); }

/** 将合同值按键排序后规范化，确保身份哈希不受 JSON 字段书写顺序影响。 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

/**
 * 计算布局合同的稳定身份哈希。
 *
 * 只纳入会改变布局身份的声明字段，排除 layout_contract_sha256 自身、
 * critical/parity 运行证据等易变内容，避免把合同文件做递归自哈希。
 */
export function computeLayoutContractSha256(document) {
  const binding = document?.scene_reconstruction_binding ?? document?.sceneReconstructionBinding ?? {};
  // 布局节点数组的顺序继承已确认拆解元素；身份哈希不能排序后再计算，否则调序会复用旧确认。
  const nodes = (Array.isArray(document?.layout_nodes) ? document.layout_nodes : []).filter(isObject).map(layoutNodeIdentityProjection);
  const projection = {
    contract_id: document?.contract_id ?? null,
    contract_version: document?.contract_version ?? null,
    design_resolution_policy: document?.designResolutionPolicy ?? null,
    target_sha256: binding?.target_sha256 ?? null,
    scene_id: binding?.scene_id ?? null,
    state_id: binding?.state_id ?? null,
    target_viewport: binding?.target_viewport ?? null,
    visual_baseline_version: binding?.visual_baseline_version ?? null,
    reconstruction_contract_version: binding?.reconstruction_contract_version ?? null,
    layout_decomposition_version: binding?.layout_decomposition_version ?? null,
    // 布局标注图是拆解确认后的独立产物；其文件、元数据和上游身份变化必须让布局合同失效。
    layout_annotation: isObject(document?.layout_annotation) ? {
      layout_annotation_sha256: document.layout_annotation.layout_annotation_sha256 ?? null,
      layout_annotation_width: document.layout_annotation.layout_annotation_width ?? null,
      layout_annotation_height: document.layout_annotation.layout_annotation_height ?? null,
      layout_annotation_schema: document.layout_annotation.layout_annotation_schema ?? null,
      layout_annotation_layout: document.layout_annotation.layout_annotation_layout ?? null,
      layout_annotation_metadata_sha256: document.layout_annotation.layout_annotation_metadata_sha256 ?? null,
      layout_annotation_identity_sha256: document.layout_annotation.layout_annotation_identity_sha256 ?? null,
      layout_review_file: document.layout_annotation.layout_review_file ?? null,
      layout_review_sha256: document.layout_annotation.layout_review_sha256 ?? null,
      layout_review_identity_sha256: document.layout_annotation.layout_review_identity_sha256 ?? null,
      layout_nodes_file: document.layout_annotation.layout_nodes_file ?? null,
      layout_nodes_sha256: document.layout_annotation.layout_nodes_sha256 ?? null,
      decomposition_confirmation_id: document.layout_annotation.decomposition_confirmation_id ?? null,
      decomposition_confirmation_sha256: document.layout_annotation.decomposition_confirmation_sha256 ?? null,
      proposal_sha256: document.layout_annotation.proposal_sha256 ?? null,
      layout_decision_file: document.layout_annotation.layout_decision_file ?? null,
      layout_decision_sha256: document.layout_annotation.layout_decision_sha256 ?? null,
      layout_decision_id: document.layout_annotation.layout_decision_id ?? null,
      target_sha256: document.layout_annotation.target_sha256 ?? null,
      scene_id: document.layout_annotation.scene_id ?? null,
      state_id: document.layout_annotation.state_id ?? null,
      layout_node_ids: Array.isArray(document.layout_annotation.layout_node_ids) ? document.layout_annotation.layout_node_ids.slice() : null,
    } : null,
    layout_nodes: nodes,
  };
  const digest = createHash("sha256").update(JSON.stringify(canonicalize(projection))).digest("hex");
  return `sha256:${digest}`;
}

/** 语义别名：供需要表达“稳定身份哈希”而非文件哈希的调用方复用。 */
export const computeLayoutContractIdentityHash = computeLayoutContractSha256;

/** 验证根对象和根字段。 */
function validateRoot(document, errors) {
  if (!isObject(document)) { errors.push("根对象必须是 JSON 对象"); return; }
  for (const field of ROOT_REQUIRED) if (!(field in document)) errors.push(`缺少根字段：${field}`);
  for (const field of ["schema_version", "contract_id", "contract_version"]) if (field in document && !isString(document[field])) errors.push(`字段 ${field} 必须是非空字符串`);
  if (document.schema_version !== "1.2.0") errors.push("schema_version 必须为 1.2.0");
  for (const field of ["coordinate_spaces", "regions", "layout_nodes", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases", "representativeViewports"]) if (field in document && !Array.isArray(document[field])) errors.push(`字段 ${field} 必须是数组`);
  for (const field of ["scope", "fidelity", "targets", "content", "platform_insets", "scrolling", "dynamic_content", "evidence_matrix", "logicalViewportSpace", "designResolutionPolicy", "canvasBackingPolicy", "runtimeDprPolicy", "cameraViewportPolicy", "cameraZoomPolicy", "cameraOriginPolicy", "inputCoordinatePolicy", "safeAreaPolicy", "resizePolicy", "orientationPolicy", "textResolutionPolicy", "assetResolutionPolicy", "performanceBudget", "requiredRuntimeEvidence"]) if (field in document && !isObject(document[field])) errors.push(`字段 ${field} 必须是对象`);
}

/** 验证布局忠实度的适用范围和 specified/verified 生命周期。 */
function validateFidelityLifecycle(document, errors) {
  const fidelity = document.fidelity;
  if (!isObject(fidelity)) return null;
  if (isEffectImageContract(document) && fidelity.applicability !== "frozen-target") errors.push("effect-image 必须使用 fidelity.applicability=frozen-target");
  if (fidelity.applicability === "not-applicable") {
    if (fidelity.status !== "not-applicable") errors.push("普通布局 fidelity.status 必须为 not-applicable");
    if (document.frozen_visual_target != null) errors.push("普通布局不得声明 frozen_visual_target");
    for (const field of ["layout_nodes", "critical_alignments", "parity_cases"]) if (!Array.isArray(document[field]) || document[field].length > 0) errors.push(`普通布局 ${field} 必须为空数组`);
    return fidelity;
  }
  if (fidelity.applicability !== "frozen-target") errors.push("fidelity.applicability 必须为 not-applicable 或 frozen-target");
  if (!["specified", "verified"].includes(fidelity.status)) errors.push("frozen-target fidelity.status 必须为 specified 或 verified");
  return fidelity;
}

/** 验证冻结视觉目标身份，供关键对齐与 parity case 共用。 */
function validateFrozenVisualTarget(target, errors) {
  if (!isObject(target)) { errors.push("frozen_visual_target 必须是对象"); return; }
  for (const field of ["candidate_id", "original_file", "visual_baseline_version"]) if (!isString(target[field])) errors.push(`frozen_visual_target.${field} 必须是非空字符串`);
  if (target.status !== "frozen") errors.push("frozen_visual_target.status 必须为 frozen");
}

/** 校验效果图还原布局必须绑定 target、scene/state 和场景合同版本。 */
function validateSceneReconstructionBinding(document, fidelity, errors) {
  const binding = document.scene_reconstruction_binding ?? document.sceneReconstructionBinding;
  const requiresSceneBinding = fidelity?.applicability === "frozen-target" || isEffectImageContract(document);
  // frozen-target 的布局关系是场景还原合同的一部分；普通布局保持 not-applicable 语义。
  if (binding === undefined) {
    if (requiresSceneBinding) errors.push("scene_reconstruction_binding 缺失：frozen-target/effect-image 必须绑定场景还原合同");
    return null;
  }
  if (!isObject(binding)) { errors.push("scene_reconstruction_binding 必须是对象"); return null; }
  for (const field of ["scene_id", "state_id", "visual_baseline_version", "reconstruction_contract_version", "layout_decomposition_version"]) if (!isString(binding[field])) errors.push(`scene_reconstruction_binding.${field} 必须是非空字符串`);
  if (document.frozen_visual_target?.visual_baseline_version && binding.visual_baseline_version !== document.frozen_visual_target.visual_baseline_version) errors.push("scene_reconstruction_binding.visual_baseline_version 未绑定当前冻结目标");
  if (!isObject(binding.target_viewport) || !isNumber(binding.target_viewport.width) || !isNumber(binding.target_viewport.height) || binding.target_viewport.width <= 0 || binding.target_viewport.height <= 0) errors.push("scene_reconstruction_binding.target_viewport 必须包含精确正数尺寸");
  if (binding.legacy_layout_reused === true || binding.uses_generic_layout === true) errors.push("scene_reconstruction_binding 禁止使用与冻结效果图不一致的旧通用布局");
  return binding;
}

/** 验证四边几何测量均来自实际目标或运行态。 */
function validateMeasurement(value, label, errors) {
  if (!isObject(value) || !["x", "y", "width", "height"].every((field) => isNumber(value[field])) || value.width <= 0 || value.height <= 0) errors.push(`${label} 必须包含数值 x/y 和正数 width/height`);
}

/** 验证运行时与目标几何的差值；差值允许为负数或零。 */
function validateDelta(value, label, errors) {
  if (!isObject(value) || !["x", "y", "width", "height"].every((field) => isNumber(value[field]))) errors.push(`${label} 必须包含数值 x/y/width/height 差值`);
}

/** 验证冻结视觉目标下的关键 UI/HUD 对齐合同。 */
function validateCriticalAlignments(items, ids, layoutNodes, status, errors, mode = "usability") {
  const exact = mode === "exact";
  if (!Array.isArray(items) || items.length === 0) { errors.push("critical_alignments 必须是非空数组"); return; }
  const alignmentIds = new Set();
  items.forEach((item, index) => {
    const label = `critical_alignments[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    // 可用性模式不自动要求像素矩阵，但项目已声明的关键几何容差必须兑现。
    const declaredTolerance = Object.hasOwn(item, "tolerance");
    const enforceGeometry = exact || declaredTolerance;
    for (const field of ["id", "layout_node_id", "element_id", "reference_id", "planned_test_id"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (isString(item.id)) { if (alignmentIds.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); alignmentIds.add(item.id); }
    if (!ids.has(item.element_id)) errors.push(`${label}.element_id 引用未知 UI ID：${item.element_id}`);
    const layoutNode = isString(item.layout_node_id) ? layoutNodes.nodesById.get(item.layout_node_id) : undefined;
    if (!layoutNode) errors.push(`${label}.layout_node_id 引用未知布局节点：${item.layout_node_id}`);
    else if (item.element_id !== layoutNode.region_id) errors.push(`${label}.element_id 必须绑定 layout_node_id 对应的 region_id`);
    const referenceNodeIds = isString(item.reference_id) ? (layoutNodes.regionNodeIds.get(item.reference_id) ?? []) : [];
    if (item.reference_id !== "viewport" && !ids.has(item.reference_id) && !layoutNodes.nodeIds.has(item.reference_id)) errors.push(`${label}.reference_id 引用未知 UI ID/稳定参照：${item.reference_id}`);
    if (referenceNodeIds.length > 1) errors.push(`${label}.reference_id 指向包含多个 layout_nodes 的 region，必须改为具体 layout_node_id：${item.reference_id}`);
    for (const axis of ["horizontal", "vertical"]) {
      const relation = item[axis];
      if (!isObject(relation)) errors.push(`${label}.${axis} 缺少关系`);
      else for (const field of ["type", "element_anchor", "reference_anchor"]) if (!isString(relation[field])) errors.push(`${label}.${axis}.${field} 必须是非空字符串`);
    }
    if (enforceGeometry || item.target_measurement != null) validateMeasurement(item.target_measurement, `${label}.target_measurement`, errors);
    if (enforceGeometry && layoutNode && item.target_measurement != null && !sameBounds(item.target_measurement, layoutNode.target_bounds)) errors.push(`${label}.target_measurement 与绑定布局节点 target_bounds 不一致，存在目标几何漂移`);
    if (!Array.isArray(item.target_evidence) || item.target_evidence.length === 0 || !item.target_evidence.every(isString)) errors.push(`${label}.target_evidence 必须是非空字符串数组`);
    const runtimeMeasurement = item.runtime_measurement ?? item.actual_bounds;
    if (status === "verified") {
      if (!isString(item.actual_test_id)) errors.push(`${label}.actual_test_id 必须是非空字符串`);
      else if (item.actual_test_id !== item.planned_test_id) errors.push(`${label}.actual_test_id 必须等于 planned_test_id`);
      validateMeasurement(runtimeMeasurement, `${label}.runtime_measurement`, errors);
      if (exact || item.delta != null) validateDelta(item.delta, `${label}.delta`, errors);
      if (isObject(item.target_measurement) && isObject(runtimeMeasurement) && isObject(item.delta) && ["x", "y", "width", "height"].every((field) => isNumber(item.target_measurement[field]) && isNumber(runtimeMeasurement[field]) && isNumber(item.delta[field]))) {
        if (enforceGeometry) for (const field of ["x", "y", "width", "height"]) if (item.delta[field] !== runtimeMeasurement[field] - item.target_measurement[field]) errors.push(`${label}.delta.${field} 必须等于 runtime_measurement 与 target_measurement 的差值`);
      }
      if (item.test_status !== "passed") errors.push(`${label}.test_status 必须为 passed，未执行测试不得通过`);
      if (!Array.isArray(item.runtime_evidence) || item.runtime_evidence.length === 0 || !item.runtime_evidence.every(isString)) errors.push(`${label}.runtime_evidence 必须是非空字符串数组`);
    } else {
      if (runtimeMeasurement != null) validateMeasurement(runtimeMeasurement, `${label}.runtime_measurement`, errors);
      if (item.delta != null) validateDelta(item.delta, `${label}.delta`, errors);
    }
    if (enforceGeometry) validateAlignmentTolerance(item, runtimeMeasurement, status, label, errors);
  });
}

/** 直接比较同坐标空间的实测矩形，不允许手写 passed 或伪造 delta 掩盖关键布局偏差。 */
function validateAlignmentTolerance(item, runtimeMeasurement, status, label, errors) {
  const tolerance = item.tolerance;
  if (!isObject(tolerance) || !isNumber(tolerance.value) || tolerance.value < 0) {
    errors.push(`${label}.tolerance 必须是项目定义的 unit 与非负 value`);
    return;
  }
  if (!["px", "logical-px", "css-px", "css-logical-px"].includes(tolerance.unit)) {
    errors.push(`${label}.tolerance.unit 必须是同一布局坐标空间的像素单位`);
    return;
  }
  if (status !== "verified" || !isObject(item.target_measurement) || !isObject(runtimeMeasurement)) return;
  for (const field of ["x", "y", "width", "height"]) {
    const targetValue = item.target_measurement[field];
    const actualValue = runtimeMeasurement[field];
    if (isNumber(targetValue) && isNumber(actualValue) && Math.abs(actualValue - targetValue) > tolerance.value) {
      errors.push(`${label}.runtime_measurement.${field} 超出声明容差 ${tolerance.value}${tolerance.unit}`);
    }
  }
}

/** 验证布局 parity case 绑定同一目标、候选和可复现条件。 */
function validateParityCases(items, scope, contractVersion, target, errors, mode = "usability", coverage = null) {
  const exact = mode === "exact";
  if (!Array.isArray(items) || items.length === 0) { if (exact) errors.push("parity_cases 必须是非空数组"); return; }
  const ids = new Set();
  items.forEach((item, index) => {
    const label = `parity_cases[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "scene_id", "state_id", "language", "input_trace", "sample_rule", "layout_contract_version", "visual_baseline_version", "conclusion"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (!scope?.scenes?.includes(item.scene_id)) errors.push(`${label}.scene_id 不在 scope.scenes 范围内`);
    if (!scope?.states?.includes(item.state_id)) errors.push(`${label}.state_id 不在 scope.states 范围内`);
    if (item.layout_contract_version !== contractVersion) errors.push(`${label}.layout_contract_version 与根 contract_version 不一致`);
    if (item.visual_baseline_version !== target?.visual_baseline_version) errors.push(`${label}.visual_baseline_version 与冻结目标不一致`);
    if (!isObject(item.viewport) || !isNumber(item.viewport.width) || item.viewport.width <= 0 || !isNumber(item.viewport.height) || item.viewport.height <= 0) errors.push(`${label}.viewport 必须包含正数 width/height`);
    else if (coverage && !coverage.orientations.includes(measuredOrientation(item.viewport))) errors.push(`${label}.viewport 的方向超出 orientationPolicy.allowed 支持范围`);
    if (!isWorkflowDpr(item.dpr)) errors.push(`${label}.${workflowDprError("dpr", item.dpr)}`);
    if (!(Number.isInteger(item.random_seed) || isString(item.random_seed))) errors.push(`${label}.random_seed 必须是整数或非空字符串`);
    for (const field of ["reference_evidence", "candidate_evidence"]) if (!Array.isArray(item[field]) || item[field].length === 0 || !item[field].every(isString)) errors.push(`${label}.${field} 必须是非空字符串数组`);
    if (exact && (!isObject(item.tolerance) || !isString(item.tolerance.unit) || !isNumber(item.tolerance.value) || item.tolerance.value < 0)) errors.push(`${label}.tolerance 必须是项目定义的 unit 与非负 value`);
    if (!Array.isArray(item.exception_ids) || !item.exception_ids.every(isString)) errors.push(`${label}.exception_ids 必须是字符串数组`);
    if (!["passed", "failed"].includes(item.conclusion)) errors.push(`${label}.conclusion 必须为 passed 或 failed`);
    if (isString(item.id)) { if (ids.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); ids.add(item.id); }
  });
}

/** 验证候选绑定和稳定 UI ID。 */
function validateScope(scope, errors) {
  if (!isObject(scope)) return;
  for (const field of ["scenes", "states", "ui_ids"]) if (!Array.isArray(scope[field]) || scope[field].length === 0) errors.push(`scope.${field} 必须是非空数组`);
  if (Array.isArray(scope.ui_ids)) { const seen = new Set(); for (const item of scope.ui_ids) { if (!isString(item)) errors.push("scope.ui_ids 只能包含非空字符串"); else if (seen.has(item)) errors.push(`重复 UI ID：${item}`); else seen.add(item); } }
  for (const field of ["owner", "reviewer"]) if (!isString(scope[field])) errors.push(`scope.${field} 必须是非空字符串`);
  if (!isObject(scope.bindings) || Object.keys(scope.bindings).length === 0) errors.push("scope.bindings 必须是非空对象");
  else for (const field of ["gdd", "tdd", "low_fidelity_candidate", "visual_baseline"]) if (!isString(scope.bindings[field])) errors.push(`scope.bindings.${field} 必须是非空字符串`);
}

/** 确保范围声明与区域集合完全一致。 */
function validateScopeRegionIds(scope, regionIds, errors) {
  if (!isObject(scope) || !Array.isArray(scope.ui_ids)) return;
  const declared = new Set(scope.ui_ids.filter(isString));
  const missing = [...regionIds].filter((id) => !declared.has(id)).sort(); const extra = [...declared].filter((id) => !regionIds.has(id)).sort();
  if (missing.length) errors.push(`scope.ui_ids 缺少 regions ID：${missing.join(", ")}`); if (extra.length) errors.push(`scope.ui_ids 包含未声明 regions ID：${extra.join(", ")}`);
}

/** 验证目标视口和方向范围；缩放、DPR 与相机关系由响应式合同统一验证。 */
function validateTargets(targets, errors, coverage) {
  if (!isObject(targets)) return;
  for (const name of ["min", "preferred", "max"]) { const target = targets[name]; if (!isObject(target)) { errors.push(`targets.${name} 必须是对象`); continue; } for (const dimension of ["width", "height"]) if (!isNumber(target[dimension]) || target[dimension] <= 0) errors.push(`targets.${name}.${dimension} 必须是正数`); if (!isString(target.orientation)) errors.push(`targets.${name}.orientation 必须是非空字符串`); else { if (!coverage.orientations.includes(target.orientation)) errors.push(`targets.${name}.orientation 不在 orientationPolicy.allowed 支持范围内`); const actualOrientation = measuredOrientation(target); if (actualOrientation && target.orientation !== actualOrientation) errors.push(`targets.${name}.orientation 与 width/height 实测方向不一致`); } }
  if (!Array.isArray(targets.orientations) || targets.orientations.length === 0) errors.push("targets.orientations 必须是非空数组");
  else {
    const orientations = targets.orientations.filter(isString);
    if (orientations.length !== targets.orientations.length) errors.push("targets.orientations 只能包含非空方向字符串");
    if (new Set(orientations).size !== orientations.length) errors.push("targets.orientations 不得重复");
    if (coverage.errors.length === 0 && (orientations.length !== coverage.orientations.length || coverage.orientations.some((orientation) => !orientations.includes(orientation)))) errors.push("targets.orientations 必须与 orientationPolicy.allowed 一致");
  }
  if (!isObject(targets.aspect_ratio)) errors.push("targets.aspect_ratio 必须是对象"); else { const { min, max } = targets.aspect_ratio; if (!isNumber(min) || min <= 0) errors.push("targets.aspect_ratio.min 必须是正数"); if (!isNumber(max) || max <= 0) errors.push("targets.aspect_ratio.max 必须是正数"); if (isNumber(min) && isNumber(max) && min > max) errors.push("targets.aspect_ratio.min 不能大于 max"); }
}

/** 校验对象必填字段并返回对象状态，确保缺字段诊断稳定且可定位。 */
function requireObjectFields(value, label, fields, errors) {
  if (!isObject(value)) { errors.push(`${label} 必须是对象`); return false; }
  for (const field of fields) if (!(field in value)) errors.push(`${label} 缺少字段：${field}`);
  return true;
}

/** 校验数组是否覆盖一组不可省略的响应式事件或证据字段。 */
function requireArrayIncludes(value, label, required, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isString)) { errors.push(`${label} 必须是非空字符串数组`); return false; }
  const missing = required.filter((item) => !value.includes(item));
  if (missing.length) errors.push(`${label} 缺少必需项：${missing.join(", ")}`);
  return missing.length === 0;
}

/** 固定设计稿只锁定项目支持方向的主轴基准，背景独立等比铺满。 */
function validateDesignResolutionPolicy(policy, orientations, errors) {
  if (!requireObjectFields(policy, "designResolutionPolicy", ["canvasFit", "crossAxis", "backgroundFit"], errors)) return;
  for (const orientation of orientations) {
    const actual = policy[orientation];
    const expected = DESIGN_RESOLUTIONS[orientation];
    if (!isObject(actual) || actual.width !== expected.width || actual.height !== expected.height || actual.fitAxis !== expected.fitAxis) {
      errors.push(`designResolutionPolicy.${orientation} 必须为 ${expected.width}×${expected.height} 且按 ${expected.fitAxis} 适配`);
    }
  }
  if (policy.canvasFit !== "fill-viewport") errors.push("designResolutionPolicy.canvasFit 必须为 fill-viewport，禁止画布黑边");
  if (policy.crossAxis !== "extend-or-crop") errors.push("designResolutionPolicy.crossAxis 必须为 extend-or-crop");
  const background = policy.backgroundFit;
  if (!isObject(background) || background.mode !== "cover-v1") errors.push("designResolutionPolicy.backgroundFit.mode 必须为 cover-v1，背景需等比覆盖可见视口");
  for (const field of ["sourceFocalPoint", "targetPoint"]) {
    const point = background?.[field];
    if (!isObject(point) || ![point.x, point.y].every((value) => isNumber(value) && value >= 0 && value <= 1)) {
      errors.push(`designResolutionPolicy.backgroundFit.${field} 必须包含 [0,1] 内的 x/y`);
    }
  }
}

/** 只有项目明确支持两种方向时，才要求方向切换事件；其他事件仍按原合同强制。 */
function requireResponsiveEvents(value, label, required, coverage, errors) {
  const requiredEvents = required.filter((event) => event !== "orientation-change");
  if (coverage.requiresOrientationChange) requiredEvents.push("orientation-change");
  requireArrayIncludes(value, label, requiredEvents, errors);
}

/** 验证高分屏布局的统一坐标、DPR、Camera、输入和 resize 合同。 */
function validateResponsiveContract(document, errors, coverage) {
  validateDesignResolutionPolicy(document.designResolutionPolicy, coverage.orientations, errors);
  const logical = document.logicalViewportSpace;
  if (requireObjectFields(logical, "logicalViewportSpace", ["unit", "layoutSpace", "gameSizeSpace", "safeAreaSpace", "source", "coordinateOrigin"], errors)) {
    if (logical.unit !== "css-px") errors.push("logicalViewportSpace.unit 必须为 css-px，布局合同禁止使用物理像素");
    for (const field of ["layoutSpace", "gameSizeSpace", "safeAreaSpace"]) if (logical[field] !== "css-logical-px") errors.push(`logicalViewportSpace.${field} 必须为 css-logical-px`);
    if (logical.source !== "canvas-css-client-rect") errors.push("logicalViewportSpace.source 必须来自 CSS 逻辑尺寸而非 backing 像素");
    if (logical.coordinateOrigin !== "top-left") errors.push("logicalViewportSpace.coordinateOrigin 必须明确为 top-left");
  }

  const backing = document.canvasBackingPolicy;
  if (requireObjectFields(backing, "canvasBackingPolicy", ["cssSpace", "backingSpace", "relation", "widthFormula", "heightFormula", "effectiveDprSource", "rounding", "updatesOn", "physicalPixelLayout", "maxBackingSource"], errors)) {
    if (backing.cssSpace !== "css-logical-px") errors.push("canvasBackingPolicy.cssSpace 必须为 css-logical-px");
    if (backing.backingSpace !== "physical-px") errors.push("canvasBackingPolicy.backingSpace 必须明确为 physical-px");
    for (const field of ["relation", "widthFormula", "heightFormula"]) if (!isString(backing[field]) || !/css|logical/i.test(backing[field]) || !/effective(?:devicepixelratio|dpr)/i.test(backing[field])) errors.push(`canvasBackingPolicy.${field} 必须表达 backing=CSS逻辑尺寸×effectiveDPR`);
    if (backing.effectiveDprSource !== "runtimeDprPolicy") errors.push("canvasBackingPolicy.effectiveDprSource 必须引用 runtimeDprPolicy");
    if (backing.rounding !== "ceil") errors.push("canvasBackingPolicy.rounding 必须为 ceil");
    requireResponsiveEvents(backing.updatesOn, "canvasBackingPolicy.updatesOn", ["resize", "dpr-change"], coverage, errors);
    if (backing.physicalPixelLayout !== "forbidden") errors.push("canvasBackingPolicy.physicalPixelLayout 必须为 forbidden，不能用物理像素硬编码布局");
    if (backing.maxBackingSource !== "performanceBudget.maxCanvasBacking") errors.push("canvasBackingPolicy.maxBackingSource 必须引用 performanceBudget.maxCanvasBacking");
  }

  const runtimeDpr = document.runtimeDprPolicy;
  if (requireObjectFields(runtimeDpr, "runtimeDprPolicy", ["policy", "source", "invalidInput", "invalidFallback", "minExclusive", "maxInclusive", "refreshOn", "notStartupOnly", "listenerCleanup"], errors)) {
    if (runtimeDpr.policy !== DPR_POLICY) errors.push(`runtimeDprPolicy.policy 必须为 ${DPR_POLICY}`);
    if (runtimeDpr.source !== "device-dynamic") errors.push("runtimeDprPolicy.source 必须为 device-dynamic，禁止只在启动时读取");
    if (runtimeDpr.invalidInput !== "fallback-to-1" || runtimeDpr.invalidFallback !== 1) errors.push("runtimeDprPolicy 必须声明非法 DPR 回退为 1");
    if (runtimeDpr.minExclusive !== 0 || runtimeDpr.maxInclusive !== RUNTIME_MAX_DPR) errors.push(`runtimeDprPolicy 必须限制在 (0, ${RUNTIME_MAX_DPR}]`);
    requireResponsiveEvents(runtimeDpr.refreshOn, "runtimeDprPolicy.refreshOn", ["resize", "display-density-change"], coverage, errors);
    if (runtimeDpr.notStartupOnly !== true) errors.push("runtimeDprPolicy.notStartupOnly 必须为 true");
    if (runtimeDpr.listenerCleanup !== "required") errors.push("runtimeDprPolicy.listenerCleanup 必须为 required");
    for (const legacyField of ["productionDpr", "imageProductionDpr", "assetDpr"]) if (legacyField in runtimeDpr) errors.push(`runtimeDprPolicy.${legacyField} 不得混入图片生产 DPR，运行时与资源生产必须分离`);
  }
  if (document.maxRuntimeDpr !== RUNTIME_MAX_DPR || typeof document.maxRuntimeDpr !== "number") errors.push(`maxRuntimeDpr 必须严格为 ${RUNTIME_MAX_DPR}`);

  if (!["FIXED_WIDTH", "FIXED_HEIGHT", "custom"].includes(document.scaleMode)) errors.push("scaleMode 必须为 FIXED_WIDTH、FIXED_HEIGHT 或 custom，并让 Canvas 填满真实 CSS 视口");

  const cameraViewport = document.cameraViewportPolicy;
  if (requireObjectFields(cameraViewport, "cameraViewportPolicy", ["coordinateSpace", "gameSizeSpace", "physicalMapping", "requiresExplicitViewport", "popupInheritance"], errors)) {
    if (cameraViewport.coordinateSpace !== "css-logical-px" || cameraViewport.gameSizeSpace !== "css-logical-px") errors.push("cameraViewportPolicy 必须在 css-logical-px 中声明 viewport 与 gameSize");
    if (!/logical/i.test(cameraViewport.physicalMapping) || !/physical/i.test(cameraViewport.physicalMapping)) errors.push("cameraViewportPolicy.physicalMapping 必须明确逻辑坐标到物理 backing 的映射");
    if (cameraViewport.requiresExplicitViewport !== true) errors.push("cameraViewportPolicy.requiresExplicitViewport 必须为 true");
    if (cameraViewport.popupInheritance !== "inherit-host-viewport") errors.push("cameraViewportPolicy.popupInheritance 必须声明 DISPLAY_LAYER 继承宿主视口");
  }

  const cameraZoom = document.cameraZoomPolicy;
  if (requireObjectFields(cameraZoom, "cameraZoomPolicy", ["coordinateSpace", "defaultZoom", "dprIndependent", "resizeBehavior", "popupInheritance"], errors)) {
    if (cameraZoom.coordinateSpace !== "css-logical-px") errors.push("cameraZoomPolicy.coordinateSpace 必须为 css-logical-px");
    if (!isNumber(cameraZoom.defaultZoom) || cameraZoom.defaultZoom <= 0) errors.push("cameraZoomPolicy.defaultZoom 必须为正数");
    if (cameraZoom.dprIndependent !== true) errors.push("cameraZoomPolicy.dprIndependent 必须为 true，zoom 不得偷换 DPR");
    if (cameraZoom.resizeBehavior !== "preserve-logical-size") errors.push("cameraZoomPolicy.resizeBehavior 必须保持逻辑尺寸");
    if (cameraZoom.popupInheritance !== "inherit-host-zoom") errors.push("cameraZoomPolicy.popupInheritance 必须声明 DISPLAY_LAYER 的宿主继承关系");
  }

  const cameraOrigin = document.cameraOriginPolicy;
  if (requireObjectFields(cameraOrigin, "cameraOriginPolicy", ["uiOrigin", "worldOrigin", "popupOrigin", "implicitOrigin"], errors)) {
    if (cameraOrigin.uiOrigin !== "top-left") errors.push("cameraOriginPolicy.uiOrigin 必须明确为 top-left");
    if (!isString(cameraOrigin.worldOrigin) || cameraOrigin.worldOrigin === "implicit") errors.push("cameraOriginPolicy.worldOrigin 必须显式声明场景原点");
    if (cameraOrigin.popupOrigin !== "inherit-host-origin") errors.push("cameraOriginPolicy.popupOrigin 必须声明 DISPLAY_LAYER 继承宿主原点");
    if (cameraOrigin.implicitOrigin !== "forbidden") errors.push("cameraOriginPolicy.implicitOrigin 必须为 forbidden");
  }

  const input = document.inputCoordinatePolicy;
  if (requireObjectFields(input, "inputCoordinatePolicy", ["source", "mapping", "hitTestSpace", "dprAware", "cameraAware", "physicalPixelInput", "popupInheritance"], errors)) {
    if (input.source !== "css-client-pixels") errors.push("inputCoordinatePolicy.source 必须为 css-client-pixels");
    if (!/css/i.test(input.mapping) || !/logical/i.test(input.mapping) || !/camera|world/i.test(input.mapping)) errors.push("inputCoordinatePolicy.mapping 必须完整声明 CSS→逻辑→Camera/World 映射");
    if (input.hitTestSpace !== "css-logical-px") errors.push("inputCoordinatePolicy.hitTestSpace 必须为 css-logical-px");
    if (input.dprAware !== true || input.cameraAware !== true) errors.push("inputCoordinatePolicy 必须同时声明 dprAware 和 cameraAware");
    if (input.physicalPixelInput !== "forbidden") errors.push("inputCoordinatePolicy.physicalPixelInput 必须为 forbidden");
    if (input.popupInheritance !== "inherit-host-input-contract") errors.push("inputCoordinatePolicy.popupInheritance 必须声明 DISPLAY_LAYER 输入合同继承");
  }

  const safeArea = document.safeAreaPolicy;
  if (requireObjectFields(safeArea, "safeAreaPolicy", ["coordinateSpace", "source", "zeroCase", "refreshOn", "popupInheritance"], errors)) {
    if (safeArea.coordinateSpace !== "css-logical-px") errors.push("safeAreaPolicy.coordinateSpace 必须为 css-logical-px");
    if (safeArea.source !== "runtime-insets") errors.push("safeAreaPolicy.source 必须为 runtime-insets");
    if (!isString(safeArea.zeroCase)) errors.push("safeAreaPolicy.zeroCase 必须声明零安全区策略");
    requireResponsiveEvents(safeArea.refreshOn, "safeAreaPolicy.refreshOn", ["resize", "safe-area-change"], coverage, errors);
    if (safeArea.popupInheritance !== "inherit-host-safe-area") errors.push("safeAreaPolicy.popupInheritance 必须声明 DISPLAY_LAYER 继承安全区");
  }

  const resize = document.resizePolicy;
  if (requireObjectFields(resize, "resizePolicy", ["samePage", "pageReloaded", "events", "recompute", "listenerCleanup", "idempotent", "dprChangeUpdatesCssAndBacking"], errors)) {
    if (resize.samePage !== true || resize.pageReloaded !== false) errors.push("resizePolicy 必须在同一页面完成且 pageReloaded=false");
    requireResponsiveEvents(resize.events, "resizePolicy.events", ["resize", "dpr-change", "safe-area-change"], coverage, errors);
    requireArrayIncludes(resize.recompute, "resizePolicy.recompute", ["logicalViewportSpace", "canvasBackingPolicy", "safeAreaPolicy", "cameraViewportPolicy", "inputCoordinatePolicy"], errors);
    if (resize.listenerCleanup !== "required") errors.push("resizePolicy.listenerCleanup 必须为 required");
    if (resize.idempotent !== true) errors.push("resizePolicy.idempotent 必须为 true");
    if (resize.dprChangeUpdatesCssAndBacking !== true) errors.push("resizePolicy.dprChangeUpdatesCssAndBacking 必须为 true");
  }

  const orientation = document.orientationPolicy;
  if (requireObjectFields(orientation, "orientationPolicy", ["allowed", "source", "reflow", "resizeRequired", "popupInheritance"], errors)) {
    if (orientation.source !== "runtime-viewport") errors.push("orientationPolicy.source 必须来自 runtime-viewport");
    if (!isString(orientation.reflow)) errors.push("orientationPolicy.reflow 必须声明横竖屏重排策略");
    if (orientation.resizeRequired !== true) errors.push("orientationPolicy.resizeRequired 必须为 true");
    if (orientation.popupInheritance !== "inherit-host-orientation") errors.push("orientationPolicy.popupInheritance 必须声明 DISPLAY_LAYER 继承方向");
  }

  const text = document.textResolutionPolicy;
  if (requireObjectFields(text, "textResolutionPolicy", ["coordinateSpace", "fontSizeUnit", "dprIndependent", "reflowOn", "clarityDegradation"], errors)) {
    if (text.coordinateSpace !== "css-logical-px" || text.fontSizeUnit !== "logical-px") errors.push("textResolutionPolicy 必须使用 CSS 逻辑像素和 logical-px 字号");
    if (text.dprIndependent !== true) errors.push("textResolutionPolicy.dprIndependent 必须为 true");
    requireResponsiveEvents(text.reflowOn, "textResolutionPolicy.reflowOn", ["resize", "dpr-change", "locale-change"], coverage, errors);
    if (text.clarityDegradation !== "forbid-silent") errors.push("textResolutionPolicy.clarityDegradation 必须禁止静默降低文字清晰度");
  }

  const asset = document.assetResolutionPolicy;
  if (requireObjectFields(asset, "assetResolutionPolicy", ["productionDpr", "runtimeDprSource", "runtimeProductionSeparated", "sourceResolution", "upscaleAsClarityFix", "insufficientAsset", "degradationDisclosure"], errors)) {
    if (!isImageProductionDpr(asset.productionDpr)) errors.push(`assetResolutionPolicy.productionDpr 必须严格为图片生产基线 ${IMAGE_PRODUCTION_DPR}`);
    if (asset.runtimeDprSource !== "runtimeDprPolicy") errors.push("assetResolutionPolicy.runtimeDprSource 必须引用 runtimeDprPolicy");
    if (asset.runtimeProductionSeparated !== true) errors.push("assetResolutionPolicy.runtimeProductionSeparated 必须为 true，生产 DPR 与运行时 DPR 不得混用");
    if (!isString(asset.sourceResolution)) errors.push("assetResolutionPolicy.sourceResolution 必须声明资源生产清晰度范围");
    if (asset.upscaleAsClarityFix !== "forbidden") errors.push("assetResolutionPolicy.upscaleAsClarityFix 必须为 forbidden，插值放大不是清晰度修复");
    if (!isString(asset.insufficientAsset)) errors.push("assetResolutionPolicy.insufficientAsset 必须声明资源不足时的阻断或降级");
    if (asset.degradationDisclosure !== "required") errors.push("assetResolutionPolicy.degradationDisclosure 必须为 required");
  }

  const budget = document.performanceBudget;
  if (requireObjectFields(budget, "performanceBudget", ["maxCanvasBacking", "maxCanvasPixels", "renderTexturePixels", "fullscreenFilterPasses", "transparentFullscreenLayers", "representativeDevices", "measuredResults", "degradationPolicy"], errors)) {
    if (!isObject(budget.maxCanvasBacking) || !isNumber(budget.maxCanvasBacking.width) || !isNumber(budget.maxCanvasBacking.height) || budget.maxCanvasBacking.width <= 0 || budget.maxCanvasBacking.height <= 0) errors.push("performanceBudget.maxCanvasBacking 必须包含正数 width/height");
    for (const field of ["maxCanvasPixels", "renderTexturePixels"]) if (!isNumber(budget[field]) || budget[field] <= 0) errors.push(`performanceBudget.${field} 必须为正数`);
    for (const field of ["fullscreenFilterPasses", "transparentFullscreenLayers"]) if (!isNumber(budget[field]) || budget[field] < 0) errors.push(`performanceBudget.${field} 必须为非负数`);
    if (!Array.isArray(budget.representativeDevices) || budget.representativeDevices.length === 0 || !budget.representativeDevices.every(isString)) errors.push("performanceBudget.representativeDevices 必须是非空字符串数组");
    if (!isString(budget.measuredResults)) errors.push("performanceBudget.measuredResults 必须绑定代表性设备运行结果");
    if (!isString(budget.degradationPolicy) || !/explicit|never silently/i.test(budget.degradationPolicy)) errors.push("performanceBudget.degradationPolicy 必须声明显式降级且禁止静默降低清晰度");
  }

  validateRepresentativeViewports(document.representativeViewports, coverage, errors);
  validateRequiredRuntimeEvidence(document.requiredRuntimeEvidence, errors);
}

/** 验证默认 usability 覆盖支持方向的代表视口及 DPR 封顶样本。 */
function validateRepresentativeViewports(viewports, coverage, errors) {
  if (!Array.isArray(viewports) || viewports.length === 0) { errors.push("representativeViewports 必须是非空数组"); return; }
  const ids = new Set(); const kinds = new Set(); const dprs = new Set(); let hasCap = false;
  viewports.forEach((viewport, index) => {
    const label = `representativeViewports[${index}]`;
    if (!isObject(viewport)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "kind", "orientation"]) if (!isString(viewport[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (isString(viewport.id)) { if (ids.has(viewport.id)) errors.push(`${label}.id 重复：${viewport.id}`); ids.add(viewport.id); }
    if (isString(viewport.kind)) kinds.add(viewport.kind);
    for (const field of ["width", "height"]) if (!isNumber(viewport[field]) || viewport[field] <= 0) errors.push(`${label}.${field} 必须是正数`);
    if (!["portrait", "landscape"].includes(viewport.orientation)) errors.push(`${label}.orientation 必须为 portrait 或 landscape`);
    const actualOrientation = measuredOrientation(viewport);
    if (actualOrientation && isString(viewport.orientation) && viewport.orientation !== actualOrientation) errors.push(`${label}.orientation 与 width/height 实测方向不一致`);
    if (isString(viewport.kind)) {
      if (!coverage.viewportKinds.includes(viewport.kind)) errors.push(`${label}.kind ${viewport.kind} 不在 orientationPolicy.allowed 支持范围内`);
      if (!matchesRepresentativeViewport(viewport.kind, viewport)) errors.push(`${label}.kind 与 width/height 的代表视口方向或尺寸不一致`);
    }
    if (!isDeviceDprInput(viewport.rawDpr)) errors.push(`${label}.rawDpr 必须是正有限数字`);
    if (!isWorkflowDpr(viewport.effectiveDpr)) errors.push(`${label}.effectiveDpr ${workflowDprError("必须是正有限数字且不超过 2", viewport.effectiveDpr)}`);
    if (isDeviceDprInput(viewport.rawDpr) && isWorkflowDpr(viewport.effectiveDpr)) {
      dprs.add(viewport.effectiveDpr);
      if (viewport.rawDpr > RUNTIME_MAX_DPR) { hasCap = true; if (viewport.effectiveDpr !== RUNTIME_MAX_DPR) errors.push(`${label}.rawDpr 大于 ${RUNTIME_MAX_DPR} 时 effectiveDpr 必须封顶为 ${RUNTIME_MAX_DPR}`); }
      else if (viewport.rawDpr !== viewport.effectiveDpr) errors.push(`${label}.rawDpr 未超过上限时 effectiveDpr 必须等于原始值`);
    }
  });
  const missingKinds = coverage.viewportKinds.filter((kind) => !kinds.has(kind));
  if (missingKinds.length) errors.push(`representativeViewports 缺少代表性视口：${missingKinds.join(", ")}`);
  if (![1, 2].every((dpr) => dprs.has(dpr)) || ![1.25, 1.5].some((dpr) => dprs.has(dpr))) errors.push("representativeViewports 必须覆盖 DPR 1、1.25/1.5 和 2");
  if (!hasCap) errors.push(`representativeViewports 必须包含 rawDpr>${RUNTIME_MAX_DPR} 且 effectiveDpr=${RUNTIME_MAX_DPR} 的封顶证据`);
}

/** 验证正式场景运行证据字段、resize 轨迹和独立 DISPLAY_LAYER 轨迹。 */
function validateRequiredRuntimeEvidence(evidence, errors) {
  if (!requireObjectFields(evidence, "requiredRuntimeEvidence", ["mode", "requiredFields", "dprAssertions", "resizeAssertions", "displayLayerTrajectory", "evidenceBinding", "missingMeasurement"], errors)) return;
  if (!["usability", "exact"].includes(evidence.mode)) errors.push("requiredRuntimeEvidence.mode 必须为 usability 或 exact");
  requireArrayIncludes(evidence.requiredFields, "requiredRuntimeEvidence.requiredFields", REQUIRED_RUNTIME_EVIDENCE_FIELDS, errors);
  const dpr = evidence.dprAssertions;
  if (requireObjectFields(dpr, "requiredRuntimeEvidence.dprAssertions", ["runtimeMeasured", "invalidFallback", "maxRuntimeDpr", "rawAboveTwoEffectiveTwo", "productionDpr", "productionDprSeparate"], errors)) {
    if (dpr.runtimeMeasured !== true) errors.push("requiredRuntimeEvidence.dprAssertions.runtimeMeasured 必须为 true，禁止用命令行声明值代替实测");
    if (dpr.invalidFallback !== 1) errors.push("requiredRuntimeEvidence.dprAssertions.invalidFallback 必须为 1");
    if (dpr.maxRuntimeDpr !== RUNTIME_MAX_DPR) errors.push(`requiredRuntimeEvidence.dprAssertions.maxRuntimeDpr 必须为 ${RUNTIME_MAX_DPR}`);
    if (dpr.rawAboveTwoEffectiveTwo !== true) errors.push("requiredRuntimeEvidence.dprAssertions 必须记录原始 DPR 大于 2 时封顶为 2");
    if (!isImageProductionDpr(dpr.productionDpr)) errors.push(`requiredRuntimeEvidence.dprAssertions.productionDpr 必须为图片生产基线 ${IMAGE_PRODUCTION_DPR}`);
    if (dpr.productionDprSeparate !== true) errors.push("requiredRuntimeEvidence.dprAssertions.productionDprSeparate 必须为 true");
  }
  const resize = evidence.resizeAssertions;
  if (requireObjectFields(resize, "requiredRuntimeEvidence.resizeAssertions", ["samePage", "cssAndBackingUpdateOnDprChange", "dprDecreaseToOne", "sameDprResize"], errors)) {
    if (resize.samePage !== true) errors.push("requiredRuntimeEvidence.resizeAssertions.samePage 必须为 true");
    for (const field of ["cssAndBackingUpdateOnDprChange", "dprDecreaseToOne", "sameDprResize"]) if (resize[field] !== true) errors.push(`requiredRuntimeEvidence.resizeAssertions.${field} 必须为 true`);
  }
  const display = evidence.displayLayerTrajectory;
  if (requireObjectFields(display, "requiredRuntimeEvidence.displayLayerTrajectory", ["required", "steps", "hostSceneState", "independentEvidence", "inheritCssLogicalViewport", "sameEffectiveDpr", "hostPassDoesNotImplyPass"], errors)) {
    if (display.required !== true) errors.push("DISPLAY_LAYER 轨迹必须为 required");
    requireArrayIncludes(display.steps, "requiredRuntimeEvidence.displayLayerTrajectory.steps", ["open", "interact", "resize", "close", "host-restore"], errors);
    for (const field of ["hostSceneState", "independentEvidence", "inheritCssLogicalViewport", "sameEffectiveDpr", "hostPassDoesNotImplyPass"]) if (display[field] !== true) errors.push(`DISPLAY_LAYER 轨迹的 ${field} 必须为 true`);
  }
  const binding = evidence.evidenceBinding;
  if (requireObjectFields(binding, "requiredRuntimeEvidence.evidenceBinding", ["layoutContractVersion", "scene", "state"], errors)) {
    if (binding.layoutContractVersion !== "contract_version") errors.push("requiredRuntimeEvidence.evidenceBinding.layoutContractVersion 必须绑定当前布局合同版本");
  }
  if (evidence.missingMeasurement !== "unverified") errors.push("requiredRuntimeEvidence.missingMeasurement 必须为 unverified");
}

/** 对单父级图执行循环检测。 */
function validateGraphCycles(graph, prefix, errors) {
  const states = new Map();
  /** 深度优先检查父级关系。 */
  function visit(node, trail) { const state = states.get(node) ?? 0; if (state === 1) { errors.push(`${prefix}：${[...trail, node].join(" -> ")}`); return; } if (state === 2) return; states.set(node, 1); const parent = graph.get(node); if (graph.has(parent)) visit(parent, [...trail, node]); states.set(node, 2); }
  for (const node of [...graph.keys()].sort()) visit(node, []);
}

/** 验证坐标空间唯一性及父级引用。 */
function validateCoordinateSpaces(spaces, errors) {
  const known = new Set(); if (!Array.isArray(spaces) || spaces.length === 0) { errors.push("coordinate_spaces 必须是非空数组"); return known; }
  spaces.forEach((space, index) => { if (!isObject(space)) errors.push(`coordinate_spaces[${index}] 必须是对象`); else if (!isString(space.id)) errors.push(`coordinate_spaces[${index}].id 必须是非空字符串`); else { if (known.has(space.id)) errors.push(`重复坐标空间 ID：${space.id}`); known.add(space.id); } });
  const graph = new Map(); spaces.forEach((space, index) => { if (!isObject(space)) return; if (space.parent === space.id) errors.push(`coordinate_spaces[${index}] 不能将自身作为 parent：${space.id}`); else if (space.parent != null && !known.has(space.parent)) errors.push(`coordinate_spaces[${index}] 引用不存在的 parent：${space.parent}`); if (isString(space.id) && known.has(space.parent)) graph.set(space.id, space.parent); });
  validateGraphCycles(graph, "坐标空间存在循环", errors); return known;
}

/** 验证水平和纵向双方停靠点。 */
function validateAnchors(anchors, label, errors) {
  if (!isObject(anchors)) { errors.push(`${label}.anchors 必须是对象`); return; }
  for (const axis of ["horizontal", "vertical"]) { const item = anchors[axis]; if (!isObject(item)) { errors.push(`${label}.anchors.${axis} 缺失`); continue; } for (const side of ["self", "reference"]) if (!isString(item[side])) errors.push(`${label}.anchors.${axis}.${side} 必须是非空字符串`); if (!("offset" in item) || !(isNumber(item.offset) || isString(item.offset))) errors.push(`${label}.anchors.${axis}.offset 必须声明`); }
}

/** 验证最小、首选、最大尺寸和策略。 */
function validateSize(size, label, errors) {
  if (!isObject(size)) { errors.push(`${label}.size 必须是对象`); return; } const values = {};
  for (const bound of ["min", "preferred", "max"]) { const value = size[bound]; if (!isObject(value) || !("width" in value) || !("height" in value)) { errors.push(`${label}.size.${bound} 必须包含 width 和 height`); continue; } values[bound] = value; for (const dimension of ["width", "height"]) if (!isDimension(value[dimension])) errors.push(`${label}.size.${bound}.${dimension} 必须是正数或非空表达式`); }
  for (const dimension of ["width", "height"]) { const min = values.min?.[dimension]; const max = values.max?.[dimension]; if (isNumber(min) && isNumber(max) && min > max) errors.push(`${label}.size.${dimension} 的 min 不能大于 max`); }
  if (!isString(size.strategy)) errors.push(`${label}.size.strategy 必须是非空字符串`);
}

/** 验证区域字段、参照物和专项审查标记。 */
function validateRegions(document, spaces, errors, specialized) {
  const regions = document.regions; const ids = new Set(); if (!Array.isArray(regions) || regions.length === 0) { errors.push("regions 必须是非空数组"); return ids; }
  regions.forEach((region, index) => { const label = `regions[${index}]`; if (!isObject(region)) { errors.push(`${label} 必须是对象`); return; } if (!isString(region.id)) { errors.push(`${label}.id 必须是非空字符串`); return; } if (ids.has(region.id)) errors.push(`重复区域/UI ID：${region.id}`); ids.add(region.id);
    for (const field of ["semantic_role", "parent_space", "reference_id", "positioning", "layout_group", "layout_participation", "scroll", "input", "clip", "origin", "layout_anchor"]) if (!isString(region[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    // 纯布局节点没有资源原点；可渲染对象才执行中心默认值及非中心例外门禁。
    if (!["display-object", "layout-only"].includes(region.origin_applicability)) errors.push(`${label}.origin_applicability 必须为 display-object 或 layout-only`);
    else if (region.origin_applicability === "layout-only" && region.origin !== "not-applicable") errors.push(`${label}.origin 在 layout-only 时必须为 not-applicable`);
    else if (region.origin_applicability === "display-object" && region.origin === "not-applicable") errors.push(`${label}.origin 在 display-object 时必须声明资源原点`);
    else if (region.origin_applicability === "display-object" && isString(region.origin) && region.origin !== "center" && (!isObject(region.origin_exception) || !isString(region.origin_exception.reason) || !isString(region.origin_exception.coordinate_conversion))) errors.push(`${label}.origin 非中心时必须声明 origin_exception.reason 和 coordinate_conversion`);
    if (!isObject(region.animation_offset) || !("x" in region.animation_offset) || !("y" in region.animation_offset)) errors.push(`${label}.animation_offset 必须包含 x 和 y`); else if (!["x", "y"].every((axis) => isNumber(region.animation_offset[axis]) || isString(region.animation_offset[axis]))) errors.push(`${label}.animation_offset.x/y 必须是数值或非空表达式`);
    if (!spaces.has(region.parent_space)) errors.push(`${label} 引用不存在的 parent_space：${region.parent_space}`); validateAnchors(region.anchors, label, errors); validateSize(region.size, label, errors); if (region.positioning === "absolute") appendUnique(specialized, `${region.id}:absolute-positioning`); if (isObject(region.size) && region.size.strategy === "fixed") appendUnique(specialized, `${region.id}:fixed-size`);
  }); return ids;
}

/** 验证区域参照存在并检测参照环。 */
function validateReferenceGraph(document, ids, errors) {
  if (!Array.isArray(document.regions)) return; const graph = new Map();
  document.regions.forEach((region, index) => { if (!isObject(region) || !ids.has(region.id)) return; if (region.reference_id !== "viewport" && !ids.has(region.reference_id)) errors.push(`regions[${index}] 引用不存在的 reference_id：${region.reference_id}`); else if (ids.has(region.reference_id)) graph.set(region.id, region.reference_id); });
  validateGraphCycles(graph, "区域参照存在循环", errors);
}

/** 验证布局节点的双轴偏移；表达式允许由项目适配器在运行时求值。 */
function validateLayoutOffset(value, label, errors) {
  if (!isObject(value)) { errors.push(`${label}.offset 必须是包含 x/y 的对象`); return; }
  for (const axis of ["x", "y"]) if (!(isNumber(value[axis]) || isString(value[axis]))) errors.push(`${label}.offset.${axis} 必须是数值或非空表达式`);
}

/** 判断两个目标几何是否逐字段一致，防止拆解合同与关键对齐事实漂移。 */
function sameBounds(left, right) {
  return isObject(left) && isObject(right) && ["x", "y", "width", "height"].every((field) => left[field] === right[field]);
}

/**
 * 验证效果图布局拆解节点及其参照图。
 *
 * layout_nodes 是参考图事实与运行时布局入口之间的唯一桥梁；因此这里
 * 只检查声明关系和目标几何，不引入跨项目的固定像素容差。
 */
function validateLayoutNodes(document, fidelity, binding, spaces, regionIds, errors) {
  const nodes = document.layout_nodes;
  const nodeIds = new Set(); const orderedNodeIds = []; const regionNodeIds = new Map(); const nodesById = new Map();
  if (!Array.isArray(nodes)) { errors.push("layout_nodes 必须是数组"); return { nodeIds, regionNodeIds, nodesById }; }
  const requiresLayoutNodes = fidelity?.applicability === "frozen-target" || isEffectImageContract(document);
  if (fidelity?.applicability === "not-applicable" && !isEffectImageContract(document) && nodes.length > 0) errors.push("普通布局 layout_nodes 必须为空数组");
  if (requiresLayoutNodes && nodes.length === 0) errors.push("frozen-target/effect-image layout_nodes 必须是非空数组");
  const scopedIds = new Set((document.scope?.ui_ids ?? []).filter(isString));
  const viewport = binding?.target_viewport;
  nodes.forEach((node, index) => {
    const label = `layout_nodes[${index}]`;
    if (!isObject(node)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["layout_node_id", "region_id", "coordinate_space", "reference_id", "self_anchor", "reference_anchor", "size_policy", "clip_policy", "responsive_rule", "planned_test_id"]) if (!isString(node[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (isString(node.layout_node_id)) {
      if (nodeIds.has(node.layout_node_id)) errors.push(`重复布局节点 ID：${node.layout_node_id}`);
      nodeIds.add(node.layout_node_id); orderedNodeIds.push(node.layout_node_id); nodesById.set(node.layout_node_id, node);
    }
    if (isString(node.region_id)) {
      const boundNodes = regionNodeIds.get(node.region_id) ?? [];
      boundNodes.push(node.layout_node_id);
      regionNodeIds.set(node.region_id, boundNodes);
      if (!regionIds.has(node.region_id)) errors.push(`${label}.region_id 未绑定已声明 regions（孤立布局节点）：${node.region_id}`);
      if (!scopedIds.has(node.region_id)) errors.push(`${label}.region_id 未绑定 scope.ui_ids：${node.region_id}`);
    }
    if (isString(node.coordinate_space) && !spaces.has(node.coordinate_space)) errors.push(`${label}.coordinate_space 引用不存在的坐标空间：${node.coordinate_space}`);
    if (requiresLayoutNodes) validateUiLayout(node.ui_layout, { rootParent: ["viewport", "safe-area"].includes(node.parent_layout_node_id), container: node.is_container === true || node.element_type === "container", emptyContainer: node.empty_container === true && !hasSpriteRendering(node) }, errors, `${label}.ui_layout`);
    validateLayoutOffset(node.offset, label, errors);
    if (!isNumber(node.z_order)) errors.push(`${label}.z_order 必须是有限数值`);
    validateMeasurement(node.target_bounds, `${label}.target_bounds`, errors);
    if (isObject(node.target_bounds) && isObject(viewport) && ["x", "y", "width", "height"].every((field) => isNumber(node.target_bounds[field])) && isNumber(viewport.width) && isNumber(viewport.height)) {
      const bounds = node.target_bounds;
      if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height) errors.push(`${label}.target_bounds 必须完全位于 scene_reconstruction_binding.target_viewport 内`);
    }
  });
  if (requiresLayoutNodes) validateUiInteractionTree(nodes.map((node) => ({ element_id: node?.layout_node_id, parent_element_id: node?.parent_layout_node_id, ui_layout: node?.ui_layout })), errors, "layout_nodes");
  if (isEffectImageContract(document)) {
    // 父容器、相对测量和显式视觉对齐必须与场景拆解入口使用同一规则。
    for (const issue of validateEffectImageParentChildLayoutNodes(nodes, viewport, { label: "layout_nodes", requireExecutionPlan: true })) errors.push(issue.message);
    if (document.fidelity?.status === "verified") validateLayoutRuntimeSnapshots(nodes, document.component_snapshots, errors, "component_snapshots");
  }
  const graph = new Map(); const stableRoots = new Set(["viewport", "safe-area"]);
  nodes.forEach((node, index) => {
    if (!isObject(node) || !isString(node.layout_node_id) || !isString(node.reference_id)) return;
    const label = `layout_nodes[${index}]`;
    if (!nodeIds.has(node.reference_id) && !regionIds.has(node.reference_id) && !stableRoots.has(node.reference_id)) errors.push(`${label}.reference_id 引用不存在的稳定参照：${node.reference_id}`);
    if (node.reference_id === node.layout_node_id || node.reference_id === node.region_id) errors.push(`${label}.reference_id 不能自引用：${node.reference_id}`);
    if (nodeIds.has(node.reference_id)) graph.set(node.layout_node_id, node.reference_id);
    else if (regionIds.has(node.reference_id)) {
      const referencedNodes = regionNodeIds.get(node.reference_id) ?? [];
      if (referencedNodes.length === 1) graph.set(node.layout_node_id, referencedNodes[0]);
      else if (referencedNodes.length > 1) errors.push(`${label}.reference_id 指向包含多个 layout_nodes 的 region，必须改为具体 layout_node_id：${node.reference_id}`);
    }
  });
  validateGraphCycles(graph, "布局节点参照存在循环", errors);
  return { nodeIds, orderedNodeIds, regionNodeIds, nodesById };
}

/** 校验 effect-image 的独立布局标注身份；布局阶段不能绕过前置拆解确认。 */
function validateLayoutAnnotationBinding(document, binding, layoutNodes, errors) {
  if (!isEffectImageContract(document)) return;
  const annotation = document.layout_annotation;
  if (!isObject(annotation)) { errors.push("effect-image 必须声明 layout_annotation；布局标注只能后置于拆解确认"); return; }
  const required = ["layout_annotation_file", "layout_annotation_width", "layout_annotation_height", "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file", "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id"];
  for (const field of required) if (!(field in annotation)) errors.push(`layout_annotation.${field} 必须存在`);
  for (const field of ["layout_annotation_file", "layout_review_file", "layout_nodes_file", "layout_decision_file", "decomposition_confirmation_id", "layout_decision_id", "scene_id", "state_id"]) if (!isString(annotation[field])) errors.push(`layout_annotation.${field} 必须是非空字符串`);
  if (annotation.layout_annotation_schema !== "layout-annotation/png/1") errors.push("layout_annotation.layout_annotation_schema 必须为 layout-annotation/png/1");
  if (annotation.layout_annotation_layout !== "image-plus-right-panel") errors.push("layout_annotation.layout_annotation_layout 必须为 image-plus-right-panel");
  for (const field of ["layout_annotation_width", "layout_annotation_height"]) if (!Number.isInteger(annotation[field]) || annotation[field] <= 0) errors.push(`layout_annotation.${field} 必须是正整数`);
  if (binding && (annotation.scene_id !== binding.scene_id || annotation.state_id !== binding.state_id)) errors.push("layout_annotation scene/state 未绑定当前场景");
  if (!Array.isArray(annotation.layout_node_ids) || annotation.layout_node_ids.length === 0) errors.push("layout_annotation.layout_node_ids 必须是非空数组");
  else if (JSON.stringify(annotation.layout_node_ids) !== JSON.stringify(layoutNodes.orderedNodeIds)) errors.push("layout_annotation.layout_node_ids 必须按已确认拆解元素原顺序完整绑定");
}

/** 验证全局几何字段。 */
function validateContent(content, errors) { if (!isObject(content)) return; for (const field of ["max_width", "columns", "gaps", "margins"]) if (!(field in content)) errors.push(`content 缺少字段：${field}`); for (const field of ["gaps", "margins"]) if (!isObject(content[field]) || !("horizontal" in content[field]) || !("vertical" in content[field])) errors.push(`content.${field} 必须包含 horizontal 和 vertical`); }

/** 验证断点触发条件和结构变化。 */
function validateBreakpoints(breakpoints, errors) {
  if (!Array.isArray(breakpoints)) { errors.push("breakpoints 必须是数组"); return; } const seen = new Set();
  breakpoints.forEach((point, index) => { const label = `breakpoints[${index}]`; if (!isObject(point)) { errors.push(`${label} 必须是对象`); return; } if (!isString(point.id)) errors.push(`${label}.id 必须是非空字符串`); else if (seen.has(point.id)) errors.push(`重复断点 ID：${point.id}`); else seen.add(point.id); if (!isObject(point.when) || Object.keys(point.when).length === 0) errors.push(`${label}.when 必须是非空对象`); else if (Object.entries(point.when).some(([key, value]) => !isString(key) || !isCondition(value))) errors.push(`${label}.when 必须包含非空键和有效值`); if (!Array.isArray(point.structure_changes) || point.structure_changes.length === 0) errors.push(`${label}.structure_changes 必须是非空数组`); else if (point.structure_changes.some((change) => !isString(change) && !isCondition(change))) errors.push(`${label}.structure_changes 必须包含非空字符串或有效值`); });
}

/** 验证安全区和滚动轴唯一所有者。 */
function validatePlatformAndScrolling(document, ids, errors) {
  const insets = document.platform_insets; if (!isObject(insets)) return; for (const field of ["safe_area", "system_bars", "keyboard", "folding", "split_screen"]) if (!(field in insets)) errors.push(`platform_insets 缺少字段：${field}`); if (isObject(insets.safe_area)) for (const side of ["top", "right", "bottom", "left", "zero_case"]) if (!(side in insets.safe_area)) errors.push(`platform_insets.safe_area 缺少字段：${side}`);
  const scrolling = document.scrolling; if (!isObject(scrolling)) return; if (!Array.isArray(scrolling.axes)) errors.push("scrolling.axes 必须是数组"); else { const seen = new Set(); scrolling.axes.forEach((axis, index) => { const label = `scrolling.axes[${index}]`; if (!isObject(axis)) { errors.push(`${label} 必须是对象`); return; } if (seen.has(axis.axis)) errors.push(`滚动轴存在多个所有者或重复声明：${axis.axis}`); else if (isString(axis.axis)) seen.add(axis.axis); for (const field of ["axis", "owner_id", "content_region_id", "gesture_priority", "bounds"]) if (!isString(axis[field])) errors.push(`${label}.${field} 必须是非空字符串`); if (!ids.has(axis.owner_id)) errors.push(`${label}.owner_id 引用不存在的区域：${axis.owner_id}`); if (!ids.has(axis.content_region_id)) errors.push(`${label}.content_region_id 引用不存在的区域：${axis.content_region_id}`); }); }
  if (!isObject(scrolling.narrow_height_degradation)) errors.push("scrolling.narrow_height_degradation 必须是对象"); else for (const field of ["trigger", "strategy", "fallback"]) if (!isString(scrolling.narrow_height_degradation[field])) errors.push(`scrolling.narrow_height_degradation.${field} 必须是非空字符串`);
}

/** 验证程序化文本的五语种、逐语言行布局与短文案合同。 */
function validateProgrammaticTextLocalization(localization, errors) {
  const label = "dynamic_content.localization";
  if (typeof localization.programmatic_text !== "boolean") errors.push(`${label}.programmatic_text 必须是布尔值`);
  if (!Array.isArray(localization.required_languages) || localization.required_languages.length === 0 || !localization.required_languages.every(isString)) errors.push(`${label}.required_languages 必须是非空语言数组`);
  if (localization.programmatic_text !== true) return;

  const languages = new Set(localization.required_languages ?? []);
  const missing = REQUIRED_PROGRAMMATIC_TEXT_LANGUAGES.filter((language) => !languages.has(language));
  if (missing.length) errors.push(`${label}.required_languages 缺少程序化文本必需语言：${missing.join(", ")}`);
  if (languages.size !== (localization.required_languages?.length ?? 0)) errors.push(`${label}.required_languages 不得包含重复语言`);
  if (!isObject(localization.wrap)) errors.push(`${label}.wrap 必须逐语言声明 single-line 或 wrap`);
  else for (const language of REQUIRED_PROGRAMMATIC_TEXT_LANGUAGES) if (!["single-line", "wrap"].includes(localization.wrap[language])) errors.push(`${label}.wrap.${language} 必须为 single-line 或 wrap`);
  if (localization.growth !== "locale-adaptive") errors.push(`${label}.growth 必须为 locale-adaptive`);
  if (localization.truncate_policy !== "forbid") errors.push(`${label}.truncate_policy 必须为 forbid，程序化文本禁止截断`);
  if (localization.copy_style !== "concise-gameplay") errors.push(`${label}.copy_style 必须为 concise-gameplay`);
  if (localization.multiplier_format !== "x{value}") errors.push(`${label}.multiplier_format 必须为 x{value}`);
  if (!isString(localization.display_fit_evidence)) errors.push(`${label}.display_fit_evidence 必须引用五语种逐语言行布局适配证据`);
}

/** 验证本地化、文字缩放、关键动作和重排事件。 */
function validateDynamicContent(dynamic, ids, errors) {
  if (!isObject(dynamic)) return; if (!isObject(dynamic.localization)) errors.push("dynamic_content.localization 必须是对象"); else { for (const field of ["default_language", "longest_copy", "programmatic_text", "required_languages", "wrap", "growth", "truncate_policy", "copy_style", "multiplier_format", "display_fit_evidence"]) if (!(field in dynamic.localization)) errors.push(`dynamic_content.localization 缺少字段：${field}`); validateProgrammaticTextLocalization(dynamic.localization, errors); }
  if (!isObject(dynamic.text_scaling) || !("default" in dynamic.text_scaling) || !("maximum" in dynamic.text_scaling)) errors.push("dynamic_content.text_scaling 必须声明 default 和 maximum"); else if (!isString(dynamic.text_scaling.strategy)) errors.push("dynamic_content.text_scaling.strategy 必须是非空字符串");
  if (!Array.isArray(dynamic.key_actions)) errors.push("dynamic_content.key_actions 必须是数组"); else dynamic.key_actions.forEach((action, index) => { if (!isObject(action)) { errors.push(`dynamic_content.key_actions[${index}] 必须是对象`); return; } if (!isString(action.id)) errors.push(`dynamic_content.key_actions[${index}].id 必须是非空字符串`); else if (!ids.has(action.id)) errors.push(`dynamic_content.key_actions[${index}].id 引用不存在的区域：${action.id}`); const required = new Set(["default", "disabled", "submitting", "completed"]); if (!Array.isArray(action.states) || action.states.length === 0 || !action.states.every(isString)) errors.push(`dynamic_content.key_actions[${index}].states 必须是非空字符串数组`); else { const missing = [...required].filter((state) => !action.states.includes(state)).sort(); if (missing.length) errors.push(`dynamic_content.key_actions[${index}].states 缺少必需状态：${missing.join(", ")}`); } if (!["forbid", "forbid-critical"].includes(action.text_truncation)) errors.push(`关键动作禁止文本截断：dynamic_content.key_actions[${index}]`); });
  if (!Array.isArray(dynamic.reflow_events) || dynamic.reflow_events.length === 0) errors.push("dynamic_content.reflow_events 必须是非空数组"); else { if (!dynamic.reflow_events.every(isString)) errors.push("dynamic_content.reflow_events 必须只包含非空字符串"); const missing = ["text-change", "state-change", "resize", "safe-area-change"].filter((item) => !dynamic.reflow_events.includes(item)).sort(); if (missing.length) errors.push(`dynamic_content.reflow_events 缺少必需事件：${missing.join(", ")}`); }
}

/** 验证覆盖层遮挡回退并标记专项审查。 */
function validateOverlays(overlays, ids, errors, specialized) {
  if (!Array.isArray(overlays)) { errors.push("overlay_rules 必须是数组"); return; } overlays.forEach((rule, index) => { const label = `overlay_rules[${index}]`; if (!isObject(rule)) { errors.push(`${label} 必须是对象`); return; } if (["fixed", "floating", "docked"].includes(rule.mode)) { appendUnique(specialized, `${rule.element_id ?? label}:${rule.mode}-overlay`); if (!isString(rule.id)) errors.push(`${label}.id 必须是非空字符串`); if (!isString(rule.element_id) || !ids.has(rule.element_id)) errors.push(`${label}.element_id 引用不存在的区域：${rule.element_id}`); if (!isString(rule.occlusion)) errors.push(`${label}.occlusion 必须声明遮挡规则`); if (!isString(rule.fallback)) errors.push(`${label}.fallback 必须声明回退规则`); } else errors.push(`${label}.mode 必须是 fixed、floating 或 docked`); });
}

/** 确保特殊布局参与方式都有对应遮挡合同。 */
function validateOverlayCoverage(document, ids, errors) { if (!Array.isArray(document.regions) || !Array.isArray(document.overlay_rules)) return; const declared = new Set(document.overlay_rules.filter(isObject).map((rule) => `${rule.element_id}\0${rule.mode}`)); const modes = { "fixed-overlay": "fixed", "floating-overlay": "floating", "docked-overlay": "docked" }; for (const region of document.regions) if (isObject(region) && ids.has(region.id) && modes[region.layout_participation] && !declared.has(`${region.id}\0${modes[region.layout_participation]}`)) errors.push(`区域 ${region.id} 的 ${region.layout_participation} 缺少对应 overlay_rules`); }

/** 验证布局不变量及证据映射。 */
function validateInvariants(invariants, ids, errors, mode = "usability") {
  const exact = mode === "exact";
  if (!Array.isArray(invariants) || invariants.length === 0) { errors.push("invariants 必须是非空数组"); return; } const seen = new Set(); invariants.forEach((item, index) => { const label = `invariants[${index}]`; if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; } if (!isString(item.id)) errors.push(`${label}.id 必须是非空字符串`); else if (seen.has(item.id)) errors.push(`重复不变量 ID：${item.id}`); else seen.add(item.id); for (const field of ["description", "expression"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`); if (!Array.isArray(item.applies_to) || item.applies_to.length === 0) errors.push(`${label}.applies_to 必须是非空数组`); else for (const target of item.applies_to) if (!isString(target) || !ids.has(target)) errors.push(`${label}.applies_to 引用不存在的区域：${target}`); if (exact && (!isNumber(item.tolerance) || item.tolerance < 0)) errors.push(`${label}.tolerance 必须是非负数`); if (!isObject(item.evidence)) errors.push(`${label}.evidence 必须是对象`); else for (const kind of ["automation", "visual"]) if (!Array.isArray(item.evidence[kind]) || item.evidence[kind].length === 0 || !item.evidence[kind].every(isString)) errors.push(`${label}.evidence.${kind} 必须是非空数组且仅含非空字符串`); });
}

/** 验证证据矩阵绑定和必需轴。 */
/** 递归检查证据矩阵扩展字段，避免新增 dpr 入口绕过固定基线。 */
function validateEvidenceMatrixDpr(value, path, errors, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { value.forEach((item, index) => validateEvidenceMatrixDpr(item, `${path}[${index}]`, errors, seen)); return; }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "dpr" && !isWorkflowDpr(nested)) errors.push(workflowDprError(`${path}.${key}`, nested));
    if (key === "deviceScaleFactor" && !isDeviceDprInput(nested)) errors.push(workflowDprError(`${path}.${key}（原始设备值）`, nested));
    validateEvidenceMatrixDpr(nested, `${path}.${key}`, errors, seen);
  }
}

/** 验证证据矩阵绑定和必需轴。 */
function validateEvidenceMatrix(matrix, errors, mode = "usability", coverage = null) { if (!isObject(matrix)) return; for (const field of ["candidate_binding", "golden_policy", "snapshot_stability"]) if (!isString(matrix[field])) errors.push(`evidence_matrix.${field} 必须是非空字符串`); const exact = mode === "exact"; if (exact && (!Array.isArray(matrix.required_axes) || matrix.required_axes.length === 0 || !matrix.required_axes.every(isString))) errors.push("evidence_matrix.required_axes 必须是非空数组"); else if (Array.isArray(matrix.required_axes) && matrix.required_axes.some((axis) => !isString(axis))) errors.push("evidence_matrix.required_axes 只能包含非空字符串"); else if (exact) { const requiredAxes = [...REQUIRED_EVIDENCE_AXES]; if (coverage && !coverage.requiresOrientationChange) requiredAxes.splice(requiredAxes.indexOf("orientation"), 1); const missing = requiredAxes.filter((axis) => !matrix.required_axes.includes(axis)).sort(); if (missing.length) errors.push(`evidence_matrix.required_axes 缺少必需轴：${missing.join(", ")}`); } validateEvidenceMatrixDpr(matrix, "evidence_matrix", errors); }

/** 程序化文本必须始终保留本地化显示轴，不能因 usability 模式跳过五语种适配。 */
function validateProgrammaticTextEvidence(document, errors) {
  if (document.dynamic_content?.localization?.programmatic_text !== true) return;
  if (!Array.isArray(document.evidence_matrix?.required_axes) || !document.evidence_matrix.required_axes.includes("localization")) errors.push("程序化文本的 evidence_matrix.required_axes 必须包含 localization");
}

/** 验证布局合同并返回稳定结果。 */
export function validateContract(document) {
  const errors = []; const warnings = []; const specialized = []; validateRoot(document, errors); if (!isObject(document)) return { status: "failed", errors, warnings, specialized_review: specialized };
  const mode = resolveVisualValidationMode(document); validateVisualValidationPolicy(errors, "visual_validation", document);
  validateScope(document.scope, errors); const fidelity = validateFidelityLifecycle(document, errors); const requiresFrozenLayout = fidelity?.applicability === "frozen-target" || isEffectImageContract(document); if (requiresFrozenLayout) validateFrozenVisualTarget(document.frozen_visual_target, errors); const binding = validateSceneReconstructionBinding(document, fidelity, errors); const coverage = resolveOrientationCoverage(document.orientationPolicy); errors.push(...coverage.errors); validateTargets(document.targets, errors, coverage); validateResponsiveContract(document, errors, coverage); const spaces = validateCoordinateSpaces(document.coordinate_spaces, errors); const ids = validateRegions(document, spaces, errors, specialized); validateScopeRegionIds(document.scope, ids, errors); validateReferenceGraph(document, ids, errors); const layoutNodes = validateLayoutNodes(document, fidelity, binding, spaces, ids, errors); validateLayoutAnnotationBinding(document, binding, layoutNodes, errors); validateContent(document.content, errors); validateBreakpoints(document.breakpoints, errors); validatePlatformAndScrolling(document, ids, errors); validateDynamicContent(document.dynamic_content, ids, errors); validateOverlays(document.overlay_rules, ids, errors, specialized); validateOverlayCoverage(document, ids, errors); validateInvariants(document.invariants, ids, errors, mode);
  if (requiresFrozenLayout) {
    validateCriticalAlignments(document.critical_alignments, ids, layoutNodes, fidelity?.status, errors, mode);
    if (fidelity?.status === "verified") {
      validateParityCases(document.parity_cases, document.scope, document.contract_version, document.frozen_visual_target, errors, mode, coverage);
      if (mode === "exact" && Array.isArray(document.parity_cases) && document.parity_cases.some((item) => item?.conclusion !== "passed")) errors.push("verified 的 parity_cases 必须全部 passed");
    } else if (!Array.isArray(document.parity_cases) || document.parity_cases.length > 0) errors.push("specified 的 parity_cases 必须为空数组");
  }
  validateEvidenceMatrix(document.evidence_matrix, errors, mode, coverage); validateProgrammaticTextEvidence(document, errors);
  if (isObject(document.dynamic_content?.localization) && !["forbid-critical", "forbid"].includes(document.dynamic_content.localization.truncate_policy)) warnings.push("本地化截断策略未明确禁止关键文本");
  return { status: errors.length ? "failed" : "passed", errors, warnings, specialized_review: specialized };
}

/** 读取严格 JSON-compatible YAML 合同。 */
export async function loadContract(path) { return JSON.parse(await readFile(path, "utf8")); }

/** 解析项目内证据路径并拒绝父级或跨盘逃逸。 */
function projectPath(projectRoot, value) {
  const candidate = resolve(projectRoot, value); const rel = relative(resolve(projectRoot), candidate);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`路径逃逸项目根目录：${value}`);
  return candidate;
}

/** 检查文件存在，任何目录或缺失路径均返回 false。 */
async function isFile(value) { try { return (await stat(value)).isFile(); } catch { return false; } }

/** 校验冻结原图哈希和 specified/verified 对齐、parity 证据文件。 */
export async function checkContractFiles(document, projectRoot) {
  const errors = []; const paths = [];
  if (document.fidelity?.applicability !== "frozen-target") return errors;
  const target = document.frozen_visual_target;
  if (isString(target?.original_file)) {
    try {
      const file = projectPath(projectRoot, target.original_file);
      if (!await isFile(file)) errors.push(`frozen_visual_target.original_file 文件不存在：${target.original_file}`);
      else await readFile(file);
    } catch (error) { errors.push(`frozen_visual_target.original_file：${error.message}`); }
  }
  if (isObject(document.layout_annotation) && isString(document.layout_annotation.layout_annotation_file)) {
    try {
      const file = projectPath(projectRoot, document.layout_annotation.layout_annotation_file);
      if (!await isFile(file)) errors.push(`layout_annotation.layout_annotation_file 文件不存在：${document.layout_annotation.layout_annotation_file}`);
      else await readFile(file);
    } catch (error) { errors.push(`layout_annotation.layout_annotation_file：${error.message}`); }
  }
  if (isObject(document.layout_annotation) && isString(document.layout_annotation.layout_decision_file)) {
    try {
      const file = projectPath(projectRoot, document.layout_annotation.layout_decision_file);
      if (!await isFile(file)) errors.push(`layout_annotation.layout_decision_file 文件不存在：${document.layout_annotation.layout_decision_file}`);
      else await readFile(file);
    } catch (error) { errors.push(`layout_annotation.layout_decision_file：${error.message}`); }
  }
  for (const [index, item] of (document.critical_alignments ?? []).entries()) {
    for (const field of ["target_evidence", ...(document.fidelity.status === "verified" ? ["runtime_evidence"] : [])]) for (const value of item?.[field] ?? []) paths.push([`critical_alignments[${index}].${field}`, value]);
  }
  if (document.fidelity.status === "verified") for (const [index, item] of (document.parity_cases ?? []).entries()) for (const field of ["reference_evidence", "candidate_evidence"]) for (const value of item?.[field] ?? []) paths.push([`parity_cases[${index}].${field}`, value]);
  for (const [label, value] of paths) { try { if (!await isFile(projectPath(projectRoot, value))) errors.push(`${label} 文件不存在：${value}`); } catch (error) { errors.push(`${label}：${error.message}`); } }
  return errors;
}

/** 解析合同 CLI 的文件检查开关与项目根目录。 */
function parseArgs(argv) {
  const args = { checkFiles: false };
  for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (token === "--json") args.asJson = true; else if (token === "--check-files") args.checkFiles = true; else if (token === "--project-root") args.projectRoot = argv[++index]; else if (!token.startsWith("-") && !args.contract) args.contract = token; else throw new Error(`不支持的参数：${token}`); }
  if (!args.contract) throw new Error("必须传入一个合同文件路径"); return args;
}

/** 解析命令行、验证合同并返回退出码。 */
export async function main(argv = process.argv.slice(2)) {
  let result; let asJson = false;
  try { const args = parseArgs(argv); asJson = args.asJson; const document = await loadContract(args.contract); result = validateContract(document); if (args.checkFiles) { result.errors.push(...await checkContractFiles(document, args.projectRoot ?? resolve(args.contract, "..", ".."))); if (result.errors.length) result.status = "failed"; } } catch (error) { result = { status: "failed", errors: [`无法解析合同：${error.message}`], warnings: [], specialized_review: [] }; }
  if (asJson) console.log(JSON.stringify(result)); else { console.log(`status: ${result.status}`); for (const error of result.errors) console.log(`error: ${error}`); for (const warning of result.warnings) console.log(`warning: ${warning}`); for (const item of result.specialized_review) console.log(`specialized_review: ${item}`); }
  return result.status === "passed" ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
