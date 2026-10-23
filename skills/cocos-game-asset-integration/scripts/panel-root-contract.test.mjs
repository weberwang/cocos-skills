import assert from "node:assert/strict";
import test from "node:test";
import { buildDecompositionElements, validateDecompositionElements } from "./decomposition-elements.mjs";
import { computeRegionDefinitionSha256 } from "./effect_image_annotation_core.mjs";
import { deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements } from "./layout_annotation_contract.mjs";
import { buildLayoutNodesDocument } from "./layout_review_bundle.mjs";
import { validateReviewNodesDocument } from "./layout_review_page.mjs";
import { validateEffectImageParentChildLayoutNodes } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";
import { normalizeAtomicComponents, normalizeComponentInventory } from "../../cocos-game-workflow-control/scripts/visual-component-contract.mjs";

const CANVAS = { width: 240, height: 160 };
const SLICED = { mode: "stretch", reason: "底板四角固定，中区可伸展", source_size: { width: 48, height: 32 }, borders: { left: 6, right: 6, top: 6, bottom: 6 } };

/** 生成底板、图标、文字各自的原子区域，底板实例自身就是父容器。 */
function regions(nineSlice = { mode: "not-applicable", reason: "固定尺寸底板保持完整原图" }) {
  const items = [
    { id: "panel", type: "container", role: "panel", kind: "component", owner: "fixed-production-visual", parent: "viewport", bounds: { x: 20, y: 20, width: 160, height: 80 } },
    { id: "icon", type: "component", role: "icon", kind: "part", owner: "fixed-production-visual", parent: "panel", bounds: { x: 32, y: 44, width: 24, height: 24 } },
    { id: "text", type: "component", role: "text", kind: "part", owner: "runtime-data", parent: "panel", bounds: { x: 64, y: 44, width: 88, height: 24 } },
  ];
  return items.map((item) => ({
    id: `${item.id}-region`, scene_id: "main", state_id: "default", layer: "hud", owner_type: item.owner, bounds: item.bounds,
    decomposition_elements: [{
      element_id: item.id, element_type: item.type, role: item.role, component_id: `${item.id}-asset`, placement_id: `${item.id}-placement`,
      parent_element_id: item.parent, bounds: item.bounds, empty_container: false,
      semantic_grouping: { kind: item.kind, rationale: "底板与内容共同表达资源数值" },
      ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE", ...(item.id === "text" ? { position_reference_id: "icon" } : {}) },
      ...(item.id === "panel" ? { render_kind: "sprite", nine_slice: nineSlice } : {}),
    }],
  }));
}

/** 从原始区域经过规范化、拆解验证与布局生成，覆盖字段白名单和身份传递。 */
function generate(source = regions(), alignment = { horizontal: "left", vertical: "top" }) {
  const elements = buildDecompositionElements(source);
  const errors = [];
  validateDecompositionElements(elements, source, CANVAS, "elements", errors);
  assert.deepEqual(errors, []);
  const alignmentDecisions = new Map(elements.map((element) => [element.element_id, alignment]));
  const nodes = deriveLayoutNodesFromDecompositionElements(elements, CANVAS, { alignmentDecisions });
  const facts = deriveAutomaticLayoutFacts(nodes, CANVAS, { sceneId: "main", stateId: "default" });
  return { elements, facts, nodes: facts.filter((node) => !node.is_root_container) };
}

test("简单组件直接复用RAW底板为根，三个节点保持各自资产与兄弟定位身份", () => {
  const { elements, nodes } = generate();
  assert.equal(elements.length, 3);
  assert.deepEqual(nodes.map((node) => node.layout_node_id), ["panel", "icon", "text"]);
  const [panel, icon, text] = nodes;
  assert.equal(panel.render_kind, "sprite");
  assert.equal(panel.is_container, true);
  assert.deepEqual(panel.child_layout_node_ids, ["icon", "text"]);
  assert.equal(panel.component_id, "panel-asset");
  assert.equal(panel.placement_id, "panel-placement");
  assert.deepEqual(panel.sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  assert.deepEqual(icon.sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  assert.equal(text.sprite_geometry, undefined);
  assert.equal(text.parent_layout_node_id, "panel");
  assert.equal(text.reference_id, "icon");
  assert.deepEqual(text.offset, { x: 32, y: 0 });
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS), []);
});

test("九点停靠的九种组合不触发九宫格拉伸或改变RAW底板尺寸计划", () => {
  for (const horizontal of ["left", "center", "right"]) {
    for (const vertical of ["top", "center", "bottom"]) {
      const { nodes } = generate(regions(), { horizontal, vertical });
      assert.deepEqual(nodes[0].axis_alignment, { horizontal, vertical });
      assert.equal(nodes[0].nine_slice.mode, "not-applicable");
      assert.deepEqual(nodes[0].sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
      assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS), []);
    }
  }
});

test("九宫格底板可承载内容，只有底板自身使用CUSTOM宽高", () => {
  const source = regions(SLICED);
  source[0].decomposition_elements[0].ui_layout.size_policy = "STRETCH";
  const { nodes } = generate(source);
  assert.deepEqual(nodes[0].sprite_geometry, { type: "SLICED", size_mode: "CUSTOM", content_size: { width: 160, height: 80 } });
  assert.deepEqual(nodes[1].sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS), []);
});

