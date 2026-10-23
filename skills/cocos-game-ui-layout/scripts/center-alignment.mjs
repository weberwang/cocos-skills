import { resolveLayoutRootBounds } from "./layout-root-bounds.mjs";

const AXES = Object.freeze(["horizontal", "vertical"]);
const ALIGNMENT_VALUES = Object.freeze({
  horizontal: new Set(["left", "center", "right"]),
  vertical: new Set(["top", "center", "bottom"]),
});
const STABLE_ROOTS = new Set(["viewport", "safe-area"]);
const EPSILON = 1e-6;

/** 判断值是否为普通对象。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含非空白字符。 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断矩形是否包含有限坐标和正尺寸。 */
function isBounds(value) {
  return isRecord(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 校验策略对象只包含合同允许的字段。 */
function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} 不支持字段 ${key}`);
  }
}

/** 规范化严格居中和带理由的中心参照策略。 */
export function normalizeCenterAlignment(axisAlignment, value, label = "center_alignment") {
  if (!isRecord(axisAlignment)
    || !ALIGNMENT_VALUES.horizontal.has(axisAlignment.horizontal)
    || !ALIGNMENT_VALUES.vertical.has(axisAlignment.vertical)) {
    throw new TypeError(`${label} 需要合法的 horizontal/vertical axis_alignment`);
  }
  if (value !== undefined && !isRecord(value)) throw new TypeError(`${label} 必须是对象`);
  const source = value ?? {};
  assertOnlyKeys(source, new Set([...AXES, "member_ids"]), label);

  const result = {};
  for (const axis of AXES) {
    const isDeclared = Object.hasOwn(source, axis);
    if (isDeclared && axisAlignment[axis] !== "center") {
      throw new TypeError(`${label}.${axis} 只能用于 ${axis} 轴 center 对齐`);
    }
    if (axisAlignment[axis] !== "center") continue;
    result[axis] = isDeclared
      ? normalizeAxisPolicy(source[axis], `${label}.${axis}`)
      : { mode: "strict" };
  }

  if (Object.hasOwn(source, "member_ids")) {
    const memberIds = source.member_ids;
    if (!Array.isArray(memberIds) || memberIds.length < 2
      || memberIds.some((id) => !isNonEmptyString(id))
      || new Set(memberIds).size !== memberIds.length) {
      throw new TypeError(`${label}.member_ids 必须包含至少两个唯一的非空节点 id`);
    }
    result.member_ids = [...memberIds];
  }

  return value === undefined ? (Object.keys(result).length === 0 ? undefined : result) : result;
}

/** 规范化单轴策略；所有允许偏移的策略都必须说明设计理由。 */
function normalizeAxisPolicy(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} 必须是对象`);
  if (value.mode === "strict") {
    assertOnlyKeys(value, new Set(["mode"]), label);
    return { mode: "strict" };
  }
  if (value.mode === "reference") {
    assertOnlyKeys(value, new Set(["mode", "offset", "reason"]), label);
    if (!Object.hasOwn(value, "offset") || !Number.isFinite(value.offset)) {
      throw new TypeError(`${label}.offset 必须是有限数值`);
    }
    if (!isNonEmptyString(value.reason)) throw new TypeError(`${label}.reason 必须是非空字符串`);
    return { mode: "reference", offset: value.offset, reason: value.reason.trim() };
  }
  throw new TypeError(`${label}.mode 只支持 strict 或 reference`);
}

/** 深拷贝 JSON 风格数据，避免布局推导修改调用方对象。 */
function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
}

