/**
 * Cocos Creator 3.x 可见画面的响应式视口合同。
 *
 * 该模块只处理工作流事实：CSS 逻辑尺寸、Canvas backing、运行时 DPR、
 * Camera/Input 关系和可复核的运行证据。它不会读取浏览器或修改运行时，
 * 因而可以在控制面和纯工作流测试中确定性复用。
 */
import {
  DEFAULT_DPR,
  IMAGE_PRODUCTION_DPR,
  RUNTIME_MAX_DPR,
  isDeviceDprInput,
  isImageProductionDpr,
  parseDeviceDpr,
} from './workflow-dpr-contract.mjs';
import { DESIGN_RESOLUTIONS, calculateFixedDesignViewport } from '../../cocos-game-ui-layout/scripts/fixed-design-viewport.mjs';
import { resolveOrientationCoverage, measuredOrientation, matchesRepresentativeViewport, validateOrientationPolicyConsistency, hasSamePageOrientationChange } from './orientation-validation-scope.mjs';

/** 响应式模块复用既有 DPR 单一真源，避免调用方引入第二套常量。 */
export { DEFAULT_DPR, IMAGE_PRODUCTION_DPR, RUNTIME_MAX_DPR } from './workflow-dpr-contract.mjs';

/** 响应式合同的版本；版本变化时旧运行证据必须重新测量。 */
export const RESPONSIVE_CONTRACT_VERSION = 'responsive-viewport/1.0';

/** Work Item 与 Implementation Package 需要冻结的 18 个合同字段。 */
export const RESPONSIVE_CONTRACT_FIELDS = Object.freeze([
  'logicalViewportSpace', 'designResolutionPolicy', 'canvasBackingPolicy', 'runtimeDprPolicy', 'maxRuntimeDpr',
  'scaleMode', 'cameraViewportPolicy', 'cameraZoomPolicy', 'cameraOriginPolicy',
  'inputCoordinatePolicy', 'safeAreaPolicy', 'resizePolicy', 'orientationPolicy',
  'textResolutionPolicy', 'assetResolutionPolicy', 'performanceBudget',
  'representativeViewports', 'requiredRuntimeEvidence',
]);

/** V4 每个 Scene 或 DISPLAY_LAYER 至少要提交的真实运行字段。 */
export const RUNTIME_EVIDENCE_FIELDS = Object.freeze([
  'viewportRect', 'canvasRect', 'designTransform', 'logicalSize', 'backingSize', 'cssDisplaySize',
  'rawDevicePixelRatio', 'effectiveDevicePixelRatio', 'logicalToCssScale',
  'cssToPhysicalScale', 'cameraViewport', 'cameraZoom', 'cameraOrigin',
  'safeArea', 'edgeGaps', 'backgroundCoverage', 'keyUiRects', 'inputHitResults',
  'resizeTrajectory', 'pageReloaded', 'screenshot', 'sceneId', 'stateId',
  'layoutContractVersion', 'visualBaselineVersion',
]);

/** 已知代表性视口类别；必测子集由项目支持方向决定。 */
export const REPRESENTATIVE_VIEWPORT_KINDS = Object.freeze([
  'narrow-portrait', 'standard-portrait', 'landscape', 'desktop-wide',
]);

/** 可复用的默认 DPR 与同页行为覆盖要求。 */
export const REPRESENTATIVE_DPR_REQUIREMENTS = Object.freeze([
  'dpr-1', 'dpr-1.25-or-1.5', 'dpr-2', 'dpr-over-2-capped',
]);
export const REPRESENTATIVE_BEHAVIOR_REQUIREMENTS = Object.freeze([
  'same-page-resize', 'dpr-drop-to-1', 'dpr-unchanged-resize',
  'orientation-change', 'display-layer-open-interact-close-restore',
]);

const STAGE_PATTERN = /^V[1-4]$/i;
const DPR_NUMBERS = [1, 1.25, 1.5, 2];

/** 判断是否为普通对象，避免数组被当作结构化合同事实。 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 判断字符串是否有可审计内容。 */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 允许 snake_case 读取，但同一合同仍只有一个语义。 */
function field(value, ...names) {
  for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name];
  return undefined;
}

/** 允许“策略字符串”或“策略事实对象”，拒绝空值和函数名绑定。 */
function hasFact(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return nonEmptyString(value) || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
}

/** 判断正数尺寸；逻辑尺寸允许小数，物理 backing 必须由计算得到整数。 */
function isPositiveSize(value, integer = false) {
  return isObject(value)
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0
    && (!integer || Number.isInteger(value.width) && Number.isInteger(value.height));
}

/** 把错误写成稳定且可定位的工作流消息。 */
function contractError(stage, scope, message, missing = '') {
  const suffix = missing ? ` 缺失=${missing}` : '';
  return `[${stage}] responsive scene=${scope || '*'} ${message}${suffix}`;
}

/** 从根记录或嵌套 responsiveContract 读取单一规范对象。 */
export function extractResponsiveContract(value = {}) {
  const nested = value?.responsiveViewportContract ?? value?.responsiveContract ?? value?.responsive_contract;
  const rootFields = Object.fromEntries(RESPONSIVE_CONTRACT_FIELDS.filter((name) => value?.[name] !== undefined).map((name) => [name, value[name]]));
  if (isObject(nested)) return { ...nested, ...rootFields };
  return rootFields;
}

/** 判断工作项/实施包是否已经声明可见响应式范围。 */
export function hasResponsiveDeclaration(value = {}) {
  return Boolean(
    value?.responsiveViewportContract || value?.responsiveContract || value?.responsive_contract
    || RESPONSIVE_CONTRACT_FIELDS.some((fieldName) => Object.hasOwn(value ?? {}, fieldName))
    || value?.responsiveContractVersion,
  );
}

