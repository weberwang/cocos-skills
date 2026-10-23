#!/usr/bin/env node

/**
 * V2 后置布局标注图合同与确定性渲染器。
 *
 * 布局图只接受已确认拆解中的 decomposition_elements，并由此推导 layout_nodes；
 * 这里不做图像识别，也不从未确认的 manifest 草案推导元素。PNG 元数据和右侧说明栏共同承担可复核性。
 */
import { createHash } from "node:crypto";
import { decodePngRgba, encodePngRgba, effectImageFontGlyph } from "./effect_image_raster.mjs";
import { validateDecompositionElements } from "./decomposition-elements.mjs";
import { allowsVisualOverflow, positionReferenceId, validateUiInteractionTree, validateUiLayout, validateUiPositionReferences } from "./ui-layout-organization.mjs";
import { axisAlignmentOffset, isValidAxisAlignment } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";
import { resolveCenteredLayoutNodes, validateCenterAlignmentNodes } from "../../cocos-game-ui-layout/scripts/center-alignment.mjs";
import { requiresNineSliceDecision, validateNineSliceContract, validateNineSliceTargetBounds } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";
import { deriveSpriteGeometry, validateSpriteGeometry } from "../../cocos-game-ui-layout/scripts/sprite-layout-sizing.mjs";
import { hasSpriteRendering, validateDisplayNodeRole } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";
import { validateContainerRootReuse } from "./container-root-policy.mjs";

export const LAYOUT_ANNOTATION_SCHEMA = "layout-annotation/png/1";
export const LAYOUT_ANNOTATION_LAYOUT = "image-plus-right-panel";
export const LAYOUT_ANNOTATION_KIND = "post-decomposition-layout";

const ROOT_IDS = new Set(["viewport", "safe-area"]);
const LAYOUT_MARKER_PATTERN = /^[LR][0-9]{2,}$/;
const ALIGNMENT_LABELS = Object.freeze({ left: "左", center: "中", right: "右", top: "上", bottom: "下" });
const SEMANTIC_GROUPING_LABELS = Object.freeze({ region: "区域", component: "功能组件", part: "组件部件", standalone: "独立元素" });
const PANEL_MIN_WIDTH = 330;
const PANEL_MAX_WIDTH = 900;
const PANEL_HORIZONTAL_PADDING = 12;
const MARKER_GAP = 4;
const MARKER_PADDING_X = 4;
const MARKER_PADDING_Y = 3;
const ASCII_GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"], "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"], J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10101", "10101", "10101", "11011", "10001"], X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"], Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"], "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"], "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"], "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
};

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 读取 snake_case/camelCase 字段；确认记录只在这里做字段位置适配。 */
function field(value, ...names) { for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name]; return undefined; }
/** 生成属性排序后的 JSON，避免属性顺序改变元数据或确认身份。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? "null" : encoded;
}
/** 统一 SHA-256 表示。 */
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
/** 判断可绘制的目标矩形。 */
function validBounds(value) { return isObject(value) && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key])) && value.width > 0 && value.height > 0; }
/** 将布局节点边界复制为稳定的数值对象。 */
function boundsOf(node) { const value = field(node, "target_bounds", "targetBounds", "bounds"); return validBounds(value) ? { x: value.x, y: value.y, width: value.width, height: value.height } : null; }
/** 四舍五入展示距离，保留合同要求的几何事实而不制造浮点噪声。 */
function roundDistance(value) { return Math.round(value * 1000000) / 1000000; }
/** 由父子 bounds 推导四边距离。 */
function relativePosition(parent, child) {
  return { left: roundDistance(child.x - parent.x), right: roundDistance(parent.x + parent.width - child.x - child.width), top: roundDistance(child.y - parent.y), bottom: roundDistance(parent.y + parent.height - child.y - child.height) };
}
/** 读取拆解合同明确声明的容器角色；普通叶子没有该标记时不能冒充空容器。 */
function explicitlyContainer(node) {
  const flag = field(node, "is_container", "isContainer", "container");
  if (flag === true) return true;
  if (typeof flag === "string" && ["container", "parent", "group", "layout-container", "empty-container"].includes(flag.trim().toLowerCase())) return true;
  const role = field(node, "layout_role", "layoutRole", "node_type", "nodeType", "element_type", "elementType");
  return typeof role === "string" && ["container", "parent", "group", "layout-container", "empty-container"].includes(role.trim().toLowerCase());
}
/**
 * 将拆解确认中的元素转换为阶段 B 的布局节点。
 * 布局阶段只消费已确认的显式 parent，不从几何包含关系选择父级或绑定 viewport；
 * 每个节点还必须接收同一批智能视觉决策给出的双轴对齐，缺失时关闭生成。
 */
