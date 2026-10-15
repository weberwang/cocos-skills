import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildResizeRecords,
  classifyRootCause,
  computeCoverage,
  computeEdgeGaps,
  evaluateViewport as evaluateViewportRaw,
  evaluateMatrixCoverage,
  summarizeReport,
  validateRepresentativeMatrix
} from "./responsive-visual-validation.mjs";
import { computeLayoutContractIdentityHash } from "../../cocos-game-ui-layout/scripts/validate_ui_layout_contract.mjs";

const identity = { candidate_sha256: `sha256:${"a".repeat(64)}`, scene_id: "main", state_id: "default", layout_contract_version: "1.1.0", visual_baseline_version: "1.0.0" };
const screenshot = { path: "evidence/viewport.png" };
const uiTemplate = JSON.parse(readFileSync(new URL("../../cocos-game-ui-layout/assets/ui-layout-contract-template.yaml", import.meta.url), "utf8"));

const hook = {
  version: 1,
  logicalCanvas: { width: 360, height: 800 },
  background: {
    rect: { x: 0, y: 0, width: 360, height: 800 },
    sourceSize: { width: 360, height: 800 },
    fitMode: "cover-v1"
  },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0, rect: { x: 0, y: 0, width: 360, height: 800 } },
  keyUiRects: { score: { x: 8, y: 8, width: 80, height: 24 } },
  cameraViewport: { x: 0, y: 0, width: 360, height: 800 },
  cameraZoom: 1,
  cameraOrigin: { x: 0, y: 0 },
  inputHitResults: [{ id: "score", hit: true }]
};

/** 为既有几何用例补齐真实 Canvas backing；专门的缺证/错配用例直接调用原函数。 */
function evaluateViewport(input) {
  const dpr = typeof input.devicePixelRatio === "number" && Number.isFinite(input.devicePixelRatio) && input.devicePixelRatio > 0
    ? Math.min(input.devicePixelRatio, 2)
    : 1;
  const backingSize = input.canvasRect
    ? { width: input.canvasRect.width * dpr, height: input.canvasRect.height * dpr }
    : null;
  return evaluateViewportRaw({ backingSize, ...input });
}

/** 构造具备四层 Hook 数据的最小响应式契约，供纯计算测试复用。 */
function contract(overrides = {}) {
  return {
    ...structuredClone(uiTemplate),
    visual_validation: { mode: "exact" },
    contract_version: identity.layout_contract_version,
    scope: { ...structuredClone(uiTemplate.scope), scenes: ["main"], bindings: { ...structuredClone(uiTemplate.scope.bindings), code_candidate: identity.candidate_sha256, visual_baseline: identity.visual_baseline_version } },
    viewport: {
      mode: "full-viewport",
      strategy: "FIXED_WIDTH",
      allowWhitespace: false,
      backgroundCoverageTarget: 1,
      backgroundFit: { mode: "cover-v1", sourceFocalPoint: { x: 0.5, y: 0.5 }, targetPoint: { x: 0.5, y: 0.5 } },
      ...overrides.viewport
    },
    safeArea: { required: true },
    resize: { required: true },
    hook: { required: true },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "viewport"))
  };
}

