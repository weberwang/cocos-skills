/**
 * effect-image 布局节点的父子几何合同。
 *
 * 该模块只保留一份父容器、相对距离、轴向对齐和运行时偏移的推导规则，
 * 场景拆解、UI 布局合同和视觉资源映射入口都必须消费这里的诊断结果。
 */

import { allowsVisualOverflow, positionReferenceId, validateUiPositionReferences } from "../../cocos-game-asset-integration/scripts/ui-layout-organization.mjs";
import { validateSpriteGeometry } from "../../cocos-game-ui-layout/scripts/sprite-layout-sizing.mjs";
import { validateContainerRootReuse } from "../../cocos-game-asset-integration/scripts/container-root-policy.mjs";
import { isLayoutContainer } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";
import { validateCenterAlignmentNodes } from "../../cocos-game-ui-layout/scripts/center-alignment.mjs";
import { validateLayoutExecutionNodes } from "../../cocos-game-ui-layout/scripts/widget-layout.mjs";

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
    reference_target_bounds: readLayoutNodeField(node, "reference_target_bounds"),
    relative_position: readLayoutNodeField(node, "relative_position", "relativePosition"),
    axis_alignment: readLayoutNodeField(node, "axis_alignment", "axisAlignment"),
    center_alignment: readLayoutNodeField(node, "center_alignment"),
    layout_execution: node.layout_execution,
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
    sprite_geometry: readLayoutNodeField(node, "sprite_geometry"),
    render_kind: readLayoutNodeField(node, "render_kind"),
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
export function validateEffectImageParentChildLayoutNodes(nodes, targetViewport, { label = "layout_nodes", requireExecutionPlan = false } = {}) {
  const diagnostics = [];
  const report = (index, node, message) => diagnostics.push(diagnostic(index, node, `${label}[${index}] ${message}`));
  const viewportBounds = isValidViewport(targetViewport)
    ? { x: 0, y: 0, width: targetViewport.width, height: targetViewport.height }
    : null;
  if (!viewportBounds) diagnostics.push({ index: -1, node_id: "*", message: `${label} 父级几何校验需要有效 target_viewport` });
  if (!Array.isArray(nodes) || nodes.length === 0) return diagnostics;
  const centerErrors = [];
  // 入口统一现有合同字段后再调用纯几何模块，避免不同命名入口使用不同居中规则。
  const centeringNodes = nodes.filter(isObject).map((node) => ({
    ...node,
    layout_node_id: readLayoutNodeField(node, "layout_node_id", "layoutNodeId"),
    parent_layout_node_id: readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId"),
    axis_alignment: readLayoutNodeField(node, "axis_alignment", "axisAlignment"),
    target_bounds: readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds"),
    parent_target_bounds: readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds"),
  }));
  validateCenterAlignmentNodes(centeringNodes, centerErrors, label, targetViewport);
  validateLayoutExecutionNodes(centeringNodes, centerErrors, label, { requirePlan: requireExecutionPlan });
  for (const message of centerErrors) diagnostics.push({ index: -1, node_id: "*", message });

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
    // 合成根只存在于 root_nodes；业务节点不能借根标记跳过执行计划与控制权检查。
    if (node.is_root_container === true) report(index, node, "layout_nodes 必须是非 root 业务节点，不能声明 is_root_container=true");
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
    else if (referenceId !== positionReferenceId(node, parentId)) report(index, node, "reference_id 必须等于 ui_layout.position_reference_id 或未声明时的实际父级");
    if (!isValidLayoutNodeBounds(parentBounds)) report(index, node, "parent_target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isValidLayoutNodeBounds(targetBounds)) report(index, node, "target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isObject(relative) || !["left", "right", "top", "bottom"].every((side) => Number.isFinite(relative[side]))) {
      report(index, node, "relative_position 必须包含有限的 left/right/top/bottom");
    }
    if (!isValidAxisAlignment(alignment)) report(index, node, "axis_alignment 必须声明合法 horizontal/vertical 轴向对齐");
    if (!isObject(offset) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) report(index, node, "effect-image offset 必须是由显式轴向对齐决策推导的有限 x/y 数值");
    if (!isString(selfAnchor)) report(index, node, "effect-image self_anchor 必须是 vertical-horizontal 字符串");
    if (!isString(referenceAnchor)) report(index, node, "effect-image reference_anchor 必须是 vertical-horizontal 字符串");

    if (isString(parentId)) {
      if (!stableRoots.has(parentId) && !nodeById.has(parentId)) report(index, node, `parent_layout_node_id 引用不存在的布局节点或稳定根：${parentId}`);
      if (nodeById.has(parentId) && !isLayoutContainer(nodeById.get(parentId))) report(index, node, "parent_layout_node_id 必须引用显式容器，底板图片须声明兼任父容器");
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

  const canonicalNodes = nodes.filter(isObject).map((node) => ({
    element_id: readLayoutNodeField(node, "layout_node_id", "layoutNodeId"),
    parent_element_id: readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId"),
    ui_layout: node.ui_layout, scene_id: node.scene_id, state_id: node.state_id,
    coordinate_space: node.coordinate_space, role: node.layout_role ?? node.role, region_layer: node.region_layer, visual_route_element_type: node.visual_route_element_type,
  }));
  const referenceErrors = [];
  validateUiPositionReferences(canonicalNodes, referenceErrors, label);
  validateContainerRootReuse(nodes, referenceErrors, label);
  for (const message of referenceErrors) diagnostics.push({ index: -1, node_id: "*", message });

  // 安全区参照也可能只被兄弟定位引用；冻结第一份有效根边界并复核所有快照。
  let safeAreaBounds = nodes.filter(isObject).map((node) => {
    if (readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId") === "safe-area") return readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds");
    if (readLayoutNodeField(node, "reference_id", "referenceId") === "safe-area") return node.reference_target_bounds;
    return null;
  }).find(isValidLayoutNodeBounds);
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
    if (!containsBounds(parentBounds, targetBounds) && (stableRoots.has(parentId) || !allowsVisualOverflow(node.ui_layout))) report(index, node, "child target_bounds 必须完全位于 parent_target_bounds 内容框内，或在非根父级下声明 visual_overflow.reason");
    // 允许超出功能父框不代表允许越过画布或安全区；参照不同也不能放宽可见边界。
    if (viewportBounds && !containsBounds(viewportBounds, targetBounds)) report(index, node, "target_bounds 必须完全位于 target_viewport 内");
    let ancestor = parentId;
    const ancestors = new Set();
    while (nodeById.has(ancestor) && !ancestors.has(ancestor)) {
      ancestors.add(ancestor);
      ancestor = readLayoutNodeField(nodeById.get(ancestor), "parent_layout_node_id", "parentLayoutNodeId");
    }
    if (ancestor === "safe-area" && isValidLayoutNodeBounds(safeAreaBounds) && !containsBounds(safeAreaBounds, targetBounds)) report(index, node, "target_bounds 超出归属稳定根 safe-area，visual_overflow 不能放宽安全区");

    const referenceId = readLayoutNodeField(node, "reference_id", "referenceId");
    let referenceBounds;
    if (referenceId === parentId) referenceBounds = expectedParentBounds;
    else if (referenceId === "viewport") referenceBounds = viewportBounds;
    else if (referenceId === "safe-area") referenceBounds = safeAreaBounds ?? viewportBounds;
    else referenceBounds = readLayoutNodeField(nodeById.get(referenceId), "target_bounds", "targetBounds", "bounds");
    const referenceSnapshot = node.reference_target_bounds;
    if (!isValidLayoutNodeBounds(referenceBounds)) report(index, node, "reference_id 缺少可复核的定位参照边界");
    else if ((referenceId !== parentId || referenceSnapshot !== undefined) && !exactBoundsEqual(referenceSnapshot, referenceBounds)) report(index, node, "reference_target_bounds 必须逐字段等于定位参照的目标边界");
    if (stableRoots.has(referenceId) && isValidLayoutNodeBounds(referenceBounds) && !containsBounds(viewportBounds, referenceBounds)) report(index, node, "根 reference_target_bounds 必须完全位于 target_viewport 内");

    const spriteErrors = [];
    validateSpriteGeometry(node, spriteErrors, `${label}[${index}]`);
    for (const message of spriteErrors) report(index, node, message);

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
    const expectedOffset = axisAlignmentOffset(referenceBounds, targetBounds, alignment);
    if (!expectedOffset || !nearlyEqual(offset.x, expectedOffset.x)) report(index, node, `offset.x 必须由显式 ${alignment.horizontal} 对齐决策推导，预期 ${expectedOffset?.x}`);
    if (!expectedOffset || !nearlyEqual(offset.y, expectedOffset.y)) report(index, node, `offset.y 必须由显式 ${alignment.vertical} 对齐决策推导，预期 ${expectedOffset?.y}`);
    const expectedAnchor = `${alignment.vertical}-${alignment.horizontal}`;
    if (readLayoutNodeField(node, "self_anchor", "selfAnchor") !== expectedAnchor) report(index, node, `self_anchor 必须等于 ${expectedAnchor}`);
    if (readLayoutNodeField(node, "reference_anchor", "referenceAnchor") !== expectedAnchor) report(index, node, `reference_anchor 必须等于 ${expectedAnchor}`);
  }
  return diagnostics;
}
