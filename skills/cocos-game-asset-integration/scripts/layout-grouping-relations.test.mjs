import assert from "node:assert/strict";
import test from "node:test";
import { deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements, computeLayoutNodeIdentitySha256 } from "./layout_annotation_contract.mjs";
import { validateEffectImageParentChildLayoutNodes, axisAlignmentOffset } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";
import { buildLayoutNodesDocument } from "./layout_review_bundle.mjs";
import { validateReviewNodesDocument } from "./layout_review_page.mjs";
import { validateDecompositionElements } from "./decomposition-elements.mjs";

const CANVAS = { width: 200, height: 160 };

/** 构造保持原面板框的兄弟定位与突出角标，不增加联合包围容器。 */
function elements() {
  const definitions = [
    ["panel", "container", "component", "viewport", { x: 40, y: 40, width: 80, height: 60 }],
    ["icon", "component", "part", "panel", { x: 50, y: 50, width: 16, height: 16 }],
    ["label", "component", "part", "panel", { x: 74, y: 50, width: 30, height: 16 }],
    ["badge", "component", "part", "panel", { x: 112, y: 35, width: 16, height: 16 }],
  ];
  return definitions.map(([id, type, kind, parent, bounds]) => ({
    element_id: id, element_type: type, role: id === "panel" ? "container" : id,
    bounds, scene_id: "main", state_id: "default", region_id: "main-ui",
    component_id: id, placement_id: `${id}-instance`, parent_element_id: parent,
    semantic_grouping: { kind, rationale: "同一功能面板的内容与状态提示" },
    empty_container: false,
    ...(["icon", "badge"].includes(id) ? { owner_type: "fixed-production-visual" } : {}),
    ui_layout: {
      grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED",
      overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE",
      ...(id === "label" ? { position_reference_id: "icon" } : {}),
      ...(id === "badge" ? { visual_overflow: { reason: "角标突出面板右上角，保持面板布局参照" } } : {}),
    },
  }));
}

/** 沿生产入口完成拆解到最终布局事实推导，验证两阶段使用同一合同。 */
function factsOf(source = elements()) {
  const decisions = new Map(source.map((element) => [element.element_id, { horizontal: "left", vertical: "top" }]));
  const nodes = deriveLayoutNodesFromDecompositionElements(source, CANVAS, { alignmentDecisions: decisions });
  return deriveAutomaticLayoutFacts(nodes, CANVAS, { sceneId: "main", stateId: "default" });
}

/** 为共享场景几何门提取真实非根节点，不改变确认顺序。 */
function nonRoots(facts) { return facts.filter((node) => !node.is_root_container); }

test("兄弟定位、显式角标溢出贯穿拆解与几何门，不新增容器或扩大面板", () => {
  const facts = factsOf();
  const nodes = nonRoots(facts);
  assert.equal(nodes.length, 4);
  assert.deepEqual(nodes.map((node) => node.layout_node_id), ["panel", "icon", "label", "badge"]);
  const [panel, icon, label, badge] = nodes;
  assert.deepEqual(panel.bounds, elements()[0].bounds);
  assert.equal(label.parent_layout_node_id, "panel");
  assert.equal(label.reference_id, "icon");
  assert.deepEqual(label.reference_target_bounds, icon.bounds);
  assert.deepEqual(label.offset, { x: 24, y: 0 });
  assert.equal(badge.relative_position.top, -5);
  assert.equal(badge.relative_position.right, -8);
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS), []);
});

