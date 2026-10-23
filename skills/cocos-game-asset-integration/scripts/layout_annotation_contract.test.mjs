import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodePngRgba, encodePngRgba } from "./effect_image_raster.mjs";
import { buildDecompositionElements, validateDecompositionElements } from "./decomposition-elements.mjs";
import { colorForLayoutDepth, computeLayoutAnnotationMetadataSha256, computeLayoutMarkerPlacements, deriveAutomaticLayoutFacts, deriveLayoutAnnotationRows, deriveLayoutNodesFromDecompositionElements, renderLayoutAnnotation, validateLayoutAnnotationPng } from "./layout_annotation_contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 用真实 PNG 字节绑定测试目标，避免夹具身份与画布脱节。 */
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 构造同时包含普通叶子和显式空容器的已确认节点集合。 */
function confirmedNodes() {
  return [
    { layout_node_id: "panel", element_id: "panel", element_type: "container", parent_layout_node_id: "viewport", parent_element_id: "viewport", semantic_grouping: { kind: "component", rationale: "面板内元素需要共同停靠" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, layout_role: "container", axis_alignment: { horizontal: "left", vertical: "top" }, target_bounds: { x: 8, y: 6, width: 48, height: 34 } },
    { layout_node_id: "empty-slot", element_id: "empty-slot", element_type: "container", parent_layout_node_id: "panel", parent_element_id: "panel", semantic_grouping: { kind: "component", rationale: "预留一个明确用途的空功能容器" }, ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, node_type: "container", axis_alignment: { horizontal: "left", vertical: "top" }, target_bounds: { x: 12, y: 10, width: 12, height: 10 } },
    { layout_node_id: "icon", element_id: "icon", element_type: "component", parent_layout_node_id: "panel", parent_element_id: "panel", semantic_grouping: { kind: "part", rationale: "图标属于面板功能组件" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, node_type: "element", axis_alignment: { horizontal: "left", vertical: "top" }, target_bounds: { x: 30, y: 20, width: 10, height: 10 } },
  ];
}

/** 生成可供渲染器消费的微型原图，测试不依赖浏览器或外部资源。 */
const ORIGINAL_PNG = encodePngRgba(96, 80, Buffer.alloc(96 * 80 * 4, 240));
const ORIGINAL_SHA = `sha256:${createHash("sha256").update(ORIGINAL_PNG).digest("hex")}`;
/** 构造原始 PNG 输入，验证布局标注不会修改来源图。 */
function originalPng() { return ORIGINAL_PNG; }
/** 为不同尺寸的布局 fixture 生成独立源图，避免测试偷偷复用错误画布。 */
function solidPng(width, height, value = 240) { return encodePngRgba(width, height, Buffer.alloc(width * height * 4, value)); }

test("布局事实按深度稳定着色，普通叶子不冒充空容器", () => {
  const facts = deriveAutomaticLayoutFacts(confirmedNodes(), { width: 96, height: 80 }, { sceneId: "main", stateId: "default" });
  const panel = facts.find((item) => item.layout_node_id === "panel");
  const empty = facts.find((item) => item.layout_node_id === "empty-slot");
  const leaf = facts.find((item) => item.layout_node_id === "icon");
  assert.equal(panel.is_container, true);
  assert.equal(empty.empty_container, true);
  assert.equal(leaf.is_container, false);
  assert.equal(leaf.empty_container, false);
  assert.equal(panel.color, colorForLayoutDepth(panel.depth));
  assert.equal(empty.color, colorForLayoutDepth(empty.depth));
  assert.notEqual(panel.color, empty.color);
  assert.deepEqual(facts.filter((item) => !item.is_root_container).map((item) => item.layout_node_id), ["panel", "empty-slot", "icon"]);
  assert.deepEqual(panel.child_layout_node_ids, ["empty-slot", "icon"]);
});

test("布局职责字段改变会使节点身份和标注 metadata SHA 失效", () => {
  const canvas = { width: 96, height: 80 };
  const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA };
  const original = renderLayoutAnnotation(originalPng(), canvas, deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context), context);
  const changedNodes = confirmedNodes(); changedNodes[2].ui_layout.safe_area_policy = "FULL_BLEED";
  const changed = renderLayoutAnnotation(originalPng(), canvas, deriveAutomaticLayoutFacts(changedNodes, canvas, context), context);
  assert.notEqual(changed.metadata.node_identity_sha256, original.metadata.node_identity_sha256);
  assert.notEqual(changed.metadata.metadata_sha256, original.metadata.metadata_sha256);
});

