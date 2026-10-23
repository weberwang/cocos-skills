import assert from "node:assert/strict";
import test from "node:test";
import { validateLayoutRuntimeSnapshots } from "./widget-runtime.mjs";
import { attachLayoutRuntimeSnapshots, createLayoutRuntimeSnapshot } from "./widget-runtime-test-fixtures.mjs";

const centeredWidget = (targetId = "panel") => ({
  target_id: targetId,
  align_mode: "ON_WINDOW_RESIZE",
  horizontal: { alignment: "center", value: 0 },
  vertical: { alignment: "center", value: 0 },
});

/** 创建符合当前用例目标的布局节点基线。 */
function node(id, {
  parent = "viewport",
  position = "WIDGET",
  size = "SPRITE_RAW",
  geometry = { type: "SIMPLE", size_mode: "RAW", content_size: null },
  bounds = { x: 40, y: 40, width: 20, height: 20 },
  widget = position === "WIDGET" ? centeredWidget(parent) : null,
  ...extra
} = {}) {
  return {
    layout_node_id: id,
    parent_layout_node_id: parent,
    target_bounds: { ...bounds },
    ...(geometry ? { sprite_geometry: structuredClone(geometry) } : {}),
    layout_execution: { position_driver: position, size_driver: size, widget: widget ? structuredClone(widget) : null },
    ...extra,
  };
}

/** 为节点列表生成默认组件快照。 */
function snapshots(nodes, rows = nodes.map((item) => ({ layout_node_id: item.layout_node_id }))) {
  return attachLayoutRuntimeSnapshots(nodes, rows);
}

/** 校验快照并返回诊断，供断言关注具体失败原因。 */
function errorsFor(nodes, rows = snapshots(nodes)) {
  return validateLayoutRuntimeSnapshots(nodes, rows, []);
}

test("接受严格居中 Widget 和保持 RAW 原尺寸的普通图片", () => {
  const item = node("icon");
  const errors = errorsFor([item]);
  assert.deepEqual(errors, []);
});

test("接受父 Layout 只排布位置且 RAW 子图片尺寸不变", () => {
  const parent = node("panel", {
    parent: "viewport", position: "STATIC", size: "FIXED", geometry: null,
    bounds: { x: 0, y: 0, width: 100, height: 80 }, widget: null,
  });
  const child = node("icon", { parent: "panel", position: "LAYOUT", widget: null });
  assert.deepEqual(errorsFor([parent, child]), []);
});

test("接受 Widget 定位与共享尺寸分工", () => {
  const item = node("badge", {
    position: "WIDGET", size: "SHARED",
    geometry: { type: "SLICED", size_mode: "CUSTOM", content_size: { width: 20, height: 20 } },
  });
  assert.deepEqual(errorsFor([item]), []);
});

test("接受 Widget 定位与自身 Layout.CONTAINER 尺寸分工", () => {
  const item = node("content", { geometry: null, position: "WIDGET", size: "LAYOUT" });
  assert.deepEqual(errorsFor([item]), []);
});

test("NONE Layout 的 CONTAINER 配置不写入尺寸", () => {
  const item = node("fixed-none-layout", {
    geometry: null,
    position: "STATIC",
    size: "FIXED",
    widget: null,
    runtime_layout: { enabled: true, type: "NONE", resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false },
  });
  assert.deepEqual(errorsFor([item]), []);
});

test("拒绝 Widget 同轴多 flag、target 漂移和偏移比例错误", () => {
  const item = node("icon");
  item.layout_execution.widget.horizontal.value = 2;
  const row = snapshots([item])[0];
  row.component_snapshot.widget.is_align_left = true;
  row.component_snapshot.widget.target_id = "other-panel";
  row.component_snapshot.widget.horizontal_center = 4;
  const errors = errorsFor([item], [row]);
  assert.ok(errors.some((message) => message.includes("is_align_left")));
  assert.ok(errors.some((message) => message.includes("target_id")));
  assert.ok(errors.some((message) => message.includes("horizontal_center")));
});

