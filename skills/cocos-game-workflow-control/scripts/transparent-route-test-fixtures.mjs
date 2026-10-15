/** 补齐本地固定合同夹具；通过状态仅用于测试断言，不代表真实美术视觉验收。 */
export function prepareTransparencyFixture(generation, expectedAsset, overrides = {}) {
  if (expectedAsset?.alpha !== true) return generation;
  generation.parameters ??= {};
  generation.postprocess ??= [];
  const strategy = overrides.strategy ?? generation.transparency_strategy ?? "background-removal";
  const edge = overrides.edgeProfile ?? "hard-edge";
  expectedAsset.transparency_requirements = { strategy, edge_profile: edge };
  const normalization = generation.normalization_record ?? {};
  const sha = normalization.source_sha256 ?? `sha256:${"b".repeat(64)}`;
  Object.assign(generation, { transparency_strategy: strategy, edge_profile: edge, edge_evidence: "固定样例边缘事实", raw_source_sha256: generation.raw_source_sha256 ?? `sha256:${"f".repeat(64)}`, source_sha256: sha });
  if (strategy === "background-removal") {
    generation.color_separation_verified = true;
    for (const attempt of generation.background_removal_attempts ?? []) {
      attempt.evidence = { ...attempt.evidence, tool: "edge-connected-chroma", tool_version: "1", source_sha256: generation.raw_source_sha256, output_sha256: sha, parameters: { tolerance: 24, edge_profile: "hard-edge", color_separation_verified: true } };
    }
  } else if (strategy === "direct-alpha") {
    for (const field of ["source_background_color", "background_removal_attempts", "background_removal_max_attempts", "color_separation_verified"]) delete generation[field];
    Object.assign(generation, { source_background_mode: "transparent", final_background_mode: "transparent", raw_source_file: generation.source_file, raw_source_has_alpha: true, source_has_alpha: true, raw_source_sha256: sha });
    generation.capability = { tool: generation.generator ?? "fixture-tool", tool_version: generation.generator_version ?? "1", supports_true_alpha: true, output_format: "png", verified_edge_profiles: [edge], evidence: "固定能力样例，不是本轮真实生图实测" };
    generation.generator ??= generation.capability.tool;
    generation.generator_version ??= generation.capability.tool_version;
  }
  generation.transparency_preview = {
    candidate_sha256: generation.candidate_sha256 ?? `sha256:${"c".repeat(64)}`,
    source_file: normalization.output_file ?? expectedAsset.runtime_file,
    source_sha256: normalization.output_sha256 ?? `sha256:${"a".repeat(64)}`,
    light: { file: "evidence/transparent/light.png", sha256: `sha256:${"d".repeat(64)}`, background_color: "#F2E9DF" },
    dark: { file: "evidence/transparent/dark.png", sha256: `sha256:${"e".repeat(64)}`, background_color: "#16202E" },
    inspection: { status: "passed", evidence: "本地固定测试检查夹具", checks: { subject_integrity: "passed", background_residue: "passed", color_fringe: "passed", semi_transparency: edge === "hard-edge" ? "not-applicable" : "passed" } },
  };
  return generation;
}

/** 在提示词单测中提供显式的真实 Alpha 能力夹具。 */
export function fixtureAlphaCapability(edge = "glow") {
  return { supports_true_alpha: true, verified_edge_profiles: [edge] };
}