test("一次自动生成独立布局 PNG，右栏包含父子距离和空容器", () => {
  const canvas = { width: 96, height: 80 };
  const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA };
  const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context);
  const rendered = renderLayoutAnnotation(originalPng(), canvas, facts, context);
  const rows = deriveLayoutAnnotationRows(facts).map((row) => row.text).join("\n");
  assert(rendered.width > canvas.width);
  assert(rows.includes("父容器 [L01]") && rows.includes("标识=panel") && rows.includes("子组件 [L03]") && rows.includes("标识=icon") && rows.includes("left=") && rows.includes("空容器"));
  const errors = [];
  validateLayoutAnnotationPng(rendered.bytes, { layoutFacts: facts, ...context }, errors, "layout");
  assert.deepEqual(errors, []);
  const drift = [];
  validateLayoutAnnotationPng(rendered.bytes, { layoutFacts: facts, ...context, decompositionConfirmationId: "decomp-drift" }, drift, "layout");
  assert(drift.some((item) => item.includes("上游拆解确认身份")));
});

test("高分辨率布局图的 scale=2/3 字形和右栏边界可被复核", () => {
  for (const height of [640, 960]) {
    const canvas = { width: 160, height }; const source = solidPng(canvas.width, canvas.height, 220); const context = { targetSha256: sha256(source), sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-hires", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA }; const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context); const rendered = renderLayoutAnnotation(source, canvas, facts, context); const errors = [];
    assert.equal(rendered.metadata.text_scale, height / 320); validateLayoutAnnotationPng(rendered.bytes, { layoutFacts: facts, ...context }, errors, "layout-hires"); assert.deepEqual(errors, []);
  }
});

test("布局生成拒绝缺失父节点或越界节点，不能从草案补父级", () => {
  assert.throws(() => deriveAutomaticLayoutFacts([{ layout_node_id: "orphan", parent_layout_node_id: "unconfirmed", ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, target_bounds: { x: 0, y: 0, width: 4, height: 4 } }], { width: 64, height: 48 }), /未确认的父容器/);
  const nodes = confirmedNodes();
  nodes[1].target_bounds.x = 60;
  assert.throws(() => deriveAutomaticLayoutFacts(nodes, { width: 64, height: 48 }), /超出已确认父容器 bounds/);
});

test("显式空容器不合成普通子元素，叶子组件不进入父容器说明", () => {
  const region = { id: "empty-region", scene_id: "main", state_id: "default", bounds: { x: 4, y: 4, width: 20, height: 16 }, component_inventory: { components: [{ component_id: "slot", role: "container", bounds: { x: 5, y: 5, width: 8, height: 6 }, parent_element_id: "viewport", semantic_grouping: { kind: "component", rationale: "预留有明确用途的空状态槽位" }, ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, placements: [] }] } };
  const elements = buildDecompositionElements([region]);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].element_type, "container");
  assert.equal(elements[0].empty_container, true);
  const decisions = new Map([[elements[0].element_id, { horizontal: "center", vertical: "center" }]]);
  const facts = deriveAutomaticLayoutFacts(deriveLayoutNodesFromDecompositionElements(elements, { width: 32, height: 24 }, { alignmentDecisions: decisions }), { width: 32, height: 24 });
  assert.equal(facts.find((item) => item.element_id === elements[0].element_id).empty_container, true);
});

