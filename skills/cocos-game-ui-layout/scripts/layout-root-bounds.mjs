const ROOT_IDS = new Set(["viewport", "safe-area"]);

/** 判断根快照是否为有限坐标、正尺寸的矩形。 */
function isBounds(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.width > 0 && value.height > 0;
}

/** 精确比较冻结的根边界，防止不同节点持有不同安全区。 */
function sameBounds(left, right) {
  return ["x", "y", "width", "height"].every((key) => left[key] === right[key]);
}

/** 从整批节点冻结唯一根边界；安全区没有测量快照时才使用完整视口。 */
export function resolveLayoutRootBounds(nodes, canvas, label = "layout_nodes") {
  if (!Array.isArray(nodes) || ![canvas?.width, canvas?.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError(`${label} 根边界需要节点数组与有效画布尺寸`);
  }
  const viewport = { x: canvas.x ?? 0, y: canvas.y ?? 0, width: canvas.width, height: canvas.height };
  if (![viewport.x, viewport.y].every(Number.isFinite)) throw new TypeError(`${label} 根边界需要有限的画布原点`);
  const roots = new Map([["viewport", viewport]]);
  /** 所有根快照共同参与冻结，不能在某个入口将安全区重新扩大为画布。 */
  function record(id, bounds, source) {
    if (!ROOT_IDS.has(id) || bounds === undefined) return;
    if (!isBounds(bounds)) throw new TypeError(`${source} 必须是有效根边界`);
    if (bounds.x < viewport.x || bounds.y < viewport.y || bounds.x + bounds.width > viewport.x + viewport.width || bounds.y + bounds.height > viewport.y + viewport.height) {
      throw new TypeError(`${source} 根边界必须完全位于 viewport 内`);
    }
    if (roots.has(id) && !sameBounds(roots.get(id), bounds)) {
      throw new TypeError(`${source} ${id} 根快照必须逐字段一致`);
    }
    roots.set(id, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  }
  for (const [index, node] of nodes.entries()) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
    const parentId = node.parent_layout_node_id ?? node.parentLayoutNodeId;
    const referenceId = node.reference_id ?? node.referenceId ?? node.ui_layout?.position_reference_id ?? parentId;
    record(parentId, node.parent_target_bounds ?? node.parentTargetBounds, `${label}[${index}].parent_target_bounds`);
    record(referenceId, node.reference_target_bounds, `${label}[${index}].reference_target_bounds`);
    if (node.is_root_container === true) {
      record(node.layout_node_id ?? node.layoutNodeId, node.target_bounds ?? node.targetBounds ?? node.bounds, `${label}[${index}].target_bounds`);
    }
  }
  if (!roots.has("safe-area")) roots.set("safe-area", { ...viewport });
  return roots;
}