test("通用容器角色的底板贯穿拆解与布局，普通图保持RAW且切片图可承子", () => {
  // 通用结构标签只表达父级职责，不能强迫已声明 Sprite 的底板再拆出图片叶子。
  for (const role of ["container", "parent", "group", "layout-container", "empty-container"]) {
    for (const sliced of [false, true]) {
      const source = sliced ? regions(SLICED) : regions();
      source[0].decomposition_elements[0].role = role;
      const { nodes } = generate(source);
      assert.equal(nodes.length, 3);
      assert.deepEqual(nodes[0].child_layout_node_ids, ["icon", "text"]);
      assert.deepEqual(nodes[0].sprite_geometry, sliced
        ? { type: "SLICED", size_mode: "CUSTOM", content_size: { width: 160, height: 80 } }
        : { type: "SIMPLE", size_mode: "RAW", content_size: null });
      assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS), []);
    }
  }
});

test("资产清单中的Sprite底板容器不合成重复外壳，也不丢失原子资源", () => {
  const source = regions();
  const original = source[0].decomposition_elements[0];
  delete source[0].decomposition_elements;
  source[0].component_inventory = { components: [{
    component_id: original.component_id, element_type: "container", render_kind: "sprite", role: "panel", nine_slice: original.nine_slice,
    placements: [{ element_id: "panel", placement_id: original.placement_id, parent_element_id: "viewport", bounds: original.bounds, semantic_grouping: original.semantic_grouping, ui_layout: original.ui_layout }],
  }] };
  const { nodes } = generate(source);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].layout_node_id, "panel");
  assert(!nodes.some((node) => node.layout_node_id.startsWith("container:")));
  const atomic = normalizeAtomicComponents(source[0]);
  assert.equal(atomic.length, 1);
  assert.equal(atomic[0].placements.length, 1);
  const normalized = normalizeComponentInventory(source[0].component_inventory);
  assert.equal(normalized.components[0].render_kind, "sprite");
  assert.equal(normalized.components[0].element_type, "container");
  const changed = structuredClone(source[0]); delete changed.component_inventory.components[0].render_kind;
  assert.notEqual(computeRegionDefinitionSha256(source[0]), computeRegionDefinitionSha256(changed));
});

test("额外空根包裹可用底板时须说明独立职责，不能只为分组加层", () => {
  const source = regions();
  source[0].decomposition_elements[0].parent_element_id = "outer";
  const wrapper = { ...structuredClone(source[0].decomposition_elements[0]), element_id: "outer", role: "container", parent_element_id: "viewport", component_id: "outer-structure", placement_id: "outer-structure", bounds: { x: 10, y: 10, width: 190, height: 110 } };
  delete wrapper.render_kind; delete wrapper.nine_slice;
  const wrapperRegion = { id: "outer-region", scene_id: "main", state_id: "default", layer: "hud", owner_type: "runtime-rendered", bounds: wrapper.bounds, decomposition_elements: [wrapper] };
  source.unshift(wrapperRegion);
  const elements = buildDecompositionElements(source);
  const errors = []; validateDecompositionElements(elements, source, CANVAS, "elements", errors);
  assert(errors.some((message) => message.includes("independent_container_reason")));
  wrapper.ui_layout.independent_container_reason = "底板独立播放缩放反馈，外层维持稳定的内容与命中范围";
  const { nodes } = generate(source);
  assert.equal(nodes[0].sprite_geometry, undefined);
  assert.equal(nodes[1].sprite_geometry.size_mode, "RAW");
});

test("审阅JSON保留底板兼任身份，删除render_kind不能继续作为RAW容器通过", () => {
  const { facts } = generate();
  const document = buildLayoutNodesDocument(facts, { viewport: CANVAS, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-panel", layoutDecisionId: "layout-panel" });
  assert.doesNotThrow(() => validateReviewNodesDocument(document));
  delete document.layout_nodes[0].render_kind;
  assert.throws(() => validateReviewNodesDocument(document), /sprite_geometry|Sprite|render_kind/);
});

test("背景图片、缺九宫格决策或普通底板拉伸都不能借容器身份放行", () => {
  for (const mutate of [
    (source) => { source[0].layer = "background"; },
    (source) => { delete source[0].decomposition_elements[0].nine_slice; },
    (source) => { source[0].decomposition_elements[0].ui_layout.size_policy = "STRETCH"; },
  ]) {
    const source = regions(); mutate(source);
    assert.throws(() => generate(source));
  }
});

test("HUD底板的权威皮肤路线优先于普通background角色，各阶段一致接受", () => {
  const source = regions(SLICED);
  source[0].visual_route_analysis = { element_type: "panel-frame" };
  source[0].decomposition_elements[0].role = "background";
  const { nodes } = generate(source);
  assert.equal(nodes[0].render_kind, "sprite");
  assert.equal(nodes[0].sprite_geometry.size_mode, "CUSTOM");
  assert.deepEqual(validateEffectImageParentChildLayoutNodes(nodes, CANVAS), []);
  source[0].layer = "background";
  assert.throws(() => generate(source));
});

test("删除底板渲染身份或仅凭子项推断容器身份均不能吞掉RAW计划", () => {
  const { nodes } = generate();
  const noSprite = structuredClone(nodes);
  delete noSprite[0].render_kind; delete noSprite[0].sprite_geometry;
  assert.throws(() => deriveAutomaticLayoutFacts(noSprite, CANVAS), /render_kind/);
  const inferred = structuredClone(nodes);
  inferred[0].element_type = "component"; inferred[0].is_container = false;
  delete inferred[0].render_kind; delete inferred[0].sprite_geometry;
  assert.throws(() => deriveAutomaticLayoutFacts(inferred, CANVAS), /显式声明容器/);
  assert(validateEffectImageParentChildLayoutNodes(inferred, CANVAS).some((issue) => issue.message.includes("显式容器")));
});
