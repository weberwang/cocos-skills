import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { validateDisplayLayerPlanning } from "./display-layer-planning-contract.mjs";
import { assertHighFidelityPrerequisite } from "./high-fidelity-prerequisite.mjs";
import { validateSceneReconstructionContract } from "./scene-reconstruction-contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造显示层校验使用的冻结目标身份。 */
function targetInfo() {
  return { sceneId: "main", stateId: "default", targetSha: SHA, viewport: { width: 390, height: 844 } };
}

/** 构造当前工作项的最小显示层规划。 */
function planning({ inventory = [], persistentLayerIds = [] } = {}) {
  return {
    version: "1.0",
    scene_master: {
      scene_id: "main",
      state_id: "default",
      target_sha256: SHA,
      origin: "provided",
      viewport: { width: 390, height: 844 },
      persistent_layer_ids: persistentLayerIds,
    },
    inventory,
  };
}

/** 构造带宿主上下文图和 V4 运行轨迹的完整瞬态显示层。 */
function completeTransientLayer(overrides = {}) {
  return {
    layer_id: "pause-modal",
    type: "modal",
    host_scene_id: "main",
    target_sha256: SHA,
    persistence: "transient",
    states: [{
      state_id: "default",
      required: true,
      contextual_effect_image: {
        evidence: "evidence/pause-context.png",
        sha256: SHA,
        origin: "provided",
        host_scene_id: "main",
        host_target_sha256: SHA,
        layer_target_sha256: SHA,
        viewport: { width: 390, height: 844 },
        kind: "host-scene-context",
        isolated_only: false,
      },
    }],
    in_scene_master: false,
    trigger: { event: "pause" },
    dismiss: { event: "resume" },
    input_blocking: true,
    z_order: 20,
    backdrop: { mode: "dim" },
    focus_restore: { mode: "previous" },
    responsive: { rule: "safe-area" },
    relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: [] },
    runtime_replay: {
      status: "PASS",
      host_scene_id: "main",
      same_screen_combination: true,
      steps: [
        { phase: "open", evidence: "evidence/replay-open.png" },
        { phase: "interact", evidence: "evidence/replay-interact.png" },
        { phase: "close", evidence: "evidence/replay-close.png" },
        { phase: "restore", evidence: "evidence/replay-restore.png" },
      ],
    },
    ...overrides,
  };
}

/** 构造真实场景合同调用所需的最小非效果图场景事实。 */
function sceneContract(displayLayerPlanning) {
  return {
    contract_version: "1.0",
    reference_technical_conflicts: [],
    target_conditions: {
      target_sha256: SHA,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 1.5,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-1.0",
    },
    coverage_regions: [{
      annotation_number: 1,
      region_id: "background",
      coordinate_space: "viewport",
      anchor_reference: "viewport",
      relative_alignment: { horizontal: "center", vertical: "center" },
      z_order: 0,
      target_visibility: "visible",
      size_strategy: { width: "target-bound", height: "target-bound" },
      spacing: { top: 0, bottom: 0 },
      typography_facts: { applicable: false },
      color_facts: { palette: "baseline" },
      material_texture_facts: { surface: "flat" },
      lighting_shadow_facts: { applicable: false },
      decorative_density_facts: { density: "low" },
      clipping_cropping_facts: { clipping: "none" },
      responsive_behavior: { rule: "preserve-relative-anchors" },
      implementation_owner: "fixed-production-visual",
      implementation_plan: { mode: "asset-and-scene" },
      applicable_states: ["default"],
      evidence: ["evidence/background.json"],
      tolerance_reference: "layout-tolerance",
      approved_exception_ids: [],
      target_bounds: { x: 0, y: 0, width: 390, height: 844 },
    }],
    composition: {
      vertical_order: ["background"],
      inter_region_spacing: { background: 0 },
      relative_sizes: { background: "100%" },
      visual_center_of_gravity: { x: 195, y: 422 },
      whitespace: { regions: [], permitted: "declared" },
      alignments: [{ from: "background", to: "viewport", axis: "both", relation: "center" }],
      visual_hierarchy: ["background"],
      background_focus_foreground_occlusion: { focus: "background", foreground: [] },
    },
    responsive_contract: {
      target_viewport: { width: 390, height: 844 },
      other_viewports: [{ width: 393, height: 852, expected: "preserve-relative-anchors" }],
      relationship_invariants: ["background fills viewport"],
      layout_contract_binding: {
        target_sha256: SHA,
        scene_id: "main",
        state_id: "default",
        visual_baseline_version: "1.0.0",
        reconstruction_contract_version: "1.0",
      },
    },
    predeclared_tolerances: [{ id: "layout-tolerance", rules: { value: 2 } }],
    implementation_plan: {
      resources: ["background"],
      layout: ["viewport-fill"],
      runtime_objects: ["background"],
      composition: ["main-scene-stack"],
    },
    display_layer_planning: displayLayerPlanning,
  };
}

