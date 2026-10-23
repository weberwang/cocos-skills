/** 图片尺寸计划只描述 Sprite 自身，禁止从功能容器继承内容尺寸。 */
import { isNineSliceStretch, isNineSliceStretchTargetAllowed, validateNineSliceTargetBounds } from "./nine-slice-contract.mjs";
import { hasSpriteRendering, isLayoutContainer, validateDisplayNodeRole } from "./display-node-role.mjs";

/** 判断节点是否渲染固定视觉图片；显式 Sprite 底板可以同时承担父容器职责。 */
export function isSpriteLayoutNode(node) {
  return hasSpriteRendering(node);
}

/** 按图片路线推导尺寸计划；RAW 不携带可被布局器写入的目标宽高。 */
export function deriveSpriteGeometry(node, bounds = node?.target_bounds ?? node?.bounds) {
  const roleErrors = validateDisplayNodeRole(node, [], "layout_node");
  if (roleErrors.length > 0) throw new TypeError(roleErrors[0]);
  // 结构容器的九宫格字段不能反向证明 Sprite 身份，需显式标记 render_kind=sprite。
  if (isLayoutContainer(node) && !hasSpriteRendering(node) && node?.nine_slice !== undefined) {
    throw new TypeError("纯结构容器不能声明九宫格合同，请为底板显式声明 render_kind=sprite");
  }
  if (!isSpriteLayoutNode(node)) return null;
  if (node.nine_slice !== undefined) validateNineSliceTargetBounds(node.nine_slice, bounds, "sprite_geometry");
  if (!isNineSliceStretch(node.nine_slice)) {
    if (["STRETCH", "FLEX"].includes(node.ui_layout?.size_policy)) throw new TypeError("普通图片必须保持 RAW 原尺寸，不能使用 STRETCH/FLEX 尺寸策略");
    return { type: "SIMPLE", size_mode: "RAW", content_size: null };
  }
  if (!isNineSliceStretchTargetAllowed({ ...node, role: node.layout_role ?? node.role })) throw new TypeError("九宫格尺寸计划只能用于非背景图片皮肤或显式 Sprite 底板容器");
  if (![bounds?.width, bounds?.height].every((value) => Number.isFinite(value) && value > 0)) throw new TypeError("九宫格尺寸计划需要有效目标宽高");
  return { type: "SLICED", size_mode: "CUSTOM", content_size: { width: bounds.width, height: bounds.height } };
}

/** 比较严格的尺寸计划，拒绝通过额外字段向 RAW 图片偷偷注入目标宽高。 */
function samePlan(actual, expected) {
  if (actual === null || expected === null) return actual === expected;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  if (Object.keys(actual).sort().join(",") !== "content_size,size_mode,type") return false;
  if (actual.type !== expected.type || actual.size_mode !== expected.size_mode) return false;
  if (expected.content_size === null) return actual.content_size === null;
  const size = actual.content_size;
  return size && Object.keys(size).sort().join(",") === "height,width" && size.width === expected.content_size.width && size.height === expected.content_size.height;
}

/** 校验已生成节点的 Sprite 尺寸计划，不能用分组尺寸覆盖普通图片。 */
export function validateSpriteGeometry(node, errors = [], label = "layout_node") {
  try {
    const expected = deriveSpriteGeometry(node);
    if (expected === null && node?.sprite_geometry === undefined) return errors;
    if (!samePlan(node?.sprite_geometry, expected)) errors.push(`${label}.sprite_geometry 必须按图片路线派生：普通图片（含底板父容器）RAW 且 content_size=null，仅九宫格 SLICED + CUSTOM 设置目标宽高，纯结构容器不设置 Sprite 尺寸`);
  } catch (error) {
    errors.push(`${label}.sprite_geometry ${error.message}`);
  }
  return errors;
}