/** 构造已绑定冻结目标与父子停靠几何的效果图合同，避免不同入口的测试样本发生漂移。 */
function effectImageContract() {
  const targetSha = `sha256:${"b".repeat(64)}`;
  const document = {
    ...contract(),
    resize: { required: false },
    viewports: [],
    effect_image_reconstruction: { applicability: "effect-image" },
    fidelity: { applicability: "frozen-target", status: "specified" },
    frozen_visual_target: { candidate_id: "target-1", target_sha256: targetSha, original_file: "evidence/target.png", visual_baseline_version: identity.visual_baseline_version, status: "frozen" },
    scene_reconstruction_binding: { target_sha256: targetSha, scene_id: identity.scene_id, state_id: identity.state_id, visual_baseline_version: identity.visual_baseline_version, reconstruction_contract_version: "1.0.0", layout_contract_sha256: "pending", layout_decomposition_version: "layout-v1", target_viewport: { width: 360, height: 800 } },
    layout_nodes: [{ layout_node_id: "hud.title", region_id: "title", coordinate_space: "ui-space", reference_id: "safe-area", parent_layout_node_id: "safe-area", parent_target_bounds: { x: 0, y: 0, width: 360, height: 800 }, relative_position: { left: 10, right: 250, top: 20, bottom: 740 }, axis_alignment: { horizontal: "left", vertical: "top" }, self_anchor: "top-left", reference_anchor: "top-left", offset: { x: 10, y: 20 }, target_bounds: { x: 10, y: 20, width: 100, height: 40 }, size_policy: "fixed-at-target", ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "CONTENT", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, z_order: 10, clip_policy: "none", responsive_rule: "preserve-center-and-top-gap", planned_test_id: "align-title" }],
    layout_annotation: { layout_annotation_file: "evidence/layout-annotation.png", layout_annotation_sha256: targetSha, layout_annotation_width: 360, layout_annotation_height: 800, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: targetSha, layout_annotation_identity_sha256: targetSha, layout_review_file: "evidence/layout-review.html", layout_review_sha256: targetSha, layout_review_identity_sha256: targetSha, layout_nodes_file: "evidence/layout-nodes.json", layout_nodes_sha256: targetSha, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: targetSha, proposal_sha256: targetSha, layout_decision_file: "evidence/automatic-layout-decision.json", layout_decision_sha256: targetSha, layout_decision_id: "layout-decision-1", target_sha256: targetSha, scene_id: identity.scene_id, state_id: identity.state_id, layout_node_ids: ["hud.title"] },
    critical_alignments: [{ id: "align-title", layout_node_id: "hud.title", element_id: "title", reference_id: "ui-root", planned_test_id: "align-title", target_sha256: targetSha, candidate_sha256: identity.candidate_sha256, horizontal: { type: "aligned", element_anchor: "center", reference_anchor: "center" }, vertical: { type: "offset", element_anchor: "top", reference_anchor: "top" }, target_measurement: { x: 10, y: 20, width: 100, height: 40 }, target_evidence: ["evidence/target-title.png"], tolerance: { unit: "logical-px", value: 2 } }]
  };
  // 身份哈希必须在节点与场景绑定完整后计算，确保测试覆盖真实合同而非格式占位。
  document.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(document);
  return { document, targetSha };
}

test("360x800 中 Canvas [0,80,360,640] 必须失败", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 80, width: 360, height: 640 },
    hookSnapshot: hook,
    contract: contract(),
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "fail");
  assert.ok(result.failures.some((failure) => failure.includes("留白")));
  assert.deepEqual(result.edgeGaps, { left: 0, top: 80, right: 0, bottom: 80 });
});

test("留白政策未定义时输出 decision_gap", () => {
  const missingWhitespace = contract();
  delete missingWhitespace.viewport.allowWhitespace;
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: hook,
    contract: missingWhitespace,
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "decision_gap");
  assert.ok(result.decisionGaps.includes("未定义留白许可"));
});

test("FIT 只得到 fit_only，不是响应式通过", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: hook,
    contract: contract({ viewport: { strategy: "FIT" } }),
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "fit_only");
  assert.equal(result.responsivePass, false);
});

test("缺少 Hook 时相关逻辑、背景和安全区结论只能未验证", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: null,
    contract: contract(),
    devicePixelRatio: 2
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.responsivePass, false);
  assert.ok(result.unverified.some((reason) => reason.includes("Hook")));
});

test("无有效安全区 rect 不得当作安全区证据", () => { const badHook = { ...hook, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: badHook, contract: contract(), devicePixelRatio: 2, screenshot }); assert.equal(result.status, "unverified"); assert(result.unverified.some((item) => item.includes("安全区"))); });

test("required Hook 缺版本、有效 UI 或截图不得通过", () => { for (const kind of ["version", "ui", "screenshot"]) { const snapshot = structuredClone(hook); let image = screenshot; if (kind === "version") delete snapshot.version; if (kind === "ui") snapshot.keyUiRects = {}; if (kind === "screenshot") image = null; const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: snapshot, contract: contract(), devicePixelRatio: 2, screenshot: image }); assert.equal(result.status, "unverified", kind); } });

