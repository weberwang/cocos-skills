import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT,
  GLOBAL_VISUAL_BASELINE_DOCUMENT,
  GLOBAL_VISUAL_BASELINE_STATUS,
  buildGlobalVisualConsistencyPrompt,
  collectGlobalVisualConsistencyEvidencePaths,
  validateGlobalVisualGenerationRecord,
  validateVisualEffectImageOrigin,
} from "./global-visual-consistency-contract.mjs";

/** 生成测试用的确定性 SHA-256 身份。 */
const sha = (character) => `sha256:${character.repeat(64)}`;

/** 创建覆盖多个全局锚点的冻结基线，测试顺序和身份绑定。 */
function createBaseline() {
  return {
    id: "project-global-style",
    version: "2026.08",
    style_fingerprint: sha("f"),
    document: GLOBAL_VISUAL_BASELINE_DOCUMENT,
    status: GLOBAL_VISUAL_BASELINE_STATUS,
    anchor_evidence: [
      { path: "evidence/visual/global-anchor-main.png", sha256: sha("a") },
      { path: "evidence/visual/global-anchor-ui.png", sha256: sha("b") },
    ],
  };
}

/** 创建一条完整的 generated 记录，便于失败分支只替换一个身份字段。 */
function createRecord(baseline, overrides = {}) {
  const styleReferenceInputs = baseline.anchor_evidence.map(({ path, sha256 }) => ({ path, sha256 }));
  return {
    origin: "generated",
    visual_baseline_id: baseline.id,
    visual_baseline_version: baseline.version,
    style_fingerprint: baseline.style_fingerprint,
    baseline_document: baseline.document,
    style_reference_inputs: styleReferenceInputs,
    actual_style_reference_inputs: styleReferenceInputs,
    global_visual_consistency_prompt: CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT,
    style_drift_policy: "forbid",
    full_prompt: `忠实重建资产。${CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT}`,
    prompt_sent: true,
    target_sha256: sha("c"),
    output_sha256: sha("d"),
    consistency_status: "passed",
    consistency_evidence: { path: "evidence/visual/consistency.json", sha256: sha("e") },
    ...overrides,
  };
}

test("generated 记录绑定当前基线、全部锚点和实际提示词时通过", () => {
  const baseline = createBaseline();
  const errors = validateGlobalVisualGenerationRecord(createRecord(baseline), {
    label: "scene master",
    visual_baseline: baseline,
    target_sha256: sha("c"),
    output_sha256: sha("d"),
  });
  assert.deepEqual(errors, []);
});

test("generated 记录漏传或多传全局锚点时失败", () => {
  const baseline = createBaseline();
  const record = createRecord(baseline, {
    style_reference_inputs: [{ path: baseline.anchor_evidence[0].path, sha256: sha("a") }],
  });
  const errors = validateGlobalVisualGenerationRecord(record, { visual_baseline: baseline });
  assert.ok(errors.some((message) => message.includes("数量完全一致")));
  assert.ok(errors.some((message) => message.includes("原顺序逐项绑定")));
});

test("旧基线、提示词未实际发送或允许风格迁移时失败", () => {
  const baseline = createBaseline();
  const record = createRecord(baseline, {
    visual_baseline_version: "old",
    prompt_sent: false,
    style_drift_policy: "allow",
  });
  const errors = validateGlobalVisualGenerationRecord(record, { visual_baseline: baseline });
  assert.ok(errors.some((message) => message.includes("未绑定当前全局视觉基线")));
  assert.ok(errors.some((message) => message.includes("未证明完整提示词实际发送")));
  assert.ok(errors.some((message) => message.includes("style_drift_policy")));
});

test("generated 记录缺少实际发送标记时失败，但缺失或陈旧 SHA 不阻断", () => {
  const baseline = createBaseline();
  const promptMissing = validateGlobalVisualGenerationRecord(createRecord(baseline, { prompt_sent: undefined }), {
    visual_baseline: baseline,
    target_sha256: sha("c"),
  });
  assert.ok(promptMissing.some((message) => message.includes("未证明完整提示词实际发送")));
  const noSha = createRecord(baseline, {
    target_sha256: undefined,
    output_sha256: "not-a-digest",
    style_reference_inputs: baseline.anchor_evidence.map(({ path }) => ({ path })),
    consistency_evidence: { path: "evidence/visual/consistency.json", sha256: "stale" },
  });
  assert.deepEqual(validateGlobalVisualGenerationRecord(noSha, { visual_baseline: baseline }), []);
});

test("provided 效果图不得伪造 generated 记录", () => {
  const errors = validateVisualEffectImageOrigin({
    origin: "provided",
    generation_record: { origin: "generated" },
  });
  assert.ok(errors.some((message) => message.includes("不得携带伪生成记录")));
});

test("全局一致性提示词组合和文件证据路径保持可复核", () => {
  const baseline = createBaseline();
  const record = createRecord(baseline);
  const prompt = buildGlobalVisualConsistencyPrompt("忠实重建 asset/state/negative");
  assert.ok(prompt.includes("忠实重建 asset/state/negative"));
  assert.ok(prompt.includes(CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT));
  const evidencePaths = collectGlobalVisualConsistencyEvidencePaths(record);
  assert.equal(evidencePaths.length, 3);
  assert.deepEqual(
    evidencePaths.map(({ path }) => ({ path })),
    [
      { path: baseline.anchor_evidence[0].path },
      { path: baseline.anchor_evidence[1].path },
      { path: "evidence/visual/consistency.json" },
    ],
  );
});