/** 读取节点的有效目标矩形。 */
function readNodeBounds(node, label) {
  const bounds = node.target_bounds ?? node.bounds;
  if (!isBounds(bounds)) throw new TypeError(`${label}.target_bounds/bounds 必须包含有限 x/y 和正数 width/height`);
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** 读取父级和定位参照 id；未显式指定时使用实际父级。 */
function readNodeRelations(node, label) {
  const id = node.layout_node_id;
  const parentId = node.parent_layout_node_id;
  const explicitReference = node.ui_layout?.position_reference_id;
  const referenceId = explicitReference ?? parentId;
  if (!isNonEmptyString(id)) throw new TypeError(`${label}.layout_node_id 必须是非空字符串`);
  if (!isNonEmptyString(parentId)) throw new TypeError(`${label}.parent_layout_node_id 必须是非空字符串`);
  if (!isNonEmptyString(referenceId)) throw new TypeError(`${label}.ui_layout.position_reference_id 或父级必须是非空字符串`);
  return { id, parentId, referenceId };
}

/** 构造规范的画布根矩形；稳定根均使用同一画布坐标系。 */
function normalizeCanvas(canvas, label) {
  if (!isRecord(canvas)) throw new TypeError(`${label} 使用 viewport/safe-area 时需要 canvas 对象`);
  const bounds = {
    x: canvas.x ?? 0,
    y: canvas.y ?? 0,
    width: canvas.width,
    height: canvas.height,
  };
  if (!isBounds(bounds)) throw new TypeError(`${label}.canvas 必须包含有限原点和正数宽高`);
  return bounds;
}

/** 检查同组成员的内部定位参照不存在循环。 */
function validateInternalGroupReferences(group, records) {
  const state = new Map();
  /** 用三态深度遍历检测组内参照链的回边。 */
  const visit = (id, trail) => {
    const current = state.get(id) ?? 0;
    if (current === 1) throw new TypeError(`center_alignment.member_ids 组内定位参照存在循环：${[...trail, id].join(" -> ")}`);
    if (current === 2) return;
    state.set(id, 1);
    const referenceId = records.get(id).referenceId;
    if (group.memberSet.has(referenceId)) visit(referenceId, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of group.memberIds) visit(id, []);
}

/** 校验节点身份、策略和虚拟图文组，并建立共享解析模型。 */
function buildModel(nodes, label) {
  if (!Array.isArray(nodes)) throw new TypeError(`${label} 必须是数组`);
  const records = new Map();
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node)) throw new TypeError(`${label}[${index}] 必须是对象`);
    const nodeLabel = `${label}[${index}]`;
    const { id, parentId, referenceId } = readNodeRelations(node, nodeLabel);
    if (records.has(id)) throw new TypeError(`${label} 存在重复 layout_node_id：${id}`);
    const bounds = readNodeBounds(node, nodeLabel);
    const alignment = node.axis_alignment;
    const normalized = normalizeCenterAlignment(alignment, node.center_alignment, `${nodeLabel}.center_alignment`);
    records.set(id, {
      id, node, index, parentId, referenceId, bounds, alignment,
      sourceCenterAlignment: node.center_alignment,
      normalizedCenterAlignment: normalized,
    });
  }

  for (const record of records.values()) {
    const { id, parentId, referenceId } = record;
    if (parentId === id) throw new TypeError(`${label}.${id}.parent_layout_node_id 不能自引用`);
    if (referenceId === id) throw new TypeError(`${label}.${id}.position_reference_id 不能自引用`);
    if (!STABLE_ROOTS.has(parentId) && !records.has(parentId)) {
      throw new TypeError(`${label}.${id}.parent_layout_node_id 引用不存在节点或稳定根：${parentId}`);
    }
    if (!STABLE_ROOTS.has(referenceId) && !records.has(referenceId)) {
      throw new TypeError(`${label}.${id}.position_reference_id 引用不存在节点或稳定根：${referenceId}`);
    }
  }

  const groups = new Map();
  const nodeToGroup = new Map();
  for (const leader of records.values()) {
    const memberIds = leader.normalizedCenterAlignment?.member_ids;
    if (!memberIds) continue;
    if (!memberIds.includes(leader.id)) {
      throw new TypeError(`${label}.${leader.id}.center_alignment.member_ids 必须包含组 leader 自身`);
    }
    const memberSet = new Set(memberIds);
    const controlAxes = AXES.filter((axis) => leader.alignment[axis] === "center");
    if (controlAxes.length === 0) throw new TypeError(`${label}.${leader.id} 的虚拟组至少需要一个 center 对齐控制轴`);
    if (memberSet.has(leader.referenceId)) {
      throw new TypeError(`${label}.${leader.id} 的组 leader 定位参照必须位于组外`);
    }
    const members = memberIds.map((id) => {
      const member = records.get(id);
      if (!member) throw new TypeError(`${label}.${leader.id} 的虚拟组缺少成员：${id}`);
      return member;
    });

    for (const member of members) {
      if (nodeToGroup.has(member.id)) throw new TypeError(`${label}.${member.id} 同时属于多个虚拟居中组`);
      if (member.parentId !== leader.parentId) throw new TypeError(`${label}.${leader.id} 的组成员必须具有相同父节点`);
      for (const field of ["scene_id", "state_id", "coordinate_space"]) {
        if (Object.hasOwn(member.node, field) && Object.hasOwn(leader.node, field)
          && member.node[field] !== leader.node[field]) {
          throw new TypeError(`${label}.${leader.id} 的组成员 ${field} 必须一致`);
        }
      }
      if (member.id !== leader.id) {
        if (Object.hasOwn(member.sourceCenterAlignment ?? {}, "member_ids")) {
          throw new TypeError(`${label}.${member.id} 不能在虚拟居中组内再定义 member_ids`);
        }
        for (const axis of controlAxes) {
          if (Object.hasOwn(member.sourceCenterAlignment ?? {}, axis)) {
            throw new TypeError(`${label}.${member.id}.center_alignment.${axis} 不能覆盖组 leader 的控制策略`);
          }
        }
      }
      if (member.parentId !== leader.id && member.id !== leader.id && member.parentId !== leader.parentId) {
        throw new TypeError(`${label}.${leader.id} 的父子成员不能同时属于同一虚拟组`);
      }
      if (!memberSet.has(member.referenceId) && member.referenceId !== leader.referenceId) {
        throw new TypeError(`${label}.${member.id} 的组外定位参照必须与 leader 相同`);
      }
      if (member.referenceId === member.id) throw new TypeError(`${label}.${member.id} 不能引用自身定位`);
      nodeToGroup.set(member.id, leader.id);
    }

    const group = { leaderId: leader.id, memberIds, memberSet, members, controlAxes };
    validateInternalGroupReferences(group, records);
    groups.set(leader.id, group);
  }

  for (const group of groups.values()) {
    for (const member of group.members) {
      if (member.parentId !== group.leaderId && group.memberSet.has(member.parentId)) {
        throw new TypeError(`${label}.${group.leaderId} 的虚拟组不能包含父子成员`);
      }
    }
  }

  return { records, groups, nodeToGroup };
}

