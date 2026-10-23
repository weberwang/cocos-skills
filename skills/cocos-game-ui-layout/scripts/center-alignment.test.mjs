import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCenterAlignment, resolveCenteredLayoutNodes, validateCenterAlignmentNodes } from "./center-alignment.mjs";

const canvas = { width: 500, height: 400 };

/** 构造具备父级、轴对齐和目标边界的布局节点测试数据。 */
function node(id, bounds, options = {}) {
  return {
    layout_node_id: id,
    parent_layout_node_id: options.parent ?? "viewport",
    axis_alignment: options.alignment ?? { horizontal: "left", vertical: "top" },
    ...(options.reference ? { ui_layout: { position_reference_id: options.reference } } : {}),
    ...(options.center_alignment !== undefined ? { center_alignment: options.center_alignment } : {}),
    ...(options.extra ?? {}),
    target_bounds: { ...bounds },
  };
}

/** 按节点 id 读取解析后的目标边界。 */
function boundsOf(nodes, id) {
  return nodes.find((item) => item.layout_node_id === id).target_bounds;
}

test("center轴默认strict，从偏差bounds精确居中单轴和双轴", () => {
  const input = [
    node("panel", { x: 50, y: 30, width: 300, height: 200 }),
    node("icon", { x: 82, y: 43, width: 40, height: 30 }, {
      parent: "panel", alignment: { horizontal: "center", vertical: "top" },
    }),
    node("badge", { x: 91, y: 99, width: 30, height: 20 }, {
      parent: "panel", alignment: { horizontal: "center", vertical: "center" },
    }),
  ];
  const result = resolveCenteredLayoutNodes(input, canvas);
  assert.deepEqual(boundsOf(result, "icon"), { x: 180, y: 43, width: 40, height: 30 });
  assert.deepEqual(boundsOf(result, "badge"), { x: 185, y: 120, width: 30, height: 20 });
  assert.deepEqual(result.find((item) => item.layout_node_id === "badge").center_alignment, {
    horizontal: { mode: "strict" }, vertical: { mode: "strict" },
  });
});

test("reference中心参照保留偏移并要求理由", () => {
  const axisAlignment = { horizontal: "center", vertical: "top" };
  const strategy = { horizontal: { mode: "reference", offset: 12, reason: "按钮图标光学补偿" } };
  assert.deepEqual(normalizeCenterAlignment(axisAlignment, strategy), {
    horizontal: { mode: "reference", offset: 12, reason: "按钮图标光学补偿" },
  });
  const input = [
    node("panel", { x: 30, y: 20, width: 200, height: 100 }),
    node("icon", { x: 31, y: 25, width: 20, height: 20 }, {
      parent: "panel", alignment: axisAlignment, center_alignment: strategy,
    }),
  ];
  assert.equal(boundsOf(resolveCenteredLayoutNodes(input, canvas), "icon").x, 132);
  for (const invalid of [
    { horizontal: { mode: "reference", offset: 2 } },
    { horizontal: { mode: "reference", offset: 2, reason: " " } },
    { horizontal: { mode: "reference", offset: 0, reason: "理由", extra: true } },
    { horizontal: { mode: "strict", reason: "多余字段" } },
    { horizontal: { mode: "center", offset: 0, reason: "无效模式" } },
    { horizontal: { mode: "reference", offset: Number.NaN, reason: "无效数值" } },
    { unknown: { mode: "strict" } },
  ]) assert.throws(() => normalizeCenterAlignment(axisAlignment, invalid), TypeError);
  assert.throws(() => normalizeCenterAlignment({ horizontal: "left", vertical: "top" }, { horizontal: { mode: "strict" } }), TypeError);
  assert.throws(() => normalizeCenterAlignment(axisAlignment, { member_ids: ["only-one"] }), TypeError);
  assert.throws(() => normalizeCenterAlignment(axisAlignment, { member_ids: ["a", "a"] }), TypeError);
});