test("resize 轨迹记录同页面前后变化", () => {
  const measurements = [
    { name: "baseline", status: "pass", viewportRect: { x: 0, y: 0, width: 390, height: 844 }, canvasRect: { x: 0, y: 0, width: 390, height: 844 }, scaling: { physical: { dpr: 2 } }, keyUiRects: { score: { x: 16, y: 16, width: 80, height: 24 } } },
    { name: "narrow", status: "pass", viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, scaling: { physical: { dpr: 2 } }, keyUiRects: { score: { x: 8, y: 8, width: 80, height: 24 } } }
  ];
  const resize = buildResizeRecords(measurements, { resize: { required: true }, viewport: { strategy: "FIXED_WIDTH" } });
  assert.equal(resize.status, "pass");
  assert.equal(resize.records[0].pageReloaded, false);
  assert.equal(resize.records[0].canvasChanged, true);
  const report = summarizeReport(measurements, {
    ...contract(),
    viewports: { baseline: { width: 390, height: 844, dpr: 2 }, narrow: { width: 360, height: 800, dpr: 2 } }
  }, identity);
  // 同页 resize 已通过，但合同声明双方向，竖屏记录不能证明横屏与旋转。
  assert.equal(report.resizeStatus, "pass");
  assert.equal(report.status, "unverified");
  assert(report.matrix.orientationMissing.includes("landscape"));
});

test("required resize 不接受无布局变化、刷新或跨 context 记录", () => { const base = [{ name: "a", status: "pass", contextId: 1, viewportRect: { width: 390, height: 844 }, canvasRect: { width: 390, height: 844 }, keyUiRects: { score: { x: 1 } } }, { name: "b", status: "pass", contextId: 1, viewportRect: { width: 360, height: 800 }, canvasRect: { width: 390, height: 844 }, keyUiRects: { score: { x: 1 } } }]; assert.equal(buildResizeRecords(base, { resize: { required: true } }).status, "fail"); const changedContext = structuredClone(base); changedContext[1].contextId = 2; changedContext[1].canvasRect.width = 360; assert.equal(buildResizeRecords(changedContext, { resize: { required: true } }).status, "fail"); const refreshed = structuredClone(base); refreshed[1].pageReloaded = true; refreshed[1].canvasRect.width = 360; assert.equal(buildResizeRecords(refreshed, { resize: { required: true } }).status, "fail"); });

test("resize 轨迹接受同页背景 cover 几何重算", () => {
  const measurements = [
    { name: "portrait", contextId: 1, viewportRect: { width: 360, height: 800 }, canvasRect: { width: 360, height: 800 }, keyUiRects: { score: { x: 8 } }, backgroundFit: { matches: true, actual: { x: -531.1, y: 0, displayWidth: 1422.2, displayHeight: 800 } } },
    { name: "landscape", contextId: 1, samePageWithPrevious: true, viewportRect: { width: 800, height: 360 }, canvasRect: { width: 360, height: 800 }, keyUiRects: { score: { x: 8 } }, backgroundFit: { matches: true, actual: { x: 0, y: -45, displayWidth: 800, displayHeight: 450 } } }
  ];
  const result = buildResizeRecords(measurements, { resize: { required: true }, viewport: { strategy: "FIXED_WIDTH" } });
  assert.equal(result.status, "pass");
  assert.equal(result.records[0].backgroundChanged, true);
});