test("严格居中按意图更新目标框，边缘停靠保留原测量位置", () => {
  const element = { element_id: "visual-item", element_type: "component", role: "component", bounds: { x: 10, y: 8, width: 8, height: 6 }, scene_id: "main", state_id: "default", region_id: "region", component_id: "item", placement_id: "item-placement", parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "完整独立美术无需功能组件容器" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: false };
  const canvas = { width: 40, height: 30 };
  const makeFact = (horizontal, vertical) => deriveAutomaticLayoutFacts(deriveLayoutNodesFromDecompositionElements([element], canvas, { alignmentDecisions: new Map([[element.element_id, { horizontal, vertical }]]) }), canvas).find((item) => item.element_id === element.element_id);
  const centered = makeFact("center", "center");
  const edged = makeFact("left", "top");
  assert.deepEqual(centered.bounds, { x: 16, y: 12, width: 8, height: 6 });
  assert.deepEqual(edged.bounds, element.bounds);
  assert.deepEqual(centered.offset, { x: 0, y: 0 });
  assert.deepEqual(centered.axis_alignment, { horizontal: "center", vertical: "center" });
  assert.deepEqual(edged.axis_alignment, { horizontal: "left", vertical: "top" });
  assert.notDeepEqual(centered.offset, edged.offset);
  assert.equal(centered.self_anchor, "center-center");
});

