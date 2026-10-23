import assert from "node:assert/strict";
import test from "node:test";
import { hasSpriteRendering, isBackgroundDisplayNode, isLayoutContainer, isSpriteContainer, validateDisplayNodeRole } from "./display-node-role.mjs";

test("布局容器识别结构字段与现有角色写法", () => {
  for (const node of [
    { element_type: "container" },
    { elementType: "container" },
    { is_container: true },
    { isContainer: true },
    { layout_role: "empty_container" },
    { role: "layout container" },
    { container: true },
  ]) assert.equal(isLayoutContainer(node), true);
  for (const node of [{ is_container: "container" }, { isContainer: "group" }, { container: "parent" }]) {
    assert.equal(isLayoutContainer(node), false);
  }
  assert.equal(isLayoutContainer({ element_type: "component", role: "panel-frame" }), false);
});

test("纯结构容器不因图片计划草案变成Sprite，显式底板可兼任容器", () => {
  const structure = { element_type: "container", owner_type: "fixed-production-visual", nine_slice: { mode: "stretch" }, sprite_geometry: {} };
  assert.equal(hasSpriteRendering(structure), false);
  assert.equal(isSpriteContainer(structure), false);

  const baseboard = { element_type: "container", render_kind: "sprite", owner_type: "fixed-production-visual" };
  assert.equal(hasSpriteRendering(baseboard), true);
  assert.equal(isSpriteContainer(baseboard), true);
});

test("Sprite底板拒绝非法标签、错误归属和权威背景身份", () => {
  for (const render_kind of ["none", "canvas", "Sprite", null]) {
    assert.match(validateDisplayNodeRole({ element_type: "component", render_kind })[0], /只支持 sprite/);
  }
  assert.match(validateDisplayNodeRole({ element_type: "container", render_kind: "sprite", owner_type: "runtime-rendered" })[0], /fixed-production-visual/);
  assert.match(validateDisplayNodeRole({ element_type: "container", render_kind: "sprite", owner_type: "fixed-production-visual", region_layer: "background", visual_route_element_type: "panel-frame" })[0], /权威 background/);
  assert.match(validateDisplayNodeRole({ element_type: "container", render_kind: "sprite", role: "background" })[0], /纯 background/);
  assert.deepEqual(validateDisplayNodeRole({ element_type: "container", render_kind: "sprite", role: "background", visual_route_element_type: "panel-frame" }), []);
});

test("背景身份由统一谓词判断，权威图层不受皮肤路线覆盖", () => {
  assert.equal(isBackgroundDisplayNode({ region_layer: "background", visual_route_element_type: "panel-frame" }), true);
  assert.equal(isBackgroundDisplayNode({ role: "background" }), true);
  assert.equal(isBackgroundDisplayNode({ role: "full_bleed", visual_route_element_type: "panel-frame" }), false);
  assert.equal(isBackgroundDisplayNode({ role: "background", visual_route_element_type: "panel-frame" }), false);
  assert.equal(isBackgroundDisplayNode({ role: "panel-frame", visual_route_element_type: "background" }), false);
  assert.equal(isBackgroundDisplayNode({ visual_route_element_type: "background" }), true);
  assert.equal(isBackgroundDisplayNode({ role: "panel-frame" }), false);
});

test("固定图片皮肤容器必须显式声明Sprite身份，通用容器可继续保持纯结构", () => {
  for (const node of [
    { element_type: "container", owner_type: "fixed-production-visual", role: "panel" },
    { element_type: "container", owner_type: "fixed-production-visual", layout_role: "button-skin" },
  ]) assert.match(validateDisplayNodeRole(node)[0], /必须显式声明为 sprite/);

  assert.deepEqual(validateDisplayNodeRole({
    element_type: "container", owner_type: "fixed-production-visual", role: "container",
    visual_route_element_type: "panel-frame",
  }), []);
});

test("容器缺省所有者由主入口校验，显式Sprite仍建立渲染身份", () => {
  const errors = validateDisplayNodeRole({ element_type: "container", render_kind: "sprite", role: "panel-frame" });
  assert.deepEqual(errors, []);
  assert.equal(isSpriteContainer({ element_type: "container", render_kind: "sprite" }), true);
});
