#!/usr/bin/env node

/**
 * effect-image 场景视觉路线分析合同。
 *
 * 该模块只约束“参考图中的视觉事实应该由什么来源实现”，不替代现有
 * visual-production-contract 的文件、生成记录和运行时消费审计。这样可以
 * 在 V1 就阻断把特色美术误降级为 Graphics，也能让布局/行为代码保持独立。
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateReuseProductionGate } from "./visual-confirmation-reuse-gates.mjs";
import { validateFixedVisualProductionMethod } from "./visual-decomposition-confirmation.mjs";
import { validateNativeRenderContract, validateNativeRuntimeEvidence } from "./native-render-contract.mjs";

/** 图片资产与 Cocos 原生是唯一可交付的场景来源分类。 */
export const SCENE_VISUAL_ROUTES = Object.freeze({
  IMAGE_ASSET: "image-asset",
  COCOS_NATIVE: "cocos-native",
});

// composite 仅保留为诊断输入；混合区域必须退回 V1 重新拆分，不能进入生产或验收。
const COMPOSITE_ROUTE = "composite";

/** scene coverage 的实现 owner；与既有生产合同的 owner_type 保持同一词汇。 */
export const SCENE_VISUAL_OWNERS = Object.freeze({
  FIXED: "fixed-production-visual",
  RUNTIME_DATA: "runtime-data",
  RUNTIME_RENDERED: "runtime-rendered",
  RUNTIME_PROGRAM: "runtime-program",
});

const FIXED_OWNERS = new Set([SCENE_VISUAL_OWNERS.FIXED]);
const NATIVE_OWNERS = new Set([
  SCENE_VISUAL_OWNERS.RUNTIME_DATA,
  SCENE_VISUAL_OWNERS.RUNTIME_RENDERED,
  SCENE_VISUAL_OWNERS.RUNTIME_PROGRAM,
]);
const FIXED_METHODS = new Set(["image-generation", "authored-raster", "reuse"]);
const NATIVE_METHODS = new Set(["cocos-graphics", "runtime-program"]);
const FIXED_DELIVERIES = new Set(["raster-image", "existing-asset"]);
const NATIVE_DELIVERIES = new Set(["runtime-drawing", "runtime-program"]);
const PLAN_MODES = new Set(["generate-now", "reuse-existing", "runtime-program"]);
const NATIVE_PRIMITIVES = new Set([
  "pure-color",
  "basic-geometry",
  "regular-line",
  "regular-gradient",
  "mask",
  "progress-fill",
  "layout-structure",
  "dynamic-data",
  "program-effect",
  "text",
  "not-applicable",
]);
/** 元素语义只用于分类；原生资格由视觉事实和实际渲染能力决定。 */
const ASSET_CANDIDATE_ELEMENT_TYPES = new Set([
  "button",
  "button-skin",
  "panel",
  "panel-frame",
  "background-frame",
  "icon",
  "decorative-frame",
  "decoration",
  "illustration",
  "character",
  "prop",
  "object",
  "environment",
  "background",
  "portrait",
  "avatar",
  "logo",
  "artwork",
  "game-piece",
  "item",
  "sprite",
  "nine-slice",
]);
/** Schema 与运行时校验共享的 coverage 元素分类全集。 */
const ELEMENT_TYPES = new Set([
  ...ASSET_CANDIDATE_ELEMENT_TYPES,
  "simple-geometry",
  "dynamic-data",
  "progress-fill",
  "mask",
  "layout",
  "interaction",
  "program-effect",
  "particle",
  "shader",
  "text",
  "text-node",
  "label",
  "caption",
  "other",
]);
const TEXT_ELEMENT_TYPES = new Set(["text", "text-node", "label", "caption"]);
const NATIVE_ELEMENT_TYPES = new Set([
  "simple-geometry",
  "dynamic-data",
  "progress-fill",
  "mask",
  "layout",
  "interaction",
  "program-effect",
  "particle",
  "shader",
]);
const DISTINCTIVE_FEATURE_PATTERN = /特色|复杂|distinctive|complex|材质|纹理|texture|material|不规则|非规则|irregular|定制描边|custom\s*(?:outline|stroke)|阴影|shadow|高光|highlight|装饰纹样|品牌|brand|像素美术|pixel\s*(?:art)?|绘制细节|paint(?:ed)?\s*detail|插画|illustration/i;
const SEMANTIC_REUSE_PATTERN = /semantic|语义|相似|similar|same[-_ ]?kind|looks[-_ ]?similar|看起来一样|同类|同义/i;