/** V2 九宫格正反决策穿过拆解、布局节点和人工可见旁栏事实。 */
test("V2九宫格正反决策在确认旁栏显示源尺寸与四边切片值", () => {
  const panelNineSlice = { mode: "stretch", reason: "底板四角和描边保持固定尺寸", source_size: { width: 96, height: 64 }, borders: { left: 12, right: 12, top: 10, bottom: 10 } };
  const iconNineSlice = { mode: "not-applicable", reason: "图标为固定尺寸，不需要拉伸" };
  const region = {
      id: "hud", scene_id: "main", state_id: "default", owner_type: "fixed-production-visual", visual_route_analysis: { element_type: "panel" }, bounds: { x: 0, y: 0, width: 96, height: 64 },
    component_inventory: { components: [
        { component_id: "panel", role: "background-frame", bounds: { x: 2, y: 2, width: 40, height: 30 }, parent_element_id: "viewport", nine_slice: panelNineSlice, semantic_grouping: { kind: "standalone", rationale: "完整面板底板独立拉伸" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "FULL_BLEED", interaction_policy: "NONE" }, placements: [] },
      { component_id: "icon", role: "icon", bounds: { x: 50, y: 2, width: 10, height: 10 }, parent_element_id: "viewport", nine_slice: iconNineSlice, semantic_grouping: { kind: "standalone", rationale: "图标按固定比例显示" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, placements: [] },
    ] },
  };
  const elements = buildDecompositionElements([region]);
  assert.deepEqual(elements.map((item) => item.nine_slice), [panelNineSlice, iconNineSlice]);
  assert.deepEqual(elements.map((item) => item.nine_slice_decision_required), [true, true]);
  const canvas = { width: 96, height: 64 };
  const alignmentDecisions = new Map(elements.map((item) => [item.element_id, { horizontal: "left", vertical: "top" }]));
  const nodes = deriveLayoutNodesFromDecompositionElements(elements, canvas, { alignmentDecisions });
  assert.deepEqual(nodes.map((node) => node.nine_slice), [panelNineSlice, iconNineSlice]);
  const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-slice", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA };
  const facts = deriveAutomaticLayoutFacts(nodes, canvas, context);
  const panelFact = facts.find((fact) => fact.component_id === "panel");
  const iconFact = facts.find((fact) => fact.component_id === "icon");
  assert.deepEqual(panelFact.nine_slice, panelNineSlice);
  assert.deepEqual(iconFact.nine_slice, iconNineSlice);
  const rows = deriveLayoutAnnotationRows(facts);
  assert.match(rows.find((row) => row.layout_node_id === panelFact.layout_node_id).text, /九宫格=stretch 源图=96×64 边界\(L\/R\/T\/B\)=12\/12\/10\/10/);
  assert.match(rows.find((row) => row.layout_node_id === iconFact.layout_node_id).text, /九宫格=not-applicable（图标为固定尺寸，不需要拉伸）/);
  const source = solidPng(canvas.width, canvas.height);
  const renderContext = { ...context, targetSha256: sha256(source) };
  const rendered = renderLayoutAnnotation(source, canvas, facts, renderContext);
  assert.deepEqual(rendered.metadata.nodes.find((fact) => fact.component_id === "panel").nine_slice, panelNineSlice);
  assert.equal(rendered.metadata.nodes.find((fact) => fact.component_id === "panel").nine_slice_decision_required, true);
  const errors = [];
  validateLayoutAnnotationPng(rendered.bytes, { layoutNodes: nodes, ...renderContext }, errors, "layout-nine-slice");
  assert.deepEqual(errors, []);

  const backgroundRegion = structuredClone(region);
  backgroundRegion.layer = "background";
  // 非法背景切片在规范化入口就关闭，不能继续生成待确认的拆解事实。
  assert.throws(() => buildDecompositionElements([backgroundRegion]), /九宫格 stretch/, "权威 background layer 即使使用 background-frame role 也必须拒绝 stretch");

  const routeOverrideRegion = structuredClone(region);
  routeOverrideRegion.component_inventory.components[0].role = "background";
  const routeOverrideElements = buildDecompositionElements([routeOverrideRegion]);
  assert.equal(routeOverrideElements[0].nine_slice_decision_required, true, "显式 panel route 应保持 V2 必评估");
  const routeOverrideErrors = [];
  validateDecompositionElements(routeOverrideElements, [routeOverrideRegion], canvas, "decomposition_elements", routeOverrideErrors);
  assert.equal(routeOverrideErrors.some((message) => message.includes("九宫格 stretch")), false, "UI 路线应覆盖元素自报 background role");

  const containerRegion = structuredClone(region);
  containerRegion.component_inventory.components[0].role = "container";
  assert.throws(() => buildDecompositionElements([containerRegion]), /纯结构容器/);
});

/** 固定生产 UI 皮肤必须在 V2 决策，后续 false/缺失不能伪造“无需评估”。 */
test("V2从显式角色派生必评估标记，缺少决策或手填 false 均拒绝", () => {
  const contract = { mode: "not-applicable", reason: "该按钮装饰为固定尺寸，不拉伸" };
  const region = {
    id: "button-region", scene_id: "main", state_id: "default", owner_type: "fixed-production-visual", visual_route_analysis: { element_type: "button" },
    bounds: { x: 0, y: 0, width: 48, height: 32 },
    component_inventory: { components: [{ component_id: "button", role: "button", bounds: { x: 4, y: 4, width: 24, height: 12 }, parent_element_id: "viewport", nine_slice: contract, semantic_grouping: { kind: "standalone", rationale: "独立按钮皮肤" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, placements: [] }] },
  };
  const elements = buildDecompositionElements([region]);
  assert.equal(elements[0].nine_slice_decision_required, true);
  assert.deepEqual(elements[0].nine_slice, contract);
  const missing = structuredClone(region); delete missing.component_inventory.components[0].nine_slice;
  assert.throws(() => buildDecompositionElements([missing]), /V2 必须确认 nine_slice/);
  const bypassed = structuredClone(elements); bypassed[0].nine_slice_decision_required = false;
  // 显式 region owner/route 仍能重算要求，false 不能关闭 V2 的必评估判断。
  const errors = [];
  validateDecompositionElements(bypassed, [region], { width: 48, height: 32 }, "decomposition_elements", errors);
  assert(errors.some((message) => message.includes("不接受 false 覆盖")));
  const forgedContext = structuredClone(elements);
  forgedContext[0].owner_type = "runtime-rendered";
  forgedContext[0].role = "illustration";
  forgedContext[0].visual_route_element_type = "illustration";
  forgedContext[0].nine_slice_decision_required = false;
  const contextErrors = [];
  validateDecompositionElements(forgedContext, [region], { width: 48, height: 32 }, "decomposition_elements", contextErrors);
  assert(contextErrors.some((message) => message.includes("权威归属")));
  assert(contextErrors.some((message) => message.includes("权威视觉路线")));
  assert(contextErrors.some((message) => message.includes("不接受 false 覆盖")));
  const nodes = deriveLayoutNodesFromDecompositionElements(elements, { width: 48, height: 32 }, { alignmentDecisions: new Map([[elements[0].element_id, { horizontal: "left", vertical: "top" }]]) });
  nodes[0].nine_slice_decision_required = false;
  assert.throws(() => deriveAutomaticLayoutFacts(nodes, { width: 48, height: 32 }), /不接受 false 覆盖/);
});

test("布局 PNG metadata 节点调序必须被拒绝", () => {
  const canvas = { width: 96, height: 80 }; const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA }; const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context); const rendered = renderLayoutAnnotation(originalPng(), canvas, facts, context); const decoded = decodePngRgba(rendered.bytes); const metadata = structuredClone(decoded.metadata); metadata.nodes.reverse(); const tampered = encodePngRgba(decoded.width, decoded.height, decoded.pixels, metadata); const errors = []; validateLayoutAnnotationPng(tampered, { layoutFacts: facts, ...context }, errors, "layout"); assert(errors.some((item) => item.includes("原顺序")));
});

