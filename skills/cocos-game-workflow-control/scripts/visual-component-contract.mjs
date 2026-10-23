#!/usr/bin/env node

/**
 * 视觉区域的状态分析与可复用部件合同。
 *
 * annotation_number 只标识效果图上的审阅区域，不能直接当作资产数量。
 * 该模块把“区域 → 部件 → 状态 → 资产/图集切片”收敛成可验证的映射，
 * 供 V2、V3、Implementation Package、V4 和 F2 共用。
 */
import { getVisualRegionDefinitionAliasConflicts, normalizeVisualRegionDefinition } from "../../cocos-game-asset-integration/scripts/effect_image_annotation_core.mjs";
import { atomicImageRequirementsEqual, deriveAtomicImageRequirements, normalizeAtomicComponents, normalizeAtomicImageRequirements } from "./visual-atomic-contract.mjs";
import { collectImageGenerationRasterViolations } from "./visual-imagegen-format.mjs";
import { validateFixedVisualProductionMethod } from "./visual-decomposition-confirmation.mjs";
import { canonicalJson, isPlainObject as isObject, nonEmptyString, normalizeContractPath as normalizeProjectRelativePath } from "./visual-contract-core.mjs";
import { equalNineSliceContracts, isNineSliceStretch, isNineSliceStretchTargetAllowed, validateNineSliceContract, validateNineSliceTargetBounds } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";
import { validateDisplayNodeRole } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";

export { atomicImageRequirementsEqual, deriveAtomicImageRequirements, normalizeAtomicComponents, normalizeAtomicImageRequirements };
export { validateFixedVisualProductionMethod } from "./visual-decomposition-confirmation.mjs";
/** 对外保留项目相对路径名称，实际规范化逻辑由共享核心单一实现。 */
export { normalizeProjectRelativePath };

/** 需要被显式分析的常见视觉状态；不适用时必须写 reason。 */
export const STANDARD_VISUAL_STATES = Object.freeze([
  { id: "default", aliases: ["default", "normal", "idle"] },
  { id: "selected", aliases: ["selected", "select"] },
  { id: "active", aliases: ["active", "activated"] },
  { id: "disabled", aliases: ["disabled", "disable"] },
  { id: "pressed", aliases: ["pressed", "down"] },
  { id: "hover", aliases: ["hover", "hovered", "over"] },
  { id: "victory", aliases: ["victory", "win", "won", "success"] },
  { id: "defeat", aliases: ["defeat", "lose", "lost", "failure", "fail"] },
  { id: "paused", aliases: ["paused", "pause"] },
]);

const STATE_ALIAS_TO_ID = new Map(STANDARD_VISUAL_STATES.flatMap(({ id, aliases }) => aliases.map((alias) => [alias, id])));
const REQUIREMENTS = new Set(["required", "not-applicable"]);
const DELIVERY_MODES = new Set(["individual", "atlas"]);
const HIT_AREA_KINDS = new Set(["hit-area", "interaction-hotspot", "hotspot", "interaction-zone"]);

/** 规范化 role/asset_kind 的语义 token，防止下划线、空格或 camelCase 绕过热区禁令。 */
function semanticToken(value) {
  if (!nonEmptyString(value)) return "";
  return String(value).trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
}

/** 判断 role/asset_kind 是否代表交互热区，而不是视觉资产。 */
function isHitAreaKind(value) { return HIT_AREA_KINDS.has(semanticToken(value)); }

/** 比较项目内路径的物理身份；Windows/常见运行时文件系统不区分大小写。 */
function sameProjectPath(left, right) {
  const normalizedLeft = normalizeProjectRelativePath(left);
  const normalizedRight = normalizeProjectRelativePath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

/** 判断资源是否同时携带两个共享身份字段，避免合同比较时静默选取一侧。 */
function hasShareAliasConflict(value) {
  return isObject(value) && Object.hasOwn(value, "share_id") && Object.hasOwn(value, "shareId");
}

/** 判断合同是否显式携带 runtime_implementation；文件方法连 null 也不得借此绕过互斥门。 */
export function hasRuntimeImplementationField(value = {}) {
  const nested = value?.production_contract ?? value?.productionContract;
  return [value, nested].some((item) => isObject(item) && (Object.hasOwn(item, "runtime_implementation") || Object.hasOwn(item, "runtimeImplementation")));
}

/** 将状态别名统一到机器可比对的 canonical state_id。 */
export function canonicalStateId(value) {
  if (!nonEmptyString(value)) return "";
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return STATE_ALIAS_TO_ID.get(normalized) ?? normalized;
}

/** 生成包含编号、区域、部件和状态的合同错误，避免只显示笼统的 region 错误。 */
function componentError(context = {}, message, details = {}) {
  const stage = context.stage ?? "V3";
  const annotation = context.annotation_number ?? context.annotationNumber ?? "?";
  const region = context.region_id ?? context.regionId ?? "?";
  const component = details.componentId ?? context.component_id ?? "?";
  const state = details.stateId ?? context.state_id ?? "?";
  const expected = details.expectedCount ?? "?";
  const observed = details.observedCount ?? "?";
  const count = details.expectedCount !== undefined || details.observedCount !== undefined
    ? ` expected_count=${expected} observed_count=${observed}` : "";
  const missing = details.missing ? ` 缺失=${details.missing}` : "";
  return `[${stage}] annotation_number=${annotation} region_id=${region} component_id=${component} state_id=${state}${count}${missing} ${message}`;
}

/** 规范化状态分析记录，同时接受 state_analysis.states 的唯一正式形态。 */
export function normalizeStateAnalysis(value = {}) {
  const states = Array.isArray(value.states) ? value.states : [];
  return {
    status: value.status ?? value.analysis_status ?? "",
    phase: value.phase ?? value.analysis_phase ?? "",
    evidence: value.evidence ?? value.analysis_evidence ?? "",
    evidence_sha256: value.evidence_sha256 ?? value.evidenceSha256 ?? "",
    reference_target_sha256: value.reference_target_sha256 ?? value.referenceTargetSha256 ?? "",
    analysis_id: value.analysis_id ?? value.analysisId ?? "",
    completed_at: value.completed_at ?? value.completedAt ?? "",
    states: states.map((state) => ({
      state_id: state?.state_id ?? state?.stateId ?? "",
      canonical_state_id: canonicalStateId(state?.state_id ?? state?.stateId),
      requirement: state?.requirement ?? state?.applicability ?? "",
      reason: state?.reason ?? state?.rationale ?? "",
    })),
  };
}

/** 规范化部件清单，明确区分原子部件数量和 annotation 区域数量。 */
export function normalizeComponentInventory(value = {}) {
  const components = Array.isArray(value.components) ? value.components : [];
  return {
    granularity: value.granularity ?? value.asset_granularity ?? "",
    component_count: value.component_count ?? value.componentCount,
    visible_instance_count: value.visible_instance_count ?? value.visibleInstanceCount,
    delivery_mode: value.delivery_mode ?? value.deliveryMode ?? value.asset_delivery_mode ?? "",
    atlas_allowed: value.atlas_allowed ?? value.atlasAllowed,
    created_at: value.created_at ?? value.createdAt ?? "",
    components: components.map((component) => ({
      component_id: component?.component_id ?? component?.componentId ?? "",
      ...(component?.render_kind !== undefined ? { render_kind: component.render_kind } : {}),
      ...(component?.element_type !== undefined ? { element_type: component.element_type } : {}),
      ...(component?.is_container !== undefined ? { is_container: component.is_container } : {}),
      atomic_visual_key: component?.atomic_visual_key ?? component?.atomicVisualKey ?? "",
      role: semanticToken(component?.role ?? component?.component_role ?? ""),
      reusable: component?.reusable,
      state_coverage: Array.isArray(component?.state_coverage)
        ? component.state_coverage
        : (Array.isArray(component?.stateCoverage) ? component.stateCoverage : null),
      placements: Array.isArray(component?.placements) ? component.placements.map((placement) => ({
        placement_id: placement?.placement_id ?? placement?.placementId ?? "",
        ...(placement?.render_kind !== undefined ? { render_kind: placement.render_kind } : {}),
        bounds: isObject(placement?.bounds) ? { x: placement.bounds.x, y: placement.bounds.y, width: placement.bounds.width, height: placement.bounds.height } : null,
        interaction_required: placement?.interaction_required ?? placement?.interactionRequired,
        ...(placement?.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(placement.nine_slice, `placement ${placement?.placement_id ?? "?"}.nine_slice`) } : {}),
        ...(Object.hasOwn(placement ?? {}, "nine_slice_decision_required") ? { nine_slice_decision_required: placement.nine_slice_decision_required } : {}),
      })) : null,
      ...(component?.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(component.nine_slice, `component ${component?.component_id ?? "?"}.nine_slice`) } : {}),
      ...(Object.hasOwn(component ?? {}, "nine_slice_decision_required") ? { nine_slice_decision_required: component.nine_slice_decision_required } : {}),
    })),
  };
}

