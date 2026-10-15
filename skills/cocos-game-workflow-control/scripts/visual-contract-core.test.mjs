import assert from "node:assert/strict";
import test from "node:test";
import {
  VISUAL_DELIVERY_KINDS,
  VISUAL_FIXED_IMAGE_METHODS,
  VISUAL_PRODUCTION_METHODS,
  VISUAL_PRODUCTION_ORIGINS,
  VISUAL_PROGRAM_METHODS,
  VISUAL_REMEDIATION,
  VISUAL_REMEDIATION_LABEL,
  VISUAL_REMEDIATION_NEXT_ACTION,
  VISUAL_ROOT_CAUSES,
  VISUAL_SUBSTITUTION_POLICIES,
  canonicalJson,
  deriveVisualDisposition,
  deriveVisualRootCause,
  deriveVisualReturnStage,
  earliestVisualReturnStage,
  isPlainObject,
  isSha256,
  nonEmptyString,
  normalizeContractPath,
  sha256Bytes,
  sha256Text,
} from "./visual-contract-core.mjs";

test("共享基础谓词与规范化路径保持确定性", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(nonEmptyString("  visual  "), true);
  assert.equal(nonEmptyString("  "), false);
  assert.equal(normalizeContractPath("PUBLIC\\./Foo.PNG"), "public/foo.png");
  assert.equal(normalizeContractPath("./PUBLIC//Foo.PNG", { secure: false }), "public/foo.png");
  assert.equal(normalizeContractPath("../outside.png"), null);
  assert.equal(normalizeContractPath("C:/outside.png"), null);
  assert.equal(normalizeContractPath("public/CON.txt"), null);
});

test("共享 SHA 与规范化 JSON 对输入顺序保持稳定", () => {
  const expected = "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(sha256Text("abc"), expected);
  assert.equal(sha256Bytes(Buffer.from("abc")), expected);
  assert.equal(isSha256(expected), true);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("视觉生产词汇表由共享核心集中维护", () => {
  assert.deepEqual([...VISUAL_PRODUCTION_ORIGINS], ["bitmap-decomposition", "independent-production"]);
  assert.deepEqual([...VISUAL_PRODUCTION_METHODS], ["image-generation", "authored-raster", "authored-svg", "cocos-graphics", "runtime-program", "reuse"]);
  assert.deepEqual([...VISUAL_DELIVERY_KINDS], ["raster-image", "vector-image", "runtime-drawing", "runtime-program", "existing-asset"]);
  assert.deepEqual([...VISUAL_SUBSTITUTION_POLICIES], ["forbid", "user-change-request-only"]);
  assert.deepEqual([...VISUAL_FIXED_IMAGE_METHODS], ["image-generation", "authored-raster", "reuse"]);
  assert.deepEqual([...VISUAL_PROGRAM_METHODS], ["cocos-graphics", "runtime-program"]);
});

test("视觉阶段、根因和处置映射保持稳定", () => {
  assert.equal(deriveVisualReturnStage("V2"), "V1/PROPOSAL");
  assert.equal(deriveVisualReturnStage("V4", { validationStages: ["V4"] }), "VALIDATING");
  assert.equal(deriveVisualReturnStage("V4"), "V4");
  assert.equal(deriveVisualRootCause("V1", "V1/PROPOSAL"), VISUAL_ROOT_CAUSES.PLAN_MISSING);
  assert.equal(deriveVisualRootCause("V4", "V4"), VISUAL_ROOT_CAUSES.ACCEPTANCE);
  assert.equal(deriveVisualRootCause("V4", "VALIDATING", { acceptanceStages: ["V4", "VALIDATING"] }), VISUAL_ROOT_CAUSES.ACCEPTANCE);
  assert.equal(deriveVisualDisposition({}), VISUAL_REMEDIATION.REPAIR);
  assert.equal(deriveVisualDisposition({ missingEvidence: ["机器验证结果缺失"] }), VISUAL_REMEDIATION.REVALIDATE);
  assert.equal(deriveVisualDisposition({ identityChanges: ["V2 target identity"] }), VISUAL_REMEDIATION.RETURN);
  assert.equal(deriveVisualDisposition({ changed: ["V2PlanCandidateHash"] }), VISUAL_REMEDIATION.RETURN);
  assert.equal(earliestVisualReturnStage(["V4 evidence", "V3 layout"]), "V3");
  assert.equal(earliestVisualReturnStage([], "V4"), "V4");
  assert.equal(VISUAL_REMEDIATION_LABEL.repair, "REPAIR_REQUIRED");
  assert.equal(VISUAL_REMEDIATION_NEXT_ACTION.return.includes("最早受影响阶段"), true);
});