/** 为普通布局节点保留所选边缘间距，center 轴由显式中心策略控制。 */
function resolveAxisPosition(axis, record, originalReference, currentReference, policy) {
  const bounds = record.bounds;
  if (record.alignment[axis] === "center") {
    const referenceCenter = axis === "horizontal"
      ? currentReference.x + currentReference.width / 2
      : currentReference.y + currentReference.height / 2;
    const size = axis === "horizontal" ? bounds.width : bounds.height;
    const offset = policy.mode === "reference" ? policy.offset : 0;
    return referenceCenter + offset - size / 2;
  }

  if (axis === "horizontal") {
    if (record.alignment.horizontal === "left") return currentReference.x + (bounds.x - originalReference.x);
    const rightGap = originalReference.x + originalReference.width - bounds.x - bounds.width;
    return currentReference.x + currentReference.width - rightGap - bounds.width;
  }
  if (record.alignment.vertical === "top") return currentReference.y + (bounds.y - originalReference.y);
  const bottomGap = originalReference.y + originalReference.height - bounds.y - bounds.height;
  return currentReference.y + currentReference.height - bottomGap - bounds.height;
}

/** 计算节点的原始和当前参照矩形。 */
function referenceBoundsFor(record, records, resolved, canvasBounds, useResolved) {
  if (STABLE_ROOTS.has(record.referenceId)) return readStableRootBounds(record, canvasBounds);
  const reference = records.get(record.referenceId);
  return useResolved ? resolved.get(reference.id) : reference.bounds;
}

