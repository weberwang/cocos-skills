import { allowsVisualOverflow, validateUiPositionReferences } from "./ui-layout-organization.mjs";
import { validateDisplayNodeRole } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";
import { validateContainerRootReuse } from "./container-root-policy.mjs";

/**
 * V2 功能语义分组合同。
 *
 * 语义归属必须由拆解阶段显式确认；这个模块只检查声明的结构、真实父级和
 * 几何事实，不根据角色、距离、资源 ID 或视觉接近度替用户猜测归属。
 */

export const SEMANTIC_GROUPING_KINDS = Object.freeze(["region", "component", "part", "standalone"]);
export const SEMANTIC_GROUPING_ROOT_IDS = Object.freeze(["viewport", "safe-area"]);

const ROOT_IDS = new Set(SEMANTIC_GROUPING_ROOT_IDS);
const KINDS = new Set(SEMANTIC_GROUPING_KINDS);

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 读取显式字段；语义合同本身只使用 snake_case 字段。 */
function field(value, name) { return isObject(value) && Object.hasOwn(value, name) ? value[name] : undefined; }
/** 判断有效正尺寸矩形。 */
function validBounds(value) { return isObject(value) && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key])) && value.width > 0 && value.height > 0; }
/** 判断父矩形是否完整包含子矩形。 */
function containsBounds(parent, child) { return child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height; }

/** 归一化一份语义声明；缺失值保持缺失，供校验器返回待补充错误。 */
export function normalizeSemanticGrouping(value) {
  if (value === undefined) return undefined;
  if (!isObject(value)) return value;
  return { kind: value.kind, rationale: value.rationale };
}

/** 从元素或组件/placement 源声明读取语义分组，不使用角色或资源字段推断。 */
export function semanticGroupingOf(value) { return field(value, "semantic_grouping"); }

/** 取得可用于区域身份哈希的稳定语义投影。 */
export function semanticGroupingDefinition(value) {
  const grouping = normalizeSemanticGrouping(value);
  return grouping === undefined ? null : grouping;
}

/**
 * 校验拆解元素的语义合同，并返回已建立的元素/父级索引。
 *
 * rootBounds 可为 viewport/safe-area 提供不同边界；未提供时使用 canvas，避免
 * stable root 被误当成无需几何复核的逃生通道。
 */
