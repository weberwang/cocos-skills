import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveVisualValidationMode,
  validateVisualValidationPolicy,
  visualBoundsOutsideViewport,
} from "./visual-validation-policy.mjs";
import { validateLayoutGeometryFacts } from "./scene-layout-decomposition-contract.mjs";
import { validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
import { evaluateMatrixCoverage } from "../../cocos-game-qa-performance/scripts/responsive-visual-validation.mjs";

const SHA = "sha256:" + "a".repeat(64);
const CANDIDATE_SHA = "sha256:" + "b".repeat(64);

/** 创建只包含 fidelity 必要身份和代表性证据的测试夹具。 */
function fidelityFixture(candidateBounds = { x: 0, y: 0, width: 100, height: 100 }) {
  const manifest = {
    reference_target: { target_sha256: SHA, scene_ids: ["scene"], state_ids: ["default"], original_pixel_size: { width: 100, height: 100 } },
    candidate_identity: { sha256: CANDIDATE_SHA, diff_fingerprint: "diff-1" },
    scene_reconstruction_contract: { coverage_regions: [{ id: "region", required: true }] },
  };
  const item = {
    target_identity: { sha256: SHA },
    candidate_identity: { sha256: CANDIDATE_SHA, diff_fingerprint: "diff-1" },
    scene_id: "scene",
    state_id: "default",
    viewport: { width: 100, height: 100 },
    dpr: 1,
    locale: "zh-CN",
    random_seed: 1,
    input_trace: "stable",
    animation_sample: "stable-frame",
    original_target_size: { width: 100, height: 100 },
    original_candidate_size: { width: 100, height: 100 },
    normalization_transform: { type: "identity", scale_x: 1 },
    full_viewport_reference: "reference.png",
    full_viewport_candidate: "candidate.png",
    per_region_results: [{
      region_id: "region",
      target_measurement: { x: 0, y: 0, width: 100, height: 100 },
      candidate_measurement: candidateBounds,
      result: "passed",
      evidence: "candidate.png",
    }],
    conclusion: "passed",
  };
  return { manifest, item };
}

test("视觉验收默认 usability，效果图适用性不自动进入 exact", () => {
  assert.equal(resolveVisualValidationMode({ effect_image_reconstruction: { applicability: "effect-image" } }), "usability");
  assert.equal(resolveVisualValidationMode({ visual_validation: { mode: "exact" } }), "exact");
  const errors = [];
  validateVisualValidationPolicy(errors, "visual_validation", { visual_validation: { mode: "exact" } }, { visual_validation: { mode: "usability" } });
  assert.equal(errors.length, 1);
});

test("usability 允许视口内的位置和大小差异，越界仍失败", () => {
  const inside = fidelityFixture({ x: 0, y: 0, width: 40, height: 40 });
  assert.deepEqual(validateStructuredFidelityCases([inside.item], inside.manifest, { stage: "V4" }), []);
  const outside = fidelityFixture({ x: 70, y: 0, width: 40, height: 40 });
  assert.ok(validateStructuredFidelityCases([outside.item], outside.manifest, { stage: "V4" }).some((error) => error.includes("越界")));
});

test("exact 必须提供精确差异材料且覆盖全部矩阵", () => {
  const fixture = fidelityFixture({ x: 0, y: 0, width: 40, height: 40 });
  fixture.manifest.visual_validation = { mode: "exact" };
  const errors = validateStructuredFidelityCases([fixture.item], fixture.manifest, { stage: "V4" });
  assert.ok(errors.some((error) => error.includes("normalization_equivalence")));
  assert.ok(errors.some((error) => error.includes("tolerance")));
  const matrix = evaluateMatrixCoverage(
    [{ name: "phone", viewportRect: { x: 0, y: 0, width: 390, height: 844 }, scaling: { physical: { dpr: 1 } } }],
    { viewports: [{ name: "phone", width: 390, height: 844 }, { name: "tablet", width: 768, height: 1024 }] },
  );
  assert.equal(matrix.status, "pass");
  assert.equal(evaluateMatrixCoverage(
    [{ name: "phone", viewportRect: { x: 0, y: 0, width: 390, height: 844 }, scaling: { physical: { dpr: 1 } } }],
    { visual_validation: { mode: "exact" }, viewports: [{ name: "phone", width: 390, height: 844 }, { name: "tablet", width: 768, height: 1024 }] },
  ).status, "decision_gap");
});

test("usability 至少保留关键布局节点的实际测量", () => {
  const node = (id, critical = false) => ({ layout_node_id: id, region_id: "region", target_bounds: { x: 0, y: 0, width: 40, height: 40 }, critical });
  const layoutInfo = { nodes: [node("critical", true), node("secondary")], nodeById: new Map([["critical", node("critical", true)], ["secondary", node("secondary")]]) };
  const contract = { target_conditions: { viewport: { width: 100, height: 100 } }, coverage_regions: [{ id: "region" }] };
  const errors = [];
  validateLayoutGeometryFacts(contract, { layout_geometry: { node_measurements: [{ layout_node_id: "secondary", target_bounds: { x: 0, y: 0, width: 40, height: 40 }, actual_bounds: { x: 0, y: 0, width: 40, height: 40 }, result: "passed", evidence: "layout.png" }] } }, "V4", errors, layoutInfo, { visual_validation: { mode: "usability" } });
  assert.ok(errors.some((error) => error.includes("关键 layout node")));
});

test("视口越界只阻断关键内容；cover 出血和轻微取整误差可用", () => {
  const viewport = { width: 100, height: 100 };
  assert.equal(visualBoundsOutsideViewport({ x: -1, y: 0, width: 120, height: 100 }, viewport, { type: "background", clip_policy: "cover" }), false);
  assert.equal(visualBoundsOutsideViewport({ x: -0.5, y: 0, width: 40, height: 40 }, viewport, { semantic_role: "primary-action", interactive: true }), false);
  assert.equal(visualBoundsOutsideViewport({ x: -20, y: 0, width: 40, height: 40 }, viewport, { type: "button", interactive: true, clip_policy: "no-clipping" }), true);
  assert.equal(visualBoundsOutsideViewport({ x: -40, y: 0, width: 200, height: 100 }, viewport, { type: "background", interactive: false, clip_policy: "no-clipping" }), false);
  assert.equal(visualBoundsOutsideViewport({ x: -200, y: 0, width: 40, height: 40 }, viewport, { semantic_role: "primary-action", interactive: true }), true);
  assert.equal(visualBoundsOutsideViewport({ x: -20, y: 0, width: 40, height: 40 }, viewport, { semantic_role: "scroll-item", interactive: true, clip_policy: "scroll" }), false);
});

test("可用性负向事实不能由 approved exception 或 PASS 结果掩盖", () => {
  const fixture = fidelityFixture();
  fixture.manifest.scene_reconstruction_contract.coverage_regions[0].approved_exception_ids = ["known-visual-change"];
  const result = fixture.item.per_region_results[0];
  result.target_measurement = { bounds: { x: 0, y: 0, width: 40, height: 40 }, readable: true, occluded: false };
  result.candidate_measurement = { bounds: { x: 0, y: 0, width: 40, height: 40 }, readable: false, occluded: true };
  result.exception_ids = ["known-visual-change"];
  const errors = validateStructuredFidelityCases([fixture.item], fixture.manifest, { stage: "V4" });
  assert.ok(errors.some((error) => error.includes("可用性负向事实")));

  result.target_measurement = "readable";
  result.candidate_measurement = "unreadable";
  delete result.exception_ids;
  assert.ok(validateStructuredFidelityCases([fixture.item], fixture.manifest, { stage: "V4" }).some((error) => error.includes("可用性负向事实")));
});