/** 判断工作项是否进入需要响应式合同的 V1-V4 可见范围。 */
export function isResponsiveWorkItem(work = {}, implementationPackage = null) {
  const stage = String(work?.visualStage ?? work?.visual_stage ?? work?.stageId ?? '').trim().toUpperCase();
  const visibleUnit = (implementationPackage?.executionUnits ?? []).some((unit) => ['SCENE', 'DISPLAY_LAYER'].includes(unit?.unitType));
  const visibleDeclaration = work?.visibleVisualProductionIntegration === true
    || work?.visible_visual_production_integration === true
    || work?.sceneReconstructionContract !== undefined
    || work?.scene_reconstruction_contract !== undefined;
  return STAGE_PATTERN.test(stage) && (stage === 'V1' || hasResponsiveDeclaration(work) || hasResponsiveDeclaration(implementationPackage) || visibleUnit || visibleDeclaration);
}

/** 公开别名，便于阶段门使用语义化名称。 */
export const isVisibleResponsiveWork = isResponsiveWorkItem;

/** 把设备原始 DPR 归一为合同有效 DPR；非法值回退 1，超过 2 封顶。 */
export function normalizeRuntimeDpr(rawDevicePixelRatio, fallback = DEFAULT_DPR) {
  return parseDeviceDpr(rawDevicePixelRatio, fallback);
}
export const effectiveDprFromRaw = normalizeRuntimeDpr;

/** 返回按 CSS 显示尺寸与 CSS→物理比例计算的 backing 尺寸。 */
export function expectedBackingSize(cssDisplaySize, cssToPhysicalScale, rounding = 'ceil') {
  if (!isPositiveSize(cssDisplaySize)) return null;
  const x = typeof cssToPhysicalScale === 'number' ? cssToPhysicalScale : cssToPhysicalScale?.x;
  const y = typeof cssToPhysicalScale === 'number' ? cssToPhysicalScale : cssToPhysicalScale?.y;
  if (![x, y].every((value) => Number.isFinite(value) && value > 0)) return null;
  const round = rounding === 'floor' ? Math.floor : rounding === 'round' ? Math.round : Math.ceil;
  return { width: round(cssDisplaySize.width * x), height: round(cssDisplaySize.height * y) };
}