export function validateSemanticGrouping(elements, options = {}, errors = [], label = "decomposition_elements") {
  if (!Array.isArray(elements) || elements.length === 0) {
    errors.push(`${label} 必须是非空数组，才能确认语义分组`);
    return null;
  }

  const elementById = new Map();
  const parentById = new Map();
  const childCounts = new Map();
  const rootBounds = isObject(options.rootBounds ?? options.root_bounds) ? (options.rootBounds ?? options.root_bounds) : {};
  const canvas = options.canvas ?? options.viewport;
  const rootBoundsOf = (parentId) => {
    if (Object.hasOwn(rootBounds, parentId)) return validBounds(rootBounds[parentId]) ? rootBounds[parentId] : null;
    if (!isObject(canvas) || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) || canvas.width <= 0 || canvas.height <= 0) return null;
    return Number.isFinite(canvas.x) && Number.isFinite(canvas.y) ? canvas : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  };

  for (const [index, element] of elements.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (!isObject(element)) {
      errors.push(`${itemLabel} 必须是对象，不能从缺失元素猜测语义`);
      continue;
    }
    validateDisplayNodeRole(element, errors, itemLabel);
    const elementId = element.element_id;
    if (!nonEmptyString(elementId)) errors.push(`${itemLabel}.element_id 必须是非空字符串`);
    else if (ROOT_IDS.has(elementId)) errors.push(`${itemLabel}.element_id 不得占用稳定根 ID：${elementId}`);
    else if (elementById.has(elementId)) errors.push(`${itemLabel}.element_id 重复：${elementId}`);
    else elementById.set(elementId, element);

    const grouping = semanticGroupingOf(element);
    if (!isObject(grouping)) {
      errors.push(`${itemLabel}.semantic_grouping 必须显式声明 kind 和 rationale，缺失时停留拆解补充`);
    } else {
      const unknownKeys = Object.keys(grouping).filter((key) => !["kind", "rationale"].includes(key));
      if (unknownKeys.length > 0) errors.push(`${itemLabel}.semantic_grouping 不得包含未定义字段：${unknownKeys.join(",")}`);
      if (!KINDS.has(grouping.kind)) errors.push(`${itemLabel}.semantic_grouping.kind 必须为 region/component/part/standalone`);
      if (!nonEmptyString(grouping.rationale)) errors.push(`${itemLabel}.semantic_grouping.rationale 必须是非空理由`);
      const isContainer = element.element_type === "container";
      if (isContainer && !["region", "component"].includes(grouping.kind)) errors.push(`${itemLabel}.semantic_grouping.kind=${grouping.kind} 非法：容器仅可使用 region/component`);
      if (!isContainer && !["part", "standalone"].includes(grouping.kind)) errors.push(`${itemLabel}.semantic_grouping.kind=${grouping.kind} 非法：非容器叶子仅可使用 part/standalone`);
    }

    const parentId = element.parent_element_id;
    if (!nonEmptyString(parentId)) errors.push(`${itemLabel}.parent_element_id 必须显式引用同场景容器或 viewport/safe-area`);
    else {
      parentById.set(elementId, parentId);
      childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
      if (parentId === elementId) errors.push(`${itemLabel}.parent_element_id 不能自指`);
    }
    if (!validBounds(element.bounds)) errors.push(`${itemLabel}.bounds 必须是有效正尺寸矩形`);
    if (element.element_type === "container" && typeof element.empty_container !== "boolean") errors.push(`${itemLabel}.empty_container 必须是布尔值`);
    if (element.element_type !== "container" && element.empty_container === true) errors.push(`${itemLabel} 非容器叶子不得标记 empty_container`);
  }

  const parentFor = (element) => {
    const parentId = parentById.get(element.element_id);
    if (!parentId) return null;
    if (ROOT_IDS.has(parentId)) return { id: parentId, element: null, bounds: rootBoundsOf(parentId) };
    const parent = elementById.get(parentId);
    return { id: parentId, element: parent ?? null, bounds: parent?.bounds ?? null };
  };

  // 只沿真实父级链解析稳定根；断链或父级循环时交由既有引用/循环错误说明。
  const stableRootOf = (element) => {
    const seen = new Set([element.element_id]);
    let parentId = parentById.get(element.element_id);
    while (nonEmptyString(parentId)) {
      if (ROOT_IDS.has(parentId)) return parentId;
      if (seen.has(parentId)) return null;
      seen.add(parentId);
      if (!elementById.has(parentId)) return null;
      parentId = parentById.get(parentId);
    }
    return null;
  };

  for (const element of elements) {
    if (!isObject(element) || !nonEmptyString(element.element_id)) continue;
    const itemLabel = `${label}.${element.element_id}`;
    const parentInfo = parentFor(element);
    if (!parentInfo) continue;
    if (!parentInfo.element && !ROOT_IDS.has(parentInfo.id)) {
      errors.push(`${itemLabel}.parent_element_id 必须引用已声明容器或稳定根 ${SEMANTIC_GROUPING_ROOT_IDS.join("/")}`);
      continue;
    }
    if (parentInfo.element) {
      if (parentInfo.element.element_type !== "container") errors.push(`${itemLabel}.parent_element_id 必须引用已声明容器`);
      if (element.scene_id !== parentInfo.element.scene_id || element.state_id !== parentInfo.element.state_id) errors.push(`${itemLabel}.parent_element_id 必须与父级处于同一 scene/state`);
    }
    if (!parentInfo.bounds) errors.push(`${itemLabel}.parent_element_id 缺少可复核的父 bounds`);
    else if (validBounds(element.bounds) && !containsBounds(parentInfo.bounds, element.bounds)
      // 视觉装饰可溢出真实功能父级；稳定根仍是画布边界，不能借此越界。
      && (ROOT_IDS.has(parentInfo.id) || !allowsVisualOverflow(element.ui_layout))) errors.push(`${itemLabel}.bounds 超出显式父级 bounds`);
  }

  for (const element of elements) {
    if (!isObject(element) || !nonEmptyString(element.element_id) || !validBounds(element.bounds)) continue;
    const rootId = stableRootOf(element);
    // 缺少稳定根或有效根边界时保留父级引用诊断，不用猜测边界。
    if (!rootId || parentById.get(element.element_id) === rootId) continue;
    const bounds = rootBoundsOf(rootId);
    if (bounds && !containsBounds(bounds, element.bounds)) errors.push(`${label}.${element.element_id}.bounds 超出所属稳定根 ${rootId} bounds`);
  }

  for (const element of elements) {
    if (!isObject(element) || element.element_type !== "container" || !nonEmptyString(element.element_id)) continue;
    const expectedEmpty = (childCounts.get(element.element_id) ?? 0) === 0;
    if (element.empty_container !== expectedEmpty) errors.push(`${label}.${element.element_id}.empty_container 与实际直接子项数不一致`);
  }

  // 归属父级与定位参照是两种独立依赖，合并校验避免循环定位关系。
  validateUiPositionReferences(elements, errors, label);
  validateContainerRootReuse(elements, errors, label);

  // 仅沿显式 parent_element_id 追链；任何循环都必须失败，不能靠几何排序打破。
  for (const element of elements) {
    if (!isObject(element) || !nonEmptyString(element.element_id)) continue;
    const trail = new Set();
    let current = element.element_id;
    while (current && !ROOT_IDS.has(current)) {
      if (trail.has(current)) {
        errors.push(`${label}.${element.element_id} 的 parent_element_id 存在循环`);
        break;
      }
      trail.add(current);
      const parentId = parentById.get(current);
      if (!parentId || ROOT_IDS.has(parentId)) break;
      if (!elementById.has(parentId)) break;
      current = parentId;
    }
  }
  return { elementById, parentById };
}