/** 规范化图集切片身份，确保 camelCase 与 snake_case 不能形成两份切片记录。 */
function normalizeAtlasSlice(value) {
  if (!isObject(value)) return null;
  const rect = isObject(value.rect) ? value.rect : value;
  const atlasSize = isObject(value.atlas_size ?? value.atlasSize) ? (value.atlas_size ?? value.atlasSize) : {};
  return {
    atlas_asset_id: value.atlas_asset_id ?? value.atlasAssetId ?? "",
    slice_id: value.slice_id ?? value.sliceId ?? "",
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    atlas_size: { width: atlasSize.width, height: atlasSize.height },
  };
}

/** 规范化 expected_assets 中与原子部件和状态相关的字段。 */
export function normalizeComponentExpectedAsset(value) {
  if (typeof value === "string") return { asset_id: value, component_id: "", state_id: "", asset_kind: "visual" };
  if (!isObject(value)) return { asset_id: "", component_id: "", state_id: "", asset_kind: "visual" };
  const sourceFile = value.source_file ?? value.sourceFile ?? value.file ?? "";
  const runtimeFile = value.runtime_file ?? value.runtimeFile ?? value.runtime_output_file ?? value.runtimeOutputFile ?? "";
  return {
    asset_id: value.asset_id ?? value.id ?? value.name ?? value.file ?? value.path ?? "",
    component_id: value.component_id ?? value.componentId ?? "",
    state_id: value.state_id ?? value.stateId ?? "",
    canonical_state_id: canonicalStateId(value.state_id ?? value.stateId),
    asset_kind: semanticToken(value.asset_kind ?? value.assetKind ?? value.kind ?? "visual"),
    asset_scope: semanticToken(value.asset_scope ?? value.assetScope ?? ""),
    atomic_visual_key: value.atomic_visual_key ?? value.atomicVisualKey ?? "",
    mime_type: value.mime_type ?? value.mimeType,
    width: value.width,
    height: value.height,
    alpha: value.alpha, transparency_requirements: value.transparency_requirements,
    share_id: value.share_id ?? value.shareId,
    // 比较合同身份时按项目物理路径归一化；非法路径仍保留原值，交由校验器输出具体错误。
    source_file: normalizeProjectRelativePath(sourceFile) ?? sourceFile,
    runtime_file: normalizeProjectRelativePath(runtimeFile) ?? runtimeFile,
    atlas_slice: normalizeAtlasSlice(value.atlas_slice ?? value.atlasSlice),
    ...(value.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(value.nine_slice, "expected_assets.nine_slice") } : {}),
  };
}