/** 统一拒绝已废止的单区域混合输入，避免 composite 路线和遗留字段分别报重复错误。 */
function compositeRouteError(stage, contract, region, actual) {
  return routeError(stage, contract, region, "程序逻辑与独立视觉资产必须重新拆解；禁止单一区域闭环（禁止单一 composite region 继续生产或验收）", {
    expected: "selected_route=image-asset|cocos-native 且不得携带 composite_parts",
    actual,
    returnStage: "V1/PROPOSAL",
    rootCause: "方案缺失",
  });
}

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断结构化证据是否非空；数组和对象必须真的包含内容。 */
function hasEvidence(value) {
  return nonEmptyString(value)
    || (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0);
}

/** 把 region/target 的身份拼入错误，便于 V1 直接定位方案缺口。 */
function routeError(stage, contract, region, message, details = {}) {
  const target = contract?.target_conditions ?? contract?.target ?? {};
  const scene = region?.scene_id ?? region?.sceneId ?? target.scene_id ?? target.sceneId ?? "?";
  const state = region?.state_id ?? region?.stateId ?? target.state_id ?? target.stateId ?? "?";
  const annotation = region?.annotation_number ?? region?.annotationNumber ?? "?";
  const regionId = region?.region_id ?? region?.regionId ?? region?.id ?? "?";
  const route = details.route ?? details.actualRoute ?? region?.visual_route_analysis?.selected_route ?? "missing";
  const expected = details.expected ?? details.expectedRoute ?? "visual-route-analysis";
  const actual = details.actual ?? details.actualRoute ?? route;
  const missing = details.missing ? ` 缺失视觉事实=${details.missing}` : "";
  const returnStage = details.returnStage ?? "V1/PROPOSAL";
  const rootCause = details.rootCause ?? "方案缺失";
  return `[${stage}] scene/state=${scene}/${state} annotation_number=${annotation} region_id=${regionId} route=${route} expected=${expected} actual=${actual} 根因=${rootCause} ${message}${missing} 应退回阶段=${returnStage}`;
}

/** 判断 coverage 区域是否把某个字段显式声明出来；不把缺失误读成空值。 */
function hasField(value, name) {
  return isObject(value) && Object.hasOwn(value, name);
}

/** 读取实现计划 mode；路线合同只接受 canonical implementation_plan.mode。 */
function planMode(region) {
  return isObject(region?.implementation_plan) ? region.implementation_plan.mode : undefined;
}

/** 将观察到的字段展平为字符串，识别会改变路线的材质/装饰事实。 */
function searchableFeatures(features) {
  return (Array.isArray(features) ? features : [features]).map((item) => {
    if (typeof item === "string") return item;
    try { return JSON.stringify(item); } catch { return String(item ?? ""); }
  }).join(" ");
}

/** 判断元素是否具备不能默认交给原生绘制的游戏美术特征。 */
function isDistinctiveVisual(analysis) {
  return analysis.distinctive_visual === true
    || analysis.visual_complexity === "distinctive"
    || analysis.visual_complexity === "mixed"
    || DISTINCTIVE_FEATURE_PATTERN.test(searchableFeatures(analysis.observed_features));
}

/** 读取预声明容差 ID，供原生路线的精确等价性例外绑定。 */
function toleranceIds(contract) {
  const values = contract?.predeclared_tolerances ?? contract?.predeclaredTolerances ?? [];
  return new Set((Array.isArray(values) ? values : []).map((item) => item?.id ?? item?.tolerance_id).filter(nonEmptyString));
}

/** 读取区域批准例外 ID；例外必须已经在区域合同中冻结。 */
function approvedExceptionIds(region) {
  const values = region?.approved_exception_ids ?? region?.approvedExceptionIds ?? [];
  return new Set((Array.isArray(values) ? values : []).filter(nonEmptyString));
}

/** 对复用身份做最小审计，阻断只写“相似/同语义”的伪证据。 */
function hasPreciseReuseIdentity(identity) {
  if (!isObject(identity)) return false;
  const identityKeys = [
    "asset_id",
    "source_asset_id",
    "comparison_id",
  ];
  return identityKeys.some((key) => nonEmptyString(identity[key]))
    && !SEMANTIC_REUSE_PATTERN.test(searchableFeatures(identity));
}

