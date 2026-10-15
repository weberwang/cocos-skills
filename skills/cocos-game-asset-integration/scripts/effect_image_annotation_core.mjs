import { createHash } from "node:crypto";
import { deriveAtomicImageRequirements, normalizeAtomicComponents } from "../../cocos-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { annotationProductionContract, renderRasterAnnotation } from "./effect_image_raster.mjs";
import { buildDecompositionElements, decompositionElementIds } from "./decomposition-elements.mjs";
import { semanticGroupingDefinition } from "./semantic-grouping-contract.mjs";
import { normalizeUiLayout } from "./ui-layout-organization.mjs";
import { validateNineSliceContract } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";

/** 标注图使用的固定计划颜色，机器值与展示标签分离，便于审计和人工阅读。 */
export const PLAN_COLORS = { "generate-now": "#ef4444", "reuse-existing": "#22c55e", "runtime-program": "#3b82f6" };
/** 标注图使用的三类中文展示标签。 */
export const PLAN_LABELS = { "generate-now": "新建图片资产", "reuse-existing": "复用现有图片", "runtime-program": "程序绘制或动态逻辑" };
// 确认哈希覆盖所有会改变生产合同或拆解粒度的字段；自声明 production_method_changed 不能替代此不可变身份。
const REGION_DEFINITION_FIELDS = ["scene_id", "state_id", "layer", "bounds", "layout_node_ids", "decomposition_elements", "visual_route_analysis", "owner_type", "owner_id", "asset_id", "asset_ids", "production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "runtime_implementation", "state_analysis", "component_inventory", "expected_assets", "interaction_hotspots", "atomic_image_requirements", "ownership_evidence", "annotation_number", "implementation_plan"];

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 以稳定的键顺序序列化区域定义，避免属性插入顺序影响身份哈希。 */
function canonicalize(value) { if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`; if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`; const encoded = JSON.stringify(value); return encoded === undefined ? "null" : encoded; }
/** 别名冲突只比较业务语义，摘要元数据不能因缺失或更新而阻断验收。 */
function omitDigestFields(value) {
  if (Array.isArray(value)) return value.map(omitDigestFields);
  if (!isObject(value)) return value;
  const projected = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const tokens = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase().split(/[_-]+/);
    if (tokens.some((token) => ["sha1", "sha256", "hash", "fingerprint"].includes(token))) continue;
    projected[key] = omitDigestFields(nestedValue);
  }
  return projected;
}
const REGION_FIELD_ALIASES = Object.freeze({ scene_id: ["scene_id", "sceneId"], state_id: ["state_id", "stateId"], layer: ["layer"], bounds: ["bounds"], layout_node_ids: ["layout_node_ids", "layoutNodeIds"], decomposition_elements: ["decomposition_elements", "decompositionElements"], visual_route_analysis: ["visual_route_analysis", "visualRouteAnalysis"], owner_type: ["owner_type", "ownerType"], owner_id: ["owner_id", "ownerId"], asset_id: ["asset_id", "assetId"], asset_ids: ["asset_ids", "assetIds"], production_origin: ["production_origin", "productionOrigin"], production_method: ["production_method", "productionMethod"], delivery_kind: ["delivery_kind", "deliveryKind"], image_generation_required: ["image_generation_required", "imageGenerationRequired"], generation_record_required: ["generation_record_required", "generationRecordRequired"], substitution_policy: ["substitution_policy", "substitutionPolicy"], runtime_implementation: ["runtime_implementation", "runtimeImplementation"], state_analysis: ["state_analysis", "stateAnalysis"], component_inventory: ["component_inventory", "componentInventory"], expected_assets: ["expected_assets", "expectedAssets"], interaction_hotspots: ["interaction_hotspots", "interactionHotspots"], atomic_image_requirements: ["atomic_image_requirements", "atomicImageRequirements"], ownership_evidence: ["ownership_evidence", "ownershipEvidence"], annotation_number: ["annotation_number", "annotationNumber"], implementation_plan: ["implementation_plan", "implementationPlan"] });
const NESTED_CONTRACT_FIELDS = new Set(["production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "runtime_implementation", "state_analysis", "component_inventory", "expected_assets", "interaction_hotspots", "atomic_image_requirements"]);
const STATE_ALIASES = new Map([["default", "default"], ["normal", "default"], ["idle", "default"], ["selected", "selected"], ["select", "selected"], ["active", "active"], ["activated", "active"], ["disabled", "disabled"], ["disable", "disabled"], ["pressed", "pressed"], ["down", "pressed"], ["hover", "hover"], ["hovered", "hover"], ["over", "hover"], ["victory", "victory"], ["win", "victory"], ["won", "victory"], ["success", "victory"], ["defeat", "defeat"], ["lose", "defeat"], ["lost", "defeat"], ["failure", "defeat"], ["fail", "defeat"], ["paused", "paused"], ["pause", "paused"]]);
/** 将路径归一化为合同身份；非法路径保留原值，交给执行校验报告安全错误。 */
function normalizePathForDefinition(value) { if (typeof value !== "string") return value; const raw = value.trim().replaceAll("\\", "/"); if (raw.startsWith("/") || raw.startsWith("//") || /^[a-z]:\//i.test(raw)) return raw.toLowerCase(); const parts = []; for (const part of raw.split("/")) { if (!part || part === ".") continue; if (part === "..") { if (parts.length === 0) return raw.toLowerCase(); parts.pop(); } else parts.push(part); } return parts.length ? parts.join("/").toLowerCase() : raw.toLowerCase(); }
/** 统一状态别名，保证 stateAnalysis 与 state_analysis 计算同一份合同身份。 */
function canonicalStateForDefinition(value) { if (typeof value !== "string") return value; const normalized = value.trim().toLowerCase().replaceAll("_", "-"); return STATE_ALIASES.get(normalized) ?? normalized; }
/** 按已声明字段名取值，显式空值保留原意，避免回退覆盖用户决定。 */
function firstDefined(value, aliases, fallback = null) { if (!isObject(value)) return fallback; for (const alias of aliases) if (Object.hasOwn(value, alias)) return value[alias]; return fallback; }
/** 统一状态分析字段并排序状态身份，使不同书写顺序得到相同语义。 */
function normalizeStateAnalysisDefinition(value) { if (!isObject(value)) return value ?? null; const states = Array.isArray(value.states) ? value.states.map((state) => ({ state_id: canonicalStateForDefinition(firstDefined(state, ["state_id", "stateId"], "")), requirement: firstDefined(state, ["requirement", "applicability"], ""), reason: firstDefined(state, ["reason", "rationale"], "") })).sort((left, right) => String(left.state_id).localeCompare(String(right.state_id))) : []; return { status: firstDefined(value, ["status", "analysis_status"], ""), phase: firstDefined(value, ["phase", "analysis_phase"], ""), evidence: firstDefined(value, ["evidence", "analysis_evidence"], ""), evidence_sha256: firstDefined(value, ["evidence_sha256", "evidenceSha256"], ""), reference_target_sha256: firstDefined(value, ["reference_target_sha256", "referenceTargetSha256"], ""), analysis_id: firstDefined(value, ["analysis_id", "analysisId"], ""), completed_at: firstDefined(value, ["completed_at", "completedAt"], ""), states }; }
/** 规范化拆解元素身份，保留原序、父级、语义和 UI 职责以绑定确认哈希。 */
function normalizeDecompositionElementDefinition(value) {
  if (!isObject(value)) return value ?? null;
  const bounds = isObject(value.bounds ?? value.target_bounds ?? value.targetBounds) ? (value.bounds ?? value.target_bounds ?? value.targetBounds) : null;
  return {
    element_id: firstDefined(value, ["element_id", "elementId"], ""),
    element_type: firstDefined(value, ["element_type", "elementType", "type"], ""),
    role: firstDefined(value, ["role", "layout_role", "layoutRole", "node_type", "nodeType"], ""),
    bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
    scene_id: firstDefined(value, ["scene_id", "sceneId"], ""),
    state_id: firstDefined(value, ["state_id", "stateId"], ""),
    region_id: firstDefined(value, ["region_id", "regionId"], ""),
    component_id: firstDefined(value, ["component_id", "componentId"], ""),
    placement_id: firstDefined(value, ["placement_id", "placementId"], ""),
    parent_element_id: firstDefined(value, ["parent_element_id", "parentElementId"], null),
    semantic_grouping: semanticGroupingDefinition(firstDefined(value, ["semantic_grouping"], undefined)),
    ui_layout: normalizeUiLayout(firstDefined(value, ["ui_layout"], undefined)) ?? null,
    ...(value.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(value.nine_slice, "decomposition_elements.nine_slice") } : {}),
    ...(Object.hasOwn(value, "nine_slice_decision_required") ? { nine_slice_decision_required: value.nine_slice_decision_required } : {}),
    ...(firstDefined(value, ["owner_type", "ownerType"], null) !== null ? { owner_type: firstDefined(value, ["owner_type", "ownerType"], null) } : {}),
    ...(firstDefined(value, ["region_layer", "regionLayer"], null) !== null ? { region_layer: firstDefined(value, ["region_layer", "regionLayer"], null) } : {}),
    ...(firstDefined(value, ["visual_route_element_type", "visualRouteElementType"], null) !== null ? { visual_route_element_type: firstDefined(value, ["visual_route_element_type", "visualRouteElementType"], null) } : {}),
    empty_container: firstDefined(value, ["empty_container", "emptyContainer"], false),
  };
}
/** 归一化组件清单中的 placement 布局身份，使布局节点变化参与确认哈希。 */
function normalizeComponentInventoryDefinition(value) {
  if (!isObject(value)) return value ?? null;
  const components = (Array.isArray(value.components) ? value.components : []).map((component) => ({
    component_id: firstDefined(component, ["component_id", "componentId"], ""),
    atomic_visual_key: firstDefined(component, ["atomic_visual_key", "atomicVisualKey"], ""),
    role: firstDefined(component, ["role", "component_role"], ""),
    reusable: component?.reusable,
    parent_element_id: firstDefined(component, ["parent_element_id", "parentElementId"], null),
    semantic_grouping: semanticGroupingDefinition(firstDefined(component, ["semantic_grouping"], undefined)),
    ui_layout: normalizeUiLayout(firstDefined(component, ["ui_layout"], undefined)) ?? null,
    ...(component?.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(component.nine_slice, "component_inventory.nine_slice") } : {}),
    ...(Object.hasOwn(component ?? {}, "nine_slice_decision_required") ? { nine_slice_decision_required: component.nine_slice_decision_required } : {}),
    state_coverage: (Array.isArray(component?.state_coverage) ? component.state_coverage : (Array.isArray(component?.stateCoverage) ? component.stateCoverage : [])).map((state) => ({
      state_id: canonicalStateForDefinition(firstDefined(state, ["state_id", "stateId"], "")),
      requirement: firstDefined(state, ["requirement", "applicability"], ""),
      reason: firstDefined(state, ["reason", "rationale"], ""),
    })).sort((left, right) => String(left.state_id).localeCompare(String(right.state_id))),
    placements: (Array.isArray(component?.placements) ? component.placements : []).map((placement) => ({
      placement_id: firstDefined(placement, ["placement_id", "placementId"], ""),
      element_id: firstDefined(placement, ["element_id", "elementId"], null),
      layout_node_id: firstDefined(placement, ["layout_node_id", "layoutNodeId"], ""),
      parent_element_id: firstDefined(placement, ["parent_element_id", "parentElementId"], null),
      semantic_grouping: semanticGroupingDefinition(firstDefined(placement, ["semantic_grouping"], undefined)),
      ui_layout: normalizeUiLayout(firstDefined(placement, ["ui_layout"], undefined)) ?? null,
      interaction_required: firstDefined(placement, ["interaction_required", "interactionRequired"]),
      bounds: isObject(placement?.bounds) ? { x: placement.bounds.x, y: placement.bounds.y, width: placement.bounds.width, height: placement.bounds.height } : null,
      ...(placement?.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(placement.nine_slice, "component_inventory.placements.nine_slice") } : {}),
      ...(Object.hasOwn(placement ?? {}, "nine_slice_decision_required") ? { nine_slice_decision_required: placement.nine_slice_decision_required } : {}),
    })).sort((left, right) => String(left.placement_id).localeCompare(String(right.placement_id))),
  })).sort((left, right) => String(left.component_id).localeCompare(String(right.component_id)));
  return {
    granularity: firstDefined(value, ["granularity", "asset_granularity"], ""),
    component_count: firstDefined(value, ["component_count", "componentCount"]),
    visible_instance_count: firstDefined(value, ["visible_instance_count", "visibleInstanceCount"]),
    delivery_mode: firstDefined(value, ["delivery_mode", "deliveryMode", "asset_delivery_mode"], ""),
    atlas_allowed: firstDefined(value, ["atlas_allowed", "atlasAllowed"]),
    created_at: firstDefined(value, ["created_at", "createdAt"], ""),
    components,
  };
}
/** 保留图集尺寸及裁切区域，防止仅资源名相同就复用错误切片。 */
function normalizeAtlasSliceDefinition(value) { if (!isObject(value)) return value ?? null; const rect = isObject(value.rect) ? value.rect : value; const size = isObject(value.atlas_size ?? value.atlasSize) ? (value.atlas_size ?? value.atlasSize) : {}; return { atlas_asset_id: firstDefined(value, ["atlas_asset_id", "atlasAssetId"], ""), slice_id: firstDefined(value, ["slice_id", "sliceId"], ""), atlas_size: { width: size.width, height: size.height }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; }
/** 资产语义指纹保留透明路线和边缘事实，路线变更必须使旧确认失效。 */
function normalizeExpectedAssetDefinition(value) {
  if (typeof value === "string") return { asset_id: value };
  if (!isObject(value)) return { asset_id: "" };
  return {
    asset_id: firstDefined(value, ["asset_id", "id", "name", "file", "path"], ""), component_id: firstDefined(value, ["component_id", "componentId"], ""), state_id: canonicalStateForDefinition(firstDefined(value, ["state_id", "stateId"], "")), asset_kind: firstDefined(value, ["asset_kind", "assetKind", "kind"], "visual"), asset_scope: firstDefined(value, ["asset_scope", "assetScope"], ""), atomic_visual_key: firstDefined(value, ["atomic_visual_key", "atomicVisualKey"], ""), source_file: normalizePathForDefinition(firstDefined(value, ["source_file", "sourceFile", "file"], "")), runtime_file: normalizePathForDefinition(firstDefined(value, ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile"], "")), mime_type: firstDefined(value, ["mime_type", "mimeType"]), width: value.width, height: value.height, alpha: value.alpha, transparency_requirements: value.transparency_requirements ?? null, sha256: firstDefined(value, ["sha256", "file_sha256"]), share_id: firstDefined(value, ["share_id", "shareId"]), atlas_slice: normalizeAtlasSliceDefinition(value.atlas_slice ?? value.atlasSlice),
    ...(value.nine_slice !== undefined ? { nine_slice: validateNineSliceContract(value.nine_slice, "expected_assets.nine_slice") } : {}),
  };
}
/** 将热点身份和实际边界一起纳入拆解定义，避免交互区域静默漂移。 */
function normalizeHotspotDefinition(value) { if (!isObject(value)) return { hotspot_id: "", component_id: "", bounds: null }; const bounds = isObject(value.bounds) ? value.bounds : {}; return { hotspot_id: firstDefined(value, ["hotspot_id", "hotspotId"], ""), component_id: firstDefined(value, ["component_id", "componentId"], ""), placement_id: firstDefined(value, ["placement_id", "placementId"], ""), bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }; }
/** 统一原子资源的部件、状态、生产方式和消费路径，供确认身份核对。 */
function normalizeAtomicRequirementDefinition(value) { if (!isObject(value)) return { requirement_id: "" }; const placementIds = Array.isArray(value.placement_ids) ? value.placement_ids : (Array.isArray(value.placementIds) ? value.placementIds : []); return { requirement_id: firstDefined(value, ["requirement_id", "requirementId"], ""), annotation_number: firstDefined(value, ["annotation_number", "annotationNumber"], ""), region_id: firstDefined(value, ["region_id", "regionId"], ""), atomic_visual_key: firstDefined(value, ["atomic_visual_key", "atomicVisualKey"], ""), component_id: firstDefined(value, ["component_id", "componentId"], ""), state_id: canonicalStateForDefinition(firstDefined(value, ["state_id", "stateId"], "")), production_method: firstDefined(value, ["production_method", "productionMethod"], ""), delivery_kind: firstDefined(value, ["delivery_kind", "deliveryKind"], ""), asset_id: firstDefined(value, ["asset_id", "assetId"], ""), source_file: normalizePathForDefinition(firstDefined(value, ["source_file", "sourceFile"], "")), runtime_file: normalizePathForDefinition(firstDefined(value, ["runtime_file", "runtimeFile"], "")), placement_ids: placementIds.slice().sort() }; }
/** 归一化运行时实现的布局消费节点，防止只改运行时绑定却复用旧确认。 */
/** 原生外观参数参与确认身份，防止仅保留行为文件就绕过外观冻结。 */
function normalizeRuntimeImplementationDefinition(value) { if (!isObject(value)) return value ?? null; const integrationFiles = Array.isArray(value.integration_files) ? value.integration_files : (Array.isArray(value.integrationFiles) ? value.integrationFiles : []); const layoutNodeIds = Array.isArray(value.layout_node_ids) ? value.layout_node_ids : (Array.isArray(value.layoutNodeIds) ? value.layoutNodeIds : []); return { kind: value.kind ?? "", integration_files: integrationFiles.map(normalizePathForDefinition).sort(), layout_node_ids: layoutNodeIds.slice(), description: value.description ?? "", render_contract: value.render_contract ?? null }; }
/** 对布局节点数组和其他合同字段使用稳定语义，避免顺序差异绕过身份比较。 */
function semanticDefinitionValue(field, value) { if (field === "state_analysis") return normalizeStateAnalysisDefinition(value); if (field === "component_inventory") return normalizeComponentInventoryDefinition(value); if (field === "decomposition_elements") return Array.isArray(value) ? value.map(normalizeDecompositionElementDefinition) : value; if (field === "layout_node_ids") return Array.isArray(value) ? value.slice() : value; if (field === "asset_ids") return Array.isArray(value) ? value.slice().sort() : value; if (field === "expected_assets") return (Array.isArray(value) ? value.map(normalizeExpectedAssetDefinition) : []).sort((left, right) => `${left.component_id}\0${left.state_id}\0${left.asset_id}`.localeCompare(`${right.component_id}\0${right.state_id}\0${right.asset_id}`)); if (field === "interaction_hotspots") return (Array.isArray(value) ? value.map(normalizeHotspotDefinition) : []).sort((left, right) => `${left.component_id}\0${left.placement_id}\0${left.hotspot_id}`.localeCompare(`${right.component_id}\0${right.placement_id}\0${right.hotspot_id}`)); if (field === "atomic_image_requirements") return (Array.isArray(value) ? value.map(normalizeAtomicRequirementDefinition) : []).sort((left, right) => `${left.requirement_id}\0${left.component_id}\0${left.state_id}`.localeCompare(`${right.requirement_id}\0${right.component_id}\0${right.state_id}`)); if (field === "runtime_implementation") return normalizeRuntimeImplementationDefinition(value); return value; }
/** 收集区域与嵌套合同中的同义字段，后续须检出相互冲突的声明。 */
function regionFieldSources(region, field) { const sources = []; const aliases = REGION_FIELD_ALIASES[field] ?? [field]; for (const alias of aliases) if (isObject(region) && Object.hasOwn(region, alias)) sources.push({ source: alias, value: region[alias] }); if (NESTED_CONTRACT_FIELDS.has(field)) for (const nestedName of ["production_contract", "productionContract"]) { const nested = isObject(region?.[nestedName]) ? region[nestedName] : null; for (const alias of aliases) if (nested && Object.hasOwn(nested, alias)) sources.push({ source: `${nestedName}.${alias}`, value: nested[alias] }); } return sources; }
/** 返回验证器实际使用的规范化区域合同，哈希和执行门共用此语义。 */
export function normalizeVisualRegionDefinition(region = {}) { return Object.fromEntries(REGION_DEFINITION_FIELDS.map((field) => { const source = regionFieldSources(region, field)[0]; return [field, semanticDefinitionValue(field, source?.value ?? null)]; })); }
/** 检测 snake/camel/nested 三种写法是否同时出现且取值冲突。 */
export function getVisualRegionDefinitionAliasConflicts(region = {}) { const conflicts = []; for (const field of REGION_DEFINITION_FIELDS) { const sources = regionFieldSources(region, field); if (sources.length < 2) continue; const first = canonicalize(omitDigestFields(semanticDefinitionValue(field, sources[0].value))); if (sources.slice(1).some((entry) => canonicalize(omitDigestFields(semanticDefinitionValue(field, entry.value))) !== first)) conflicts.push({ field, sources: sources.map((entry) => entry.source) }); } return conflicts; }
/** 计算覆盖区域的稳定身份哈希；确认不参与哈希，避免确认内容自引用。 */
export function computeRegionDefinitionSha256(region) { return `sha256:${createHash("sha256").update(canonicalize(normalizeVisualRegionDefinition(region))).digest("hex")}`; }
/** 读取 PNG 元数据需要展示的稳定拆解元素列表；阶段 A 不冻结后置布局节点。 */
function metadataLayoutNodeIds(region) { return decompositionElementIds(buildDecompositionElements([region])); }
/** 将 placement 与布局节点一一配对并稳定排序，确保 PNG 元数据可逐项复核。 */
function metadataPlacementLayoutNodeIds(region) { const nested = isObject(region?.production_contract) ? region.production_contract : (isObject(region?.productionContract) ? region.productionContract : {}); const inventory = region?.component_inventory ?? region?.componentInventory ?? nested.component_inventory ?? nested.componentInventory; const components = Array.isArray(inventory?.components) ? inventory.components : []; return components.flatMap((component) => (Array.isArray(component?.placements) ? component.placements : []).map((placement) => ({ placement_id: placement.placement_id ?? placement.placementId, layout_node_id: placement.layout_node_id ?? placement.layoutNodeId ?? null }))).sort((left, right) => String(left.placement_id).localeCompare(String(right.placement_id))); }
/** 生成“左原图+右用户说明栏”的确定性 PNG；技术拆解合同另存于 proposal 文件。 */
export function renderEffectImageAnnotation(originalBytes, originalPath, canvas, regions) { const sortedRegions = regions.slice().sort((left, right) => left.annotation_number - right.annotation_number); const metadata = { regions: sortedRegions.map((region) => { const production = annotationProductionContract(region); const elements = buildDecompositionElements([region]); return { region_id: region.id, annotation_number: region.annotation_number, scene_id: region.scene_id, state_id: region.state_id, plan_mode: region.implementation_plan?.mode ?? "", summary: region.implementation_plan?.summary ?? "", production_method: production.production_method, production_origin: production.production_origin, delivery_kind: production.delivery_kind, production_label: production.label, region_definition_sha256: computeRegionDefinitionSha256(region), atomic_requirements_sha256: `sha256:${createHash("sha256").update(canonicalize(deriveAtomicImageRequirements(region))).digest("hex")}`, layout_node_ids: metadataLayoutNodeIds(region), decomposition_elements: elements, placement_ids: normalizeAtomicComponents(region).flatMap((component) => component.placements.map((placement) => placement.placement_id)).sort(), placement_layout_node_ids: metadataPlacementLayoutNodeIds(region), atomic_image_requirements: deriveAtomicImageRequirements(region) }; }) }; return renderRasterAnnotation(originalBytes, canvas, sortedRegions, metadata, PLAN_COLORS, PLAN_LABELS); }