/** 解析依赖单元的顺序，拒绝参照移动形成的组合循环。 */
function orderUnits(model, label) {
  /** 将组成员映射到同一调度单元，防止成员被分开移动。 */
  const unitOf = (id) => {
    const groupLeader = model.nodeToGroup.get(id);
    return groupLeader ? `group:${groupLeader}` : `node:${id}`;
  };
  const units = new Map();
  for (const record of model.records.values()) {
    const key = unitOf(record.id);
    if (!units.has(key)) units.set(key, { key, groupLeader: key.startsWith("group:") ? key.slice(6) : null, dependencies: new Set() });
  }

  for (const unit of units.values()) {
    const memberIds = unit.groupLeader ? model.groups.get(unit.groupLeader).memberIds : [unit.key.slice(5)];
    for (const id of memberIds) {
      const record = model.records.get(id);
      for (const relationId of [record.parentId, record.referenceId]) {
        if (STABLE_ROOTS.has(relationId)) continue;
        const dependency = unitOf(relationId);
        if (dependency !== unit.key) unit.dependencies.add(dependency);
      }
    }
  }

  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  /** 先处理父级和定位参照依赖，再加入当前单元。 */
  const visit = (key, trail) => {
    if (visiting.has(key)) throw new TypeError(`${label} 父级/定位参照依赖存在组合循环：${[...trail, key].join(" -> ")}`);
    if (visited.has(key)) return;
    const unit = units.get(key);
    visiting.add(key);
    for (const dependency of [...unit.dependencies].sort()) visit(dependency, [...trail, key]);
    visiting.delete(key);
    visited.add(key);
    ordered.push(unit);
  };
  for (const key of [...units.keys()].sort()) visit(key, []);
  return ordered;
}

/** 返回成员参照依赖优先的组内顺序，方便处理非组控制轴。 */
function orderGroupMembers(group, records) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  /** 仅对组内定位参照排序，保证非控制轴计算时先得到参照成员。 */
  const visit = (id) => {
    if (visiting.has(id)) throw new TypeError(`虚拟组 ${group.leaderId} 存在定位参照循环`);
    if (visited.has(id)) return;
    visiting.add(id);
    const referenceId = records.get(id).referenceId;
    if (group.memberSet.has(referenceId)) visit(referenceId);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const id of group.memberIds) visit(id);
  return ordered;
}

/** 将解析坐标写入副本的 bounds/target_bounds，保留各自宽高。 */
function writeResolvedPosition(outputNode, x, y) {
  for (const field of ["target_bounds", "bounds"]) {
    if (!isRecord(outputNode[field])) continue;
    outputNode[field] = { ...outputNode[field], x, y };
  }
}

