#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { validateContract as validateUiLayoutContract } from "../../cocos-game-ui-layout/scripts/validate_ui_layout_contract.mjs";
import { getUiLayoutSourceDocument, loadUiLayoutSourceDocuments, resolveSceneV2LayoutSource } from "../../cocos-game-ui-layout/scripts/ui-layout-contract-sources.mjs";
import { calculateFullBleedCoverTransform } from "../../cocos-game-asset-integration/scripts/full-bleed-background-adapter.mjs";
import { DEFAULT_DPR, isDeviceDprInput, isWorkflowDpr, parseDeviceDpr, workflowDprError } from "../../cocos-game-workflow-control/scripts/workflow-dpr-contract.mjs";
import { DEFAULT_VISUAL_VALIDATION_MODE, isExactVisualValidation, resolveVisualValidationMode, validateVisualValidationPolicy } from "../../cocos-game-workflow-control/scripts/visual-validation-policy.mjs";
import { resolveOrientationCoverage, measuredOrientation, matchesRepresentativeViewport, validateOrientationPolicyConsistency, hasSamePageOrientationChange } from "../../cocos-game-workflow-control/scripts/orientation-validation-scope.mjs";

export const DEFAULT_HOOK_NAME = "__COCOS_VISUAL_VALIDATION__";
const NORMALIZED_CONTRACT = Symbol("normalized-responsive-contract");

/** 过滤非有限数字，避免坏的 Hook 数据污染几何计算。 */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 将 DOMRect 或 Hook 矩形统一为可序列化的 CSS 像素矩形。 */
export function normalizeRect(value) {
  if (!value || typeof value !== "object") return null;
  const x = finiteNumber(value.x ?? value.left);
  const y = finiteNumber(value.y ?? value.top);
  let width = finiteNumber(value.width);
  let height = finiteNumber(value.height);
  if (width === null && finiteNumber(value.right) !== null && x !== null) width = finiteNumber(value.right) - x;
  if (height === null && finiteNumber(value.bottom) !== null && y !== null) height = finiteNumber(value.bottom) - y;
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/** 计算 Canvas 相对 viewport 四边的空隙；负值代表 Canvas 溢出。 */
export function computeEdgeGaps(viewportRect, canvasRect) {
  const viewport = normalizeRect(viewportRect);
  const canvas = normalizeRect(canvasRect);
  if (!viewport || !canvas) return null;
  return {
    left: canvas.x - viewport.x,
    top: canvas.y - viewport.y,
    right: viewport.x + viewport.width - (canvas.x + canvas.width),
    bottom: viewport.y + viewport.height - (canvas.y + canvas.height)
  };
}

/** 计算矩形覆盖 viewport 的面积比例，超出部分不重复计数。 */
export function computeCoverage(rect, viewportRect) {
  const source = normalizeRect(rect);
  const viewport = normalizeRect(viewportRect);
  if (!source || !viewport || viewport.width <= 0 || viewport.height <= 0) return null;
  const left = Math.max(source.x, viewport.x);
  const top = Math.max(source.y, viewport.y);
  const right = Math.min(source.x + source.width, viewport.x + viewport.width);
  const bottom = Math.min(source.y + source.height, viewport.y + viewport.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / (viewport.width * viewport.height);
}

/** 读取逻辑画布、背景、安全区和关键 UI，并标识各结论是否有 Hook 来源。 */
export function readHookData(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      present: false,
      logicalSize: null,
      backgroundRect: null,
      backgroundSourceSize: null,
      backgroundFitMode: null,
      safeArea: null,
      keyUiRects: null,
      cssScale: null,
      backingSize: null,
      gameSize: null,
      cameraViewport: null,
      cameraZoom: null,
      cameraOrigin: null,
      inputHitResults: null,
      displayLayerTrajectory: null
    };
  }
  const logical = snapshot.logicalCanvas ?? snapshot.logicalSize;
  const background = snapshot.background && typeof snapshot.background === "object" ? snapshot.background : {};
  const backgroundSource = background.sourceSize ?? snapshot.backgroundSourceSize;
  const logicalSize = logical && finiteNumber(logical.width) !== null && finiteNumber(logical.height) !== null
    ? { width: Number(logical.width), height: Number(logical.height) }
    : null;
  const safeRect = normalizeRect(snapshot.safeArea?.rect);
  const safeArea = snapshot.safeArea && typeof snapshot.safeArea === "object" && safeRect && safeRect.width > 0 && safeRect.height > 0
    ? {
        top: finiteNumber(snapshot.safeArea.top) ?? 0,
        right: finiteNumber(snapshot.safeArea.right) ?? 0,
        bottom: finiteNumber(snapshot.safeArea.bottom) ?? 0,
        left: finiteNumber(snapshot.safeArea.left) ?? 0,
        rect: safeRect
      }
    : null;
  return {
    present: true,
    version: snapshot.version ?? null,
    logicalSize,
    backgroundRect: normalizeRect(snapshot.backgroundRect ?? background.rect),
    backgroundSourceSize: backgroundSource && finiteNumber(backgroundSource.width) !== null && finiteNumber(backgroundSource.height) !== null
      ? { width: Number(backgroundSource.width), height: Number(backgroundSource.height) }
      : null,
    backgroundFitMode: background.fitMode ?? snapshot.backgroundFitMode ?? null,
    safeArea,
    keyUiRects: snapshot.keyUiRects ?? snapshot.uiRects ?? null,
    cssScale: snapshot.cssScale ?? null,
    backingSize: snapshot.backingSize ?? null,
    gameSize: snapshot.gameSize ?? null,
    cameraViewport: normalizeRect(snapshot.cameraViewport),
    cameraZoom: snapshot.cameraZoom ?? null,
    cameraOrigin: snapshot.cameraOrigin ?? null,
    inputHitResults: snapshot.inputHitResults ?? null,
    displayLayerTrajectory: snapshot.displayLayerTrajectory ?? null,
    raw: snapshot
  };
}

/** 检查对象是否显式声明字段，用于区分缺失契约与 false。 */
function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * 收集合同中所有 DPR，区分有效证据声明和原始设备输入。
 * `dpr` 是已经解析过的证据值，必须在 (0,2]；`deviceScaleFactor` 是设备
 * 输入，允许大于 2 并由统一解析器封顶，其他非法类型仍必须失败。
 */
