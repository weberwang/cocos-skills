/**
 * 屏幕 UI 节点职责合同。
 *
 * 语义分组回答“这是什么”，本合同回答“为什么形成父子关系以及谁控制布局”。
 * 两者分别校验，避免把视觉接近误认为真实的布局或行为依赖。
 */

import { isBackgroundDisplayNode } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";
import { validateLayoutDriverDeclaration } from "../../cocos-game-ui-layout/scripts/widget-layout.mjs";

export const UI_GROUPING_BASES = Object.freeze(["POSITION", "LAYOUT", "INTERACTION", "STATE", "CLIP", "REUSE"]);
const BASES = new Set(UI_GROUPING_BASES);
const ENUMS = Object.freeze({
  layout_owner: new Set(["PARENT", "SELF", "EXTERNAL"]),
  size_policy: new Set(["FIXED", "STRETCH", "CONTENT", "FLEX"]),
  overflow_policy: new Set(["KEEP_VISIBLE", "CLIP_DECORATION", "REFLOW", "SCROLL"]),
  safe_area_policy: new Set(["FULL_BLEED", "INSIDE_SAFE_AREA"]),
  interaction_policy: new Set(["HIT_TARGET", "DELEGATE_TO_PARENT", "NONE"]),
});
const FIELDS = new Set(["grouping_basis", ...Object.keys(ENUMS), "minimum_size", "position_reference_id", "visual_overflow", "independent_container_reason", "position_driver", "size_driver", "widget_stretch_axes"]);

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 复制声明字段，保留未知键和缺失状态交由校验器报告。 */
export function normalizeUiLayout(value) {
  if (value === undefined) return undefined;
  if (!isObject(value)) return value;
  return {
    ...value,
    grouping_basis: Array.isArray(value.grouping_basis) ? [...value.grouping_basis] : value.grouping_basis,
    layout_owner: value.layout_owner,
    size_policy: value.size_policy,
    overflow_policy: value.overflow_policy,
    safe_area_policy: value.safe_area_policy,
    interaction_policy: value.interaction_policy,
    ...(value.minimum_size !== undefined ? { minimum_size: isObject(value.minimum_size) ? { ...value.minimum_size } : value.minimum_size } : {}),
    ...(value.position_reference_id !== undefined ? { position_reference_id: value.position_reference_id } : {}),
    ...(value.visual_overflow !== undefined ? { visual_overflow: isObject(value.visual_overflow) ? { ...value.visual_overflow } : value.visual_overflow } : {}),
  };
}

/** 返回显式定位参照；未声明时继续以实际父节点作为定位参照。 */
export function positionReferenceId(element, parentId) {
  return element?.ui_layout?.position_reference_id ?? parentId;
}

/** 仅允许包含非空理由的规范视觉溢出声明放宽父级几何检查。 */
export function allowsVisualOverflow(uiLayout) {
  const overflow = uiLayout?.visual_overflow;
  return isObject(overflow) && Object.keys(overflow).length === 1 && Object.hasOwn(overflow, "reason")
    && typeof overflow.reason === "string" && overflow.reason.trim().length > 0;
}

/**
 * 检查已确认拆解或布局节点的职责声明。
 *
 * 根节点直接子项允许无依赖；其余父子关系必须声明真实依据。空槽可以
 * 保留，但须有布局、状态或复用职责，不能把纯视觉空层带入运行树。
 */
