/**
 * 统一布局节点的结构容器与 Sprite 渲染身份判定，避免渲染合同反向依赖九宫格合同。
 */

const CONTAINER_ROLES = new Set(["container", "parent", "group", "layout-container", "empty-container"]);
const BACKGROUND_ROLES = new Set(["background", "full-bleed", "fullbleed"]);
const SKIN_ROLES = new Set([
  "button", "button-skin", "panel", "panel-frame", "background-frame", "decorative-frame",
  "card-frame", "input-skin", "tooltip-skin", "selection-skin", "nine-slice",
]);

/** 读取 snake_case/camelCase 节点字段。 */
function field(node, ...names) {
  for (const name of names) if (node?.[name] !== undefined && node?.[name] !== null) return node[name];
  return undefined;
}

/** 规范化职责标签，统一当前结构角色写法中的空格、下划线与大小写。 */
function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_]+/gu, "-").replace(/-+/gu, "-") : "";
}

/** 获取显式渲染标签；只要标签出现，就以该身份为准，不再按其他字段推测。 */
function explicitRenderKinds(node) {
  return Object.prototype.hasOwnProperty.call(node ?? {}, "render_kind") && node.render_kind !== undefined
    ? [node.render_kind]
    : [];
}

/** 判断节点是否属于背景；权威图层始终优先，普通背景标签可由明确皮肤路线消歧。 */
export function isBackgroundDisplayNode(node) {
  const layer = field(node, "region_layer", "regionLayer", "layer");
  if (layer === "background") return true;

  const role = normalizeRole(field(node, "role", "layout_role", "layoutRole"));
  const routeType = normalizeRole(field(node, "visual_route_element_type", "visualRouteElementType")
    ?? node?.visual_route_analysis?.element_type ?? node?.visualRouteAnalysis?.elementType);
  const declaredRoles = [role, routeType];
  return declaredRoles.some((value) => BACKGROUND_ROLES.has(value))
    && !declaredRoles.some((value) => SKIN_ROLES.has(value));
}

/** 按显式容器字段与结构角色判断节点是否承担父级布局职责。 */
export function isLayoutContainer(node) {
  if (node?.element_type === "container" || node?.elementType === "container") return true;
  if (node?.is_container === true || node?.isContainer === true || node?.container === true) return true;
  const roles = [
    node?.layout_role, node?.layoutRole, node?.node_type, node?.nodeType,
    node?.element_type, node?.elementType, node?.role,
  ];
  return roles.some((role) => CONTAINER_ROLES.has(normalizeRole(role)));
}

/** 判断节点是否渲染 Sprite；纯结构容器的九宫格或尺寸草案不能充当渲染声明。 */
export function hasSpriteRendering(node) {
  const declaredKinds = explicitRenderKinds(node);
  if (declaredKinds.length > 0) return declaredKinds.every((kind) => kind === "sprite");
  if (isLayoutContainer(node)) return false;
  return field(node, "owner_type", "ownerType") === "fixed-production-visual"
    || field(node, "nine_slice", "nineSlice") !== undefined
    || field(node, "sprite_geometry", "spriteGeometry") !== undefined;
}

/** 判断同一个节点是否同时作为布局父级和 Sprite 底板渲染。 */
export function isSpriteContainer(node) {
  return isLayoutContainer(node) && hasSpriteRendering(node);
}

/** 检查节点的渲染身份与背景职责，错误写入调用方诊断数组。 */
export function validateDisplayNodeRole(node, errors = [], label = "node") {
  const declaredKinds = explicitRenderKinds(node);
  if (declaredKinds.some((kind) => kind !== "sprite")) {
    errors.push(`${label}.render_kind 目前只支持 sprite；不得用 none 取消既有固定图片身份`);
  }

  const ownerType = field(node, "owner_type", "ownerType");
  const explicitRoles = [node?.role, node?.layout_role, node?.layoutRole].map(normalizeRole);
  // 皮肤职责的固定图片容器若未声明渲染身份，不能被静默降级为空结构节点。
  if (isLayoutContainer(node) && ownerType === "fixed-production-visual" && declaredKinds.length === 0
    && explicitRoles.some((role) => SKIN_ROLES.has(role))) {
    errors.push(`${label}.render_kind 必须显式声明为 sprite，固定图片皮肤容器不能省略渲染身份`);
  }
  if (!isSpriteContainer(node)) return errors;

  if (ownerType !== undefined && ownerType !== "fixed-production-visual") {
    errors.push(`${label}.render_kind=sprite 的容器只允许 fixed-production-visual 图片归属`);
  }

  if (isBackgroundDisplayNode(node)) {
    const layer = field(node, "region_layer", "regionLayer", "layer");
    if (layer === "background") {
      errors.push(`${label} 的权威 background 图层不能兼任图片容器`);
    } else {
      errors.push(`${label} 的纯 background 职责不能兼任图片容器`);
    }
  }
  return errors;
}
