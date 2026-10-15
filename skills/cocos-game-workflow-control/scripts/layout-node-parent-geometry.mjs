/**
 * effect-image 布局节点的父子几何合同。
 *
 * 该模块只保留一份父容器、相对距离、轴向对齐和运行时偏移的推导规则，
 * 场景拆解、UI 布局合同和视觉资源映射入口都必须消费这里的诊断结果。
 */

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断是否为非空字符串。 */
function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 读取 snake_case 权威字段，并在既有入口中保留 camelCase 读取能力。 */
export function readLayoutNodeField(node, ...names) {
  for (const name of names) if (node?.[name] !== undefined && node?.[name] !== null) return node[name];
  return undefined;
}

/** 判断目标边界是否为有限的正尺寸矩形。 */
export function isValidLayoutNodeBounds(value) {
  return isObject(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 视觉布局决策允许的显式轴向取值；对齐不再由距离自动猜测。 */
export const AXIS_ALIGNMENT_VALUES = Object.freeze({ horizontal: new Set(["left", "center", "right"]), vertical: new Set(["top", "center", "bottom"]) });

/** 校验智能布局决策是否为完整且合法的双轴语义。 */
export function isValidAxisAlignment(value) {
  return isObject(value) && AXIS_ALIGNMENT_VALUES.horizontal.has(value.horizontal) && AXIS_ALIGNMENT_VALUES.vertical.has(value.vertical);
}

/** 按显式轴向决策计算偏移；center 使用子中心相对父中心的有符号距离。 */
export function axisAlignmentOffset(parentBounds, childBounds, alignment) {
  if (!isValidLayoutNodeBounds(parentBounds) || !isValidLayoutNodeBounds(childBounds) || !isValidAxisAlignment(alignment)) return null;
  const parentCenterX = parentBounds.x + parentBounds.width / 2; const parentCenterY = parentBounds.y + parentBounds.height / 2;
  const childCenterX = childBounds.x + childBounds.width / 2; const childCenterY = childBounds.y + childBounds.height / 2;
  const x = alignment.horizontal === "left" ? childBounds.x - parentBounds.x : alignment.horizontal === "right" ? -(parentBounds.x + parentBounds.width - childBounds.x - childBounds.width) : childCenterX - parentCenterX;
  const y = alignment.vertical === "top" ? childBounds.y - parentBounds.y : alignment.vertical === "bottom" ? -(parentBounds.y + parentBounds.height - childBounds.y - childBounds.height) : childCenterY - parentCenterY;
  return { x, y };
}

/** 判断视口尺寸是否为有限正数。 */
function isValidViewport(value) {
  return isObject(value)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 按布局合同要求比较相对距离，允许极小浮点误差。 */
function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-6;
}

/** 逐字段比较父容器边界；父节点引用要求同一组目标事实。 */
function exactBoundsEqual(left, right) {
  return isValidLayoutNodeBounds(left) && isValidLayoutNodeBounds(right)
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

/** 判断子边界是否完整落在父容器内容框内。 */
function containsBounds(parent, child) {
  return isValidLayoutNodeBounds(parent) && isValidLayoutNodeBounds(child)
    && child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

/** 返回布局节点在身份投影中的稳定字段；父子几何变化必须使旧 SHA 失效。 */
export function layoutNodeIdentityProjection(node) {
  return {
    layout_node_id: readLayoutNodeField(node, "layout_node_id", "layoutNodeId"),
    region_id: readLayoutNodeField(node, "region_id", "regionId"),
    coordinate_space: readLayoutNodeField(node, "coordinate_space", "coordinateSpace"),
    reference_id: readLayoutNodeField(node, "reference_id", "referenceId"),
    parent_layout_node_id: readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId"),
    parent_target_bounds: readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds"),
    relative_position: readLayoutNodeField(node, "relative_position", "relativePosition"),
    axis_alignment: readLayoutNodeField(node, "axis_alignment", "axisAlignment"),
    self_anchor: readLayoutNodeField(node, "self_anchor", "selfAnchor"),
    reference_anchor: readLayoutNodeField(node, "reference_anchor", "referenceAnchor"),
    offset: readLayoutNodeField(node, "offset"),
    target_bounds: readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds"),
    size_policy: readLayoutNodeField(node, "size_policy", "sizePolicy"),
    z_order: readLayoutNodeField(node, "z_order", "zOrder"),
    clip_policy: readLayoutNodeField(node, "clip_policy", "clipPolicy"),
    responsive_rule: readLayoutNodeField(node, "responsive_rule", "responsiveRule"),
    planned_test_id: readLayoutNodeField(node, "planned_test_id", "plannedTestId"),
    ui_layout: readLayoutNodeField(node, "ui_layout"),
  };
}

/** 创建统一的布局诊断，调用方可再补充场景合同上下文。 */
function diagnostic(index, node, message) {
  return {
    index,
    node_id: readLayoutNodeField(node, "layout_node_id", "layoutNodeId") ?? "*",
    message,
  };
}

/** 验证 effect-image 所有布局节点的父子几何和显式轴向对齐事实。 */
export function validateEffectImageParentChildLayoutNodes(nodes, targetViewport, { label = "layout_nodes" } = {}) {
  const diagnostics = [];
  const report = (index, node, message) => diagnostics.push(diagnostic(index, node, `${label}[${index}] ${message}`));
  const viewportBounds = isValidViewport(targetViewport)
    ? { x: 0, y: 0, width: targetViewport.width, height: targetViewport.height }
    : null;
  if (!viewportBounds) diagnostics.push({ index: -1, node_id: "*", message: `${label} 父级几何校验需要有效 target_viewport` });
  if (!Array.isArray(nodes) || nodes.length === 0) return diagnostics;

  const nodeById = new Map();
  const nodeIndexes = new Map();
  const parentById = new Map();
  const stableRoots = new Set(["viewport", "safe-area"]);
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) continue;
    const nodeId = readLayoutNodeField(node, "layout_node_id", "layoutNodeId");
    if (isString(nodeId) && !nodeById.has(nodeId)) {
      nodeById.set(nodeId, node);
      nodeIndexes.set(nodeId, index);
    }
  }

  // 先校验引用和字段类型，再统一解析父边界，避免每个入口各自推导一遍。
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) {
      report(index, node, "必须是对象");
      continue;
    }
    const nodeId = readLayoutNodeField(node, "layout_node_id", "layoutNodeId");
    const parentId = readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId");
    const referenceId = readLayoutNodeField(node, "reference_id", "referenceId");
    const parentBounds = readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds");
    const relative = readLayoutNodeField(node, "relative_position", "relativePosition");
    const alignment = readLayoutNodeField(node, "axis_alignment", "axisAlignment");
    const selfAnchor = readLayoutNodeField(node, "self_anchor", "selfAnchor");
    const referenceAnchor = readLayoutNodeField(node, "reference_anchor", "referenceAnchor");
    const offset = readLayoutNodeField(node, "offset");
    const targetBounds = readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds");

    if (!isString(nodeId)) report(index, node, "layout_node_id 必须是非空字符串");
    if (!isString(parentId)) report(index, node, "缺少或无效 parent_layout_node_id");
    if (!isString(referenceId)) report(index, node, "缺少或无效 reference_id");
    else if (isString(parentId) && referenceId !== parentId) report(index, node, "reference_id 必须等于 parent_layout_node_id");
    if (!isValidLayoutNodeBounds(parentBounds)) report(index, node, "parent_target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isValidLayoutNodeBounds(targetBounds)) report(index, node, "target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isObject(relative) || !["left", "right", "top", "bottom"].every((side) => Number.isFinite(relative[side]))) {
      report(index, node, "relative_position 必须包含有限的 left/right/top/bottom");
    } else if (["left", "right", "top", "bottom"].some((side) => relative[side] < 0)) {
      report(index, node, "relative_position 不允许出现负距离");
    }
    if (!isValidAxisAlignment(alignment)) report(index, node, "axis_alignment 必须声明合法 horizontal/vertical 轴向对齐");
    if (!isObject(offset) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) report(index, node, "effect-image offset 必须是由显式轴向对齐决策推导的有限 x/y 数值");
    if (!isString(selfAnchor)) report(index, node, "effect-image self_anchor 必须是 vertical-horizontal 字符串");
    if (!isString(referenceAnchor)) report(index, node, "effect-image reference_anchor 必须是 vertical-horizontal 字符串");

    if (isString(parentId)) {
      if (!stableRoots.has(parentId) && !nodeById.has(parentId)) report(index, node, `parent_layout_node_id 引用不存在的布局节点或稳定根：${parentId}`);
      if (parentId === nodeId) report(index, node, "parent_layout_node_id 不能自引用");
      if (nodeById.has(parentId)) parentById.set(nodeId, parentId);
    }
  }

  const states = new Map();
  /** 深度优先检查父子图，父节点只允许向根收敛，不能形成循环。 */
  function visit(nodeId, trail = []) {
    const state = states.get(nodeId) ?? 0;
    if (state === 1) {
      const index = nodeIndexes.get(nodeId) ?? -1;
      report(index, nodeById.get(nodeId), `父子布局图存在循环：${[...trail, nodeId].join(" -> ")}`);
      return;
    }
    if (state === 2) return;
    states.set(nodeId, 1);
    const parentId = parentById.get(nodeId);
    if (parentId) visit(parentId, [...trail, nodeId]);
    states.set(nodeId, 2);
  }
  for (const nodeId of [...parentById.keys()].sort()) visit(nodeId);

  let safeAreaBounds;
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) continue;
    const parentId = readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId");
    const parentBounds = readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds");
    const targetBounds = readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds");
    if (!isString(parentId) || !isValidLayoutNodeBounds(parentBounds) || !isValidLayoutNodeBounds(targetBounds)) continue;

    let expectedParentBounds;
    if (parentId === "viewport") expectedParentBounds = viewportBounds;
    else if (parentId === "safe-area") {
      // safe-area 没有第二套动态测量：第一个有效声明冻结唯一根边界，后续必须逐字段一致。
      if (!safeAreaBounds) safeAreaBounds = { ...parentBounds };
      expectedParentBounds = safeAreaBounds;
    } else expectedParentBounds = readLayoutNodeField(nodeById.get(parentId), "target_bounds", "targetBounds", "bounds");
    if (!expectedParentBounds) continue;

    if (!exactBoundsEqual(parentBounds, expectedParentBounds)) report(index, node, `parent_target_bounds 必须逐字段等于父节点/根的目标边界：${JSON.stringify(expectedParentBounds)}`);
    if ((parentId === "viewport" || parentId === "safe-area") && !containsBounds(viewportBounds, parentBounds)) report(index, node, "根 parent_target_bounds 必须完全位于 target_viewport 内");
    if (!containsBounds(parentBounds, targetBounds)) report(index, node, "child target_bounds 必须完全位于 parent_target_bounds 内容框内");

    const relative = readLayoutNodeField(node, "relative_position", "relativePosition");
    const alignment = readLayoutNodeField(node, "axis_alignment", "axisAlignment");
    const offset = readLayoutNodeField(node, "offset");
    if (!isObject(relative) || !isValidAxisAlignment(alignment) || !isObject(offset)) continue;
    const expectedRelative = {
      left: targetBounds.x - parentBounds.x,
      right: parentBounds.x + parentBounds.width - targetBounds.x - targetBounds.width,
      top: targetBounds.y - parentBounds.y,
      bottom: parentBounds.y + parentBounds.height - targetBounds.y - targetBounds.height,
    };
    for (const side of ["left", "right", "top", "bottom"]) if (!nearlyEqual(relative[side], expectedRelative[side])) report(index, node, `relative_position.${side} 必须由 child/parent bounds 精确推导，预期 ${expectedRelative[side]}`);
    // 对齐方向由智能视觉决策提供；几何校验只验证该决策对应的 offset，避免用距离反推审美意图。
    const expectedOffset = axisAlignmentOffset(parentBounds, targetBounds, alignment);
    if (!expectedOffset || !nearlyEqual(offset.x, expectedOffset.x)) report(index, node, `offset.x 必须由显式 ${alignment.horizontal} 对齐决策推导，预期 ${expectedOffset?.x}`);
    if (!expectedOffset || !nearlyEqual(offset.y, expectedOffset.y)) report(index, node, `offset.y 必须由显式 ${alignment.vertical} 对齐决策推导，预期 ${expectedOffset?.y}`);
    const expectedAnchor = `${alignment.vertical}-${alignment.horizontal}`;
    if (readLayoutNodeField(node, "self_anchor", "selfAnchor") !== expectedAnchor) report(index, node, `self_anchor 必须等于 ${expectedAnchor}`);
    if (readLayoutNodeField(node, "reference_anchor", "referenceAnchor") !== expectedAnchor) report(index, node, `reference_anchor 必须等于 ${expectedAnchor}`);
  }
  return diagnostics;
}
