import assert from "node:assert/strict";
import test from "node:test";
import { resolveCenteredLayoutNodes } from "../../cocos-game-ui-layout/scripts/center-alignment.mjs";
import { deriveAutomaticLayoutFacts } from "./layout_annotation_contract.mjs";
import { buildLayoutNodesDocument } from "./layout_review_bundle.mjs";
import { validateReviewNodesDocument } from "./layout_review_page.mjs";
import { validateEffectImageParentChildLayoutNodes } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";

const CANVAS = { width: 240, height: 160 };
const SAFE_AREA = { x: 20, y: 10, width: 200, height: 80 };

/** 构造正式 RAW 图标，让测试经过与真实布局相同的尺寸和职责校验。 */
function icon(id, parent = "safe-area", snapshot) {
  return {
    layout_node_id: id, element_id: id, element_type: "component", owner_type: "fixed-production-visual",
    parent_layout_node_id: parent, parent_element_id: parent, region_id: `${id}-region`,
    component_id: `${id}-asset`, placement_id: `${id}-instance`, scene_id: "main", state_id: "default",
    layout_role: "icon", target_bounds: { x: 0, y: 0, width: 20, height: 20 },
    axis_alignment: { horizontal: "center", vertical: "center" },
    ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
    semantic_grouping: { kind: "standalone", rationale: "图标相对已测量安全区居中" },
    ...(snapshot ? { parent_target_bounds: { ...snapshot }, reference_target_bounds: { ...snapshot } } : {}),
  };
}

test("真实安全区贯穿居中、事实生成、审阅与最终几何门，RAW尺寸保持不变", () => {
  const source = [icon("safe-icon", "safe-area", SAFE_AREA), icon("screen-icon", "viewport")];
  const centered = resolveCenteredLayoutNodes(source, CANVAS);
  assert.deepEqual(centered[0].target_bounds, { x: 110, y: 40, width: 20, height: 20 });
  assert.deepEqual(centered[1].target_bounds, { x: 110, y: 70, width: 20, height: 20 });
  const facts = deriveAutomaticLayoutFacts(centered, CANVAS, { sceneId: "main", stateId: "default" });
  assert.deepEqual(facts.find((node) => node.layout_node_id === "safe-area").target_bounds, SAFE_AREA);
  assert.deepEqual(facts.find((node) => node.layout_node_id === "viewport").target_bounds, { x: 0, y: 0, ...CANVAS });
  const nodes = facts.filter((node) => !node.is_root_container);
  assert.deepEqual(nodes[0].parent_target_bounds, SAFE_AREA);
  assert.deepEqual(nodes[0].reference_target_bounds, SAFE_AREA);
  assert.deepEqual(nodes[0].offset, { x: 0, y: 0 });
  assert.deepEqual(nodes[0].sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  assert.equal(nodes[0].layout_execution.position_driver, "SHARED");
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS, { requireExecutionPlan: true }), []);
  const document = buildLayoutNodesDocument(facts, { viewport: CANVAS, sceneId: "main", stateId: "default", decompositionConfirmationId: "safe-confirmed", layoutDecisionId: "safe-layout" });
  assert.doesNotThrow(() => validateReviewNodesDocument(document));
  document.root_nodes.find((node) => node.layout_node_id === "safe-area").target_bounds = { x: 0, y: 0, ...CANVAS };
  assert.throws(() => validateReviewNodesDocument(document), /target_bounds|不一致/);
  assert.deepEqual(source[0].target_bounds, { x: 0, y: 0, width: 20, height: 20 });
});

test("一批节点共享唯一安全区快照，缺少重复快照不能退回整屏中心", () => {
  const centered = resolveCenteredLayoutNodes([icon("first", "safe-area", SAFE_AREA), icon("second")], CANVAS);
  assert.deepEqual(centered[0].target_bounds, centered[1].target_bounds);
  const facts = deriveAutomaticLayoutFacts(centered, CANVAS);
  for (const node of facts.filter((item) => !item.is_root_container)) assert.deepEqual(node.reference_target_bounds, SAFE_AREA);
  const conflicting = [icon("first", "safe-area", SAFE_AREA), icon("second", "safe-area", { ...SAFE_AREA, height: 90 })];
  assert.throws(() => resolveCenteredLayoutNodes(conflicting, CANVAS), /根快照必须逐字段一致/);
  assert.throws(() => deriveAutomaticLayoutFacts(conflicting, CANVAS), /根快照必须逐字段一致/);
  assert.throws(() => resolveCenteredLayoutNodes([icon("outside", "safe-area", { ...SAFE_AREA, width: 300 })], CANVAS), /根边界必须完全位于 viewport 内/);
});

test("业务节点伪造根标记不能删除执行计划或隐藏RAW控制冲突", () => {
  const facts = deriveAutomaticLayoutFacts(resolveCenteredLayoutNodes([icon("icon", "safe-area", SAFE_AREA)], CANVAS), CANVAS);
  const nodes = facts.filter((node) => !node.is_root_container);
  nodes[0].is_root_container = true;
  delete nodes[0].layout_execution;
  assert(validateEffectImageParentChildLayoutNodes(nodes, CANVAS, { requireExecutionPlan: true }).some((item) => /非 root|合成根/.test(item.message)));
});