test("拒绝父 Layout 抢写共享定位以及 Layout.CHILDREN 改变 RAW 尺寸", () => {
  const shared = node("shared", { position: "SHARED", widget: null });
  const sharedSnapshot = createLayoutRuntimeSnapshot(shared, {
    parent_layout: { enabled: true, type: "HORIZONTAL", resize_mode: "NONE", align_horizontal: false, align_vertical: false },
  });
  assert.ok(errorsFor([shared], [{ layout_node_id: "shared", component_snapshot: sharedSnapshot }]).some((message) => message.includes("父 Layout 会重排")));

  const parent = node("panel", {
    parent: "viewport", position: "STATIC", size: "FIXED", geometry: null,
    runtime_layout: { enabled: true, type: "HORIZONTAL", resize_mode: "CHILDREN", align_horizontal: false, align_vertical: false },
    bounds: { x: 0, y: 0, width: 100, height: 80 }, widget: null,
  });
  const child = node("icon", { parent: "panel", position: "LAYOUT", widget: null });
  const errors = errorsFor([parent, child]);
  assert.ok(errors.some((message) => message.includes("RAW 图片不得由父 Layout.CHILDREN")));
});

test("父子两个 Layout 同时控制宽度时拒绝，分别控制宽高时允许", () => {
  const makeLayoutPair = (parentType, selfType) => {
    const parent = node("panel", {
      parent: "viewport", position: "STATIC", size: "FIXED", geometry: null,
      runtime_layout: { enabled: true, type: parentType, resize_mode: "CHILDREN", align_horizontal: false, align_vertical: false },
      bounds: { x: 0, y: 0, width: 100, height: 80 }, widget: null,
    });
    const child = node("content", {
      parent: "panel", position: "LAYOUT", size: "LAYOUT", geometry: null, widget: null,
      runtime_layout: { enabled: true, type: selfType, resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false },
    });
    return [parent, child];
  };

  const sameAxisErrors = errorsFor(makeLayoutPair("HORIZONTAL", "HORIZONTAL"));
  assert.ok(sameAxisErrors.some((message) => message.includes("父 Layout.CHILDREN 与 自身 Layout.CONTAINER 同时控制 width")), sameAxisErrors.join("\n"));
  assert.deepEqual(errorsFor(makeLayoutPair("HORIZONTAL", "VERTICAL")), []);
});

test("父 Grid 与自身水平 Layout 同时写宽度时拒绝", () => {
  const parent = node("panel", {
    parent: "viewport", position: "STATIC", size: "FIXED", geometry: null,
    runtime_layout: { enabled: true, type: "GRID", resize_mode: "CHILDREN", align_horizontal: false, align_vertical: false, start_axis: "HORIZONTAL", cell_size: { width: 20, height: 20 } },
    bounds: { x: 0, y: 0, width: 100, height: 80 }, widget: null,
  });
  const child = node("content", {
    parent: "panel", position: "LAYOUT", size: "LAYOUT", geometry: null, widget: null,
    runtime_layout: { enabled: true, type: "HORIZONTAL", resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false },
  });
  const errors = errorsFor([parent, child]);
  assert.ok(errors.some((message) => message.includes("父 Layout.CHILDREN 与 自身 Layout.CONTAINER 同时控制 width")), errors.join("\n"));
});

test("Grid 容器按 start_axis 判定尺寸轴，且 Grid 必须声明 start_axis", () => {
  const makePair = (startAxis) => {
    const parent = node("panel", {
      parent: "viewport", position: "STATIC", size: "FIXED", geometry: null,
      runtime_layout: { enabled: true, type: "HORIZONTAL", resize_mode: "CHILDREN", align_horizontal: false, align_vertical: false },
      bounds: { x: 0, y: 0, width: 100, height: 80 }, widget: null,
    });
    const child = node("content", {
      parent: "panel", position: "LAYOUT", size: "LAYOUT", geometry: null, widget: null,
      runtime_layout: { enabled: true, type: "GRID", resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false, start_axis: startAxis },
    });
    return [parent, child];
  };

  assert.deepEqual(errorsFor(makePair("HORIZONTAL")), []);
  const overlap = errorsFor(makePair("VERTICAL"));
  assert.ok(overlap.some((message) => message.includes("父 Layout.CHILDREN 与 自身 Layout.CONTAINER 同时控制 width")), overlap.join("\n"));

  const missingAxis = node("grid-missing-axis", {
    geometry: null, position: "STATIC", size: "FIXED", widget: null,
    runtime_layout: { enabled: true, type: "GRID", resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false },
  });
  assert.ok(errorsFor([missingAxis]).some((message) => message.includes("start_axis 必须是 HORIZONTAL 或 VERTICAL")));
});

