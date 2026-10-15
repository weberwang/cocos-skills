/**
 * 屏幕 UI 节点职责合同。
 *
 * 语义分组回答“这是什么”，本合同回答“为什么形成父子关系以及谁控制布局”。
 * 两者分别校验，避免把视觉接近误认为真实的布局或行为依赖。
 */

export const UI_GROUPING_BASES = Object.freeze(["POSITION", "LAYOUT", "INTERACTION", "STATE", "CLIP", "REUSE"]);
const BASES = new Set(UI_GROUPING_BASES);
const ENUMS = Object.freeze({
  layout_owner: new Set(["PARENT", "SELF", "EXTERNAL"]),
  size_policy: new Set(["FIXED", "STRETCH", "CONTENT", "FLEX"]),
  overflow_policy: new Set(["KEEP_VISIBLE", "CLIP_DECORATION", "REFLOW", "SCROLL"]),
  safe_area_policy: new Set(["FULL_BLEED", "INSIDE_SAFE_AREA"]),
  interaction_policy: new Set(["HIT_TARGET", "DELEGATE_TO_PARENT", "NONE"]),
});
const FIELDS = new Set(["grouping_basis", ...Object.keys(ENUMS), "minimum_size"]);

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
  };
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
  if (value.minimum_size !== undefined) {
    const size = value.minimum_size;
    if (!isObject(size) || Object.keys(size).some((key) => !["width", "height"].includes(key)) || !Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) errors.push(`${label}.minimum_size 必须包含正数 width/height`);
  }
  if (value.interaction_policy === "DELEGATE_TO_PARENT" && options.rootParent) errors.push(`${label}.interaction_policy 根节点直接子项不能把输入委托给不存在的交互父节点`);
  if (value.overflow_policy === "SCROLL" && (!options.container || !Array.isArray(bases) || !bases.includes("LAYOUT"))) errors.push(`${label}.overflow_policy=SCROLL 必须由负责布局的容器承接`);
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