/** 返回按逻辑尺寸、逻辑→CSS 和 CSS→物理比例计算的 backing 尺寸。 */
export function computeCanvasBackingSize(logicalSize, logicalToCssScale, cssToPhysicalScale) {
  if (!isPositiveSize(logicalSize)) return null;
  const logicalScale = typeof logicalToCssScale === 'number' ? logicalToCssScale : logicalToCssScale?.x;
  const physicalScale = typeof cssToPhysicalScale === 'number' ? cssToPhysicalScale : cssToPhysicalScale?.x;
  if (![logicalScale, physicalScale].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { width: Math.round(logicalSize.width * logicalScale * physicalScale), height: Math.round(logicalSize.height * logicalScale * physicalScale) };
}

/** 判断结构化事实是否覆盖代表性矩阵中的一个关键字。 */
function hasRequirement(values, requirement) {
  const text = JSON.stringify(values ?? []).toLowerCase().replaceAll('_', '-');
  const aliases = {
    'dpr-1.25-or-1.5': ['1.25', '1.5'],
    'dpr-over-2-capped': ['over-2', 'over2', '>2', 'cap', 'capped', '封顶'],
    'same-page-resize': ['same-page-resize', 'same-page', '同页', 'no-reload'],
    'dpr-drop-to-1': ['dpr-drop-to-1', 'dpr-decrease-to-1', '降至1', 'decrease'],
    'dpr-unchanged-resize': ['dpr-unchanged-resize', 'unchanged-dpr', 'dpr不变'],
    'orientation-change': ['orientation-change', 'orientation', '横竖屏', 'rotate'],
    'display-layer-open-interact-close-restore': ['display-layer-open-interact-close-restore', 'open', 'interact', 'close', 'restore', '弹窗'],
  };
  return (aliases[requirement] ?? [requirement]).some((alias) => text.includes(alias));
}

/** 校验代表性 viewport 和 DPR/resize 行为矩阵的合同事实。 */
function validateRepresentativeMatrix(contract, stage, errors) {
  const viewports = contract.representativeViewports;
  const coverage = resolveOrientationCoverage(contract.orientationPolicy);
  if (!Array.isArray(viewports) || viewports.length < coverage.viewportKinds.length || viewports.length === 0) {
    errors.push(contractError(stage, '*', 'representativeViewports 必须覆盖项目支持方向的代表性视口', 'representativeViewports'));
    return;
  }
  const kinds = new Set();
  const matrixSources = [viewports, contract.representativeValidationMatrix, contract.usabilityMatrix, contract.requiredRuntimeEvidence];
  for (const [index, viewport] of viewports.entries()) {
    if (!isObject(viewport)) {
      errors.push(contractError(stage, '*', `representativeViewports[${index}] 必须是结构化对象`));
      continue;
    }
    const id = field(viewport, 'id', 'viewportId', 'viewport_id', 'name');
    const kind = String(field(viewport, 'kind', 'category', 'type', 'id', 'viewportId', 'viewport_id') ?? '').trim().toLowerCase().replaceAll('_', '-');
    if (!nonEmptyString(id)) errors.push(contractError(stage, '*', `representativeViewports[${index}] 缺少稳定 id`, `representativeViewports[${index}].id`));
    const normalizedKind = REPRESENTATIVE_VIEWPORT_KINDS.find((candidate) => kind.includes(candidate)) ?? kind;
    if (REPRESENTATIVE_VIEWPORT_KINDS.includes(normalizedKind)) kinds.add(normalizedKind);
    const size = field(viewport, 'viewportRect', 'viewport_rect', 'logicalSize', 'logical_size', 'size') ?? viewport;
    if (measuredOrientation(size) && !coverage.orientations.includes(measuredOrientation(size))) errors.push(contractError(stage, String(id ?? '*'), '代表性视口方向不在 orientationPolicy.allowed 中'));
    if (coverage.viewportKinds.includes(normalizedKind) && !matchesRepresentativeViewport(normalizedKind, size)) errors.push(contractError(stage, String(id ?? '*'), `代表性 ${normalizedKind} 类别与视口尺寸不一致`));
    if (!hasFact(field(viewport, 'logicalSize', 'logical_size', 'size', 'viewportRect', 'viewport_rect')) && !(Number.isFinite(viewport.width) && Number.isFinite(viewport.height))) errors.push(contractError(stage, String(id ?? '*'), '代表性视口缺少逻辑尺寸'));
    const dprCoverage = field(viewport, 'dprCoverage', 'dpr_coverage', 'dprs', 'requiredDprs', 'required_dprs');
    if (dprCoverage !== undefined && !Array.isArray(dprCoverage)) errors.push(contractError(stage, String(id ?? '*'), '视口 dprCoverage 必须为数组'));
  }
  for (const kind of coverage.viewportKinds) if (!kinds.has(kind)) errors.push(contractError(stage, '*', `representativeViewports 缺少 ${kind} 类别`));
  const matrix = JSON.stringify(matrixSources).toLowerCase();
  const effectiveDprs = viewports.map((viewport) => field(viewport, 'effectiveDpr', 'effective_dpr')).filter((value) => typeof value === 'number');
  const rawDprs = viewports.map((viewport) => field(viewport, 'rawDpr', 'raw_dpr')).filter((value) => typeof value === 'number');
  const dprCoverage = {
    'dpr-1': effectiveDprs.includes(1),
    'dpr-1.25-or-1.5': effectiveDprs.some((value) => value === 1.25 || value === 1.5),
    'dpr-2': effectiveDprs.includes(2),
    'dpr-over-2-capped': rawDprs.some((value, index) => value > 2 && effectiveDprs[index] === 2),
  };
  for (const requirement of REPRESENTATIVE_DPR_REQUIREMENTS) if (!dprCoverage[requirement] && !hasRequirement(matrix, requirement)) errors.push(contractError(stage, '*', `usability 矩阵缺少 ${requirement}`));
  const runtime = contract.requiredRuntimeEvidence;
  const behaviorCoverage = {
    'same-page-resize': runtime?.resizeAssertions?.samePage === true,
    'dpr-drop-to-1': runtime?.resizeAssertions?.dprDecreaseToOne === true,
    'dpr-unchanged-resize': runtime?.resizeAssertions?.sameDprResize === true,
    'orientation-change': JSON.stringify(contract.orientationPolicy ?? '').toLowerCase().includes('orientation'),
    'display-layer-open-interact-close-restore': Array.isArray(runtime?.displayLayerTrajectory?.steps) && ['open', 'interact', 'close'].every((step) => runtime.displayLayerTrajectory.steps.includes(step)) && runtime.displayLayerTrajectory.steps.some((step) => ['restore', 'host-restore'].includes(step)),
  };
  // 锁定方向的项目只验证同方向 resize；仅双方向合同要求实际方向切换。
  for (const requirement of REPRESENTATIVE_BEHAVIOR_REQUIREMENTS) {
    if (requirement === 'orientation-change' && !coverage.requiresOrientationChange) continue;
    if (!behaviorCoverage[requirement] && !hasRequirement(matrix, requirement)) errors.push(contractError(stage, '*', `usability 矩阵缺少 ${requirement}`));
  }
}

/** 校验固定横竖屏设计基准、主轴适配和背景 cover，避免合同把黑边当作适配结果。 */
function validateDesignResolutionPolicy(policy, stage, scope, errors, orientations) {
  const requiredFields = [...orientations, 'canvasFit', 'crossAxis', 'backgroundFit'];
  if (!isObject(policy)) {
    errors.push(contractError(stage, scope, 'designResolutionPolicy 必须声明为对象', 'designResolutionPolicy'));
    return;
  }
  for (const fieldName of requiredFields) {
    if (policy[fieldName] === undefined || policy[fieldName] === null) errors.push(contractError(stage, scope, `designResolutionPolicy 缺少 ${fieldName}`, `designResolutionPolicy.${fieldName}`));
  }
  for (const orientation of orientations) {
    const actual = policy[orientation];
    const expected = DESIGN_RESOLUTIONS[orientation];
    if (!isObject(actual) || actual.width !== expected.width || actual.height !== expected.height || actual.fitAxis !== expected.fitAxis) {
      errors.push(contractError(stage, scope, `designResolutionPolicy.${orientation} 必须为 ${expected.width}×${expected.height} 且按 ${expected.fitAxis} 适配`));
    }
  }
  if (policy.canvasFit !== 'fill-viewport') errors.push(contractError(stage, scope, 'designResolutionPolicy.canvasFit 必须为 fill-viewport，禁止画布黑边'));
  if (policy.crossAxis !== 'extend-or-crop') errors.push(contractError(stage, scope, 'designResolutionPolicy.crossAxis 必须为 extend-or-crop'));
  const background = policy.backgroundFit;
  if (!isObject(background) || background.mode !== 'cover-v1') errors.push(contractError(stage, scope, 'designResolutionPolicy.backgroundFit.mode 必须为 cover-v1，背景需等比覆盖可见视口'));
  for (const fieldName of ['sourceFocalPoint', 'targetPoint']) {
    const point = background?.[fieldName];
    if (!isObject(point) || ![point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      errors.push(contractError(stage, scope, `designResolutionPolicy.backgroundFit.${fieldName} 必须包含 [0,1] 内的 x/y`));
    }
  }
}

/** 根级与嵌套合同记录同一设计事实，防止工作项和执行单元各取一套背景焦点。 */
function sameDesignResolutionPolicy(left, right) {
  const facts = (policy) => [
    policy?.portrait?.width, policy?.portrait?.height, policy?.portrait?.fitAxis,
    policy?.landscape?.width, policy?.landscape?.height, policy?.landscape?.fitAxis,
    policy?.canvasFit, policy?.crossAxis, policy?.backgroundFit?.mode,
    policy?.backgroundFit?.sourceFocalPoint?.x, policy?.backgroundFit?.sourceFocalPoint?.y,
    policy?.backgroundFit?.targetPoint?.x, policy?.backgroundFit?.targetPoint?.y,
  ];
  const leftFacts = facts(left);
  const rightFacts = facts(right);
  return leftFacts.every((value, index) => value === rightFacts[index]);
}

/** 校验 18 个响应式合同字段；返回错误数组而不是直接写入任何工件。 */
export function validateResponsiveContract(value, options = {}) {
  const stage = String(options.stage ?? 'V1').toUpperCase();
  const scope = options.scope ?? value?.sceneId ?? value?.scene_id ?? '*';
  const contract = extractResponsiveContract(value);
  const errors = [];
  if (!isObject(contract) || Object.keys(contract).length === 0) return [contractError(stage, scope, '缺少响应式视口合同', 'responsiveViewportContract')];
  const coverage = resolveOrientationCoverage(contract.orientationPolicy);
  for (const error of coverage.errors) errors.push(contractError(stage, scope, error));
  const nestedContract = value?.responsiveViewportContract ?? value?.responsiveContract ?? value?.responsive_contract;
  if (nestedContract !== undefined && nestedContract !== null) {
    if (!isObject(nestedContract)) errors.push(contractError(stage, scope, '嵌套 responsiveViewportContract 必须为对象'));
    for (const error of validateOrientationPolicyConsistency(value?.orientationPolicy, nestedContract?.orientationPolicy)) errors.push(contractError(stage, scope, error));
    if (value?.designResolutionPolicy === undefined || value?.designResolutionPolicy === null) errors.push(contractError(stage, scope, '根字段必须声明 designResolutionPolicy', 'designResolutionPolicy'));
    if (nestedContract?.designResolutionPolicy === undefined || nestedContract?.designResolutionPolicy === null) errors.push(contractError(stage, scope, '嵌套 responsiveViewportContract 必须声明 designResolutionPolicy', 'responsiveViewportContract.designResolutionPolicy'));
    if (isObject(value?.designResolutionPolicy) && isObject(nestedContract?.designResolutionPolicy) && !sameDesignResolutionPolicy(value.designResolutionPolicy, nestedContract.designResolutionPolicy)) errors.push(contractError(stage, scope, '根级与嵌套 designResolutionPolicy 必须一致'));
  }
  for (const fieldName of RESPONSIVE_CONTRACT_FIELDS) if (contract[fieldName] === undefined || contract[fieldName] === null) errors.push(contractError(stage, scope, `响应式合同缺少 ${fieldName}`, fieldName));
  validateDesignResolutionPolicy(contract.designResolutionPolicy, stage, scope, errors, coverage.orientations);
  if (contract.maxRuntimeDpr !== RUNTIME_MAX_DPR) errors.push(contractError(stage, scope, `maxRuntimeDpr 必须固定为 ${RUNTIME_MAX_DPR}`, 'maxRuntimeDpr=2'));
  const dprPolicy = contract.runtimeDprPolicy;
  if (!isObject(dprPolicy)) errors.push(contractError(stage, scope, 'runtimeDprPolicy 必须声明设备动态读取和非法回退事实', 'runtimeDprPolicy'));
  else {
    const source = String(field(dprPolicy, 'source', 'readFrom', 'read_from') ?? '').toLowerCase();
    if (!source.includes('device') && !source.includes('dpr')) errors.push(contractError(stage, scope, 'runtimeDprPolicy.source 必须来自设备 DPR', 'runtimeDprPolicy.source'));
    if (field(dprPolicy, 'dynamic', 'isDynamic', 'is_dynamic', 'notStartupOnly') !== true) errors.push(contractError(stage, scope, 'runtimeDprPolicy 必须声明动态读取且不得只在启动时读取'));
    if (field(dprPolicy, 'invalidFallback', 'invalid_fallback', 'fallback') !== DEFAULT_DPR) errors.push(contractError(stage, scope, '非法 DPR 必须回退为 1', 'runtimeDprPolicy.invalidFallback=1'));
    if (field(dprPolicy, 'cap', 'max', 'maximum', 'maxInclusive') !== RUNTIME_MAX_DPR) errors.push(contractError(stage, scope, `runtimeDprPolicy 上限必须为 ${RUNTIME_MAX_DPR}`, 'runtimeDprPolicy.cap=2'));
    const changes = field(dprPolicy, 'updatesOn', 'updates_on', 'dynamicTriggers', 'dynamic_triggers', 'refreshOn');
    const changeText = JSON.stringify(changes ?? []).toLowerCase();
    if (!changeText.includes('resize') || (coverage.requiresOrientationChange && !changeText.includes('orientation')) || !(changeText.includes('density') || changeText.includes('dpr'))) errors.push(contractError(stage, scope, 'DPR 动态策略必须覆盖 resize/显示密度变化，双方向项目还需方向切换'));
  }
  if (!hasFact(contract.logicalViewportSpace) || (isObject(contract.logicalViewportSpace) && !String(field(contract.logicalViewportSpace, 'unit', 'coordinateSpace', 'coordinate_space') ?? '').toLowerCase().includes('css'))) errors.push(contractError(stage, scope, 'logicalViewportSpace 必须明确 CSS 逻辑像素坐标空间', 'logicalViewportSpace'));
  if (!hasFact(contract.canvasBackingPolicy)) errors.push(contractError(stage, scope, 'canvasBackingPolicy 必须明确 CSS→物理 backing 关系', 'canvasBackingPolicy'));
  if (!hasFact(contract.scaleMode)) errors.push(contractError(stage, scope, '必须明确选择 ScaleMode', 'scaleMode'));
  const scaleMode = isObject(contract.scaleMode) ? field(contract.scaleMode, 'mode', 'scaleMode', 'strategy', 'value') : contract.scaleMode;
  const normalizedScaleMode = typeof scaleMode === 'string' ? scaleMode.trim().toUpperCase() : '';
  if (!['FIXED_WIDTH', 'FIXED_HEIGHT', 'CUSTOM'].includes(normalizedScaleMode)) errors.push(contractError(stage, scope, 'scaleMode 必须为 FIXED_WIDTH、FIXED_HEIGHT 或 custom；FIT 会产生黑边，其他模式也必须证明等效填满视口', 'scaleMode=FIXED_WIDTH|FIXED_HEIGHT|custom'));
  for (const fieldName of ['cameraViewportPolicy', 'cameraZoomPolicy', 'cameraOriginPolicy', 'inputCoordinatePolicy', 'safeAreaPolicy', 'resizePolicy', 'orientationPolicy', 'textResolutionPolicy']) if (!hasFact(contract[fieldName])) errors.push(contractError(stage, scope, `必须明确 ${fieldName}`, fieldName));
  const assets = contract.assetResolutionPolicy;
  const productionDpr = isObject(assets) ? field(assets, 'productionDpr', 'production_dpr', 'assetProductionDpr', 'asset_production_dpr', 'maxDpr', 'max_dpr') : null;
  if (!isImageProductionDpr(productionDpr)) errors.push(contractError(stage, scope, `资源生产 DPR 必须独立固定为 ${IMAGE_PRODUCTION_DPR}，不得代替运行时 DPR`, `assetResolutionPolicy.productionDpr=${IMAGE_PRODUCTION_DPR}`));
  const budget = contract.performanceBudget;
  if (!isObject(budget)) errors.push(contractError(stage, scope, 'performanceBudget 必须记录 backing、像素、RenderTexture、滤镜、透明层和设备结果', 'performanceBudget'));
  else {
    const normalizedBudget = {
      maxCanvasBackingWidth: budget.maxCanvasBackingWidth ?? budget.maxCanvasBacking?.width,
      maxCanvasBackingHeight: budget.maxCanvasBackingHeight ?? budget.maxCanvasBacking?.height,
      maxPixelCount: budget.maxPixelCount ?? budget.maxCanvasPixels,
      renderTexturePixelBudget: budget.renderTexturePixelBudget ?? budget.renderTexturePixels,
      fullScreenFilterBudget: budget.fullScreenFilterBudget ?? budget.fullscreenFilterPasses,
      transparentFullScreenLayerCount: budget.transparentFullScreenLayerCount ?? budget.transparentFullscreenLayers,
      representativeDeviceResults: budget.representativeDeviceResults ?? budget.measuredResults,
      degradationPolicy: budget.degradationPolicy,
    };
    const required = Object.keys(normalizedBudget);
    for (const fieldName of required) if (normalizedBudget[fieldName] === undefined) errors.push(contractError(stage, scope, `performanceBudget 缺少 ${fieldName}`, `performanceBudget.${fieldName}`));
    for (const fieldName of required.slice(0, 6)) {
      const numeric = normalizedBudget[fieldName];
      if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0) errors.push(contractError(stage, scope, `performanceBudget.${fieldName} 必须为非负有限数字`));
    }
    const degradation = JSON.stringify(budget.degradationPolicy ?? '').toLowerCase();
    if (!/forbid|never|explicit|禁止|不得/.test(degradation)) errors.push(contractError(stage, scope, '超出性能预算必须显式记录降级，不得静默降低 DPR/资源/文字清晰度'));
  }
  validateRepresentativeMatrix(contract, stage, errors);
  const requiredEvidence = contract.requiredRuntimeEvidence;
  const requiredEvidenceFields = Array.isArray(requiredEvidence) ? requiredEvidence : requiredEvidence?.requiredFields;
  if (!Array.isArray(requiredEvidenceFields) || !RUNTIME_EVIDENCE_FIELDS.every((fieldName) => requiredEvidenceFields.includes(fieldName) || requiredEvidenceFields.includes(fieldName.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)))) errors.push(contractError(stage, scope, 'requiredRuntimeEvidence 未覆盖完整 V4 运行字段', 'requiredRuntimeEvidence'));
  return [...new Set(errors)];
}