test("拒绝自身 Layout.CONTAINER 改变 RAW 尺寸", () => {
  const item = node("raw", {
    runtime_layout: { enabled: true, type: "HORIZONTAL", resize_mode: "CONTAINER", align_horizontal: false, align_vertical: false },
  });
  const errors = errorsFor([item]);
  assert.ok(errors.some((message) => message.includes("自身 Layout.CONTAINER")));
});

test("拒绝多位置写入者和非单位 Widget/RAW 坐标路径", () => {
  const item = node("icon");
  const row = snapshots([item])[0];
  row.component_snapshot.position_writers = ["WIDGET", "SHARED"];
  row.component_snapshot.node_to_layout = { a: 2, b: 0, c: 0, d: 1 };
  row.component_snapshot.reference_to_layout = { a: 1, b: 0, c: 0, d: 0.5 };
  const errors = errorsFor([item], [row]);
  assert.ok(errors.some((message) => message.includes("单一写入者")));
  assert.ok(errors.some((message) => message.includes("node_to_layout")));
  assert.ok(errors.some((message) => message.includes("reference_to_layout")));
});

test("允许共享布局换算 RAW 图片的非单位坐标路径", () => {
  const item = node("raw-shared", {
    position: "SHARED", widget: null,
    bounds: { x: 10, y: 10, width: 40, height: 40 },
    sprite_original_size: { width: 20, height: 20 },
  });
  const row = snapshots([item])[0];
  row.component_snapshot.ui_transform = { width: 20, height: 20 };
  row.component_snapshot.node_to_layout = { a: 2, b: 0, c: 0, d: 2 };
  row.component_snapshot.reference_to_layout = { a: 1, b: 0, c: 0, d: 0.5 };
  assert.deepEqual(errorsFor([item], [row]), []);
});

test("严格居中使用实际 Widget 快照几何而非原生 flag 声明", () => {
  const item = node("centered-icon", {
    parent: "viewport",
    bounds: { x: 90, y: 40, width: 20, height: 20 },
    reference_target_bounds: { x: 0, y: 0, width: 200, height: 100 },
    axis_alignment: { horizontal: "center", vertical: "center" },
  });
  const row = snapshots([item])[0];
  row.component_snapshot.layout_bounds.x += 1;
  const errors = errorsFor([item], [row]);
  assert.ok(errors.some((message) => message.includes("必须严格居中")), errors.join("\n"));
});

test("图文组严格居中按真实联合边界校验", () => {
  const referenceBounds = { x: 0, y: 0, width: 102, height: 100 };
  const icon = node("icon", {
    parent: "viewport", position: "SHARED", widget: null,
    bounds: { x: 40, y: 40, width: 10, height: 10 },
    reference_target_bounds: referenceBounds,
    axis_alignment: { horizontal: "center", vertical: "top" },
    center_alignment: { horizontal: { mode: "strict" }, member_ids: ["icon", "text"] },
  });
  const text = node("text", {
    parent: "viewport", position: "SHARED", widget: null,
    bounds: { x: 52, y: 40, width: 10, height: 10 },
    reference_target_bounds: referenceBounds,
    axis_alignment: { horizontal: "left", vertical: "top" },
  });
  const rows = snapshots([icon, text]);
  rows[0].component_snapshot.layout_bounds.x += 1;
  rows[1].component_snapshot.layout_bounds.x += 1;
  const errors = errorsFor([icon, text], rows);
  assert.ok(errors.some((message) => message.includes("虚拟组 horizontal 必须严格居中")), errors.join("\n"));
});

test("RAW 图片缩放后仍按实际逻辑边界校验严格中心", () => {
  const item = node("scaled-raw-center", {
    parent: "viewport", position: "SHARED", widget: null,
    bounds: { x: 80, y: 40, width: 40, height: 20 },
    sprite_original_size: { width: 20, height: 20 },
    reference_target_bounds: { x: 0, y: 0, width: 200, height: 100 },
    axis_alignment: { horizontal: "center", vertical: "center" },
  });
  const row = snapshots([item])[0];
  row.component_snapshot.ui_transform = { width: 20, height: 20 };
  row.component_snapshot.node_to_layout = { a: 2, b: 0, c: 0, d: 1 };
  assert.deepEqual(errorsFor([item], [row]), []);
});

