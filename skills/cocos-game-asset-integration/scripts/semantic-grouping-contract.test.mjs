import assert from "node:assert/strict";
import test from "node:test";
import { buildDecompositionElements, validateDecompositionElements } from "./decomposition-elements.mjs";
import { computeRegionDefinitionSha256 } from "./effect_image_annotation_core.mjs";
import { deriveAutomaticLayoutFacts, deriveLayoutAnnotationRows, deriveLayoutNodesFromDecompositionElements } from "./layout_annotation_contract.mjs";
import { validateSemanticGrouping } from "./semantic-grouping-contract.mjs";

const CANVAS = { width: 120, height: 80 };

test("多行分组理由仅在右栏折叠空白，节点保留确认原文", () => {
  const elements = validElements();
  elements[3].semantic_grouping.rationale = "属于同一入口\n共同移动";
  const decisions = new Map(elements.map((element) => [element.element_id, { horizontal: "left", vertical: "top" }]));
  const facts = deriveAutomaticLayoutFacts(deriveLayoutNodesFromDecompositionElements(elements, CANVAS, { alignmentDecisions: decisions }), CANVAS);
  const fact = facts.find((item) => item.element_id === "entry-title");
  const row = deriveLayoutAnnotationRows(facts).find((item) => item.layout_node_id === "entry-title");
  assert.equal(fact.semantic_grouping.rationale, "属于同一入口\n共同移动");
  assert(row.text.includes("分组理由=属于同一入口 共同移动"));
});