test("虚拟图文组按联合框居中，组员保留间距，广告角标不参与", () => {
  const input = [
    node("button", { x: 50, y: 40, width: 300, height: 160 }),
    node("icon", { x: 95, y: 95, width: 24, height: 24 }, {
      parent: "button", alignment: { horizontal: "center", vertical: "top" },
      center_alignment: { member_ids: ["icon", "label"] },
    }),
    node("label", { x: 128, y: 98, width: 72, height: 20 }, {
      parent: "button", reference: "icon", alignment: { horizontal: "center", vertical: "top" },
    }),
    node("ad-badge", { x: 305, y: 45, width: 32, height: 28 }, {
      parent: "button", alignment: { horizontal: "right", vertical: "top" },
    }),
  ];
  const result = resolveCenteredLayoutNodes(input, canvas);
  const icon = boundsOf(result, "icon");
  const label = boundsOf(result, "label");
  const unionLeft = Math.min(icon.x, label.x);
  const unionRight = Math.max(icon.x + icon.width, label.x + label.width);
  assert.equal((unionLeft + unionRight) / 2, 200);
  assert.equal(label.x - (icon.x + icon.width), 9);
  assert.deepEqual(boundsOf(result, "ad-badge"), { x: 305, y: 45, width: 32, height: 28 });
  assert.deepEqual(result.find((item) => item.layout_node_id === "label").center_alignment, {});
  assert.deepEqual(result.find((item) => item.layout_node_id === "icon").center_alignment, {
    horizontal: { mode: "strict" }, member_ids: ["icon", "label"],
  });
});

test("容器、参照节点和后代按依赖顺序移动一次", () => {
  const input = [
    node("root-panel", { x: 20, y: 30, width: 200, height: 100 }, {
      alignment: { horizontal: "center", vertical: "top" },
    }),
    node("child", { x: 40, y: 42, width: 80, height: 30 }, { parent: "root-panel" }),
    node("grandchild", { x: 51, y: 46, width: 12, height: 12 }, { parent: "child" }),
  ];
  const result = resolveCenteredLayoutNodes(input, canvas);
  assert.equal(boundsOf(result, "root-panel").x, 150);
  assert.equal(boundsOf(result, "child").x, 170);
  assert.equal(boundsOf(result, "grandchild").x, 181);
  assert.equal(boundsOf(result, "child").y, 42);
  assert.equal(boundsOf(result, "grandchild").y, 46);
});

test("输入乱序不影响父级和参照依赖结果，允许text引用组内icon", () => {
  const input = [
    node("button", { x: 50, y: 40, width: 300, height: 160 }),
    node("icon", { x: 100, y: 100, width: 24, height: 24 }, {
      parent: "button", alignment: { horizontal: "center", vertical: "top" },
      center_alignment: { member_ids: ["icon", "text"] },
    }),
    node("text", { x: 135, y: 104, width: 60, height: 18 }, {
      parent: "button", reference: "icon", alignment: { horizontal: "center", vertical: "top" },
    }),
    node("after", { x: 250, y: 50, width: 20, height: 20 }, { parent: "button", reference: "text" }),
  ];
  const first = resolveCenteredLayoutNodes(input, canvas);
  const shuffled = resolveCenteredLayoutNodes([input[3], input[2], input[0], input[1]], canvas);
  for (const id of ["button", "icon", "text", "after"]) {
    assert.deepEqual(boundsOf(shuffled, id), boundsOf(first, id));
  }
  assert.equal(boundsOf(first, "text").x - (boundsOf(first, "icon").x + 24), 11);
  assert.equal(boundsOf(first, "after").x, 302.5);
});