test("resize 轨迹拒绝只有预期值变化而实际背景未重排", () => {
  const actual = { x: 0, y: 0, displayWidth: 360, displayHeight: 800 };
  const measurements = [
    { name: "portrait", contextId: 1, viewportRect: { width: 360, height: 800 }, canvasRect: { width: 360, height: 800 }, keyUiRects: { score: { x: 8 } }, backgroundFit: { matches: true, expected: { displayWidth: 360 }, actual } },
    { name: "landscape", contextId: 1, samePageWithPrevious: true, viewportRect: { width: 800, height: 360 }, canvasRect: { width: 360, height: 800 }, keyUiRects: { score: { x: 8 } }, backgroundFit: { matches: false, expected: { displayWidth: 800 }, actual } }
  ];
  const result = buildResizeRecords(measurements, { resize: { required: true }, viewport: { strategy: "FIXED_WIDTH" } });
  assert.equal(result.status, "fail");
  assert.equal(result.records[0].backgroundChanged, false);
});

test("覆盖率只按 viewport 交集计算", () => {
  assert.equal(computeCoverage({ x: 0, y: 0, width: 180, height: 800 }, { x: 0, y: 0, width: 360, height: 800 }), 0.5);
  assert.deepEqual(computeEdgeGaps({ x: 0, y: 0, width: 360, height: 800 }, { x: 0, y: 0, width: 360, height: 800 }), { left: 0, top: 0, right: 0, bottom: 0 });
});

test("cover-v1 拒绝虽铺满但发生非等比拉伸的背景", () => {
  const stretchedHook = structuredClone(hook);
  stretchedHook.background.sourceSize = { width: 1920, height: 1080 };
  const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: stretchedHook, contract: contract(), devicePixelRatio: 1, screenshot });
  assert.equal(result.backgroundCoverage, 1);
  assert.equal(result.status, "fail");
  assert(result.failures.some((item) => item.includes("cover-v1")));
});

test("cover-v1 接受等比覆盖与中心裁切", () => {
  const coveredHook = structuredClone(hook);
  coveredHook.background.sourceSize = { width: 1920, height: 1080 };
  coveredHook.background.rect = { x: -531.1111111111111, y: 0, width: 1422.2222222222222, height: 800 };
  const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: coveredHook, contract: contract(), devicePixelRatio: 1, screenshot });
  assert.equal(result.status, "pass");
  assert.equal(result.backgroundFit.matches, true);
});

test("cover-v1 要求合同显式冻结焦点与目标落点", () => {
  const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: hook, contract: contract({ viewport: { backgroundFit: { mode: "cover-v1" } } }), devicePixelRatio: 1, screenshot });
  assert.equal(result.status, "decision_gap");
  assert(result.decisionGaps.some((item) => item.includes("源图焦点")));
  assert(result.decisionGaps.some((item) => item.includes("目标落点")));
});

test("cover-v1 将 Hook 的非法资源尺寸归类为执行失败", () => {
  const invalidHook = structuredClone(hook);
  invalidHook.background.sourceSize.width = 0;
  const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: invalidHook, contract: contract(), devicePixelRatio: 1, screenshot });
  assert.equal(result.status, "fail");
  assert(result.failures.some((item) => item.includes("资源尺寸")));
});

test("根因分类按方案、执行、验收顺序给出主次", () => {
  const cause = classifyRootCause({ failures: ["Canvas 四边存在未许可留白"], decisionGaps: ["未定义适配策略"], acceptanceFailures: ["缺陷存在但门禁已放行"] });
  assert.equal(cause.primary, "方案缺失");
  assert.deepEqual(cause.secondary, ["执行问题", "验收问题"]);
});

test("单纯缺证保持未验证，不臆断为验收问题", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: null,
    contract: contract(),
    devicePixelRatio: 2
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.rootCause.primary, null);
});

test("未声明视口矩阵时返回决策缺口", () => {
  const report = summarizeReport([], { ...contract(), resize: { required: false } }, identity);
  assert.equal(report.matrix.status, "decision_gap");
  assert.equal(report.responsivePass, false);
});