/** 验证 native_suitability，并把资格证据与路线选择分开记录。 */
function validateNativeSuitability(analysis, region, contract, stage, errors, context) {
  const suitability = analysis.native_suitability;
  if (!isObject(suitability)) {
    errors.push(routeError(stage, contract, region, "visual_route_analysis.native_suitability 必须是对象", { missing: "native_suitability" }));
    return;
  }
  if (typeof suitability.eligible !== "boolean") errors.push(routeError(stage, contract, region, "native_suitability.eligible 必须是布尔值", { missing: "native_suitability.eligible" }));
  if (!Array.isArray(suitability.primitive_basis) || suitability.primitive_basis.length === 0) errors.push(routeError(stage, contract, region, "native_suitability 必须列出原生绘制原语", { missing: "native_suitability.primitive_basis" }));
  else if (suitability.primitive_basis.some((item) => !NATIVE_PRIMITIVES.has(item))) errors.push(routeError(stage, contract, region, "native_suitability.primitive_basis 含不允许的原生原语", { expected: [...NATIVE_PRIMITIVES].join(","), actual: JSON.stringify(suitability.primitive_basis) }));
  if (!hasEvidence(suitability.evidence)) errors.push(routeError(stage, contract, region, "native_suitability 缺少可审计资格证据", { missing: "native_suitability.evidence" }));
  if (analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE && suitability.eligible !== true) errors.push(routeError(stage, contract, region, "Cocos 原生路线必须显式声明 eligible=true", { expected: "native_suitability.eligible=true", actual: String(suitability.eligible ?? "missing") }));
  if (analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE) {
    if (Array.isArray(suitability.primitive_basis) && suitability.primitive_basis.includes("not-applicable")) errors.push(routeError(stage, contract, region, "原生路线不能使用 not-applicable 原语"));
    for (const message of validateNativeRenderContract(suitability.render_contract, region)) errors.push(routeError(stage, contract, region, message));
  }

  if (context.distinctive && analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE) {
    // 特色视觉只有在证明原语等价且绑定容差/精确例外时，才能使用原生路线。
    if (!hasEvidence(suitability.equivalence_evidence)) errors.push(routeError(stage, contract, region, "独特视觉选择 Cocos 原生路线必须提供等价性证据", { expected: "native_suitability.equivalence_evidence", actual: "missing" }));
    const tolerance = suitability.tolerance_reference;
    const exception = suitability.approved_exception_id;
    const validTolerance = nonEmptyString(tolerance) && toleranceIds(contract).has(tolerance);
    const validException = nonEmptyString(exception) && approvedExceptionIds(region).has(exception);
    if (!validTolerance && !validException) errors.push(routeError(stage, contract, region, "独特视觉原生例外必须绑定已预声明 tolerance 或精确批准例外 ID", { expected: "predeclared_tolerances 或 approved_exception_ids", actual: JSON.stringify({ tolerance, exception }) }));
  }
}

/** 验证 reuse_suitability，确保复用以精确身份/视觉比较为依据。 */
function validateReuseSuitability(analysis, region, contract, stage, errors) {
  const suitability = analysis.reuse_suitability;
  if (!isObject(suitability)) {
    errors.push(routeError(stage, contract, region, "visual_route_analysis.reuse_suitability 必须是对象", { missing: "reuse_suitability" }));
    return;
  }
  if (typeof suitability.eligible !== "boolean") errors.push(routeError(stage, contract, region, "reuse_suitability.eligible 必须是布尔值", { missing: "reuse_suitability.eligible" }));
  if (!hasEvidence(suitability.evidence)) errors.push(routeError(stage, contract, region, "reuse_suitability 缺少视觉/兼容性证据", { missing: "reuse_suitability.evidence" }));
  const identity = suitability.exact_asset_identity;
  if (suitability.eligible === true) {
    const semanticOnlyEvidence = SEMANTIC_REUSE_PATTERN.test(searchableFeatures(suitability.evidence));
    if (!hasPreciseReuseIdentity(identity) || semanticOnlyEvidence) errors.push(routeError(stage, contract, region, "reuse 必须绑定精确资产 ID 或比较记录 ID，并提供视觉兼容证据；语义相似不等价", { expected: "exact_asset_identity.asset_id/source_asset_id/comparison_id + precise evidence", actual: JSON.stringify({ identity: identity ?? "missing", evidence: suitability.evidence }) }));
  } else if (!(identity === "not-applicable" || identity === undefined || (isObject(identity) && Object.keys(identity).length > 0))) {
    errors.push(routeError(stage, contract, region, "reuse_suitability.exact_asset_identity 无效", { actual: String(identity) }));
  }
  if (analysis.production_method === "reuse" && suitability.eligible !== true) errors.push(routeError(stage, contract, region, "production_method=reuse 必须通过精确复用资格分析", { expected: "reuse_suitability.eligible=true", actual: String(suitability.eligible ?? "missing") }));
}

/**
 * 校验场景装配方式；该事实只约束整屏捕获与原子装配，不参与视觉来源路线选择。
 */