test("每个节点拥有可追溯短编号，父容器和空容器都有自身停靠方案，根视口明确无上级", () => {
  const facts = deriveAutomaticLayoutFacts(confirmedNodes(), { width: 96, height: 80 }, { sceneId: "main", stateId: "default" });
  const roots = facts.filter((fact) => fact.is_root_container); const panel = facts.find((fact) => fact.layout_node_id === "panel"); const empty = facts.find((fact) => fact.layout_node_id === "empty-slot");
  assert.deepEqual(facts.filter((fact) => !fact.is_root_container).map((fact) => fact.marker_id), ["L01", "L02", "L03"]);
  assert.deepEqual(roots.map((fact) => fact.marker_id), ["R01"]); assert.equal(roots[0].parent_layout_node_id, null); assert.equal(roots[0].axis_alignment, null); assert.match(deriveLayoutAnnotationRows(facts).find((row) => row.kind === "root").text, /R01.*无上级/);
  assert.equal(panel.parent_marker_id, "R01"); assert.equal(empty.parent_marker_id, "L01"); assert.deepEqual(panel.docking, { horizontal: "left", vertical: "top", self_anchor: "top-left", reference_anchor: "top-left", offset: panel.offset });
  for (const fact of [panel, empty, facts.find((item) => item.layout_node_id === "icon")]) { const row = deriveLayoutAnnotationRows(facts).find((item) => item.marker_id === fact.marker_id); assert.equal(row.parent_marker_id, fact.parent_marker_id); assert.match(row.text, new RegExp(`\\[${fact.marker_id}\\]`)); assert.match(row.text, /停靠=水平/); }
});