test("矩阵只使用运行时实测宽高和 DPR", () => { const measurements = [{ name: "baseline", status: "pass", declaredViewport: { width: 390, height: 844, deviceScaleFactor: 2 }, viewportRect: { width: 360, height: 800 }, scaling: { physical: { dpr: 1 } } }]; const report = summarizeReport(measurements, { ...contract(), resize: { required: false }, viewports: { baseline: { width: 390, height: 844, dpr: 2 } } }, identity); assert.equal(report.matrix.status, "fail"); assert.deepEqual(report.matrix.mismatched, ["baseline"]); });
test("响应式验证记录动态有效 DPR，并对原始设备值封顶", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5, 2]) {
    const result = evaluateViewport({
      viewportRect: { x: 0, y: 0, width: 360, height: 800 },
      canvasRect: { x: 0, y: 0, width: 360, height: 800 },
      hookSnapshot: hook,
      contract: contract(),
      devicePixelRatio: dpr,
      screenshot,
    });
    assert.notEqual(result.status, "fail", `DPR=${dpr}: ${result.failures}`);
    assert.equal(result.scaling.physical.dpr, dpr);
  }
  const capped = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: hook, contract: contract(), devicePixelRatio: 3, screenshot });
  assert.notEqual(capped.status, "fail", capped.failures.join("；"));
  assert.equal(capped.scaling.physical.dpr, 2);
});

test("响应式验证拒绝非法原始设备 DPR", () => {
  for (const dpr of [0, -1, NaN, Infinity, "2"]) {
    const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: hook, contract: contract(), devicePixelRatio: dpr, screenshot });
    assert.equal(result.status, "fail", `DPR=${dpr}`);
    assert(result.failures.some((item) => item.includes("正有限数字")), `DPR=${dpr}: ${result.failures}`);
  }
});