test("策略、组成员关系、重叠组和定位循环的非法结构会被拒绝", () => {
  const base = [
    node("panel", { x: 0, y: 0, width: 200, height: 100 }),
    node("a", { x: 30, y: 20, width: 20, height: 20 }, {
      parent: "panel", alignment: { horizontal: "center", vertical: "top" },
      center_alignment: { member_ids: ["a", "b"] },
    }),
    node("b", { x: 55, y: 20, width: 20, height: 20 }, { parent: "panel" }),
  ];
  assert.throws(() => resolveCenteredLayoutNodes([
    ...base,
    node("missing", { x: 0, y: 0, width: 10, height: 10 }, { parent: "panel", reference: "absent" }),
  ], canvas), /不存在/);

  const explicitMemberStrategy = structuredClone(base);
  explicitMemberStrategy[2].axis_alignment = { horizontal: "center", vertical: "top" };
  explicitMemberStrategy[2].center_alignment = { horizontal: { mode: "strict" } };
  assert.throws(() => resolveCenteredLayoutNodes(explicitMemberStrategy, canvas), /不能覆盖/);

  const overlap = structuredClone(base);
  overlap[2].axis_alignment = { horizontal: "center", vertical: "top" };
  overlap[2].center_alignment = { member_ids: ["b", "a"] };
  assert.throws(() => resolveCenteredLayoutNodes(overlap, canvas), /多个虚拟居中组|不能覆盖|必须包含|不能在虚拟居中组内再定义/);

  const circular = [
    node("panel", { x: 0, y: 0, width: 200, height: 100 }),
    node("a", { x: 20, y: 20, width: 20, height: 20 }, { parent: "panel", reference: "b" }),
    node("b", { x: 60, y: 20, width: 20, height: 20 }, { parent: "panel", reference: "a" }),
  ];
  assert.throws(() => resolveCenteredLayoutNodes(circular, canvas), /循环/);

  const internalCycle = structuredClone(base);
  internalCycle[1].center_alignment.member_ids = ["a", "b", "c"];
  internalCycle.push(node("c", { x: 80, y: 20, width: 20, height: 20 }, { parent: "panel", reference: "b" }));
  internalCycle[2].ui_layout = { position_reference_id: "c" };
  assert.throws(() => resolveCenteredLayoutNodes(internalCycle, canvas), /组内定位参照存在循环/);
});

test("只声明strict或清零offset但不修正最终几何会被校验拒绝", () => {
  const nodes = [
    node("panel", { x: 50, y: 20, width: 200, height: 100 }),
    node("icon", { x: 90, y: 30, width: 20, height: 20 }, {
      parent: "panel", alignment: { horizontal: "center", vertical: "top" },
      center_alignment: { horizontal: { mode: "strict" } },
    }),
  ];
  const errors = validateCenterAlignmentNodes(nodes);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /必须严格居中/);
  const repaired = resolveCenteredLayoutNodes(nodes, canvas);
  assert.deepEqual(validateCenterAlignmentNodes(repaired), []);
});

test("解析深拷贝节点，仅修改位置并保持RAW尺寸和输入数据不变", () => {
  const input = [
    node("panel", { x: 50, y: 40, width: 300, height: 180 }),
    node("icon", { x: 75, y: 72, width: 24, height: 20 }, {
      parent: "panel", alignment: { horizontal: "center", vertical: "center" },
      extra: { sprite_geometry: { type: "SIMPLE", size_mode: "RAW", content_size: null }, bounds: { x: 75, y: 72, width: 24, height: 20 } },
    }),
  ];
  const before = structuredClone(input);
  const result = resolveCenteredLayoutNodes(input, canvas);
  assert.deepEqual(input, before);
  const icon = result.find((item) => item.layout_node_id === "icon");
  assert.deepEqual(icon.target_bounds, { x: 188, y: 120, width: 24, height: 20 });
  assert.deepEqual(icon.bounds, { x: 188, y: 120, width: 24, height: 20 });
  assert.deepEqual(icon.sprite_geometry, { type: "SIMPLE", size_mode: "RAW", content_size: null });
  assert.deepEqual(icon.center_alignment, { horizontal: { mode: "strict" }, vertical: { mode: "strict" } });
});