test("业务参照使用其运行时边界，同一稳定根边界必须一致", () => {
  const panel = node("panel", {
    parent: "viewport", position: "STATIC", size: "FIXED", geometry: null, widget: null,
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    reference_target_bounds: { x: 0, y: 0, width: 200, height: 100 },
  });
  const icon = node("icon", {
    parent: "panel", position: "SHARED", widget: null,
    bounds: { x: 40, y: 30, width: 20, height: 20 },
    axis_alignment: { horizontal: "center", vertical: "center" },
    reference_target_bounds: { x: 0, y: 0, width: 100, height: 80 },
  });
  const rows = snapshots([panel, icon]);
  assert.deepEqual(errorsFor([panel, icon], rows), []);
  rows[1].component_snapshot.reference_bounds.x += 1;
  assert.ok(errorsFor([panel, icon], rows).some((message) => message.includes("必须等于业务参照 panel 的 layout_bounds")));

  const first = node("first", {
    position: "SHARED", widget: null,
    reference_target_bounds: { x: 0, y: 0, width: 200, height: 100 },
  });
  const second = node("second", {
    position: "SHARED", widget: null,
    reference_target_bounds: { x: 0, y: 0, width: 201, height: 100 },
  });
  const rootErrors = errorsFor([first, second]);
  assert.ok(rootErrors.some((message) => message.includes("同一逻辑根 viewport 的 reference_bounds 必须在全部快照中一致")), rootErrors.join("\n"));
});

test("拒绝 RAW UITransform 与原图、target_bounds 不一致", () => {
  const item = node("icon");
  const row = snapshots([item])[0];
  row.component_snapshot.ui_transform.width = 21;
  assert.ok(errorsFor([item], [row]).some((message) => message.includes("必须保持 SpriteFrame 原始 contentSize")));
});

test("要求每个节点恰有绑定快照，并拒绝重复或额外 ID", () => {
  const item = node("icon");
  assert.ok(errorsFor([item], []).some((message) => message.includes("component_snapshot 运行时快照")));
  const extra = snapshots([item]);
  extra.push({ layout_node_id: "unknown", component_snapshot: {} });
  assert.ok(errorsFor([item], extra).some((message) => message.includes("extra 节点")));
  const duplicate = snapshots([item]);
  duplicate.push(structuredClone(duplicate[0]));
  assert.ok(errorsFor([item], duplicate).some((message) => message.includes("重复 component_snapshot")));
});

test("校验非 Sprite 固定节点与固定 SLICED Sprite 的目标尺寸", () => {
  const container = node("fixed-container", { geometry: null, position: "STATIC", size: "FIXED", widget: null });
  const containerRow = snapshots([container])[0];
  containerRow.component_snapshot.ui_transform.width += 1;
  assert.ok(errorsFor([container], [containerRow]).some((message) => message.includes("固定节点的 UITransform 尺寸")));

  const sliced = node("fixed-sliced", {
    geometry: { type: "SLICED", size_mode: "CUSTOM", content_size: { width: 20, height: 20 } },
    position: "STATIC", size: "FIXED", widget: null,
  });
  const slicedRow = snapshots([sliced])[0];
  slicedRow.component_snapshot.ui_transform.height += 1;
  assert.ok(errorsFor([sliced], [slicedRow]).some((message) => message.includes("固定节点的 UITransform 尺寸")));
});

test("inactive 快照不把停用组件当成有效位置或尺寸写入者", () => {
  const item = node("inactive", { active: false });
  const snapshot = createLayoutRuntimeSnapshot(item, { active: false });
  snapshot.widget.enabled = false;
  assert.deepEqual(errorsFor([item], [{ layout_node_id: "inactive", component_snapshot: snapshot }]), []);

  const inactiveLayout = node("inactive-layout", { active: false, position: "LAYOUT", size: "LAYOUT", geometry: null, widget: null });
  const layoutSnapshot = createLayoutRuntimeSnapshot(inactiveLayout, { active: false });
  assert.deepEqual(errorsFor([inactiveLayout], [{ layout_node_id: "inactive-layout", component_snapshot: layoutSnapshot }]), []);

  const mismatched = createLayoutRuntimeSnapshot(item, { active: false });
  mismatched.widget.enabled = false;
  mismatched.widget.is_align_left = true;
  assert.ok(errorsFor([item], [{ layout_node_id: "inactive", component_snapshot: mismatched }]).some((message) => message.includes("is_align_left")));
});