function collectDprErrors(value, path = "contract", errors = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return errors;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDprErrors(item, `${path}[${index}]`, errors, seen));
    return errors;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "dpr" && !isWorkflowDpr(nested)) errors.push(workflowDprError(`${path}.${key}`, nested));
    if (key === "deviceScaleFactor" && !isDeviceDprInput(nested)) errors.push(workflowDprError(`${path}.${key}（原始设备值）`, nested));
    collectDprErrors(nested, `${path}.${key}`, errors, seen);
  }
  return errors;
}

/** 把 V2 公共策略映射为响应式 QA 使用的检查面，不复制任何场景或节点布局事实。 */
function referencedPolicySettings(policy) {
  const evidence = policy?.requiredRuntimeEvidence ?? {};
  const requiredFields = Array.isArray(evidence.requiredFields) ? evidence.requiredFields : null;
  const fillViewport = policy?.designResolutionPolicy?.canvasFit === "fill-viewport";
  const background = policy?.designResolutionPolicy?.backgroundFit;
  const resizeAssertions = evidence.resizeAssertions;
  return {
    visual_validation: { mode: evidence.mode },
    applicability: "effect-image",
    viewport: {
      // fill-viewport 明确禁止画布留黑边；没有显式项目语义时保留 undefined 触发决策缺口。
      mode: fillViewport ? "full-viewport" : undefined,
      strategy: typeof policy?.scaleMode === "string" ? policy.scaleMode.toUpperCase() : undefined,
      allowWhitespace: fillViewport ? false : undefined,
      backgroundCoverageTarget: background?.mode === "cover-v1" ? 1 : undefined,
      backgroundFit: {
        mode: background?.mode,
        sourceFocus: background?.sourceFocalPoint,
        targetPoint: background?.targetPoint,
      },
      requireCanvasCoverage: fillViewport,
    },
    safeArea: {
      required: requiredFields?.includes("safeArea"),
      requiredDefined: requiredFields?.includes("safeArea") ?? false,
    },
    resize: {
      required: resizeAssertions?.samePage === true,
      requiredDefined: resizeAssertions?.samePage !== undefined,
      trajectory: Array.isArray(policy?.resizePolicy?.events) ? policy.resizePolicy.events.map(String) : [],
    },
    hook: {
      required: requiredFields?.includes("keyUiRects") ?? true,
      name: DEFAULT_HOOK_NAME,
    },
    orientationPolicy: policy?.orientationPolicy,
    responsiveViewportContract: {
      applicability: evidence.displayLayerTrajectory?.required === true ? "DISPLAY_LAYER" : "SCENE",
      orientationPolicy: policy?.orientationPolicy,
      representativeViewports: policy?.representativeViewports,
      requiredRuntimeEvidence: evidence,
    },
    viewports: Array.isArray(policy?.representativeViewports)
      ? policy.representativeViewports.map((item) => ({
          name: item.id,
          width: item.width,
          height: item.height,
          deviceScaleFactor: item.rawDpr,
        }))
      : undefined,
  };
}

/** 从冻结场景身份和唯一节点文件组装 QA 身份来源；Map 仅供结构验证显式注入。 */
function resolveReferencedUiContext(source, options) {
  const validation = validateUiLayoutContract(source, { ...options, stage: options.stage ?? "V2" });
  const policy = getUiLayoutSourceDocument(options.layoutSourceDocuments, source.project_policy_file, "project_policy_file");
  const scene = getUiLayoutSourceDocument(options.layoutSourceDocuments, source.scene_contract_file, "scene_contract_file");
  let layoutSource = null;
  const errors = [...validation.errors];
  if (scene && typeof scene === "object") {
    try {
      const resolved = resolveSceneV2LayoutSource(scene, options);
      layoutSource = {
        nodesFile: scene.layout_decomposition?.layout_source?.nodes_file ?? scene.layoutDecomposition?.layoutSource?.nodes_file ?? null,
        layoutNodeIds: resolved.nodes.map((node) => node.layout_node_id),
      };
    } catch (error) {
      errors.push(`scene_contract V2 唯一布局源无效：${error.message}`);
    }
  }
  const target = scene?.target_conditions ?? scene?.targetConditions ?? {};
  const identity = {
    schemaVersion: source.schema_version,
    contractVersion: target.layout_contract_version ?? target.layoutContractVersion,
    scenes: [target.scene_id ?? target.sceneId].filter((value) => typeof value === "string"),
    states: [target.state_id ?? target.stateId].filter((value) => typeof value === "string"),
    visualBaselineVersion: target.visual_baseline_version ?? target.visualBaselineVersion,
    sourceKind: "scene-contract",
  };
  const trustworthy = validation.status === "passed" && errors.length === 0 && layoutSource !== null
    && typeof identity.contractVersion === "string" && identity.scenes.length === 1
    && identity.states.length === 1 && typeof identity.visualBaselineVersion === "string";
  return { policy, scene, identity, layoutSource, trusted: trustworthy, errors: [...new Set(errors)] };
}

