#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DPR_POLICY, IMAGE_PRODUCTION_DPR, RUNTIME_MAX_DPR, isDeviceDprInput, isImageProductionDpr, isWorkflowDpr, workflowDprError } from "../../cocos-game-workflow-control/scripts/workflow-dpr-contract.mjs";
import { DESIGN_RESOLUTIONS } from "./fixed-design-viewport.mjs";
import { resolveVisualValidationMode, validateVisualValidationPolicy } from "../../cocos-game-workflow-control/scripts/visual-validation-policy.mjs";
import { matchesRepresentativeViewport, measuredOrientation, resolveOrientationCoverage } from "../../cocos-game-workflow-control/scripts/orientation-validation-scope.mjs";
import { validateSceneReconstructionContract } from "../../cocos-game-workflow-control/scripts/scene-reconstruction-contract.mjs";
import { getUiLayoutSourceDocument, getUiLayoutSourceFromMap, loadUiLayoutSourceDocuments, resolveSceneV2LayoutSource } from "./ui-layout-contract-sources.mjs";
import { validateSceneRuntimeEvidenceFiles } from "./ui-layout-scene-file-gate.mjs";

const ROOT_REQUIRED = ["schema_version", "contract_id", "contract_version", "scope", "fidelity", "frozen_visual_target", "logicalViewportSpace", "designResolutionPolicy", "canvasBackingPolicy", "runtimeDprPolicy", "maxRuntimeDpr", "scaleMode", "cameraViewportPolicy", "cameraZoomPolicy", "cameraOriginPolicy", "inputCoordinatePolicy", "safeAreaPolicy", "resizePolicy", "orientationPolicy", "textResolutionPolicy", "assetResolutionPolicy", "performanceBudget", "representativeViewports", "requiredRuntimeEvidence", "targets", "coordinate_spaces", "regions", "layout_nodes", "content", "platform_insets", "scrolling", "dynamic_content", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases", "evidence_matrix"];
const REFERENCE_CONTRACT_FIELDS = ["schema_version", "contract_id", "contract_version", "project_policy_file", "scene_contract_file"];
const PROJECT_POLICY_FIELDS = ["logicalViewportSpace", "designResolutionPolicy", "canvasBackingPolicy", "runtimeDprPolicy", "maxRuntimeDpr", "scaleMode", "cameraViewportPolicy", "cameraZoomPolicy", "cameraOriginPolicy", "inputCoordinatePolicy", "safeAreaPolicy", "resizePolicy", "orientationPolicy", "textResolutionPolicy", "assetResolutionPolicy", "performanceBudget", "representativeViewports", "requiredRuntimeEvidence", "targets", "coordinate_spaces"];
const PROJECT_POLICY_METADATA_FIELDS = ["schema_version", "policy_id", "policy_version"];
const REFERENCE_CONTRACT_ALLOWED_FIELDS = new Set(REFERENCE_CONTRACT_FIELDS);
const PROJECT_POLICY_ALLOWED_FIELDS = new Set([...PROJECT_POLICY_METADATA_FIELDS, ...PROJECT_POLICY_FIELDS]);
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

/** 验证根对象和根字段。 */
function validateRoot(document, errors) {
  if (!isObject(document)) { errors.push("根对象必须是 JSON 对象"); return; }
  for (const field of ROOT_REQUIRED) if (!(field in document)) errors.push(`缺少根字段：${field}`);
  for (const field of ["schema_version", "contract_id", "contract_version"]) if (field in document && !isString(document[field])) errors.push(`字段 ${field} 必须是非空字符串`);
  if (document.schema_version !== "1.2.0") errors.push("schema_version 必须为 1.2.0");
  for (const field of ["coordinate_spaces", "regions", "layout_nodes", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases", "representativeViewports"]) if (field in document && !Array.isArray(document[field])) errors.push(`字段 ${field} 必须是数组`);
  for (const field of ["scope", "fidelity", "targets", "content", "platform_insets", "scrolling", "dynamic_content", "evidence_matrix", "logicalViewportSpace", "designResolutionPolicy", "canvasBackingPolicy", "runtimeDprPolicy", "cameraViewportPolicy", "cameraZoomPolicy", "cameraOriginPolicy", "inputCoordinatePolicy", "safeAreaPolicy", "resizePolicy", "orientationPolicy", "textResolutionPolicy", "assetResolutionPolicy", "performanceBudget", "requiredRuntimeEvidence"]) if (field in document && !isObject(document[field])) errors.push(`字段 ${field} 必须是对象`);
}

/** 普通 UI 1.2 只允许非冻结目标语义；效果图路径已在入口迁移到引用合同。 */
function validateFidelityLifecycle(document, errors) {
  const fidelity = document.fidelity;
  if (!isObject(fidelity)) return null;
  if (fidelity.applicability !== "not-applicable") errors.push("普通 UI fidelity.applicability 必须为 not-applicable");
  if (fidelity.status !== "not-applicable") errors.push("普通 UI fidelity.status 必须为 not-applicable");
  if (document.frozen_visual_target != null) errors.push("普通 UI 不得声明 frozen_visual_target");
  for (const field of ["layout_nodes", "critical_alignments", "parity_cases"]) if (!Array.isArray(document[field]) || document[field].length > 0) errors.push(`普通 UI ${field} 必须为空数组`);
  return fidelity;
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
function validateResponsiveContract(document, errors, coverage, { referencedPolicy = false } = {}) {
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
  validateRequiredRuntimeEvidence(document.requiredRuntimeEvidence, errors, { referencedPolicy });
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
function validateRequiredRuntimeEvidence(evidence, errors, { referencedPolicy = false } = {}) {
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
    const expectedBinding = referencedPolicy
      ? { layoutContractVersion: "scene_contract.target_conditions.layout_contract_version", scene: "scene_contract.target_conditions.scene_id", state: "scene_contract.target_conditions.state_id" }
      : { layoutContractVersion: "contract_version", scene: "scope.scenes", state: "scope.states" };
    for (const [field, expected] of Object.entries(expectedBinding)) if (binding[field] !== expected) errors.push(`requiredRuntimeEvidence.evidenceBinding.${field} 必须绑定 ${expected}`);
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
export function validateContract(document, options = {}) {
  if (document?.schema_version === "2.0.0") return validateReferencedContract(document, options);
  // effect-image 与 frozen-target 的布局事实已迁入场景合同和唯一 layout-nodes 源文件。
  if (document?.effect_image_reconstruction?.applicability === "effect-image" || document?.fidelity?.applicability === "frozen-target") {
    return { status: "failed", errors: ["旧 frozen-target/effect-image 内联合同已停用，请迁移到 schema_version=2.0.0 的引用式 UI 合同"], warnings: [], specialized_review: [] };
  }
  const errors = []; const warnings = []; const specialized = []; validateRoot(document, errors); if (!isObject(document)) return { status: "failed", errors, warnings, specialized_review: specialized };
  const mode = resolveVisualValidationMode(document); validateVisualValidationPolicy(errors, "visual_validation", document);
  validateScope(document.scope, errors); validateFidelityLifecycle(document, errors); const coverage = resolveOrientationCoverage(document.orientationPolicy); errors.push(...coverage.errors); validateTargets(document.targets, errors, coverage); validateResponsiveContract(document, errors, coverage); const spaces = validateCoordinateSpaces(document.coordinate_spaces, errors); const ids = validateRegions(document, spaces, errors, specialized); validateScopeRegionIds(document.scope, ids, errors); validateReferenceGraph(document, ids, errors); validateContent(document.content, errors); validateBreakpoints(document.breakpoints, errors); validatePlatformAndScrolling(document, ids, errors); validateDynamicContent(document.dynamic_content, ids, errors); validateOverlays(document.overlay_rules, ids, errors, specialized); validateOverlayCoverage(document, ids, errors); validateInvariants(document.invariants, ids, errors, mode);
  validateEvidenceMatrix(document.evidence_matrix, errors, mode, coverage); validateProgrammaticTextEvidence(document, errors);
  if (isObject(document.dynamic_content?.localization) && !["forbid-critical", "forbid"].includes(document.dynamic_content.localization.truncate_policy)) warnings.push("本地化截断策略未明确禁止关键文本");
  return { status: errors.length ? "failed" : "passed", errors, warnings, specialized_review: specialized };
}

/** 检查 effect-image UI 引用合同的精简根结构。 */
function validateReferenceContractRoot(document, errors) {
  if (!isObject(document)) { errors.push("根对象必须是 JSON 对象"); return false; }
  for (const field of REFERENCE_CONTRACT_FIELDS) if (!Object.hasOwn(document, field)) errors.push(`缺少根字段：${field}`);
  for (const field of Object.keys(document)) if (!REFERENCE_CONTRACT_ALLOWED_FIELDS.has(field)) errors.push(`schema 2.0.0 禁止重复布局事实或未定义字段：${field}`);
  if (document.schema_version !== "2.0.0") errors.push("schema_version 必须为 2.0.0");
  for (const field of ["contract_id", "contract_version", "project_policy_file", "scene_contract_file"]) if (!isString(document[field])) errors.push(`字段 ${field} 必须是非空字符串`);
  return true;
}

/** 只在项目公共策略文件中校验共享坐标、方向、视口和运行策略。 */
function validateProjectLayoutPolicy(policy, errors) {
  if (!isObject(policy)) { errors.push("project policy 必须是 JSON 对象"); return null; }
  for (const field of [...PROJECT_POLICY_METADATA_FIELDS, ...PROJECT_POLICY_FIELDS]) if (!Object.hasOwn(policy, field)) errors.push(`project policy 缺少字段：${field}`);
  for (const field of Object.keys(policy)) if (!PROJECT_POLICY_ALLOWED_FIELDS.has(field)) errors.push(`project policy 不允许包含场景或布局专属字段：${field}`);
  if (policy.schema_version !== "1.0.0") errors.push("project policy.schema_version 必须为 1.0.0");
  for (const field of ["policy_id", "policy_version"]) if (!isString(policy[field])) errors.push(`project policy.${field} 必须是非空字符串`);
  const coverage = resolveOrientationCoverage(policy.orientationPolicy);
  errors.push(...coverage.errors.map((item) => `project policy: ${item}`));
  validateTargets(policy.targets, errors, coverage);
  validateResponsiveContract(policy, errors, coverage, { referencedPolicy: true });
  validateCoordinateSpaces(policy.coordinate_spaces, errors);
  return coverage;
}

/** 校验项目冻结目标是否落在公共 UI 策略声明的方向与视口范围内。 */
function validateProjectPolicyTargetCompatibility(policy, scene, errors) {
  const conditions = scene?.target_conditions ?? scene?.targetConditions;
  const viewport = conditions?.viewport ?? conditions?.target_viewport ?? conditions?.targetViewport;
  if (!isObject(viewport) || !isNumber(viewport.width) || !isNumber(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    errors.push("scene_contract.target_conditions.viewport 缺少精确正数尺寸，无法与 project policy 核对");
    return;
  }
  const orientation = measuredOrientation(viewport);
  if (!orientation) { errors.push("冻结目标 viewport 无法确定方向"); return; }
  if (!policy?.orientationPolicy?.allowed?.includes(orientation) || !policy?.targets?.orientations?.includes(orientation)) errors.push(`冻结目标方向 ${orientation} 不在 project policy 支持范围内`);
  const minimum = policy?.targets?.min;
  const maximum = policy?.targets?.max;
  if (isObject(minimum) && isObject(maximum) && ["width", "height"].every((field) => isNumber(minimum[field]) && isNumber(maximum[field]))) {
    for (const field of ["width", "height"]) if (viewport[field] < minimum[field] || viewport[field] > maximum[field]) errors.push(`冻结目标 viewport.${field} 超出 project policy.targets min/max 范围`);
  }
  const aspect = policy?.targets?.aspect_ratio;
  if (isObject(aspect) && isNumber(aspect.min) && isNumber(aspect.max)) {
    const ratio = viewport.width / viewport.height;
    if (ratio < aspect.min || ratio > aspect.max) errors.push("冻结目标 viewport 长宽比超出 project policy.targets.aspect_ratio 范围");
  }
  if (!isObject(policy?.designResolutionPolicy?.[orientation])) errors.push(`project policy.designResolutionPolicy 缺少冻结目标方向 ${orientation}`);
}

/** 用相同策略验证入口检查场景与布局源，避免 V2 UI 另存一份节点树。 */
function validateReferencedContract(document, options = {}) {
  const errors = [];
  validateReferenceContractRoot(document, errors);
  const stage = String(options.stage ?? "V2").toUpperCase();
  const sourceOptions = { ...options, forceLayoutSourceFiles: options.forceLayoutSourceFiles === true || options.checkFiles === true };
  if (!["V2", "V4"].includes(stage)) errors.push("stage 只支持 V2 或 V4");
  let sources;
  try { sources = getUiLayoutSourceFromMap(document, options); }
  catch (error) { errors.push(error.message); }
  const policy = getUiLayoutSourceDocument(sources, document.project_policy_file, "project_policy_file");
  const scene = getUiLayoutSourceDocument(sources, document.scene_contract_file, "scene_contract_file");
  if (sources && !isObject(policy)) errors.push("project_policy_file 必须解析为 JSON 对象");
  if (sources && !isObject(scene)) errors.push("scene_contract_file 必须解析为 JSON 对象");
  if (isObject(policy)) validateProjectLayoutPolicy(policy, errors);
  if (isObject(scene)) {
    errors.push(...validateSceneReconstructionContract(scene, null, { ...sourceOptions, effectImage: true, requireFinalLayout: true, stage }));
    validateProjectPolicyTargetCompatibility(policy, scene, errors);
    try {
      resolveSceneV2LayoutSource(scene, {
        projectRoot: sourceOptions.projectRoot,
        layoutSourceDocuments: sourceOptions.layoutSourceDocuments,
        forceLayoutSourceFiles: sourceOptions.forceLayoutSourceFiles,
      });
    } catch (error) { errors.push(`scene_contract V2 唯一布局源无效：${error.message}`); }
  }
  return { status: errors.length ? "failed" : "passed", errors, warnings: [], specialized_review: [] };
}

/** 读取严格 JSON-compatible YAML 合同。 */
export async function loadContract(path) { return JSON.parse(await readFile(path, "utf8")); }

/** 校验 V2/V4 引用合同，并执行场景确认与 V4 运行证据的官方文件门。 */
export async function checkContractFiles(document, projectRoot, options = {}) {
  const errors = [];
  if (document?.schema_version === "2.0.0") {
    let sources;
    try { sources = await loadUiLayoutSourceDocuments(document, projectRoot); }
    catch (error) { errors.push(error.message); return errors; }
    const scene = getUiLayoutSourceDocument(sources, document.scene_contract_file, "scene_contract_file");
    if (!isObject(scene)) errors.push("scene_contract_file 必须解析为 JSON 对象");
    else {
      const stage = String(options.stage ?? "V2").toUpperCase();
      // 使用场景合同现有确认门，确保 PNG、review、layout decision、用户 decision 与 receipt 都真实可读。
      errors.push(...validateSceneReconstructionContract(scene, null, {
        stage,
        effectImage: true,
        requireFinalLayout: true,
        projectRoot,
        forceLayoutSourceFiles: true,
        checkFiles: true,
        layoutSourceDocuments: sources,
      }));
      try { resolveSceneV2LayoutSource(scene, { projectRoot, layoutSourceDocuments: sources, forceLayoutSourceFiles: true }); }
      catch (error) { errors.push(`scene_contract V2 唯一布局源无效：${error.message}`); }
      if (stage === "V4") errors.push(...await validateSceneRuntimeEvidenceFiles(scene, projectRoot));
    }
    return errors;
  }
  return errors;
}

/** 解析合同 CLI 的文件检查开关与项目根目录。 */
function parseArgs(argv) {
  const args = { checkFiles: false, stage: "V2" };
  for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (token === "--json") args.asJson = true; else if (token === "--check-files") args.checkFiles = true; else if (token === "--project-root") args.projectRoot = argv[++index]; else if (token === "--stage") { const stage = argv[++index]; if (!stage || stage.startsWith("-")) throw new Error("--stage 必须指定 V2 或 V4"); args.stage = stage; } else if (!token.startsWith("-") && !args.contract) args.contract = token; else throw new Error(`不支持的参数：${token}`); }
  if (!args.contract) throw new Error("必须传入一个合同文件路径"); return args;
}

/** 解析命令行、验证合同并返回退出码。 */
export async function main(argv = process.argv.slice(2)) {
  let result; let asJson = false;
  try {
    const args = parseArgs(argv); asJson = args.asJson; const document = await loadContract(args.contract);
    if (document?.schema_version === "2.0.0") {
      const projectRoot = args.projectRoot ?? process.cwd();
      const sources = await loadUiLayoutSourceDocuments(document, projectRoot);
      result = validateContract(document, { stage: args.stage, projectRoot, checkFiles: args.checkFiles, forceLayoutSourceFiles: true, layoutSourceDocuments: sources });
      if (args.checkFiles) for (const error of await checkContractFiles(document, projectRoot, { stage: args.stage })) appendUnique(result.errors, error);
    } else {
      result = validateContract(document, { stage: args.stage });
      if (args.checkFiles) result.errors.push(...await checkContractFiles(document, args.projectRoot ?? resolve(args.contract, "..", "..")));
    }
    if (result.errors.length) result.status = "failed";
  } catch (error) { result = { status: "failed", errors: [`无法解析合同：${error.message}`], warnings: [], specialized_review: [] }; }
  if (asJson) console.log(JSON.stringify(result)); else { console.log(`status: ${result.status}`); for (const error of result.errors) console.log(`error: ${error}`); for (const warning of result.warnings) console.log(`warning: ${warning}`); for (const item of result.specialized_review) console.log(`specialized_review: ${item}`); }
  return result.status === "passed" ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
