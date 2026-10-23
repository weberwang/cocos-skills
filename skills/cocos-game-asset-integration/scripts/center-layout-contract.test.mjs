import assert from "node:assert/strict";
import test from "node:test";
import { buildDecompositionElements } from "./decomposition-elements.mjs";
import { validateAutomaticLayoutDecision } from "./automatic-layout-decision.mjs";
import { deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements, computeLayoutNodeIdentitySha256, deriveLayoutAnnotationRows } from "./layout_annotation_contract.mjs";
import { buildLayoutNodesDocument } from "./layout_review_bundle.mjs";
import { validateReviewNodesDocument } from "./layout_review_page.mjs";
import { validateEffectImageParentChildLayoutNodes } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";

const VIEWPORT = { width: 240, height: 160 };

/** 构造同一底板中的主图标、广告角标和可选文本；角标始终独立定位。 */
function sourceElements(withText = false) {
  const items = [
    ["panel", "container", "component", "viewport", { x: 20, y: 20, width: 160, height: 80 }],
    ["icon", "component", "part", "panel", { x: 70, y: 50, width: 24, height: 24 }],
    ["ad-badge", "component", "part", "panel", { x: 164, y: 24, width: 12, height: 12 }],
    ...(withText ? [["text", "component", "part", "panel", { x: 102, y: 50, width: 48, height: 24 }]] : []),
  ];
  return buildDecompositionElements(items.map(([id, type, kind, parent, bounds]) => ({
    id: `${id}-region`, scene_id: "main", state_id: "default", layer: "hud", bounds,
    owner_type: id === "text" ? "runtime-data" : "fixed-production-visual",
    decomposition_elements: [{
      element_id: id, element_type: type, role: id, component_id: `${id}-asset`, placement_id: `${id}-instance`,
      bounds, parent_element_id: parent, empty_container: false,
      semantic_grouping: { kind, rationale: "按钮底板负责功能归属，主体与广告角标独立布局" },
      ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE", ...(id === "text" ? { position_reference_id: "icon" } : {}) },
      ...(id === "panel" ? { render_kind: "sprite", nine_slice: { mode: "not-applicable", reason: "固定底板完整原尺寸显示" } } : {}),
    }],
  })));
}

/** 经由真实自动决策入口生成布局，不跳过决策字段或源拆解身份。 */
function layout({ withText = false, centerAlignment } = {}) {
  const elements = sourceElements(withText);
  const document = {
    decision_schema: "automatic-layout-decision/1.0", decision_id: "center-layout", decision_method: "visual-judgement",
    scene_id: "main", state_id: "default", decomposition_confirmation_id: "decomp-center",
    elements: elements.map((element) => ({
      element_id: element.element_id,
      horizontal_alignment: element.element_id === "icon" ? "center" : element.element_id === "ad-badge" ? "right" : "left",
      vertical_alignment: element.element_id === "icon" ? "center" : "top",
      ...(element.element_id === "icon" && centerAlignment !== undefined ? { center_alignment: centerAlignment } : {}),
    })),
  };
  const errors = [];
  const alignmentDecisions = validateAutomaticLayoutDecision(document, { elements }, errors);
  assert.deepEqual(errors, []);
  const generated = deriveLayoutNodesFromDecompositionElements(elements, VIEWPORT, { alignmentDecisions });
  const facts = deriveAutomaticLayoutFacts(generated, VIEWPORT, { sceneId: "main", stateId: "default" });
  return { elements, facts, nodes: facts.filter((node) => !node.is_root_container), document };
}

test("严格居中重算主图标位置与偏移，广告角标不参与且RAW尺寸不变", () => {
  const { elements, nodes } = layout();
  const [panel, icon, badge] = nodes;
  assert.equal(nodes.length, 3);
  assert.deepEqual(icon.target_bounds, { x: 88, y: 48, width: 24, height: 24 });
  assert.deepEqual(icon.bounds, icon.target_bounds);
  assert.deepEqual(icon.offset, { x: 0, y: 0 });
  assert.deepEqual(icon.center_alignment, { horizontal: { mode: "strict" }, vertical: { mode: "strict" } });
  assert.deepEqual(badge.target_bounds, elements[2].bounds);
  assert.deepEqual(panel.target_bounds, elements[0].bounds);
  assert.deepEqual(icon.sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, VIEWPORT), []);
  assert.deepEqual(elements[1].bounds, { x: 70, y: 50, width: 24, height: 24 });
});

test("图文按指定成员联合框整体居中，保留间距且不增加空容器或包含角标", () => {
  const { nodes } = layout({ withText: true, centerAlignment: { member_ids: ["icon", "text"] } });
  const [panel, icon, badge, text] = nodes;
  assert.equal(nodes.length, 4);
  assert.deepEqual(icon.target_bounds, { x: 60, y: 48, width: 24, height: 24 });
  assert.deepEqual(text.target_bounds, { x: 92, y: 48, width: 48, height: 24 });
  assert.equal((icon.bounds.x + text.bounds.x + text.bounds.width) / 2, panel.bounds.x + panel.bounds.width / 2);
  assert.equal(text.bounds.x - icon.bounds.x - icon.bounds.width, 8);
  assert.equal(icon.offset.x, -28);
  assert.deepEqual(badge.target_bounds, { x: 164, y: 24, width: 12, height: 12 });
  assert.deepEqual(panel.child_layout_node_ids, ["icon", "ad-badge", "text"]);
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, VIEWPORT), []);
});

test("有理由的中心参照偏移进入身份和审阅说明，无理由补偿在决策门拒绝", () => {
  const policy = { horizontal: { mode: "reference", offset: 2, reason: "图案右侧较重，按已确认设计向右补偿" }, vertical: { mode: "strict" } };
  const { elements, nodes, facts, document } = layout({ centerAlignment: policy });
  assert.deepEqual(nodes[1].target_bounds, { x: 90, y: 48, width: 24, height: 24 });
  assert.deepEqual(nodes[1].offset, { x: 2, y: 0 });
  assert.notEqual(computeLayoutNodeIdentitySha256(nodes), computeLayoutNodeIdentitySha256(layout().nodes));
  assert(deriveLayoutAnnotationRows(facts).some((row) => row.text.includes(policy.horizontal.reason)));
  delete document.elements[1].center_alignment.horizontal.reason;
  const errors = [];
  assert.equal(validateAutomaticLayoutDecision(document, { elements }, errors), null);
  assert(errors.some((message) => message.includes("reason")));
});

test("仅篡改偏移或仅移动目标框无法通过共享门及审阅JSON校验", () => {
  const { nodes, facts } = layout();
  for (const mutate of [
    (items) => { items[1].target_bounds.x += 1; items[1].bounds.x += 1; },
    (items) => { items[1].offset.x = 1; },
    (items) => { items[1].center_alignment.horizontal = { mode: "reference", offset: 1, reason: "明确设计偏移" }; },
  ]) {
    const changed = structuredClone(nodes); mutate(changed);
    assert(validateEffectImageParentChildLayoutNodes(changed, VIEWPORT).length > 0);
  }
  const document = buildLayoutNodesDocument(facts, { viewport: VIEWPORT, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-center", layoutDecisionId: "center-layout" });
  assert.doesNotThrow(() => validateReviewNodesDocument(document));
  document.layout_nodes[1].target_bounds.x += 1;
  assert.throws(() => validateReviewNodesDocument(document));
});