/** 只提取门禁所需契约，保留 undefined 以便输出 decision_gap 而不是猜测。 */
export function normalizeContract(raw = {}, options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  if (source[NORMALIZED_CONTRACT] === true) return source;
  const referenced = source.schema_version === "2.0.0" ? resolveReferencedUiContext(source, options) : null;
  const settings = referenced ? referencedPolicySettings(referenced.policy) : source;
  const uiValidation = referenced ? { status: referenced.trusted ? "passed" : "failed", errors: referenced.errors } : validateUiLayoutContract(source);
  const trustedUiContract = uiValidation.status === "passed";
  const viewport = settings.viewport && typeof settings.viewport === "object" ? settings.viewport : {};
  const safeArea = settings.safeArea && typeof settings.safeArea === "object" ? settings.safeArea : {};
  const resize = settings.resize && typeof settings.resize === "object" ? settings.resize : {};
  const backgroundFit = viewport.backgroundFit && typeof viewport.backgroundFit === "object" ? viewport.backgroundFit : {};
  const allowWhitespace = own(viewport, "allowWhitespace") && viewport.allowWhitespace !== null
    ? Boolean(viewport.allowWhitespace)
    : own(settings, "allowWhitespace") && settings.allowWhitespace !== null
      ? Boolean(settings.allowWhitespace)
      : undefined;
  const tolerance = finiteNumber(viewport.whitespaceTolerancePx ?? settings.whitespaceTolerancePx);
  const target = finiteNumber(viewport.backgroundCoverageTarget ?? settings.backgroundCoverageTarget);
  const strategyValue = viewport.strategy ?? settings.strategy;
  const modeValue = viewport.mode ?? settings.mode;
  const normalized = {
    visual_validation: { mode: resolveVisualValidationMode(settings) },
    applicability: settings.applicability ?? null,
    viewport: {
      mode: modeValue === undefined || modeValue === null ? undefined : String(modeValue).toLowerCase(),
      strategy: strategyValue === undefined || strategyValue === null ? undefined : String(strategyValue).toUpperCase(),
      allowWhitespace,
      whitespaceTolerancePx: tolerance ?? 0,
      backgroundCoverageTarget: target,
      backgroundFit: {
        mode: backgroundFit.mode === undefined || backgroundFit.mode === null ? undefined : String(backgroundFit.mode).toLowerCase(),
        sourceFocus: backgroundFit.sourceFocalPoint ?? backgroundFit.sourceFocus,
        targetPoint: backgroundFit.targetPoint
      },
      requireCanvasCoverage: Boolean(viewport.requireCanvasCoverage ?? settings.requireCanvasCoverage)
    },
    safeArea: {
      required: Boolean(safeArea.required),
      requiredDefined: safeArea.requiredDefined ?? own(safeArea, "required")
    },
    resize: {
      required: Boolean(resize.required),
      requiredDefined: resize.requiredDefined ?? own(resize, "required"),
      trajectory: Array.isArray(resize.trajectory) ? resize.trajectory.map(String) : []
    },
    hook: {
      required: settings.hook?.required === undefined ? true : Boolean(settings.hook.required),
      name: settings.hook?.name ? String(settings.hook.name) : DEFAULT_HOOK_NAME
    },
    effectImageApplicability: referenced ? "effect-image" : settings.effect_image_reconstruction?.applicability ?? settings.effectImageApplicability ?? null,
    identityContract: {
      trusted: trustedUiContract,
      validationErrors: trustedUiContract ? [] : uiValidation.errors,
      schemaVersion: trustedUiContract ? referenced?.identity.schemaVersion ?? source.schema_version : null,
      contractVersion: trustedUiContract ? referenced?.identity.contractVersion ?? source.contract_version : null,
      scenes: trustedUiContract ? referenced ? referenced.identity.scenes : source.scope?.scenes ?? null : null,
      states: trustedUiContract ? referenced ? referenced.identity.states : source.scope?.states ?? null : null,
      codeCandidate: trustedUiContract ? (referenced ? null : source.scope?.bindings?.code_candidate ?? null) : null,
      visualBaselineVersion: trustedUiContract ? referenced ? referenced.identity.visualBaselineVersion : source.frozen_visual_target?.visual_baseline_version ?? source.scope?.bindings?.visual_baseline ?? null : null,
      targetSha256: trustedUiContract ? referenced?.scene?.target_conditions?.target_sha256 ?? referenced?.scene?.targetConditions?.targetSha256 ?? source.frozen_visual_target?.target_sha256 ?? null : null,
      sourceKind: referenced?.identity.sourceKind ?? "ordinary-ui-contract"
    },
    viewports: settings.viewports ?? settings.viewportMatrix ?? null,
    responsiveViewportContract: settings.logicalViewportSpace
      ? {
          applicability: settings.requiredRuntimeEvidence?.displayLayerTrajectory?.required === true ? "DISPLAY_LAYER" : "SCENE",
          orientationPolicy: settings.orientationPolicy,
          representativeViewports: settings.representativeViewports,
          requiredRuntimeEvidence: settings.requiredRuntimeEvidence
        }
      : settings.responsiveViewportContract ?? settings.responsive_viewport_contract ?? null,
    layoutSource: trustedUiContract ? referenced?.layoutSource ?? null : null,
    dprErrors: collectDprErrors(referenced?.policy ?? source)
  };
  const nestedOrientation = (settings.responsiveViewportContract ?? settings.responsive_viewport_contract)?.orientationPolicy;
  // 同一输入不能让 QA 和控制面各自采用不同的方向范围。
  normalized.orientationErrors = settings.orientationPolicy !== undefined && nestedOrientation !== undefined
    ? validateOrientationPolicyConsistency(settings.orientationPolicy, nestedOrientation) : [];
  // UI 合同和响应式脚本共享同一视觉模式；非法模式沿用 usability 计算，但在报告中明确暴露错误。
  normalized.visualValidationErrors = [];
  validateVisualValidationPolicy(normalized.visualValidationErrors, "visual_validation", settings);
  // 仅模块内部生成的不可序列化标记允许重复归一化，JSON 调用方无法伪造权威身份。
  Object.defineProperty(normalized, NORMALIZED_CONTRACT, { value: true });
  return normalized;
}

/** 将状态映射为可比较的严重度。 */
function statusRank(status) {
  return { pass: 0, fit_only: 1, decision_gap: 2, unverified: 3, fail: 4 }[status] ?? 3;
}

/** 取多个测量结论中的最严重状态。 */
function worstStatus(statuses) {
  return statuses.reduce((worst, status) => statusRank(status) > statusRank(worst) ? status : worst, "pass");
}

/** 按契约缺失、实现偏差、错误放行三类输出主次根因；普通缺证不臆断为验收问题。 */
export function classifyRootCause({ failures = [], decisionGaps = [], acceptanceFailures = [] } = {}) {
  const causes = [];
  if (decisionGaps.length > 0) causes.push({ code: "方案缺失", reason: decisionGaps.join("；") });
  if (failures.length > 0) causes.push({ code: "执行问题", reason: failures.join("；") });
  if (acceptanceFailures.length > 0) causes.push({ code: "验收问题", reason: acceptanceFailures.join("；") });
  return { primary: causes[0]?.code ?? null, secondary: causes.slice(1).map((cause) => cause.code), details: causes };
}

/** 依据逻辑、CSS 与真实 backing 尺寸计算两段比例，不用 DPR 推导伪造 backing。 */
function deriveScaling(canvasRect, backingSize, logicalSize, dpr, hookScale) {
  const canvas = normalizeRect(canvasRect);
  const physicalDpr = parseDeviceDpr(dpr, DEFAULT_DPR);
  const cssScale = hookScale && typeof hookScale === "object"
    ? { x: finiteNumber(hookScale.x) ?? null, y: finiteNumber(hookScale.y) ?? null }
    : logicalSize && canvas
      ? { x: canvas.width / logicalSize.width, y: canvas.height / logicalSize.height }
      : { x: null, y: null };
  return {
    css: cssScale,
    physical: { dpr: physicalDpr, width: backingSize?.width ?? null, height: backingSize?.height ?? null },
    logicalToCssScale: cssScale,
    cssToPhysicalScale: canvas && backingSize
      ? { x: backingSize.width / canvas.width, y: backingSize.height / canvas.height }
      : { x: null, y: null }
  };
}

