/**
 * V2 阶段 A 的拆解元素清单。
 *
 * 拆解元素是人工确认的事实；布局节点只是阶段 B 根据这些元素重新推导的
 * 几何结果。该模块不读取 layout_decomposition，避免两个阶段共享旧节点。
 */

import { normalizeSemanticGrouping, semanticGroupingOf, validateSemanticGrouping } from "./semantic-grouping-contract.mjs";
import { normalizeUiLayout, positionReferenceId, validateUiInteractionTree, validateUiLayout } from "./ui-layout-organization.mjs";
import { equalNineSliceContracts, isNineSliceStretch, isNineSliceStretchTargetAllowed, requiresNineSliceDecision, validateNineSliceContract, validateNineSliceTargetBounds } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";
import { deriveSpriteGeometry } from "../../cocos-game-ui-layout/scripts/sprite-layout-sizing.mjs";
import { hasSpriteRendering, isBackgroundDisplayNode, isSpriteContainer, validateDisplayNodeRole } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";

const CONTAINER_ROLES = new Set(["container", "parent", "group", "layout-container", "empty-container"]);

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 读取 snake_case/camelCase 字段。 */
function field(value, ...names) { for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name]; return undefined; }
/** 判断非空字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 判断有效正尺寸矩形。 */
function validBounds(value) { return isObject(value) && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key])) && value.width > 0 && value.height > 0; }
/** 复制边界，阻止 proposal 与 manifest 共享可变对象。 */
function copyBounds(value) { return { x: value.x, y: value.y, width: value.width, height: value.height }; }
/** 判断组件/节点是否显式声明容器角色，普通叶子不能因无子项变成空容器。 */
function explicitlyContainer(value) { const flag = field(value, "is_container", "isContainer", "container"); if (flag === true) return true; const role = field(value, "element_type", "elementType", "layout_role", "layoutRole", "node_type", "nodeType", "role"); return typeof role === "string" && CONTAINER_ROLES.has(role.trim().toLowerCase()); }
/** 读取区域已有的组件清单，不把 layout_node_ids 当成拆解元素来源。 */
function componentList(region) { const inventory = region?.component_inventory ?? region?.componentInventory ?? region?.production_contract?.component_inventory ?? region?.productionContract?.componentInventory; return Array.isArray(inventory?.components) ? inventory.components : []; }
/** 读取稳定父元素字段；父关系可由人工在 proposal 中明确声明。 */
function parentElementId(value) { return field(value, "parent_element_id", "parentElementId", "parent_id", "parentId"); }
/** 规范化一个人工声明的拆解元素。 */
function normalizeElement(element, region, index = 0) {
  const declaredType = field(element, "element_type", "elementType", "type"); const elementType = explicitlyContainer(element) ? "container" : "component";
  const componentId = field(element, "component_id", "componentId") ?? `${region.id}-component-${index + 1}`;
  const placementId = field(element, "placement_id", "placementId") ?? `${componentId}-placement-${index + 1}`;
  const bounds = field(element, "bounds", "target_bounds", "targetBounds");
  const semanticGrouping = field(element, "semantic_grouping");
  const uiLayout = field(element, "ui_layout");
  const role = field(element, "role", "layout_role", "layoutRole", "node_type", "nodeType") ?? (nonEmptyString(declaredType) ? declaredType : elementType);
  const routeAnalysis = field(region, "visual_route_analysis", "visualRouteAnalysis");
  const routeElementType = field(routeAnalysis, "element_type", "elementType");
  // 只按明确的生产归属与职责判定必评估对象，不从中文名称或纹理猜测。
  const routeDecisionRequired = requiresNineSliceDecision({ owner_type: region?.owner_type ?? region?.ownerType, element_type: elementType, render_kind: element.render_kind, role, layer: region?.layer, visual_route_element_type: routeElementType });
  const suppliedDecisionRequired = field(element, "nine_slice_decision_required", "nineSliceDecisionRequired");
  if (suppliedDecisionRequired !== undefined && suppliedDecisionRequired !== routeDecisionRequired) {
    throw new TypeError(`decomposition_elements.${field(element, "element_id", "elementId") ?? index}.nine_slice_decision_required 是由拆解角色派生的事实，不能手工覆盖`);
  }
  const nineSlice = field(element, "nine_slice", "nineSlice");
  const normalizedNineSlice = nineSlice === undefined ? undefined : validateNineSliceContract(nineSlice, `decomposition_elements.${field(element, "element_id", "elementId") ?? index}.nine_slice`);
  if (isNineSliceStretch(normalizedNineSlice) && !isNineSliceStretchTargetAllowed({ element_type: elementType, render_kind: element.render_kind, role, layer: region?.layer, visual_route_element_type: routeElementType })) throw new TypeError("九宫格 stretch 只能用于图片节点或显式 Sprite 底板容器，不能用于纯结构容器");
  if (routeDecisionRequired && normalizedNineSlice === undefined) throw new TypeError(`decomposition_elements.${field(element, "element_id", "elementId") ?? index} 属于固定生产 UI 皮肤，V2 必须确认 nine_slice 或 not-applicable`);
  return { element_id: field(element, "element_id", "elementId") ?? `${region.id}-element-${index + 1}`, element_type: elementType, ...(element.render_kind !== undefined ? { render_kind: element.render_kind } : {}), role, bounds: validBounds(bounds) ? copyBounds(bounds) : bounds, scene_id: region.scene_id, state_id: region.state_id, region_id: region.id, component_id: componentId, placement_id: placementId, ...(nonEmptyString(parentElementId(element)) ? { parent_element_id: parentElementId(element) } : {}), ...(semanticGrouping !== undefined ? { semantic_grouping: normalizeSemanticGrouping(semanticGrouping) } : {}), ...(uiLayout !== undefined ? { ui_layout: normalizeUiLayout(uiLayout) } : {}), ...(normalizedNineSlice !== undefined ? { nine_slice: normalizedNineSlice } : {}), ...(routeDecisionRequired ? { nine_slice_decision_required: true } : {}), ...(typeof region?.owner_type === "string" ? { owner_type: region.owner_type } : typeof region?.ownerType === "string" ? { owner_type: region.ownerType } : {}), ...(typeof region?.layer === "string" ? { region_layer: region.layer } : {}), ...(nonEmptyString(routeElementType) ? { visual_route_element_type: routeElementType } : {}), empty_container: field(element, "empty_container", "emptyContainer") === true };
}

