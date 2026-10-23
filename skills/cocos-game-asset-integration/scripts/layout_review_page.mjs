#!/usr/bin/env node

/**
 * 生成离线布局候选审阅页。
 *
 * 页面是布局标注 PNG 的审阅辅助物，所有几何事实直接来自同一次生成的
 * nodesDocument；这里不会写入业务状态，也不会创建人工确认记录。
 */
import { readFileSync } from "node:fs";
import { deriveAutomaticLayoutFacts } from "./layout_annotation_contract.mjs";
import { readPngDimensions } from "./validate_visual_manifest.mjs";
import { validateUiLayout } from "./ui-layout-organization.mjs";
import { validateSpriteGeometry } from "../../cocos-game-ui-layout/scripts/sprite-layout-sizing.mjs";
import { hasSpriteRendering } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";
import { validateLayoutExecutionNodes } from "../../cocos-game-ui-layout/scripts/widget-layout.mjs";

export const LAYOUT_REVIEW_SCHEMA = "cocos-layout-review/1.0";
export const LAYOUT_REVIEW_STATUS = "candidate-awaiting-layout-confirmation";

const ROOT_IDS = new Set(["viewport", "safe-area"]);
const HORIZONTAL_ALIGNMENTS = new Set(["left", "center", "right"]);
const VERTICAL_ALIGNMENTS = new Set(["top", "center", "bottom"]);
const TEMPLATE = readFileSync(new URL("../assets/layout-review-template.html", import.meta.url), "utf8");
const NAME_RULES = JSON.parse(readFileSync(new URL("../assets/layout-node-names.zh-CN.json", import.meta.url), "utf8"));