/** 评估一个 viewport；失败优先于 decision_gap，避免几何硬失败被缺字段掩盖。 */
export function evaluateViewport({ viewportRect, canvasRect, backingSize = null, hookSnapshot, contract, contractOptions = {}, devicePixelRatio, screenshot = null }) {
  const normalized = normalizeContract(contract, contractOptions);
  const exact = isExactVisualValidation(normalized);
  const viewport = normalizeRect(viewportRect);
  const canvas = normalizeRect(canvasRect);
  const hook = readHookData(hookSnapshot);
  const edgeGaps = computeEdgeGaps(viewport, canvas);
  const backgroundCoverage = computeCoverage(hook.backgroundRect, viewport);
  const fullViewport = normalized.viewport.mode === "full-viewport" || normalized.viewport.requireCanvasCoverage;
  const tolerance = normalized.viewport.whitespaceTolerancePx;
  const failures = [];
  const decisionGaps = [];
  const unverified = [];
  const strictRuntimeEvidence = normalized.responsiveViewportContract !== null;
  let backgroundFit = null;

  if (normalized.dprErrors.length > 0) failures.push(...normalized.dprErrors);
  if (normalized.visualValidationErrors.length > 0) failures.push(...normalized.visualValidationErrors);
  const measuredDpr = parseDeviceDpr(devicePixelRatio, DEFAULT_DPR);
  if (devicePixelRatio !== undefined && !isDeviceDprInput(devicePixelRatio)) failures.push(workflowDprError("实际测得原始设备 DPR", devicePixelRatio));
  if (!viewport || !canvas) unverified.push("viewportRect 或 canvasRect 缺失");
  const backing = backingSize ?? hook.backingSize;
  const normalizedBacking = backing && finiteNumber(backing.width) !== null && finiteNumber(backing.height) !== null
    ? { width: Number(backing.width), height: Number(backing.height) }
    : null;
  if (strictRuntimeEvidence && !normalizedBacking) unverified.push("缺少 Canvas 真实 backing 尺寸");
  if (canvas && normalizedBacking) {
    const expectedWidth = canvas.width * measuredDpr;
    const expectedHeight = canvas.height * measuredDpr;
    // 浏览器最终 backing 是整数像素，允许最多 1 像素的量化误差。
    if (Math.abs(normalizedBacking.width - expectedWidth) > 1 || Math.abs(normalizedBacking.height - expectedHeight) > 1) failures.push("Canvas backing 不符合 CSS 显示尺寸 × 有效 DPR");
  }
  if (fullViewport && edgeGaps && (edgeGaps.left < -tolerance || edgeGaps.top < -tolerance || edgeGaps.right < -tolerance || edgeGaps.bottom < -tolerance)) {
    failures.push("Canvas 溢出 viewport");
  }
  if (fullViewport && edgeGaps && normalized.viewport.allowWhitespace === false && Object.values(edgeGaps).some((gap) => gap > tolerance)) {
    failures.push("Canvas 四边存在未许可留白");
  }
  // usability 只报告真实可见性问题；这些精确判定面和矩阵字段由 exact 模式强制声明。
  if (exact && normalized.viewport.allowWhitespace === undefined) decisionGaps.push("未定义留白许可");
  if (exact && normalized.viewport.strategy === undefined) decisionGaps.push("未定义适配策略");
  if (exact && normalized.viewport.mode === undefined) decisionGaps.push("未定义 viewport 判定面");
  if (exact && (normalized.viewport.backgroundCoverageTarget === null || normalized.viewport.backgroundCoverageTarget === undefined)) decisionGaps.push("未定义背景覆盖目标");
  if (normalized.viewport.backgroundCoverageTarget !== null && normalized.viewport.backgroundCoverageTarget !== undefined && normalized.viewport.backgroundFit.mode === undefined) decisionGaps.push("未定义满幅背景适配模式");
  if (exact && !normalized.safeArea.requiredDefined) decisionGaps.push("未定义安全区要求");
  if (exact && !normalized.resize.requiredDefined) decisionGaps.push("未定义动态 resize 要求");
  if (normalized.viewport.backgroundCoverageTarget !== null && normalized.viewport.backgroundCoverageTarget !== undefined) {
    if (backgroundCoverage === null) unverified.push("缺少背景矩形 Hook");
    else if (backgroundCoverage + 1e-9 < normalized.viewport.backgroundCoverageTarget) failures.push("背景覆盖率低于契约目标");
  }
  if (normalized.viewport.backgroundFit.mode !== undefined) {
    if (normalized.viewport.backgroundFit.mode !== "cover-v1") {
      decisionGaps.push("满幅背景适配模式必须为 cover-v1");
    } else if (!viewport || !hook.backgroundRect || !hook.backgroundSourceSize) {
      unverified.push("缺少 cover-v1 所需的背景资源尺寸或矩形 Hook");
    } else if (hook.backgroundSourceSize.width <= 0 || hook.backgroundSourceSize.height <= 0) {
      failures.push("运行时背景资源尺寸必须为正有限数");
    } else if (hook.backgroundFitMode !== "cover-v1") {
      failures.push("运行时背景未报告 cover-v1 适配模式");
    } else {
      if (normalized.viewport.backgroundFit.sourceFocus === undefined) decisionGaps.push("未冻结满幅背景源图焦点");
      if (normalized.viewport.backgroundFit.targetPoint === undefined) decisionGaps.push("未冻结满幅背景目标落点");
      try {
        const expected = calculateFullBleedCoverTransform({
          sourceWidth: hook.backgroundSourceSize.width,
          sourceHeight: hook.backgroundSourceSize.height,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          sourceFocus: normalized.viewport.backgroundFit.sourceFocus,
          targetPoint: normalized.viewport.backgroundFit.targetPoint
        });
        const actual = {
          x: hook.backgroundRect.x - viewport.x,
          y: hook.backgroundRect.y - viewport.y,
          displayWidth: hook.backgroundRect.width,
          displayHeight: hook.backgroundRect.height
        };
        // DOMRect 会产生亚像素量化，0.5 CSS 像素足以吸收取整误差而不会掩盖错误缩放轴。
        const tolerancePx = 0.5;
        const matches = Object.keys(actual).every((key) => Math.abs(actual[key] - expected[key]) <= tolerancePx);
        backgroundFit = { mode: "cover-v1", sourceSize: hook.backgroundSourceSize, expected, actual, matches };
        // 覆盖率无法识别非等比拉伸或错误裁切，因此必须逐项核对实际几何。
        if (!matches) failures.push("背景几何不符合 cover-v1 等比缩放或焦点裁切");
      } catch (error) {
        decisionGaps.push(`满幅背景适配参数非法：${error.message}`);
      }
    }
  }
  if (normalized.safeArea.required && !hook.safeArea) unverified.push("缺少安全区 Hook");
  if (normalized.hook.required && !hook.present) unverified.push("缺少只读验证 Hook");
  if (normalized.hook.required && hook.present && !(typeof hook.version === "string" && hook.version.trim() || typeof hook.version === "number" && Number.isFinite(hook.version))) unverified.push("Hook 缺少有效版本");
  const uiRects = hook.keyUiRects && typeof hook.keyUiRects === "object" && !Array.isArray(hook.keyUiRects) ? Object.values(hook.keyUiRects) : [];
  if (normalized.hook.required && (uiRects.length === 0 || uiRects.some((rect) => { const normalizedRect = normalizeRect(rect); return !normalizedRect || normalizedRect.width <= 0 || normalizedRect.height <= 0; }))) unverified.push("Hook 缺少非空有效 keyUiRects");
  if (normalized.hook.required && (!screenshot || !screenshot.path)) unverified.push("缺少当前 viewport 截图证据");
  if (!hook.logicalSize) unverified.push("缺少逻辑画布尺寸 Hook");
  if (strictRuntimeEvidence && (!hook.cameraViewport || finiteNumber(hook.cameraZoom) === null || !hook.cameraOrigin)) unverified.push("缺少 Camera viewport/zoom/origin 运行测量");
  if (strictRuntimeEvidence && (!Array.isArray(hook.inputHitResults) || hook.inputHitResults.length === 0)) unverified.push("缺少输入命中映射结果");
  if (strictRuntimeEvidence && Array.isArray(hook.inputHitResults) && hook.inputHitResults.some((item) => item?.hit !== true && item?.passed !== true)) failures.push("输入命中映射存在失败结果");

  let status = failures.length > 0 ? "fail" : decisionGaps.length > 0 ? "decision_gap" : unverified.length > 0 ? "unverified" : "pass";
  if (status === "pass" && normalized.viewport.strategy === "FIT") status = "fit_only";
  const scaling = deriveScaling(canvas, normalizedBacking, hook.logicalSize, measuredDpr, hook.cssScale);
  return {
    status,
    responsivePass: status === "pass",
    failures,
    decisionGaps,
    unverified,
    viewportRect: viewport,
    canvasRect: canvas,
    logicalSize: hook.logicalSize,
    backingSize: normalizedBacking,
    cssDisplaySize: canvas ? { width: canvas.width, height: canvas.height } : null,
    rawDevicePixelRatio: devicePixelRatio ?? null,
    effectiveDevicePixelRatio: measuredDpr,
    edgeGaps,
    backgroundCoverage,
    backgroundFit,
    safeArea: hook.safeArea,
    keyUiRects: hook.keyUiRects,
    inputHitResults: hook.inputHitResults,
    displayLayerTrajectory: hook.displayLayerTrajectory,
    cameraViewport: hook.cameraViewport,
    cameraZoom: hook.cameraZoom,
    cameraOrigin: hook.cameraOrigin,
    gameSize: hook.gameSize,
    logicalToCssScale: scaling.logicalToCssScale,
    cssToPhysicalScale: scaling.cssToPhysicalScale,
    scaling,
    hook: { present: hook.present, version: hook.version ?? null },
    rootCause: classifyRootCause({ failures, decisionGaps }),
    screenshot
  };
}