export function deriveLayoutNodesFromDecompositionElements(elements, canvas, context = {}) {
  if (!Array.isArray(elements) || elements.length === 0) throw new Error("布局标注必须消费已确认拆解中的非空 decomposition_elements");
  if (!isObject(canvas) || !(canvas.width > 0) || !(canvas.height > 0)) throw new Error("布局标注需要有效目标画布尺寸");
  const validationErrors = [];
  const syntheticRegions = [...new Map(elements.map((element) => [element.region_id, { id: element.region_id, scene_id: element.scene_id, state_id: element.state_id, bounds: canvas }])).values()];
  validateDecompositionElements(elements, syntheticRegions, canvas, "decomposition_elements", validationErrors);
  if (validationErrors.length > 0) throw new Error(validationErrors[0]);
  const parentIds = new Map(elements.map((element) => [element.element_id, element.parent_element_id]));
  const alignmentDecisions = context.alignmentDecisions ?? context.alignment_decisions;
  const alignmentFor = (element) => {
    const alignment = alignmentDecisions instanceof Map ? alignmentDecisions.get(element.element_id) : alignmentDecisions?.[element.element_id];
    if (!isValidAxisAlignment(alignment)) throw new Error(`拆解元素 ${element.element_id} 缺少合法显式智能布局对齐决策`);
    return alignment;
  };
  const nodes = elements.map((element) => {
    const alignment = alignmentFor(element); const parentId = parentIds.get(element.element_id); const bounds = { ...element.bounds }; const isContainer = element.element_type === "container"; const displayNameZh = field(element, "display_name_zh", "displayNameZh");
    return { layout_node_id: element.element_id, element_id: element.element_id, element_type: element.element_type, ...(element.render_kind !== undefined ? { render_kind: element.render_kind } : {}), layout_role: element.role, display_name_zh: displayNameZh ?? null, display_name: displayNameZh ?? field(element, "display_name", "displayName", "label", "name") ?? null, parent_layout_node_id: parentId, parent_element_id: parentId, target_bounds: bounds, bounds, is_container: isContainer, empty_container: isContainer && element.empty_container === true, semantic_grouping: element.semantic_grouping, ui_layout: element.ui_layout, ...(element.nine_slice !== undefined ? { nine_slice: element.nine_slice } : {}), ...(element.nine_slice_decision_required === true ? { nine_slice_decision_required: true } : {}), ...(element.owner_type ? { owner_type: element.owner_type } : {}), ...(element.region_layer ? { region_layer: element.region_layer } : {}), ...(element.visual_route_element_type ? { visual_route_element_type: element.visual_route_element_type } : {}), axis_alignment: { horizontal: alignment.horizontal, vertical: alignment.vertical }, ...(alignment.center_alignment !== undefined ? { center_alignment: alignment.center_alignment } : {}), scene_id: element.scene_id ?? context.sceneId ?? context.scene_id, state_id: element.state_id ?? context.stateId ?? context.state_id, region_id: element.region_id, component_id: element.component_id, placement_id: element.placement_id };
  });
  // 保留拆解测量事实；只在布局派生中按居中意图平移，随后统一重算相对距离和偏移。
  return resolveCenteredLayoutNodes(nodes, canvas);
}
/** 由深度计算确定性的颜色；相邻深度使用不同色相，同层节点复用同一颜色。 */
export function colorForLayoutDepth(depth) {
  const hue = ((Number(depth) || 0) * 137.508) % 360; const saturation = 0.72; const lightness = 0.45;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation; const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)); const m = lightness - chroma / 2;
  const rgb = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${rgb.map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
/** 解析十六进制颜色。 */
function parseColor(value) { const match = String(value).match(/^#([0-9a-f]{6})$/i); return match ? [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16), 255] : [17, 24, 39, 255]; }
/**
 * 给确认元素和合成根分配稳定短标号。
 * L 编号严格遵循拆解确认元素顺序；R 编号只给 viewport/safe-area，不能消耗或重排 L 序列。
 */
export function assignLayoutMarkers(facts) {
  if (!Array.isArray(facts)) throw new Error("布局事实必须是数组");
  const nonRoots = facts.filter((fact) => fact?.is_root_container !== true);
  const roots = facts.filter((fact) => fact?.is_root_container === true);
  const markerById = new Map();
  nonRoots.forEach((fact, index) => markerById.set(fact.layout_node_id, `L${String(index + 1).padStart(2, "0")}`));
  roots.forEach((fact, index) => markerById.set(fact.layout_node_id, `R${String(index + 1).padStart(2, "0")}`));
  return facts.map((fact) => {
    const markerId = markerById.get(fact.layout_node_id);
    if (!markerId) throw new Error(`布局事实 ${fact.layout_node_id} 缺少稳定标号`);
    const parentMarkerId = fact.parent_layout_node_id ? markerById.get(fact.parent_layout_node_id) ?? null : null;
    return { ...fact, marker_id: markerId, parent_marker_id: parentMarkerId };
  });
}
/** 检查外部传入的标号快照；重复标号会让右栏无法唯一追溯，必须拒绝生成。 */
function hasUniqueLayoutMarkers(facts) { const markers = facts.map((fact) => String(fact?.marker_id ?? "")); return markers.every((marker) => LAYOUT_MARKER_PATTERN.test(marker)) && new Set(markers).size === markers.length; }

/** 将布局节点和稳定根组合为唯一父子图，并拒绝缺失父节点、循环和越界。 */
export function deriveAutomaticLayoutFacts(layoutNodes, canvas, context = {}) {
  if (!Array.isArray(layoutNodes) || layoutNodes.length === 0) throw new Error("布局标注必须消费由已确认拆解元素推导出的非空布局节点");
  if (!isObject(canvas) || !(canvas.width > 0) || !(canvas.height > 0)) throw new Error("布局标注需要有效目标画布尺寸");
  const source = new Map(); const children = new Map();
  for (const [index, node] of layoutNodes.entries()) {
    const id = field(node, "layout_node_id", "layoutNodeId"); const parentId = field(node, "parent_layout_node_id", "parentLayoutNodeId"); const bounds = boundsOf(node);
    if (!isObject(node) || typeof id !== "string" || !id || typeof parentId !== "string" || !parentId || !bounds) throw new Error(`推导布局节点[${index}] 缺少布局身份或有效 bounds`);
    const uiErrors = [];
    validateDisplayNodeRole(node, uiErrors, `推导布局节点[${index}]`);
    validateUiLayout(node.ui_layout, { rootParent: ROOT_IDS.has(parentId), container: explicitlyContainer(node), emptyContainer: node.empty_container === true && !hasSpriteRendering(node) }, uiErrors, `推导布局节点[${index}].ui_layout`);
    if (uiErrors.length > 0) throw new Error(uiErrors[0]);
    const roleDecisionRequired = requiresNineSliceDecision({ owner_type: node.owner_type, element_type: field(node, "element_type", "elementType"), render_kind: node.render_kind, role: field(node, "layout_role", "layoutRole", "role"), region_layer: node.region_layer, safe_area_policy: node.ui_layout?.safe_area_policy, visual_route_element_type: node.visual_route_element_type });
    if (node.nine_slice_decision_required !== undefined && node.nine_slice_decision_required !== true) throw new TypeError(`推导布局节点 ${id}.nine_slice_decision_required 是派生必评估标记，不接受 false 覆盖`);
    if (roleDecisionRequired && node.nine_slice_decision_required !== true) throw new TypeError(`推导布局节点 ${id} 属于固定生产 UI 皮肤，缺少 V2 派生必评估标记`);
    if ((roleDecisionRequired || node.nine_slice_decision_required === true) && node.nine_slice === undefined) throw new TypeError(`推导布局节点 ${id} 必须沿用 V2 冻结的 nine_slice 决策`);
    if (source.has(id)) throw new Error(`已确认拆解存在重复 layout_node_id：${id}`);
    if (node.nine_slice !== undefined) validateNineSliceTargetBounds(node.nine_slice, bounds, `布局节点 ${id}.target_bounds`);
    source.set(id, { node, id, parentId, bounds }); const list = children.get(parentId) ?? []; list.push(id); children.set(parentId, list);
  }
  const interactionErrors = [];
  const relationNodes = layoutNodes.map((node) => ({ element_id: node.layout_node_id, parent_element_id: node.parent_layout_node_id, ui_layout: node.ui_layout, scene_id: node.scene_id, state_id: node.state_id, coordinate_space: node.coordinate_space, role: node.layout_role ?? node.role, region_layer: node.region_layer, visual_route_element_type: node.visual_route_element_type }));
  validateUiInteractionTree(relationNodes, interactionErrors, "布局节点");
  validateUiPositionReferences(relationNodes, interactionErrors, "布局节点");
  validateContainerRootReuse(layoutNodes, interactionErrors, "布局节点");
  if (interactionErrors.length > 0) throw new Error(interactionErrors[0]);
  const rootIds = [...new Set([...source.values()].flatMap((item) => [item.parentId, positionReferenceId(item.node, item.parentId)]).filter((id) => ROOT_IDS.has(id)))].sort();
  // 有子项并不能自动把图片改成结构容器；底板必须在拆解时显式声明兼任身份。
  for (const item of source.values()) if ((children.get(item.id)?.length ?? 0) > 0 && !explicitlyContainer(item.node)) throw new Error(`布局节点 ${item.id} 承载子项时必须显式声明容器身份`);
  for (const item of source.values()) if (!ROOT_IDS.has(item.parentId) && !source.has(item.parentId)) throw new Error(`布局节点 ${item.id} 引用未确认的父容器：${item.parentId}`);
  const centerErrors = [];
  validateCenterAlignmentNodes(layoutNodes, centerErrors, "布局节点", canvas);
  if (centerErrors.length) throw new Error(centerErrors[0]);
  const rootBounds = { x: 0, y: 0, width: canvas.width, height: canvas.height }; const facts = [];
  for (const rootId of rootIds) children.set(rootId, children.get(rootId) ?? []);
  const depthOf = (id, trail = []) => {
    if (trail.includes(id)) throw new Error(`布局父子关系存在循环：${[...trail, id].join(" -> ")}`);
    const item = source.get(id); return item ? depthOf(item.parentId, [...trail, id]) + 1 : 0;
  };
  const parentBoundsOf = (parentId) => ROOT_IDS.has(parentId) ? rootBounds : source.get(parentId)?.bounds;
  // source 按确认 proposal 的元素顺序建立；这里只做几何计算，不重排公开布局节点。
  for (const item of source.values()) {
    const parentBounds = parentBoundsOf(item.parentId); if (!parentBounds) throw new Error(`布局节点 ${item.id} 缺少父容器 bounds`);
    const relative = relativePosition(parentBounds, item.bounds);
    if (Object.values(relative).some((value) => value < 0) && (ROOT_IDS.has(item.parentId) || !allowsVisualOverflow(item.node.ui_layout))) throw new Error(`布局节点 ${item.id} 超出已确认父容器 bounds，须声明 visual_overflow.reason`);
    const viewportRelative = relativePosition(rootBounds, item.bounds);
    if (Object.values(viewportRelative).some((value) => value < 0)) throw new Error(`布局节点 ${item.id} 超出目标画布`);
    const referenceId = positionReferenceId(item.node, item.parentId);
    const referenceBounds = parentBoundsOf(referenceId);
    if (!referenceBounds) throw new Error(`布局节点 ${item.id} 缺少定位参照 ${referenceId} 的 bounds`);
    // 定位参照可以是兄弟叶子，父框仅管理功能归属，二者不能互相覆盖。
    if (item.node.reference_id !== undefined && item.node.reference_id !== referenceId) throw new Error(`布局节点 ${item.id}.reference_id 未继承已确认定位参照`);
    if (item.node.reference_target_bounds !== undefined && canonicalJson(item.node.reference_target_bounds) !== canonicalJson(referenceBounds)) throw new Error(`布局节点 ${item.id}.reference_target_bounds 与定位参照不一致`);
    const alignment = field(item.node, "axis_alignment", "axisAlignment"); if (!isValidAxisAlignment(alignment)) throw new Error(`由已确认拆解元素推导的布局节点 ${item.id} 缺少合法显式 axis_alignment`); const offset = axisAlignmentOffset(referenceBounds, item.bounds, alignment); const depth = depthOf(item.id); const childIds = (children.get(item.id) ?? []).slice(); const isContainer = childIds.length > 0 || explicitlyContainer(item.node); const selfAnchor = field(item.node, "self_anchor", "selfAnchor") ?? `${alignment.vertical}-${alignment.horizontal}`; const referenceAnchor = field(item.node, "reference_anchor", "referenceAnchor") ?? `${alignment.vertical}-${alignment.horizontal}`;
    const displayNameZh = field(item.node, "display_name_zh", "displayNameZh");
    const rawNineSlice = field(item.node, "nine_slice", "nineSlice"); const nineSlice = rawNineSlice === undefined ? undefined : validateNineSliceContract(rawNineSlice, `布局节点 ${item.id}.nine_slice`);
    const spriteGeometry = deriveSpriteGeometry({ ...item.node, is_container: isContainer }, item.bounds);
    if (item.node.sprite_geometry !== undefined) {
      const sizingErrors = [];
      validateSpriteGeometry(item.node, sizingErrors, `布局节点 ${item.id}`);
      if (sizingErrors.length) throw new Error(sizingErrors[0]);
    }
    facts.push({ layout_node_id: item.id, element_id: field(item.node, "element_id", "elementId", "region_id", "regionId") ?? item.id, element_type: field(item.node, "element_type", "elementType") ?? (isContainer ? "container" : "component"), ...(item.node.render_kind !== undefined ? { render_kind: item.node.render_kind } : {}), display_name_zh: displayNameZh ?? null, display_name: displayNameZh ?? field(item.node, "display_name", "displayName", "label", "name") ?? null, layout_role: field(item.node, "layout_role", "layoutRole", "role", "node_type", "nodeType") ?? null, parent_layout_node_id: item.parentId, parent_element_id: field(item.node, "parent_element_id", "parentElementId") ?? item.parentId, reference_id: referenceId, parent_target_bounds: parentBounds, reference_target_bounds: referenceBounds, ...(spriteGeometry ? { sprite_geometry: spriteGeometry } : {}), depth, color: colorForLayoutDepth(depth), bounds: item.bounds, target_bounds: item.bounds, is_container: isContainer, empty_container: isContainer && childIds.length === 0, semantic_grouping: field(item.node, "semantic_grouping") ?? null, ui_layout: field(item.node, "ui_layout") ?? null, ...(nineSlice !== undefined ? { nine_slice: nineSlice } : {}), ...(item.node.nine_slice_decision_required === true ? { nine_slice_decision_required: true } : {}), ...(item.node.owner_type ? { owner_type: item.node.owner_type } : {}), ...(item.node.region_layer ? { region_layer: item.node.region_layer } : {}), ...(item.node.visual_route_element_type ? { visual_route_element_type: item.node.visual_route_element_type } : {}), region_id: field(item.node, "region_id", "regionId") ?? null, component_id: field(item.node, "component_id", "componentId") ?? null, placement_id: field(item.node, "placement_id", "placementId") ?? null, child_layout_node_ids: childIds, relative_position: relative, axis_alignment: alignment, ...(item.node.center_alignment !== undefined ? { center_alignment: item.node.center_alignment } : {}), offset, self_anchor: selfAnchor, reference_anchor: referenceAnchor, docking: { horizontal: alignment.horizontal, vertical: alignment.vertical, self_anchor: selfAnchor, reference_anchor: referenceAnchor, offset }, is_root_container: false });
  }
  for (const rootId of rootIds) {
    const childIds = (children.get(rootId) ?? []).slice(); facts.push({ layout_node_id: rootId, element_id: rootId, display_name: rootId === "safe-area" ? "安全区域" : "根视口", layout_role: "root", parent_layout_node_id: null, parent_element_id: null, reference_id: null, parent_target_bounds: null, depth: 0, color: colorForLayoutDepth(0), bounds: rootBounds, target_bounds: rootBounds, is_container: true, empty_container: childIds.length === 0, semantic_grouping: null, ui_layout: null, child_layout_node_ids: childIds, relative_position: null, axis_alignment: null, offset: null, self_anchor: null, reference_anchor: null, docking: null, is_root_container: true });
  }
  return assignLayoutMarkers(facts.map((fact) => ({ ...fact, scene_id: context.sceneId ?? context.scene_id ?? null, state_id: context.stateId ?? context.state_id ?? null })));
}
/** 计算布局节点身份，确认记录会把该身份与上游拆解确认绑定。 */
export function computeLayoutNodeIdentitySha256(facts) { return sha256(canonicalJson((facts ?? []).map((fact) => ({ ...fact })))); }
/** 排除自引用字段后计算 PNG 元数据 SHA。 */
export function computeLayoutAnnotationMetadataSha256(metadata = {}) { const payload = { ...metadata }; delete payload.metadata_sha256; delete payload.layout_annotation_identity_sha256; return sha256(canonicalJson(payload)); }
/** 计算布局 PNG 的不可变身份。 */
export function computeLayoutAnnotationIdentitySha256(annotationSha256, width, height, metadataSha256, schema = LAYOUT_ANNOTATION_SCHEMA, layout = LAYOUT_ANNOTATION_LAYOUT) { return sha256(canonicalJson({ annotation_sha256: annotationSha256, width, height, metadata_sha256: metadataSha256, schema, layout })); }
/** 将双轴视觉决策转换为用户可读的中文停靠语义；距离只作为辅助事实。 */
function alignmentDescription(alignment) { return `水平${ALIGNMENT_LABELS[alignment.horizontal] ?? alignment.horizontal}、垂直${ALIGNMENT_LABELS[alignment.vertical] ?? alignment.vertical}`; }
/** 展示严格居中、带理由的中心偏移和虚拟内容组，避免把组员偏移误读为居中误差。 */
function centeringDescription(fact) {
  const policy = fact.center_alignment;
  if (!policy) return "";
  const axes = [["horizontal", "水平"], ["vertical", "垂直"]].flatMap(([axis, label]) => {
    const value = policy[axis];
    return value ? [`${label}${value.mode === "strict" ? "严格居中" : `中心参照偏移=${value.offset}，原因=${value.reason}`}`] : [];
  });
  if (policy.member_ids) axes.push(`整体居中成员=${policy.member_ids.join("、")}`);
  return axes.length ? ` 居中约束=${axes.join("；")}` : "";
}
/** 优先显示人工提供的可读名称，同时保留完整技术 ID 供追溯。 */
function displayNodeName(fact) { const id = String(fact.layout_node_id); const declaredName = field(fact, "display_name_zh", "displayNameZh", "display_name", "displayName"); const name = typeof declaredName === "string" && declaredName.trim() ? declaredName.trim() : null; return name && name !== id ? `${name}（id=${id}）` : id; }
/** 生成单个布局节点的完整停靠说明；父容器和空容器与叶子使用同一字段集合。 */
function layoutNodeDescription(fact) {
  if (fact.is_root_container) return `根视口 [${fact.marker_id}]（id=${fact.layout_node_id}；无上级）`;
  const kind = fact.is_container ? (fact.render_kind === "sprite" ? "底板父容器" : "父容器") : "子组件"; const parent = fact.parent_marker_id ?? fact.parent_layout_node_id; const distance = fact.relative_position;
  const nineSliceText = fact.nine_slice?.mode === "stretch"
    ? `；九宫格=stretch 源图=${fact.nine_slice.source_size.width}×${fact.nine_slice.source_size.height} 边界(L/R/T/B)=${fact.nine_slice.borders.left}/${fact.nine_slice.borders.right}/${fact.nine_slice.borders.top}/${fact.nine_slice.borders.bottom}`
    : fact.nine_slice?.mode === "not-applicable" ? `；九宫格=not-applicable（${String(fact.nine_slice.reason).replace(/\s+/gu, " ")}）` : "";
  // 仅折叠展示文本中的换行；确认理由原文仍完整保留在节点与身份中。
  const grouping = fact.semantic_grouping; const groupingText = isObject(grouping) ? `；功能分组=${SEMANTIC_GROUPING_LABELS[grouping.kind] ?? grouping.kind}（kind=${grouping.kind}）；分组理由=${String(grouping.rationale ?? "").replace(/\s+/gu, " ")}` : "；功能分组=缺失";
  const ui = fact.ui_layout; const uiText = isObject(ui) ? `；节点职责=${ui.grouping_basis.join("+")}；布局控制=${ui.layout_owner}；尺寸=${ui.size_policy}；溢出=${ui.overflow_policy}；安全区=${ui.safe_area_policy}；交互=${ui.interaction_policy}${ui.minimum_size ? `；最小尺寸=${ui.minimum_size.width}x${ui.minimum_size.height}` : ""}` : "；节点职责=缺失";
  const referenceText = fact.reference_id !== fact.parent_layout_node_id ? `；定位参照=${fact.reference_id}` : "";
  const overflowText = ui?.visual_overflow ? `；视觉溢出=${String(ui.visual_overflow.reason).replace(/\s+/gu, " ")}` : "";
  const spriteText = fact.sprite_geometry ? `；图片尺寸模式=${fact.sprite_geometry.size_mode}` : "";
  const rootReasonText = ui?.independent_container_reason ? `；独立容器职责=${String(ui.independent_container_reason).replace(/\s+/gu, " ")}` : "";
  return `${kind} [${fact.marker_id}]${fact.empty_container ? (fact.render_kind === "sprite" ? "（无子项）" : "（空容器）") : ""}（父：[${parent}]）${groupingText}${uiText}${nineSliceText}${referenceText}${overflowText}${spriteText}${rootReasonText}${centeringDescription(fact)} 九点停靠=${alignmentDescription(fact.axis_alignment)}；自身锚点=${fact.self_anchor}；参照锚点=${fact.reference_anchor}；偏移=x=${fact.offset.x}/y=${fact.offset.y}；标识=${displayNodeName(fact)}；辅助距离 left=${distance.left} right=${distance.right} top=${distance.top} bottom=${distance.bottom}`;
}
/** 把颜色、距离和停靠事实展开为人工可读的右栏行。 */
export function deriveLayoutAnnotationRows(facts) {
  if (!Array.isArray(facts)) throw new Error("布局事实必须是数组");
  const markedFacts = facts.every((fact) => LAYOUT_MARKER_PATTERN.test(String(fact?.marker_id ?? ""))) ? facts : assignLayoutMarkers(facts); if (!hasUniqueLayoutMarkers(markedFacts)) throw new Error("布局标注节点编号必须唯一且可追溯");
  const rows = [{ kind: "header", logical_row_id: "header", marker_id: null, layout_node_id: null, parent_marker_id: null, text: "布局标注说明：左侧框号与右栏编号一致" }];
  // 根说明独立于确认元素；其余节点严格保持确认元素原顺序，便于人工逐框核对。
  for (const fact of [...markedFacts.filter((item) => item.is_root_container), ...markedFacts.filter((item) => !item.is_root_container)]) rows.push({ kind: fact.is_root_container ? "root" : fact.is_container ? "parent" : "child", logical_row_id: fact.marker_id, marker_id: fact.marker_id, layout_node_id: fact.layout_node_id, parent_layout_node_id: fact.parent_layout_node_id, parent_marker_id: fact.parent_marker_id, text: layoutNodeDescription(fact) });
  return rows;
}
/** 判断两个矩形是否相交；标注标签碰撞只影响标签位置，不会修改冻结节点 bounds。 */
function rectanglesOverlap(left, right, padding = 0) { return left.x < right.x + right.width + padding && left.x + left.width + padding > right.x && left.y < right.y + right.height + padding && left.y + left.height + padding > right.y; }
/** 限制标签到原图范围，避免小画布上的编号被裁切。 */
function clampRectangle(rect, canvas) { return { x: Math.round(Math.min(Math.max(rect.x, 0), Math.max(0, canvas.width - rect.width))), y: Math.round(Math.min(Math.max(rect.y, 0), Math.max(0, canvas.height - rect.height))), width: rect.width, height: rect.height }; }
/** 返回标签到目标 bounds 的最近连接点。 */
function nearestPoint(rect, point) { return { x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width), y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height) }; }
/** 从标签位置记录到冻结框的连接，标签外移不影响元素本身。 */
function markerPlacement(fact, markerBounds) {
  const markerCenter = { x: markerBounds.x + markerBounds.width / 2, y: markerBounds.y + markerBounds.height / 2 };
  const targetPoint = nearestPoint(fact.bounds, markerCenter);
  const inside = markerCenter.x >= fact.bounds.x && markerCenter.x <= fact.bounds.x + fact.bounds.width && markerCenter.y >= fact.bounds.y && markerCenter.y <= fact.bounds.y + fact.bounds.height;
  return { marker_id: fact.marker_id, layout_node_id: fact.layout_node_id, element_id: fact.element_id, bounds: markerBounds, anchor: targetPoint, leader_line: inside ? null : { from: targetPoint, to: markerCenter } };
}
/** 就近布局占满零碎空位时，仅将标签按原序紧凑排布；仍保留引线与原图几何。 */
function packMarkerGrid(facts, canvas, scale, markerHeight) {
  let x = 0; let y = 0;
  return facts.map((fact) => {
    const width = textWidth(fact.marker_id, scale) + MARKER_PADDING_X * 2 * scale;
    if (x + width > canvas.width) { x = 0; y += markerHeight + scale; }
    if (width > canvas.width || y + markerHeight > canvas.height) throw new Error(`布局标注编号 ${fact.marker_id} 无法找到不重叠的可见位置`);
    const placement = markerPlacement(fact, { x, y, width, height: markerHeight }); x += width + scale;
    return placement;
  });
}
/** 计算编号标签位置；优先就近摆放，发生拥挤时确定性扫描空位并记录引线。 */
export function computeLayoutMarkerPlacements(facts, canvas, scale = 1) {
  const placements = []; const occupied = []; const markerHeight = Math.max(12 * scale, 7 * scale + MARKER_PADDING_Y * 2 * scale);
  for (const fact of facts) {
    const marker = String(fact.marker_id ?? ""); const markerWidth = textWidth(marker, scale) + MARKER_PADDING_X * 2 * scale; const gap = MARKER_GAP * scale; const bounds = fact.bounds; const rawCandidates = [
      { x: bounds.x + gap, y: bounds.y + gap }, { x: bounds.x + bounds.width - markerWidth - gap, y: bounds.y + gap },
      { x: bounds.x + gap, y: bounds.y + bounds.height - markerHeight - gap }, { x: bounds.x + bounds.width - markerWidth - gap, y: bounds.y + bounds.height - markerHeight - gap },
      { x: bounds.x - markerWidth - gap, y: bounds.y + (bounds.height - markerHeight) / 2 }, { x: bounds.x + bounds.width + gap, y: bounds.y + (bounds.height - markerHeight) / 2 },
      { x: bounds.x + (bounds.width - markerWidth) / 2, y: bounds.y - markerHeight - gap }, { x: bounds.x + (bounds.width - markerWidth) / 2, y: bounds.y + bounds.height + gap },
    ];
    if (markerWidth > canvas.width || markerHeight > canvas.height) throw new Error(`布局标注编号 ${marker} 超出原图可见尺寸`);
    const candidates = []; const seen = new Set(); for (const candidate of rawCandidates) { const rect = clampRectangle({ ...candidate, width: markerWidth, height: markerHeight }, canvas); const key = `${rect.x},${rect.y}`; if (!seen.has(key)) { seen.add(key); candidates.push(rect); } }
    let markerBounds = candidates.find((candidate) => occupied.every((item) => !rectanglesOverlap(candidate, item, scale))) ?? null;
    if (!markerBounds) {
      // 标签碰撞时扫描固定网格；该兜底只移动标注，不改原始元素几何和顺序。
      const step = Math.max(1, Math.floor(scale));
      for (let y = 0; y <= canvas.height - markerHeight && !markerBounds; y += step) for (let x = 0; x <= canvas.width - markerWidth; x += step) {
        const candidate = { x, y, width: markerWidth, height: markerHeight }; if (occupied.every((item) => !rectanglesOverlap(candidate, item, scale))) { markerBounds = candidate; break; }
      }
    }
    if (!markerBounds) return packMarkerGrid(facts, canvas, scale, markerHeight);
    occupied.push(markerBounds); placements.push(markerPlacement(fact, markerBounds));
  }
  return placements;
}

/** 按真实字形步进换行，确保长 ID、负小数及多节点说明都完整落入右栏。 */
function wrapTextByWidth(value, maxWidth, scale) {
  const characters = [...String(value ?? "")]; if (characters.length === 0) return [""]; const lines = []; let line = ""; let width = 0;
  for (const character of characters) { const characterWidth = advance(character, scale); if (line && width + characterWidth > maxWidth) { lines.push(line); line = ""; width = 0; } line += character; width += characterWidth; }
  if (line || lines.length === 0) lines.push(line); return lines;
}
/** 在布局图 PNG 中绘制原图、所有容器边框和右侧关系说明。 */
export function renderLayoutAnnotation(originalBytes, canvas, facts, context = {}) {
  const source = decodePngRgba(originalBytes); if (source.width !== canvas.width || source.height !== canvas.height) throw new Error("布局标注原图尺寸与目标画布不一致");
  const markedFacts = facts.every((fact) => LAYOUT_MARKER_PATTERN.test(String(fact?.marker_id ?? ""))) ? facts : assignLayoutMarkers(facts); if (!hasUniqueLayoutMarkers(markedFacts)) throw new Error("布局标注节点编号必须唯一且可追溯"); const rows = deriveLayoutAnnotationRows(markedFacts); const scale = Math.max(1, Math.min(3, Math.floor(canvas.height / 320))); const lineHeight = 20 * scale; const naturalWidth = Math.max(...rows.map((row) => textWidth(row.text, scale))); const panelWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, naturalWidth + PANEL_HORIZONTAL_PADDING * 2)); const contentWidth = panelWidth - PANEL_HORIZONTAL_PADDING * 2; const renderedRows = []; let lineIndex = 1;
  for (const row of rows) { const chunks = wrapTextByWidth(row.text, contentWidth, scale); chunks.forEach((chunk, index) => { const baseline = lineIndex * lineHeight; const glyphHeight = 16 * scale; const chunkWidth = textWidth(chunk, scale); renderedRows.push({ ...row, logical_row_id: row.logical_row_id ?? row.kind, line_index: index, line_count: chunks.length, row_index: renderedRows.length, text: chunk, baseline, top: baseline - glyphHeight, bottom: baseline, width: chunkWidth, text_width: chunkWidth, bounds: { x: canvas.width + PANEL_HORIZONTAL_PADDING, y: baseline - glyphHeight, width: chunkWidth, height: glyphHeight } }); lineIndex += 1; }); }
  const width = canvas.width + panelWidth; const height = Math.max(canvas.height, (renderedRows.length + 2) * lineHeight); const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < canvas.height; y += 1) source.pixels.copy(pixels, y * width * 4, y * canvas.width * 4, (y + 1) * canvas.width * 4); fillRect(pixels, width, height, canvas.width, 0, panelWidth, height, [255, 255, 255, 255]); strokeRect(pixels, width, height, canvas.width, 0, panelWidth, height, [17, 24, 39, 255], 1);
  for (const row of renderedRows) drawText(pixels, width, height, row.bounds.x, row.baseline, row.text, row.kind === "header" ? [17, 24, 39, 255] : [31, 41, 55, 255], scale);
  for (const fact of markedFacts) strokeRect(pixels, width, height, fact.bounds.x, fact.bounds.y, fact.bounds.width, fact.bounds.height, parseColor(fact.color), fact.is_root_container ? 3 : 2);
  const markerPlacements = computeLayoutMarkerPlacements(markedFacts, canvas, scale); for (const placement of markerPlacements) { const fact = markedFacts.find((item) => item.layout_node_id === placement.layout_node_id); const color = parseColor(fact?.color); if (placement.leader_line) drawLine(pixels, width, height, placement.leader_line.from.x, placement.leader_line.from.y, placement.leader_line.to.x, placement.leader_line.to.y, color); }
  // 所有引线先落底，再绘制标签，避免连线穿过编号导致“号”和框无法对应。
  for (const placement of markerPlacements) { const fact = markedFacts.find((item) => item.layout_node_id === placement.layout_node_id); const color = parseColor(fact?.color); fillRect(pixels, width, height, placement.bounds.x, placement.bounds.y, placement.bounds.width, placement.bounds.height, [17, 24, 39, 255]); strokeRect(pixels, width, height, placement.bounds.x, placement.bounds.y, placement.bounds.width, placement.bounds.height, color, 1); drawTextCentered(pixels, width, height, placement.bounds.x + placement.bounds.width / 2, placement.bounds.y + placement.bounds.height / 2, placement.marker_id, [255, 255, 255, 255], scale); }
  const targetSha = context.targetSha256 ?? context.target_sha256; const nodeIdentitySha256 = computeLayoutNodeIdentitySha256(markedFacts); const markerMap = markedFacts.map((fact) => ({ marker_id: fact.marker_id, layout_node_id: fact.layout_node_id, element_id: fact.element_id, parent_layout_node_id: fact.parent_layout_node_id, parent_marker_id: fact.parent_marker_id, is_root_container: fact.is_root_container === true })); const metadata = { schema: LAYOUT_ANNOTATION_SCHEMA, layout: LAYOUT_ANNOTATION_LAYOUT, annotation_kind: LAYOUT_ANNOTATION_KIND, original_width: canvas.width, original_height: canvas.height, panel_width: panelWidth, panel_height: height, panel_content_bounds: { x: canvas.width, y: 0, width: panelWidth, height }, width, height, output_height: height, text_scale: scale, line_height: lineHeight, original_sha256: sha256(originalBytes), target_sha256: targetSha ?? null, scene_id: context.sceneId ?? context.scene_id ?? null, state_id: context.stateId ?? context.state_id ?? null, decomposition_confirmation_id: context.decompositionConfirmationId ?? context.decomposition_confirmation_id ?? null, decomposition_confirmation_sha256: context.decompositionConfirmationSha256 ?? context.decomposition_confirmation_sha256 ?? null, decomposition_proposal_sha256: context.decompositionProposalSha256 ?? context.decomposition_proposal_sha256 ?? null, layout_decision_id: context.layoutDecisionId ?? context.layout_decision_id ?? null, layout_decision_sha256: context.layoutDecisionSha256 ?? context.layout_decision_sha256 ?? null, generation_method: "automatic-visual-judgement-from-confirmed-decomposition", node_identity_sha256: nodeIdentitySha256, marker_map: markerMap, marker_layouts: markerPlacements, panel_content_complete: true, visible_row_count: renderedRows.length, visible_rows: renderedRows, nodes: markedFacts };
  metadata.metadata_sha256 = computeLayoutAnnotationMetadataSha256(metadata); return { bytes: encodePngRgba(width, height, pixels, metadata), metadata, facts: markedFacts, rows: renderedRows, markerPlacements, width, height, metadataSha256: metadata.metadata_sha256, identitySha256: null };
}
/** 复算绘制器使用的字符像素集合，校验时因此能发现“metadata 完整但 PNG 文字被裁掉”。 */
function textInkSet(value, scale, centered = false, width = 0, height = 0) {
  const ink = new Set(); let cursor = centered ? Math.round((width - textWidth(value, scale)) / 2) : 0; const glyphHeight = 16 * scale; const baseline = centered ? Math.round((height - 7 * scale) / 2) + 7 * scale : height;
  for (const character of [...String(value ?? "")]) { const rows = glyph(character); for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y].length; x += 1) if (rows[y][x] === "1") for (let yy = 0; yy < scale; yy += 1) for (let xx = 0; xx < scale; xx += 1) { const drawX = cursor + x * scale + xx; const drawY = Math.floor(baseline - (rows.length - y) * scale) + yy; const localY = centered ? drawY : drawY - (baseline - glyphHeight); ink.add(`${drawX},${localY}`); } cursor += advance(character, scale); }
  return ink;
}
/** 检查右栏行的实际像素和几何边界，防止只在 metadata 中声称完整而画面已裁切。 */
function validateVisibleRowPixels(decoded, row, metadata, label, errors) {
  const bounds = row?.bounds; const scale = metadata.text_scale; const expectedWidth = textWidth(row?.text, scale);
  if (!isObject(bounds) || !["x", "y", "width", "height"].every((key) => Number.isInteger(bounds[key]))) { errors.push(`${label} 右栏行缺少真实像素 bounds`); return; }
  if (bounds.x < metadata.original_width || bounds.x + bounds.width > decoded.width || bounds.y < 0 || bounds.y + bounds.height > decoded.height || bounds.width !== expectedWidth || bounds.height !== 16 * scale || row.width !== expectedWidth || row.text_width !== expectedWidth || row.top !== bounds.y || row.bottom !== bounds.y + bounds.height || row.baseline !== row.bottom) { errors.push(`${label} 右栏行 ${row.row_index} 越界、宽度或真实 glyph 边界不一致`); return; }
  let hasInk = false; for (let y = Math.max(0, Math.floor(bounds.y)); y < Math.min(decoded.height, Math.ceil(bounds.y + bounds.height)) && !hasInk; y += 1) for (let x = Math.max(0, Math.floor(bounds.x)); x < Math.min(decoded.width, Math.ceil(bounds.x + bounds.width)); x += 1) { const offset = (y * decoded.width + x) * 4; if (decoded.pixels[offset] !== 255 || decoded.pixels[offset + 1] !== 255 || decoded.pixels[offset + 2] !== 255) { hasInk = true; break; } }
  if (!hasInk) errors.push(`${label} 右栏行 ${row.row_index} 没有可见文字像素`);
  try {
    const expectedInk = textInkSet(row.text, scale); for (let y = 0; y < bounds.height; y += 1) for (let x = 0; x < bounds.width; x += 1) { const offset = ((bounds.y + y) * decoded.width + bounds.x + x) * 4; const actualInk = decoded.pixels[offset] !== 255 || decoded.pixels[offset + 1] !== 255 || decoded.pixels[offset + 2] !== 255; if (actualInk !== expectedInk.has(`${x},${y}`)) { errors.push(`${label} 右栏行 ${row.row_index} 的实际文字像素与声明不一致`); return; } }
  } catch (error) { errors.push(`${label} 右栏行 ${row.row_index} 包含无法绘制的文字：${error.message}`); }
}
/** 校验左侧编号的真实白色字形，防止只改 marker_map 或在标签处留下错误编号。 */
function validateMarkerPixels(decoded, placement, metadata, label, errors) {
  const scale = metadata.text_scale; const bounds = placement?.bounds; const expectedWidth = textWidth(placement?.marker_id, scale); const expectedHeight = Math.max(12 * scale, 7 * scale + MARKER_PADDING_Y * 2 * scale);
  if (!isObject(bounds) || !["x", "y", "width", "height"].every((key) => Number.isInteger(bounds[key])) || bounds.width !== expectedWidth + MARKER_PADDING_X * 2 * scale || bounds.height !== expectedHeight) { errors.push(`${label} 编号 ${placement?.marker_id ?? "?"} 标签尺寸不符合实际 glyph`); return; }
  try {
    const expectedInk = textInkSet(placement.marker_id, scale, true, bounds.width, bounds.height); for (let y = 1; y < bounds.height - 1; y += 1) for (let x = 1; x < bounds.width - 1; x += 1) { const offset = ((bounds.y + y) * decoded.width + bounds.x + x) * 4; const actualWhite = decoded.pixels[offset] === 255 && decoded.pixels[offset + 1] === 255 && decoded.pixels[offset + 2] === 255; if (actualWhite !== expectedInk.has(`${x},${y}`)) { errors.push(`${label} 编号 ${placement.marker_id} 的实际标签字形不一致`); return; } }
  } catch (error) { errors.push(`${label} 编号 ${placement?.marker_id ?? "?"} 包含无法绘制的文字：${error.message}`); }
}

