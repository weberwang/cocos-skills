import assert from "node:assert/strict";
import test from "node:test";
import { buildDecompositionElements } from "./decomposition-elements.mjs";
import { validateUiLayout } from "./ui-layout-organization.mjs";
import { deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements, deriveLayoutAnnotationRows } from "./layout_annotation_contract.mjs";
import { buildLayoutNodesDocument } from "./layout_review_bundle.mjs";
import { validateReviewNodesDocument } from "./layout_review_page.mjs";
import { layoutNodeIdentityProjection, validateEffectImageParentChildLayoutNodes } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";

const VIEWPORT = { width: 240, height: 160 };

/** 使用真实拆解入口构造底板及同级内容，避免测试绕过布局职责和图片身份校验。 */
function fixture({ group = false, sibling = false, driver, owner = "SELF", stretch = false } = {}) {
  const items = [
    ["panel", { x: 20, y: 20, width: 160, height: 80 }],
    ["icon", { x: 70, y: 50, width: 24, height: 24 }],
    ["ad-badge", { x: 164, y: 24, width: 12, height: 12 }],
    ...(group || sibling ? [["text", { x: 102, y: 50, width: 48, height: 24 }]] : []),
  ];
  const elements = buildDecompositionElements(items.map(([id, bounds]) => ({
    id: `${id}-region`, scene_id: "main", state_id: "default", layer: "hud", bounds,
    owner_type: id === "text" ? "runtime-data" : "fixed-production-visual",
    decomposition_elements: [{
      element_id: id, element_type: id === "panel" ? "container" : "component", role: id,
      component_id: `${id}-asset`, placement_id: `${id}-instance`, bounds,
      parent_element_id: id === "panel" ? "viewport" : "panel", empty_container: false,
      semantic_grouping: { kind: id === "panel" ? "component" : "part", rationale: "底板承载按钮内容，广告角标独立停靠" },
      ui_layout: {
        grouping_basis: ["POSITION"], layout_owner: id === "icon" ? owner : "SELF", size_policy: "FIXED",
        overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE",
        ...(id === "icon" && driver ? { position_driver: driver } : {}),
        ...(id === "icon" && stretch ? { widget_stretch_axes: ["horizontal"] } : {}),
        ...(id === "text" ? { position_reference_id: "icon" } : {}),
      },
      ...(id === "panel" ? { render_kind: "sprite", nine_slice: { mode: "not-applicable", reason: "固定底板保持原尺寸" } } : {}),
    }],
  })));
  const alignmentDecisions = new Map(elements.map((element) => [element.element_id, {
    horizontal: element.element_id === "icon" ? "center" : element.element_id === "ad-badge" ? "right" : "left",
    vertical: element.element_id === "icon" ? "center" : "top",
    ...(group && element.element_id === "icon" ? { center_alignment: { member_ids: ["icon", "text"] } } : {}),
  }]));
  const measured = deriveLayoutNodesFromDecompositionElements(elements, VIEWPORT, { alignmentDecisions });
  const facts = deriveAutomaticLayoutFacts(measured, VIEWPORT, { sceneId: "main", stateId: "default" });
  return { facts, nodes: facts.filter((node) => !node.is_root_container), elements };
}

test("真实布局入口派生Widget、严格中心与独立角标，并保持三节点和RAW尺寸", () => {
  const { nodes, facts } = fixture();
  assert.equal(nodes.length, 3);
  const [panel, icon, badge] = nodes;
  for (const node of nodes) {
    assert.equal(node.layout_execution.position_driver, node === panel ? "SHARED" : "WIDGET");
    assert.equal(node.layout_execution.size_driver, "SPRITE_RAW");
    assert.deepEqual(node.sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  }
  assert.equal(icon.layout_execution.widget.target_id, panel.layout_node_id);
  assert.deepEqual(icon.layout_execution.widget.horizontal, { alignment: "center", value: 0 });
  assert.equal(icon.layout_execution.widget.vertical.value, 0);
  assert.deepEqual(icon.target_bounds, { x: 88, y: 48, width: 24, height: 24 });
  assert.deepEqual(badge.layout_execution.widget.horizontal, { alignment: "right", value: 4 });
  assert.deepEqual(badge.layout_execution.widget.vertical, { alignment: "top", value: 4 });
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, VIEWPORT, { requireExecutionPlan: true }), []);
  assert(deriveLayoutAnnotationRows(facts).some((row) => row.text.includes("定位驱动=WIDGET") && row.text.includes("SPRITE_RAW")));
});

test("图文组合和兄弟参照交给共享布局，节点数量与成员间距不变", () => {
  const { nodes } = fixture({ group: true });
  assert.equal(nodes.length, 4);
  for (const id of ["icon", "text"]) {
    const node = nodes.find((item) => item.layout_node_id === id);
    assert.equal(node.layout_execution.position_driver, "SHARED");
    assert.equal(node.layout_execution.widget, null);
  }
  assert.equal(nodes[3].target_bounds.x - nodes[1].target_bounds.x - nodes[1].target_bounds.width, 8);
  assert.equal(nodes[2].layout_execution.position_driver, "WIDGET");
  const standaloneSibling = fixture({ sibling: true }).nodes[3];
  assert.equal(standaloneSibling.reference_id, "icon");
  assert.equal(standaloneSibling.layout_execution.position_driver, "SHARED");
  assert.throws(() => fixture({ group: true, driver: "WIDGET" }), /WIDGET|Widget|共享|SHARED/);
});

test("控制权不匹配和RAW双边尺寸约束在布局工作流中关闭生成", () => {
  const errors = [];
  validateUiLayout({ ...fixture().elements[1].ui_layout, layout_owner: "PARENT", position_driver: "WIDGET" }, {}, errors);
  assert(errors.some((message) => /WIDGET|Widget|SELF/.test(message)));
  assert.throws(() => fixture({ stretch: true }), /RAW/);
  assert.equal(fixture({ owner: "EXTERNAL" }).nodes[1].layout_execution.position_driver, "SHARED");
});

test("审阅和共享门拒绝篡改参照、中心参数、尺寸控制和删除执行计划", () => {
  const { nodes, facts } = fixture();
  const originalIdentity = layoutNodeIdentityProjection(nodes[1]);
  for (const mutate of [
    (node) => { node.layout_execution.widget.target_id = "ad-badge"; },
    (node) => { node.layout_execution.widget.horizontal.value = 1; },
    (node) => { node.layout_execution.size_driver = "WIDGET"; },
    (node) => { node.layout_execution.widget.vertical = { alignment: "stretch", start: 0, end: 0 }; },
    (node) => { delete node.layout_execution; },
  ]) {
    const changed = structuredClone(nodes);
    mutate(changed[1]);
    assert.notDeepEqual(layoutNodeIdentityProjection(changed[1]), originalIdentity);
    assert(validateEffectImageParentChildLayoutNodes(changed, VIEWPORT, { requireExecutionPlan: true }).length > 0);
    const document = buildLayoutNodesDocument(facts, { viewport: VIEWPORT, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-widget", layoutDecisionId: "widget-layout" });
    mutate(document.layout_nodes[1]);
    assert.throws(() => validateReviewNodesDocument(document), /执行|layout_execution|Widget|计划/);
  }
});