test("新响应式合同直接核对真实 backing、Camera 与输入证据", () => {
  const strictContract = contract({ responsiveViewportContract: { applicability: "SCENE" } });
  const strictHook = {
    ...structuredClone(hook),
    cameraViewport: { x: 0, y: 0, width: 360, height: 800 },
    cameraZoom: 1,
    cameraOrigin: { x: 0, y: 0 },
    inputHitResults: [{ id: "score", hit: true }]
  };
  const result = evaluateViewportRaw({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    backingSize: { width: 360, height: 800 },
    hookSnapshot: strictHook,
    contract: strictContract,
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "fail");
  assert(result.failures.some((item) => item.includes("backing")));
});

test("usability 代表矩阵覆盖视口、DPR、连续 resize 与弹窗轨迹", () => {
  const phases = ["open", "interact", "resize", "close", "restore"].map((phase) => ({ phase }));
  const measurements = [
    { contextId: "page-a", viewportRect: { width: 360, height: 800 }, rawDevicePixelRatio: 3, effectiveDevicePixelRatio: 2, displayLayerTrajectory: phases },
    { contextId: "page-a", samePageWithPrevious: true, pageReloaded: false, viewportRect: { width: 390, height: 844 }, rawDevicePixelRatio: 1, effectiveDevicePixelRatio: 1 },
    { contextId: "page-a", samePageWithPrevious: true, pageReloaded: false, viewportRect: { width: 844, height: 390 }, rawDevicePixelRatio: 1, effectiveDevicePixelRatio: 1 },
    { contextId: "page-b", viewportRect: { width: 900, height: 400 }, rawDevicePixelRatio: 1.5, effectiveDevicePixelRatio: 1.5 },
    { contextId: "page-c", viewportRect: { width: 1440, height: 900 }, rawDevicePixelRatio: 2, effectiveDevicePixelRatio: 2 }
  ];
  const orientationPolicy = { allowed: ["portrait", "landscape"] };
  assert.deepEqual(validateRepresentativeMatrix(measurements, { requireDisplayLayer: true, orientationPolicy }), { status: "pass", missing: [] });
  const incomplete = validateRepresentativeMatrix(measurements.slice(0, 1), { requireDisplayLayer: true, orientationPolicy });
  assert.equal(incomplete.status, "unverified");
  assert(incomplete.missing.includes("桌面宽屏"));
});

/** QA 同方向实测矩阵保留 DPR 与单页重排覆盖，不引入旋转样本。 */
function singleOrientationMeasurements(orientation) {
  const sizes = orientation === "portrait"
    ? [[360, 800], [390, 844], [400, 860], [420, 900], [430, 932]]
    : [[800, 360], [1024, 768], [1100, 800], [1200, 800], [1440, 900]];
  return sizes.map(([width, height], index) => ({
    name: `sample-${index}`, contextId: "single-page", samePageWithPrevious: index > 0, pageReloaded: false,
    viewportRect: { width, height }, rawDevicePixelRatio: [3, 1, 1, 1.5, 2][index], effectiveDevicePixelRatio: [2, 1, 1, 1.5, 2][index],
    displayLayerTrajectory: ["open", "interact", "resize", "close", "restore"].map((phase) => ({ phase })),
  }));
}

test("QA 单方向矩阵无需跨方向，声明双方向仍缺方向证据", () => {
  for (const orientation of ["portrait", "landscape"]) {
    const measurements = singleOrientationMeasurements(orientation);
    assert.deepEqual(validateRepresentativeMatrix(measurements, { orientationPolicy: { allowed: [orientation] } }), { status: "pass", missing: [] });
    const both = validateRepresentativeMatrix(measurements, { orientationPolicy: { allowed: ["portrait", "landscape"] } });
    assert.equal(both.status, "unverified");
    assert(both.missing.includes("方向切换"));
    const missingDpr = validateRepresentativeMatrix(measurements.slice(0, 3), { orientationPolicy: { allowed: [orientation] } });
    assert(missingDpr.missing.includes("DPR 1.25 或 1.5"));
  }
  assert(validateRepresentativeMatrix(singleOrientationMeasurements("portrait")).missing.some((item) => item.includes("orientationPolicy.allowed")));
});

test("QA 从根合同读取方向，exact 的完整矩阵也只验证项目支持方向", () => {
  for (const orientation of ["portrait", "landscape"]) {
    const measurements = singleOrientationMeasurements(orientation).map((item) => ({ ...item, scaling: { physical: { dpr: item.effectiveDevicePixelRatio } } }));
    const declared = measurements.map((item) => ({ name: item.name, ...item.viewportRect, deviceScaleFactor: item.rawDevicePixelRatio }));
    declared.push({ name: "unsupported", width: orientation === "portrait" ? 800 : 360, height: orientation === "portrait" ? 360 : 800 });
    const scoped = contract({ orientationPolicy: { allowed: [orientation] }, viewports: declared });
    const exact = evaluateMatrixCoverage(measurements, scoped);
    assert.equal(exact.status, "pass", orientation);
    assert(!exact.expected.includes("unsupported"));
    assert.equal(evaluateMatrixCoverage(measurements, { ...scoped, visual_validation: { mode: "usability" } }).status, "pass");
  }
});

test("exact 双方向合同缺另一方向或同页旋转时不能通过", () => {
  const measurement = { name: "portrait", contextId: "page-a", pageReloaded: false, viewportRect: { width: 390, height: 844 }, scaling: { physical: { dpr: 1 } } };
  const scoped = contract({ viewports: [{ name: "portrait", width: 390, height: 844 }] });
  const missing = evaluateMatrixCoverage([measurement], scoped);
  assert.equal(missing.status, "unverified");
  assert(missing.orientationMissing.includes("landscape"));
  const landscape = { ...measurement, name: "landscape", samePageWithPrevious: true, viewportRect: { width: 844, height: 390 } };
  scoped.viewports.push({ name: "landscape", width: 844, height: 390 });
  assert.equal(evaluateMatrixCoverage([measurement, { ...landscape, contextId: "other-page" }], scoped).status, "unverified");
  assert.equal(evaluateMatrixCoverage([measurement, landscape], scoped).status, "pass");
});

test("QA 拒绝根级与嵌套方向范围冲突", () => {
  const scoped = contract({ orientationPolicy: { allowed: ["portrait"] }, responsiveViewportContract: { orientationPolicy: { allowed: ["portrait", "landscape"] } } });
  const measurements = singleOrientationMeasurements("portrait");
  assert.equal(evaluateMatrixCoverage(measurements, scoped).status, "decision_gap");
});

test("响应式合同声明允许动态有效值并拒绝非法有效声明", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5, 2]) {
    const report = summarizeReport([], { ...contract(), dpr, resize: { required: false }, viewports: [] }, identity);
    assert.deepEqual(report.dprErrors, [], `DPR=${dpr}: ${report.dprErrors}`);
  }
  for (const dpr of [0, -1, 2.0001, 3, "2", NaN, Infinity]) {
    const report = summarizeReport([], { ...contract(), dpr, resize: { required: false }, viewports: [] }, identity);
    assert(report.dprErrors.some((item) => item.includes("正有限数字且不超过 2")), `DPR=${dpr}: ${report.dprErrors}`);
  }
});