/** 验证最终布局图的 metadata、编号映射、父子关系、完整停靠方案和上游拆解身份。 */
export function validateLayoutAnnotationPng(bytes, expected = {}, errors = [], label = "layout_annotation") {
  let decoded; try { decoded = decodePngRgba(bytes); } catch (error) { errors.push(`${label} 必须是完整 PNG：${error.message}`); return null; }
  const metadata = decoded.metadata; if (!isObject(metadata)) { errors.push(`${label} 缺少 annotation-meta 元数据`); return null; }
  for (const [key, value] of [["schema", LAYOUT_ANNOTATION_SCHEMA], ["layout", LAYOUT_ANNOTATION_LAYOUT], ["annotation_kind", LAYOUT_ANNOTATION_KIND]]) if (metadata[key] !== value) errors.push(`${label}.${key} 必须为 ${value}`);
  for (const [key, value] of [["scene_id", expected.sceneId ?? expected.scene_id], ["state_id", expected.stateId ?? expected.state_id], ["decomposition_confirmation_id", expected.decompositionConfirmationId ?? expected.decomposition_confirmation_id], ["layout_decision_id", expected.layoutDecisionId ?? expected.layout_decision_id]]) if (value !== undefined && metadata[key] !== value) errors.push(`${label}.${key} 未绑定上游拆解确认身份或显式智能布局决策身份`);
  if (metadata.width !== decoded.width || metadata.height !== decoded.height || !Number.isInteger(metadata.original_width) || !Number.isInteger(metadata.original_height) || metadata.original_width <= 0 || metadata.original_width >= decoded.width || metadata.original_height <= 0 || metadata.original_height > decoded.height || !Number.isInteger(metadata.text_scale) || metadata.text_scale < 1 || metadata.text_scale > 3) { errors.push(`${label} 元数据尺寸或文字字号与 PNG 不一致`); return null; }
  if (!Array.isArray(metadata.nodes) || metadata.nodes.length === 0 || metadata.nodes.some((node) => !isObject(node))) { errors.push(`${label}.nodes 必须是非空节点数组`); return null; }
  if (!Array.isArray(metadata.visible_rows) || metadata.visible_rows.length === 0 || metadata.visible_rows.some((row) => !isObject(row)) || metadata.panel_content_complete !== true) { errors.push(`${label} 右侧说明栏必须完整落盘`); return null; }
  const expectedFactsRaw = expected.layoutNodes ? deriveAutomaticLayoutFacts(expected.layoutNodes, { width: metadata.original_width, height: metadata.original_height }, expected) : expected.layoutFacts; const expectedFacts = Array.isArray(expectedFactsRaw) ? (expectedFactsRaw.every((fact) => LAYOUT_MARKER_PATTERN.test(String(fact?.marker_id ?? ""))) ? expectedFactsRaw : assignLayoutMarkers(expectedFactsRaw)) : null;
  if (Array.isArray(expectedFacts)) {
    const projectFact = (fact) => ({ layout_node_id: fact.layout_node_id, element_id: fact.element_id, element_type: fact.element_type ?? (fact.is_container ? "container" : "component"), render_kind: fact.render_kind ?? null, display_name_zh: fact.display_name_zh ?? null, display_name: fact.display_name ?? null, layout_role: fact.layout_role ?? null, parent_layout_node_id: fact.parent_layout_node_id, parent_element_id: fact.parent_element_id ?? fact.parent_layout_node_id ?? null, reference_id: fact.reference_id ?? null, reference_target_bounds: fact.reference_target_bounds ?? null, sprite_geometry: fact.sprite_geometry ?? null, parent_marker_id: fact.parent_marker_id ?? null, marker_id: fact.marker_id, depth: fact.depth, color: fact.color, bounds: fact.bounds, target_bounds: fact.target_bounds, parent_target_bounds: fact.parent_target_bounds, is_container: fact.is_container, empty_container: fact.empty_container, semantic_grouping: fact.semantic_grouping ?? null, ui_layout: fact.ui_layout ?? null, nine_slice: fact.nine_slice ?? null, nine_slice_decision_required: fact.nine_slice_decision_required === true ? true : null, owner_type: fact.owner_type ?? null, region_layer: fact.region_layer ?? null, visual_route_element_type: fact.visual_route_element_type ?? null, region_id: fact.region_id ?? null, component_id: fact.component_id ?? null, placement_id: fact.placement_id ?? null, child_layout_node_ids: fact.child_layout_node_ids, relative_position: fact.relative_position, axis_alignment: fact.axis_alignment, center_alignment: fact.center_alignment ?? null, offset: fact.offset, self_anchor: fact.self_anchor, reference_anchor: fact.reference_anchor, docking: fact.docking ?? null, is_root_container: fact.is_root_container === true });
    const actualProjection = Array.isArray(metadata.nodes) ? metadata.nodes.map(projectFact) : []; const expectedProjection = expectedFacts.map(projectFact); if (canonicalJson(actualProjection) !== canonicalJson(expectedProjection)) errors.push(`${label}.nodes 必须按已确认 decomposition_elements 原顺序完整绑定布局关系`);
    const expectedMarkerMap = expectedFacts.map((fact) => ({ marker_id: fact.marker_id, layout_node_id: fact.layout_node_id, element_id: fact.element_id, parent_layout_node_id: fact.parent_layout_node_id, parent_marker_id: fact.parent_marker_id ?? null, is_root_container: fact.is_root_container === true })); if (canonicalJson(metadata.marker_map) !== canonicalJson(expectedMarkerMap)) errors.push(`${label}.marker_map 必须一一绑定编号、元素和父编号`); const markers = (metadata.nodes ?? []).map((fact) => fact.marker_id); if (new Set(markers).size !== markers.length || markers.some((marker) => !LAYOUT_MARKER_PATTERN.test(String(marker)))) errors.push(`${label} 节点编号必须唯一且使用 Lxx/Rxx 格式`);
    const expectedRows = deriveLayoutAnnotationRows(expectedFacts); const actualRows = metadata.visible_rows;
    const expectedScale = Math.max(1, Math.min(3, Math.floor(metadata.original_height / 320)));
    const expectedPanelWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.max(...expectedRows.map((row) => textWidth(row.text, expectedScale))) + PANEL_HORIZONTAL_PADDING * 2));
    const physicalRows = expectedRows.flatMap((row) => wrapTextByWidth(row.text, expectedPanelWidth - PANEL_HORIZONTAL_PADDING * 2, expectedScale).map((text, index, chunks) => ({ ...row, text, line_index: index, line_count: chunks.length })));
    if (metadata.text_scale !== expectedScale || metadata.panel_width !== expectedPanelWidth || decoded.width !== metadata.original_width + expectedPanelWidth || metadata.line_height !== 20 * expectedScale || metadata.visible_row_count !== actualRows.length || actualRows.length !== physicalRows.length || decoded.height !== Math.max(metadata.original_height, (physicalRows.length + 2) * 20 * expectedScale)) errors.push(`${label} 右栏尺寸、行数或换行结构不一致`);
    // 可见行必须与原序推导的文本逐行一致，不能通过重复、移位或插入未知说明冒充完整。
    actualRows.forEach((row, index) => {
      const planned = physicalRows[index]; const baseline = (index + 1) * 20 * expectedScale;
      if (!planned || row.row_index !== index || row.logical_row_id !== planned.logical_row_id || row.text !== planned.text || row.line_index !== planned.line_index || row.line_count !== planned.line_count || row.baseline !== baseline || row.bounds?.x !== metadata.original_width + PANEL_HORIZONTAL_PADDING) errors.push(`${label} 右栏第 ${index} 行与确认节点说明不一致`);
    });
    const rowBounds = []; for (const row of actualRows) { validateVisibleRowPixels(decoded, row, metadata, label, errors); if (isObject(row?.bounds)) rowBounds.push(row.bounds); }
    for (let index = 0; index < rowBounds.length; index += 1) for (let next = index + 1; next < rowBounds.length; next += 1) if (rectanglesOverlap(rowBounds[index], rowBounds[next])) errors.push(`${label} 右栏行存在像素区域重叠`);
    for (const expectedRow of expectedRows) { const matching = actualRows.filter((row) => row.logical_row_id === expectedRow.logical_row_id && row.marker_id === expectedRow.marker_id).sort((left, right) => left.line_index - right.line_index); const combined = matching.map((row) => String(row.text ?? "")).join(""); if (matching.length === 0 || combined !== expectedRow.text) errors.push(`${label} 右栏缺少与 ${expectedRow.marker_id ?? expectedRow.kind} 对应的完整说明`); if (expectedRow.marker_id && matching.some((row) => row.parent_marker_id !== expectedRow.parent_marker_id || row.layout_node_id !== expectedRow.layout_node_id)) errors.push(`${label} 右栏 ${expectedRow.marker_id} 的父子映射不一致`); }
    const markerLayouts = Array.isArray(metadata.marker_layouts) ? metadata.marker_layouts : [];
    // 按冻结事实复算标签位置与引线目标，防止把正确编号移到另一个容器旁边。
    const expectedPlacements = computeLayoutMarkerPlacements(expectedFacts, { width: metadata.original_width, height: metadata.original_height }, metadata.text_scale);
    if (canonicalJson(markerLayouts) !== canonicalJson(expectedPlacements)) errors.push(`${label} 左侧编号位置、目标框或引线映射不一致`);
    for (const fact of expectedFacts) {
      const layout = markerLayouts.find((item) => item?.marker_id === fact.marker_id && item?.layout_node_id === fact.layout_node_id);
      if (!layout || !isObject(layout.bounds) || layout.bounds.x < 0 || layout.bounds.y < 0 || layout.bounds.x + layout.bounds.width > metadata.original_width || layout.bounds.y + layout.bounds.height > metadata.original_height) errors.push(`${label} 左侧缺少可见编号 ${fact.marker_id} 或编号越界`);
      else validateMarkerPixels(decoded, layout, metadata, label, errors);
    }
  }
  // 回传的身份摘要只从当前 PNG 内容生成；元数据中的可选旧值不会影响校验或报告。
  const annotationSha256 = sha256(bytes); const metadataSha256 = computeLayoutAnnotationMetadataSha256(metadata); const identity = computeLayoutAnnotationIdentitySha256(annotationSha256, decoded.width, decoded.height, metadataSha256); return { decoded, metadata, annotationSha256, identitySha256: identity, metadataSha256 };
}

