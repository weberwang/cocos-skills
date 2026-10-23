/** 深拷贝测试快照，避免单个用例的字段篡改污染其他样本。 */
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)]));
}

/** 读取布局节点的 snake_case/camelCase 标识字段。 */
function field(value, snake, camel, fallback) {
  return value?.[snake] ?? value?.[camel] ?? fallback;
}

/** 构造 Widget 的六点原生 flag，供布局快照测试复用。 */
function makeWidget(planWidget) {
  if (!planWidget) return null;
  const widget = {
    enabled: true,
    target_id: planWidget.target_id,
    align_mode: planWidget.align_mode,
    is_align_left: false,
    is_align_right: false,
    is_align_top: false,
    is_align_bottom: false,
    is_align_horizontal_center: false,
    is_align_vertical_center: false,
    is_absolute_left: false,
    is_absolute_right: false,
    is_absolute_top: false,
    is_absolute_bottom: false,
    is_absolute_horizontal_center: false,
    is_absolute_vertical_center: false,
  };
  const axes = [
    [planWidget.horizontal, "horizontal"],
    [planWidget.vertical, "vertical"],
  ];
  for (const [axis, name] of axes) {
    if (!axis) continue;
    const entries = name === "horizontal"
      ? { left: ["is_align_left", "left"], right: ["is_align_right", "right"], center: ["is_align_horizontal_center", "horizontal_center"] }
      : { top: ["is_align_top", "top"], bottom: ["is_align_bottom", "bottom"], center: ["is_align_vertical_center", "vertical_center"] };
    if (axis.alignment === "stretch") {
      const start = name === "horizontal" ? "left" : "top";
      const end = name === "horizontal" ? "right" : "bottom";
      const startFlag = entries[start][0];
      const endFlag = entries[end][0];
      widget[startFlag] = widget[endFlag] = true;
      widget[entries[start][1]] = axis.start;
      widget[entries[end][1]] = axis.end;
      widget[name === "horizontal" ? "is_absolute_left" : "is_absolute_top"] = true;
      widget[name === "horizontal" ? "is_absolute_right" : "is_absolute_bottom"] = true;
    } else {
      const [flag, valueField] = entries[axis.alignment] ?? [];
      if (!flag) continue;
      widget[flag] = true;
      widget[valueField] = axis.value;
      const absoluteField = flag.replace("is_align_", "is_absolute_");
      widget[absoluteField] = true;
    }
  }
  return widget;
}

/** 构造单节点快照；覆盖项可精确模拟被错误配置的原生组件。 */
export function createLayoutRuntimeSnapshot(node, { parentNode, ...overrides } = {}) {
  const plan = node.layout_execution ?? {};
  const target = field(node, "target_bounds", "targetBounds", node.bounds) ?? { width: 1, height: 1 };
  const parentId = field(node, "parent_layout_node_id", "parentLayoutNodeId", null);
  const referenceId = node.reference_id
    ?? node.ui_layout?.position_reference_id
    ?? node.uiLayout?.positionReferenceId
    ?? parentId;
  const parentBounds = parentNode?.layout_bounds
    ?? parentNode?.component_snapshot?.layout_bounds
    ?? parentNode?.target_bounds
    ?? field(node, "parent_target_bounds", "parentTargetBounds");
  const referenceBounds = overrides.reference_bounds
    ?? node.reference_target_bounds
    ?? node.referenceTargetBounds
    ?? (referenceId === parentId ? parentBounds : undefined)
    ?? field(node, "parent_target_bounds", "parentTargetBounds")
    ?? { x: 0, y: 0, width: 200, height: 100 };
  const geometry = node.sprite_geometry;
  const parentLayout = parentNode?.layout
    ?? parentNode?.component_snapshot?.layout
    ?? parentNode?.runtime_layout
    ?? (plan.position_driver === "LAYOUT"
      ? { enabled: true, type: "HORIZONTAL", resize_mode: "NONE", align_horizontal: false, align_vertical: false }
      : null);
  let ownLayout = node.runtime_layout ?? node.layout_snapshot ?? node.component_snapshot?.layout ?? null;
  if (ownLayout === null && plan.size_driver === "LAYOUT") {
    ownLayout = { enabled: true, type: "HORIZONTAL", resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false };
  }
  const active = overrides.active ?? node.active !== false;
  const originalSize = node.sprite_original_size ?? { width: target.width, height: target.height };
  const snapshot = {
    active,
    parent_layout_node_id: field(node, "parent_layout_node_id", "parentLayoutNodeId", null),
    position_writers: active && plan.position_driver ? [plan.position_driver] : [],
    size_writers: active && plan.size_driver ? [plan.size_driver] : [],
    widget: makeWidget(plan.widget),
    layout: ownLayout === null ? null : copy(ownLayout),
    parent_layout: parentLayout === null ? null : copy(parentLayout),
    ui_transform: { width: target.width, height: target.height },
    layout_bounds: copy(target),
    reference_bounds: copy(referenceBounds),
    sprite: geometry == null ? null : {
      type: geometry.type,
      size_mode: geometry.size_mode,
      original_size: copy(originalSize),
    },
    node_to_layout: { a: 1, b: 0, c: 0, d: 1 },
    reference_to_layout: { a: 1, b: 0, c: 0, d: 1 },
  };
  return { ...snapshot, ...copy(overrides) };
}

