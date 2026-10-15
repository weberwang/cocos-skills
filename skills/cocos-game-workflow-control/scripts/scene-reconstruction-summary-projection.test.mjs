import assert from "node:assert/strict";
import test from "node:test";
import { validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";

/** 构造摘要差异测试使用的完整结构化验收上下文。 */
function createSummaryProjectionFixture(mode) {
  const regionIds = ["hud", "board"];
  const sceneManifest = {
    visual_validation: { mode },
    reference_target: { scene_ids: ["main"], state_ids: ["default"] },
    coverage_audit: { regions: regionIds.map((id) => ({ id })) },
    scene_reconstruction_contract: {
      predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { unit: "logical-px", value: 2 } } }],
      coverage_regions: regionIds.map((id) => ({ id, tolerance_reference: "layout-tolerance", approved_exception_ids: [] })),
    },
  };
  const results = regionIds.map((regionId) => {
    const width = regionId === "hud" ? 390 : 350;
    const height = regionId === "hud" ? 96 : 620;
    return {
      region_id: regionId,
      target_measurement: { width, height },
      candidate_measurement: { width, height },
      delta: 0,
      tolerance_reference: "layout-tolerance",
      result: "passed",
      evidence: [`${regionId}.json`],
    };
  });
  return {
    sceneManifest,
    fidelityCase: {
      id: "digest-projection-case",
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 2,
      locale: "zh-CN",
      seed: 42,
      input_trace: "trace.json",
      stable_frame: "frame:1",
      original_target_size: { width: 390, height: 844 },
      original_candidate_size: { width: 390, height: 844 },
      normalization_transform: { type: "identity", scale_x: 1, scale_y: 1 },
      normalized_comparison_canvas: { width: 390, height: 844 },
      normalization_equivalence: {
        viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true },
        dpr: { target: 2, candidate: 2, equivalent: true },
        logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true },
      },
      full_viewport_reference: "reference.png",
      full_viewport_candidate: "candidate.png",
      side_by_side_evidence: "side-by-side.png",
      overlay_evidence: "overlay.png",
      difference_evidence: "difference.png",
      tolerance_set: { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } },
      per_region_results: results,
      conclusion: "passed",
    },
  };
}

test("exact 与 usability 测量递归忽略摘要字段但保留可见性和文本事实", () => {
  for (const mode of ["exact", "usability"]) {
    const { sceneManifest, fidelityCase } = createSummaryProjectionFixture(mode);
    const measured = fidelityCase.per_region_results[0];
    measured.target_measurement.fileSha256 = `sha256:${"a".repeat(64)}`;
    measured.target_measurement.evidenceSha256 = `sha256:${"b".repeat(64)}`;
    measured.target_measurement.source_sha256 = `sha256:${"c".repeat(64)}`;
    measured.candidate_measurement.fileSha256 = { malformed: true };
    measured.candidate_measurement.source_sha256 = 17;
    // 候选缺失 evidenceSha256 也不影响摘要外的测量事实验收。
    assert.deepEqual(validateStructuredFidelityCases([fidelityCase], sceneManifest, { stage: "V4" }), []);

    const semanticChange = structuredClone(fidelityCase);
    const target = semanticChange.per_region_results[0].target_measurement;
    const candidate = semanticChange.per_region_results[0].candidate_measurement;
    target.visible = true;
    candidate.visible = false;
    target.text = "PLAY";
    candidate.text = "PAUSE";
    const errors = validateStructuredFidelityCases([semanticChange], sceneManifest, { stage: "V4" });
    assert(errors.some((item) => item.includes("未解释差异")), `${mode}: ${errors.join("\n")}`);
  }
});
