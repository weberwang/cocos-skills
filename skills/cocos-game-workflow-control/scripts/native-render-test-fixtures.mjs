/** 构造用于合同验证的固定原生参数，不启动任何 Cocos 运行实例。 */
export function nativeRenderContract(overrides = {}) {
  return { renderer: "cc.Graphics.rect/fill/stroke", dimensions: { width: 120, height: 48 }, colors: ["#182333", "#ffffff"], line_width: 2, corner_radius: 0, gradient: { type: "none", stops: [] }, opacity: 1, applicable_states: ["default"], unsupported_features: [], ...overrides };
}

/** 构造显式运行证据夹具，测试只验证合同而不把夹具视为实际运行验收。 */
export function nativeRuntimeEvidence(analysis, identity) {
  return { status: "passed", observed_method: analysis.production_method, observed_delivery_kind: analysis.delivery_kind, render_contract: structuredClone(analysis.native_suitability.render_contract), evidence: "evidence/runtime/native.json", evidence_sha256: identity.candidate, candidate_sha256: identity.candidate, target_sha256: identity.target, baseline_sha256: identity.baseline ?? identity.target, diff_fingerprint: identity.diff ?? "diff-1" };
}