/** 对嵌套对象做稳定序列化，避免键顺序影响 resize 比较。 */
function stableStringify(value) {
  return JSON.stringify(value, (_key, current) => current && typeof current === "object" && !Array.isArray(current)
    ? Object.keys(current).sort().reduce((sorted, key) => { sorted[key] = current[key]; return sorted; }, {})
    : current);
}

/** 比较相邻视口，确保 resize 轨迹可证明发生了同页几何变化。 */
export function buildResizeRecords(measurements, contract = {}, contractOptions = {}) {
  const normalized = normalizeContract(contract, contractOptions);
  const records = [];
  for (let index = 1; index < measurements.length; index += 1) {
    const before = measurements[index - 1];
    const after = measurements[index];
    const contextChanged = before.contextId !== undefined && after.contextId !== undefined && before.contextId !== after.contextId;
    const pageReloaded = Boolean(before.pageReloaded || after.pageReloaded);
    const beforeBackground = before.backgroundFit?.matches === true ? before.backgroundFit.actual : null;
    const afterBackground = after.backgroundFit?.matches === true ? after.backgroundFit.actual : null;
    records.push({
      from: before.name ?? String(index - 1),
      to: after.name ?? String(index),
      pageReloaded,
      contextChanged,
      samePage: !contextChanged && !pageReloaded && after.samePageWithPrevious !== false,
      canvasChanged: stableStringify(before.canvasRect) !== stableStringify(after.canvasRect),
      backgroundChanged: beforeBackground !== null && afterBackground !== null && stableStringify(beforeBackground) !== stableStringify(afterBackground),
      keyUiChanged: stableStringify(before.keyUiRects) !== stableStringify(after.keyUiRects),
      viewportChanged: stableStringify(before.viewportRect) !== stableStringify(after.viewportRect),
      strategy: normalized.viewport.strategy ?? null
    });
  }
  const required = normalized.resize.required || normalized.resize.trajectory.length > 1;
  const validReflow = records.some((record) => record.samePage && record.viewportChanged && (record.canvasChanged || record.backgroundChanged || record.keyUiChanged));
  // DPR 由设备动态决定；resize 证据只证明同一 context 的视口变化。
  const trajectoryStatus = required ? validReflow ? "pass" : records.length === 0 ? "unverified" : "fail" : "pass";
  return { records, required, status: trajectoryStatus };
}