/** 简易像素绘制工具；复用固定字库，保证中文关系不会只存在于 PNG 元数据。 */
function setPixel(pixels, width, height, x, y, color) { if (x < 0 || y < 0 || x >= width || y >= height) return; const index = (y * width + x) * 4; pixels[index] = color[0]; pixels[index + 1] = color[1]; pixels[index + 2] = color[2]; pixels[index + 3] = 255; }
/** 将绘制范围裁到画布内，不改变输入节点几何。 */
function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) { for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + rectHeight)); yy += 1) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + rectWidth)); xx += 1) setPixel(pixels, width, height, xx, yy, color); }
/** 用内描边保留确认 bounds，避免扩张元素布局。 */
function strokeRect(pixels, width, height, x, y, rectWidth, rectHeight, color, thickness) { for (let i = 0; i < thickness; i += 1) { fillRect(pixels, width, height, x + i, y + i, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + rectHeight - i - 1, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + i, 1, rectHeight - i * 2, color); fillRect(pixels, width, height, x + rectWidth - i - 1, y + i, 1, rectHeight - i * 2, color); } }
/** 绘制编号与框之间的确定性引线，让移出小框的标签仍能追溯到唯一节点。 */
function drawLine(pixels, width, height, fromX, fromY, toX, toY, color) { let x = Math.round(fromX); let y = Math.round(fromY); const targetX = Math.round(toX); const targetY = Math.round(toY); const stepX = Math.abs(targetX - x); const stepY = -Math.abs(targetY - y); let error = stepX + stepY; while (true) { setPixel(pixels, width, height, x, y, color); if (x === targetX && y === targetY) break; const twice = 2 * error; if (twice >= stepY) { error += stepY; x += x < targetX ? 1 : -1; } if (twice <= stepX) { error += stepX; y += y < targetY ? 1 : -1; } } }
/** 固定字库没有收录的 ASCII 仍使用随包字形，避免长技术 ID 退化为问号。 */
function glyph(character) { if (/[^\x00-\x7f]/u.test(character)) return effectImageFontGlyph(character); if (/[a-z]/u.test(character)) return effectImageFontGlyph(character); return ASCII_GLYPHS[character.toUpperCase()] ?? effectImageFontGlyph(character); }
/** ASCII 基础字模宽度为 6，扩展字库字符按真实 16px cell 加间距计算。 */
function advance(character, scale) { if (/[^\x00-\x7f]/u.test(character) || /[a-z]/u.test(character)) return 18 * scale; return ASCII_GLYPHS[character.toUpperCase()] ? 6 * scale : 18 * scale; }
/** 用绘制时相同的字形步进计算换行宽度。 */
function textWidth(value, scale) { return [...String(value ?? "")].reduce((sum, character) => sum + advance(character, scale), 0); }
/** 使用整数基线绘制固定字模，保证验证器能逐像素复算。 */
function drawText(pixels, width, height, x, baseline, value, color, scale) { let cursor = Math.round(x); for (const character of [...String(value ?? "")]) { const rows = glyph(character); for (let y = 0; y < rows.length; y += 1) for (let xx = 0; xx < rows[y].length; xx += 1) if (rows[y][xx] === "1") fillRect(pixels, width, height, cursor + xx * scale, baseline - (rows.length - y) * scale, scale, scale, color); cursor += advance(character, scale); } }
/** 编号只含固定七行 ASCII 字模，按同一整数基线居中，避免半像素扩大笔画。 */
function drawTextCentered(pixels, width, height, centerX, centerY, value, color, scale) {
  drawText(pixels, width, height, Math.round(centerX - textWidth(value, scale) / 2), Math.round(centerY - 7 * scale / 2) + 7 * scale, value, color, scale);
}