/** 从结构化证据读取尺寸并检查正数/整数关系。 */
function validateEvidenceGeometry(record, contract, effectiveDpr, stage, scope, errors) {
  const logicalSize = field(record, 'logicalSize', 'logical_size');
  const cssDisplaySize = field(record, 'cssDisplaySize', 'css_display_size');
  const backingSize = field(record, 'backingSize', 'backing_size');
  const logicalScale = field(record, 'logicalToCssScale', 'logical_to_css_scale');
  const physicalScale = field(record, 'cssToPhysicalScale', 'css_to_physical_scale');
  if (!isPositiveSize(logicalSize)) errors.push(contractError(stage, scope, 'logicalSize 必须为正数尺寸', 'logicalSize'));
  if (!isPositiveSize(cssDisplaySize)) errors.push(contractError(stage, scope, 'cssDisplaySize 必须为正数尺寸', 'cssDisplaySize'));
  if (!isPositiveSize(backingSize, true)) errors.push(contractError(stage, scope, 'backingSize 必须为正整数尺寸', 'backingSize'));
  const logicalX = typeof logicalScale === 'number' ? logicalScale : logicalScale?.x;
  const logicalY = typeof logicalScale === 'number' ? logicalScale : logicalScale?.y;
  const physicalX = typeof physicalScale === 'number' ? physicalScale : physicalScale?.x;
  const physicalY = typeof physicalScale === 'number' ? physicalScale : physicalScale?.y;
  if (![logicalX, logicalY].every((value) => Number.isFinite(value) && value > 0)) errors.push(contractError(stage, scope, 'logicalToCssScale 必须为正有限数字或 x/y 比例', 'logicalToCssScale'));
  if (![physicalX, physicalY].every((value) => Number.isFinite(value) && value > 0)) errors.push(contractError(stage, scope, 'cssToPhysicalScale 必须为正有限数字或 x/y 比例', 'cssToPhysicalScale'));
  if (isPositiveSize(logicalSize) && isPositiveSize(cssDisplaySize) && Number.isFinite(logicalX) && Number.isFinite(logicalY)) {
    const expectedCss = { width: logicalSize.width * logicalX, height: logicalSize.height * logicalY };
    if (Math.abs(expectedCss.width - cssDisplaySize.width) > 0.01 || Math.abs(expectedCss.height - cssDisplaySize.height) > 0.01) errors.push(contractError(stage, scope, 'CSS 显示尺寸未按逻辑尺寸与 logicalToCssScale 计算'));
  }
  if (isPositiveSize(cssDisplaySize) && isPositiveSize(backingSize, true) && Number.isFinite(physicalX) && Number.isFinite(physicalY)) {
    const rounding = field(contract?.canvasBackingPolicy, 'rounding') ?? 'ceil';
    const expected = expectedBackingSize(cssDisplaySize, effectiveDpr, rounding);
    if (expected.width !== backingSize.width || expected.height !== backingSize.height) errors.push(contractError(stage, scope, 'Canvas backing 未按 CSS 显示尺寸与 cssToPhysicalScale 计算'));
    if (Math.abs(physicalX - backingSize.width / cssDisplaySize.width) > 1e-6 || Math.abs(physicalY - backingSize.height / cssDisplaySize.height) > 1e-6) errors.push(contractError(stage, scope, 'cssToPhysicalScale 未记录真实 backing/CSS 比例'));
  }
}