test("active快照遵守 activeInHierarchy 父子约束", () => {
  const parent = node("inactive-panel", {
    parent: "viewport", active: true, position: "STATIC", size: "FIXED", geometry: null, widget: null,
    bounds: { x: 0, y: 0, width: 100, height: 80 },
  });
  const child = node("inactive-icon", { parent: "inactive-panel", active: true });
  const parentSnapshot = createLayoutRuntimeSnapshot(parent, { active: false });
  const parentNode = { ...parent, active: false, layout: null, layout_bounds: parent.target_bounds };

  const activeChild = createLayoutRuntimeSnapshot(child, { active: true, parentNode });
  const inconsistentErrors = errorsFor([parent, child], [
    { layout_node_id: "inactive-panel", component_snapshot: parentSnapshot },
    { layout_node_id: "inactive-icon", component_snapshot: activeChild },
  ]);
  assert.ok(inconsistentErrors.some((message) => message.includes("active 与父节点 inactive-panel 的 activeInHierarchy 矛盾")));

  const inactiveChild = createLayoutRuntimeSnapshot(child, { active: false, parentNode });
  assert.deepEqual(errorsFor([parent, child], [
    { layout_node_id: "inactive-panel", component_snapshot: parentSnapshot },
    { layout_node_id: "inactive-icon", component_snapshot: inactiveChild },
  ]), []);
});

test("损坏的 JSON 组件快照只返回诊断，不抛出异常", () => {
  const item = node("malformed");
  for (const componentSnapshot of [null, undefined, []]) {
    const row = { layout_node_id: "malformed", component_snapshot: componentSnapshot };
    assert.doesNotThrow(() => validateLayoutRuntimeSnapshots([item], [row], []));
    assert.ok(errorsFor([item], [row]).length > 0);
  }

  const valid = snapshots([item])[0].component_snapshot;
  for (const uiTransform of [null, undefined, [], { width: Number.NaN, height: 20 }]) {
    const snapshot = structuredClone(valid);
    if (uiTransform === undefined) delete snapshot.ui_transform;
    else snapshot.ui_transform = uiTransform;
    const errors = [];
    assert.doesNotThrow(() => validateLayoutRuntimeSnapshots([item], [{ layout_node_id: "malformed", component_snapshot: snapshot }], errors));
    assert.ok(errors.length > 0);
  }

  for (const originalSize of [null, undefined]) {
    const snapshot = structuredClone(valid);
    if (originalSize === undefined) delete snapshot.sprite.original_size;
    else snapshot.sprite.original_size = originalSize;
    const errors = [];
    assert.doesNotThrow(() => validateLayoutRuntimeSnapshots([item], [{ layout_node_id: "malformed", component_snapshot: snapshot }], errors));
    assert.ok(errors.length > 0);
  }

  for (const key of ["layout_bounds", "reference_bounds"]) {
    const snapshot = structuredClone(valid);
    snapshot[key] = null;
    const errors = [];
    assert.doesNotThrow(() => validateLayoutRuntimeSnapshots([item], [{ layout_node_id: "malformed", component_snapshot: snapshot }], errors));
    assert.ok(errors.some((message) => message.includes(`${key} 必须包含有限 x/y`)));
  }
});

test("停用 Widget 如实保留 ONCE，缺少绝对模式或 Grid 起始轴仍拒绝", () => {
  const shared = node("shared", { position: "SHARED", widget: null });
  const snapshot = createLayoutRuntimeSnapshot(shared);
  snapshot.widget = createLayoutRuntimeSnapshot(node("widget")).widget;
  snapshot.widget.enabled = false;
  snapshot.widget.align_mode = "ONCE";
  const rows = [{ layout_node_id: "shared", component_snapshot: snapshot }];
  assert.deepEqual(errorsFor([shared], rows), []);

  // 即使未启用某条对齐轴，也不能省略组件字段而让 Schema 与运行检查接受不同证据。
  delete snapshot.widget.is_absolute_left;
  assert.ok(errorsFor([shared], rows).some((message) => message.includes("is_absolute_left 必须是布尔值")));
  snapshot.widget.is_absolute_left = false;
  snapshot.widget.align_mode = "UNKNOWN";
  assert.ok(errorsFor([shared], rows).some((message) => message.includes("align_mode 必须是 ONCE")));
  snapshot.widget.align_mode = "ONCE";
  snapshot.layout = { enabled: false, type: "GRID", resize_mode: "NONE", align_horizontal: false, align_vertical: false };
  assert.ok(errorsFor([shared], rows).some((message) => message.includes("start_axis 必须是 HORIZONTAL 或 VERTICAL")));
  snapshot.layout.start_axis = "HORIZONTAL";
  assert.deepEqual(errorsFor([shared], rows), []);
});