/** 按父级与定位参照依赖更新位置，保留原尺寸并规范化中心策略。 */
export function resolveCenteredLayoutNodes(nodes, canvas) {
  const label = "layout_nodes";
  const model = buildModel(nodes, label);
  const hasStableRoot = [...model.records.values()].some((record) =>
    STABLE_ROOTS.has(record.parentId) || STABLE_ROOTS.has(record.referenceId));
  const canvasBounds = hasStableRoot ? normalizeCanvas(canvas, label) : null;
  // 全部节点共用一份安全区快照，避免未重复携带快照的节点错误地按整屏居中。
  const stableRootBounds = hasStableRoot ? resolveLayoutRootBounds(nodes, canvasBounds, label) : null;
  for (const record of model.records.values()) record.stableRootBounds = stableRootBounds;
  const resolved = new Map();
  const outputById = new Map();
  const output = nodes.map((node) => {
    const copy = cloneValue(node);
    outputById.set(node.layout_node_id, copy);
    return copy;
  });
  const orderedUnits = orderUnits(model, label);

  for (const unit of orderedUnits) {
    if (!unit.groupLeader) {
      const record = model.records.get(unit.key.slice(5));
      const originalReference = referenceBoundsFor(record, model.records, resolved, canvasBounds, false);
      const currentReference = referenceBoundsFor(record, model.records, resolved, canvasBounds, true);
      const policies = record.normalizedCenterAlignment ?? {};
      const x = resolveAxisPosition("horizontal", record, originalReference, currentReference, policies.horizontal ?? { mode: "strict" });
      const y = resolveAxisPosition("vertical", record, originalReference, currentReference, policies.vertical ?? { mode: "strict" });
      const currentBounds = { ...record.bounds, x, y };
      resolved.set(record.id, currentBounds);
      const outputNode = outputById.get(record.id);
      writeResolvedPosition(outputNode, x, y);
      if (record.normalizedCenterAlignment !== undefined) outputNode.center_alignment = cloneValue(record.normalizedCenterAlignment);
      else delete outputNode.center_alignment;
      continue;
    }

    const group = model.groups.get(unit.groupLeader);
    const leader = model.records.get(group.leaderId);
    const leaderPolicies = leader.normalizedCenterAlignment ?? {};
    const groupUnion = unionBounds(group.members.map((member) => member.bounds));
    const leaderReferenceOriginal = referenceBoundsFor(leader, model.records, resolved, canvasBounds, false);
    const leaderReferenceCurrent = referenceBoundsFor(leader, model.records, resolved, canvasBounds, true);
    const groupDeltas = { horizontal: 0, vertical: 0 };

    for (const axis of group.controlAxes) {
      const policy = leaderPolicies[axis] ?? { mode: "strict" };
      const refCenter = axis === "horizontal"
        ? leaderReferenceCurrent.x + leaderReferenceCurrent.width / 2
        : leaderReferenceCurrent.y + leaderReferenceCurrent.height / 2;
      const unionCenter = axis === "horizontal"
        ? groupUnion.x + groupUnion.width / 2
        : groupUnion.y + groupUnion.height / 2;
      const desiredCenter = refCenter + (policy.mode === "reference" ? policy.offset : 0);
      groupDeltas[axis] = desiredCenter - unionCenter;
    }

    // 组控制轴只根据联合框计算一次平移，避免各成员分别居中后破坏间距。
    for (const member of group.members) {
      const next = { ...member.bounds };
      if (group.controlAxes.includes("horizontal")) next.x += groupDeltas.horizontal;
      if (group.controlAxes.includes("vertical")) next.y += groupDeltas.vertical;
      resolved.set(member.id, next);
    }

    const memberOrder = orderGroupMembers(group, model.records);
    for (const id of memberOrder) {
      const member = model.records.get(id);
      const current = resolved.get(id);
      const originalReference = referenceBoundsFor(member, model.records, resolved, canvasBounds, false);
      const currentReference = referenceBoundsFor(member, model.records, resolved, canvasBounds, true);
      const policies = member.normalizedCenterAlignment ?? {};
      if (!group.controlAxes.includes("horizontal")) {
        current.x = resolveAxisPosition("horizontal", member, originalReference, currentReference, policies.horizontal ?? { mode: "strict" });
      }
      if (!group.controlAxes.includes("vertical")) {
        current.y = resolveAxisPosition("vertical", member, originalReference, currentReference, policies.vertical ?? { mode: "strict" });
      }
    }

    for (const member of group.members) {
      const current = resolved.get(member.id);
      const outputNode = outputById.get(member.id);
      writeResolvedPosition(outputNode, current.x, current.y);
      const normalized = { ...(member.normalizedCenterAlignment ?? {}) };
      delete normalized.member_ids;
      // 组控制轴由 leader 接管，成员不输出会造成误判的隐式 strict 策略。
      if (member.id !== group.leaderId) {
        for (const axis of group.controlAxes) delete normalized[axis];
      } else {
        normalized.member_ids = [...group.memberIds];
      }
      outputNode.center_alignment = normalized;
    }
  }

  return output;
}

