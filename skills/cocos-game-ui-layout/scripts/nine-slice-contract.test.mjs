import assert from "node:assert/strict";
import test from "node:test";
import { equalNineSliceContracts, isNineSliceStretch, isNineSliceStretchTargetAllowed, requiresNineSliceDecision, validateNineSliceContract, validateNineSliceTargetBounds } from "./nine-slice-contract.mjs";

const panel = {
  mode: "stretch",
  reason: "边角描边需要保持原尺寸，中心底色可拉伸",
  source_size: { width: 96, height: 64 },
  borders: { left: 12, right: 12, top: 10, bottom: 10 },
};

test("九宫格决策严格保留源图尺寸和边界，not-applicable必须说明原因", () => {
  assert.deepEqual(validateNineSliceContract(panel), panel);
  assert.equal(isNineSliceStretch(validateNineSliceContract(panel)), true);
  assert.deepEqual(validateNineSliceContract({ mode: "not-applicable", reason: "元素是不可拉伸的角色头像" }), {
    mode: "not-applicable", reason: "元素是不可拉伸的角色头像",
  });
  assert.throws(() => validateNineSliceContract({ mode: "not-applicable", reason: "  " }), /reason/);
});

test("九宫格拒绝无中心区、非整数切片和未声明的隐式裁切字段", () => {
  for (const invalid of [
    { ...panel, source_size: { width: 24, height: 64 } },
    { ...panel, borders: { ...panel.borders, left: -1 } },
    { ...panel, borders: { ...panel.borders, top: 10.5 } },
    { ...panel, borders: { ...panel.borders, top: 0, bottom: 0 } },
    { ...panel, crop: { x: 0, y: 0 } },
    { ...panel, borders: { ...panel.borders, right: 84 } },
  ]) assert.throws(() => validateNineSliceContract(invalid));
});

test("是否必评估由固定生产叶子图片的显式职责派生，不猜名称或纹理", () => {
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "button-skin" }), true);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "background-frame" }), true);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "illustration", visual_route_analysis: { element_type: "panel-frame" } }), true);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "illustration" }), false);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "panel", safe_area_policy: "FULL_BLEED" }), true);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "background", visual_route_analysis: { element_type: "panel-frame" } }), true);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "full-bleed", safe_area_policy: "FULL_BLEED", visual_route_analysis: { element_type: "button-skin" } }), true);
  assert.equal(requiresNineSliceDecision({ owner_type: "runtime-rendered", element_type: "component", role: "button" }), false);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "container", role: "button" }), false);
  assert.equal(requiresNineSliceDecision({ owner_type: "fixed-production-visual", element_type: "component", role: "panel", layer: "background" }), false);
});

test("九宫格拉伸只排除权威背景和结构容器，不用职责子串或FULL_BLEED误伤皮肤", () => {
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "component", role: "background-frame", region_layer: "hud" }), true);
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "component", role: "background-frame", layer: "background" }), false);
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "component", role: "background", layer: "hud" }), false);
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "component", role: "container", layer: "hud" }), false);
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "container", role: "panel-frame", layer: "hud" }), false);
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "component", role: "background-frame", safe_area_policy: "FULL_BLEED" }), true);
  assert.equal(isNineSliceStretchTargetAllowed({ element_type: "component", role: "background", visual_route_analysis: { element_type: "panel" } }), true);
});

test("300×180目标保留边角逻辑尺寸且留有中心，过小目标被拒绝", () => {
  const target = validateNineSliceTargetBounds(panel, { x: 0, y: 0, width: 300, height: 180 });
  assert.deepEqual(target.borders, panel.borders);
  assert.throws(() => validateNineSliceTargetBounds(panel, { x: 0, y: 0, width: 24, height: 80 }), /大于/);
  assert.throws(() => validateNineSliceTargetBounds(panel, { x: 0, y: 0, width: 80, height: 20 }), /大于/);
});

test("决策比较保留正反选择差异", () => {
  assert.equal(equalNineSliceContracts(panel, structuredClone(panel)), true);
  assert.equal(equalNineSliceContracts(panel, { mode: "not-applicable", reason: "不同用途" }), false);
  assert.equal(equalNineSliceContracts(undefined, { mode: "not-applicable", reason: "未选" }), false);
});