/** 对比运行时主轴缩放和可见区域，防止合同正确但实际仍按旧视口布局。 */
function validateDesignTransform(record, stage, scope, errors) {
  const viewport = field(record, 'viewportRect', 'viewport_rect');
  if (!isPositiveSize(viewport)) return;
  const actual = field(record, 'designTransform', 'design_transform');
  if (!isObject(actual)) {
    errors.push(contractError(stage, scope, 'designTransform 必须记录运行时设计坐标变换'));
    return;
  }
  const expected = calculateFixedDesignViewport({ width: viewport.width, height: viewport.height });
  for (const key of ['orientation', 'designWidth', 'designHeight', 'fitAxis']) {
    if (actual[key] !== expected[key]) errors.push(contractError(stage, scope, `designTransform.${key} 与固定设计基准不一致`));
  }
  for (const key of ['scale', 'visibleWidth', 'visibleHeight', 'offsetX', 'offsetY']) {
    if (!Number.isFinite(actual[key]) || Math.abs(actual[key] - expected[key]) > 1e-6 * Math.max(1, Math.abs(expected[key]))) {
      errors.push(contractError(stage, scope, `designTransform.${key} 未按当前视口主轴计算`));
    }
  }
  const canvas = field(record, 'canvasRect', 'canvas_rect');
  if (isPositiveSize(canvas) && ['x', 'y', 'width', 'height'].some((key) => Math.abs((canvas[key] ?? 0) - (viewport[key] ?? 0)) > 0.01)) {
    errors.push(contractError(stage, scope, 'Canvas 必须填满真实 CSS 视口，禁止黑边'));
  }
  const display = field(record, 'cssDisplaySize', 'css_display_size');
  if (isPositiveSize(display) && (Math.abs(display.width - viewport.width) > 0.01 || Math.abs(display.height - viewport.height) > 0.01)) {
    errors.push(contractError(stage, scope, 'CSS 显示尺寸必须填满真实视口，禁止黑边'));
  }
}