/** 校验默认 usability 的最小真实运行矩阵；每一项都来自测量而不是命令行声明。 */
export function validateRepresentativeMatrix(measurements, { requireDisplayLayer = false, orientationPolicy } = {}) {
  const coverage = resolveOrientationCoverage(orientationPolicy);
  const missing = [...coverage.errors];
  const viewport = (item) => item?.viewportRect ?? {};
  const effective = (item) => item?.effectiveDevicePixelRatio ?? item?.scaling?.physical?.dpr;
  const raw = (item) => item?.rawDevicePixelRatio;
  const labels = { 'narrow-portrait': '窄竖屏', 'standard-portrait': '标准竖屏', landscape: '横屏', 'desktop-wide': '桌面宽屏' };
  for (const kind of coverage.viewportKinds) if (!measurements.some((item) => matchesRepresentativeViewport(kind, viewport(item)))) missing.push(labels[kind]);
  if (measurements.some((item) => !coverage.orientations.includes(measuredOrientation(viewport(item))))) missing.push("视口方向不在 orientationPolicy.allowed 中");
  if (!measurements.some((item) => effective(item) === 1)) missing.push("DPR 1");
  if (!measurements.some((item) => [1.25, 1.5].includes(effective(item)))) missing.push("DPR 1.25 或 1.5");
  if (!measurements.some((item) => effective(item) === 2)) missing.push("DPR 2");
  if (!measurements.some((item) => typeof raw(item) === "number" && raw(item) > 2 && effective(item) === 2)) missing.push("DPR 大于 2 的封顶证据");
  const samePageResize = measurements.some((item, index) => index > 0 && item.samePageWithPrevious === true && stableStringify(viewport(item)) !== stableStringify(viewport(measurements[index - 1])));
  if (!samePageResize) missing.push("同页面连续 resize");
  const downToOne = measurements.some((item, index) => index > 0
    && item.samePageWithPrevious === true
    && item.pageReloaded !== true
    && item.contextId !== undefined
    && item.contextId === measurements[index - 1].contextId
    && effective(item) === 1
    && effective(measurements[index - 1]) > 1);
  if (!downToOne) missing.push("DPR 降至 1");
  const sameDprResize = measurements.some((item, index) => index > 0 && item.samePageWithPrevious === true && effective(item) === effective(measurements[index - 1]) && stableStringify(viewport(item)) !== stableStringify(viewport(measurements[index - 1])));
  if (!sameDprResize) missing.push("DPR 不变时再次 resize");
  // 单方向项目的同页变化只需 resize；双方向才需证明页面内实际旋转。
  if (coverage.requiresOrientationChange && !hasSamePageOrientationChange(measurements)) missing.push("方向切换");
  if (requireDisplayLayer) {
    const phases = new Set(measurements.flatMap((item) => Array.isArray(item.displayLayerTrajectory) ? item.displayLayerTrajectory.map((step) => step?.phase) : []));
    for (const phase of ["open", "interact", "resize", "close", "restore"]) if (!phases.has(phase)) missing.push(`DISPLAY_LAYER ${phase}`);
  }
  return { status: missing.length ? "unverified" : "pass", missing };
}

/** 检查运行矩阵是否覆盖契约声明的命名视口，缺项不能默认为通过。 */
export function evaluateMatrixCoverage(measurements, contract = {}, contractOptions = {}) {
  const normalized = normalizeContract(contract, contractOptions);
  const exact = isExactVisualValidation(normalized);
  const coverage = resolveOrientationCoverage(normalized.responsiveViewportContract?.orientationPolicy);
  const rawDeclared = normalized.viewports;
  // 精确测量模式也只能使用项目支持方向，不能因完整矩阵扩大产品方向范围。
  const declared = normalized.responsiveViewportContract && coverage.errors.length === 0
    ? Array.isArray(rawDeclared) ? rawDeclared.filter((item) => coverage.orientations.includes(measuredOrientation(item)))
      : rawDeclared && typeof rawDeclared === "object" ? Object.fromEntries(Object.entries(rawDeclared).filter(([, item]) => coverage.orientations.includes(measuredOrientation(item)))) : rawDeclared
    : rawDeclared;
  const expected = Array.isArray(declared)
    ? declared.map((item, index) => item?.name ?? `viewport-${index + 1}`)
    : declared && typeof declared === "object"
      ? Object.keys(declared)
      : [];
  const observed = new Set(measurements.map((measurement) => measurement.name));
  const missing = expected.filter((name) => !observed.has(name));
  const expectedEntries = Array.isArray(declared) ? declared.map((item, index) => [item?.name ?? `viewport-${index + 1}`, item]) : declared && typeof declared === "object" ? Object.entries(declared) : [];
  const mismatched = [];
  for (const [name, wanted] of expectedEntries) {
    const actual = measurements.find((item) => item.name === name); if (!actual) continue;
    const actualWidth = finiteNumber(actual.viewportRect?.width); const actualHeight = finiteNumber(actual.viewportRect?.height); const actualDpr = actual.scaling?.physical?.dpr;
    const declaredDpr = wanted?.deviceScaleFactor ?? wanted?.dpr;
    const expectedDpr = declaredDpr === undefined ? DEFAULT_DPR : wanted?.deviceScaleFactor !== undefined ? parseDeviceDpr(declaredDpr) : declaredDpr;
    if (actualWidth !== finiteNumber(wanted?.width) || actualHeight !== finiteNumber(wanted?.height) || !isWorkflowDpr(expectedDpr) || !isWorkflowDpr(actualDpr) || actualDpr !== expectedDpr) mismatched.push(name);
  }
  const representative = normalized.responsiveViewportContract
    ? validateRepresentativeMatrix(measurements, { requireDisplayLayer: normalized.responsiveViewportContract.applicability === "DISPLAY_LAYER", orientationPolicy: normalized.responsiveViewportContract.orientationPolicy })
    : { status: "pass", missing: [] };
  const orientationMissing = normalized.responsiveViewportContract
    ? coverage.orientations.filter((orientation) => !measurements.some((item) => measuredOrientation(item.viewportRect) === orientation)) : [];
  if (normalized.responsiveViewportContract && coverage.requiresOrientationChange && !hasSamePageOrientationChange(measurements)) orientationMissing.push("方向切换");
  // 精确模式核对支持方向内声明的尺寸；可用性模式核对相应代表矩阵。
  const status = exact
    ? expected.length === 0 || missing.length > 0 || normalized.orientationErrors.length > 0 || (normalized.responsiveViewportContract && coverage.errors.length > 0) ? "decision_gap" : mismatched.length > 0 ? "fail" : orientationMissing.length > 0 ? "unverified" : "pass"
    : normalized.orientationErrors.length > 0 ? "decision_gap" : measurements.length === 0 ? "unverified" : representative.status;
  return { expected, observed: [...observed], missing, mismatched, representativeMissing: representative.missing, orientationMissing, orientationErrors: normalized.orientationErrors, status, mode: normalized.visual_validation.mode ?? DEFAULT_VISUAL_VALIDATION_MODE };
}

