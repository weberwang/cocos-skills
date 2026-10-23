import { hasSpriteRendering, isBackgroundDisplayNode, isLayoutContainer, isSpriteContainer } from "./display-node-role.mjs";

/**
 * V2 冻结、V3 生产和正式界面渲染共用的纯九宫格数据合同。
 * 必评估对象只由显式生产归属、职责或视觉路线判定，不猜名称/像素，也不隐式裁切或缩放角边。
 */

const DECISION_FIELDS = new Set(["mode", "reason"]);
const STRETCH_FIELDS = new Set(["mode", "reason", "source_size", "borders"]);
const SOURCE_SIZE_FIELDS = new Set(["width", "height"]);
const BORDER_FIELDS = new Set(["left", "right", "top", "bottom"]);
const NINE_SLICE_DECISION_ROLES = new Set([
  "button", "button-skin", "panel", "panel-frame", "background-frame", "decorative-frame",
  "card-frame", "input-skin", "tooltip-skin", "selection-skin", "nine-slice",
]);

/** 判断非数组普通对象。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 拒绝合同未定义的字段，避免生成或渲染阶段静默忽略额外九宫格语义。 */
function rejectUnknownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}.${key} 是不支持的九宫格字段`);
  }
}

/** 规范化显式职责标记，允许英文大小写、空格和下划线写法保持同一角色。 */
function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_]+/gu, "-").replace(/-+/gu, "-") : "";
}

/** 判断固定生产图片是否必须在 V2 明确选择九宫格或 not-applicable。 */
export function requiresNineSliceDecision(input = {}) {
  const ownerType = input.owner_type ?? input.ownerType;
  const elementType = input.element_type ?? input.elementType;
  const role = normalizeRole(input.role ?? input.layout_role ?? input.layoutRole);
  const routeType = normalizeRole(input.visual_route_element_type ?? input.visualRouteElementType
    ?? input.visual_route_analysis?.element_type ?? input.visualRouteAnalysis?.elementType);
  if (ownerType !== "fixed-production-visual" || !["component", "container"].includes(elementType) || !hasSpriteRendering(input)) return false;
  const uiSkinRole = NINE_SLICE_DECISION_ROLES.has(role) || NINE_SLICE_DECISION_ROLES.has(routeType);
  if (isBackgroundDisplayNode(input)) return false;
  return uiSkinRole;
}

/** 判断 stretch 是否落在允许的图片显示对象上，职责判定采用完整角色 token。 */
export function isNineSliceStretchTargetAllowed(input = {}) {
  const elementType = input.element_type ?? input.elementType;
  const spriteContainer = isSpriteContainer(input);
  if (isBackgroundDisplayNode(input) || !["component", "container"].includes(elementType)) return false;
  // 渲染身份与容器职责独立：通用 container/group 角色不能否定显式 Sprite 底板。
  if (isLayoutContainer(input) && !spriteContainer) return false;
  return true;
}

/** 规范化并验证明确的九宫格适用决策。 */
export function validateNineSliceContract(value, label = "nine_slice") {
  if (!isRecord(value)) throw new TypeError(`${label} 必须是九宫格决策对象`);
  if (value.mode === "not-applicable") {
    rejectUnknownFields(value, DECISION_FIELDS, label);
    if (typeof value.reason !== "string" || value.reason.trim() === "") {
      throw new TypeError(`${label}.reason 必须说明不适用九宫格的原因`);
    }
    return { mode: "not-applicable", reason: value.reason.trim() };
  }
  if (value.mode !== "stretch") throw new TypeError(`${label}.mode 必须为 stretch 或 not-applicable`);
  rejectUnknownFields(value, STRETCH_FIELDS, label);
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    throw new TypeError(`${label}.reason 必须说明采用九宫格拉伸的原因`);
  }
  const sourceSize = value.source_size;
  if (!isRecord(sourceSize)) throw new TypeError(`${label}.source_size 必须是正整数尺寸`);
  rejectUnknownFields(sourceSize, SOURCE_SIZE_FIELDS, `${label}.source_size`);
  if (![sourceSize.width, sourceSize.height].every((dimension) => Number.isSafeInteger(dimension) && dimension > 0)) {
    throw new TypeError(`${label}.source_size.width/height 必须是正安全整数`);
  }
  const borders = value.borders;
  if (!isRecord(borders)) throw new TypeError(`${label}.borders 必须包含 left/right/top/bottom`);
  rejectUnknownFields(borders, BORDER_FIELDS, `${label}.borders`);
  if (![...BORDER_FIELDS].every((side) => Number.isSafeInteger(borders[side]) && borders[side] >= 0)) {
    throw new TypeError(`${label}.borders.left/right/top/bottom 必须是非负整数`);
  }
  if (borders.left + borders.right >= sourceSize.width || borders.top + borders.bottom >= sourceSize.height) {
    throw new TypeError(`${label}.borders 必须为源图保留非零中心区域`);
  }
  if (borders.top + borders.bottom === 0) {
    throw new TypeError(`${label}.borders.top/bottom 至少一侧必须大于零；当前只支持真正九块切片`);
  }
  return {
    mode: "stretch",
    reason: value.reason.trim(),
    source_size: { width: sourceSize.width, height: sourceSize.height },
    borders: { left: borders.left, right: borders.right, top: borders.top, bottom: borders.bottom },
  };
}

/** 判断已验证合同是否选择九宫格拉伸。 */
export function isNineSliceStretch(contract) {
  return contract?.mode === "stretch";
}

/** 确保冻结显示矩形仍为九宫格中心留出正空间。 */
export function validateNineSliceTargetBounds(contract, bounds, label = "target_bounds") {
  const normalized = validateNineSliceContract(contract, `${label}.nine_slice`);
  if (!isNineSliceStretch(normalized)) return normalized;
  if (!isRecord(bounds) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    throw new TypeError(`${label} 必须包含正数 width/height 才能应用九宫格`);
  }
  if (bounds.width <= normalized.borders.left + normalized.borders.right
    || bounds.height <= normalized.borders.top + normalized.borders.bottom) {
    throw new RangeError(`${label} 必须大于九宫格左右/上下边宽之和，保留正尺寸中心区域`);
  }
  return normalized;
}

/** 比较两个规范化九宫格决策，合同缺失与显式 not-applicable 不视为相同。 */
export function equalNineSliceContracts(left, right) {
  if (left === undefined || right === undefined) return left === right;
  try {
    return JSON.stringify(validateNineSliceContract(left)) === JSON.stringify(validateNineSliceContract(right));
  } catch {
    return false;
  }
}