/** 规范化交互热区；热区是输入命中合同，不得携带视觉资产身份。 */
export function normalizeInteractionHotspot(value) {
  if (!isObject(value)) return { hotspot_id: "", component_id: "", placement_id: "", bounds: null };
  const bounds = isObject(value.bounds) ? value.bounds : {};
  return {
    hotspot_id: value.hotspot_id ?? value.hotspotId ?? "",
    component_id: value.component_id ?? value.componentId ?? "",
    placement_id: value.placement_id ?? value.placementId ?? "",
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

/** 将视觉合同按语义键排序，供 Implementation Package 做与 JSON 插入顺序无关的精确比较。 */
export function normalizeVisualComponentContract(value = {}) {
  const canonical = normalizeVisualRegionDefinition(value);
  const stateAnalysis = normalizeStateAnalysis(canonical.state_analysis ?? {});
  stateAnalysis.states.sort((left, right) => left.canonical_state_id.localeCompare(right.canonical_state_id));
  const componentInventory = normalizeComponentInventory(canonical.component_inventory ?? {});
  componentInventory.components = componentInventory.components.map((component) => ({
    ...component,
    state_coverage: normalizeComponentStateCoverage(component).sort((left, right) => left.canonical_state_id.localeCompare(right.canonical_state_id)),
    placements: (Array.isArray(component.placements) ? component.placements : []).slice().sort((left, right) => left.placement_id.localeCompare(right.placement_id)),
  })).sort((left, right) => left.component_id.localeCompare(right.component_id));
  const expectedAssets = (Array.isArray(canonical.expected_assets) ? canonical.expected_assets : [])
    .map(normalizeComponentExpectedAsset)
    .sort((left, right) => `${left.component_id}\0${left.canonical_state_id}\0${left.asset_id}`.localeCompare(`${right.component_id}\0${right.canonical_state_id}\0${right.asset_id}`));
  const interactionHotspots = (Array.isArray(canonical.interaction_hotspots) ? canonical.interaction_hotspots : [])
    .map(normalizeInteractionHotspot)
    .sort((left, right) => `${left.component_id}\0${left.placement_id}\0${left.hotspot_id}`.localeCompare(`${right.component_id}\0${right.placement_id}\0${right.hotspot_id}`));
  const atomicImageRequirements = normalizeAtomicImageRequirements(canonical.atomic_image_requirements);
  const runtimeImplementation = canonical.runtime_implementation ?? null;
  return {
    asset_id: canonical.asset_id ?? null,
    asset_ids: Array.isArray(canonical.asset_ids) ? canonical.asset_ids.slice().sort() : null,
    state_analysis: stateAnalysis,
    component_inventory: componentInventory,
    expected_assets: expectedAssets,
    interaction_hotspots: interactionHotspots,
    atomic_image_requirements: atomicImageRequirements,
    // runtime_implementation 也属于执行包必须镜像的生产合同，不能只替换实现文件而绕过审计。
    runtime_implementation: runtimeImplementation,
  };
}

/** 返回实施包与 coverage 之间发生漂移的合同段；排序差异不会被视为漂移。 */
export function visualComponentContractDifferences(left, right) {
  const leftValue = normalizeVisualComponentContract(left);
  const rightValue = normalizeVisualComponentContract(right);
  return ["asset_id", "asset_ids", "state_analysis", "component_inventory", "expected_assets", "interaction_hotspots", "atomic_image_requirements", "runtime_implementation"]
    .filter((field) => canonicalJson(leftValue[field]) !== canonicalJson(rightValue[field]));
}

/** 规范化部件级状态覆盖；缺省时由区域状态分析继承。 */
function normalizeComponentStateCoverage(component) {
  const items = Array.isArray(component?.state_coverage) ? component.state_coverage : [];
  return items.map((item) => ({
    state_id: item?.state_id ?? item?.stateId ?? "",
    canonical_state_id: canonicalStateId(item?.state_id ?? item?.stateId),
    requirement: item?.requirement ?? item?.applicability ?? "",
    reason: item?.reason ?? item?.rationale ?? "",
  }));
}

/** 读取状态分析中的每个状态，并确保 required/not-applicable 语义明确。 */
function validateStateList(states, context, errors, scope = "state_analysis") {
  const seen = new Set();
  for (const [index, state] of states.entries()) {
    const stateId = state.canonical_state_id || canonicalStateId(state.state_id);
    const local = { ...context, state_id: stateId || "?" };
    const fail = (message, details = {}) => errors.push(componentError(local, `${scope}[${index}] ${message}`, { ...details, stateId: stateId || "?" }));
    if (!nonEmptyString(state.state_id)) fail("缺少 state_id", { missing: `${scope}[${index}].state_id` });
    if (!stateId) continue;
    if (seen.has(stateId)) fail("canonical state_id 重复");
    seen.add(stateId);
    if (!REQUIREMENTS.has(state.requirement)) fail("requirement 必须为 required 或 not-applicable", { missing: `${scope}[${index}].requirement` });
    if (!nonEmptyString(state.reason)) fail("required/not-applicable 都必须填写 reason", { missing: `${scope}[${index}].reason` });
  }
  return seen;
}

/** 校验区域是否完成状态分析，并覆盖常见游戏状态的适用性判定。 */
function validateStateAnalysis(region, context, errors, options = {}) {
  const analysis = normalizeStateAnalysis(region.state_analysis ?? region.stateAnalysis);
  const fail = (message, details = {}) => errors.push(componentError(context, `state_analysis ${message}`, details));
  if (!isObject(region.state_analysis ?? region.stateAnalysis)) {
    fail("必须在拆解组件前存在，不能以 default 掩盖状态缺失", { missing: "state_analysis" });
    return { analysis, requirements: new Map() };
  }
  if (analysis.status !== "complete") fail("status 必须为 complete", { missing: "state_analysis.status=complete" });
  if (analysis.phase !== "before-component-splitting") fail("phase 必须为 before-component-splitting，先状态分析再拆解", { missing: "state_analysis.phase" });
  if (!nonEmptyString(analysis.evidence)) fail("缺少分析证据", { missing: "state_analysis.evidence" });
  for (const field of ["analysis_id", "completed_at"]) if (!nonEmptyString(analysis[field])) fail(`缺少 ${field}`, { missing: `state_analysis.${field}` });
  if (nonEmptyString(analysis.completed_at) && Number.isNaN(Date.parse(analysis.completed_at))) fail("completed_at 必须是可解析时间", { missing: "state_analysis.completed_at" });
  if (!Array.isArray(analysis.states) || analysis.states.length === 0) {
    fail("states 必须是非空列表，不能只声明 default", { missing: "state_analysis.states" });
    return { analysis, requirements: new Map() };
  }
  const seen = validateStateList(analysis.states, context, errors);
  const requirements = new Map(analysis.states.map((state) => [state.canonical_state_id, state.requirement]));
  for (const standard of STANDARD_VISUAL_STATES) {
    if (!seen.has(standard.id)) fail(`缺少 ${standard.id} 状态分析；若不适用必须写 not-applicable+reason`, { stateId: standard.id, missing: `state_analysis.states.${standard.id}` });
  }
  return { analysis, requirements };
}

/** 只接受有限且具有正面积的矩形，避免无效几何进入包含关系判断。 */
function validRectangle(bounds) {
  return isObject(bounds) && ["x", "y", "width", "height"].every((field) => typeof bounds[field] === "number" && Number.isFinite(bounds[field]))
    && bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0;
}

/** 严格检查正面积矩形的包含关系，允许贴边但不允许越过父区域。 */
function rectangleContains(parent, child) {
  return validRectangle(parent) && validRectangle(child)
    && child.x >= parent.x && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

/** 校验唯一原子部件、可见实例 placement、数量和图集开关。 */
function validateInventory(region, context, errors, options = {}, canonicalRegion = normalizeVisualRegionDefinition(region)) {
  const nested = region.production_contract ?? region.productionContract;
  const raw = region.component_inventory ?? region.componentInventory ?? nested?.component_inventory ?? nested?.componentInventory;
  const inventory = normalizeComponentInventory(raw ?? {});
  const fail = (message, details = {}) => errors.push(componentError(context, `component_inventory ${message}`, details));
  if (!isObject(raw)) {
    fail("必须存在，annotation 编号不是资产数量单位", { missing: "component_inventory" });
    return { inventory, components: [] };
  }
  if (!["reusable-component", "single-component"].includes(inventory.granularity)) fail("granularity 必须为 reusable-component 或 single-component", { missing: "component_inventory.granularity" });
  if (!Number.isInteger(inventory.component_count) || inventory.component_count <= 0) fail("component_count 必须是正整数", { missing: "component_inventory.component_count" });
  if (!Number.isInteger(inventory.visible_instance_count) || inventory.visible_instance_count <= 0) fail("visible_instance_count 必须是正整数", { missing: "component_inventory.visible_instance_count" });
  if (!Array.isArray(inventory.components) || inventory.components.length === 0) fail("components 必须是非空原子部件清单", { missing: "component_inventory.components" });
  if (Number.isInteger(inventory.component_count) && inventory.components.length !== inventory.component_count) fail("component_count 必须等于唯一 components.length", { expectedCount: inventory.component_count, observedCount: inventory.components.length });
  if (inventory.granularity === "single-component" && inventory.component_count !== 1) fail("single-component 只能声明一个部件", { expectedCount: 1, observedCount: inventory.component_count });
  if (!DELIVERY_MODES.has(inventory.delivery_mode)) fail("delivery_mode 必须为 individual 或 atlas", { missing: "component_inventory.delivery_mode" });
  if (typeof inventory.atlas_allowed !== "boolean") fail("atlas_allowed 必须显式为布尔值", { missing: "component_inventory.atlas_allowed" });
  if (!nonEmptyString(inventory.created_at) || Number.isNaN(Date.parse(inventory.created_at))) fail("created_at 必须是可解析时间", { missing: "component_inventory.created_at" });
  if (inventory.delivery_mode === "atlas" && inventory.atlas_allowed !== true) fail("atlas delivery 必须显式 atlas_allowed=true");
  if (inventory.delivery_mode === "individual" && inventory.atlas_allowed === true) fail("individual delivery 不得声明 atlas_allowed=true");
  const regionBounds = region.bounds;
  if (!validRectangle(regionBounds)) fail("region.bounds 必须是合法矩形，placement 不能脱离区域", { missing: "bounds" });
  const canvas = options.canvas;
  if (canvas && !validRectangle({ x: 0, y: 0, width: canvas.width, height: canvas.height })) fail("校验画布尺寸无效", { missing: "canvas" });
  const seenComponents = new Set(); const seenAtomicKeys = new Set(); const seenPlacements = new Set(); let placementCount = 0;
  for (const [index, component] of inventory.components.entries()) {
    const local = { ...context, component_id: component.component_id || "?" };
    const componentFail = (message, details = {}) => errors.push(componentError(local, `component_inventory.components[${index}] ${message}`, details));
    if (!nonEmptyString(component.component_id)) componentFail("缺少 component_id", { missing: `component_inventory.components[${index}].component_id` });
    if (seenComponents.has(component.component_id)) componentFail("component_id 重复，重复视觉必须使用 placements", { missing: component.component_id });
    seenComponents.add(component.component_id);
    if (!nonEmptyString(component.atomic_visual_key)) componentFail("缺少 atomic_visual_key", { missing: `component_inventory.components[${index}].atomic_visual_key` });
    if (seenAtomicKeys.has(component.atomic_visual_key)) componentFail("atomic_visual_key 重复，不能复制原子定义");
    seenAtomicKeys.add(component.atomic_visual_key);
    if (!nonEmptyString(component.role)) componentFail("缺少 role", { missing: `component_inventory.components[${index}].role` });
    if (typeof component.reusable !== "boolean") componentFail("reusable 必须显式为布尔值", { missing: `component_inventory.components[${index}].reusable` });
    const displayErrors = [];
    validateDisplayNodeRole({ ...component, owner_type: region.owner_type, region_layer: region.layer, visual_route_element_type: canonicalRegion.visual_route_analysis?.element_type }, displayErrors, `component ${component.component_id}`);
    for (const message of displayErrors) componentFail(message);
    if (component.nine_slice !== undefined && isNineSliceStretch(component.nine_slice)) {
      // 使用规范化区域的权威视觉路线，保证 V2/V3/V4 判定一致，不按 background 名称子串推断职责。
      const routeAnalysis = canonicalRegion.visual_route_analysis;
      const routeElementType = routeAnalysis?.element_type ?? routeAnalysis?.elementType;
      if (!isNineSliceStretchTargetAllowed({ ...component, element_type: component.element_type ?? "component", role: component.role, region_layer: region.layer, visual_route_element_type: routeElementType })) componentFail("九宫格 stretch 只能用于非背景图片或显式 Sprite 底板容器，不能用于纯结构容器");
      if (region.owner_type !== undefined && region.owner_type !== "fixed-production-visual") componentFail("九宫格 stretch 只能用于 fixed-production-visual 图片资产");
    }
    const rawComponent = Array.isArray(raw.components) ? raw.components[index] : null;
    if (isObject(rawComponent) && (Object.hasOwn(rawComponent, "interaction_required") || Object.hasOwn(rawComponent, "interactionRequired"))) componentFail("禁止旧的 component-level interaction_required，必须改为 placement.interaction_required");
    if (!Array.isArray(component.state_coverage) || component.state_coverage.length === 0) componentFail("state_coverage 必须显式覆盖区域全部状态", { missing: `component_inventory.components[${index}].state_coverage` });
    if (!Array.isArray(component.placements) || component.placements.length === 0) componentFail("placements 必须是非空可见实例列表", { missing: `component_inventory.components[${index}].placements` });
    placementCount += Array.isArray(component.placements) ? component.placements.length : 0;
    for (const [placementIndex, placement] of (component.placements ?? []).entries()) {
      const placementLocal = { ...local, component_id: component.component_id || "?" };
      const placementFail = (message, details = {}) => errors.push(componentError(placementLocal, `placements[${placementIndex}] ${message}`, { ...details, missing: details.missing ?? `component_inventory.components[${index}].placements[${placementIndex}]` }));
      if (!nonEmptyString(placement.placement_id)) placementFail("缺少 placement_id");
      if (seenPlacements.has(placement.placement_id)) placementFail("placement_id 必须在区域内唯一");
      seenPlacements.add(placement.placement_id);
      if (!validRectangle(placement.bounds)) placementFail("bounds 必须是合法非负矩形");
      else if (!rectangleContains(regionBounds, placement.bounds)) placementFail("bounds 必须位于 region.bounds 内");
      else if (canvas && !rectangleContains({ x: 0, y: 0, width: canvas.width, height: canvas.height }, placement.bounds)) placementFail("bounds 必须位于画布内");
      if (placement.nine_slice !== undefined && !equalNineSliceContracts(component.nine_slice, placement.nine_slice)) placementFail("nine_slice 决策必须与同一原子 component 完全一致");
      const placementNineSlice = placement.nine_slice ?? component.nine_slice;
      if (isNineSliceStretch(placementNineSlice)) {
        try { validateNineSliceTargetBounds(placementNineSlice, placement.bounds, `component ${component.component_id}.placements[${placementIndex}].bounds`); }
        catch (error) { placementFail(`九宫格显示尺寸无效：${error.message}`); }
      }
      if (typeof placement.interaction_required !== "boolean") placementFail("interaction_required 必须显式为布尔值");
    }
  }
  if (Number.isInteger(inventory.visible_instance_count) && placementCount !== inventory.visible_instance_count) fail("visible_instance_count 必须等于全部 placement 数量", { expectedCount: inventory.visible_instance_count, observedCount: placementCount });
  // 结构不完整时也必须返回可继续审计的空 placement 集合，不能让验证器因缺字段抛 TypeError。
  return { inventory, components: inventory.components, placementById: new Map(inventory.components.flatMap((component) => (component.placements ?? []).map((placement) => [placement.placement_id, { ...placement, component_id: component.component_id }]))), componentById: new Map(inventory.components.map((component) => [component.component_id, component])) };
}

/** 验证图集切片的最小几何元数据，防止横向组图被无切片声明地复用。 */
function validateAtlasSlice(asset, context, errors, index) {
  const slice = asset.atlas_slice;
  const fail = (message, details = {}) => errors.push(componentError(context, `expected_assets[${index}] atlas_slice ${message}`, details));
  if (!isObject(slice)) { fail("必须存在，组图只有在完整切片合同下才可使用", { missing: `expected_assets[${index}].atlas_slice` }); return; }
  for (const [field, camel] of [["atlas_asset_id", "atlasAssetId"], ["slice_id", "sliceId"]]) if (!nonEmptyString(slice[field] ?? slice[camel])) fail(`缺少 ${field}`, { missing: `expected_assets[${index}].atlas_slice.${field}` });
  const rect = isObject(slice.rect) ? slice.rect : slice;
  const atlasSize = slice.atlas_size;
  if (nonEmptyString(asset.asset_id) && nonEmptyString(slice.atlas_asset_id) && asset.asset_id !== slice.atlas_asset_id) fail("atlas_asset_id 必须等于 expected_assets.asset_id", { missing: "atlas_asset_id" });
  for (const field of ["x", "y", "width", "height"]) if (typeof rect[field] !== "number" || !Number.isFinite(rect[field]) || (field === "x" || field === "y") && rect[field] < 0 || (field === "width" || field === "height") && rect[field] <= 0) fail(`缺少有效 ${field}`, { missing: `expected_assets[${index}].atlas_slice.${field}` });
  for (const field of ["width", "height"]) if (typeof atlasSize?.[field] !== "number" || !Number.isFinite(atlasSize[field]) || atlasSize[field] <= 0) fail(`缺少有效 atlas_size.${field}`, { missing: `expected_assets[${index}].atlas_slice.atlas_size.${field}` });
  if ([rect.x, rect.y, rect.width, rect.height, atlasSize?.width, atlasSize?.height].every((value) => typeof value === "number" && Number.isFinite(value))) {
    if (rect.x < 0 || rect.y < 0) fail("rect x/y 必须大于等于 0", { missing: "atlas_slice.rect" });
    if (rect.x + rect.width > atlasSize.width || rect.y + rect.height > atlasSize.height) fail("rect 不得越过 atlas_size 边界", { missing: "atlas_slice.atlas_size" });
  }
}

/** 校验区域内每个 component×required state 恰好绑定独立资产或合法图集切片。 */
function validateAssetMappings(region, context, errors, stateInfo, inventoryInfo) {
  const canonical = normalizeVisualRegionDefinition(region);
  const rawExpected = region.expected_assets ?? region.expectedAssets
    ?? region.production_contract?.expected_assets ?? region.production_contract?.expectedAssets
    ?? region.productionContract?.expected_assets ?? region.productionContract?.expectedAssets;
  const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map(normalizeComponentExpectedAsset) : [];
  const fail = (message, details = {}) => errors.push(componentError(context, message, details));
  if (!expected.length) { fail("expected_assets 必须是非空部件资产列表", { missing: "expected_assets" }); return; }
  const componentIds = new Set(inventoryInfo.components.map((component) => component.component_id));
  const requirementFor = new Map(stateInfo.requirements);
  const pairs = new Map();
  const duplicateIds = new Map();
  const duplicateFiles = new Map();
  const atlasSlices = new Map();
  const atlasPairSlices = new Map();
  const atlasRectsByAsset = new Map();
  for (const [index, asset] of expected.entries()) {
    const rawAsset = Array.isArray(rawExpected) ? rawExpected[index] : null;
    const componentId = asset.component_id;
    const stateId = asset.canonical_state_id || canonicalStateId(asset.state_id);
    const local = { ...context, component_id: componentId || "?", state_id: stateId || "?" };
    const assetFail = (message, details = {}) => errors.push(componentError(local, `expected_assets[${index}] ${message}`, details));
    if (hasShareAliasConflict(rawAsset)) assetFail("share_id 与 shareId 不得同时声明", { missing: `expected_assets[${index}].share_id` });
    if (!nonEmptyString(asset.asset_id)) assetFail("缺少 asset_id", { missing: `expected_assets[${index}].asset_id` });
    if (!nonEmptyString(componentId) || !componentIds.has(componentId)) assetFail("component_id 必须映射 component_inventory", { missing: `expected_assets[${index}].component_id` });
    if (!stateId || !requirementFor.has(stateId)) assetFail("state_id 必须映射 state_analysis", { missing: `expected_assets[${index}].state_id` });
    const component = inventoryInfo.componentById?.get(componentId);
    if (component && !equalNineSliceContracts(component.nine_slice, asset.nine_slice)) assetFail("nine_slice 必须与 component_inventory 的冻结决策完全一致");
    if (asset.asset_scope !== "atomic-component") assetFail("asset_scope 必须为 atomic-component，禁止 region-composite/group/composite 输出", { missing: `expected_assets[${index}].asset_scope` });
    if (!nonEmptyString(asset.atomic_visual_key)) assetFail("缺少 atomic_visual_key", { missing: `expected_assets[${index}].atomic_visual_key` });
    else if (component && asset.atomic_visual_key !== component.atomic_visual_key) assetFail("atomic_visual_key 必须匹配唯一 component", { missing: component.atomic_visual_key });
    if (isHitAreaKind(asset.asset_kind)) assetFail("交互热区不能计入视觉资产");
    if (stateId && requirementFor.get(stateId) === "not-applicable") assetFail("not-applicable 状态不得交付视觉资产");
    if (asset.mime_type !== undefined && (!nonEmptyString(asset.mime_type) || !/^[^/\s]+\/[^/\s]+$/.test(asset.mime_type))) assetFail("mime_type 格式无效", { missing: `expected_assets[${index}].mime_type` });
    if (canonical.production_method === "image-generation" || canonical.image_generation_required === true) for (const violation of collectImageGenerationRasterViolations(rawAsset ?? asset, { requiredMime: true, requiredFileFields: ["source_file", "runtime_file"], fileFields: ["source_file", "runtime_file"] })) assetFail(`${violation.field} ${violation.message}`, { missing: `expected_assets[${index}].${violation.field}` });
    for (const field of ["width", "height"]) if (asset[field] !== undefined && (!Number.isInteger(asset[field]) || asset[field] <= 0)) assetFail(`${field} 必须为正整数`, { missing: `expected_assets[${index}].${field}` });
    if (asset.alpha !== undefined && typeof asset.alpha !== "boolean") assetFail("alpha 必须为布尔值", { missing: `expected_assets[${index}].alpha` });
    const key = `${componentId}\0${stateId}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    duplicateIds.set(asset.asset_id, (duplicateIds.get(asset.asset_id) ?? 0) + 1);
    for (const [field, file] of [["source_file", asset.source_file], ["runtime_file", asset.runtime_file]].filter(([, file]) => nonEmptyString(file))) {
      const normalizedFile = normalizeProjectRelativePath(file);
      if (!normalizedFile) assetFail(`${field} 必须是项目内相对路径，不能使用绝对路径或路径逃逸`, { missing: `expected_assets[${index}].${field}` });
      else duplicateFiles.set(normalizedFile, (duplicateFiles.get(normalizedFile) ?? 0) + 1);
    }
    if (inventoryInfo.inventory.delivery_mode === "atlas") {
      validateAtlasSlice(asset, local, errors, index);
      const slice = asset.atlas_slice;
      if (slice) {
        const sliceKey = `${slice.atlas_asset_id}\0${slice.slice_id}`;
        const pairKey = `${componentId}\0${stateId}`;
        if (atlasSlices.has(sliceKey)) assetFail("atlas_slice identity 不能被多个 component/state 复用", { missing: sliceKey });
        if (atlasPairSlices.has(pairKey)) assetFail("component×state 不能绑定多个 atlas_slice", { expectedCount: 1, observedCount: 2 });
        atlasSlices.set(sliceKey, index);
        atlasPairSlices.set(pairKey, index);
        const rect = slice.rect;
        if ([rect?.x, rect?.y, rect?.width, rect?.height].every((value) => typeof value === "number" && Number.isFinite(value))) {
          const atlasRects = atlasRectsByAsset.get(slice.atlas_asset_id) ?? [];
          for (const previous of atlasRects) {
            const sameRect = rect.x === previous.rect.x && rect.y === previous.rect.y && rect.width === previous.rect.width && rect.height === previous.rect.height;
            const overlaps = rect.x < previous.rect.x + previous.rect.width && previous.rect.x < rect.x + rect.width
              && rect.y < previous.rect.y + previous.rect.height && previous.rect.y < rect.y + rect.height;
            if (sameRect) assetFail("同一 atlas 内 rect 不能完全相同", { missing: `${slice.atlas_asset_id}:${previous.sliceId}` });
            else if (overlaps) assetFail("同一 atlas 内 atlas_slice rect 不能重叠", { missing: `${slice.atlas_asset_id}:${previous.sliceId}` });
          }
          atlasRects.push({ sliceId: slice.slice_id, rect });
          atlasRectsByAsset.set(slice.atlas_asset_id, atlasRects);
        }
      }
    }
  }
  const requiredPairs = [];
  for (const component of inventoryInfo.components) {
    const componentStates = normalizeComponentStateCoverage(component);
    const requirements = componentStates.length ? new Map(componentStates.map((state) => [state.canonical_state_id, state.requirement])) : requirementFor;
    if (componentStates.length) {
      // 一旦声明组件级覆盖，就必须逐项覆盖区域分析，不能用部分列表静默掩盖 selected/win/lose 等状态。
      for (const [stateId, regionRequirement] of requirementFor) {
        if (!requirements.has(stateId)) errors.push(componentError({ ...context, component_id: component.component_id, state_id: stateId }, "component state_coverage 必须覆盖区域 state_analysis 的全部状态", { missing: "component_inventory.components.state_coverage" }));
        else if (regionRequirement === "required" && requirements.get(stateId) !== "required") errors.push(componentError({ ...context, component_id: component.component_id, state_id: stateId }, "component state_coverage 不得把区域 required 降为 not-applicable"));
      }
    }
    for (const [stateId, requirement] of requirements) {
      if (requirement === "required") requiredPairs.push({ componentId: component.component_id, stateId });
    }
    const coverageIds = new Set();
    for (const state of componentStates) {
      if (coverageIds.has(state.canonical_state_id)) errors.push(componentError({ ...context, component_id: component.component_id, state_id: state.canonical_state_id || "?" }, "component state_coverage state_id 重复"));
      coverageIds.add(state.canonical_state_id);
      if (!state.canonical_state_id || !requirementFor.has(state.canonical_state_id)) errors.push(componentError({ ...context, component_id: component.component_id, state_id: state.canonical_state_id || "?" }, "component state_coverage 必须映射区域 state_analysis", { missing: "state_analysis.states" }));
      if (!REQUIREMENTS.has(state.requirement) || !nonEmptyString(state.reason)) errors.push(componentError({ ...context, component_id: component.component_id, state_id: state.canonical_state_id || "?" }, "component state_coverage required/not-applicable 都必须有 reason", { missing: "component_inventory.components.state_coverage.reason" }));
      if (state.canonical_state_id && requirementFor.get(state.canonical_state_id) === "not-applicable" && state.requirement === "required") errors.push(componentError({ ...context, component_id: component.component_id, state_id: state.canonical_state_id }, "区域状态分析声明 not-applicable，部件不能改为 required"));
      if (state.canonical_state_id && state.requirement === "required" && !requiredPairs.some((pair) => pair.componentId === component.component_id && pair.stateId === state.canonical_state_id)) requiredPairs.push({ componentId: component.component_id, stateId: state.canonical_state_id });
    }
  }
  const requiredKeys = new Set(requiredPairs.map((pair) => `${pair.componentId}\0${pair.stateId}`));
  for (const pair of requiredPairs) {
    const key = `${pair.componentId}\0${pair.stateId}`;
    const observed = pairs.get(key) ?? 0;
    if (observed !== 1) errors.push(componentError(context, "每个 component×required state 必须恰好一个独立资产或图集切片", { componentId: pair.componentId, stateId: pair.stateId, expectedCount: 1, observedCount: observed, missing: observed === 0 ? `expected_assets.${pair.componentId}.${pair.stateId}` : undefined }));
  }
  for (const [key, observed] of pairs) if (!requiredKeys.has(key)) {
    const [componentId, stateId] = key.split("\0");
    errors.push(componentError(context, "expected_assets 包含未声明 required 的部件状态", { componentId, stateId, expectedCount: 0, observedCount: observed }));
  }
  for (const [assetId, count] of duplicateIds) {
    if (count > 1 && inventoryInfo.inventory.delivery_mode !== "atlas") errors.push(componentError(context, "individual delivery 不允许同一 asset_id 代表多个部件或状态；横向组图不能冒充原子资源", { expectedCount: 1, observedCount: count, missing: assetId }));
  }
  for (const [file, count] of duplicateFiles) {
    if (count > 1 && inventoryInfo.inventory.delivery_mode !== "atlas") errors.push(componentError(context, "individual delivery 不允许多个部件共享同一源/运行文件；请拆成独立资源", { expectedCount: 1, observedCount: count, missing: file }));
  }
}

/** 校验区域资产身份只表达原子资产集合，不允许编号级组合图绕过部件清单。 */
function validateRegionAssetIdentity(region, context, errors, inventoryInfo, expected) {
  const componentCount = inventoryInfo.inventory.component_count;
  const nested = region.production_contract ?? region.productionContract;
  const assetId = region.asset_id ?? region.assetId ?? nested?.asset_id ?? nested?.assetId;
  const rawAssetIds = region.asset_ids ?? region.assetIds ?? nested?.asset_ids ?? nested?.assetIds;
  const expectedIds = [...new Set(expected.map((asset) => asset.asset_id).filter(nonEmptyString))].sort();
  if (componentCount > 1) {
    if (nonEmptyString(assetId)) errors.push(componentError(context, "多组件区域禁止使用单一 region asset_id，必须登记 atomic asset_ids", { missing: "asset_ids" }));
    if (!Array.isArray(rawAssetIds)) errors.push(componentError(context, "多组件区域必须声明 asset_ids 原子资产列表", { missing: "asset_ids" }));
    else {
      const observedIds = [...new Set(rawAssetIds.filter(nonEmptyString))].sort();
      if (observedIds.length !== rawAssetIds.length || JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) errors.push(componentError(context, "asset_ids 必须精确等于 expected_assets 的去重原子 asset_id 集合", { missing: `expected=${expectedIds.join(",")},observed=${observedIds.join(",")}` }));
    }
  } else if (componentCount === 1 && nonEmptyString(assetId) && expectedIds.length === 1 && assetId !== expectedIds[0]) {
    errors.push(componentError(context, "单组件区域 asset_id 必须匹配唯一 atomic expected asset", { missing: expectedIds[0] }));
  }
}

/** 校验区域声明的生图需求必须等价于唯一 component×required state 的派生结果。 */
function validateAtomicImageRequirementContract(region, context, errors) {
  const nested = region.production_contract ?? region.productionContract;
  const raw = region.atomic_image_requirements ?? region.atomicImageRequirements
    ?? nested?.atomic_image_requirements ?? nested?.atomicImageRequirements;
  const derived = deriveAtomicImageRequirements(region);
  if (!Array.isArray(raw)) {
    errors.push(componentError(context, "atomic_image_requirements 必须显式登记，状态分析完成后直接生成", { missing: "atomic_image_requirements" }));
    return derived;
  }
  const normalized = normalizeAtomicImageRequirements(raw);
  const ids = new Set();
  for (const [index, requirement] of normalized.entries()) {
    const local = { ...context, component_id: requirement.component_id || "?", state_id: requirement.state_id || "?" };
    if (!nonEmptyString(requirement.requirement_id)) errors.push(componentError(local, `atomic_image_requirements[${index}] 缺少 requirement_id`, { missing: "requirement_id" }));
    if (ids.has(requirement.requirement_id)) errors.push(componentError(local, `atomic_image_requirements[${index}] requirement_id 重复`));
    ids.add(requirement.requirement_id);
  }
  if (!atomicImageRequirementsEqual(raw, derived)) errors.push(componentError(context, "atomic_image_requirements 必须与唯一 component×required state 派生结果精确等价", { missing: "atomic_image_requirements" }));
  return derived;
}

/** 校验交互热区与 interactive placement 的一一对应，热区只承载输入命中而不承载视觉资产。 */
function validateHotspots(region, context, errors, inventoryInfo) {
  const nested = region.production_contract ?? region.productionContract;
  const rawHotspots = region.interaction_hotspots ?? region.interactionHotspots
    ?? nested?.interaction_hotspots ?? nested?.interactionHotspots;
  if (rawHotspots === undefined) {
    errors.push(componentError(context, "interaction_hotspots 必须显式声明数组；缺失合同不能按无热区推断", { missing: "interaction_hotspots" }));
    return;
  }
  const hotspots = rawHotspots;
  if (!Array.isArray(hotspots)) { errors.push(componentError(context, "interaction_hotspots 必须是数组，且不计入 expected_assets")); return; }
  const components = inventoryInfo?.components ?? [];
  const placementById = inventoryInfo?.placementById ?? new Map();
  const ids = new Set(); const placementCounts = new Map();
  hotspots.forEach((rawHotspot, index) => {
    const hotspot = normalizeInteractionHotspot(rawHotspot);
    const local = { ...context, component_id: hotspot.component_id || "?" };
    if (!nonEmptyString(hotspot.hotspot_id)) errors.push(componentError(local, `interaction_hotspots[${index}] 缺少 hotspot_id`, { missing: `interaction_hotspots[${index}].hotspot_id` }));
    if (ids.has(hotspot.hotspot_id)) errors.push(componentError(local, `interaction_hotspots[${index}] hotspot_id 重复`));
    ids.add(hotspot.hotspot_id);
    if (!nonEmptyString(hotspot.placement_id)) errors.push(componentError(local, `interaction_hotspots[${index}] 缺少 placement_id`, { missing: "interaction_hotspots.placement_id" }));
    const placement = placementById.get(hotspot.placement_id);
    if (!placement || placement.component_id !== hotspot.component_id) errors.push(componentError(local, `interaction_hotspots[${index}] component_id/placement_id 悬空或不匹配`, { missing: "component_inventory.components.placements" }));
    if (isObject(rawHotspot) && (Object.hasOwn(rawHotspot, "asset_id") || Object.hasOwn(rawHotspot, "assetId"))) errors.push(componentError(local, `interaction_hotspots[${index}] 不得声明 asset_id`));
    const bounds = hotspot.bounds;
    if (!validRectangle(bounds) || !rectangleContains(region.bounds, bounds) || (placement && !rectangleContains(placement.bounds, bounds))) errors.push(componentError(local, `interaction_hotspots[${index}] bounds 必须位于 placement 和 region.bounds 内`, { missing: "interaction_hotspots.bounds" }));
    if (placement && placement.interaction_required !== true) errors.push(componentError(local, `interaction_hotspots[${index}] 非 interactive placement 不得绑定热区`));
    placementCounts.set(`${hotspot.component_id}\0${hotspot.placement_id}`, (placementCounts.get(`${hotspot.component_id}\0${hotspot.placement_id}`) ?? 0) + 1);
  });
  for (const component of components) for (const placement of component.placements ?? []) {
    const key = `${component.component_id}\0${placement.placement_id}`;
    const count = placementCounts.get(key) ?? 0;
    if (placement.interaction_required === true && count !== 1) errors.push(componentError({ ...context, component_id: component.component_id }, "interactive placement 必须且只能对应一个 hotspot", { expectedCount: 1, observedCount: count, missing: count === 0 ? "interaction_hotspots" : undefined }));
    if (placement.interaction_required === false && count > 0) errors.push(componentError({ ...context, component_id: component.component_id }, "非 interactive placement 不得绑定 hotspot", { expectedCount: 0, observedCount: count }));
  }
}

/** 校验一个 fixed-production-visual 区域的状态先行和原子资源合同。 */
export function validateVisualComponentContract(region, context = {}, options = {}) {
  const errors = [];
  const canonical = normalizeVisualRegionDefinition(region);
  errors.push(...validateFixedVisualProductionMethod(region, context));
  if (!isObject(region)) return errors;
  if (canonical.owner_type !== "fixed-production-visual") {
    if (["runtime-data", "runtime-rendered"].includes(canonical.owner_type)) {
      const implementation = canonical.runtime_implementation;
      const files = Array.isArray(implementation?.integration_files) ? implementation.integration_files : [];
      if (!isObject(implementation) || !["cocos-graphics", "runtime-program"].includes(implementation.kind)) errors.push(componentError(context, "runtime 逻辑必须声明 runtime_implementation，且 kind 必须为 cocos-graphics/runtime-program", { missing: "runtime_implementation" }));
      if (files.length === 0 || !files.every(nonEmptyString)) errors.push(componentError(context, "runtime_implementation.integration_files 必须是非空路径列表", { missing: "runtime_implementation.integration_files" }));
      const normalizedFiles = files.map(normalizeProjectRelativePath);
      if (normalizedFiles.some((file) => !file)) errors.push(componentError(context, "runtime_implementation.integration_files 必须是项目内相对路径", { missing: "runtime_implementation.integration_files" }));
      if (new Set(normalizedFiles.filter(Boolean)).size !== normalizedFiles.filter(Boolean).length) errors.push(componentError(context, "runtime_implementation.integration_files 不得重复同一物理路径"));
    }
    return errors;
  }
  // 固定视觉区域必须交付真实图片；程序绘制只负责热区、碰撞和布局等非图片逻辑。
  for (const conflict of getVisualRegionDefinitionAliasConflicts(region)) errors.push(componentError(context, `区域合同别名取值冲突：${conflict.field}`, { missing: conflict.sources.join("/") }));
  const stateInfo = validateStateAnalysis(canonical, context, errors, options);
  const inventoryInfo = validateInventory(region, context, errors, options, canonical);
  const analysisCompletedAt = Date.parse(stateInfo.analysis.completed_at);
  const inventoryCreatedAt = Date.parse(inventoryInfo.inventory.created_at);
  // 时间顺序是机器门：状态分析完成后才能建立部件清单，避免事后补写分析掩盖拆解粒度错误。
  if (!Number.isNaN(analysisCompletedAt) && !Number.isNaN(inventoryCreatedAt) && analysisCompletedAt >= inventoryCreatedAt) errors.push(componentError(context, "state_analysis.completed_at 必须早于 component_inventory.created_at，必须先完成状态分析再拆解", { missing: "state_analysis.completed_at<component_inventory.created_at" }));
  if (inventoryInfo.components.length > 0 && stateInfo.analysis.states.length > 0) {
    validateAssetMappings(region, context, errors, stateInfo, inventoryInfo);
    const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map(normalizeComponentExpectedAsset) : [];
    validateRegionAssetIdentity(region, context, errors, inventoryInfo, expected);
  }
  validateAtomicImageRequirementContract(region, context, errors);
  // 热区校验保留原始对象，才能识别 asset_id 等被规范化合同有意丢弃的越权字段。
  validateHotspots(region, context, errors, inventoryInfo);
  const productionMethod = canonical.production_method;
  const deliveryKind = canonical.delivery_kind;
  if (canonical.image_generation_required === true && (inventoryInfo.inventory.delivery_mode !== "individual" || inventoryInfo.inventory.atlas_allowed !== false)) errors.push(componentError(context, "图像生成 只能使用 individual 且 atlas_allowed=false，禁止组图/atlas", { missing: "component_inventory.delivery_mode=individual" }));
  if (canonical.image_generation_required === true && Array.isArray(canonical.expected_assets) && canonical.expected_assets.some((asset) => normalizeComponentExpectedAsset(asset).atlas_slice)) errors.push(componentError(context, "图像生成 expected_assets 不得携带 atlas_slice，禁止用图集替代独立位图"));
  if (["cocos-graphics", "runtime-program"].includes(productionMethod)) {
    const implementation = canonical.runtime_implementation;
    if (!isObject(implementation)) errors.push(componentError(context, `${productionMethod} 必须声明 runtime_implementation`, { missing: "runtime_implementation" }));
    else {
      if (implementation.kind !== productionMethod) errors.push(componentError(context, `runtime_implementation.kind 必须为 ${productionMethod}`, { missing: "runtime_implementation.kind" }));
      const integrationFiles = Array.isArray(implementation.integration_files) ? implementation.integration_files : [];
      if (integrationFiles.length === 0 || !integrationFiles.every(nonEmptyString)) errors.push(componentError(context, "runtime_implementation.integration_files 必须是非空路径列表", { missing: "runtime_implementation.integration_files" }));
      const seenIntegrationFiles = new Set();
      for (const file of integrationFiles) {
        const normalizedFile = normalizeProjectRelativePath(file);
        if (!normalizedFile) errors.push(componentError(context, "runtime_implementation.integration_files 必须是项目内相对路径，不能使用绝对路径或路径逃逸", { missing: file }));
        else if (seenIntegrationFiles.has(normalizedFile)) errors.push(componentError(context, "runtime_implementation.integration_files 不得重复同一物理路径", { missing: normalizedFile }));
        else seenIntegrationFiles.add(normalizedFile);
      }
    }
    if (Array.isArray(canonical.expected_assets) && canonical.expected_assets.some((asset) => { const item = normalizeComponentExpectedAsset(asset); return nonEmptyString(item.source_file) || nonEmptyString(item.runtime_file); })) errors.push(componentError(context, `${productionMethod} 不得伪造 source_file/runtime_file 图片输出`));
  } else if (["image-generation", "authored-raster", "authored-svg", "reuse"].includes(productionMethod)) {
    if (hasRuntimeImplementationField(region)) errors.push(componentError(context, `${productionMethod} 文件交付不得携带 runtime_implementation`, { missing: "runtime_implementation" }));
    const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map(normalizeComponentExpectedAsset) : [];
    if (expected.some((asset) => !nonEmptyString(asset.source_file) || !nonEmptyString(asset.runtime_file))) errors.push(componentError(context, "文件交付合同必须登记 source_file 与 runtime_file", { missing: "expected_assets.source_file/runtime_file" }));
  } else if (["raster-image", "vector-image"].includes(deliveryKind)) {
    const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map(normalizeComponentExpectedAsset) : [];
    if (expected.some((asset) => !nonEmptyString(asset.source_file) || !nonEmptyString(asset.runtime_file))) errors.push(componentError(context, "文件交付合同必须登记 source_file 与 runtime_file", { missing: "expected_assets.source_file/runtime_file" }));
  }
  if (options.requireImageAssets && canonical.image_generation_required === true && inventoryInfo.inventory.delivery_mode === "individual") {
    const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map(normalizeComponentExpectedAsset) : [];
    if (expected.some((asset) => !nonEmptyString(asset.source_file) || !nonEmptyString(asset.runtime_file))) errors.push(componentError(context, "图像生成 原子资产必须登记 source_file 与 runtime_file", { missing: "expected_assets.source_file/runtime_file" }));
  }
  return errors;
}

/** 读取 V3 正式 atlas 资产的登记尺寸，用于复核切片不能越界。 */
function resolveAtlasAssetSize(asset) {
  const output = isObject(asset?.output) ? asset.output : (isObject(asset?.output_metadata) ? asset.output_metadata : {});
  return { width: asset?.width ?? output.width, height: asset?.height ?? output.height };
}

/** 校验 V4 实际输出是否逐 component×state 覆盖 V3 合同。 */
export function validateComponentAuditEvidence(region, auditUnit, context = {}, options = {}) {
  const errors = [];
  const canonical = normalizeVisualRegionDefinition(region);
  if (!isObject(region) || canonical.owner_type !== "fixed-production-visual") return errors;
  const derivedRequirements = deriveAtomicImageRequirements(region);
  if (!atomicImageRequirementsEqual(canonical.atomic_image_requirements, derivedRequirements)) errors.push(componentError(context, "V3 atomic_image_requirements 与状态分析派生结果不一致", { missing: "atomic_image_requirements" }));
  const inventory = normalizeComponentInventory(canonical.component_inventory ?? {});
  const stateInfo = normalizeStateAnalysis(canonical.state_analysis ?? {});
  const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map(normalizeComponentExpectedAsset) : [];
  const placementIdsByComponent = new Map(inventory.components.map((component) => [component.component_id, (component.placements ?? []).map((placement) => placement.placement_id).sort()]));
  const actual = Array.isArray(auditUnit?.actual_assets) ? auditUnit.actual_assets : [];
  // V3 不能只相信区域的 production_method；实际资源记录也必须逐项拒绝程序绘制图片身份。
  errors.push(...validateFixedVisualProductionMethod({ ...region, actual_assets: actual, runtime_consumption: auditUnit?.runtime_consumption }, context));
  const required = [];
  for (const component of inventory.components) {
    const states = normalizeComponentStateCoverage(component);
    const map = states.length ? new Map(states.map((state) => [state.canonical_state_id, state.requirement])) : new Map(stateInfo.states.map((state) => [state.canonical_state_id, state.requirement]));
    for (const [stateId, requirement] of map) if (requirement === "required") required.push({ componentId: component.component_id, stateId });
  }
  const expectedByPair = new Map(expected.map((asset) => [`${asset.component_id}\0${asset.canonical_state_id}`, asset]));
  const actualPairs = new Map();
  const actualByPair = new Map();
  for (const [index, item] of actual.entries()) {
    const asset = normalizeComponentExpectedAsset(item);
    const actualFile = item?.file ?? item?.path ?? item?.output_file ?? item?.runtime_file ?? item?.runtimeFile ?? "";
    const local = { ...context, component_id: asset.component_id || "?", state_id: asset.canonical_state_id || "?", asset_id: asset.asset_id || item?.id || "?" };
    // V3 复核实际文件和组件状态；拆解确认已在 V2 唯一收敛，
    // 不再要求每个 actual asset 复制 human_review。
    if (canonical.production_method === "image-generation" || canonical.image_generation_required === true) for (const violation of collectImageGenerationRasterViolations(item, { requiredMime: true, fileFields: ["file", "path", "runtime_file", "output_file"] })) errors.push(componentError(local, `actual_assets[${index}].${violation.field} ${violation.message}`));
    if (!nonEmptyString(asset.component_id) || !nonEmptyString(asset.state_id)) errors.push(componentError(local, `actual_assets[${index}] 必须绑定 component_id/state_id，不能只登记区域组图`, { missing: `actual_assets[${index}].component_id/state_id` }));
    const key = `${asset.component_id}\0${asset.canonical_state_id}`;
    actualPairs.set(key, (actualPairs.get(key) ?? 0) + 1);
    actualByPair.set(key, item);
    if (asset.asset_kind && isHitAreaKind(asset.asset_kind)) errors.push(componentError(local, `actual_assets[${index}] 交互热区不能作为视觉资产`));
    const expectedAsset = expectedByPair.get(key);
    if (expectedAsset && asset.asset_id !== expectedAsset.asset_id) errors.push(componentError(local, `actual_assets[${index}] asset_id 与 V3 expected_assets 不一致`, { missing: expectedAsset.asset_id }));
    if (expectedAsset && asset.asset_scope !== expectedAsset.asset_scope) errors.push(componentError(local, `actual_assets[${index}] asset_scope 与 V3 expected_assets 不一致`, { missing: expectedAsset.asset_scope || "atomic-component" }));
    if (expectedAsset && asset.atomic_visual_key !== expectedAsset.atomic_visual_key) errors.push(componentError(local, `actual_assets[${index}] atomic_visual_key 与 V3 expected_assets 不一致`, { missing: expectedAsset.atomic_visual_key }));
    if (expectedAsset?.runtime_file && !sameProjectPath(actualFile, expectedAsset.runtime_file)) errors.push(componentError(local, `actual_assets[${index}] 必须使用 V3 expected runtime_file，不能使用 source_file`, { missing: expectedAsset.runtime_file }));
    if (expectedAsset?.atlas_slice) {
      if (!asset.atlas_slice) errors.push(componentError(local, `actual_assets[${index}] 缺少与 V3 对应的 atlas_slice`, { missing: "atlas_slice" }));
      else if (JSON.stringify(asset.atlas_slice) !== JSON.stringify(expectedAsset.atlas_slice)) errors.push(componentError(local, `actual_assets[${index}] atlas_slice identity 与 V3 不一致`));
      const atlasSize = expectedAsset.atlas_slice.atlas_size;
      const formalAsset = options.manifestAssets instanceof Map ? options.manifestAssets.get(expectedAsset.asset_id) : null;
      const formalSize = resolveAtlasAssetSize(formalAsset);
      if (formalAsset && (!Number.isFinite(formalSize.width) || !Number.isFinite(formalSize.height) || formalSize.width <= 0 || formalSize.height <= 0)) errors.push(componentError(local, "V3 正式 atlas 资产缺少有效 width/height", { missing: `assets.${expectedAsset.asset_id}.width/height` }));
      else if (formalAsset && (formalSize.width !== atlasSize.width || formalSize.height !== atlasSize.height)) errors.push(componentError(local, "V3 atlas_size 与正式 atlas 资产尺寸不一致", { missing: `assets.${expectedAsset.asset_id}.width/height` }));
      const rect = expectedAsset.atlas_slice.rect;
      if (formalAsset && (rect.x + rect.width > formalSize.width || rect.y + rect.height > formalSize.height)) errors.push(componentError(local, "V3 atlas_slice rect 越过正式 atlas 资产边界", { missing: `assets.${expectedAsset.asset_id}.width/height` }));
    }
  }
  const actualSlices = new Map();
  for (const [index, item] of actual.entries()) {
    const slice = normalizeComponentExpectedAsset(item).atlas_slice;
    if (!slice) continue;
    const sliceKey = `${slice.atlas_asset_id}\0${slice.slice_id}`;
    if (actualSlices.has(sliceKey)) errors.push(componentError(context, `actual_assets[${index}] atlas_slice 与其他部件重复`, { missing: sliceKey }));
    actualSlices.set(sliceKey, index);
  }
  for (const pair of required) {
    const key = `${pair.componentId}\0${pair.stateId}`;
    const observed = actualPairs.get(key) ?? 0;
    if (observed !== 1) errors.push(componentError(context, "V3 actual_assets 必须逐 component×state 一一对应", { componentId: pair.componentId, stateId: pair.stateId, expectedCount: 1, observedCount: observed, missing: observed === 0 ? "actual_assets" : undefined }));
  }
  if (actual.length !== required.length) errors.push(componentError(context, "V3 actual_assets 总数量必须等于所有 required component×state", { expectedCount: required.length, observedCount: actual.length }));
  // V3 确认资源和组件产物；逐部件 runtime_consumption 只证明 V4 正式 Scene 接入。
  if (context.stage === "V4") {
  const usages = auditUnit?.runtime_consumption?.component_usages ?? auditUnit?.runtime_consumption?.componentUsages;
  if (!Array.isArray(usages)) errors.push(componentError(context, "V4 runtime_consumption 必须逐部件登记 component_usages", { missing: "runtime_consumption.component_usages" }));
  else {
    const usagePairs = new Map();
    usages.forEach((usage, index) => {
      const componentId = usage?.component_id ?? usage?.componentId ?? "";
      const stateId = canonicalStateId(usage?.state_id ?? usage?.stateId);
      const local = { ...context, component_id: componentId || "?", state_id: stateId || "?" };
      if (canonical.production_method === "image-generation" || canonical.image_generation_required === true) for (const violation of collectImageGenerationRasterViolations(usage, { fileFields: ["runtime_file"] })) errors.push(componentError(local, `runtime_consumption.component_usages[${index}].${violation.field} ${violation.message}`));
      if (usage?.status !== "passed" && usage?.status !== "consumed") errors.push(componentError(local, `runtime_consumption.component_usages[${index}] status 必须为 passed/consumed`));
      const key = `${componentId}\0${stateId}`;
      const expectedAsset = expectedByPair.get(key);
      const assetId = usage?.asset_id ?? usage?.assetId;
      if (!nonEmptyString(assetId)) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] 缺少 asset_id，运行时消费不能只绑定 component/state`, { missing: "runtime_consumption.component_usages.asset_id" }));
      else if (expectedAsset && assetId !== expectedAsset.asset_id) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] asset_id 与 V3 expected_assets 不一致`, { missing: expectedAsset.asset_id }));
      const runtimeFile = usage?.runtime_file ?? usage?.runtimeFile ?? "";
      const expectedPlacementIds = placementIdsByComponent.get(componentId) ?? [];
      const observedPlacementIds = Array.isArray(usage?.placement_ids) ? usage.placement_ids.slice().sort() : (Array.isArray(usage?.placementIds) ? usage.placementIds.slice().sort() : null);
      if (!observedPlacementIds || JSON.stringify(observedPlacementIds) !== JSON.stringify(expectedPlacementIds)) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] placement_ids 必须精确覆盖该 component 的全部可见 placement`, { missing: expectedPlacementIds.join(",") || "placement_ids" }));
      if (!nonEmptyString(runtimeFile)) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] 缺少 runtime_file`, { missing: "runtime_file" }));
      if (expectedAsset?.runtime_file && !sameProjectPath(runtimeFile, expectedAsset.runtime_file)) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] runtime_file 与 V3 expected 不一致`, { missing: expectedAsset.runtime_file }));
      const actualItem = actualByPair.get(key);
      const actualItemFile = actualItem?.file ?? actualItem?.path ?? actualItem?.output_file ?? actualItem?.runtime_file ?? actualItem?.runtimeFile ?? "";
      if (actualItem && !sameProjectPath(runtimeFile, actualItemFile)) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] runtime_file 与 actual_assets 不一致`, { missing: actualItemFile || "actual_assets.file" }));
      if (expectedAsset?.atlas_slice) {
        const usageSlice = normalizeAtlasSlice(usage?.atlas_slice ?? usage?.atlasSlice);
        if (!usageSlice) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] 缺少 V3 对应 atlas_slice`, { missing: "atlas_slice" }));
        else if (JSON.stringify(usageSlice) !== JSON.stringify(expectedAsset.atlas_slice)) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] atlas_slice identity 与 V3 不一致`));
      } else if (usage?.atlas_slice ?? usage?.atlasSlice) errors.push(componentError(local, `runtime_consumption.component_usages[${index}] 不得为 individual 资产附加 atlas_slice`));
      usagePairs.set(key, (usagePairs.get(key) ?? 0) + 1);
    });
    for (const pair of required) {
      const key = `${pair.componentId}\0${pair.stateId}`;
      const observed = usagePairs.get(key) ?? 0;
      if (observed !== 1) errors.push(componentError(context, "runtime_consumption.component_usages 必须覆盖每个 required component×state", { componentId: pair.componentId, stateId: pair.stateId, expectedCount: 1, observedCount: observed, missing: "runtime_consumption.component_usages" }));
    }
  }
  }
  // expected/actual 的 component 组合不一致时，继续返回具体 pair 错误供 F2 定位。
  if (expected.length > 0 && actual.length > 0) {
    const expectedKeys = new Set(expected.map((asset) => `${asset.component_id}\0${asset.canonical_state_id}`));
    for (const key of expectedKeys) if (!actualPairs.has(key)) {
      const [componentId, stateId] = key.split("\0");
      errors.push(componentError(context, "V3 实际输出缺少 expected_assets 部件状态", { componentId, stateId, expectedCount: 1, observedCount: 0, missing: "actual_assets" }));
    }
  }
  return errors;
}