function validateAssemblyAnalysis(region, contract, stage, errors) {
  const assembly = region?.assembly_analysis;
  if (!isObject(assembly)) {
    errors.push(routeError(stage, contract, region, "coverage region 缺少独立 assembly_analysis，不能把非整屏装配推导为程序绘制", { missing: "assembly_analysis" }));
    return;
  }
  if (assembly.strategy !== "atomic-scene-composition") errors.push(routeError(stage, contract, region, "assembly_analysis.strategy 必须使用原子场景装配", { expected: "atomic-scene-composition", actual: String(assembly.strategy ?? "missing") }));
  if (assembly.uses_full_screen_capture !== false) errors.push(routeError(stage, contract, region, "禁止把整屏截图作为交互场景装配来源", { expected: "uses_full_screen_capture=false", actual: String(assembly.uses_full_screen_capture ?? "missing") }));
  if (assembly.allows_atomic_image_assets !== true) errors.push(routeError(stage, contract, region, "原子场景装配必须明确允许独立图片资产，不能把结构化实现等同于程序绘制", { expected: "allows_atomic_image_assets=true", actual: String(assembly.allows_atomic_image_assets ?? "missing") }));
  if (!hasEvidence(assembly.evidence)) errors.push(routeError(stage, contract, region, "assembly_analysis 缺少原子装配证据", { missing: "assembly_analysis.evidence" }));
}

/** 将证据路径限制在项目根目录内，避免文件校验越界读取。 */
function resolveProjectEvidenceFile(projectRoot, file) {
  if (!nonEmptyString(file)) return null;
  const root = resolve(projectRoot ?? ".");
  const target = resolve(root, file);
  const fromRoot = relative(root, target);
  return fromRoot.startsWith("..") || isAbsolute(fromRoot) ? null : target;
}

/** 校验独立全原生分析工件的结构，并逐区域核对资格事实。 */
function validateAllNativeArtifact(artifact, justification, regions, contract, stage, errors) {
  const regionIds = regions.map((region) => region?.region_id).filter(nonEmptyString).sort();
  if (!isObject(artifact)) {
    errors.push(routeError(stage, contract, null, "全原生独立分析工件必须是 JSON 对象", { expected: "all-native-visual-analysis/1.0", actual: typeof artifact }));
    return;
  }
  for (const [field, expected] of [["analysis_schema", "all-native-visual-analysis/1.0"], ["analysis_id", justification.analysis_id], ["producer_role", "independent-visual-reviewer"], ["conclusion", "all-native-eligible"]]) {
    if (artifact[field] !== expected) errors.push(routeError(stage, contract, null, `全原生独立分析工件 ${field} 不匹配`, { expected, actual: String(artifact[field] ?? "missing") }));
  }
  const reviewed = Array.isArray(artifact.reviewed_region_ids) ? artifact.reviewed_region_ids : [];
  if (JSON.stringify([...new Set(reviewed)].sort()) !== JSON.stringify(regionIds)) errors.push(routeError(stage, contract, null, "全原生独立分析工件未精确覆盖全部区域", { expected: JSON.stringify(regionIds), actual: JSON.stringify(reviewed) }));
  const findings = Array.isArray(artifact.region_findings) ? artifact.region_findings : [];
  for (const regionId of regionIds) {
    const region = regions.find((item) => item?.region_id === regionId);
    const finding = findings.find((item) => item?.region_id === regionId);
    if (!isObject(finding) || finding.eligible !== true || !hasEvidence(finding.observed_features) || !hasEvidence(finding.primitive_basis) || !hasEvidence(finding.evidence)) errors.push(routeError(stage, contract, { region_id: regionId }, "独立分析工件必须为每个区域记录 eligible、观察事实、原语依据和证据", { expected: "eligible=true + observed_features + primitive_basis + evidence", actual: JSON.stringify(finding ?? "missing") }));
    if (isObject(finding) && JSON.stringify(finding.observed_features) !== JSON.stringify(region?.visual_route_analysis?.observed_features)) errors.push(routeError(stage, contract, { region_id: regionId }, "独立分析工件的观察事实与场景路线分析不一致", { expected: JSON.stringify(region?.visual_route_analysis?.observed_features), actual: JSON.stringify(finding.observed_features) }));
    if (isObject(finding) && JSON.stringify(finding.primitive_basis) !== JSON.stringify(region?.visual_route_analysis?.native_suitability?.primitive_basis)) errors.push(routeError(stage, contract, { region_id: regionId }, "独立分析工件的原生原语依据与场景路线分析不一致", { expected: JSON.stringify(region?.visual_route_analysis?.native_suitability?.primitive_basis), actual: JSON.stringify(finding.primitive_basis) }));
  }
}