/** 构造一份包含区域、功能组件、部件和独立标题的完整显式分组。 */
function validElements() {
  return [
    { element_id: "hud", element_type: "container", role: "region", bounds: { x: 0, y: 0, width: 120, height: 40 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "hud", placement_id: "hud-container", parent_element_id: "viewport", semantic_grouping: { kind: "region", rationale: "组织顶部界面的多个功能入口" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FLEX", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: false },
    { element_id: "entry", element_type: "container", role: "component", bounds: { x: 8, y: 8, width: 80, height: 24 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "entry", placement_id: "entry-container", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "图标与标题共同表达同一个入口功能" }, ui_layout: { grouping_basis: ["LAYOUT", "INTERACTION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "HIT_TARGET" }, empty_container: false },
    { element_id: "entry-icon", element_type: "component", role: "icon", bounds: { x: 12, y: 12, width: 12, height: 12 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "shared-icon", placement_id: "entry-icon", parent_element_id: "entry", semantic_grouping: { kind: "part", rationale: "图标属于该入口并与标题保持相对位置" }, ui_layout: { grouping_basis: ["LAYOUT", "INTERACTION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "DELEGATE_TO_PARENT" }, empty_container: false },
    { element_id: "entry-title", element_type: "component", role: "title", bounds: { x: 30, y: 12, width: 40, height: 12 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "title", placement_id: "entry-title", parent_element_id: "entry", semantic_grouping: { kind: "part", rationale: "标题文字属于该入口的功能组件" }, ui_layout: { grouping_basis: ["LAYOUT", "INTERACTION"], layout_owner: "PARENT", size_policy: "CONTENT", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "DELEGATE_TO_PARENT" }, empty_container: false },
    { element_id: "title", element_type: "component", role: "title", bounds: { x: 92, y: 2, width: 20, height: 8 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "title", placement_id: "title", parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "这是无需包装的独立界面标题" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "CONTENT", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: false },
  ];
}

/** 创建区域索引，复用拆解校验器的真实区域 bounds 检查。 */
function regions() { return [{ id: "hud", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 120, height: 40 } }]; }

test("显式语义分组允许功能组件、独立元素与空组件容器", () => {
  const elements = validElements();
  elements.push({ element_id: "empty", element_type: "container", role: "slot", bounds: { x: 100, y: 12, width: 12, height: 20 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "empty", placement_id: "empty", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "预留一个有明确用途的功能组件插槽" }, ui_layout: { grouping_basis: ["REUSE"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: true });
  const errors = [];
  validateDecompositionElements(elements, regions(), CANVAS, "elements", errors);
  assert.deepEqual(errors, []);
});

test("拆解元素要求 ui_layout，非根父子和空容器必须说明实际职责", () => {
  const cases = [
    [(elements) => { delete elements[1].ui_layout; }, "必须显式声明节点布局职责"],
    [(elements) => { elements[1].ui_layout.grouping_basis = []; }, "必须说明与实际父节点的依赖"],
    [(elements) => { elements[1].ui_layout.layout_owner = "CHILD"; }, "layout_owner 不属于允许的策略"],
    [(elements) => { elements[1].ui_layout.minimum_size = { width: 0, height: 24 }; }, "minimum_size 必须包含正数"],
    [(elements) => { elements.push({ element_id: "empty", element_type: "container", role: "slot", bounds: { x: 100, y: 12, width: 12, height: 20 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "empty", placement_id: "empty", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "测试无职责空容器" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: true }); }, "空容器必须有可解释的布局、状态或复用职责"],
  ];
  for (const [mutate, expected] of cases) {
    const elements = validElements(); mutate(elements);
    const errors = []; validateDecompositionElements(elements, regions(), CANVAS, "elements", errors);
    assert(errors.some((message) => message.includes(expected)), `${expected}: ${errors.join("；")}`);
  }
});

test("缺 parent、part 挂 region、容器环和越界父级均被拒绝", () => {
  const missing = validElements(); delete missing[3].parent_element_id;
  const missingErrors = []; validateSemanticGrouping(missing, { canvas: CANVAS }, missingErrors, "missing"); assert(missingErrors.some((message) => message.includes("parent_element_id")));

  const wrongParent = validElements(); wrongParent[2].parent_element_id = "hud";
  const wrongErrors = []; validateSemanticGrouping(wrongParent, { canvas: CANVAS }, wrongErrors, "part-parent"); assert(wrongErrors.some((message) => message.includes("层级不匹配")));

  const cycle = validElements(); cycle[0].parent_element_id = "entry";
  const cycleErrors = []; validateSemanticGrouping(cycle, { canvas: CANVAS }, cycleErrors, "cycle"); assert(cycleErrors.some((message) => message.includes("循环")));

  const outside = validElements(); outside[2].bounds.x = 80;
  const outsideErrors = []; validateSemanticGrouping(outside, { canvas: CANVAS }, outsideErrors, "outside"); assert(outsideErrors.some((message) => message.includes("超出显式父级")));
});

test("缺语义、空理由、非法 kind、保留根 ID 和跨 scene/state 父级均停留待补充", () => {
  const cases = [
    ["missing-semantic", (elements) => { delete elements[1].semantic_grouping; }, "semantic_grouping"],
    ["empty-rationale", (elements) => { elements[1].semantic_grouping.rationale = "  "; }, "rationale"],
    ["invalid-kind", (elements) => { elements[1].semantic_grouping.kind = "unknown"; }, "kind"],
    ["reserved-root", (elements) => { elements[1].element_id = "viewport"; }, "根 ID"],
    ["cross-state", (elements) => { elements[1].state_id = "selected"; }, "scene/state"],
  ];
  for (const [label, mutate, expected] of cases) {
    const elements = validElements(); mutate(elements);
    const errors = []; validateSemanticGrouping(elements, { canvas: CANVAS }, errors, label);
    assert(errors.some((message) => message.includes(expected)), `${label}: ${errors.join("；")}`);
  }
});

test("布局推导不从几何包含补 parent，且保留确认后的语义身份", () => {
  const elements = validElements();
  const decisions = new Map(elements.map((element) => [element.element_id, { horizontal: "left", vertical: "top" }]));
  const nodes = deriveLayoutNodesFromDecompositionElements(elements, CANVAS, { alignmentDecisions: decisions });
  assert.deepEqual(nodes.map((node) => node.parent_layout_node_id), elements.map((element) => element.parent_element_id));
  assert.deepEqual(nodes.map((node) => node.semantic_grouping), elements.map((element) => element.semantic_grouping));
  assert.equal(nodes.find((node) => node.element_id === "title").parent_layout_node_id, "viewport");

  const orphan = validElements(); delete orphan[3].parent_element_id;
  assert.throws(() => deriveLayoutNodesFromDecompositionElements(orphan, CANVAS, { alignmentDecisions: decisions }), /parent_element_id/);
});

test("分组 kind、理由、parent 和组件/placement 源声明均参与区域身份", () => {
  const base = { id: "hud", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 120, height: 40 }, decomposition_elements: validElements(), component_inventory: { components: [{ component_id: "entry", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "入口" }, ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "HIT_TARGET" }, placements: [{ placement_id: "entry-icon", layout_node_id: "entry-icon", parent_element_id: "entry", semantic_grouping: { kind: "part", rationale: "图标" }, ui_layout: { grouping_basis: ["LAYOUT", "INTERACTION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "DELEGATE_TO_PARENT" }, bounds: { x: 12, y: 12, width: 12, height: 12 } }] }] } };
  const changedKind = structuredClone(base); changedKind.decomposition_elements[1].semantic_grouping.kind = "region";
  const changedReason = structuredClone(base); changedReason.decomposition_elements[1].semantic_grouping.rationale = "另一个功能说明";
  const changedParent = structuredClone(base); changedParent.decomposition_elements[2].parent_element_id = "hud";
  const changedSource = structuredClone(base); changedSource.component_inventory.components[0].placements[0].semantic_grouping.rationale = "源 placement 归属说明改变";
  const changedUiLayout = structuredClone(base); changedUiLayout.decomposition_elements[2].ui_layout.safe_area_policy = "FULL_BLEED";
  const digest = computeRegionDefinitionSha256(base);
  assert.notEqual(computeRegionDefinitionSha256(changedKind), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedReason), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedParent), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedSource), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedUiLayout), digest);
});

test("组件/placement 源显式声明进入 proposal 元素，缺失声明不自动填充", () => {
  const region = { id: "source", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 40, height: 30 }, component_inventory: { components: [{ component_id: "single", role: "icon", parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "完整品牌图形无需功能容器" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "FULL_BLEED", interaction_policy: "NONE" }, placements: [] }, { component_id: "multi", role: "icon", placements: [{ placement_id: "one", bounds: { x: 2, y: 2, width: 4, height: 4 }, parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "第一处独立装饰" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "FULL_BLEED", interaction_policy: "NONE" } }, { placement_id: "two", bounds: { x: 8, y: 2, width: 4, height: 4 } }] }] } };
  const elements = buildDecompositionElements([region]);
  assert.equal(elements[0].semantic_grouping.kind, "standalone");
  assert.equal(elements[0].parent_element_id, "viewport");
  assert.deepEqual(elements[0].ui_layout, region.component_inventory.components[0].ui_layout);
  assert.equal(elements[1].semantic_grouping.kind, "standalone");
  assert.equal(elements[1].parent_element_id, "viewport");
  assert.deepEqual(elements[1].ui_layout, region.component_inventory.components[1].placements[0].ui_layout);
  assert.equal(Object.hasOwn(elements[2], "semantic_grouping"), false);
  assert.equal(Object.hasOwn(elements[2], "parent_element_id"), false);
  assert.equal(Object.hasOwn(elements[2], "ui_layout"), false);
});


/** 在 V2 拆解阶段拒绝视觉背景承担布局职责，避免冻结后才发现错误父级。 */
test("拆解阶段拒绝以背景作父级与将背景放入功能容器", () => {
  const wrongParent = validElements();
  wrongParent[1].role = "background";
  const errors = [];
  validateDecompositionElements(wrongParent, regions(), CANVAS, "elements", errors);
  assert(errors.some((message) => message.includes("不得相对背景")));
  assert(errors.some((message) => message.includes("必须独立归属 viewport")));
  const regionBackground = regions();
  regionBackground[0].layer = "background";
  const layerErrors = [];
  validateDecompositionElements(validElements(), regionBackground, CANVAS, "elements", layerErrors);
  assert(layerErrors.some((message) => message.includes("不得相对背景")));
});

/** 无论背景身份来自元素还是正式区域，V2 都拒绝冻结背景容器和空容器。 */
test("拆解阶段拒绝背景容器及空容器", () => {
  for (const empty of [false, true]) {
    for (const source of ["role", "region"]) {
      const elements = validElements();
      const currentRegions = regions();
      elements[0].element_type = "container";
      elements[0].empty_container = empty;
      elements[0].parent_element_id = "viewport";
      if (source === "role") elements[0].role = "background";
      else currentRegions[0].layer = "background";
      const errors = [];
      validateDecompositionElements(elements, currentRegions, CANVAS, "elements", errors);
      assert(errors.some((message) => message.includes(`背景 ${elements[0].element_id} 不能声明为容器`)));
    }
  }
});