/** 判断普通对象，避免把数组误当成合同对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断非空字符串，所有身份字段都必须经过同一入口检查。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 将外部传入的字节统一为只读语义的 Buffer 视图。 */
function toBytes(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} 必须是 Buffer 或 Uint8Array`);
}

/** 生成排序后的 JSON，保证相同事实不因对象属性插入顺序产生不同审阅页。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 对照 HTML 与外部节点快照时忽略可选摘要记录，保留其余结构的严格比较。 */
function canonicalWithoutSha(value) {
  if (Array.isArray(value)) return value.map(canonicalWithoutSha);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:sha1|sha256|hash|fingerprint)/iu.test(key))
    .map(([key, item]) => [key, canonicalWithoutSha(item)]));
}

/** 转义 JSON script 中会改变 HTML 解析边界的字符。 */
function escapeJsonForScript(value) {
  return canonicalJson(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029"
  })[character]);
}

/** 创建只含固定 MIME 和实际输入字节的离线 data URL。 */
function dataUrl(mime, bytes) {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** 拒绝绝对路径与路径上跳，避免把本机位置写入可移动审阅页。 */
function assertRelativeFilePath(value, label) {
  if (!nonEmptyString(value) || /^(?:[a-zA-Z]:[\\/]|[\\/]{1,2})/.test(value) || value.includes("../") || value.includes("..\\")) throw new Error(`${label} 必须是项目相对路径`);
}

/** 校验 viewport 的整数边界，使其可安全用于 CSS 比例和坐标映射。 */
function validateViewport(viewport, label = "viewport") {
  if (!isObject(viewport) || !Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error(`${label} 必须是正整数宽高`);
  return { width: viewport.width, height: viewport.height };
}

/** 校验几何矩形，并拒绝负位置、零尺寸和超出冻结 viewport 的事实。 */
function validateBounds(bounds, viewport, label) {
  if (!isObject(bounds) || !["x", "y", "width", "height"].every((key) => Number.isFinite(bounds[key]))) throw new Error(`${label} 必须包含有限 x/y/width/height`);
  if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height) throw new Error(`${label} 必须完全位于冻结 viewport 内`);
  return bounds;
}

/** 比较两个 bounds 的全部数值，保证父节点事实没有被页面输入悄悄替换。 */
function sameBounds(left, right) {
  return isObject(left) && isObject(right) && ["x", "y", "width", "height"].every((key) => left[key] === right[key]);
}

/** 从最终事实读取 target_bounds；仅做字段别名适配，不重新计算位置。 */
function targetBoundsOf(node) {
  return node?.target_bounds ?? node?.targetBounds ?? node?.bounds;
}

/** 校验节点的双轴对齐声明。 */
function validateAlignment(alignment, label) {
  if (!isObject(alignment) || !HORIZONTAL_ALIGNMENTS.has(alignment.horizontal) || !VERTICAL_ALIGNMENTS.has(alignment.vertical)) throw new Error(`${label} 必须包含合法水平和垂直对齐`);
}

/** 校验节点、根节点和几何事实，并复用布局合同的自动事实校验器发现环与非法父链。 */
export function validateReviewNodesDocument(nodesDocument) {
  if (!isObject(nodesDocument)) throw new Error("nodesDocument 必须是对象");
  if (nodesDocument.schema !== "cocos-layout-nodes/1.0") throw new Error("nodesDocument.schema 必须为 cocos-layout-nodes/1.0");
  if (nodesDocument.status !== LAYOUT_REVIEW_STATUS) throw new Error(`nodesDocument.status 必须为 ${LAYOUT_REVIEW_STATUS}`);
  for (const field of ["scene_id", "state_id", "decomposition_confirmation_id", "layout_decision_id"]) if (!nonEmptyString(nodesDocument[field])) throw new Error(`nodesDocument.${field} 必须是非空字符串`);
  const viewport = validateViewport(nodesDocument.viewport, "nodesDocument.viewport");
  if (!Array.isArray(nodesDocument.layout_nodes) || nodesDocument.layout_nodes.length === 0) throw new Error("nodesDocument.layout_nodes 必须是非空数组");
  if (!Array.isArray(nodesDocument.root_nodes) || nodesDocument.root_nodes.length === 0) throw new Error("nodesDocument.root_nodes 必须是非空数组");

  const roots = [];
  const rootIds = new Set();
  for (const [index, root] of nodesDocument.root_nodes.entries()) {
    if (!isObject(root) || !nonEmptyString(root.layout_node_id)) throw new Error(`nodesDocument.root_nodes[${index}] 缺少 layout_node_id`);
    if (!ROOT_IDS.has(root.layout_node_id)) throw new Error(`nodesDocument.root_nodes[${index}] 不是受支持的根节点`);
    if (rootIds.has(root.layout_node_id)) throw new Error(`nodesDocument.root_nodes 存在重复根节点：${root.layout_node_id}`);
    rootIds.add(root.layout_node_id);
    const rootBounds = targetBoundsOf(root);
    validateBounds(rootBounds, viewport, `nodesDocument.root_nodes[${index}].target_bounds`);
    if (!sameBounds(rootBounds, { x: 0, y: 0, width: viewport.width, height: viewport.height })) throw new Error(`根节点 ${root.layout_node_id} bounds 必须覆盖完整冻结 viewport`);
    if (root.is_root_container !== true) throw new Error(`根节点 ${root.layout_node_id} 必须标记为 is_root_container`);
    if (root.parent_layout_node_id !== null) throw new Error(`根节点 ${root.layout_node_id} 必须显式声明空 parent_layout_node_id`);
    roots.push(root);
  }

  const nodes = [];
  const nodeIds = new Set();
  for (const [index, node] of nodesDocument.layout_nodes.entries()) {
    if (!isObject(node) || !nonEmptyString(node.layout_node_id) || !nonEmptyString(node.parent_layout_node_id)) throw new Error(`nodesDocument.layout_nodes[${index}] 缺少布局节点或父节点身份`);
    if (nodeIds.has(node.layout_node_id) || ROOT_IDS.has(node.layout_node_id)) throw new Error(`nodesDocument.layout_nodes 存在重复或根节点身份：${node.layout_node_id}`);
    nodeIds.add(node.layout_node_id);
    if (node.is_root_container === true) throw new Error(`nodesDocument.layout_nodes[${index}] 必须是非 root 节点`);
    const uiErrors = [];
    validateUiLayout(node.ui_layout, { rootParent: ROOT_IDS.has(node.parent_layout_node_id), container: node.is_container === true, emptyContainer: node.empty_container === true && !hasSpriteRendering(node) }, uiErrors, `nodesDocument.layout_nodes[${index}].ui_layout`);
    if (uiErrors.length > 0) throw new Error(uiErrors[0]);
    if (node.scene_id !== undefined && node.scene_id !== nodesDocument.scene_id) throw new Error(`布局节点 ${node.layout_node_id} 的 scene_id 与文档不一致`);
    if (node.state_id !== undefined && node.state_id !== nodesDocument.state_id) throw new Error(`布局节点 ${node.layout_node_id} 的 state_id 与文档不一致`);
    const spriteErrors = [];
    validateSpriteGeometry(node, spriteErrors, `布局节点 ${node.layout_node_id}`);
    if (spriteErrors.length) throw new Error(spriteErrors[0]);
    const target = targetBoundsOf(node);
    const parent = node.parent_target_bounds ?? node.parentTargetBounds;
    validateBounds(target, viewport, `布局节点 ${node.layout_node_id}.target_bounds`);
    validateBounds(parent, viewport, `布局节点 ${node.layout_node_id}.parent_target_bounds`);
    validateAlignment(node.axis_alignment ?? node.axisAlignment, `布局节点 ${node.layout_node_id}.axis_alignment`);
    if (node.depth !== undefined && (!Number.isSafeInteger(node.depth) || node.depth < 1)) throw new Error(`布局节点 ${node.layout_node_id}.depth 必须是正整数`);
    if (node.marker_id !== undefined && !nonEmptyString(node.marker_id)) throw new Error(`布局节点 ${node.layout_node_id}.marker_id 不能为空`);
    nodes.push(node);
  }

  const nodeById = new Map(nodes.map((node) => [node.layout_node_id, node]));
  const rootById = new Map(roots.map((node) => [node.layout_node_id, node]));
  const allParents = new Map([...rootById, ...nodeById]);
  // 先复用既有推导器发现父链环和缺失父级，再核对 root_nodes 的快照几何。
  let derivedFacts;
  try {
    derivedFacts = deriveAutomaticLayoutFacts(nodes, viewport, { sceneId: nodesDocument.scene_id, stateId: nodesDocument.state_id });
    const executionErrors = [];
    validateLayoutExecutionNodes(nodes, executionErrors, "nodesDocument.layout_nodes", { requirePlan: true });
    if (executionErrors.length) throw new Error(executionErrors[0]);
  } catch (error) {
    throw new Error(`布局节点事实校验失败：${error.message}`);
  }
  for (const node of nodes) {
    const parentNode = allParents.get(node.parent_layout_node_id);
    if (!parentNode) throw new Error(`布局节点 ${node.layout_node_id} 引用未确认的父节点：${node.parent_layout_node_id}`);
  }

  // 这里只比对现有 facts 与推导结果；页面展示仍使用传入节点原顺序和原字段。
  const derivedById = new Map(derivedFacts.map((fact) => [fact.layout_node_id, fact]));
  const comparableFields = [
    "layout_node_id", "element_id", "display_name", "layout_role", "render_kind", "parent_layout_node_id", "parent_target_bounds", "reference_id", "reference_target_bounds", "sprite_geometry",
    "target_bounds", "bounds", "depth", "color", "is_container", "empty_container", "child_layout_node_ids",
    "relative_position", "axis_alignment", "center_alignment", "layout_execution", "offset", "self_anchor", "reference_anchor", "docking",
    "is_root_container", "scene_id", "state_id", "marker_id", "parent_marker_id", "ui_layout"
  ];
  const compareFact = (fact, derived, label) => {
    for (const field of comparableFields) if (fact[field] !== undefined && canonicalJson(fact[field]) !== canonicalJson(derived[field])) throw new Error(`${label}.${field} 与既有自动布局事实不一致`);
  };
  for (const node of nodes) {
    const derived = derivedById.get(node.layout_node_id);
    if (!derived) throw new Error(`布局节点 ${node.layout_node_id} 缺少自动事实校验结果`);
    compareFact(node, derived, `布局节点 ${node.layout_node_id}`);
  }
  const derivedRoots = derivedFacts.filter((fact) => fact.is_root_container === true);
  if (derivedRoots.length !== roots.length) throw new Error("root_nodes 必须与既有自动布局事实的根节点集合一致");
  if (canonicalJson(roots.map((root) => root.layout_node_id)) !== canonicalJson(derivedRoots.map((root) => root.layout_node_id))) throw new Error("root_nodes 必须保持既有自动布局事实的根节点顺序");
  for (const root of roots) {
    const derived = derivedById.get(root.layout_node_id);
    if (!derived || derived.is_root_container !== true) throw new Error(`根节点 ${root.layout_node_id} 不存在于既有自动布局事实`);
    compareFact(root, derived, `根节点 ${root.layout_node_id}`);
  }
  return { viewport, nodes, roots };
}

/** 校验绑定对象的结构、场景身份和实际输入文件内容。 */
function validateBindings(nodesDocument, bindings, bytes) {
  if (!isObject(bindings)) throw new Error("bindings 必须是对象");
  if (bindings.schema !== LAYOUT_REVIEW_SCHEMA) throw new Error(`bindings.schema 必须为 ${LAYOUT_REVIEW_SCHEMA}`);
  if (bindings.status !== LAYOUT_REVIEW_STATUS) throw new Error(`bindings.status 必须为 ${LAYOUT_REVIEW_STATUS}`);
  for (const field of ["scene_id", "state_id", "decomposition_confirmation_id", "layout_decision_id"]) if (!nonEmptyString(bindings[field])) throw new Error(`bindings.${field} 必须是非空字符串`);
  const bindingViewport = validateViewport(bindings.viewport, "bindings.viewport");
  if (!sameBounds({ ...bindingViewport, x: 0, y: 0 }, { ...nodesDocument.viewport, x: 0, y: 0 })) throw new Error("bindings.viewport 与 nodesDocument.viewport 不一致");
  for (const field of ["scene_id", "state_id", "decomposition_confirmation_id", "layout_decision_id"]) {
    if (bindings[field] !== nodesDocument[field]) throw new Error(`bindings.${field} 与 nodesDocument.${field} 不一致`);
  }
  const groups = ["reference", "proposal", "decision", "nodes", "annotation"];
  for (const group of groups) {
    if (!isObject(bindings[group]) || !nonEmptyString(bindings[group].file)) throw new Error(`bindings.${group}.file 必须是非空字符串`);
    assertRelativeFilePath(bindings[group].file, `bindings.${group}.file`);
  }

  let nodesFileDocument;
  try { nodesFileDocument = JSON.parse(bytes.nodes.toString("utf8")); } catch (error) { throw new Error(`布局节点 JSON 不是合法 JSON：${error.message}`); }
  if (!isObject(nodesFileDocument) || canonicalJson(canonicalWithoutSha(nodesFileDocument)) !== canonicalJson(canonicalWithoutSha(nodesDocument))) throw new Error("布局节点 JSON 与页面展示的 nodesDocument 不一致");
  let decisionDocument;
  try { decisionDocument = JSON.parse(bytes.decision.toString("utf8")); } catch (error) { throw new Error(`布局决策 JSON 不是合法 JSON：${error.message}`); }
  if (!isObject(decisionDocument)) throw new Error("布局决策 JSON 必须是对象");
  const decisionId = decisionDocument.layout_decision_id ?? decisionDocument.decision_id;
  if (decisionId !== undefined && decisionId !== nodesDocument.layout_decision_id) throw new Error("布局决策 JSON 的 ID 与 nodesDocument 不一致");
  for (const [field, expected] of [["scene_id", nodesDocument.scene_id], ["state_id", nodesDocument.state_id]]) if (decisionDocument[field] !== undefined && decisionDocument[field] !== expected) throw new Error(`布局决策 JSON 的 ${field} 与 nodesDocument 不一致`);
}

/** 替换模板占位符，并在有遗漏时立即失败，避免产出半动态 HTML。 */
function fillTemplate(values) {
  const placeholders = [...TEMPLATE.matchAll(/__[A-Z0-9_]+__/g)].map((match) => match[0]);
  const expected = new Set(Object.keys(values));
  const unknown = placeholders.find((placeholder) => !expected.has(placeholder));
  if (unknown) throw new Error(`布局审阅模板存在未知占位符：${unknown}`);
  const missing = Object.keys(values).find((placeholder) => !placeholders.includes(placeholder));
  if (missing) throw new Error(`布局审阅模板缺少占位符：${missing}`);
  // 使用 replacer 回调，确保节点名称中的 $&、$`、$' 等字面量不会被字符串替换语义解释。
  return TEMPLATE.replace(/__[A-Z0-9_]+__/g, (placeholder) => values[placeholder]);
}