test("报告必须带合法不可变证据身份", () => { const missing = summarizeReport([], { resize: { required: false }, viewports: [] }); assert.equal(missing.responsivePass, false); assert(missing.identityErrors.length > 0); const report = summarizeReport([], { ...contract(), resize: { required: false }, viewports: [] }, { ...identity, target_sha256: `sha256:${"b".repeat(64)}` }); assert.deepEqual(report.identityErrors, []); });

test("V4 响应式证据直接绑定正式候选身份", () => {
  const evidenceContract = { ...contract(), resize: { required: false }, viewports: [] };
  const { candidate_sha256, ...requiredIdentity } = identity;
  // 正式证据由任务与运行候选定位，不再为独立预览携带额外身份。
  const report = summarizeReport([], evidenceContract, { ...requiredIdentity, currentStage: "V4", target_sha256: "stale" });
  assert.deepEqual(report.identityErrors, []);
});

test("效果图还原报告不比较目标摘要，仍复核实际布局合同", () => {
  const { document, targetSha } = effectImageContract();
  const missing = summarizeReport([], document, identity); assert.deepEqual(missing.identityErrors, []);
  const wrong = summarizeReport([], document, { ...identity, target_sha256: `sha256:${"c".repeat(64)}` }); assert.deepEqual(wrong.identityErrors, []);
  const complete = summarizeReport([], document, { ...identity, target_sha256: targetSha }); assert.deepEqual(complete.identityErrors, []);
});

test("响应式入口复用效果图父子停靠几何合同", () => { const { document, targetSha } = effectImageContract(); document.layout_nodes[0].relative_position.left += 1; assert.notEqual(computeLayoutContractIdentityHash(document), document.scene_reconstruction_binding.layout_contract_sha256); assert.equal(summarizeReport([], document, { ...identity, target_sha256: targetSha }).responsivePass, false); });

test("报告身份必须与原始 UI 合同交叉绑定", () => { for (const [field, value, message] of [["scene_id", "other", "scope.scenes"], ["state_id", "paused", "scope.states"], ["layout_contract_version", "9.0.0", "contract_version"], ["visual_baseline_version", "2.0.0", "视觉基线"]]) { const report = summarizeReport([], { ...contract(), resize: { required: false }, viewports: [] }, { ...identity, [field]: value }); assert(report.identityErrors.some((item) => item.includes(message)), field); } });

test("调用方伪造 identityContract 不能自证可信身份", () => { const forged = { resize: { required: false }, viewports: [], identityContract: { schemaVersion: "1.1.0", contractVersion: identity.layout_contract_version, scenes: [identity.scene_id], states: [identity.state_id], codeCandidate: identity.candidate_sha256, visualBaselineVersion: identity.visual_baseline_version } }; const report = summarizeReport([], forged, identity); assert.equal(report.responsivePass, false); assert(report.identityErrors.some((item) => item.includes("原始 UI 合同"))); });

test("残缺原始合同即使根身份匹配也不能自证", () => { const incomplete = { schema_version: "1.1.0", contract_version: identity.layout_contract_version, scope: { scenes: [identity.scene_id], states: [identity.state_id], bindings: { code_candidate: identity.candidate_sha256, visual_baseline: identity.visual_baseline_version } }, resize: { required: false }, viewports: [] }; const report = summarizeReport([], incomplete, identity); assert.equal(report.responsivePass, false); assert(report.identityErrors.some((item) => item.includes("完整布局合同校验"))); });