/** 全原生场景必须绑定独立视觉分析，避免同一提案通过自声明把全部视觉降级为程序实现。 */
function validateAllNativeJustification(contract, regions, options, stage, errors) {
  const justification = contract?.all_native_justification;
  const regionIds = regions.map((region) => region?.region_id).filter(nonEmptyString).sort();
  if (!isObject(justification)) {
    errors.push(routeError(stage, contract, null, "全部 coverage region 均选择 cocos-native 时必须提供独立视觉分析", { missing: "all_native_justification", expected: "绑定冻结目标的独立全原生资格分析" }));
    return;
  }
  if (justification.analysis_method !== "independent-visual-analysis") errors.push(routeError(stage, contract, null, "all_native_justification.analysis_method 无效", { expected: "independent-visual-analysis", actual: String(justification.analysis_method ?? "missing") }));
  if (!nonEmptyString(justification.analysis_id)) errors.push(routeError(stage, contract, null, "all_native_justification 缺少独立分析 ID", { missing: "all_native_justification.analysis_id" }));
  if (justification.producer_role !== "independent-visual-reviewer") errors.push(routeError(stage, contract, null, "all_native_justification 必须由独立视觉复核角色产出", { expected: "independent-visual-reviewer", actual: String(justification.producer_role ?? "missing") }));
  if (!nonEmptyString(justification.analysis_artifact_file)) errors.push(routeError(stage, contract, null, "all_native_justification 缺少独立分析工件路径", { missing: "all_native_justification.analysis_artifact_file" }));
  const reviewedRegionIds = Array.isArray(justification.reviewed_region_ids) ? [...new Set(justification.reviewed_region_ids)].sort() : [];
  if (JSON.stringify(reviewedRegionIds) !== JSON.stringify(regionIds)) errors.push(routeError(stage, contract, null, "all_native_justification 必须精确覆盖全部 coverage region", { expected: JSON.stringify(regionIds), actual: JSON.stringify(justification.reviewed_region_ids ?? "missing") }));
  if (justification.conclusion !== "all-native-eligible") errors.push(routeError(stage, contract, null, "all_native_justification 结论无效", { expected: "all-native-eligible", actual: String(justification.conclusion ?? "missing") }));
  if (!nonEmptyString(justification.reason)) errors.push(routeError(stage, contract, null, "all_native_justification 缺少全原生路线理由", { missing: "all_native_justification.reason" }));
  if (!hasEvidence(justification.evidence)) errors.push(routeError(stage, contract, null, "all_native_justification 缺少独立视觉证据", { missing: "all_native_justification.evidence" }));
  if (options.checkFiles === true && nonEmptyString(justification.analysis_artifact_file)) {
    const artifactPath = resolveProjectEvidenceFile(options.projectRoot, justification.analysis_artifact_file);
    if (!artifactPath) errors.push(routeError(stage, contract, null, "全原生独立分析工件路径越出项目根目录", { actual: justification.analysis_artifact_file }));
    else if (!existsSync(artifactPath)) errors.push(routeError(stage, contract, null, "全原生独立分析工件不存在", { actual: justification.analysis_artifact_file }));
    else {
      const bytes = readFileSync(artifactPath);
      try { validateAllNativeArtifact(JSON.parse(bytes.toString("utf8")), justification, regions, contract, stage, errors); }
      catch (error) { errors.push(routeError(stage, contract, null, "全原生独立分析工件不是合法 JSON", { actual: error.message })); }
    }
  }
}