test("长技术 ID 和负小数停靠偏移完整换行，物理行不越过右栏", () => {
  const canvas = { width: 96, height: 64 }; const longId = "container:home-top-status-very-long-confirmed-element-id-0123456789"; const childId = "child-with-a-negative-offset-and-a-long-id-987654321"; const nodes = [
    { layout_node_id: longId, element_id: longId, parent_layout_node_id: "viewport", ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, layout_role: "container", axis_alignment: { horizontal: "left", vertical: "top" }, target_bounds: { x: 2, y: 2, width: 70, height: 48 } },
    { layout_node_id: childId, element_id: childId, parent_layout_node_id: longId, ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, node_type: "element", axis_alignment: { horizontal: "center", vertical: "center" }, center_alignment: { horizontal: { mode: "reference", offset: -28.5, reason: "此用例明确验证中心参照负小数偏移的长文本换行" }, vertical: { mode: "reference", offset: -17.5, reason: "此用例明确验证中心参照负小数偏移的长文本换行" } }, target_bounds: { x: 4, y: 4, width: 9, height: 9 } },
  ];
  const source = solidPng(canvas.width, canvas.height, 220); const context = { targetSha256: sha256(source), sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA }; const facts = deriveAutomaticLayoutFacts(nodes, canvas, context); const rendered = renderLayoutAnnotation(source, canvas, facts, context); const rows = rendered.metadata.visible_rows; const longFact = facts.find((fact) => fact.layout_node_id === longId); const longText = rows.filter((row) => row.marker_id === longFact.marker_id).sort((a, b) => a.line_index - b.line_index).map((row) => row.text).join("");
  assert(longText.includes(longId)); assert(rendered.metadata.visible_row_count > deriveLayoutAnnotationRows(facts).length); assert(rows.every((row) => row.bounds.x >= canvas.width && row.bounds.x + row.bounds.width <= rendered.width && row.bounds.y >= 0 && row.bounds.y + row.bounds.height <= rendered.height)); const childFact = rendered.metadata.nodes.find((fact) => fact.layout_node_id === childId); assert(childFact.offset.x < 0 && !Number.isInteger(childFact.offset.x)); assert(childFact.offset.y < 0 && !Number.isInteger(childFact.offset.y));
});

test("密集小框的编号标签确定性避让且不互相重叠", () => {
  const canvas = { width: 180, height: 100 }; const nodes = Array.from({ length: 6 }, (_, index) => ({ layout_node_id: `small-${index + 1}`, element_id: `small-${index + 1}`, parent_layout_node_id: "viewport", ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, node_type: "element", axis_alignment: { horizontal: index % 2 ? "right" : "left", vertical: "top" }, target_bounds: { x: 8 + (index % 3) * 54, y: 8 + Math.floor(index / 3) * 42, width: 8, height: 8 } })); const facts = deriveAutomaticLayoutFacts(nodes, canvas, {}); const source = solidPng(canvas.width, canvas.height); const rendered = renderLayoutAnnotation(source, canvas, facts, {}); const placements = rendered.metadata.marker_layouts;
  assert.deepEqual(placements, computeLayoutMarkerPlacements(facts, canvas, rendered.metadata.text_scale)); assert.equal(new Set(placements.map((item) => item.marker_id)).size, placements.length); for (let index = 0; index < placements.length; index += 1) for (let next = index + 1; next < placements.length; next += 1) { const left = placements[index].bounds; const right = placements[next].bounds; assert(left.x + left.width <= right.x || right.x + right.width <= left.x || left.y + left.height <= right.y || right.y + right.height <= left.y); }
});

test("编号没有可见位置时显式失败，不静默绘制重叠标签", () => {
  const canvas = { width: 10, height: 10 }; const nodes = [{ layout_node_id: "tiny", element_id: "tiny", parent_layout_node_id: "viewport", ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, node_type: "element", axis_alignment: { horizontal: "left", vertical: "top" }, target_bounds: { x: 1, y: 1, width: 8, height: 8 } }]; const facts = deriveAutomaticLayoutFacts(nodes, canvas, {});
  assert.throws(() => renderLayoutAnnotation(solidPng(canvas.width, canvas.height), canvas, facts, {}), /超出原图可见尺寸/);
});