/** 核对响应式报告的场景、状态和合同版本；验收不要求或比较摘要。 */
export function validateEvidenceIdentity(identity, { contract = null } = {}) {
  const errors = []; const value = identity && typeof identity === "object" ? identity : {};
  // 摘要核对留给最终人工验收后；错误任务归属或版本仍是实际验收问题。
  for (const field of ["scene_id", "state_id", "layout_contract_version", "visual_baseline_version"]) if (typeof value[field] !== "string" || value[field].trim() === "") errors.push(`identity.${field} 必须是非空字符串`);
  const binding = contract?.identityContract;
  if (!binding?.trusted || !nonEmptyBinding(binding.schemaVersion) || !nonEmptyBinding(binding.contractVersion) || !Array.isArray(binding.scenes) || binding.scenes.length === 0 || !Array.isArray(binding.states) || binding.states.length === 0 || !nonEmptyBinding(binding.visualBaselineVersion)) errors.push("原始 UI 合同未通过完整布局合同校验，不能建立权威身份");
  else if (binding.sourceKind === "scene-contract") {
    if (!binding.scenes.includes(value.scene_id)) errors.push("identity.scene_id 与 scene_contract.target_conditions.scene_id 不一致");
    if (!binding.states.includes(value.state_id)) errors.push("identity.state_id 与 scene_contract.target_conditions.state_id 不一致");
    if (value.layout_contract_version !== binding.contractVersion) errors.push("identity.layout_contract_version 与 scene_contract.target_conditions.layout_contract_version 不一致");
    if (value.visual_baseline_version !== binding.visualBaselineVersion) errors.push("identity.visual_baseline_version 与 scene_contract.target_conditions.visual_baseline_version 不一致");
  } else {
    if (!binding.scenes.includes(value.scene_id)) errors.push("identity.scene_id 不在 UI 合同 scope.scenes 中");
    if (!binding.states.includes(value.state_id)) errors.push("identity.state_id 不在 UI 合同 scope.states 中");
    if (value.layout_contract_version !== binding.contractVersion) errors.push("identity.layout_contract_version 与 UI 合同 contract_version 不一致");
    if (value.visual_baseline_version !== binding.visualBaselineVersion) errors.push("identity.visual_baseline_version 与 UI 合同视觉基线不一致");
  }
  return errors;
}

/** 判断合同身份绑定是否存在，避免把空字符串当作可交叉验证身份。 */
function nonEmptyBinding(value) { return typeof value === "string" && value.trim().length > 0; }

/** 汇总视口、Hook 和 resize 结果，供 CLI 与无浏览器测试共用。 */
export function summarizeReport(measurements, contract = {}, identity = null, contractOptions = {}) {
  const normalized = normalizeContract(contract, contractOptions);
  const viewportStatuses = measurements.map((measurement) => measurement.status);
  const resize = buildResizeRecords(measurements, normalized);
  const matrix = evaluateMatrixCoverage(measurements, normalized);
  const identityErrors = validateEvidenceIdentity(identity, { contract: normalized });
  const status = worstStatus([...viewportStatuses, resize.status, matrix.status, normalized.dprErrors.length ? "fail" : "pass", identityErrors.length ? "decision_gap" : "pass"]);
  return {
    status,
    responsivePass: status === "pass",
    viewportCount: measurements.length,
    measurements,
    sceneId: identity?.scene_id ?? null,
    stateId: identity?.state_id ?? null,
    candidateSha256: identity?.candidate_sha256 ?? null,
    layoutContractVersion: identity?.layout_contract_version ?? null,
    visualBaselineVersion: identity?.visual_baseline_version ?? null,
    layoutSource: normalized.layoutSource,
    resize: resize.records,
    resizeTrajectory: resize.records,
    pageReloaded: resize.records.some((record) => record.pageReloaded),
    resizeStatus: resize.status,
    matrix,
    identity,
    identityErrors,
    dprErrors: normalized.dprErrors
  };
}