/** 验证单个 coverage 的 canonical visual_route_analysis。 */
export function validateSceneVisualRouteAnalysis(region, contract = {}, options = {}) {
  const stage = options.stage ?? "V1";
  const errors = [];
  if (!isObject(region)) return [routeError(stage, contract, region, "coverage region 必须是对象", { missing: "coverage region" })];
  const analysis = region.visual_route_analysis;
  if (!isObject(analysis)) return [routeError(stage, contract, region, "effect-image coverage 缺少 visual_route_analysis", { missing: "visual_route_analysis" })];
  validateAssemblyAnalysis(region, contract, stage, errors);
  if (Object.hasOwn(analysis, "is_full_screen_capture")) errors.push(routeError(stage, contract, region, "is_full_screen_capture 已从视觉来源路线移除；整屏约束必须写入 assembly_analysis", { expected: "assembly_analysis.uses_full_screen_capture", actual: "visual_route_analysis.is_full_screen_capture" }));

  const required = [
    "element_type",
    "visual_complexity",
    "distinctive_visual",
    "observed_features",
    "asset_first_decision",
    "selected_route",
    "route_reason",
    "dynamic_requirements",
    "native_suitability",
    "reuse_suitability",
    "final_owner",
    "implementation_plan_mode",
    "production_method",
    "delivery_kind",
  ];
  for (const key of required) {
    const value = analysis[key];
    const valid = key === "distinctive_visual"
      ? typeof value === "boolean"
      : key === "observed_features"
        ? Array.isArray(value) && value.length > 0 && value.every((item) => nonEmptyString(item) || isObject(item))
        : key === "dynamic_requirements" || key === "native_suitability" || key === "reuse_suitability"
          ? isObject(value) && Object.keys(value).length > 0
          : nonEmptyString(value);
    if (!valid) errors.push(routeError(stage, contract, region, `visual_route_analysis 缺少或无效 ${key}`, { missing: `visual_route_analysis.${key}` }));
  }
  if (!new Set(["simple", "distinctive", "mixed"]).has(analysis.visual_complexity)) errors.push(routeError(stage, contract, region, "visual_complexity 只能是 simple/distinctive/mixed", { expected: "simple|distinctive|mixed", actual: String(analysis.visual_complexity ?? "missing") }));
  if (!ELEMENT_TYPES.has(analysis.element_type)) errors.push(routeError(stage, contract, region, "element_type 不在视觉区域分类枚举中", { expected: [...ELEMENT_TYPES].join("|"), actual: String(analysis.element_type ?? "missing") }));
  if (!new Set(["asset-first", "native-allowed"]).has(analysis.asset_first_decision)) errors.push(routeError(stage, contract, region, "asset_first_decision 无效", { expected: "asset-first|native-allowed", actual: String(analysis.asset_first_decision ?? "missing") }));
  if (!Object.values(SCENE_VISUAL_ROUTES).includes(analysis.selected_route)) errors.push(routeError(stage, contract, region, "selected_route 无效", { expected: Object.values(SCENE_VISUAL_ROUTES).join("|"), actual: String(analysis.selected_route ?? "missing") }));
  if (!PLAN_MODES.has(analysis.implementation_plan_mode)) errors.push(routeError(stage, contract, region, "implementation_plan_mode 无效", { expected: [...PLAN_MODES].join("|"), actual: String(analysis.implementation_plan_mode ?? "missing") }));
  if (!isObject(analysis.dynamic_requirements) || typeof analysis.dynamic_requirements.is_dynamic !== "boolean" || !nonEmptyString(analysis.dynamic_requirements.description)) errors.push(routeError(stage, contract, region, "dynamic_requirements 必须声明 is_dynamic 和 description", { missing: "dynamic_requirements.is_dynamic/description" }));

  const distinctive = isDistinctiveVisual(analysis);
  validateNativeSuitability(analysis, region, contract, stage, errors, { distinctive });
  validateReuseSuitability(analysis, region, contract, stage, errors);
  if (analysis.production_method === "reuse" && options.checkFiles === true) {
    // 文件阶段复用既有 asset-reuse-snapshot 门，路线分析只负责先阻断语义相似的伪复用。
    const gateRegion = {
      ...region,
      id: region.region_id ?? region.id,
      production_method: analysis.production_method,
      implementation_plan: {
        ...(isObject(region.implementation_plan) ? region.implementation_plan : {}),
        mode: analysis.implementation_plan_mode,
      },
      reuse_snapshot: region.reuse_snapshot ?? analysis.reuse_snapshot,
    };
    errors.push(...validateReuseProductionGate(gateRegion, {
      stage,
      annotation_number: region.annotation_number,
      region_id: region.region_id ?? region.id,
      expectedMethod: "reuse",
      observedMethod: analysis.production_method,
    }, options));
  }

  const route = analysis.selected_route;
  const owner = analysis.final_owner;
  const method = analysis.production_method;
  const delivery = analysis.delivery_kind;
  const isTextElement = TEXT_ELEMENT_TYPES.has(analysis.element_type);
  const hasCompositeInput = route === COMPOSITE_ROUTE || Object.hasOwn(analysis, "composite_parts");
  if (hasCompositeInput) {
    // 无论 selected_route 是否仍写成 composite，遗留 composite_parts 都不能被合法路线忽略。
    errors.push(compositeRouteError(stage, contract, region, route === COMPOSITE_ROUTE ? COMPOSITE_ROUTE : "composite_parts"));
  }
  // 静态与动态只描述行为，不能覆盖被冻结的图片生产来源。
  if (route === SCENE_VISUAL_ROUTES.COCOS_NATIVE && (region.image_generation_required === true || region.production_contract?.image_generation_required === true)) errors.push(routeError(stage, contract, region, "image_generation_required=true 的冻结合同禁止自动替换为原生绘制；必须完成明确变更流程"));
  if (route === SCENE_VISUAL_ROUTES.IMAGE_ASSET) {
    // 复用现有 fixed-production-visual 门，保证路线分析不会另造一套图片方法语义。
    errors.push(...validateFixedVisualProductionMethod({
      ...region,
      owner_type: owner,
      production_method: method,
      delivery_kind: delivery,
    }, {
      stage,
      annotation_number: region.annotation_number,
      region_id: region.region_id ?? region.id,
      observedMethod: method,
    }));
    if (analysis.asset_first_decision !== "asset-first") errors.push(routeError(stage, contract, region, "图片资产路线必须声明 asset-first", { expected: "asset-first", actual: String(analysis.asset_first_decision) }));
    if (!FIXED_OWNERS.has(owner) || !FIXED_METHODS.has(method) || !FIXED_DELIVERIES.has(delivery)) errors.push(routeError(stage, contract, region, "图片资产路线必须由 fixed-production-visual 和固定图片生产/交付承载", { expected: "fixed-production-visual + image-generation/authored-raster/reuse + raster-image/existing-asset", actual: JSON.stringify({ owner, method, delivery }) }));
    if (method === "reuse" && analysis.reuse_suitability?.eligible !== true) errors.push(routeError(stage, contract, region, "reuse 图片资产必须有精确身份和视觉兼容证据", { expected: "reuse_suitability.eligible=true", actual: String(analysis.reuse_suitability?.eligible ?? "missing") }));
    if (method === "reuse" && analysis.implementation_plan_mode !== "reuse-existing") errors.push(routeError(stage, contract, region, "reuse 图片资产必须绑定 reuse-existing 实施计划", { expected: "reuse-existing", actual: analysis.implementation_plan_mode }));
    if (method !== "reuse" && analysis.implementation_plan_mode !== "generate-now") errors.push(routeError(stage, contract, region, "非复用图片资产必须绑定独立生成计划", { expected: "generate-now", actual: analysis.implementation_plan_mode }));
  } else if (route === SCENE_VISUAL_ROUTES.COCOS_NATIVE) {
    if (analysis.asset_first_decision !== "native-allowed") errors.push(routeError(stage, contract, region, "Cocos 原生路线必须声明 native-allowed", { expected: "native-allowed", actual: String(analysis.asset_first_decision) }));
    if (!NATIVE_OWNERS.has(owner) || !NATIVE_METHODS.has(method) || !NATIVE_DELIVERIES.has(delivery)) errors.push(routeError(stage, contract, region, "Cocos 原生路线只能用于 runtime owner 和原生生产/交付", { expected: "runtime-data/runtime-rendered/runtime-program + cocos-graphics/runtime-program", actual: JSON.stringify({ owner, method, delivery }) }));
    if (analysis.implementation_plan_mode !== "runtime-program") errors.push(routeError(stage, contract, region, "Cocos 原生路线必须绑定 runtime-program 实施计划", { expected: "runtime-program", actual: analysis.implementation_plan_mode }));
    if (distinctive && analysis.native_suitability?.eligible === true && !hasEvidence(analysis.native_suitability?.equivalence_evidence)) {
      errors.push(routeError(stage, contract, region, "特色视觉不得无等价证据降级为 Cocos 原生路线", { expected: "等价性证据 + tolerance/exception", actual: "missing" }));
    }
  }

  const regionOwner = region.implementation_owner;
  if (nonEmptyString(regionOwner) && regionOwner !== owner) errors.push(routeError(stage, contract, region, "visual_route_analysis.final_owner 与 implementation_owner 不一致", { expected: owner, actual: regionOwner }));
  const regionMode = planMode(region);
  if (nonEmptyString(regionMode) && regionMode !== analysis.implementation_plan_mode) errors.push(routeError(stage, contract, region, "visual_route_analysis.implementation_plan_mode 与 implementation_plan.mode 不一致", { expected: analysis.implementation_plan_mode, actual: regionMode }));
  if (hasField(region, "production_method") && region.production_method !== method) errors.push(routeError(stage, contract, region, "visual_route_analysis.production_method 与 coverage production_method 不一致", { expected: method, actual: region.production_method }));
  if (hasField(region, "delivery_kind") && region.delivery_kind !== delivery) errors.push(routeError(stage, contract, region, "visual_route_analysis.delivery_kind 与 coverage delivery_kind 不一致", { expected: delivery, actual: region.delivery_kind }));

  if (isTextElement) {
    if (!nonEmptyString(analysis.text_decomposition_ref)) errors.push(routeError(stage, contract, region, "文本区域必须明确委托 text_decomposition，不能由通用视觉路线吞掉字形合同", { missing: "text_decomposition_ref" }));
    const textNodes = contract?.text_decomposition?.text_nodes ?? [];
    if (nonEmptyString(analysis.text_decomposition_ref) && Array.isArray(textNodes) && textNodes.length > 0 && !textNodes.some((node) => node?.text_node_id === analysis.text_decomposition_ref || node?.region_id === region.region_id)) errors.push(routeError(stage, contract, region, "text_decomposition_ref 未绑定当前文本节点/区域", { actual: analysis.text_decomposition_ref }));
  }
  if (NATIVE_ELEMENT_TYPES.has(analysis.element_type) && route === SCENE_VISUAL_ROUTES.COCOS_NATIVE && analysis.native_suitability?.eligible !== true) errors.push(routeError(stage, contract, region, "可原生元素也必须提供完整 native_suitability 资格", { expected: "eligible=true", actual: String(analysis.native_suitability?.eligible ?? "missing") }));
  return errors;
}

