import assert from "node:assert/strict";
import test from "node:test";
import { allowsVisualOverflow, normalizeUiLayout, positionReferenceId, validateUiLayout, validateUiPositionReferences } from "./ui-layout-organization.mjs";

/** 构造最小规范节点，供定位参照合同验证复用。 */
function node(elementId, parentId, uiLayout = {}) {
  return { element_id: elementId, parent_element_id: parentId, scene_id: "main", state_id: "default", coordinate_space: "viewport", role: "icon", ui_layout: { grouping_basis: ["LAYOUT"], ...uiLayout } };
}

test("归一化复制定位与视觉溢出声明，定位参照默认回落到父级", () => {
  const source = { grouping_basis: ["POSITION"], position_reference_id: "button", visual_overflow: { reason: "角标叠加" } };
  const normalized = normalizeUiLayout(source);
  assert.equal(normalized.position_reference_id, "button");
  assert.equal(positionReferenceId({ ui_layout: normalized }, "container"), "button");
  assert.equal(positionReferenceId({ ui_layout: {} }, "container"), "container");
  assert.notStrictEqual(normalized.visual_overflow, source.visual_overflow);
  assert.equal(allowsVisualOverflow(normalized), true);
  source.visual_overflow.reason = "修改源对象";
  assert.equal(normalized.visual_overflow.reason, "角标叠加");
});

test("拒绝空定位 ID、无效溢出理由、视觉溢出额外键和未知布局字段", () => {
  const base = { grouping_basis: ["LAYOUT"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" };
  for (const [uiLayout, expected] of [
    [{ position_reference_id: " " }, "position_reference_id 必须"],
    [{ visual_overflow: { reason: " " } }, "visual_overflow"],
    [{ visual_overflow: { reason: "角标", ignored: true } }, "visual_overflow"],
    [{ unknown_field: true }, "unknown_field"],
  ]) {
    const errors = [];
    validateUiLayout({ ...base, ...uiLayout }, { parentId: "container" }, errors);
    assert(errors.some((message) => message.includes(expected)), `${JSON.stringify(uiLayout)}: ${errors.join("；")}`);
  }
  assert.equal(allowsVisualOverflow({ visual_overflow: { reason: "角标", extra: true } }), false);
  assert.equal(allowsVisualOverflow({ visual_overflow: { reason: " " } }), false);
});

test("不同定位对象必须声明 POSITION，且只允许同级、祖先或稳定根", () => {
  const elements = [node("container", "viewport"), node("first", "container", { position_reference_id: "second" }), node("second", "container")];
  const missingBasisErrors = [];
  validateUiPositionReferences(elements, missingBasisErrors, "nodes");
  assert(missingBasisErrors.some((message) => message.includes("grouping_basis") && message.includes("POSITION")));

  elements[1].ui_layout.grouping_basis = ["POSITION"];
  const validSiblingErrors = [];
  validateUiPositionReferences(elements, validSiblingErrors, "nodes");
  assert.deepEqual(validSiblingErrors, []);

  elements[1].ui_layout.position_reference_id = "viewport";
  const stableRootErrors = [];
  validateUiPositionReferences(elements, stableRootErrors, "nodes");
  assert.deepEqual(stableRootErrors, []);

  elements[1].ui_layout.position_reference_id = "unrelated";
  const unrelatedErrors = [];
  validateUiPositionReferences(elements, unrelatedErrors, "nodes");
  assert(unrelatedErrors.some((message) => message.includes("position_reference_id") && message.includes("未引用")));
});