export function validateUiLayout(value, options = {}, errors = [], label = "ui_layout") {
  if (!isObject(value)) { errors.push(`${label} 必须显式声明节点布局职责`); return; }
  for (const key of Object.keys(value)) if (!FIELDS.has(key)) errors.push(`${label}.${key} 不是定义的布局职责字段`);
  const bases = value.grouping_basis;
  if (!Array.isArray(bases) || bases.some((basis) => !BASES.has(basis)) || new Set(bases).size !== bases.length) errors.push(`${label}.grouping_basis 必须是不重复的 POSITION/LAYOUT/INTERACTION/STATE/CLIP/REUSE 数组`);
  else {
    if (!options.rootParent && bases.length === 0) errors.push(`${label}.grouping_basis 必须说明与实际父节点的依赖`);
    if (options.emptyContainer && !bases.some((basis) => ["LAYOUT", "STATE", "REUSE"].includes(basis))) errors.push(`${label}.grouping_basis 空容器必须有可解释的布局、状态或复用职责`);
  }
  for (const [key, allowed] of Object.entries(ENUMS)) if (!allowed.has(value[key])) errors.push(`${label}.${key} 不属于允许的策略`);
  validateLayoutDriverDeclaration(value, errors, label);
  if (value.minimum_size !== undefined) {
    const size = value.minimum_size;
    if (!isObject(size) || Object.keys(size).some((key) => !["width", "height"].includes(key)) || !Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) errors.push(`${label}.minimum_size 必须包含正数 width/height`);
  }
  if (value.position_reference_id !== undefined && (typeof value.position_reference_id !== "string" || value.position_reference_id.trim().length === 0)) errors.push(`${label}.position_reference_id 必须是非空字符串`);
  if (value.position_reference_id !== undefined && options.parentId !== undefined && value.position_reference_id !== options.parentId
    && (!Array.isArray(bases) || !bases.includes("POSITION"))) errors.push(`${label}.grouping_basis 指向不同定位参照时必须包含 POSITION`);
  if (value.visual_overflow !== undefined && !allowsVisualOverflow(value)) errors.push(`${label}.visual_overflow 必须是仅包含非空 reason 的对象`);
  if (value.independent_container_reason !== undefined && (typeof value.independent_container_reason !== "string" || !value.independent_container_reason.trim())) errors.push(`${label}.independent_container_reason 必须说明额外结构容器的独立职责`);
  if (value.interaction_policy === "DELEGATE_TO_PARENT" && options.rootParent) errors.push(`${label}.interaction_policy 根节点直接子项不能把输入委托给不存在的交互父节点`);
  if (value.overflow_policy === "SCROLL" && (!options.container || !Array.isArray(bases) || !bases.includes("LAYOUT"))) errors.push(`${label}.overflow_policy=SCROLL 必须由负责布局的容器承接`);
}

/**
 * 校验独立定位参照与实际父子归属，并检查两类依赖边组成的联合图是否有环。
 * 显式参照只允许同级、祖先或稳定根，避免把任意节点误当成布局容器。
 */
export function validateUiPositionReferences(elements, errors = [], label = "decomposition_elements") {
  if (!Array.isArray(elements)) return;
  const byId = new Map();
  for (const element of elements) {
    if (isObject(element) && typeof element.element_id === "string" && !byId.has(element.element_id)) byId.set(element.element_id, element);
  }

  const dependencies = new Map();
  for (const element of elements) {
    if (!isObject(element) || typeof element.element_id !== "string") continue;
    const elementId = element.element_id;
    const itemLabel = `${label}.${elementId}`;
    const parentId = element.parent_element_id;
    const hasExplicitReference = isObject(element.ui_layout) && Object.hasOwn(element.ui_layout, "position_reference_id");
    const referenceId = positionReferenceId(element, parentId);
    const explicitReferenceId = hasExplicitReference ? element.ui_layout.position_reference_id : undefined;
    const edges = new Set();
    if (typeof parentId === "string" && byId.has(parentId)) edges.add(parentId);

    if (hasExplicitReference) {
      if (typeof explicitReferenceId !== "string" || explicitReferenceId.trim().length === 0) {
        errors.push(`${itemLabel}.ui_layout.position_reference_id 必须是非空字符串`);
      } else if (referenceId === elementId) {
        errors.push(`${itemLabel}.ui_layout.position_reference_id 不能自指`);
      } else if (!ROOTS.has(referenceId) && !byId.has(referenceId)) {
        errors.push(`${itemLabel}.ui_layout.position_reference_id 未引用已声明元素或稳定根`);
      } else if (!ROOTS.has(referenceId)) {
        const target = byId.get(referenceId);
        if (referenceId !== parentId && (!Array.isArray(element.ui_layout.grouping_basis) || !element.ui_layout.grouping_basis.includes("POSITION"))) {
          errors.push(`${itemLabel}.ui_layout.grouping_basis 指向不同定位参照时必须包含 POSITION`);
        }
        const isSibling = typeof parentId === "string" && target.parent_element_id === parentId;
        const isAncestor = isAncestorOf(element, referenceId, byId);
        if (!isSibling && !isAncestor) errors.push(`${itemLabel}.ui_layout.position_reference_id 必须指向同级、祖先或稳定根`);
        if (isBackgroundDisplayNode(target)) errors.push(`${itemLabel}.ui_layout.position_reference_id 不得引用背景 ${referenceId}`);
        for (const key of ["scene_id", "state_id", "coordinate_space"]) {
          if (hasContextValue(element[key]) && hasContextValue(target[key]) && element[key] !== target[key]) {
            errors.push(`${itemLabel}.ui_layout.position_reference_id 必须与参照对象处于相同 ${key}`);
          }
        }
        edges.add(referenceId);
      } else if (referenceId !== parentId && (!Array.isArray(element.ui_layout.grouping_basis) || !element.ui_layout.grouping_basis.includes("POSITION"))) {
        errors.push(`${itemLabel}.ui_layout.grouping_basis 指向不同定位参照时必须包含 POSITION`);
      }
    }
    // 默认定位参照就是 parent；去重后联合父子归属边与定位边检查循环。
    if (!hasExplicitReference && typeof parentId === "string" && byId.has(parentId)) edges.add(parentId);
    dependencies.set(elementId, [...edges]);
  }

  reportDependencyCycles(dependencies, errors, label);
}