/** 校验供模板使用的 CSS 数字，避免任何输入值进入 CSS 语法。 */
function cssNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} 必须是非负有限数字`);
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`${label} 不是安全 CSS 数字`);
  return text;
}

/** 生成通用离线布局审阅页；输出只由模板、映射和本次传入字节决定。 */
export function renderLayoutReviewPage({ nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes }) {
  const bytes = {
    original: toBytes(originalBytes, "originalBytes"),
    annotation: toBytes(annotationBytes, "annotationBytes"),
    nodes: toBytes(nodesBytes, "nodesBytes"),
    decision: toBytes(decisionBytes, "decisionBytes")
  };
  const { viewport } = validateReviewNodesDocument(nodesDocument);
  const originalDimensions = readPngDimensions(bytes.original);
  if (!originalDimensions) throw new Error("originalBytes 必须是完整 PNG");
  if (originalDimensions.width !== viewport.width || originalDimensions.height !== viewport.height) throw new Error("冻结参考图尺寸必须与 nodesDocument.viewport 完全一致");
  if (!readPngDimensions(bytes.annotation)) throw new Error("annotationBytes 必须是完整 PNG");
  validateBindings(nodesDocument, bindings, bytes);
  const payload = escapeJsonForScript({ nodesDocument, bindings });
  return fillTemplate({
    __VIEWPORT_WIDTH__: cssNumber(viewport.width, "viewport.width"),
    __VIEWPORT_HEIGHT__: cssNumber(viewport.height, "viewport.height"),
    __REFERENCE_DATA_URL__: dataUrl("image/png", bytes.original),
    __ANNOTATION_DATA_URL__: dataUrl("image/png", bytes.annotation),
    __NODES_DATA_URL__: dataUrl("application/json", bytes.nodes),
    __DECISION_DATA_URL__: dataUrl("application/json", bytes.decision),
    __LAYOUT_REVIEW_PAYLOAD__: payload,
    __NAME_RULES__: escapeJsonForScript(NAME_RULES)
  });
}

/** 读取 HTML 中唯一的 JSON 数据块；只做解析，不执行 HTML 或脚本。 */
export function readLayoutReviewPayload(html) {
  if (typeof html !== "string") throw new TypeError("review HTML 必须是字符串");
  const scripts = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    const attributes = match[1];
    const idMatch = attributes.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if ((idMatch?.[1] ?? idMatch?.[2] ?? idMatch?.[3]) === "layout-review-data") scripts.push({ attributes, body: match[2] });
  }
  if (scripts.length === 0) throw new Error("review HTML 缺少 layout-review-data 数据块");
  if (scripts.length !== 1) throw new Error("review HTML 只能包含一个 layout-review-data 数据块");
  const typeMatch = scripts[0].attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const type = typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3];
  if (String(type ?? "").toLowerCase() !== "application/json") throw new Error("layout-review-data 必须声明 application/json 类型");
  let payload;
  try { payload = JSON.parse(scripts[0].body.trim()); } catch (error) { throw new Error(`layout-review-data JSON 无效：${error.message}`); }
  if (!isObject(payload) || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, "nodesDocument") || !Object.hasOwn(payload, "bindings")) throw new Error("layout-review-data 必须且只能包含 nodesDocument 和 bindings");
  return { nodesDocument: payload.nodesDocument, bindings: payload.bindings };
}
