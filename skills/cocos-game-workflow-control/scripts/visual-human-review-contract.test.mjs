import assert from "node:assert/strict";
import test from "node:test";
import { validateHumanReview, validateVisualHumanApproval, validateVisualPostApprovalReviewFields } from "./visual-human-review-contract.mjs";
import { validateVisualF2MachineGate } from "./visual-production-contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造旧式 V2 人工审批，用于验证迁移后入口会 fail closed。 */
function approval(overrides = {}) {
  return { review_id: "v2-approval", reviewed_at: "2026-08-18T00:00:00Z", evidence: "evidence/v2-approval.json", evidence_sha256: SHA, status: "passed", target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1", baseline_sha256: SHA, ...overrides };
}

/** 构造确认前的结构化机器验证，明确不携带 reviewer 身份。 */
function machineReview() {
  return { status: "passed", evidence: "evidence/v2-machine.json", reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, full_viewport_comparison: "evidence/v2-full.png", per_region_review: [{ region_id: "main", result: "passed" }], composition_review: {}, geometry_review: {}, color_material_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {} };
}

test("AI reviewer 即使 PASS 也被通用人工审阅硬门拒绝", () => {
  const errors = validateHumanReview({ reviewer_type: "automation", reviewer_id: "robot", reviewed_at: "2026-08-18T00:00:00Z", evidence: "review.json", status: "passed" }, { stage: "V3" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("reviewer_type 必须为 human")));
});
test("旧式 V2 视觉人工审批入口已废弃", () => {
  const errors = validateVisualHumanApproval(approval(), { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("旧式视觉人工审批已移除")));
});

test("旧式审批即使带 reviewer 字段也不能作为拆解确认", () => {
  const errors = validateVisualHumanApproval(approval({ reviewer_type: "ai", reviewer_id: "agent-1" }), { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("旧式视觉人工审批已移除")));
});

test("拆解确认后禁止旧式方向审批字段", () => {
  const legacyKey = "visual_human_approval";
  const errors = validateVisualPostApprovalReviewFields({ v2_structured_review: machineReview(), [legacyKey]: approval() }, { stage: "V2" });
  assert(errors.some((value) => value.includes(legacyKey)));
});

test("确认前 v2_structured_review 只允许机器事实", () => {
  assert.deepEqual(validateVisualPostApprovalReviewFields({ v2_structured_review: machineReview() }, { stage: "V2" }), []);
  const errors = validateVisualPostApprovalReviewFields({ v2_structured_review: { ...machineReview(), reviewer_id: "human-1" } }, { stage: "V2" });
  assert(errors.some((value) => value.includes("reviewer_id")));
});

test("拆解确认后没有重复复核工件即可通过机器字段门", () => {
  const manifest = { candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, fidelity_cases: [{ candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" } }] };
  assert.deepEqual(validateVisualPostApprovalReviewFields(manifest, { stage: "V3" }), []);
});

test("post-approval 重复复核工件和 reviewer 字段明确拒绝", () => {
  for (const key of ["f2_review", "f2_reviews", "visual_fidelity_review", "production_contract_review", "component_reviews", "reviewer", "reviewer_type", "reviewer_id", "review_id", "reviewed_at", "human_review"]) {
    const errors = validateVisualPostApprovalReviewFields({ [key]: key === "reviewer" ? "qa" : {} }, { stage: "V3" });
    assert(errors.some((value) => value.includes(key)), `${key} 应被拒绝`);
  }
});

test("缺失或身份漂移的旧式 V2 审批仍失败", () => {
  assert(validateVisualHumanApproval(null, { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true }).length > 0);
  const errors = validateVisualHumanApproval(approval({ candidate_sha256: `sha256:${"b".repeat(64)}` }), { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("旧式视觉人工审批已移除")));
});

test("V3/V4 候选 SHA 正常演进不触发第二次人工确认", () => {
  const manifest = { candidate_identity: { sha256: `sha256:${"c".repeat(64)}`, diff_fingerprint: "runtime-diff-v4" } };
  assert.deepEqual(validateVisualPostApprovalReviewFields(manifest, { stage: "V3" }), []);
});

test("视觉 F2 只接受 MACHINE 确定性事实，非 reviewer 机器门可通过", () => {
  assert.deepEqual(validateVisualF2MachineGate({ status: "passed", validationMode: "MACHINE", baselineHash: SHA, diffFingerprint: "diff-1" }, { stage: "F2" }, { identity: { baseline: SHA, diff: "diff-1" } }), []);
  const errors = validateVisualF2MachineGate({ status: "passed", validationMode: "MACHINE", baselineHash: SHA, diffFingerprint: "diff-1", reviewer: "qa" }, { stage: "F2" }, { identity: { baseline: SHA, diff: "diff-1" } });
  assert(errors.some((value) => value.includes("reviewer")));
});