/** 为完整节点列表补齐快照，并同步每个子项看到的父 Layout 配置。 */
export function attachLayoutRuntimeSnapshots(nodes, measurements) {
  if (!Array.isArray(nodes) || !Array.isArray(measurements)) throw new TypeError("测试快照需要 nodes 与 measurements 数组");
  const nodesById = new Map(nodes.map((node) => [field(node, "layout_node_id", "layoutNodeId"), node]));
  const rowsById = new Map(measurements.map((item) => [field(item, "layout_node_id", "layoutNodeId"), item]));
  const childrenByParent = new Map();
  for (const node of nodes) {
    const parentId = field(node, "parent_layout_node_id", "parentLayoutNodeId", null);
    if (typeof parentId !== "string") continue;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  }

  const parentLayouts = new Map();
  for (const [id, node] of nodesById) {
    const rowSnapshot = rowsById.get(id)?.component_snapshot;
    const explicitLayout = rowSnapshot && Object.hasOwn(rowSnapshot, "layout")
      ? rowSnapshot.layout
      : node.runtime_layout ?? node.layout_snapshot ?? node.component_snapshot?.layout ?? null;
    if (explicitLayout !== null) parentLayouts.set(id, copy(explicitLayout));
  }
  for (const [parentId, children] of childrenByParent) {
    if (parentLayouts.has(parentId)) continue;
    const activeChildren = children.filter((node) => node.active !== false);
    if (activeChildren.length > 0 && activeChildren.every((node) => node.layout_execution?.position_driver === "LAYOUT")) {
      parentLayouts.set(parentId, { enabled: true, type: "HORIZONTAL", resize_mode: "NONE", align_horizontal: false, align_vertical: false });
    }
  }

  return measurements.map((measurement) => {
    const id = field(measurement, "layout_node_id", "layoutNodeId");
    const node = nodesById.get(id);
    if (!node) return measurement;
    if (Object.hasOwn(measurement, "component_snapshot")) return measurement;
    const parentId = field(node, "parent_layout_node_id", "parentLayoutNodeId", null);
    const sourceParentNode = nodesById.get(parentId);
    const parentLayout = parentLayouts.get(parentId) ?? null;
    const parentMeasurement = rowsById.get(parentId)?.component_snapshot;
    const referenceId = node.reference_id
      ?? node.ui_layout?.position_reference_id
      ?? node.uiLayout?.positionReferenceId
      ?? parentId;
    const referenceMeasurement = rowsById.get(referenceId)?.component_snapshot;
    const referenceNode = nodesById.get(referenceId);
    const referenceBounds = referenceMeasurement?.layout_bounds
      ?? field(referenceNode, "target_bounds", "targetBounds", referenceNode?.bounds)
      ?? node.reference_target_bounds
      ?? node.referenceTargetBounds
      ?? field(node, "parent_target_bounds", "parentTargetBounds")
      ?? { x: 0, y: 0, width: 200, height: 100 };
    const parentSnapshot = sourceParentNode
      ? {
        ...sourceParentNode,
        active: sourceParentNode.active !== false,
        layout: parentLayout,
        layout_bounds: parentMeasurement?.layout_bounds
          ?? field(sourceParentNode, "target_bounds", "targetBounds", sourceParentNode.bounds),
      }
      : { active: true, layout: parentLayout };
    const snapshot = createLayoutRuntimeSnapshot(node, {
      parentNode: parentSnapshot,
      parent_layout: parentLayout,
      reference_bounds: referenceBounds,
    });
    if (parentLayouts.has(id)) snapshot.layout = copy(parentLayouts.get(id));
    return { ...measurement, component_snapshot: snapshot };
  });
}