/** 校验单个 Scene/DISPLAY_LAYER 的真实运行记录。 */
export function validateResponsiveEvidenceRecord(record, contract = null, options = {}) {
  const stage = String(options.stage ?? 'V4').toUpperCase();
  const scope = options.scope ?? record?.displayLayerId ?? record?.sceneId ?? record?.scene_id ?? '*';
  const errors = [];
  if (!isObject(record)) return [contractError(stage, scope, '响应式运行证据必须是对象')];
  const status = String(field(record, 'verificationStatus', 'verification_status', 'status', 'verdict') ?? '').trim().toLowerCase();
  if (!['verified', 'pass'].includes(status) || field(record, 'runtimeMeasured', 'runtime_measured', 'measured') === false) errors.push(contractError(stage, scope, '只有 verified/PASS 的真实运行测量才能驱动通过'));
  const measuredAt = field(record, 'measuredAt', 'measured_at', 'recordedAt', 'recorded_at');
  const measurementSource = String(field(record, 'measurementSource', 'measurement_source', 'source') ?? '').toLowerCase();
  if (field(record, 'runtimeMeasured', 'runtime_measured', 'measured') !== true && !measurementSource.includes('runtime') && !measurementSource.includes('browser')) errors.push(contractError(stage, scope, 'V4 响应式证据必须有真实运行测量标记', 'runtimeMeasured=true'));
  if (!nonEmptyString(measuredAt) || Number.isNaN(Date.parse(measuredAt))) errors.push(contractError(stage, scope, '运行证据缺少有效测量时间', 'measuredAt'));
  for (const fieldName of RUNTIME_EVIDENCE_FIELDS) if (field(record, fieldName, fieldName.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)) === undefined) errors.push(contractError(stage, scope, `运行证据缺少 ${fieldName}`, fieldName));
  const raw = field(record, 'rawDevicePixelRatio', 'raw_device_pixel_ratio');
  const effective = field(record, 'effectiveDevicePixelRatio', 'effective_device_pixel_ratio');
  if (!isDeviceDprInput(raw)) errors.push(contractError(stage, scope, 'rawDevicePixelRatio 必须是正有限数字，字符串/零/负数拒绝', 'rawDevicePixelRatio'));
  if (typeof effective !== 'number' || !Number.isFinite(effective) || effective <= 0 || effective > RUNTIME_MAX_DPR) errors.push(contractError(stage, scope, `effectiveDevicePixelRatio 必须位于 (0,${RUNTIME_MAX_DPR}]`, 'effectiveDevicePixelRatio'));
  if (isDeviceDprInput(raw) && typeof effective === 'number' && effective !== normalizeRuntimeDpr(raw)) errors.push(contractError(stage, scope, 'effectiveDevicePixelRatio 未由 rawDevicePixelRatio 动态归一并封顶'));
  validateEvidenceGeometry(record, contract, effective, stage, scope, errors);
  validateDesignTransform(record, stage, scope, errors);
  const gameSize = field(record, 'gameSize', 'game_size');
  if (!isPositiveSize(gameSize)) errors.push(contractError(stage, scope, 'gameSize 必须明确逻辑坐标空间中的正数尺寸', 'gameSize'));
  for (const [name, value] of [['viewportRect', field(record, 'viewportRect', 'viewport_rect')], ['canvasRect', field(record, 'canvasRect', 'canvas_rect')], ['cameraViewport', field(record, 'cameraViewport', 'camera_viewport')]]) if (!isPositiveSize(value)) errors.push(contractError(stage, scope, `${name} 必须是正数矩形`, name));
  const zoom = field(record, 'cameraZoom', 'camera_zoom');
  if (!(typeof zoom === 'number' ? Number.isFinite(zoom) && zoom > 0 : isObject(zoom) && Number.isFinite(zoom.x) && zoom.x > 0 && Number.isFinite(zoom.y) && zoom.y > 0)) errors.push(contractError(stage, scope, 'cameraZoom 必须为正数'));
  const origin = field(record, 'cameraOrigin', 'camera_origin');
  if (!isObject(origin) || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) errors.push(contractError(stage, scope, 'cameraOrigin 必须记录 x/y 原点', 'cameraOrigin'));
  for (const name of ['safeArea', 'edgeGaps', 'backgroundCoverage', 'keyUiRects', 'inputHitResults']) if (!hasFact(field(record, name, name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)))) errors.push(contractError(stage, scope, `${name} 必须提供真实运行事实`, name));
  const coverage = field(record, 'backgroundCoverage', 'background_coverage');
  if (!(coverage === true || typeof coverage === 'number' && coverage >= 1 || isObject(coverage) && (coverage.covered === true || coverage.matches === true))) errors.push(contractError(stage, scope, 'backgroundCoverage 必须明确证明完整覆盖'));
  const hits = field(record, 'inputHitResults', 'input_hit_results');
  if (!Array.isArray(hits) || hits.length === 0 || hits.some((item) => item?.hit !== true && item?.passed !== true)) errors.push(contractError(stage, scope, 'inputHitResults 必须全部明确通过'));
  const trajectory = field(record, 'resizeTrajectory', 'resize_trajectory');
  if (!Array.isArray(trajectory) || trajectory.length === 0) errors.push(contractError(stage, scope, 'resizeTrajectory 必须记录支持方向内的同页 resize/DPR 变化轨迹', 'resizeTrajectory'));
  if (field(record, 'pageReloaded', 'page_reloaded') !== false) errors.push(contractError(stage, scope, 'resize 必须在同一页面完成，pageReloaded 必须为 false'));
  if (!hasFact(field(record, 'screenshot'))) errors.push(contractError(stage, scope, 'V4 必须提交真实运行截图', 'screenshot'));
  for (const name of ['sceneId', 'stateId', 'layoutContractVersion', 'visualBaselineVersion']) if (!nonEmptyString(field(record, name, name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)))) errors.push(contractError(stage, scope, `运行证据缺少 ${name}`, name));
  const expectedLayoutVersion = options.layoutContractVersion ?? field(contract, 'layoutContractVersion', 'layout_contract_version');
  const expectedVisualVersion = options.visualBaselineVersion ?? field(contract, 'visualBaselineVersion', 'visual_baseline_version');
  if (expectedLayoutVersion && field(record, 'layoutContractVersion', 'layout_contract_version') !== expectedLayoutVersion) errors.push(contractError(stage, scope, '旧 layoutContractVersion 证据已失效'));
  if (expectedVisualVersion && field(record, 'visualBaselineVersion', 'visual_baseline_version') !== expectedVisualVersion) errors.push(contractError(stage, scope, '旧 visualBaselineVersion 证据已失效'));
  const unitType = String(options.unitType ?? record.unitType ?? '').toUpperCase();
  if (unitType === 'DISPLAY_LAYER' || field(record, 'displayLayerId', 'display_layer_id') !== undefined) {
    if (!nonEmptyString(field(record, 'displayLayerId', 'display_layer_id'))) errors.push(contractError(stage, scope, '独立 DISPLAY_LAYER 必须记录 displayLayerId', 'displayLayerId'));
    if (!nonEmptyString(field(record, 'hostSceneId', 'host_scene_id'))) errors.push(contractError(stage, scope, '独立 DISPLAY_LAYER 必须绑定 hostSceneId', 'hostSceneId'));
    if (!hasFact(field(record, 'hostSceneState', 'host_scene_state', 'hostEvidence', 'host_evidence'))) errors.push(contractError(stage, scope, 'DISPLAY_LAYER 必须记录宿主同屏状态证据', 'hostSceneState'));
    const replayText = JSON.stringify(trajectory ?? []).toLowerCase();
    for (const phase of ['open', 'interact', 'close', 'restore']) if (!replayText.includes(phase)) errors.push(contractError(stage, scope, `DISPLAY_LAYER 运行轨迹缺少 ${phase} 阶段`));
  }
  const expectedDpr = normalizeRuntimeDpr(raw);
  if (typeof effective === 'number' && effective !== expectedDpr) errors.push(contractError(stage, scope, `rawDevicePixelRatio=${raw} 的有效值必须为 ${expectedDpr}`));
  return [...new Set(errors)];
}