/** 构造与场景合同目标绑定的 manifest 外壳。 */
function sceneManifest(overrides = {}) {
  return {
    reference_target: { target_sha256: SHA, scene_ids: ["main"], state_ids: ["default"] },
    visual_baseline: { version: "1.0.0" },
    ...overrides,
  };
}

/** 计算高保真证据文件的当前 SHA-256，模拟不可变证据读取器。 */
function hashFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/** 构造高保真前置所需的最小场景 V2 证据及临时仓库。 */
function highFidelityFixture(unitType, displayLayerIds) {
  const repo = mkdtempSync(join(tmpdir(), "cocos-deferred-display-layer-"));
  const docs = join(repo, "docs");
  mkdirSync(docs, { recursive: true });
  const files = {
    sceneMaster: join(docs, "scene-master.png"),
    reconstruction: join(docs, "scene-reconstruction.json"),
    annotation: join(docs, "decomposition.png"),
    technical: join(docs, "technical.json"),
    confirmation: join(docs, "confirmation.json"),
  };
  for (const path of Object.values(files)) writeFileSync(path, `${path}\n`, "utf8");
  // 生成高保真证据引用时统一使用仓库相对路径和当前字节哈希。
  const relativeArtifact = (path) => ({ file: path.slice(repo.length + 1).replaceAll("\\", "/"), sha256: hashFile(path), sceneId: "main" });
  // 上下文条目与宿主图片是两层合同；保持嵌套结构才能让测试命中唯一匹配上下文门。
  const contextArtifact = (displayLayerId) => ({
    displayLayerId,
    hostSceneId: "main",
    hostContextImage: {
      ...relativeArtifact(files.sceneMaster),
      displayLayerId,
      hostSceneId: "main",
    },
  });
  const evidence = {
    schemaVersion: "cocos-scene-v2-reconstruction-plan/1.0",
    workItemId: "WI-DEFERRED",
    status: "COMPLETE",
    stage: "V2",
    frozen: true,
    sceneId: "main",
    targetSha256: SHA,
    candidateSha256: SHA,
    diffFingerprint: "scene-v2-diff",
    sceneMaster: relativeArtifact(files.sceneMaster),
    sceneReconstructionContract: relativeArtifact(files.reconstruction),
    decompositionAnnotation: relativeArtifact(files.annotation),
    technicalDecomposition: relativeArtifact(files.technical),
    visualDecompositionConfirmation: {
      confirmationId: "V2-CONFIRM",
      confirmationMode: "manual",
      status: "PASS",
      targetSha256: SHA,
      candidateSha256: SHA,
      diffFingerprint: "scene-v2-diff",
      evidenceFile: relativeArtifact(files.confirmation).file,
      evidenceSha256: hashFile(files.confirmation),
    },
    visualProductionContract: { contractId: "VPC-DEFERRED" },
    visualProductionUnits: [{ unitId: "scene-root", owner: "scene-worker" }],
    displayLayerContexts: displayLayerIds.map(contextArtifact),
  };
  const evidencePath = join(docs, "v2-plan.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const evidenceSha = hashFile(evidencePath);
  const expected = unitType === "SCENE"
    ? { sceneId: "main", displayLayerId: null, hostSceneId: null }
    : { sceneId: "main", displayLayerId: "pause-popup", hostSceneId: "main" };
  const unit = {
    unitId: unitType === "SCENE" ? "SCENE-DEFERRED" : "DISPLAY-pause-popup",
    unitType,
    sceneId: unitType === "SCENE" ? expected.sceneId : null,
    displayLayerId: expected.displayLayerId,
    hostSceneId: expected.hostSceneId,
    highFidelityPrerequisite: {
      workItemId: "WI-DEFERRED",
      status: "COMPLETE",
      stage: "V2",
      frozen: true,
      ...expected,
      targetSha256: SHA,
      candidateSha256: SHA,
      diffFingerprint: "scene-v2-diff",
      evidenceFile: "docs/v2-plan.json",
      evidenceSha256: evidenceSha,
    },
  };
  const work = {
    workItemId: "WI-DEFERRED",
    visualStageEvidenceRefs: { V2: { path: "docs/v2-plan.json", sha256: evidenceSha, workItemId: "WI-DEFERRED" } },
  };
  return {
    repo,
    unit,
    work,
    pkg: { workItemId: "WI-DEFERRED" },
    io: { resolve, existsSync, readFileSync, fileHash: hashFile },
  };
}

test("场景规划拒绝 deferred_layers，弹窗必须拆为独立工作项", () => {
  const value = { ...planning(), deferred_layers: [{ layer_id: "pause-popup" }] };
  const errors = validateDisplayLayerPlanning(value, targetInfo(), { stage: "V1" });
  assert.ok(errors.some((item) => item.includes("deferred_layers 已移除")), errors.join(" | "));
});

test("独立弹窗工作项仍校验完整上下文与自身 V4 轨迹", () => {
  const complete = completeTransientLayer();
  delete complete.states[0].contextual_effect_image;
  const missingContext = validateDisplayLayerPlanning(planning({ inventory: [complete] }), targetInfo(), { stage: "V1" });
  assert.ok(missingContext.some((item) => item.includes("缺少宿主场景上下文效果图")));

  const withoutReplay = completeTransientLayer();
  delete withoutReplay.runtime_replay;
  const v4Errors = validateDisplayLayerPlanning(planning({ inventory: [withoutReplay] }), targetInfo(), { stage: "V4" });
  assert.ok(v4Errors.some((item) => item.includes("runtime_replay")));

  assert.deepEqual(validateDisplayLayerPlanning(planning({ inventory: [completeTransientLayer()] }), targetInfo(), { stage: "V4" }), []);
});

test("独立弹窗可以引用其他工作项的 HUD 或弹窗关系", () => {
  const complete = completeTransientLayer({ relations: { mutually_exclusive_layer_ids: ["settings-popup"], coexists_with_layer_ids: ["main-hud"] } });
  const errors = validateDisplayLayerPlanning(planning({ inventory: [complete] }), targetInfo(), { stage: "V1" });
  assert.deepEqual(errors, []);

  complete.relations.mutually_exclusive_layer_ids = [complete.layer_id];
  const selfErrors = validateDisplayLayerPlanning(planning({ inventory: [complete] }), targetInfo(), { stage: "V1" });
  assert.ok(selfErrors.some((item) => item.includes("不得引用自身")));
});

test("场景合同不包含弹窗时可独立通过显示层门", () => {
  const errors = validateSceneReconstructionContract(sceneContract(planning()), sceneManifest(), { stage: "V1" });
  assert.ok(!errors.some((item) => item.includes("display_layer")), errors.join(" | "));

  const misplaced = validateSceneReconstructionContract(sceneContract(planning({ inventory: [completeTransientLayer()] })), sceneManifest(), { stage: "V1" });
  assert.ok(misplaced.some((item) => item.includes("瞬态显示层不属于场景工作项")), misplaced.join(" | "));
});

test("SCENE 的宿主上下文数组可以为空，但 DISPLAY_LAYER 必须有自身上下文", (t) => {
  const scene = highFidelityFixture("SCENE", []);
  t.after(() => rmSync(scene.repo, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertHighFidelityPrerequisite(scene.unit, scene.work, scene.pkg, scene.repo, scene.io));

  const display = highFidelityFixture("DISPLAY_LAYER", ["settings"]);
  t.after(() => rmSync(display.repo, { recursive: true, force: true }));
  assert.throws(
    () => assertHighFidelityPrerequisite(display.unit, display.work, display.pkg, display.repo, display.io),
    /displayLayerContexts 必须包含唯一匹配上下文/,
  );
});
