import assert from "node:assert/strict";
import test from "node:test";
import {
  RETURN_CORE_INVALIDATED_ARTIFACTS,
  createReturnRecord,
  invalidateReturnArtifacts,
  normalizeAffectedScope,
  parseReturnRequest,
  validateReturnRecord,
  validateReturnResume,
} from "./return-disposition.mjs";
import { IMAGE_NORMALIZATION_OPERATION } from "./visual-image-normalization.mjs";
import { validateImageNormalizationContract } from "./visual-image-normalization-contract.mjs";

/** 构造最小但可验证的 Work Item RETURN 状态夹具。 */
function returnWork(overrides = {}) {
  return {
    workItemId: "WI-RETURN-1",
    globalState: "IMPLEMENTING",
    validationBatchId: "BATCH-OLD",
    approvalRecord: "APPROVAL-OLD",
    pendingApprovalStatus: "pending",
    pendingApprovalPresentedId: "PENDING-OLD",
    pendingApprovalPresentedAt: "2026-08-25T00:00:00.000Z",
    pendingVisualPrerequisiteSnapshot: { candidate: "sha256:old" },
    diffAuditRecord: "evidence/diff-audit.json",
    diffAuditLedgerRecord: "evidence/diff-ledger.json",
    implementationPackageRecord: "evidence/package.json",
    evidenceRoot: "evidence/WI-RETURN-1",
    visualStage: "V3",
    visualStageState: "in-progress",
    ...overrides,
  };
}

/** 构造受控裁切的纯合同夹具，第一、二次 attempt 可使用不同实际尺寸。 */
function cropFixture(attempts) {
  const record = {
    schema: "image-normalization/1",
    status: "passed",
    operation: "crop-and-resize-to-contract",
    source_file: "art/attempt-two.png",
    source_sha256: "sha256:" + "b".repeat(64),
    source_width: 1672,
    source_height: 941,
    target_width: 1920,
    target_height: 1080,
    output_file: "public/hero.png",
    output_sha256: "sha256:" + "a".repeat(64),
    output_width: 1920,
    output_height: 1080,
    preserve_alpha: true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-25T00:00:00.000Z",
    aspect_ratio_correction: {
      schema: "aspect-ratio-correction/1",
      status: "passed",
      trigger: "two-generation-attempts-mismatched",
      strategy: "controlled-crop",
      attempts,
      focus: { x: 0.5, y: 0.5 },
      crop_rect: { left: 4, top: 2, width: 1664, height: 936 },
    },
  };
  const asset = { source_file: record.source_file, output_file: record.output_file, runtime_outputs: [record.output_file], sha256: record.output_sha256, normalization_record: record };
  const generation = { source_file: record.source_file, output_file: record.output_file, normalization_record: record };
  return {
    expectedAsset: { asset_id: "hero", source_file: record.source_file, runtime_file: record.output_file, mime_type: "image/png", width: 1920, height: 1080, alpha: true },
    asset,
    generation,
    contract: { production_method: "image-generation", image_generation_required: true },
    metadata: { file: record.output_file, mime_type: "image/png", width: 1920, height: 1080, alpha: true, sha256: record.output_sha256 },
  };
}

const validAttemptOne = { attempt_id: "ATTEMPT-1", generation_record_id: "GEN-1", generated_at: "2026-08-25T00:00:00.000Z", file: "art/attempt-one.png", sha256: "sha256:" + "c".repeat(64), width: 100, height: 60 };
const validAttemptTwo = { attempt_id: "ATTEMPT-2", generation_record_id: "GEN-2", generated_at: "2026-08-25T00:01:00.000Z", file: "art/attempt-two.png", sha256: "sha256:" + "b".repeat(64), width: 1672, height: 941 };

test("RETURN affectedScope 严格拒绝旧裸值、数字、重复、通配和未知前缀", () => {
  for (const scope of [["SHARED-1"], [123], ["stage:V2", "stage:V2"], ["unknown:V2"], ["scene:*"], ["artifact:"]]) {
    assert.equal(normalizeAffectedScope(scope).value, undefined);
    assert.match(normalizeAffectedScope(scope).error, /affectedScope/);
  }
  assert.deepEqual(normalizeAffectedScope(["stage:V2", "scene:HUD", "artifact:hero"]).value, ["stage:V2", "scene:HUD", "artifact:hero"]);
});