/** 只按实测几何、DPR 和同页轨迹校验一个可见单元的完整代表矩阵。 */
function validateMeasuredMatrix(records, stage, scope, contract) {
  const coverage = resolveOrientationCoverage(extractResponsiveContract(contract).orientationPolicy);
  const errors = coverage.errors.map((error) => contractError(stage, scope, error));
  // V4 只接受实测几何和数值覆盖；viewportId、matrixCases 等自报标签不能替代事实。
  const viewport = (record) => field(record, 'viewportRect', 'viewport_rect') ?? {};
  const effective = (record) => field(record, 'effectiveDevicePixelRatio', 'effective_device_pixel_ratio');
  const raw = (record) => field(record, 'rawDevicePixelRatio', 'raw_device_pixel_ratio');
  for (const record of records) if (!coverage.orientations.includes(measuredOrientation(viewport(record)))) errors.push(contractError(stage, scope, 'V4 证据视口方向不在 orientationPolicy.allowed 中'));
  for (const kind of coverage.viewportKinds) if (!records.some((record) => matchesRepresentativeViewport(kind, viewport(record)))) errors.push(contractError(stage, scope, `V4 证据未覆盖代表性 ${kind} 视口`));
  const dprCoverage = {
    'dpr-1': records.some((record) => effective(record) === 1),
    'dpr-1.25-or-1.5': records.some((record) => [1.25, 1.5].includes(effective(record))),
    'dpr-2': records.some((record) => effective(record) === 2),
    'dpr-over-2-capped': records.some((record) => raw(record) > 2 && effective(record) === 2),
  };
  for (const requirement of REPRESENTATIVE_DPR_REQUIREMENTS) if (!dprCoverage[requirement]) errors.push(contractError(stage, scope, `V4 证据未覆盖 ${requirement}`));
  const transitions = records.slice(1).map((record, index) => {
    const previous = records[index];
    const samePage = record.samePageWithPrevious === true && record.pageReloaded === false
      && record.contextId !== undefined && record.contextId === previous.contextId;
    const before = viewport(previous); const after = viewport(record);
    return { samePage, viewportChanged: before.width !== after.width || before.height !== after.height, before, after, previousDpr: effective(previous), currentDpr: effective(record) };
  });
  if (!transitions.some((item) => item.samePage && item.viewportChanged)) errors.push(contractError(stage, scope, 'V4 证据未覆盖 same-page-resize'));
  if (!transitions.some((item) => item.samePage && item.previousDpr > 1 && item.currentDpr === 1)) errors.push(contractError(stage, scope, 'V4 证据未覆盖 dpr-drop-to-1'));
  if (!transitions.some((item) => item.samePage && item.viewportChanged && item.previousDpr === item.currentDpr)) errors.push(contractError(stage, scope, 'V4 证据未覆盖 dpr-unchanged-resize'));
  if (coverage.requiresOrientationChange && !hasSamePageOrientationChange(records, viewport)) errors.push(contractError(stage, scope, 'V4 证据未覆盖 orientation-change'));
  return errors;
}