const ROOTS = new Set(["viewport", "safe-area"]);

/** 判断上下文标识是否存在；缺少一侧时不推测其场景、状态或坐标空间。 */
function hasContextValue(value) { return value !== undefined && value !== null && value !== ""; }

/** 沿实际 parent_element_id 链判断目标是否为当前元素的祖先。 */
function isAncestorOf(element, candidateId, byId) {
  const seen = new Set();
  let parentId = element.parent_element_id;
  while (typeof parentId === "string" && !ROOTS.has(parentId) && !seen.has(parentId)) {
    if (parentId === candidateId) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parent_element_id;
  }
  return false;
}

/** 报告父级边与定位参照边合并后形成的循环依赖。 */
function reportDependencyCycles(dependencies, errors, label) {
  const state = new Map();
  const stack = [];
  const reported = new Set();
  const visit = (elementId) => {
    state.set(elementId, 1);
    stack.push(elementId);
    for (const targetId of dependencies.get(elementId) ?? []) {
      if (!dependencies.has(targetId)) continue;
      if (state.get(targetId) === 1) {
        const cycle = stack.slice(stack.indexOf(targetId));
        const signature = [...cycle].sort().join("\u0000");
        if (!reported.has(signature)) {
          reported.add(signature);
          errors.push(`${label} 定位依赖与父子归属存在循环：${[...cycle, targetId].join(" -> ")}`);
        }
      } else if (state.get(targetId) !== 2) visit(targetId);
    }
    stack.pop();
    state.set(elementId, 2);
  };
  for (const elementId of dependencies.keys()) if (!state.has(elementId)) visit(elementId);
}

/** 校验命中目标沿父链唯一归属，避免子图形形成重叠可点击区域。 */
export function validateUiInteractionTree(elements, errors = [], label = "decomposition_elements") {
  if (!Array.isArray(elements)) return;
  const byId = new Map(elements.filter(isObject).map((element) => [element.element_id, element]));
  for (const element of elements) {
    if (!isObject(element) || !isObject(element.ui_layout)) continue;
    const policy = element.ui_layout.interaction_policy;
    if (policy !== "DELEGATE_TO_PARENT" && policy !== "HIT_TARGET") continue;
    const seen = new Set([element.element_id]);
    let parentId = element.parent_element_id;
    let targetFound = false;
    while (byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (parent.ui_layout?.interaction_policy === "HIT_TARGET") { targetFound = true; break; }
      parentId = parent.parent_element_id;
    }
    if (policy === "DELEGATE_TO_PARENT" && !targetFound) errors.push(`${label}.${element.element_id}.ui_layout.interaction_policy 缺少接收输入的 HIT_TARGET 祖先`);
    if (policy === "HIT_TARGET" && targetFound) errors.push(`${label}.${element.element_id}.ui_layout.interaction_policy 不能嵌套另一个 HIT_TARGET`);
  }
}