/** 把场景 route 与 coverage_audit/Implementation Package 的既有字段做单向一致性校验。 */
function validateBoundProductionFields(region, analysis, bound, sourceLabel, contract, stage, errors) {
  if (!isObject(bound)) return;
  const returnStage = sourceLabel.includes("visualProductionUnit") ? "V3/V4" : "V1/PROPOSAL";
  const rootCause = sourceLabel.includes("visualProductionUnit") ? "执行问题" : "方案缺失";
  if (analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE && (bound.production_method ?? bound.production_contract?.production_method) !== undefined) {
    // 参数进入既有 runtime_implementation 确认哈希，不能在行为装配阶段悄悄改变外观。
    const implementation = bound.runtime_implementation ?? bound.production_contract?.runtime_implementation;
    if (!isDeepStrictEqual(implementation?.render_contract, analysis.native_suitability?.render_contract)) errors.push(routeError(stage, contract, region, `${sourceLabel} runtime_implementation.render_contract 必须精确镜像冻结原生参数`, { returnStage, rootCause }));
  }
  if (analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE && (bound.image_generation_required === true || bound.production_contract?.image_generation_required === true)) errors.push(routeError(stage, contract, region, `${sourceLabel} image_generation_required=true 的冻结合同禁止自动替换为原生绘制；必须完成明确变更流程`, { returnStage, rootCause }));
  const owner = bound.owner_type ?? bound.implementation_owner;
  if (owner !== undefined && owner !== analysis.final_owner) errors.push(routeError(stage, contract, region, `${sourceLabel} owner 与 visual_route_analysis 不一致`, { expected: analysis.final_owner, actual: owner, returnStage, rootCause }));
  if (bound.production_method !== undefined && bound.production_method !== analysis.production_method) errors.push(routeError(stage, contract, region, `${sourceLabel} production_method 与 visual_route_analysis 不一致`, { expected: analysis.production_method, actual: bound.production_method, returnStage, rootCause }));
  if (bound.delivery_kind !== undefined && bound.delivery_kind !== analysis.delivery_kind) errors.push(routeError(stage, contract, region, `${sourceLabel} delivery_kind 与 visual_route_analysis 不一致`, { expected: analysis.delivery_kind, actual: bound.delivery_kind, returnStage, rootCause }));
  const mode = bound.implementation_plan?.mode;
  if (mode !== undefined && mode !== analysis.implementation_plan_mode) errors.push(routeError(stage, contract, region, `${sourceLabel} implementation_plan.mode 与 visual_route_analysis 不一致`, { expected: analysis.implementation_plan_mode, actual: mode, returnStage, rootCause }));
  if (bound.visual_route_analysis !== undefined && JSON.stringify(bound.visual_route_analysis) !== JSON.stringify(analysis)) errors.push(routeError(stage, contract, region, `${sourceLabel} visual_route_analysis 必须精确镜像场景合同`, { expected: JSON.stringify(analysis), actual: JSON.stringify(bound.visual_route_analysis), returnStage, rootCause }));
}