/** 从当前区域生成稳定元素；显式 decomposition_elements 优先，支持人工声明空容器。 */
function buildRegionElements(region) {
  const explicit = field(region, "decomposition_elements", "decompositionElements");
  if (Array.isArray(explicit)) return explicit.map((element, index) => normalizeElement(element, region, index));
  const components = componentList(region); const elements = [];
  for (const [index, component] of components.entries()) {
    const componentId = field(component, "component_id", "componentId") ?? `${region.id}-component-${index + 1}`; const role = field(component, "role", "layout_role", "layoutRole", "node_type", "nodeType") ?? "component"; const placements = Array.isArray(component?.placements) ? component.placements : []; const container = explicitlyContainer(component); const containerId = `container:${componentId}`;
    if (container && component.render_kind === "sprite") {
      // 底板实例本身就是根节点，不能再合成一个无图片的 container: 包装及重复底板。
      for (const [placementIndex, placement] of (placements.length ? placements : [null]).entries()) {
        if (placement?.render_kind !== undefined && placement.render_kind !== "sprite") throw new TypeError(`placement ${placement.placement_id ?? placementIndex}.render_kind 不得覆盖组件的 Sprite 底板身份`);
        const source = placement ?? component;
        const placementId = field(source, "placement_id", "placementId") ?? `${componentId}-placement-${placementIndex + 1}`;
        elements.push(normalizeElement({
          ...source, element_id: field(source, "element_id", "elementId", "layout_node_id", "layoutNodeId") ?? `${componentId}:${placementId}`,
          element_type: "container", render_kind: "sprite", role, component_id: componentId, placement_id: placementId,
          bounds: field(source, "bounds", "target_bounds", "targetBounds") ?? field(component, "bounds", "target_bounds", "targetBounds") ?? region.bounds,
          parent_element_id: parentElementId(source), semantic_grouping: semanticGroupingOf(source), ui_layout: field(source, "ui_layout"),
          nine_slice: field(source, "nine_slice", "nineSlice") ?? field(component, "nine_slice", "nineSlice"),
          nine_slice_decision_required: field(source, "nine_slice_decision_required", "nineSliceDecisionRequired") ?? field(component, "nine_slice_decision_required", "nineSliceDecisionRequired"),
        }, region, placementIndex));
      }
      continue;
    }
    if (container) elements.push(normalizeElement({ element_id: containerId, element_type: "container", render_kind: component.render_kind, role, bounds: field(component, "bounds", "target_bounds", "targetBounds") ?? region.bounds, component_id: componentId, placement_id: `${componentId}-container`, parent_element_id: parentElementId(component), semantic_grouping: semanticGroupingOf(component), ui_layout: field(component, "ui_layout"), nine_slice: field(component, "nine_slice", "nineSlice"), nine_slice_decision_required: field(component, "nine_slice_decision_required", "nineSliceDecisionRequired"), empty_container: placements.length === 0 }, region, index));
    // 显式容器没有 placements 时只保留容器本身；只有普通叶子才需要合成默认子元素。
    const sourcePlacements = placements.length > 0 || container ? placements : [null];
    for (const [placementIndex, placement] of sourcePlacements.entries()) {
      const placementId = field(placement, "placement_id", "placementId") ?? `${componentId}-placement-${placementIndex + 1}`; const elementId = field(placement, "element_id", "elementId") ?? field(placement, "layout_node_id", "layoutNodeId") ?? `${componentId}:${placementId}`; const bounds = field(placement, "bounds", "target_bounds", "targetBounds") ?? field(component, "bounds", "target_bounds", "targetBounds") ?? region.bounds;
      // 没有 placement 的单实例直接继承 component 自身的显式声明；多实例不按共享资源身份补归属。
      const source = placement ?? component;
      elements.push(normalizeElement({ element_id: elementId, element_type: "component", render_kind: field(source, "render_kind"), role: field(placement, "role", "element_type", "elementType") ?? field(component, "role", "element_type", "elementType") ?? "component", bounds, component_id: componentId, placement_id: placementId, semantic_grouping: semanticGroupingOf(source), ui_layout: field(source, "ui_layout"), nine_slice: field(source, "nine_slice", "nineSlice") ?? field(component, "nine_slice", "nineSlice"), nine_slice_decision_required: field(source, "nine_slice_decision_required", "nineSliceDecisionRequired") ?? field(component, "nine_slice_decision_required", "nineSliceDecisionRequired"), parent_element_id: parentElementId(source) }, region, placementIndex));
    }
  }
  if (elements.length === 0) elements.push(normalizeElement({ element_id: region.id, element_type: "component", role: "component", bounds: region.bounds, component_id: `${region.id}-component`, placement_id: `${region.id}-placement` }, region));
  return elements;
}