test("重新计算 metadata SHA 后篡改编号或说明仍会被拒绝", () => {
  const canvas = { width: 96, height: 80 }; const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA }; const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context); const rendered = renderLayoutAnnotation(originalPng(), canvas, facts, context); const decoded = decodePngRgba(rendered.bytes);
  const markerMetadata = structuredClone(decoded.metadata); markerMetadata.marker_map[0].marker_id = "L99"; markerMetadata.metadata_sha256 = computeLayoutAnnotationMetadataSha256(markerMetadata); const markerErrors = []; validateLayoutAnnotationPng(encodePngRgba(decoded.width, decoded.height, decoded.pixels, markerMetadata), { layoutFacts: facts, ...context }, markerErrors, "layout"); assert(markerErrors.some((item) => item.includes("marker_map") || item.includes("编号")));
  const rowMetadata = structuredClone(decoded.metadata); const row = rowMetadata.visible_rows.find((item) => item.marker_id === "L01"); row.text = `${row.text}tampered`; rowMetadata.metadata_sha256 = computeLayoutAnnotationMetadataSha256(rowMetadata); const rowErrors = []; validateLayoutAnnotationPng(encodePngRgba(decoded.width, decoded.height, decoded.pixels, rowMetadata), { layoutFacts: facts, ...context }, rowErrors, "layout"); assert(rowErrors.some((item) => item.includes("右栏第") || item.includes("完整说明") || item.includes("实际文字像素")));
});

test("仅改PNG元数据目标框或父框并重签摘要仍被拒绝", () => {
  const canvas = { width: 96, height: 80 };
  const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas);
  const rendered = renderLayoutAnnotation(originalPng(), canvas, facts);
  const decoded = decodePngRgba(rendered.bytes);
  for (const field of ["target_bounds", "parent_target_bounds"]) {
    // PNG 的两种矩形投影都必须绑定，不能保留 bounds 后只篡改运行时目标框。
    const metadata = structuredClone(decoded.metadata);
    metadata.nodes[0][field].x += 1;
    metadata.metadata_sha256 = computeLayoutAnnotationMetadataSha256(metadata);
    const errors = [];
    validateLayoutAnnotationPng(encodePngRgba(decoded.width, decoded.height, decoded.pixels, metadata), { layoutFacts: facts }, errors);
    assert(errors.some((message) => message.includes("nodes 必须按已确认")), errors.join("\n"));
  }
});

test("擦除右栏文字或左侧编号像素会被发现，且原图、元素顺序和 bounds 不变", () => {
  const canvas = { width: 96, height: 80 }; const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA }; const sourceBefore = originalPng(); const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context); const rendered = renderLayoutAnnotation(sourceBefore, canvas, facts, context); const decoded = decodePngRgba(rendered.bytes); const erase = (pixels, rect, width) => { for (let y = rect.y; y < rect.y + rect.height; y += 1) for (let x = rect.x; x < rect.x + rect.width; x += 1) pixels.fill(255, (y * width + x) * 4, (y * width + x + 1) * 4); };
  const textMetadata = structuredClone(decoded.metadata); const textRow = textMetadata.visible_rows.find((item) => item.marker_id === "L01"); const textPixels = Buffer.from(decoded.pixels); erase(textPixels, textRow.bounds, decoded.width); const textErrors = []; validateLayoutAnnotationPng(encodePngRgba(decoded.width, decoded.height, textPixels, textMetadata), { layoutFacts: facts, ...context }, textErrors, "layout"); assert(textErrors.some((item) => item.includes("实际文字像素") || item.includes("没有可见文字")));
  const markerMetadata = structuredClone(decoded.metadata); const markerPixels = Buffer.from(decoded.pixels); erase(markerPixels, markerMetadata.marker_layouts.find((item) => item.marker_id === "L01").bounds, decoded.width); const markerErrors = []; validateLayoutAnnotationPng(encodePngRgba(decoded.width, decoded.height, markerPixels, markerMetadata), { layoutFacts: facts, ...context }, markerErrors, "layout"); assert(markerErrors.some((item) => item.includes("实际标签字形") || item.includes("编号")));
  assert.deepEqual(facts.filter((fact) => !fact.is_root_container).map((fact) => fact.layout_node_id), ["panel", "empty-slot", "icon"]); assert.deepEqual(facts.filter((fact) => !fact.is_root_container).map((fact) => fact.bounds), confirmedNodes().map((node) => node.target_bounds)); assert.deepEqual(sourceBefore, originalPng()); assert.equal(sha256(sourceBefore), ORIGINAL_SHA);
});