/** 验证 effect-image 所有 coverage region 的视觉路线；普通工作流不进入此入口。 */
export function validateSceneVisualRouteContract(contract, manifest = null, options = {}) {
  const stage = options.stage ?? "V1";
  const regions = contract?.coverage_regions;
  if (!Array.isArray(regions)) return [routeError(stage, contract, null, "effect-image 缺少 coverage_regions，无法分析视觉路线", { missing: "coverage_regions" })];
  const errors = [];
  const manifestRegions = new Map((Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : []).filter(isObject).map((item) => [item.id ?? item.region_id, item]));
  const units = Array.isArray(manifest?.visualProductionUnits) ? manifest.visualProductionUnits : [];
  for (const region of regions) {
    errors.push(...validateSceneVisualRouteAnalysis(region, contract, { ...options, stage }));
    const analysis = region?.visual_route_analysis;
    if (!isObject(analysis)) continue;
    if (analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE) {
      for (const message of validateNativeRuntimeEvidence(region, contract, manifest, { ...options, stage })) errors.push(routeError(stage, contract, region, message, { returnStage: "V3/V4", rootCause: "执行问题" }));
    }
    const regionId = region.region_id;
    validateBoundProductionFields(region, analysis, manifestRegions.get(regionId), "coverage_audit region", contract, stage, errors);
    for (const unit of units.filter((item) => item?.region_id === regionId)) validateBoundProductionFields(region, analysis, unit, "visualProductionUnit", contract, stage, errors);
  }
  const analyses = regions.map((region) => region?.visual_route_analysis).filter(isObject);
  if (regions.length > 0 && analyses.length === regions.length && analyses.every((analysis) => analysis.selected_route === SCENE_VISUAL_ROUTES.COCOS_NATIVE)) validateAllNativeJustification(contract, regions, options, stage, errors);
  return errors;
}
