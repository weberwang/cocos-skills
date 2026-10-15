/**
 * 统一视觉验收模式与几何偏差策略。
 *
 * `usability` 是默认模式，关注内容是否可见、可读、可交互以及是否发生
 * 明显越界；`exact` 只在合同显式声明时启用完整的像素级几何证据。
 */

import { isWorkflowDpr, workflowDprError } from "./workflow-dpr-contract.mjs";

export const VISUAL_VALIDATION_MODES = Object.freeze(["usability", "exact"]);
export const DEFAULT_VISUAL_VALIDATION_MODE = "usability";
/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 验证证据路径列表，供 manifest fidelity 快照复用。 */
function validatePathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) errors.push(`${label} 必须是非空路径列表`);
}

/** 校验 manifest fidelity 快照的身份和代表性证据，精确材料由 exact 模式追加要求。 */
export function validateVisualManifestFidelityCases(cases, target, candidate, baseline, errors, { requireCompleteCoverage = false, mode = DEFAULT_VISUAL_VALIDATION_MODE } = {}) {
  const exact = mode === "exact";
  if (!Array.isArray(cases) || cases.length === 0) { errors.push("fidelity_cases 必须是非空数组"); return; }
  const ids = new Set(); const passedPairs = new Set();
  cases.forEach((item, index) => {
    const label = `fidelity_cases[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "scene_id", "state_id", "language", "input_trace", "animation_sample", "layout_contract_version", "visual_baseline_version", "conclusion"]) if (!nonEmptyString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (nonEmptyString(item.scene_id) && !target?.scene_ids?.includes(item.scene_id)) errors.push(`${label}.scene_id 不在 reference_target.scene_ids 范围内`);
    if (nonEmptyString(item.state_id) && !target?.state_ids?.includes(item.state_id)) errors.push(`${label}.state_id 不在 reference_target.state_ids 范围内`);
    const expectedCandidateId = candidate?.candidateId ?? candidate?.candidate_id ?? candidate?.id;
    const observedCandidateId = item.candidate_id ?? item.candidateId;
    if (nonEmptyString(expectedCandidateId) && nonEmptyString(observedCandidateId) && observedCandidateId !== expectedCandidateId) errors.push(`${label}.candidate_id 与当前候选不一致`);
    const expectedCandidateVersion = candidate?.candidateVersion ?? candidate?.candidate_version ?? candidate?.version;
    const observedCandidateVersion = item.candidate_version ?? item.candidateVersion;
    if (nonEmptyString(expectedCandidateVersion) && nonEmptyString(observedCandidateVersion) && observedCandidateVersion !== expectedCandidateVersion) errors.push(`${label}.candidate_version 与当前候选版本不一致`);
    const expectedTargetFile = target?.original_file ?? target?.originalFile ?? target?.file;
    const observedTargetFile = item.target_file ?? item.targetFile ?? item.reference_file ?? item.referenceFile;
    if (nonEmptyString(expectedTargetFile) && nonEmptyString(observedTargetFile) && observedTargetFile !== expectedTargetFile) errors.push(`${label}.target_file 与当前冻结目标不一致`);
    if (nonEmptyString(baseline?.version) && item.visual_baseline_version !== baseline.version) errors.push(`${label}.visual_baseline_version 与根 visual_baseline.version 不一致，旧证据已失效`);
    if (!isObject(item.viewport) || !["width", "height"].every((field) => typeof item.viewport[field] === "number" && item.viewport[field] > 0)) errors.push(`${label}.viewport 必须包含正数 width/height`);
    if (!isWorkflowDpr(item.dpr)) errors.push(`${label}.${workflowDprError("dpr", item.dpr)}`);
    if (!(Number.isInteger(item.random_seed) || nonEmptyString(item.random_seed))) errors.push(`${label}.random_seed 必须是整数或非空字符串`);
    for (const field of ["reference_evidence", "candidate_evidence"]) validatePathList(item[field], `${label}.${field}`, errors);
    if (exact && (!isObject(item.tolerance) || !nonEmptyString(item.tolerance.unit) || typeof item.tolerance.value !== "number" || item.tolerance.value < 0)) errors.push(`${label}.tolerance 必须包含项目预定义的 unit 和非负 value`);
    if (!Array.isArray(item.exception_ids) || !item.exception_ids.every(nonEmptyString)) errors.push(`${label}.exception_ids 必须是字符串数组`);
    if (!["passed", "failed"].includes(item.conclusion)) errors.push(`${label}.conclusion 必须为 passed 或 failed`);
    if (item.conclusion === "passed" && nonEmptyString(item.scene_id) && nonEmptyString(item.state_id)) passedPairs.add(`${item.scene_id}\0${item.state_id}`);
    if (nonEmptyString(item.id)) { if (ids.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); ids.add(item.id); }
  });
  if (exact && requireCompleteCoverage) {
    const expectedPairs = (target?.scene_ids ?? []).flatMap((sceneId) => (target?.state_ids ?? []).map((stateId) => `${sceneId}\0${stateId}`));
    for (const pair of expectedPairs) if (!passedPairs.has(pair)) errors.push(`fidelity_cases 缺少冻结目标组合的 passed case：${pair.replace("\0", "/")}`);
  }
}

/** 读取一个来源中显式声明的视觉验收模式；效果图适用性本身不构成 exact 声明。 */
function readDeclaration(source) {
  if (!isObject(source)) return null;
  if (Object.hasOwn(source, "visual_validation")) {
    const nested = source.visual_validation;
    if (!isObject(nested) || nested.mode === undefined || nested.mode === null) return { mode: "", explicit: true };
    return { mode: String(nested.mode).trim().toLowerCase(), explicit: true };
  }
  return null;
}

/** 收集合同链上的模式声明，供根合同和下游证据做一致性检查。 */
export function collectVisualValidationDeclarations(...sources) {
  return sources.flatMap((source) => {
    const declaration = readDeclaration(source);
    return declaration ? [declaration] : [];
  });
}

/** 解析视觉验收模式；没有显式声明时稳定回落到 usability。 */
export function resolveVisualValidationMode(...sources) {
  const declaration = collectVisualValidationDeclarations(...sources).find((item) => item.explicit);
  return VISUAL_VALIDATION_MODES.includes(declaration?.mode) ? declaration.mode : DEFAULT_VISUAL_VALIDATION_MODE;
}

/** 判断当前视觉验收是否显式进入 exact 严格模式。 */
export function isExactVisualValidation(...sources) {
  return resolveVisualValidationMode(...sources) === "exact";
}

/** 验证模式值及合同链一致性；缺省模式不产生错误。 */
export function validateVisualValidationPolicy(errors, label = "visual_validation", ...sources) {
  const declarations = collectVisualValidationDeclarations(...sources);
  const valid = declarations.filter((item) => VISUAL_VALIDATION_MODES.includes(item.mode));
  for (const declaration of declarations) {
    if (!VISUAL_VALIDATION_MODES.includes(declaration.mode)) errors.push(`${label}.mode 必须为 usability 或 exact，实际为 ${declaration.mode || "missing"}`);
  }
  const modes = new Set(valid.map((item) => item.mode));
  if (modes.size > 1) errors.push(`${label}.mode 在视觉合同链中必须保持一致：${[...modes].join(", ")}`);
  return resolveVisualValidationMode(...sources);
}

const VIEWPORT_EDGE_EPSILON = 1;
const VISIBILITY_MARKER_KEYS = new Set([
  "type", "node_type", "nodeType", "element_type", "elementType", "semantic_role", "semanticRole", "role",
  "content_type", "contentType", "kind", "layer_type", "layerType", "layout_type", "layoutType",
  "clip_policy", "clipPolicy", "overflow", "overflow_policy", "overflowPolicy", "crop_policy", "cropPolicy",
  "clipping", "crop", "visibility", "display", "required_visibility", "requiredVisibility",
  "clipping_cropping_facts", "clippingCroppingFacts", "background_focus_foreground_occlusion", "backgroundFocusForegroundOcclusion",
  "size_policy", "sizePolicy", "fill_policy", "fillPolicy", "background_policy", "backgroundPolicy", "presentation_policy", "presentationPolicy",
  "mode", "strategy", "policy", "rule",
]);
const VISIBILITY_BOOLEAN_KEYS = new Set([
  "critical", "is_critical", "isCritical", "required", "interactive", "is_interactive", "isInteractive",
  "clickable", "is_clickable", "isClickable", "must_be_visible", "mustBeVisible", "requires_full_visibility",
  "requiresFullVisibility", "text", "is_text", "isText", "visible", "readable", "unreadable", "occluded", "enabled",
]);

const POSITIVE_REQUIRED_KEYS = new Set([
  "critical", "is_critical", "isCritical", "required", "interactive", "is_interactive", "isInteractive",
  "clickable", "is_clickable", "isClickable", "must_be_visible", "mustBeVisible", "requires_full_visibility",
  "requiresFullVisibility",
]);
const POSITIVE_OVERFLOW_STRATEGIES = new Set(["cover", "crop", "clip", "scroll", "overflow", "bleed", "full-bleed", "fullbleed"]);
const NEGATIVE_OVERFLOW_STRATEGIES = new Set(["none", "no-clipping", "no-clip", "forbid", "forbid-overflow", "forbid-crop", "forbid-clipping"]);

/** 统一策略值的大小写和空格，供正向/否定策略集合做精确匹配。 */
function normalizeVisibilityMarker(value) {
  return String(value).trim().toLowerCase().replace(/[\s_]+/g, "-");
}
const NORMALIZED_VISIBILITY_BOOLEAN_KEYS = new Set([...VISIBILITY_BOOLEAN_KEYS].map(normalizeVisibilityMarker));
const NORMALIZED_POSITIVE_REQUIRED_KEYS = new Set([...POSITIVE_REQUIRED_KEYS].map(normalizeVisibilityMarker));

/** 收集节点和区域中与完整可见性、裁切策略有关的声明文本。 */
function visibilityMarkers(value, result = []) {
  if (!isObject(value)) return result;
  for (const [key, nested] of Object.entries(value)) {
    if (VISIBILITY_MARKER_KEYS.has(key) || VISIBILITY_BOOLEAN_KEYS.has(key)) {
      const markerKey = normalizeVisibilityMarker(key);
      if (typeof nested === "string") result.push({ key: markerKey, value: normalizeVisibilityMarker(nested) });
      else if (typeof nested === "boolean") result.push({ key: markerKey, value: String(nested) });
      else if (isObject(nested)) visibilityMarkers(nested, result);
    }
  }
  return result;
}

/** 判断节点是否属于必须完整可见的交互、文字或其它关键内容。 */
function requiresCompleteViewportVisibility(node, region) {
  const markers = [...visibilityMarkers(region), ...visibilityMarkers(node)];
  const keyContent = markers.some(({ key, value }) => {
    if (value === "false" && NORMALIZED_VISIBILITY_BOOLEAN_KEYS.has(key)) return false;
    if (NORMALIZED_VISIBILITY_BOOLEAN_KEYS.has(key) && (value === "true" || value === "false")) return value === "true" && /interactive|clickable|text|readable|usable|accessible/.test(key);
    if (/^(no|non|not|without|forbid|disabled|un|hidden)-/.test(value)) return false;
    return /button|action|interactive|click|input|control|text|label|title|caption|heading|link|field|menu|dialog|readab|usable|accessible/.test(value);
  });
  if (keyContent) return true;
  const values = markers.map(({ value }) => value);
  const backgroundOnly = values.some((value) => /background|backdrop|cover|decorative|canvas|surface|full-bleed|fullbleed/.test(value));
  const required = markers.some(({ key, value }) => NORMALIZED_POSITIVE_REQUIRED_KEYS.has(key) && value === "true");
  return required && !backgroundOnly;
}

/** 判断节点或区域是否声明允许滚动、cover 或其它有意裁切。 */
function allowsIntentionalViewportOverflow(node, region) {
  const markers = [...visibilityMarkers(region), ...visibilityMarkers(node)];
  const strategies = markers.filter(({ key }) => ["clip-policy", "overflow", "overflow-policy", "crop-policy", "clipping", "crop", "mode", "strategy", "policy", "rule"].includes(key)).map(({ value }) => value);
  if (strategies.some((value) => NEGATIVE_OVERFLOW_STRATEGIES.has(value))) return false;
  return strategies.some((value) => POSITIVE_OVERFLOW_STRATEGIES.has(value));
}

/** 判断候选矩形是否造成实际的关键内容越界；普通背景和有意裁切不会误报。 */
export function visualBoundsOutsideViewport(value, viewport, node = null, region = null) {
  if (!isObject(value) || !isObject(viewport)) return false;
  if (!(typeof viewport.width === "number" && Number.isFinite(viewport.width) && viewport.width > 0 && typeof viewport.height === "number" && Number.isFinite(viewport.height) && viewport.height > 0)) return false;
  if (!(typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0 && typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0)) return false;
  const viewportX = typeof viewport.x === "number" && Number.isFinite(viewport.x) ? viewport.x : 0;
  const viewportY = typeof viewport.y === "number" && Number.isFinite(viewport.y) ? viewport.y : 0;
  const viewportRight = viewportX + viewport.width;
  const viewportBottom = viewportY + viewport.height;
  const exceedsBy = Math.max(viewportX - value.x, viewportY - value.y, value.x + value.width - viewportRight, value.y + value.height - viewportBottom, 0);
  if (exceedsBy <= VIEWPORT_EDGE_EPSILON) return false;
  if (!requiresCompleteViewportVisibility(node, region)) return false;
  const completelyOutside = value.x + value.width <= viewportX + VIEWPORT_EDGE_EPSILON
    || value.x >= viewportRight - VIEWPORT_EDGE_EPSILON
    || value.y + value.height <= viewportY + VIEWPORT_EDGE_EPSILON
    || value.y >= viewportBottom - VIEWPORT_EDGE_EPSILON;
  // 滚动/cover 可允许部分出血，但关键内容完全离开视口仍代表不可用。
  if (completelyOutside) return true;
  return !allowsIntentionalViewportOverflow(node, region);
}

/** 递归收集有限数值，用于从真实 delta 和 target/candidate bounds 重新计算偏差。 */
function numericValues(value, result = []) {
  if (typeof value === "number" && Number.isFinite(value)) result.push(Math.abs(value));
  else if (Array.isArray(value)) for (const nested of value) numericValues(nested, result);
  else if (isObject(value)) for (const nested of Object.values(value)) numericValues(nested, result);
  return result;
}

/** 从目标和候选事实推导数值偏差，避免以伪造 delta=0 绕过明显差异检查。 */
function pairedNumericDifferences(target, candidate, result = []) {
  if (typeof target === "number" && typeof candidate === "number" && Number.isFinite(target) && Number.isFinite(candidate)) result.push(Math.abs(candidate - target));
  else if (Array.isArray(target) && Array.isArray(candidate)) for (let index = 0; index < Math.max(target.length, candidate.length); index += 1) pairedNumericDifferences(target[index], candidate[index], result);
  else if (isObject(target) && isObject(candidate)) for (const key of new Set([...Object.keys(target), ...Object.keys(candidate)])) pairedNumericDifferences(target[key], candidate[key], result);
  return result;
}

/** 判断 exact 模式几何差异是否超过声明容差；usability 模式只记录差异，不以固定像素门阻断。 */
export function visualGeometryDifferenceExceeds(target, candidate, delta, { mode = DEFAULT_VISUAL_VALIDATION_MODE, declaredLimit = null } = {}) {
  // 可用性模式关注越界、裁切和交互结果；单纯位置/大小差异保留给报告提示，避免固定像素门误拦正常迭代。
  if (mode !== "exact") return false;
  const differences = [...numericValues(delta), ...pairedNumericDifferences(target, candidate)];
  if (differences.length === 0) return false;
  const limit = declaredLimit;
  return limit === null || differences.some((value) => value > limit);
}
