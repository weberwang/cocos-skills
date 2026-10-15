import assert from "node:assert/strict";
import test from "node:test";
import { buildDecompositionElements } from "./decomposition-elements.mjs";
import { validateTechnicalRegionLayout } from "./validate_visual_layout_mapping.mjs";

const nineSlice = { mode: "stretch", reason: "面板角边固定", source_size: { width: 96, height: 64 }, borders: { left: 12, right: 12, top: 10, bottom: 10 } };

/** 原始区域保留用户事实，proposal 实际投影需携带派生上下文且仍接受逐字段比较。 */
function sourceRegion() {
  return {
    id: "button-region", scene_id: "main", state_id: "default", owner_type: "fixed-production-visual", layer: "hud",
    visual_route_analysis: { element_type: "button" }, bounds: { x: 0, y: 0, width: 100, height: 64 },
    decomposition_elements: [{
      element_id: "button-skin", element_type: "component", role: "button", bounds: { x: 4, y: 4, width: 60, height: 40 },
      parent_element_id: "viewport", component_id: "button", placement_id: "button-main", nine_slice: nineSlice,
      semantic_grouping: { kind: "standalone", rationale: "按钮底板独立显示" },
      ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
    }],
  };
}

test("技术拆解期望侧使用规范化投影，同时保留九宫格和派生上下文的逐字段校验", () => {
  const region = sourceRegion();
  const actual = buildDecompositionElements([region]);
  assert.equal(actual[0].nine_slice_decision_required, true);
  assert.equal(actual[0].owner_type, "fixed-production-visual");
  assert.equal(actual[0].region_layer, "hud");
  assert.equal(actual[0].visual_route_element_type, "button");

  const errors = [];
  validateTechnicalRegionLayout(region, { layout_node_ids: ["button-skin"], decomposition_elements: structuredClone(actual), placements: [] }, [], "region", errors);
  assert.deepEqual(errors, []);

  const drifted = structuredClone(actual);
  drifted[0].nine_slice.borders.left += 1;
  drifted[0].visual_route_element_type = "illustration";
  const driftErrors = [];
  validateTechnicalRegionLayout(region, { layout_node_ids: ["button-skin"], decomposition_elements: drifted, placements: [] }, [], "region", driftErrors);
  assert(driftErrors.some((message) => message.includes("decomposition_elements")));
});