test("改变父框不会向普通图片的RAW计划写入宽高", () => {
  const original = factsOf();
  const source = elements(); source[0].bounds.width = 110;
  const resized = factsOf(source);
  for (const id of ["icon", "badge"]) {
    const before = original.find((node) => node.layout_node_id === id);
    const after = resized.find((node) => node.layout_node_id === id);
    assert.deepEqual(before.sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
    assert.deepEqual(after.sprite_geometry, before.sprite_geometry);
    assert.deepEqual(after.bounds, before.bounds);
  }
  assert.equal(original[0].sprite_geometry, undefined);
  assert.equal(original[2].sprite_geometry, undefined);
});

test("参照边界、offset、RAW计划篡改及丢失尺寸计划在机器门被拒绝", () => {
  for (const mutate of [
    (nodes) => { nodes[2].reference_target_bounds.width += 1; },
    (nodes) => { nodes[2].offset.x += 1; },
    (nodes) => { nodes[1].sprite_geometry.content_size = { width: 80, height: 60 }; },
    (nodes) => { delete nodes[1].sprite_geometry; },
    (nodes) => { nodes[1].sprite_geometry.size_mode = "CUSTOM"; },
  ]) {
    const nodes = nonRoots(factsOf()); mutate(nodes);
    assert(validateEffectImageParentChildLayoutNodes(nodes, CANVAS).length > 0);
  }
});

test("缺失参照、参照环及未声明溢出不能通过直接调用生成器绕过", () => {
  const validNodes = nonRoots(factsOf());
  const missing = structuredClone(validNodes); missing[2].ui_layout.position_reference_id = "missing";
  assert.throws(() => deriveAutomaticLayoutFacts(missing, CANVAS), /position_reference_id/);
  const cycle = structuredClone(validNodes); cycle[1].ui_layout.position_reference_id = "label";
  assert.throws(() => deriveAutomaticLayoutFacts(cycle, CANVAS), /循环/);
  const outside = structuredClone(validNodes); delete outside[3].ui_layout.visual_overflow;
  assert.throws(() => deriveAutomaticLayoutFacts(outside, CANVAS), /超出已确认父容器/);
});

test("审阅节点JSON保留定位参照、溢出和RAW事实，并拒绝被替换的参照", () => {
  const document = buildLayoutNodesDocument(factsOf(), {
    viewport: CANVAS, sceneId: "main", stateId: "default",
    decompositionConfirmationId: "decomp-current", layoutDecisionId: "layout-current",
  });
  assert.doesNotThrow(() => validateReviewNodesDocument(document));
  document.layout_nodes[2].reference_id = "panel";
  assert.throws(() => validateReviewNodesDocument(document), /reference_id/);
});

test("新增定位参照改变布局身份，参照的实际几何决定偏移", () => {
  const independent = factsOf();
  const source = elements(); delete source[2].ui_layout.position_reference_id;
  const parentRelative = factsOf(source);
  assert.notEqual(computeLayoutNodeIdentitySha256(independent), computeLayoutNodeIdentitySha256(parentRelative));
  const label = independent.find((node) => node.layout_node_id === "label");
  assert.deepEqual(label.offset, axisAlignmentOffset(label.reference_target_bounds, label.bounds, label.axis_alignment));
});

test("固定视觉区不能删除图片归属绕过RAW尺寸门", () => {
  const icon = elements()[1]; icon.parent_element_id = "viewport";
  const regions = [{ id: "main-ui", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, ...CANVAS }, owner_type: "fixed-production-visual" }];
  const validErrors = [];
  validateDecompositionElements([icon], regions, CANVAS, "elements", validErrors);
  assert.deepEqual(validErrors, []);
  delete icon.owner_type;
  icon.ui_layout.size_policy = "STRETCH";
  const errors = [];
  validateDecompositionElements([icon], regions, CANVAS, "elements", errors);
  assert(errors.some((message) => message.includes("owner_type")));
  assert(errors.some((message) => message.includes("RAW")));
});

test("正式几何门拒绝通过角标溢出越过祖先安全区", () => {
  const nodes = nonRoots(factsOf());
  const safeArea = { x: 20, y: 40, width: 160, height: 100 };
  nodes[0].parent_layout_node_id = "safe-area";
  nodes[0].parent_element_id = "safe-area";
  nodes[0].reference_id = "safe-area";
  nodes[0].parent_target_bounds = safeArea;
  nodes[0].reference_target_bounds = safeArea;
  nodes[0].offset = { x: 20, y: 0 };
  nodes[0].relative_position = { left: 20, right: 60, top: 0, bottom: 40 };
  const errors = validateEffectImageParentChildLayoutNodes(nodes, CANVAS);
  assert(errors.some((issue) => issue.node_id === "badge" && issue.message.includes("safe-area")));
});

test("背景区域的权威层身份不能省略以绕过独立定位参照限制", () => {
  const background = elements()[1]; background.element_id = "background-image";
  background.parent_element_id = "viewport"; background.region_id = "background-region";
  background.role = "illustration"; delete background.region_layer;
  const label = elements()[2]; label.parent_element_id = "viewport";
  label.ui_layout.position_reference_id = "background-image";
  const regions = [
    { id: "background-region", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, ...CANVAS }, layer: "background" },
    { id: "main-ui", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, ...CANVAS } },
  ];
  const errors = [];
  validateDecompositionElements([background, label], regions, CANVAS, "elements", errors);
  assert(errors.some((message) => message.includes("region_layer")));
  assert(errors.some((message) => message.includes("position_reference_id") && message.includes("不得引用背景")));
});