/** 校验 V4 证据清单，要求每个可见单元独立记录且绑定当前候选。 */
export function validateResponsiveEvidenceManifest(value, contract = null, options = {}) {
  const stage = String(options.stage ?? value?.currentStage ?? value?.current_stage ?? 'V4').toUpperCase();
  const source = Array.isArray(value) ? value : value?.responsiveEvidence ?? value?.responsiveRuntimeEvidence ?? value?.responsive_runtime_evidence ?? value?.runtimeEvidence;
  const errors = [];
  const nestedContract = contract?.responsiveViewportContract ?? contract?.responsiveContract ?? contract?.responsive_contract;
  if (nestedContract !== undefined && nestedContract !== null) {
    for (const error of validateOrientationPolicyConsistency(contract?.orientationPolicy, nestedContract?.orientationPolicy)) errors.push(contractError(stage, '*', error));
  }
  if (!Array.isArray(source) || source.length === 0) return [contractError(stage, '*', 'V4 缺少真实响应式运行证据数组', 'responsiveEvidence')];
  const records = source;
  for (const [index, record] of records.entries()) errors.push(...validateResponsiveEvidenceRecord(record, contract, { ...options, stage, scope: record?.displayLayerId ?? record?.sceneId ?? `record-${index}` }));
  const requiredUnits = options.requiredUnits ?? [];
  if (requiredUnits.length === 0) errors.push(...validateMeasuredMatrix(records, stage, '*', contract));
  for (const unit of requiredUnits) {
    const unitRecords = records.filter((record) => unit.unitType === 'SCENE'
      ? record?.sceneId === unit.sceneId && record?.displayLayerId === undefined
      : record?.displayLayerId === unit.displayLayerId && record?.hostSceneId === unit.hostSceneId);
    const unitScope = unit.displayLayerId ?? unit.sceneId ?? '*';
    if (unitRecords.length === 0) errors.push(contractError(stage, unitScope, '可见 execution unit 缺少独立响应式运行轨迹'));
    else errors.push(...validateMeasuredMatrix(unitRecords, stage, unitScope, contract));
  }
  return [...new Set(errors)];
}

/** 简洁断言入口，供阶段门将错误转成单一异常。 */
export function assertResponsiveContract(value, options = {}) {
  const errors = validateResponsiveContract(value, options);
  if (errors.length) throw new Error(errors[0]);
  return value;
}

/** 响应式合同校验器的稳定集合，便于 runtime validator 注入和纯测试复用。 */
export const responsiveViewportContract = Object.freeze({
  version: RESPONSIVE_CONTRACT_VERSION,
  fields: RESPONSIVE_CONTRACT_FIELDS,
  evidenceFields: RUNTIME_EVIDENCE_FIELDS,
  validate: validateResponsiveContract,
  validateEvidence: validateResponsiveEvidenceManifest,
});