/** 生成 proposal 顶层与 technical_analysis 共用的拆解元素投影；原顺序就是人工确认顺序。 */
export function buildDecompositionElements(regions = []) { return regions.flatMap((region) => buildRegionElements(region)).map((element) => ({ ...element, bounds: validBounds(element.bounds) ? copyBounds(element.bounds) : element.bounds })); }
/** 按确认 proposal 原顺序返回元素 ID；重复项交给校验器拒绝，不能通过排序或去重掩盖。 */
export function decompositionElementIds(elements = []) { return elements.map((element) => element?.element_id).filter(nonEmptyString); }

/** 校验已确认 proposal 的拆解元素；允许人工修改几何，但不允许越界、漏区域或伪造角色。 */
export function validateDecompositionElements(elements, regions = [], canvas = null, label = "decomposition_elements", errors = []) {
  if (!Array.isArray(elements) || elements.length === 0) { errors.push(`${label} 必须是非空数组`); return null; }
  const regionById = new Map(regions.map((region) => [region?.id ?? region?.region_id, region])); const ids = new Set(); const regionIds = new Set(); const elementById = new Map();
  for (const [index, element] of elements.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (!isObject(element)) { errors.push(`${itemLabel} 必须是对象`); continue; }
    for (const fieldName of ["element_id", "element_type", "role", "scene_id", "state_id", "region_id", "component_id", "placement_id"]) if (!nonEmptyString(element[fieldName])) errors.push(`${itemLabel}.${fieldName} 必须是非空字符串`);
    if (!new Set(["component", "container"]).has(element.element_type)) errors.push(`${itemLabel}.element_type 必须为 component 或 container`);
    if (!validBounds(element.bounds)) errors.push(`${itemLabel}.bounds 必须是有效正尺寸矩形`);
    if (element.element_type === "container" && typeof element.empty_container !== "boolean") errors.push(`${itemLabel}.empty_container 必须是布尔值`);
    if (element.element_type === "component" && element.empty_container === true) errors.push(`${itemLabel} 普通 component 不得标记 empty_container`);
    const sourceRegion = regionById.get(element.region_id);
    const regionOwnerType = field(sourceRegion, "owner_type", "ownerType");
    const regionLayer = field(sourceRegion, "layer");
    const regionRouteType = field(field(sourceRegion, "visual_route_analysis", "visualRouteAnalysis"), "element_type", "elementType");
    if (regionOwnerType !== undefined && element.owner_type !== regionOwnerType) errors.push(`${itemLabel}.owner_type 必须继承所属区域的权威归属，不得遗漏或覆盖`);
    if (regionLayer !== undefined && element.region_layer !== regionLayer) errors.push(`${itemLabel}.region_layer 必须继承所属区域的权威 layer，不得遗漏或覆盖`);
    if (regionRouteType !== undefined && element.visual_route_element_type !== regionRouteType) errors.push(`${itemLabel}.visual_route_element_type 必须继承所属区域的权威视觉路线，不得遗漏或覆盖`);
    // V2 原始区域是权威来源；布局重算缺少 region 时才依赖元素已冻结的派生上下文。
    validateDisplayNodeRole({ ...element, owner_type: regionOwnerType ?? element.owner_type, region_layer: regionLayer ?? element.region_layer }, errors, itemLabel);
    const roleDecisionRequired = requiresNineSliceDecision({ owner_type: regionOwnerType ?? element.owner_type, element_type: element.element_type, render_kind: element.render_kind, role: element.role, region_layer: regionLayer ?? element.region_layer, visual_route_element_type: regionRouteType || element.visual_route_element_type });
    if (element.nine_slice_decision_required !== undefined && element.nine_slice_decision_required !== true) errors.push(`${itemLabel}.nine_slice_decision_required 是派生必评估标记，不接受 false 覆盖`);
    if (roleDecisionRequired && element.nine_slice_decision_required !== true) errors.push(`${itemLabel}.nine_slice_decision_required 缺少 V2 派生必评估标记`);
    if ((roleDecisionRequired || element.nine_slice_decision_required === true) && element.nine_slice === undefined) errors.push(`${itemLabel} 固定生产 UI 皮肤必须冻结 nine_slice 或 not-applicable`);
    if (element.nine_slice !== undefined) {
      try {
        const nineSlice = validateNineSliceTargetBounds(element.nine_slice, element.bounds, `${itemLabel}.bounds`);
        if (isNineSliceStretch(nineSlice)) {
          const allowedTarget = isNineSliceStretchTargetAllowed({
            element_type: element.element_type,
            render_kind: element.render_kind,
            is_container: explicitlyContainer(element) || element.empty_container === true,
            role: element.role,
            region_layer: regionLayer ?? element.region_layer,
            visual_route_element_type: regionRouteType || element.visual_route_element_type,
          });
          if (!allowedTarget) errors.push(`${itemLabel} 九宫格 stretch 只能用于非背景图片或显式 Sprite 底板容器，不能用于纯结构容器`);
        }
      } catch (error) {
        errors.push(`${itemLabel}.nine_slice 无效：${error.message}`);
      }
    }
    validateUiLayout(element.ui_layout, { rootParent: ["viewport", "safe-area"].includes(element.parent_element_id), container: element.element_type === "container", emptyContainer: element.element_type === "container" && element.empty_container === true && !hasSpriteRendering(element) }, errors, `${itemLabel}.ui_layout`);
    // 分组可以管理位置，但普通图片的尺寸来源始终是正式 SpriteFrame。
    try { deriveSpriteGeometry({ ...element, owner_type: regionOwnerType ?? element.owner_type }, element.bounds); } catch (error) { errors.push(`${itemLabel}.ui_layout ${error.message}`); }
    if (ids.has(element.element_id)) errors.push(`${itemLabel}.element_id 重复：${element.element_id}`); else { ids.add(element.element_id); elementById.set(element.element_id, element); }
    const region = regionById.get(element.region_id); if (!region) errors.push(`${itemLabel}.region_id 未绑定当前 scene/state 区域`); else { regionIds.add(element.region_id); if (element.scene_id !== region.scene_id || element.state_id !== region.state_id) errors.push(`${itemLabel} scene/state 未绑定所属区域`); if (validBounds(region.bounds) && validBounds(element.bounds) && !containsBounds(region.bounds, element.bounds)) errors.push(`${itemLabel}.bounds 超出所属区域`); }
    if (isObject(canvas) && Number.isFinite(canvas.width) && Number.isFinite(canvas.height) && validBounds(element.bounds) && !containsBounds({ x: 0, y: 0, width: canvas.width, height: canvas.height }, element.bounds)) errors.push(`${itemLabel}.bounds 超出目标画布`);
  }
  // 背景是固定显示层，不能用作布局容器或相对测量参照。
  const backgrounds = new Set(elements.filter((element) => {
    const region = regionById.get(element?.region_id);
    return isBackgroundDisplayNode({ ...element, region_layer: region?.layer ?? element?.region_layer, visual_route_element_type: field(field(region, "visual_route_analysis", "visualRouteAnalysis"), "element_type", "elementType") ?? element?.visual_route_element_type });
  }).map((element) => element.element_id));
  for (const element of elements) {
    if (!isObject(element)) continue;
    if (backgrounds.has(element.parent_element_id)) errors.push(`${label} 元素 ${element.element_id} 不得相对背景 ${element.parent_element_id} 布局，请改用视口、安全区或功能容器`);
    const referenceId = positionReferenceId(element, element.parent_element_id);
    if (backgrounds.has(referenceId)) errors.push(`${label} 元素 ${element.element_id}.ui_layout.position_reference_id 不得引用背景 ${referenceId}`);
    // 背景的叶子职责与是否已有子元素无关，空容器同样不得冻结进入 V2。
    if (backgrounds.has(element.element_id) && (explicitlyContainer(element) || element.empty_container === true)) errors.push(`${label} 背景 ${element.element_id} 不能声明为容器（含空容器）`);
    if (backgrounds.has(element.element_id) && element.parent_element_id !== "viewport") errors.push(`${label} 背景 ${element.element_id} 必须独立归属 viewport`);
    if (isNineSliceStretch(element.nine_slice) && elements.some((child) => child?.parent_element_id === element.element_id) && !isSpriteContainer(element)) {
      errors.push(`${label} 九宫格 stretch 元素 ${element.element_id} 承载子节点时必须声明为 Sprite 底板容器`);
    }
  }
  // 同一原子 component 的 placements 共用一张纹理，拆解阶段必须冻结同一份九宫格决策。
  const componentNineSlice = new Map();
  for (const element of elements) {
    if (!isObject(element) || !nonEmptyString(element.component_id)) continue;
    const prior = componentNineSlice.get(element.component_id);
    if (prior && !equalNineSliceContracts(prior.nineSlice, element.nine_slice)) {
      errors.push(`${label} component ${element.component_id} 的所有 placements 必须保留相同 nine_slice 决策`);
    } else if (!prior) componentNineSlice.set(element.component_id, { nineSlice: element.nine_slice });
  }
  validateSemanticGrouping(elements, { canvas }, errors, label);
  validateUiInteractionTree(elements, errors, label);
  const expectedRegionIds = [...regionById.keys()].filter(nonEmptyString).sort(); const actualRegionIds = [...regionIds].sort(); if (JSON.stringify(actualRegionIds) !== JSON.stringify(expectedRegionIds)) errors.push(`${label} 未完整覆盖当前 scene/state 区域`);
  return elementById;
}

/** 判断父容器是否完整包含子元素；只用于验证显式归属，不参与父级推导。 */
function containsBounds(parent, child) { return child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height; }