/** 计算一组矩形的联合边界。 */
function unionBounds(boundsList) {
  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 读取稳定根的权威矩形；viewport 用画布，safe-area 优先有效快照。 */
function readStableRootBounds(record, canvasBounds) {
  if (record.stableRootBounds?.has(record.referenceId)) return record.stableRootBounds.get(record.referenceId);
  const snapshot = [
    record.node.reference_target_bounds,
    record.parentId === record.referenceId ? record.node.parent_target_bounds : undefined,
  ].find(isBounds);
  if (record.referenceId === "viewport") return canvasBounds ?? snapshot ?? null;
  // 安全区可以小于画布，已有快照是权威几何；只有生成时没有快照才退回画布。
  return snapshot ?? canvasBounds ?? null;
}

/** 读取 validator 可用的参照目标矩形，不重新计算节点布局。 */
function readValidationReferenceBounds(record, model, canvasBounds) {
  if (STABLE_ROOTS.has(record.referenceId)) return readStableRootBounds(record, canvasBounds);
  const reference = model.records.get(record.referenceId);
  if (reference && isBounds(reference.node.target_bounds ?? reference.node.bounds)) {
    return reference.node.target_bounds ?? reference.node.bounds;
  }
  const snapshot = record.node.reference_target_bounds
    ?? (record.referenceId === record.parentId ? record.node.parent_target_bounds : undefined);
  return isBounds(snapshot) ? snapshot : null;
}

/** 比较居中轴实际坐标与参照中心，容忍浮点序列化误差。 */
function validateCenteredAxis(record, axis, policy, referenceBounds, errors, label) {
  if (!referenceBounds) {
    errors.push(`${label}.${record.id} 缺少 ${record.referenceId} 的有效定位参照目标边界`);
    return;
  }
  const bounds = record.node.target_bounds ?? record.node.bounds;
  const size = axis === "horizontal" ? bounds.width : bounds.height;
  const position = axis === "horizontal" ? bounds.x : bounds.y;
  const referencePosition = axis === "horizontal" ? referenceBounds.x : referenceBounds.y;
  const referenceSize = axis === "horizontal" ? referenceBounds.width : referenceBounds.height;
  const offset = policy.mode === "reference" ? policy.offset : 0;
  const actualCenter = position + size / 2;
  const expectedCenter = referencePosition + referenceSize / 2 + offset;
  if (Math.abs(actualCenter - expectedCenter) > EPSILON) {
    errors.push(`${label}.${record.id} ${axis} ${policy.mode === "strict" ? "必须严格居中" : "必须符合中心参照偏移"}，预期中心 ${expectedCenter}，实际中心 ${actualCenter}`);
  }
}

/** 校验策略与最终几何；只报告不一致，不对输入节点进行居中修复。 */
export function validateCenterAlignmentNodes(nodes, errors = [], label = "layout_nodes", canvas) {
  let model;
  try {
    model = buildModel(nodes, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return errors;
  }
  // 校验阶段也检查组合依赖环，避免仅生成入口发现问题。
  try {
    orderUnits(model, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const usesStableRoot = [...model.records.values()].some((record) =>
    STABLE_ROOTS.has(record.referenceId));
  let canvasBounds = null;
  if (usesStableRoot && canvas !== undefined) {
    try {
      canvasBounds = normalizeCanvas(canvas, label);
      const stableRootBounds = resolveLayoutRootBounds(nodes, canvasBounds, label);
      for (const record of model.records.values()) record.stableRootBounds = stableRootBounds;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const controlledMembers = new Map();
  for (const group of model.groups.values()) {
    const leader = model.records.get(group.leaderId);
    const reference = readValidationReferenceBounds(leader, model, canvasBounds);
    const union = unionBounds(group.members.map((member) => member.node.target_bounds ?? member.node.bounds));
    const leaderPolicies = leader.normalizedCenterAlignment ?? {};
    for (const axis of group.controlAxes) {
      const policy = leaderPolicies[axis] ?? { mode: "strict" };
      if (!reference) {
        errors.push(`${label}.${leader.id} 缺少 ${leader.referenceId} 的有效定位参照目标边界`);
        continue;
      }
      const refPosition = axis === "horizontal" ? reference.x : reference.y;
      const refSize = axis === "horizontal" ? reference.width : reference.height;
      const groupPosition = axis === "horizontal" ? union.x : union.y;
      const groupSize = axis === "horizontal" ? union.width : union.height;
      const actualCenter = groupPosition + groupSize / 2;
      const expectedCenter = refPosition + refSize / 2 + (policy.mode === "reference" ? policy.offset : 0);
      if (Math.abs(actualCenter - expectedCenter) > EPSILON) {
        errors.push(`${label}.${leader.id} 虚拟组 ${axis} ${policy.mode === "strict" ? "必须严格居中" : "必须符合中心参照偏移"}，预期联合框中心 ${expectedCenter}，实际中心 ${actualCenter}`);
      }
      for (const member of group.members) controlledMembers.set(`${member.id}:${axis}`, true);
    }
  }

  for (const record of model.records.values()) {
    const policies = record.normalizedCenterAlignment ?? {};
    const reference = readValidationReferenceBounds(record, model, canvasBounds);
    for (const axis of AXES) {
      if (record.alignment[axis] !== "center" || controlledMembers.has(`${record.id}:${axis}`)) continue;
      validateCenteredAxis(record, axis, policies[axis] ?? { mode: "strict" }, reference, errors, label);
    }
  }
  return errors;
}