/** 解析单个命名或宽高格式的 viewport。 */
function parseViewportToken(token, name = null) {
  if (typeof token === "object" && token !== null) {
    const width = finiteNumber(token.width);
    const height = finiteNumber(token.height);
    if (!width || !height) throw new Error(`无效 viewport：${JSON.stringify(token)}`);
    return { ...token, name: token.name ?? name ?? `${width}x${height}`, width, height };
  }
  const match = String(token).trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) throw new Error(`viewport 必须是宽x高：${token}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { name: name ?? `${width}x${height}`, width, height };
}

/** 支持矩阵数组、命名对象和 360x800,390x844 三种命令行输入。 */
export function parseViewports(value) {
  if (Array.isArray(value)) return value.map((item, index) => parseViewportToken(item, `viewport-${index + 1}`));
  if (value && typeof value === "object") return Object.entries(value).map(([name, item]) => parseViewportToken(item, name));
  return String(value).split(",").filter(Boolean).map((token, index) => parseViewportToken(token, `viewport-${index + 1}`));
}

/** 从内联 JSON、文件或纯宽高字符串读取输入。 */
async function readJsonInput(value, { allowPlain = false } = {}) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  if (allowPlain && /^(?:\d+\s*x\s*\d+)(?:\s*,\s*\d+\s*x\s*\d+)*$/i.test(text)) return text;
  const file = await fs.readFile(text, "utf8");
  return JSON.parse(file);
}

/** 正式 V2 QA 从引用合同读取项目策略、场景和唯一 layout-nodes 文件。 */
export async function loadResponsiveContract(raw, options = {}) {
  if (raw?.schema_version !== "2.0.0") return normalizeContract(raw, options);
  if (typeof options.projectRoot !== "string" || options.projectRoot.trim() === "") throw new Error("V2 响应式 QA 必须显式提供 projectRoot");
  const layoutSourceDocuments = await loadUiLayoutSourceDocuments(raw, options.projectRoot);
  return normalizeContract(raw, {
    ...options,
    layoutSourceDocuments,
    forceLayoutSourceFiles: true,
    stage: options.stage ?? "V4",
  });
}

/** 解析 --key value/--key=value 参数，保持脚本无外部 CLI 依赖。 */
function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [key, inline] = argument.slice(2).split("=", 2);
    if (inline !== undefined) options[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) options[key] = argv[++index];
    else options[key] = true;
  }
  return options;
}

/** 将 viewport 名称转成安全的文件名片段。 */
function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "viewport";
}

/** 在页面内调用只读 Hook；Hook 异常不应阻断其他视口证据。 */
async function readPageHook(page, hookName) {
  try {
    return await page.evaluate((name) => {
      const hook = globalThis[name];
      if (!hook) return null;
      if (typeof hook === "function") return hook();
      if (typeof hook.getSnapshot === "function") {
        const snapshot = hook.getSnapshot();
        // Hook 版本通常定义在外层对象；合并后让证据能追踪快照协议版本。
        if (snapshot && typeof snapshot === "object" && snapshot.version === undefined) {
          return { ...snapshot, version: hook.version ?? null };
        }
        return snapshot;
      }
      return hook;
    }, hookName);
  } catch (error) {
    return { __hookError: error instanceof Error ? error.message : String(error) };
  }
}

/** 同时读取 Canvas CSS 矩形和 width/height backing，禁止用 DPR 反推物理尺寸。 */
async function readCanvasMetrics(page, selector) {
  return page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      backingSize: { width: element.width, height: element.height }
    };
  }, selector);
}

/** 等待两帧让 resize 后的布局和文本稳定。 */
async function waitStableFrame(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** 启动一次浏览器并在同一页面完成所有视口测量和截图。 */
async function runBrowserValidation(options) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    throw new Error(`无法动态导入 Playwright：${error instanceof Error ? error.message : String(error)}`);
  }
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) throw new Error("Playwright 未提供 chromium；请安装 playwright");
  const rawContract = await readJsonInput(options.contract);
  const contract = await loadResponsiveContract(rawContract, {
    projectRoot: String(options["project-root"] ?? process.cwd()),
    stage: "V4",
  });
  const identity = await readJsonInput(options.identity);
  const identityErrors = validateEvidenceIdentity(identity, { contract });
  if (identityErrors.length) throw new Error(identityErrors.join("；"));
  if (contract.dprErrors.length) throw new Error(contract.dprErrors.join("；"));
  if (contract.orientationErrors.length) throw new Error(contract.orientationErrors.join("；"));
  if (options.hook) contract.hook.name = String(options.hook);
  const viewportInput = await readJsonInput(options.viewports, { allowPlain: true });
  const coverage = resolveOrientationCoverage(contract.responsiveViewportContract?.orientationPolicy);
  if (coverage.errors.length) throw new Error(coverage.errors.join("；"));
  // 浏览器采集前就裁定方向范围，单方向项目不会启动另一方向的运行验证。
  const viewports = parseViewports(viewportInput ?? options.viewports ?? "390x844")
    .filter((viewport) => coverage.orientations.includes(measuredOrientation(viewport)));
  if (viewports.length === 0) throw new Error("视口矩阵没有项目支持方向的样本");
  const viewportDprErrors = viewports.flatMap((viewport, index) => {
    const declared = viewport.deviceScaleFactor ?? viewport.dpr;
    if (declared === undefined) return [];
    const valid = viewport.deviceScaleFactor !== undefined ? isDeviceDprInput(declared) : isWorkflowDpr(declared);
    return valid ? [] : [workflowDprError(`viewports[${index}].${viewport.deviceScaleFactor !== undefined ? "deviceScaleFactor（原始设备值）" : "dpr"}`, declared)];
  });
  if (viewportDprErrors.length) throw new Error(viewportDprErrors.join("；"));
  const outputDir = path.resolve(String(options.output ?? "responsive-artifacts"));
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let context = null; let page = null; let activeDpr = null; let contextId = 0; let navigationCount = 0;
  const measurements = [];
  try {
    for (let index = 0; index < viewports.length; index += 1) {
      const viewport = viewports[index];
      // deviceScaleFactor 模拟原始设备值，页面内仍必须动态封顶；dpr 则是已解析的有效值。
      const rawDpr = viewport.deviceScaleFactor ?? viewport.dpr;
      const contextDpr = rawDpr === undefined ? DEFAULT_DPR : rawDpr;
      const contextChanged = context === null || contextDpr !== activeDpr;
      if (contextChanged) {
        if (context) await context.close();
        contextId += 1; activeDpr = contextDpr; navigationCount = 0;
        context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: contextDpr, isMobile: Boolean(viewport.isMobile), hasTouch: Boolean(viewport.hasTouch) });
        page = await context.newPage();
        page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigationCount += 1; });
        await page.goto(String(options.url), { waitUntil: "networkidle", timeout: Number(options.timeout ?? 30000) });
      }
      const navigationBefore = navigationCount;
      if (!contextChanged) {
        // 同一页面动态调整视口，禁止通过刷新掩盖重排问题。
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
      }
      await waitStableFrame(page);
      const pageReloaded = !contextChanged && navigationCount > navigationBefore;
      const viewportRect = await page.evaluate(() => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }));
      const canvasMetrics = await readCanvasMetrics(page, String(options["canvas-selector"] ?? options.canvasSelector ?? "canvas"));
      const canvasRect = canvasMetrics?.rect ?? null;
      const hookSnapshot = await readPageHook(page, contract.hook.name);
      const screenshotPath = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${safeName(viewport.name)}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const evaluated = evaluateViewport({
        viewportRect,
        canvasRect,
        backingSize: canvasMetrics?.backingSize ?? null,
        hookSnapshot: hookSnapshot?.__hookError ? null : hookSnapshot,
        contract,
        devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
        screenshot: { path: screenshotPath, fullPage: true, width: viewportRect.width, height: viewportRect.height }
      });
      measurements.push({ name: viewport.name, declaredViewport: viewport, contextId, samePageWithPrevious: index > 0 && !contextChanged, pageReloaded, navigationCount, ...evaluated });
    }
  } finally {
    if (context) await context.close();
    await browser.close();
  }
  const summary = summarizeReport(measurements, contract, identity);
  const report = { generatedAt: new Date().toISOString(), url: String(options.url), identity, contract, ...summary };
  await fs.writeFile(path.join(outputDir, "responsive-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

/** 输出最小 CLI 帮助文本。 */
function printHelp() {
  console.log("用法：node responsive-visual-validation.mjs --url URL --viewports MATRIX --canvas-selector canvas --contract CONTRACT --identity IDENTITY --project-root PROJECT [--output DIR] [--hook NAME]");
}

/** CLI 入口；纯计算函数可在无浏览器测试中直接导入。 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help || !options.url || !options.viewports || !options.contract || !options.identity) {
    printHelp();
    return options.help ? 0 : 2;
  }
  const report = await runBrowserValidation(options);
  console.log(JSON.stringify({ status: report.status, responsivePass: report.responsivePass, viewportCount: report.viewportCount, output: options.output }, null, 2));
  return report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
