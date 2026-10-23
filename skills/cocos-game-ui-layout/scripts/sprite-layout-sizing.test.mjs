import assert from "node:assert/strict";
import test from "node:test";
import { deriveSpriteGeometry, validateSpriteGeometry } from "./sprite-layout-sizing.mjs";

const NINE_SLICE = { mode: "stretch", reason: "固定角边与可延展中区", source_size: { width: 32, height: 32 }, borders: { left: 4, right: 4, top: 4, bottom: 4 } };

test("普通图片RAW无目标宽高，仅九宫格CUSTOM使用自身目标尺寸", () => {
  const node = { element_type: "component", owner_type: "fixed-production-visual", target_bounds: { x: 0, y: 0, width: 300, height: 180 }, ui_layout: { size_policy: "FIXED" } };
  assert.deepEqual(deriveSpriteGeometry(node), { type: "SIMPLE", size_mode: "RAW", content_size: null });
  node.nine_slice = NINE_SLICE;
  assert.deepEqual(deriveSpriteGeometry(node), { type: "SLICED", size_mode: "CUSTOM", content_size: { width: 300, height: 180 } });
  node.sprite_geometry = deriveSpriteGeometry(node);
  assert.deepEqual(validateSpriteGeometry(node), []);
  node.sprite_geometry.content_size.width = 320;
  assert.equal(validateSpriteGeometry(node).length, 1);
});

test("纯结构容器与文字不生成图片尺寸计划，普通图片拒绝拉伸尺寸策略", () => {
  assert.equal(deriveSpriteGeometry({ element_type: "container", owner_type: "fixed-production-visual" }), null);
  assert.equal(deriveSpriteGeometry({ element_type: "component", owner_type: "runtime-data" }), null);
  for (const size_policy of ["STRETCH", "FLEX"]) {
    assert.throws(() => deriveSpriteGeometry({ owner_type: "fixed-production-visual", ui_layout: { size_policy } }), /RAW/);
  }
  const errors = validateSpriteGeometry({ element_type: "container", sprite_geometry: { type: "SIMPLE", size_mode: "RAW", content_size: { width: 50, height: 50 } } });
  assert.equal(errors.length, 1);
});

test("Sprite底板可兼任父容器，RAW尺寸独立于父子布局范围", () => {
  const baseboard = {
    element_type: "container",
    render_kind: "sprite",
    owner_type: "fixed-production-visual",
    role: "panel-frame",
    target_bounds: { x: 0, y: 0, width: 300, height: 180 },
    ui_layout: { size_policy: "FIXED" },
    child_layout_node_ids: ["icon", "label"],
  };
  assert.deepEqual(deriveSpriteGeometry(baseboard), { type: "SIMPLE", size_mode: "RAW", content_size: null });
  for (const size_policy of ["STRETCH", "FLEX"]) {
    assert.throws(() => deriveSpriteGeometry({ ...baseboard, ui_layout: { size_policy } }), /RAW/);
  }

  const slicedBaseboard = { ...baseboard, nine_slice: NINE_SLICE };
  assert.deepEqual(deriveSpriteGeometry(slicedBaseboard), {
    type: "SLICED", size_mode: "CUSTOM", content_size: { width: 300, height: 180 },
  });
  slicedBaseboard.sprite_geometry = deriveSpriteGeometry(slicedBaseboard);
  assert.deepEqual(validateSpriteGeometry(slicedBaseboard), []);
});

test("结构容器不能用九宫格或尺寸草案伪造图片身份", () => {
  const structure = { element_type: "container", role: "panel-frame", target_bounds: { x: 0, y: 0, width: 80, height: 60 } };
  assert.equal(deriveSpriteGeometry(structure), null);
  assert.throws(() => deriveSpriteGeometry({ ...structure, nine_slice: NINE_SLICE }), /纯结构容器/);
  const diagnostics = validateSpriteGeometry({ ...structure, sprite_geometry: { type: "SIMPLE", size_mode: "RAW", content_size: null } });
  assert.equal(diagnostics.length, 1);
  const invalidTagDiagnostics = validateSpriteGeometry({ element_type: "container", render_kind: "none" });
  assert.equal(invalidTagDiagnostics.length, 1);
  assert.match(invalidTagDiagnostics[0], /只支持 sprite/);
});

test("九点停靠不改变RAW与九宫格尺寸路线", () => {
  const alignments = ["left", "center", "right"].flatMap((horizontal) => ["top", "center", "bottom"].map((vertical) => ({ horizontal, vertical })));
  for (const axis_alignment of alignments) {
    const baseboard = { element_type: "container", render_kind: "sprite", owner_type: "fixed-production-visual", role: "panel-frame", axis_alignment, target_bounds: { x: 0, y: 0, width: 120, height: 90 } };
    assert.deepEqual(deriveSpriteGeometry(baseboard), { type: "SIMPLE", size_mode: "RAW", content_size: null });
    assert.deepEqual(deriveSpriteGeometry({ ...baseboard, nine_slice: NINE_SLICE }), {
      type: "SLICED", size_mode: "CUSTOM", content_size: { width: 120, height: 90 },
    });
  }
});

test("不能伪造无切片合同的九宫格来取得CUSTOM尺寸权限", () => {
  const node = { element_type: "component", owner_type: "fixed-production-visual", target_bounds: { x: 0, y: 0, width: 80, height: 60 } };
  assert.throws(() => deriveSpriteGeometry({ ...node, nine_slice: { mode: "stretch" } }));
  assert.throws(() => deriveSpriteGeometry({ ...node, role: "background", nine_slice: NINE_SLICE }), /非背景/);
  assert.throws(() => deriveSpriteGeometry({ ...node, target_bounds: { width: 7, height: 7 }, nine_slice: NINE_SLICE }));
});
