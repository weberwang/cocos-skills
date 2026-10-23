import { deriveSpriteGeometry } from "./sprite-layout-sizing.mjs";
import { isBackgroundDisplayNode, isLayoutContainer } from "./display-node-role.mjs";

const STABLE_ROOTS = new Set(["viewport", "safe-area"]);
const POSITION_DRIVERS = new Set(["WIDGET", "SHARED", "LAYOUT", "STATIC", "ANIMATION"]);
const LAYOUT_OWNERS = new Set(["SELF", "PARENT", "EXTERNAL"]);
const SIZE_POLICIES = new Set(["FIXED", "STRETCH", "CONTENT", "FLEX"]);
const SIZE_DRIVERS = new Set(["SPRITE_RAW", "FIXED", "WIDGET", "LAYOUT", "SHARED", "CONTENT"]);
const STRETCH_AXES = new Set(["horizontal", "vertical"]);

/** 判断值是否为普通对象，拒绝把数组当作布局事实。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 深拷贝 JSON 风格节点，保证推导不修改调用方数据。 */
function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
}

/** 判断字符串是否包含非空白字符。 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断矩形是否有有限坐标和正尺寸。 */
function isBounds(value) {
  return isRecord(value)
    && [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.width > 0
    && value.height > 0;
}

/** 只接受带保留 ID、显式空父级的视口合成根，防止业务节点伪造根身份跳过校验。 */
function isSyntheticRoot(node, label) {
  const isReservedId = STABLE_ROOTS.has(node.layout_node_id);
  if (node.is_root_container === true) {
    if (!isReservedId) {
      throw new TypeError(`${label}.is_root_container=true 仅允许用于 viewport 或 safe-area 合成根`);
    }
    if (!Object.hasOwn(node, "parent_layout_node_id") || node.parent_layout_node_id !== null) {
      throw new TypeError(`${label} 合成根必须显式声明 parent_layout_node_id=null`);
    }
    return true;
  }
  if (isReservedId) {
    throw new TypeError(`${label}.layout_node_id=${node.layout_node_id} 是保留合成根 ID，必须声明合法根身份`);
  }
  if (Object.hasOwn(node, "is_root_container") && typeof node.is_root_container !== "boolean") {
    throw new TypeError(`${label}.is_root_container 必须是布尔值`);
  }
  return false;
}

/** 用字段和值进行递归比较，字段顺序不影响 plan 校验。 */
function sameValue(actual, expected) {
  if (actual === expected) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((value, index) => sameValue(value, expected[index]));
  }
  if (!isRecord(actual) || !isRecord(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && sameValue(actual[key], expected[key]));
}

/** 校验 Widget 驱动与拉伸轴声明，错误写入调用方诊断数组。 */
export function validateLayoutDriverDeclaration(uiLayout, errors = [], label = "ui_layout") {
  if (uiLayout === undefined) return errors;
  if (!isRecord(uiLayout)) {
    errors.push(`${label} 必须是对象`);
    return errors;
  }

  if (Object.hasOwn(uiLayout, "position_driver")
    && (typeof uiLayout.position_driver !== "string" || !POSITION_DRIVERS.has(uiLayout.position_driver))) {
    errors.push(`${label}.position_driver 只支持 WIDGET、SHARED、LAYOUT、STATIC 或 ANIMATION`);
  }
  if (Object.hasOwn(uiLayout, "layout_owner")
    && (typeof uiLayout.layout_owner !== "string" || !LAYOUT_OWNERS.has(uiLayout.layout_owner))) {
    errors.push(`${label}.layout_owner 只支持 SELF、PARENT 或 EXTERNAL`);
  }
  const ownerRequiredByDriver = {
    WIDGET: "SELF",
    STATIC: "SELF",
    LAYOUT: "PARENT",
    ANIMATION: "EXTERNAL",
  }[uiLayout.position_driver];
  if (ownerRequiredByDriver && (!Object.hasOwn(uiLayout, "layout_owner")
    || LAYOUT_OWNERS.has(uiLayout.layout_owner)) && uiLayout.layout_owner !== ownerRequiredByDriver) {
    errors.push(`${label}.position_driver=${uiLayout.position_driver} 要求 layout_owner=${ownerRequiredByDriver}`);
  }
  if (Object.hasOwn(uiLayout, "size_policy")
    && (typeof uiLayout.size_policy !== "string" || !SIZE_POLICIES.has(uiLayout.size_policy))) {
    errors.push(`${label}.size_policy 只支持 FIXED、STRETCH、CONTENT 或 FLEX`);
  }
  if (Object.hasOwn(uiLayout, "size_driver")
    && (typeof uiLayout.size_driver !== "string" || !SIZE_DRIVERS.has(uiLayout.size_driver))) {
    errors.push(`${label}.size_driver 只支持 SPRITE_RAW、FIXED、WIDGET、LAYOUT、SHARED 或 CONTENT`);
  }

  if (Object.hasOwn(uiLayout, "widget_stretch_axes")) {
    const axes = uiLayout.widget_stretch_axes;
    if (!Array.isArray(axes) || axes.length === 0
      || axes.some((axis) => typeof axis !== "string" || !STRETCH_AXES.has(axis))
      || new Set(axes).size !== axes.length) {
      errors.push(`${label}.widget_stretch_axes 必须是包含 horizontal/vertical 且无重复项的非空数组`);
    }
    if (uiLayout.position_driver !== undefined && uiLayout.position_driver !== "WIDGET") {
      errors.push(`${label}.widget_stretch_axes 只能与 position_driver=WIDGET 同时声明`);
    }
  }
  return errors;
}

/** 建立真实节点索引，viewport/safe-area 这类逻辑根不伪装成实际 Node。 */
function indexNodes(nodes, label) {
  if (!Array.isArray(nodes)) throw new TypeError(`${label} 必须是数组`);
  const byId = new Map();
  const seenIds = new Set();
  nodes.forEach((node, index) => {
    if (!isRecord(node)) throw new TypeError(`${label}[${index}] 必须是对象`);
    const nodeLabel = `${label}[${index}]`;
    const isRoot = isSyntheticRoot(node, nodeLabel);
    if (!isNonEmptyString(node.layout_node_id)) {
      throw new TypeError(`${nodeLabel}.layout_node_id 必须是非空字符串`);
    }
    if (seenIds.has(node.layout_node_id)) throw new TypeError(`${label} 存在重复 layout_node_id：${node.layout_node_id}`);
    seenIds.add(node.layout_node_id);
    if (!isRoot) byId.set(node.layout_node_id, node);
  });
  return byId;
}

/** 读取节点和定位参照的有效矩形，校验快照没有伪造参照尺寸。 */
function readBounds(node, byId, referenceId, parentId, label) {
  const bounds = node.target_bounds ?? node.bounds;
  if (!isBounds(bounds)) throw new TypeError(`${label}.target_bounds/bounds 必须包含有限 x/y 和正数 width/height`);

  const referenceNode = byId.get(referenceId);
  const authoritativeReferenceBounds = referenceNode?.target_bounds ?? referenceNode?.bounds;
  const declaredReferenceBounds = node.reference_target_bounds
    ?? (referenceId === parentId ? node.parent_target_bounds : undefined);
  if (declaredReferenceBounds !== undefined && !isBounds(declaredReferenceBounds)) {
    throw new TypeError(`${label}.reference_target_bounds/parent_target_bounds 必须是有效矩形`);
  }
  if (authoritativeReferenceBounds !== undefined && !isBounds(authoritativeReferenceBounds)) {
    throw new TypeError(`${label}.定位参照 ${referenceId} 的 target_bounds/bounds 无效`);
  }
  if (declaredReferenceBounds && authoritativeReferenceBounds
    && !sameValue(declaredReferenceBounds, authoritativeReferenceBounds)) {
    throw new TypeError(`${label}.reference_target_bounds 必须等于参照 ${referenceId} 的实际 bounds`);
  }

  const referenceBounds = authoritativeReferenceBounds ?? declaredReferenceBounds;
  if (!isBounds(referenceBounds)) {
    throw new TypeError(`${label} 缺少定位参照 ${referenceId} 的有效 reference_target_bounds/parent_target_bounds`);
  }
  return { bounds, referenceBounds };
}

/** 沿真实父链判断参照是不是实际父级或祖先，逻辑稳定根永远不是 Widget target。 */
function isParentOrAncestor(node, referenceId, byId, label) {
  if (STABLE_ROOTS.has(referenceId)) return false;
  let currentId = node.parent_layout_node_id;
  if (!isNonEmptyString(currentId)) throw new TypeError(`${label}.parent_layout_node_id 必须是非空字符串`);
  const visited = new Set();
  while (isNonEmptyString(currentId)) {
    if (STABLE_ROOTS.has(currentId)) return false;
    if (visited.has(currentId)) throw new TypeError(`${label} 的实际父链存在循环：${currentId}`);
    visited.add(currentId);
    const parent = byId.get(currentId);
    if (!parent) return false;
    if (currentId === referenceId) return true;
    currentId = parent.parent_layout_node_id;
  }
  return false;
}

/** 收集虚拟图文组成员，确保每个成员共用共享布局控制。 */
function collectCenterGroupMembers(nodes, byId, label) {
  const members = new Set();
  for (const node of nodes) {
    if (isSyntheticRoot(node, label) || node?.center_alignment?.member_ids === undefined) continue;
    const ids = node.center_alignment.member_ids;
    if (!Array.isArray(ids) || ids.length < 2 || ids.some((id) => !isNonEmptyString(id))
      || new Set(ids).size !== ids.length || !ids.includes(node.layout_node_id)) {
      throw new TypeError(`${label}.${node.layout_node_id}.center_alignment.member_ids 必须是含自身的唯一非空节点列表`);
    }
    for (const id of ids) {
      if (!byId.has(id)) throw new TypeError(`${label}.${node.layout_node_id}.center_alignment.member_ids 引用不存在节点：${id}`);
      members.add(id);
    }
  }
  return members;
}

/** 计算 Widget 单轴对齐配置；所有偏移均为 logical-px。 */
function widgetAxis(axis, alignment, bounds, referenceBounds, shouldStretch) {
  const left = bounds.x - referenceBounds.x;
  const right = referenceBounds.x + referenceBounds.width - bounds.x - bounds.width;
  const top = bounds.y - referenceBounds.y;
  const bottom = referenceBounds.y + referenceBounds.height - bounds.y - bounds.height;
  if (shouldStretch) {
    return axis === "horizontal"
      ? { alignment: "stretch", start: left, end: right }
      : { alignment: "stretch", start: top, end: bottom };
  }
  if (axis === "horizontal") {
    if (alignment === "left") return { alignment, value: left };
    if (alignment === "right") return { alignment, value: right };
    if (alignment === "center") return { alignment, value: bounds.x + bounds.width / 2 - (referenceBounds.x + referenceBounds.width / 2) };
    throw new TypeError("axis_alignment.horizontal 只支持 left、center 或 right");
  }
  if (alignment === "top") return { alignment, value: top };
  if (alignment === "bottom") return { alignment, value: bottom };
  if (alignment === "center") {
    return { alignment, value: -((bounds.y + bounds.height / 2) - (referenceBounds.y + referenceBounds.height / 2)) };
  }
  throw new TypeError("axis_alignment.vertical 只支持 top、center 或 bottom");
}

/** 生成 Widget 配置；严格居中保持零偏移，RAW 图片只使用单边/中心定位。 */
function createWidget(node, bounds, referenceBounds, referenceId, stretchAxes, label) {
  const alignment = node.axis_alignment;
  if (!isRecord(alignment)
    || !["left", "center", "right"].includes(alignment.horizontal)
    || !["top", "center", "bottom"].includes(alignment.vertical)) {
    throw new TypeError(`${label}.axis_alignment 必须提供合法的 horizontal/vertical 九点停靠值`);
  }

  const horizontalCenterPolicy = node.center_alignment?.horizontal;
  const verticalCenterPolicy = node.center_alignment?.vertical;
  const horizontalCenterDelta = bounds.x + bounds.width / 2 - (referenceBounds.x + referenceBounds.width / 2);
  const verticalCenterDelta = bounds.y + bounds.height / 2 - (referenceBounds.y + referenceBounds.height / 2);
  if (alignment.horizontal === "center" && !stretchAxes.includes("horizontal") && horizontalCenterPolicy?.mode !== "reference"
    && Math.abs(horizontalCenterDelta) > 1e-6) {
    throw new TypeError(`${label} 严格水平居中的 bounds 必须与定位参照中心重合`);
  }
  if (alignment.vertical === "center" && !stretchAxes.includes("vertical") && verticalCenterPolicy?.mode !== "reference"
    && Math.abs(verticalCenterDelta) > 1e-6) {
    throw new TypeError(`${label} 严格垂直居中的 bounds 必须与定位参照中心重合`);
  }

  const horizontal = widgetAxis("horizontal", alignment.horizontal, bounds, referenceBounds, stretchAxes.includes("horizontal"));
  const vertical = widgetAxis("vertical", alignment.vertical, bounds, referenceBounds, stretchAxes.includes("vertical"));
  if (alignment.horizontal === "center" && !stretchAxes.includes("horizontal") && horizontalCenterPolicy?.mode !== "reference") horizontal.value = 0;
  if (alignment.vertical === "center" && !stretchAxes.includes("vertical") && verticalCenterPolicy?.mode !== "reference") vertical.value = 0;

  return {
    target_id: referenceId,
    align_mode: "ON_WINDOW_RESIZE",
    is_absolute: true,
    horizontal,
    vertical,
  };
}

/** 按 RAW、Widget 拉伸授权及尺寸策略解析尺寸控制者，避免位置与尺寸所有权互相推断。 */
function deriveSizeDriver(uiLayout, isRawSprite, hasWidgetStretch, positionDriver, label) {
  const explicitDriver = uiLayout.size_driver;
  const sizePolicy = uiLayout.size_policy;
  if (isRawSprite) {
    if (explicitDriver !== undefined && explicitDriver !== "SPRITE_RAW") {
      throw new TypeError(`${label}.ui_layout.size_driver 普通 RAW 图片只能声明 SPRITE_RAW`);
    }
    return "SPRITE_RAW";
  }
  if (hasWidgetStretch) {
    if (explicitDriver !== undefined && explicitDriver !== "WIDGET") {
      throw new TypeError(`${label}.ui_layout.size_driver 使用 Widget 拉伸时只能声明 WIDGET`);
    }
    return "WIDGET";
  }
  if (explicitDriver !== undefined) {
    if (explicitDriver === "SPRITE_RAW") {
      throw new TypeError(`${label}.ui_layout.size_driver=SPRITE_RAW 仅适用于普通 RAW 图片`);
    }
    if (explicitDriver === "WIDGET") {
      throw new TypeError(`${label}.ui_layout.size_driver=WIDGET 必须同时声明 widget_stretch_axes`);
    }
    if (explicitDriver === "CONTENT" && sizePolicy !== "CONTENT") {
      throw new TypeError(`${label}.ui_layout.size_driver=CONTENT 要求 size_policy=CONTENT`);
    }
    if (explicitDriver === "FIXED" && sizePolicy !== "FIXED") {
      throw new TypeError(`${label}.ui_layout.size_driver=FIXED 要求 size_policy=FIXED`);
    }
    if (["LAYOUT", "SHARED"].includes(explicitDriver) && !["STRETCH", "FLEX"].includes(sizePolicy)) {
      throw new TypeError(`${label}.ui_layout.size_driver=${explicitDriver} 要求 size_policy=STRETCH 或 FLEX`);
    }
    return explicitDriver;
  }

  if (sizePolicy === "CONTENT") return "CONTENT";
  if (["STRETCH", "FLEX"].includes(sizePolicy)) return positionDriver === "LAYOUT" ? "LAYOUT" : "SHARED";
  return "FIXED";
}

/** 按节点事实推导定位控制者、尺寸控制者及可选 Widget 参数。 */
function deriveNodePlan(node, byId, centerMembers, label) {
  if (isSyntheticRoot(node, label)) return null;
  const declarationErrors = validateLayoutDriverDeclaration(node.ui_layout, [], `${label}.ui_layout`);
  if (declarationErrors.length > 0) throw new TypeError(declarationErrors[0]);

  const uiLayout = node.ui_layout ?? {};
  const owner = uiLayout.layout_owner;
  const explicitDriver = uiLayout.position_driver;
  const stretchAxes = uiLayout.widget_stretch_axes ?? [];
  const parentId = node.parent_layout_node_id;
  const referenceId = node.reference_id ?? uiLayout.position_reference_id ?? parentId;
  if (!isNonEmptyString(referenceId)) throw new TypeError(`${label}.reference_id/ui_layout.position_reference_id/parent_layout_node_id 必须是非空字符串`);
  const isAncestor = isParentOrAncestor(node, referenceId, byId, label);
  const isGroupMember = centerMembers.has(node.layout_node_id);
  const background = isBackgroundDisplayNode(node);
  const overflow = uiLayout.overflow_policy;
  const widgetUnavailableReason = isGroupMember
    ? "虚拟图文组必须由共享布局按组合边界整体居中"
    : STABLE_ROOTS.has(referenceId)
      ? `定位参照 ${referenceId} 是逻辑稳定根，由共享布局映射，不假定它对应实际 Widget target Node`
    : !isAncestor
      ? "定位参照不是实际父级或祖先，Widget 无法直接引用"
      : background
        ? "背景节点不承担普通 UI 子项的 Widget 定位"
        : ["REFLOW", "SCROLL"].includes(overflow)
          ? `overflow_policy=${overflow} 需要共享/父级布局控制`
          : owner !== "SELF"
            ? `layout_owner=${owner ?? "未声明"} 不允许节点自身用 Widget 控制位置`
            : null;

  let positionDriver = explicitDriver;
  if (isGroupMember && explicitDriver !== undefined && explicitDriver !== "SHARED") {
    throw new TypeError(`${label}.ui_layout.position_driver 虚拟居中组成员必须使用 SHARED`);
  }
  if (positionDriver === undefined) {
    positionDriver = owner === "SELF" && widgetUnavailableReason === null ? "WIDGET" : "SHARED";
  }
  if (positionDriver === "WIDGET" && owner !== "SELF") {
    throw new TypeError(`${label}.ui_layout.position_driver=WIDGET 要求 layout_owner=SELF`);
  }
  if (positionDriver === "WIDGET" && widgetUnavailableReason !== null) {
    throw new TypeError(`${label}.ui_layout.position_driver=WIDGET 不可用：${widgetUnavailableReason}`);
  }
  if (positionDriver === "LAYOUT" && owner !== "PARENT") {
    throw new TypeError(`${label}.ui_layout.position_driver=LAYOUT 要求 layout_owner=PARENT`);
  }
  if (positionDriver === "ANIMATION" && owner !== "EXTERNAL") {
    throw new TypeError(`${label}.ui_layout.position_driver=ANIMATION 要求 layout_owner=EXTERNAL`);
  }
  if (positionDriver === "STATIC" && owner !== "SELF") {
    throw new TypeError(`${label}.ui_layout.position_driver=STATIC 要求 layout_owner=SELF`);
  }

  if (stretchAxes.length > 0 && positionDriver !== "WIDGET") {
    throw new TypeError(`${label}.ui_layout.widget_stretch_axes 只能由 position_driver=WIDGET 控制`);
  }

  const spriteBounds = node.target_bounds ?? node.bounds;
  const spriteGeometry = deriveSpriteGeometry(node, spriteBounds);
  const isRawSprite = spriteGeometry?.type === "SIMPLE" && spriteGeometry.size_mode === "RAW";
  if (stretchAxes.length > 0) {
    if (isRawSprite) throw new TypeError(`${label} 普通 RAW 图片不能使用 Widget 双边拉伸，必须保留原尺寸`);
    if (spriteGeometry !== null
      && (spriteGeometry.type !== "SLICED" || spriteGeometry.size_mode !== "CUSTOM")) {
      throw new TypeError(`${label} Sprite 使用 Widget 拉伸时必须由九宫格派生 SLICED + CUSTOM`);
    }
    if (spriteGeometry === null && (!isLayoutContainer(node) || uiLayout.size_policy !== "STRETCH")) {
      throw new TypeError(`${label} 非 Sprite 使用 Widget 拉伸时必须是结构容器且声明 size_policy=STRETCH；文字和命中区域使用其他尺寸驱动`);
    }
  }

  let widget = null;
  if (positionDriver === "WIDGET") {
    const { bounds, referenceBounds } = readBounds(node, byId, referenceId, parentId, label);
    widget = createWidget(node, bounds, referenceBounds, referenceId, stretchAxes, label);
  }

  const sizeDriver = deriveSizeDriver(uiLayout, isRawSprite, stretchAxes.length > 0, positionDriver, label);

  let reason;
  if (positionDriver === "WIDGET") {
    reason = sizeDriver === "SHARED"
      ? "共享布局先计算节点尺寸，Widget 再按实际父级/祖先定位；两者控制不同属性并按此顺序执行。"
      : sizeDriver === "LAYOUT"
        ? "节点上的 Layout 容器先计算自身尺寸，Widget 再按实际父级/祖先定位；两者控制不同属性并按此顺序执行。"
        : "定位参照是实际父级或祖先，节点拥有位置控制权，使用 Widget 保持九点关系。";
  } else if (positionDriver === "LAYOUT") {
    reason = "layout_owner=PARENT 且显式选择 LAYOUT，由父级布局控制位置，尺寸独立遵循 size_driver。";
  } else if (positionDriver === "ANIMATION") {
    reason = "layout_owner=EXTERNAL 且显式选择 ANIMATION，由外部动画控制位置。";
  } else if (positionDriver === "STATIC") {
    reason = "节点拥有位置控制权且显式选择 STATIC，位置按冻结几何保持。";
  } else if (isGroupMember) {
    reason = "节点属于图文整体居中组，由共享布局按组合边界计算，避免成员各自居中。";
  } else if (STABLE_ROOTS.has(referenceId)) {
    reason = `定位参照 ${referenceId} 是逻辑稳定根，由共享布局映射到实际 Canvas/视口尺寸，不假定存在可供 Widget target 使用的 Node。`;
  } else if (!isAncestor) {
    reason = "定位参照不是父级或祖先，由共享布局按实际参照 bounds 计算，不增加包装容器。";
  } else if (background) {
    reason = "背景职责不使用 Widget 参与普通 UI 定位，由共享布局保留冻结几何。";
  } else if (["REFLOW", "SCROLL"].includes(overflow)) {
    reason = `overflow_policy=${overflow} 需要共享布局持续管理位置。`;
  } else if (explicitDriver === "SHARED") {
    reason = "显式选择 SHARED，由共享布局入口按节点事实计算位置。";
  } else {
    reason = `layout_owner=${owner ?? "未声明"} 不由节点自身控制位置，交由共享布局入口计算。`;
  }

  return {
    position_driver: positionDriver,
    size_driver: sizeDriver,
    reason,
    widget,
  };
}

/** 为非根节点生成可审查的执行计划，返回副本并保留其他节点数据。 */
export function deriveLayoutExecutionPlans(nodes) {
  const label = "layout_nodes";
  const byId = indexNodes(nodes, label);
  const centerMembers = collectCenterGroupMembers(nodes, byId, label);
  return nodes.map((node, index) => {
    const copy = cloneValue(node);
    if (isSyntheticRoot(node, `${label}[${index}]`)) {
      delete copy.layout_execution;
      return copy;
    }
    copy.layout_execution = deriveNodePlan(node, byId, centerMembers, `${label}[${index}]`);
    return copy;
  });
}

/** 从节点事实重算布局计划，并按需要求每个非根节点都已带计划。 */
export function validateLayoutExecutionNodes(nodes, errors = [], label = "layout_nodes", { requirePlan = false } = {}) {
  if (!Array.isArray(nodes)) {
    errors.push(`${label} 必须是数组`);
    return errors;
  }
  if (typeof requirePlan !== "boolean") {
    errors.push(`${label}.requirePlan 必须是布尔值`);
    return errors;
  }

  let expectedNodes;
  try {
    expectedNodes = deriveLayoutExecutionPlans(nodes);
  } catch (error) {
    errors.push(`${label} 布局执行计划无法从节点事实推导：${error.message}`);
    return errors;
  }
  for (const [index, node] of nodes.entries()) {
    const nodeLabel = `${label}[${index}]`;
    if (isSyntheticRoot(node, nodeLabel)) {
      if (Object.hasOwn(node, "layout_execution")) {
        errors.push(`${nodeLabel}.layout_execution 合成根不允许携带执行计划`);
      }
      continue;
    }
    const hasPlan = Object.hasOwn(node, "layout_execution");
    if (!hasPlan) {
      if (requirePlan) errors.push(`${nodeLabel}.layout_execution 缺失`);
      continue;
    }
    if (!sameValue(node.layout_execution, expectedNodes[index].layout_execution)) {
      errors.push(`${nodeLabel}.layout_execution 与节点事实派生结果不一致，禁止伪造或扩展执行计划`);
    }
  }
  return errors;
}
