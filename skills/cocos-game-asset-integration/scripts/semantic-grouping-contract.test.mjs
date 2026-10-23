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

test("功能类别不限制容器父级，但缺 parent、容器环和越界父级仍被拒绝", () => {
  const missing = validElements(); delete missing[3].parent_element_id;
  const missingErrors = []; validateSemanticGrouping(missing, { canvas: CANVAS }, missingErrors, "missing"); assert(missingErrors.some((message) => message.includes("parent_element_id")));

  const partInRegion = validElements(); partInRegion[2].parent_element_id = "hud";
  const partErrors = []; validateSemanticGrouping(partInRegion, { canvas: CANVAS }, partErrors, "part-parent"); assert.deepEqual(partErrors, []);

  const cycle = validElements(); cycle[0].parent_element_id = "entry";
  const cycleErrors = []; validateSemanticGrouping(cycle, { canvas: CANVAS }, cycleErrors, "cycle"); assert(cycleErrors.some((message) => message.includes("循环")));

  const outside = validElements(); outside[2].bounds.x = 80;
  const outsideErrors = []; validateSemanticGrouping(outside, { canvas: CANVAS }, outsideErrors, "outside"); assert(outsideErrors.some((message) => message.includes("超出显式父级")));
});

test("容器可在组件内部表达 region，部件可直接归属 region", () => {
  const elements = validElements();
  elements.push({ element_id: "inner-region", element_type: "container", role: "region", bounds: { x: 10, y: 10, width: 50, height: 20 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "entry-content", placement_id: "entry-content", parent_element_id: "entry", semantic_grouping: { kind: "region", rationale: "入口内需要独立管理的内容区域" }, ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, empty_container: false });
  elements[2].parent_element_id = "inner-region";
  const errors = []; validateSemanticGrouping(elements, { canvas: CANVAS }, errors, "nested-region");
  assert.deepEqual(errors, []);
});

test("仅有理由的普通视觉溢出允许子项超出功能父级，根边界仍不可越过", () => {
  const decorated = validElements();
  decorated[2].bounds.x = 82;
  decorated[2].ui_layout.visual_overflow = { reason: "右上角徽标叠加在图标边缘" };
  const decoratedErrors = []; validateSemanticGrouping(decorated, { canvas: CANVAS }, decoratedErrors, "decorated");
  assert.deepEqual(decoratedErrors, []);

  const noReason = validElements();
  noReason[2].bounds.x = 82;
  noReason[2].ui_layout.visual_overflow = { reason: " " };
  const noReasonErrors = []; validateSemanticGrouping(noReason, { canvas: CANVAS }, noReasonErrors, "no-reason");
  assert(noReasonErrors.some((message) => message.includes("超出显式父级")));

  const rootOverflow = validElements();
  rootOverflow[4].bounds.x = 115;
  rootOverflow[4].bounds.width = 10;
  rootOverflow[4].ui_layout.visual_overflow = { reason: "根节点不接受溢出" };
  const rootErrors = []; validateSemanticGrouping(rootOverflow, { canvas: CANVAS }, rootErrors, "root-overflow");
  assert(rootErrors.some((message) => message.includes("超出显式父级")));
});

test("沿实际父链复核稳定根边界，角标溢出不能穿过 safe-area", () => {
  const parentAndChildOutside = validElements();
  parentAndChildOutside[0].parent_element_id = "safe-area";
  parentAndChildOutside[1].bounds = { x: 70, y: 8, width: 30, height: 24 };
  parentAndChildOutside[2].bounds = { x: 90, y: 12, width: 10, height: 12 };
  parentAndChildOutside[3].bounds = { x: 75, y: 12, width: 12, height: 12 };
  const ancestorErrors = [];
  validateSemanticGrouping(parentAndChildOutside, { canvas: CANVAS, rootBounds: { "safe-area": { x: 0, y: 0, width: 90, height: 40 } } }, ancestorErrors, "ancestor-boundary");
  assert(!ancestorErrors.some((message) => message.includes("entry-icon.bounds 超出显式父级 bounds")));
  assert(ancestorErrors.some((message) => message.includes("entry-icon.bounds 超出所属稳定根 safe-area")));

  const cornerCrossesSafeArea = validElements();
  cornerCrossesSafeArea[0].parent_element_id = "safe-area";
  cornerCrossesSafeArea[0].bounds = { x: 8, y: 8, width: 80, height: 32 };
  cornerCrossesSafeArea[2].bounds = { x: 80, y: 12, width: 12, height: 12 };
  cornerCrossesSafeArea[2].ui_layout.visual_overflow = { reason: "角标在入口右上角突出" };
  const safeAreaErrors = [];
  validateSemanticGrouping(cornerCrossesSafeArea, { canvas: CANVAS, rootBounds: { "safe-area": { x: 8, y: 8, width: 80, height: 32 } } }, safeAreaErrors, "safe-area-overflow");
  assert(!safeAreaErrors.some((message) => message.includes("entry.bounds 超出所属稳定根 safe-area")));
  assert(!safeAreaErrors.some((message) => message.includes("entry-icon.bounds 超出显式父级 bounds")));
  assert(safeAreaErrors.some((message) => message.includes("entry-icon.bounds 超出所属稳定根 safe-area")));
  assert(!safeAreaErrors.some((message) => message.includes("entry-icon.bounds 超出所属稳定根 viewport")));

  const brokenRoot = validElements();
  brokenRoot[1].parent_element_id = "missing-parent";
  const brokenRootErrors = [];
  validateSemanticGrouping(brokenRoot, { canvas: CANVAS }, brokenRootErrors, "broken-root");
  assert(brokenRootErrors.some((message) => message.includes("parent_element_id 必须引用已声明容器或稳定根")));
});

test("定位参照支持同级和稳定根，并拒绝缺失、自指、背景及上下文不一致", () => {
  const stableRoot = validElements();
  stableRoot[4].ui_layout.position_reference_id = "safe-area";
  stableRoot[4].ui_layout.grouping_basis = ["POSITION"];
  const stableRootErrors = []; validateSemanticGrouping(stableRoot, { canvas: CANVAS }, stableRootErrors, "stable-root");
  assert.deepEqual(stableRootErrors, []);

  const missing = validElements();
  missing[2].ui_layout.position_reference_id = "absent";
  missing[2].ui_layout.grouping_basis = ["POSITION"];
  const missingErrors = []; validateSemanticGrouping(missing, { canvas: CANVAS }, missingErrors, "missing-reference");
  assert(missingErrors.some((message) => message.includes("position_reference_id") && message.includes("未引用")));

  const self = validElements();
  self[2].ui_layout.position_reference_id = "entry-icon";
  self[2].ui_layout.grouping_basis = ["POSITION"];
  const selfErrors = []; validateSemanticGrouping(self, { canvas: CANVAS }, selfErrors, "self-reference");
  assert(selfErrors.some((message) => message.includes("position_reference_id") && message.includes("自指")));

  const background = validElements();
  background.push({ ...structuredClone(background[4]), element_id: "bg", role: "background", region_layer: "background", component_id: "bg", placement_id: "bg", semantic_grouping: { kind: "standalone", rationale: "全屏背景图片" } });
  background[4].ui_layout.position_reference_id = "bg";
  background[4].ui_layout.grouping_basis = ["POSITION"];
  const backgroundErrors = []; validateSemanticGrouping(background, { canvas: CANVAS }, backgroundErrors, "background-reference");
  assert(backgroundErrors.some((message) => message.includes("position_reference_id") && message.includes("背景")));

  const crossScene = validElements();
  crossScene[2].ui_layout.position_reference_id = "entry-title";
  crossScene[2].ui_layout.grouping_basis = ["POSITION"];
  crossScene[3].scene_id = "other-scene";
  const sceneErrors = []; validateSemanticGrouping(crossScene, { canvas: CANVAS }, sceneErrors, "cross-scene");
  assert(sceneErrors.some((message) => message.includes("position_reference_id") && message.includes("scene_id")));

  const crossState = validElements();
  crossState[2].ui_layout.position_reference_id = "entry-title";
  crossState[2].ui_layout.grouping_basis = ["POSITION"];
  crossState[3].state_id = "selected";
  const stateErrors = []; validateSemanticGrouping(crossState, { canvas: CANVAS }, stateErrors, "cross-state-reference");
  assert(stateErrors.some((message) => message.includes("position_reference_id") && message.includes("state_id")));

  const crossSpace = validElements();
  crossSpace[2].coordinate_space = "viewport";
  crossSpace[3].coordinate_space = "safe-area";
  crossSpace[2].ui_layout.position_reference_id = "entry-title";
  crossSpace[2].ui_layout.grouping_basis = ["POSITION"];
  const spaceErrors = []; validateSemanticGrouping(crossSpace, { canvas: CANVAS }, spaceErrors, "cross-space-reference");
  assert(spaceErrors.some((message) => message.includes("position_reference_id") && message.includes("coordinate_space")));
});

test("定位边与父子边合并后拒绝兄弟互指和祖先引用后代", () => {
  const siblings = validElements();
  siblings[2].ui_layout.position_reference_id = "entry-title";
  siblings[2].ui_layout.grouping_basis = ["POSITION"];
  siblings[3].ui_layout.position_reference_id = "entry-icon";
  siblings[3].ui_layout.grouping_basis = ["POSITION"];
  const siblingErrors = []; validateSemanticGrouping(siblings, { canvas: CANVAS }, siblingErrors, "sibling-cycle");
  assert(siblingErrors.some((message) => message.includes("定位依赖") && message.includes("循环")));

  const ancestor = validElements();
  ancestor[1].ui_layout.position_reference_id = "entry-icon";
  ancestor[1].ui_layout.grouping_basis = ["POSITION"];
  const ancestorErrors = []; validateSemanticGrouping(ancestor, { canvas: CANVAS }, ancestorErrors, "ancestor-cycle");
  assert(ancestorErrors.some((message) => message.includes("定位依赖") && message.includes("循环")));
  assert(ancestorErrors.some((message) => message.includes("position_reference_id") && message.includes("同级、祖先")));
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