test("RETURN 由控制面推导恢复状态并实际清除旧审批与下游引用", () => {
  const work = returnWork();
  const record = createReturnRecord({ classification: "hard-gate-would-be-bypassed", reason: "旧候选不能绕过当前硬门", affectedScope: ["stage:V2"] }, work);
  assert.equal(record.returnState, "REVIEW");
  assert.deepEqual(record.invalidatedArtifacts.slice(0, RETURN_CORE_INVALIDATED_ARTIFACTS.length), [...RETURN_CORE_INVALIDATED_ARTIFACTS]);
  invalidateReturnArtifacts(work, record);
  assert.equal(work.approvalRecord, null);
  assert.equal(work.pendingApprovalStatus, "invalid");
  assert.equal(work.pendingApprovalPresentedId, null);
  assert.equal(work.pendingApprovalPresentedAt, null);
  assert.equal(work.pendingVisualPrerequisiteSnapshot, undefined);
  assert.equal(work.diffAuditRecord, undefined);
  assert.equal(work.implementationPackageRecord, undefined);
  assert.notEqual(work.validationBatchId, "BATCH-OLD");
  assert.equal(validateReturnResume({ ...work, globalState: "RETURN", returnRecord: record }, "PROPOSAL"), `RETURN 只能恢复到 returnRecord.returnState=${record.returnState}，不能迁移到 PROPOSAL`);
  assert.equal(validateReturnResume({ ...work, globalState: "RETURN", returnRecord: record }, "REVIEW"), null);
});

test("RETURN 到 IMPLEMENTING 保留 V2 视觉证据，不扩大失效范围", () => {
  const record = createReturnRecord({ classification: "hard-gate-would-be-bypassed", reason: "实施硬门需要重新验证", affectedScope: ["stage:V4"] }, returnWork({ visualStage: "V4" }));
  assert.equal(record.returnState, "IMPLEMENTING");
  assert.equal(record.invalidatedArtifacts.includes("visualStageEvidenceRefs"), false);
  assert.equal(record.invalidatedArtifacts.includes("visualHumanApproval"), false);
  assert.equal(record.invalidatedArtifacts.includes("implementationPackageRecord"), true);
});

test("普通候选变化不能作为回退理由，设计实变才允许返回受影响阶段", () => {
  const work = returnWork();
  const request = { 'return-classification': 'candidate-identity-changed', 'return-reason': '调整按钮边距', 'affected-scope': 'stage:V4' };
  assert.match(parseReturnRequest(request, work).error, /定向重验/);
  assert.throws(() => createReturnRecord({ classification: 'candidate-identity-changed', reason: '调整边距', affectedScope: ['stage:V4'] }, work), /classification/);
  const record = createReturnRecord({ classification: 'upstream-fact-invalidated', reason: '用户变更了已确认的布局结构', affectedScope: ['stage:V2'] }, work);
  assert.equal(record.returnState, 'REVIEW');
});

test("RETURN 拒绝把 Execution State 归档到项目外或仓库根", () => {
  for (const evidenceRoot of [".", "../outside"]) {
    const work = returnWork({ evidenceRoot });
    const record = createReturnRecord({ classification: "hard-gate-would-be-bypassed", reason: "实施状态需要失效", affectedScope: ["stage:V3"] }, work);
    assert.throws(() => invalidateReturnArtifacts(work, record, { projectRoot: process.cwd() }), /evidenceRoot/);
  }
});

test("RETURN 明确拒绝旧记录和自由指定 returnState", () => {
  const work = returnWork();
  assert.throws(() => createReturnRecord({ classification: "hard-gate-would-be-bypassed", reason: "x", affectedScope: ["stage:V2"], returnState: "BASELINE" }, work), /returnState/);
  assert.notEqual(validateReturnRecord({ classification: "hard-gate-would-be-bypassed", reason: "旧格式", affectedScope: ["stage:V2"], fromState: "IMPLEMENTING", toState: "RETURN", invalidatesDownstream: true, recordedAt: "2026-08-25T00:00:00.000Z", resolvedAt: null }), null);
});

test("纯合同允许不同路径的相同 SHA，并拒绝相同路径的 attempt", () => {
  const sameSha = cropFixture([validAttemptOne, { ...validAttemptTwo, sha256: validAttemptOne.sha256 }]);
  assert.deepEqual(validateImageNormalizationContract(sameSha), []);
  const samePath = cropFixture([validAttemptOne, { ...validAttemptTwo, file: validAttemptOne.file }]);
  assert(validateImageNormalizationContract(samePath).some((error) => error.includes("必须是不同的实际文件")));
  const differentDimensions = cropFixture([validAttemptOne, validAttemptTwo]);
  assert.deepEqual(validateImageNormalizationContract(differentDimensions), []);
});

test("CLI 与纯合同共享 crop 操作值且旧路径 attempt 结构不会被合同静默接受", () => {
  assert.equal(IMAGE_NORMALIZATION_OPERATION.cropAndResize, "crop-and-resize-to-contract");
  const legacy = cropFixture(["art/attempt-one.png", "art/attempt-two.png"]);
  assert(validateImageNormalizationContract(legacy).some((error) => error.includes("必须是对象") || error.includes("缺失")));
});
