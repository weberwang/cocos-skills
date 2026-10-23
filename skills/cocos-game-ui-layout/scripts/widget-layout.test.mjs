import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveLayoutExecutionPlans,
  validateLayoutDriverDeclaration,
  validateLayoutExecutionNodes,
} from "./widget-layout.mjs";

const NINE_SLICE = {
  mode: "stretch",
  reason: "保留固定边角并延展中区",
  source_size: { width: 32, height: 32 },
  borders: { left: 4, right: 4, top: 4, bottom: 4 },
};

/** 创建作为 Widget 定位目标的底板节点。 */
function panelNode(overrides = {}) {
  return {
    layout_node_id: "panel",
    parent_layout_node_id: "viewport",
    target_bounds: { x: 0, y: 0, width: 200, height: 100 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
    ...overrides,
  };
}

/** 创建使用冻结目标几何的普通图片节点。 */
function iconNode(overrides = {}) {
  return {
    layout_node_id: "icon",
    parent_layout_node_id: "panel",
    target_bounds: { x: 80, y: 40, width: 40, height: 20 },
    axis_alignment: { horizontal: "center", vertical: "center" },
    owner_type: "fixed-production-visual",
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
    ...overrides,
  };
}

/** 创建共享视口的固定稳定根矩形快照。 */
function viewportNode() {
  return {
    layout_node_id: "viewport",
    parent_layout_node_id: null,
    is_root_container: true,
    target_bounds: { x: 0, y: 0, width: 200, height: 100 },
    ui_layout: null,
    axis_alignment: null,
  };
}

/** 创建有真实 Node 身份的 Canvas 布局父级。 */
function canvasNode() {
  return {
    layout_node_id: "canvas",
    parent_layout_node_id: "viewport",
    target_bounds: { x: 0, y: 0, width: 200, height: 100 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
  };
}

/** 将节点列表派生为含执行计划的副本。 */
function plans(nodes) {
  return deriveLayoutExecutionPlans(nodes);
}

test("主图标严格居中生成零偏移 Widget，RAW 尺寸仍独立于底板 bounds", () => {
  const source = [viewportNode(), panelNode({ render_kind: "sprite", element_type: "container", owner_type: "fixed-production-visual", role: "button-skin" }), iconNode()];
  const result = plans(source);
  const panel = result.find((node) => node.layout_node_id === "panel");
  const icon = result.find((node) => node.layout_node_id === "icon");

  assert.deepEqual(panel.layout_execution, {
    position_driver: "SHARED",
    size_driver: "SPRITE_RAW",
    reason: "定位参照 viewport 是逻辑稳定根，由共享布局映射到实际 Canvas/视口尺寸，不假定存在可供 Widget target 使用的 Node。",
    widget: null,
  });
  assert.equal(icon.layout_execution.position_driver, "WIDGET");
  assert.equal(icon.layout_execution.size_driver, "SPRITE_RAW");
  assert.equal(icon.layout_execution.widget.target_id, "panel");
  assert.deepEqual(icon.layout_execution.widget.horizontal, { alignment: "center", value: 0 });
  assert.deepEqual(icon.layout_execution.widget.vertical, { alignment: "center", value: 0 });
  assert.equal(icon.target_bounds.width, 40);
  assert.equal(icon.target_bounds.height, 20);
  assert.deepEqual(source[2].target_bounds, { x: 80, y: 40, width: 40, height: 20 }, "派生过程不修改源几何");
});

test("角标可独立贴右上角，且不改变主图标居中策略", () => {
  const badge = iconNode({
    layout_node_id: "badge",
    target_bounds: { x: 180, y: 0, width: 20, height: 20 },
    axis_alignment: { horizontal: "right", vertical: "top" },
  });
  const result = plans([viewportNode(), panelNode(), iconNode(), badge]);
  const icon = result.find((node) => node.layout_node_id === "icon");
  const marker = result.find((node) => node.layout_node_id === "badge");

  assert.deepEqual(icon.layout_execution.widget.horizontal, { alignment: "center", value: 0 });
  assert.deepEqual(marker.layout_execution.widget.horizontal, { alignment: "right", value: 0 });
  assert.deepEqual(marker.layout_execution.widget.vertical, { alignment: "top", value: 0 });
});

test("图文整体组、兄弟参照与动画控制交给共享职责，不新增包装节点", () => {
  const groupLeader = iconNode({
    layout_node_id: "group-icon",
    center_alignment: { member_ids: ["group-icon", "group-text"] },
  });
  const groupMember = iconNode({ layout_node_id: "group-text", target_bounds: { x: 125, y: 40, width: 50, height: 20 } });
  const sibling = iconNode({
    layout_node_id: "sibling-relative",
    reference_id: "group-text",
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
  });
  const animated = iconNode({
    layout_node_id: "animated",
    ui_layout: { layout_owner: "EXTERNAL", position_driver: "ANIMATION", size_policy: "FIXED" },
  });
  const source = [viewportNode(), panelNode(), groupLeader, groupMember, sibling, animated];
  const result = plans(source);

  for (const id of ["group-icon", "group-text", "sibling-relative"]) {
    const node = result.find((item) => item.layout_node_id === id);
    assert.equal(node.layout_execution.position_driver, "SHARED", id);
    assert.equal(node.layout_execution.widget, null, id);
  }
  assert.match(result.find((item) => item.layout_node_id === "group-icon").layout_execution.reason, /组合边界/);
  assert.match(result.find((item) => item.layout_node_id === "sibling-relative").layout_execution.reason, /不增加包装容器/);
  assert.equal(result.find((item) => item.layout_node_id === "animated").layout_execution.position_driver, "ANIMATION");
  assert.equal(result.length, source.length, "策略只决定控制方式，不插入容器");
});

test("只有冻结九宫格或结构容器才能获得 Widget 尺寸控制", () => {
  const slicedPanel = {
    layout_node_id: "sliced",
    parent_layout_node_id: "canvas",
    reference_id: "canvas",
    target_bounds: { x: 10, y: 10, width: 160, height: 80 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "component",
    owner_type: "fixed-production-visual",
    role: "panel-frame",
    nine_slice: NINE_SLICE,
    ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED", widget_stretch_axes: ["horizontal"] },
  };
  const nonSprite = {
    layout_node_id: "flex-box",
    parent_layout_node_id: "canvas",
    reference_id: "canvas",
    target_bounds: { x: 10, y: 10, width: 80, height: 30 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "STRETCH", widget_stretch_axes: ["horizontal", "vertical"] },
  };
  const result = plans([viewportNode(), canvasNode(), slicedPanel, nonSprite]);
  const sliced = result.find((node) => node.layout_node_id === "sliced").layout_execution;
  const box = result.find((node) => node.layout_node_id === "flex-box").layout_execution;

  assert.equal(sliced.size_driver, "WIDGET");
  assert.deepEqual(sliced.widget.horizontal, { alignment: "stretch", start: 10, end: 30 });
  assert.equal(box.size_driver, "WIDGET");
  assert.deepEqual(box.widget.vertical, { alignment: "stretch", start: 10, end: 60 });
});

test("逻辑稳定根映射到共享布局，真实 Canvas 节点可作为 Widget target", () => {
  const logicalRootChild = iconNode({
    layout_node_id: "viewport-child",
    parent_layout_node_id: "viewport",
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
  });
  const canvasChild = iconNode({
    layout_node_id: "canvas-child",
    parent_layout_node_id: "canvas",
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
  });
  const result = plans([viewportNode(), canvasNode(), panelNode(), logicalRootChild, canvasChild]);
  const logical = result.find((node) => node.layout_node_id === "viewport-child");
  const realCanvas = result.find((node) => node.layout_node_id === "canvas-child");

  assert.equal(logical.layout_execution.position_driver, "SHARED");
  assert.match(logical.layout_execution.reason, /逻辑稳定根/);
  assert.equal(realCanvas.layout_execution.position_driver, "WIDGET");
  assert.equal(realCanvas.layout_execution.widget.target_id, "canvas");
  assert.throws(() => plans([viewportNode(), iconNode({
    parent_layout_node_id: "viewport",
    reference_id: "viewport",
    ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED" },
  })]), /逻辑稳定根/);
  assert.throws(() => plans([viewportNode(), iconNode({
    parent_layout_node_id: "viewport",
    ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED" },
  })]), /逻辑稳定根/);
});

test("STRETCH 与 FLEX 按位置控制者派生尺寸驱动，互不争写属性", () => {
  const sibling = iconNode({ layout_node_id: "sibling" });
  const stretchFromSibling = {
    layout_node_id: "stretch-sibling",
    parent_layout_node_id: "panel",
    reference_id: "sibling",
    target_bounds: { x: 130, y: 20, width: 40, height: 20 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "SELF", size_policy: "STRETCH" },
  };
  const flexByParent = {
    layout_node_id: "flex-parent",
    parent_layout_node_id: "panel",
    target_bounds: { x: 10, y: 10, width: 60, height: 20 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "PARENT", size_policy: "FLEX" },
  };
  const flexByLayout = {
    layout_node_id: "flex-layout",
    parent_layout_node_id: "panel",
    target_bounds: { x: 10, y: 35, width: 60, height: 20 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "PARENT", position_driver: "LAYOUT", size_policy: "FLEX" },
  };
  const widgetPositionSharedSize = {
    layout_node_id: "widget-position-shared-size",
    parent_layout_node_id: "panel",
    target_bounds: { x: 10, y: 10, width: 60, height: 20 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "SELF", size_policy: "STRETCH" },
  };
  const widgetPositionLayoutSize = {
    layout_node_id: "widget-position-layout-size",
    parent_layout_node_id: "canvas",
    target_bounds: { x: 10, y: 10, width: 80, height: 30 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FLEX", size_driver: "LAYOUT" },
  };
  const result = plans([viewportNode(), canvasNode(), panelNode(), sibling, stretchFromSibling, flexByParent, flexByLayout, widgetPositionSharedSize, widgetPositionLayoutSize]);
  const stretch = result.find((node) => node.layout_node_id === "stretch-sibling").layout_execution;
  const flex = result.find((node) => node.layout_node_id === "flex-parent").layout_execution;
  const layout = result.find((node) => node.layout_node_id === "flex-layout").layout_execution;
  const widget = result.find((node) => node.layout_node_id === "widget-position-shared-size").layout_execution;
  const widgetLayout = result.find((node) => node.layout_node_id === "widget-position-layout-size").layout_execution;

  assert.deepEqual([stretch.position_driver, stretch.size_driver, stretch.widget], ["SHARED", "SHARED", null]);
  assert.deepEqual([flex.position_driver, flex.size_driver, flex.widget], ["SHARED", "SHARED", null]);
  assert.deepEqual([layout.position_driver, layout.size_driver, layout.widget], ["LAYOUT", "LAYOUT", null]);
  assert.match(layout.reason, /尺寸独立遵循 size_driver/);
  assert.equal(widget.position_driver, "WIDGET");
  assert.equal(widget.size_driver, "SHARED");
  assert.match(widget.reason, /共享布局先计算节点尺寸，Widget 再.*定位/);
  assert.equal(widgetLayout.position_driver, "WIDGET");
  assert.equal(widgetLayout.size_driver, "LAYOUT");
  assert.equal(widgetLayout.widget.target_id, "canvas");
  assert.match(widgetLayout.reason, /Layout 容器先计算自身尺寸，Widget 再.*定位/);
});

test("非法驱动声明、所有权组合、RAW 拉伸和控制冲突必须报错", () => {
  const declarationErrors = validateLayoutDriverDeclaration({ position_driver: "UNKNOWN", layout_owner: ["SELF"], size_driver: "UNKNOWN", widget_stretch_axes: ["horizontal", "horizontal"] });
  assert.equal(declarationErrors.length, 5);
  for (const [position_driver, layout_owner] of [["WIDGET", "PARENT"], ["STATIC", "EXTERNAL"], ["LAYOUT", "SELF"], ["ANIMATION", "PARENT"]]) {
    assert.equal(validateLayoutDriverDeclaration({ position_driver, layout_owner }).length, 1, `${position_driver} 必须声明对应的 ${layout_owner} 职责`);
  }

  const cases = [
    ["WIDGET 缺少 SELF 控制权", iconNode({ ui_layout: { layout_owner: "PARENT", position_driver: "WIDGET", size_policy: "FIXED" } }), /layout_owner=SELF/],
    ["兄弟参照不能由 Widget 直接引用", iconNode({ reference_id: "peer", ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED" } }), /不是实际父级或祖先/],
    ["合成布局快照不能伪造实际 Widget target", iconNode({ parent_layout_node_id: "missing-panel", parent_target_bounds: { x: 0, y: 0, width: 200, height: 100 }, ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED" } }), /不是实际父级或祖先/],
    ["虚拟组合成员不能单独用 Widget", iconNode({ center_alignment: { member_ids: ["icon", "peer"] }, ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED" } }), /虚拟居中组成员必须使用 SHARED/],
    ["动画控制必须归属 EXTERNAL", iconNode({ ui_layout: { layout_owner: "SELF", position_driver: "ANIMATION", size_policy: "FIXED" } }), /要求 layout_owner=EXTERNAL/],
    ["RAW 普通图片禁止 Widget 拉伸", iconNode({ ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED", widget_stretch_axes: ["horizontal"] } }), /RAW 图片不能使用 Widget 双边拉伸/],
    ["RAW 普通图片不能声明非 RAW 尺寸驱动", iconNode({ ui_layout: { layout_owner: "SELF", size_policy: "FIXED", size_driver: "FIXED" } }), /普通 RAW 图片只能声明 SPRITE_RAW/],
    ["没有 Widget 拉伸时不能显式声明 WIDGET 尺寸驱动", iconNode({ element_type: "container", owner_type: undefined, ui_layout: { layout_owner: "SELF", size_policy: "FIXED", size_driver: "WIDGET" } }), /必须同时声明 widget_stretch_axes/],
    ["纯结构容器不能声明 Sprite RAW 尺寸驱动", iconNode({ element_type: "container", owner_type: undefined, ui_layout: { layout_owner: "SELF", size_policy: "FIXED", size_driver: "SPRITE_RAW" } }), /仅适用于普通 RAW 图片/],
    ["尺寸驱动必须符合尺寸策略", iconNode({ element_type: "container", owner_type: undefined, ui_layout: { layout_owner: "SELF", size_policy: "FIXED", size_driver: "CONTENT" } }), /size_driver=CONTENT 要求 size_policy=CONTENT/],
    ["非 Sprite 拉伸必须由 STRETCH 结构容器承担", iconNode({ element_type: "container", owner_type: undefined, ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FIXED", widget_stretch_axes: ["horizontal"] } }), /非 Sprite 使用 Widget 拉伸时必须是结构容器且声明 size_policy=STRETCH/],
    ["文字不能承担 Widget 拉伸尺寸", iconNode({ element_type: "text", owner_type: "runtime-data", ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "STRETCH", widget_stretch_axes: ["horizontal"] } }), /文字和命中区域使用其他尺寸驱动/],
    ["命中区域不能承担 Widget 拉伸尺寸", iconNode({ element_type: "hit-area", owner_type: "runtime-data", ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "STRETCH", widget_stretch_axes: ["horizontal"] } }), /文字和命中区域使用其他尺寸驱动/],
  ];

  for (const [description, node, expectedError] of cases) {
    const parents = node.parent_layout_node_id === "missing-panel" ? [viewportNode()] : [viewportNode(), panelNode()];
    assert.throws(() => plans([...parents, node, ...(node.center_alignment ? [iconNode({ layout_node_id: "peer" })] : [])]), expectedError, description);
  }
});

test("尺寸驱动枚举参与节点事实校验和执行计划复算", () => {
  const source = [viewportNode(), canvasNode(), {
    layout_node_id: "layout-sized-widget-position",
    parent_layout_node_id: "canvas",
    target_bounds: { x: 10, y: 10, width: 80, height: 30 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    element_type: "container",
    ui_layout: { layout_owner: "SELF", position_driver: "WIDGET", size_policy: "FLEX", size_driver: "LAYOUT" },
  }];
  const planned = plans(source);
  assert.deepEqual(validateLayoutExecutionNodes(planned, [], "layout_nodes", { requirePlan: true }), []);

  const alteredFacts = structuredClone(planned);
  alteredFacts[2].ui_layout.size_driver = "SHARED";
  const errors = validateLayoutExecutionNodes(alteredFacts, [], "layout_nodes", { requirePlan: true });
  assert.match(errors.join("\n"), /layout_execution 与节点事实派生结果不一致/);

  const unknownDriver = structuredClone(source);
  unknownDriver[2].ui_layout.size_driver = "CUSTOM";
  assert.throws(() => plans(unknownDriver), /size_driver 只支持/);
});

test("严格居中不接受偏移 bounds，reference 偏移保留实际 logical-px", () => {
  const miscentered = iconNode({ target_bounds: { x: 81, y: 40, width: 40, height: 20 } });
  assert.throws(() => plans([viewportNode(), panelNode(), miscentered]), /严格水平居中/);

  const compensated = iconNode({
    target_bounds: { x: 82, y: 40, width: 40, height: 20 },
    center_alignment: {
      horizontal: { mode: "reference", offset: 2, reason: "主体图形视觉重心向右偏，需要明确补偿" },
      vertical: { mode: "strict" },
    },
  });
  const widget = plans([viewportNode(), panelNode(), compensated]).at(-1).layout_execution.widget;
  assert.deepEqual(widget.horizontal, { alignment: "center", value: 2 });
  assert.deepEqual(widget.vertical, { alignment: "center", value: 0 });
});

test("执行计划校验从节点事实复算并拒绝伪造字段或缺失计划", () => {
  const source = [viewportNode(), panelNode(), iconNode()];
  const planned = plans(source);
  assert.deepEqual(validateLayoutExecutionNodes(planned, [], "layout_nodes", { requirePlan: true }), []);

  const tampered = structuredClone(planned);
  tampered[2].layout_execution.widget.target_id = "viewport";
  let errors = validateLayoutExecutionNodes(tampered);
  assert.match(errors[0], /与节点事实派生结果不一致/);

  const injected = structuredClone(planned);
  injected[2].layout_execution.injected = true;
  errors = validateLayoutExecutionNodes(injected);
  assert.match(errors[0], /与节点事实派生结果不一致/);

  const missing = structuredClone(planned);
  delete missing[2].layout_execution;
  errors = validateLayoutExecutionNodes(missing, [], "layout_nodes", { requirePlan: true });
  assert.match(errors[0], /layout_execution 缺失/);
});

test("仅合法合成根跳过派生计划，验证器拒绝根节点自带计划", () => {
  const rootWithPlan = { ...viewportNode(), layout_execution: { stale: true } };
  const rootPlanErrors = validateLayoutExecutionNodes([rootWithPlan, panelNode(), iconNode()]);
  assert.match(rootPlanErrors.join("\n"), /合成根不允许携带执行计划/);

  const result = plans([viewportNode(), panelNode(), iconNode()]);
  assert.equal(Object.hasOwn(result[0], "layout_execution"), false);
  assert.throws(() => plans([{ ...viewportNode(), parent_layout_node_id: "canvas" }]), /必须显式声明 parent_layout_node_id=null/);
  assert.throws(() => plans([{ ...viewportNode(), is_root_container: false }]), /保留合成根 ID/);
  assert.throws(() => plans([viewportNode(), { ...iconNode(), is_root_container: true }]), /仅允许用于 viewport 或 safe-area 合成根/);

  const noBounds = iconNode({ target_bounds: undefined, bounds: undefined });
  const noAxis = iconNode({ axis_alignment: undefined });
  assert.throws(() => plans([viewportNode(), panelNode(), noBounds]), /target_bounds\/bounds 必须/);
  assert.throws(() => plans([viewportNode(), panelNode(), noAxis]), /axis_alignment 必须提供/);
});

test("业务节点伪造根标记时不能通过 requirePlan 缺失或篡改计划", () => {
  const planned = plans([viewportNode(), panelNode(), iconNode()]);
  const omittedPlan = structuredClone(planned);
  omittedPlan[2].is_root_container = true;
  delete omittedPlan[2].layout_execution;
  const deletedPlanErrors = validateLayoutExecutionNodes(omittedPlan, [], "layout_nodes", { requirePlan: true });
  assert.match(deletedPlanErrors.join("\n"), /仅允许用于 viewport 或 safe-area 合成根/);

  const modifiedPlan = structuredClone(planned);
  modifiedPlan[2].is_root_container = true;
  modifiedPlan[2].layout_execution = { position_driver: "STATIC" };
  const modifiedPlanErrors = validateLayoutExecutionNodes(modifiedPlan, [], "layout_nodes", { requirePlan: true });
  assert.match(modifiedPlanErrors.join("\n"), /仅允许用于 viewport 或 safe-area 合成根/);
});