test("安全区和viewport定位根统一使用canvas", () => {
  const input = [
    node("icon", { x: 10, y: 10, width: 20, height: 20 }, {
      parent: "safe-area", reference: "viewport", alignment: { horizontal: "center", vertical: "center" },
    }),
  ];
  const rootCanvas = { x: 10, y: 20, width: 100, height: 80 };
  const result = resolveCenteredLayoutNodes(input, rootCanvas);
  assert.deepEqual(boundsOf(result, "icon"), {
    x: 50, y: 50, width: 20, height: 20,
  });
  assert.deepEqual(validateCenterAlignmentNodes(result, [], "layout_nodes", rootCanvas), []);
  assert.equal(validateCenterAlignmentNodes(result).length, 2);
  assert.throws(() => resolveCenteredLayoutNodes(input, null), /canvas/);
});

test("validator优先使用安全区快照，viewport仍使用canvas", () => {
  const safeSnapshot = { x: 20, y: 30, width: 40, height: 20 };
  const safeAreaInput = node("safe-align", { x: 0, y: 0, width: 20, height: 10 }, {
    parent: "safe-area", reference: "safe-area",
    alignment: { horizontal: "center", vertical: "center" },
    extra: { reference_target_bounds: safeSnapshot, parent_target_bounds: safeSnapshot },
  });
  const safeAreaResolved = resolveCenteredLayoutNodes([safeAreaInput], canvas);
  assert.deepEqual(boundsOf(safeAreaResolved, "safe-align"), { x: 30, y: 35, width: 20, height: 10 });
  assert.deepEqual(validateCenterAlignmentNodes(safeAreaResolved, [], "layout_nodes", canvas), []);

  const safeAreaNode = node("safe-icon", { x: 30, y: 35, width: 20, height: 10 }, {
    parent: "safe-area", reference: "safe-area",
    alignment: { horizontal: "center", vertical: "center" },
    extra: { reference_target_bounds: safeSnapshot, parent_target_bounds: safeSnapshot },
  });
  assert.deepEqual(validateCenterAlignmentNodes([safeAreaNode], [], "layout_nodes", canvas), []);

  const safeCanvasFallback = node("safe-fallback", { x: 40, y: 40, width: 20, height: 20 }, {
    parent: "safe-area", reference: "safe-area",
    alignment: { horizontal: "center", vertical: "center" },
  });
  assert.deepEqual(validateCenterAlignmentNodes([safeCanvasFallback], [], "layout_nodes", { width: 100, height: 100 }), []);

  const viewportNode = node("viewport-icon", { x: 240, y: 190, width: 20, height: 20 }, {
    parent: "viewport", reference: "viewport",
    alignment: { horizontal: "center", vertical: "center" },
    extra: { reference_target_bounds: { x: 20, y: 30, width: 40, height: 20 } },
  });
  assert(validateCenterAlignmentNodes([viewportNode], [], "layout_nodes", canvas).some((message) => message.includes("viewport 根快照必须逐字段一致")));
});

test("validator检查跨虚拟组依赖单元形成的联合循环", () => {
  const nodes = [
    node("panel", { x: 0, y: 0, width: 200, height: 100 }),
    node("leader", { x: 50, y: 30, width: 20, height: 20 }, {
      parent: "panel", reference: "external",
      alignment: { horizontal: "center", vertical: "top" },
      center_alignment: { member_ids: ["leader", "member"] },
    }),
    node("member", { x: 75, y: 30, width: 20, height: 20 }, {
      parent: "panel", reference: "leader",
    }),
    node("external", { x: 125, y: 30, width: 20, height: 20 }, {
      parent: "panel", reference: "member",
    }),
  ];
  const errors = validateCenterAlignmentNodes(nodes);
  assert.match(errors.join("\n"), /组合循环/);
});

test("validator把非法节点转为诊断返回，不会抛出中断调用方校验", () => {
  const errors = [];
  assert.equal(validateCenterAlignmentNodes([{
    layout_node_id: "broken", parent_layout_node_id: "viewport", target_bounds: { x: 0, y: 0, width: 10, height: 10 },
  }], errors), errors);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /axis_alignment/);
});
