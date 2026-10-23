import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { checkContractFiles, computeLayoutContractIdentityHash, main, validateContract } from "./validate_ui_layout_contract.mjs";
import { validateUiInteractionTree, validateUiLayout } from "../../cocos-game-asset-integration/scripts/ui-layout-organization.mjs";

import { deriveLayoutExecutionPlans } from "./widget-layout.mjs";
import { attachLayoutRuntimeSnapshots } from "./widget-runtime-test-fixtures.mjs";

const templatePath = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")), "../assets/ui-layout-contract-template.yaml");
const base = JSON.parse(await readFile(templatePath, "utf8"));

/** 深拷贝基准合同，避免测试之间共享修改。 */
function copy() { return structuredClone(base); }
/** 构造冻结目标的 specified 或 verified 布局合同。 */
function fidelityContract(status = "verified") {
  const document = copy(); const targetSha = `sha256:${"1".repeat(64)}`; const candidateSha = document.scope.bindings.code_candidate;
  document.visual_validation = { mode: "exact" };
  document.fidelity = { applicability: "frozen-target", status }; document.effect_image_reconstruction = { applicability: "effect-image" };
  document.frozen_visual_target = { candidate_id: "mockup-a", original_file: "evidence/target.png", target_sha256: targetSha, visual_baseline_version: "ui-v1", status: "frozen" };
  document.scene_reconstruction_binding = { target_sha256: targetSha, scene_id: "MainScene", state_id: "default", visual_baseline_version: "ui-v1", reconstruction_contract_version: "1.0.0", layout_contract_sha256: "pending", layout_decomposition_version: "layout-v1", target_viewport: { width: 390, height: 844 } };
  document.layout_nodes = [{ layout_node_id: "hud.title", region_id: "title", coordinate_space: "ui-space", reference_id: "safe-area", parent_layout_node_id: "safe-area", parent_target_bounds: { x: 0, y: 0, width: 390, height: 844 }, relative_position: { left: 115, right: 115, top: 32, bottom: 764 }, axis_alignment: { horizontal: "center", vertical: "top" }, self_anchor: "top-center", reference_anchor: "top-center", offset: { x: 0, y: 32 }, target_bounds: { x: 115, y: 32, width: 160, height: 48 }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, size_policy: "fixed-at-target", z_order: 10, clip_policy: "none", responsive_rule: "preserve-center-and-top-gap", planned_test_id: "tests/layout/title-center" }];
  document.layout_nodes = deriveLayoutExecutionPlans(document.layout_nodes);
  document.component_snapshots = attachLayoutRuntimeSnapshots(document.layout_nodes, document.layout_nodes.map((node) => ({ layout_node_id: node.layout_node_id })));
  document.layout_annotation = { layout_annotation_file: "evidence/layout-annotation.png", layout_annotation_sha256: targetSha, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: targetSha, layout_annotation_identity_sha256: targetSha, layout_review_file: "evidence/layout-review.html", layout_review_sha256: targetSha, layout_review_identity_sha256: targetSha, layout_nodes_file: "evidence/layout-nodes.json", layout_nodes_sha256: targetSha, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: targetSha, proposal_sha256: targetSha, layout_decision_file: "evidence/automatic-layout-decision.json", layout_decision_sha256: targetSha, layout_decision_id: "layout-decision-1", target_sha256: targetSha, scene_id: "MainScene", state_id: "default", layout_node_ids: ["hud.title"] };
  document.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(document);
  document.critical_alignments = [{ id: "title-center", layout_node_id: "hud.title", element_id: "title", reference_id: "safe-area", horizontal: { type: "center-aligned", element_anchor: "center", reference_anchor: "center" }, vertical: { type: "top-offset", element_anchor: "top", reference_anchor: "top" }, target_measurement: { x: 115, y: 32, width: 160, height: 48 }, planned_test_id: "tests/layout/title-center", target_evidence: ["evidence/target-title.png"], target_sha256: targetSha, candidate_sha256: candidateSha, tolerance: { unit: "logical-px", value: 2 } }];
  if (status === "verified") { Object.assign(document.critical_alignments[0], { actual_test_id: "tests/layout/title-center", runtime_measurement: { x: 115, y: 32, width: 160, height: 48 }, delta: { x: 0, y: 0, width: 0, height: 0 }, test_status: "passed", runtime_evidence: ["evidence/runtime-title.png"] }); document.parity_cases = [{ id: "main-default", target_sha256: targetSha, candidate_sha256: candidateSha, scene_id: "MainScene", state_id: "default", viewport: { width: 390, height: 844 }, dpr: 2, language: "zh-CN", random_seed: 42, input_trace: "traces/main.json", sample_rule: "stable-frame", layout_contract_version: "1.0.0", visual_baseline_version: "ui-v1", reference_evidence: ["evidence/target.png"], candidate_evidence: ["evidence/candidate.png"], tolerance: { unit: "logical-px", value: 2 }, exception_ids: [], conclusion: "passed" }]; }
  return document;
}
/** 将模板合同缩窄到单一支持方向，同时保留该方向的尺寸、DPR 封顶和常规重排证据。 */
function restrictToOrientation(document, orientation) {
  document.orientationPolicy.allowed = [orientation];
  delete document.designResolutionPolicy[orientation === "portrait" ? "landscape" : "portrait"];
  document.targets.orientations = [orientation];
  for (const target of [document.targets.min, document.targets.preferred, document.targets.max]) {
    // 模板目标含不同方向的端点，单方向测试需旋转宽高以保留尺寸尺度而不制造反向样本。
    if ((target.width < target.height ? "portrait" : "landscape") !== orientation) [target.width, target.height] = [target.height, target.width];
    target.orientation = orientation;
  }
  for (const policy of [document.canvasBackingPolicy, document.runtimeDprPolicy, document.safeAreaPolicy, document.resizePolicy, document.textResolutionPolicy]) {
    const eventField = policy.updatesOn ? "updatesOn" : policy.refreshOn ? "refreshOn" : policy.events ? "events" : "reflowOn";
    policy[eventField] = policy[eventField].filter((event) => event !== "orientation-change");
  }
  document.representativeViewports = document.representativeViewports.filter((viewport) => viewport.orientation === orientation);
  if (orientation === "portrait") {
    document.representativeViewports.push({ id: "portrait-dpr-cap", kind: "standard-portrait", width: 430, height: 932, orientation: "portrait", rawDpr: 3, effectiveDpr: 2 });
  } else {
    document.representativeViewports.push(
      { id: "landscape-dpr-one", kind: "landscape", width: 900, height: 600, orientation: "landscape", rawDpr: 1, effectiveDpr: 1 },
      { id: "landscape-dpr-mid", kind: "landscape", width: 960, height: 640, orientation: "landscape", rawDpr: 1.5, effectiveDpr: 1.5 },
    );
  }
  // 方向缩窄会改变身份投影中的设计分辨率策略，测试夹具需重新绑定哈希，避免误报过期合同。
  if (document.scene_reconstruction_binding) document.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(document);
  return document;
}
/** 断言指定缺陷稳定地产生失败和可定位诊断。 */
function assertFailed(document, expected) { const result = validateContract(document); assert.equal(result.status, "failed"); assert(result.errors.some((item) => item.includes(expected)), JSON.stringify(result)); }

test("普通布局合同通过且保留专项标记", () => { const result = validateContract(copy()); assert.equal(result.status, "passed", JSON.stringify(result)); assert(result.specialized_review.includes("primary-action:docked-overlay")); });

test("关键矩形超出项目声明容差时，usability 与 exact 都拒绝手写通过", () => {
  for (const mode of ["usability", "exact"]) {
    const document = fidelityContract(); document.visual_validation = { mode };
    document.critical_alignments[0].runtime_measurement.x += 6;
    document.critical_alignments[0].delta.x = 6;
    assertFailed(document, "runtime_measurement.x 超出声明容差");
  }
});

test("声明的关键容差校验实测差值，不能用 delta=0 隐藏偏移", () => {
  const document = fidelityContract(); document.visual_validation = { mode: "usability" };
  document.critical_alignments[0].runtime_measurement.y += 12;
  assertFailed(document, "delta.y 必须等于");
  assertFailed(document, "runtime_measurement.y 超出声明容差");
});

test("usability 未声明精确几何容差时保留宽松策略，声明边界值时允许通过", () => {
  const relaxed = fidelityContract(); relaxed.visual_validation = { mode: "usability" };
  delete relaxed.critical_alignments[0].tolerance;
  relaxed.critical_alignments[0].runtime_measurement.x += 12;
  assert.equal(validateContract(relaxed).status, "passed");
  const bounded = fidelityContract(); bounded.visual_validation = { mode: "usability" };
  bounded.critical_alignments[0].runtime_measurement.x += 2; bounded.critical_alignments[0].delta.x = 2;
  assert.equal(validateContract(bounded).status, "passed");
  bounded.critical_alignments[0].tolerance.unit = "percent";
  assertFailed(bounded, "tolerance.unit 必须是");
});
test("specified 冻结目标合同允许尚无运行测量和 parity", () => { const result = validateContract(fidelityContract("specified")); assert.equal(result.status, "passed", JSON.stringify(result)); });
test("frozen-target 缺少 scene_reconstruction_binding 必须失败，普通布局无需绑定", () => { const frozen = fidelityContract("specified"); delete frozen.scene_reconstruction_binding; assertFailed(frozen, "scene_reconstruction_binding 缺失"); const ordinary = copy(); delete ordinary.scene_reconstruction_binding; assert.equal(validateContract(ordinary).status, "passed"); });
test("actual_test_id 仅在 verified 必需", () => { const document = fidelityContract(); delete document.critical_alignments[0].actual_test_id; assertFailed(document, "actual_test_id 必须"); });
test("verified 身份必须与 scope、合同和基线一致", () => { const scene = fidelityContract(); scene.parity_cases[0].scene_id = "Unknown"; assertFailed(scene, "scene_id 不在 scope"); const layout = fidelityContract(); layout.parity_cases[0].layout_contract_version = "9"; assertFailed(layout, "根 contract_version 不一致"); const baseline = fidelityContract(); baseline.parity_cases[0].visual_baseline_version = "other"; assertFailed(baseline, "与冻结目标不一致"); const testId = fidelityContract(); testId.critical_alignments[0].actual_test_id = "other-test"; assertFailed(testId, "必须等于 planned_test_id"); });
test("关键对齐缺关系或 verified 缺运行测量失败", () => { const relation = fidelityContract("specified"); delete relation.critical_alignments[0].horizontal; assertFailed(relation, "horizontal 缺少关系"); const measurement = fidelityContract(); delete measurement.critical_alignments[0].runtime_measurement; assertFailed(measurement, "runtime_measurement 必须包含数值"); });
test("关键对齐未知 UI ID 与未执行测试失败", () => { const unknown = fidelityContract(); unknown.critical_alignments[0].element_id = "unknown-ui"; assertFailed(unknown, "element_id 引用未知 UI ID"); const untested = fidelityContract(); untested.critical_alignments[0].test_status = "not-run"; assertFailed(untested, "未执行测试不得通过"); });
test("关键对齐摘要缺失或陈旧不阻断人工验收", () => { const document = fidelityContract(); delete document.critical_alignments[0].target_sha256; delete document.critical_alignments[0].candidate_sha256; document.frozen_visual_target.target_sha256 = "sha256:stale"; document.scope.bindings.code_candidate = "candidate-after-edit"; assert.equal(validateContract(document).status, "passed"); });
test("effect-image 布局节点必须完整绑定区域、坐标空间和目标视口", () => { const document = fidelityContract("specified"); assert.equal(validateContract(document).status, "passed"); const missing = fidelityContract("specified"); delete missing.layout_nodes[0].coordinate_space; assertFailed(missing, "coordinate_space 必须是非空字符串"); const orphan = fidelityContract("specified"); orphan.layout_nodes[0].region_id = "orphan-region"; assertFailed(orphan, "孤立布局节点"); const outOfBounds = fidelityContract("specified"); outOfBounds.layout_nodes[0].target_bounds.x = 300; assertFailed(outOfBounds, "target_bounds 必须完全位于"); });
test("effect-image 父子布局字段缺失或伪造必须失败", () => { for (const mutate of [node => delete node.parent_layout_node_id, node => { node.reference_id = "viewport"; }, node => { node.relative_position.left += 1; }, node => { node.axis_alignment.horizontal = "right"; }, node => { node.offset.x = 999; }, node => { node.self_anchor = "center-center"; }]) { const document = fidelityContract("specified"); mutate(document.layout_nodes[0]); assert.equal(validateContract(document).status, "failed"); } });
// 首节点显式承接装饰子项，测试区域一对多映射而不依靠子项反推容器。
test("同一 coverage region 可以绑定多个布局节点，且多节点区域参照必须具体化", () => { const sameRegion = fidelityContract("specified"); sameRegion.layout_nodes[0].is_container = true; sameRegion.layout_nodes.push({ ...structuredClone(sameRegion.layout_nodes[0]), layout_node_id: "hud.title-decoration", reference_id: "hud.title", parent_layout_node_id: "hud.title", parent_target_bounds: { x: 115, y: 32, width: 160, height: 48 }, relative_position: { left: 0, right: 0, top: 0, bottom: 0 }, axis_alignment: { horizontal: "center", vertical: "center" }, self_anchor: "center-center", reference_anchor: "center-center", offset: { x: 0, y: 0 } }); sameRegion.layout_annotation.layout_node_ids.push("hud.title-decoration"); sameRegion.layout_nodes = deriveLayoutExecutionPlans(sameRegion.layout_nodes); sameRegion.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(sameRegion); assert.equal(validateContract(sameRegion).status, "passed"); const ambiguousReference = structuredClone(sameRegion); ambiguousReference.layout_nodes[0].reference_id = "title"; assertFailed(ambiguousReference, "包含多个 layout_nodes 的 region"); const ambiguousAlignment = structuredClone(sameRegion); ambiguousAlignment.critical_alignments[0].reference_id = "title"; assertFailed(ambiguousAlignment, "包含多个 layout_nodes 的 region"); });
test("布局节点 ID 和稳定参照必须唯一且无环", () => { const duplicateNode = fidelityContract("specified"); duplicateNode.layout_nodes.push(structuredClone(duplicateNode.layout_nodes[0])); assertFailed(duplicateNode, "重复布局节点 ID"); const badReference = fidelityContract("specified"); badReference.layout_nodes[0].reference_id = "missing-reference"; assertFailed(badReference, "不存在的稳定参照"); const cycle = fidelityContract("specified"); cycle.layout_nodes.push({ ...structuredClone(cycle.layout_nodes[0]), layout_node_id: "hud.other", region_id: "content-panel", reference_id: "hud.title" }); cycle.layout_nodes[0].reference_id = "hud.other"; cycle.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(cycle); assertFailed(cycle, "布局节点参照存在循环"); });
test("关键对齐必须绑定节点几何，禁止目标漂移", () => { const document = fidelityContract("specified"); document.critical_alignments[0].target_measurement.x += 1; assertFailed(document, "目标几何漂移"); const missingNode = fidelityContract("specified"); missingNode.critical_alignments[0].layout_node_id = "missing-node"; assertFailed(missingNode, "引用未知布局节点"); });
test("布局节点变化会改变可选摘要，陈旧合同摘要不阻断但实际几何关系仍校验", () => { const document = fidelityContract("specified"); assert.equal(document.scene_reconstruction_binding.layout_contract_sha256, computeLayoutContractIdentityHash(document)); const second = { ...structuredClone(document.layout_nodes[0]), layout_node_id: "hud.second", reference_id: "hud.title", parent_layout_node_id: "hud.title", parent_target_bounds: { x: 115, y: 32, width: 160, height: 48 }, relative_position: { left: 0, right: 0, top: 0, bottom: 0 }, axis_alignment: { horizontal: "center", vertical: "center" }, self_anchor: "center-center", reference_anchor: "center-center", offset: { x: 0, y: 0 } }; const ordered = structuredClone(document); ordered.layout_nodes.push(second); const reordered = structuredClone(ordered); reordered.layout_nodes.reverse(); assert.notEqual(computeLayoutContractIdentityHash(reordered), computeLayoutContractIdentityHash(ordered)); const stale = fidelityContract("specified"); stale.scene_reconstruction_binding.layout_contract_sha256 = "sha256:stale"; assert.notEqual(computeLayoutContractIdentityHash(stale), stale.scene_reconstruction_binding.layout_contract_sha256); assert.equal(validateContract(stale).status, "passed"); const geometryDrift = fidelityContract("specified"); geometryDrift.layout_nodes[0].target_bounds.x += 1; assert.notEqual(computeLayoutContractIdentityHash(geometryDrift), geometryDrift.scene_reconstruction_binding.layout_contract_sha256); assert.equal(validateContract(geometryDrift).status, "failed", "真实布局几何与绑定关系仍然校验"); });
test("布局合同身份哈希包含父子关系、相对距离和视觉对齐字段", () => { const document = fidelityContract("specified"); const identity = document.scene_reconstruction_binding.layout_contract_sha256; for (const field of ["parent_layout_node_id", "parent_target_bounds", "relative_position", "axis_alignment"]) { const tampered = fidelityContract("specified"); if (field === "parent_layout_node_id") tampered.layout_nodes[0][field] = "viewport"; else if (field === "parent_target_bounds") tampered.layout_nodes[0][field].width -= 1; else if (field === "relative_position") tampered.layout_nodes[0][field].left += 1; else tampered.layout_nodes[0][field].horizontal = "right"; assert.notEqual(computeLayoutContractIdentityHash(tampered), identity, field); } });
test("布局职责变化不因摘要陈旧而被摘要门拒绝", () => { const document = fidelityContract("specified"); const identity = document.scene_reconstruction_binding.layout_contract_sha256; const changed = fidelityContract("specified"); changed.layout_nodes[0].ui_layout.safe_area_policy = "FULL_BLEED"; assert.notEqual(computeLayoutContractIdentityHash(changed), identity); assert.equal(validateContract(changed).status, "passed"); });

test("最终效果图合同必须保留可复算的布局执行计划", () => {
  const missing = fidelityContract("specified");
  delete missing.layout_nodes[0].layout_execution;
  assertFailed(missing, "layout_execution 缺失");
  const changed = fidelityContract("specified");
  changed.layout_nodes[0].layout_execution.position_driver = "WIDGET";
  changed.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(changed);
  assertFailed(changed, "layout_execution 与节点事实派生结果不一致");
});

test("verified布局合同必须核对运行时组件，specified不要求提前采集", () => {
  const specified = fidelityContract("specified");
  delete specified.component_snapshots;
  assert.equal(validateContract(specified).status, "passed");
  const verified = fidelityContract();
  delete verified.component_snapshots;
  assertFailed(verified, "component_snapshots 必须是组件快照数组");
  const conflicting = fidelityContract();
  conflicting.component_snapshots[0].component_snapshot.parent_layout = { enabled: true, type: "VERTICAL", resize_mode: "CHILDREN", align_horizontal: false, align_vertical: false };
  assertFailed(conflicting, "父 Layout 会重排");
  const offCenter = fidelityContract();
  offCenter.visual_validation = { mode: "usability" };
  offCenter.component_snapshots[0].component_snapshot.layout_bounds.x += 1;
  assertFailed(offCenter, "必须严格居中");
});

test("节点职责要求合法枚举、非根分组依据和空容器职责", () => {
  const valid = { grouping_basis: ["LAYOUT"], layout_owner: "SELF", size_policy: "FLEX", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" };
  const cases = [
    [undefined, { rootParent: false, container: false }, "必须显式声明"],
    [{ ...valid, grouping_basis: ["UNKNOWN"] }, { rootParent: false, container: false }, "不重复的 POSITION/LAYOUT"],
    [{ ...valid, layout_owner: "CHILD" }, { rootParent: false, container: false }, "layout_owner"],
    [{ ...valid, grouping_basis: [] }, { rootParent: false, container: false }, "必须说明与实际父节点的依赖"],
    [{ ...valid, grouping_basis: ["POSITION"] }, { rootParent: false, container: true, emptyContainer: true }, "空容器必须有可解释的布局、状态或复用职责"],
    [{ ...valid, minimum_size: { width: 0, height: 12 } }, { rootParent: false, container: false }, "minimum_size 必须包含正数"],
    [{ ...valid, overflow_policy: "SCROLL", grouping_basis: ["POSITION"] }, { rootParent: false, container: true }, "SCROLL 必须由负责布局的容器承接"],
  ];
  for (const [uiLayout, options, expected] of cases) {
    const errors = []; validateUiLayout(uiLayout, options, errors, "node.ui_layout");
    assert(errors.some((message) => message.includes(expected)), `${expected}: ${errors.join("；")}`);
  }
  const rootWithoutDependency = { ...valid, grouping_basis: [] }; const rootErrors = [];
  validateUiLayout(rootWithoutDependency, { rootParent: true, container: false }, rootErrors, "root.ui_layout");
  assert.deepEqual(rootErrors, []);
});

test("输入委托必须命中唯一的 HIT_TARGET 祖先", () => {
  const delegatedChild = { grouping_basis: ["INTERACTION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "DELEGATE_TO_PARENT" };
  const ordinaryParent = { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" };
  const missingTarget = [];
  validateUiInteractionTree([{ element_id: "icon", parent_element_id: "button", ui_layout: delegatedChild }, { element_id: "button", parent_element_id: "viewport", ui_layout: ordinaryParent }], missingTarget);
  assert(missingTarget.some((message) => message.includes("缺少接收输入的 HIT_TARGET 祖先")), missingTarget.join("；"));

  const nestedTargets = [];
  validateUiInteractionTree([{ element_id: "button", parent_element_id: "viewport", ui_layout: { ...ordinaryParent, interaction_policy: "HIT_TARGET" } }, { element_id: "icon", parent_element_id: "button", ui_layout: { ...delegatedChild, interaction_policy: "HIT_TARGET" } }], nestedTargets);
  assert(nestedTargets.some((message) => message.includes("不能嵌套另一个 HIT_TARGET")), nestedTargets.join("；"));
});

test("独立布局合同拒绝没有 HIT_TARGET 祖先的委托节点", () => {
  const document = fidelityContract("specified");
  const parent = document.layout_nodes[0];
  document.layout_nodes.push({
    ...structuredClone(parent), layout_node_id: "hud.title-icon", reference_id: "hud.title", parent_layout_node_id: "hud.title",
    parent_target_bounds: { ...parent.target_bounds }, relative_position: { left: 4, right: 140, top: 4, bottom: 32 },
    target_bounds: { x: 119, y: 36, width: 16, height: 12 }, offset: { x: 4, y: 4 },
    ui_layout: { ...parent.ui_layout, grouping_basis: ["INTERACTION"], layout_owner: "PARENT", interaction_policy: "DELEGATE_TO_PARENT" },
  });
  document.layout_annotation.layout_node_ids.push("hud.title-icon");
  document.scene_reconstruction_binding.layout_contract_sha256 = computeLayoutContractIdentityHash(document);
  const result = validateContract(document);
  assert.equal(result.status, "failed", JSON.stringify(result));
  assert(result.errors.some((message) => message.includes("缺少接收输入的 HIT_TARGET 祖先")), JSON.stringify(result));
});
test("verified 关键对齐必须记录实际 bounds、delta 和运行证据，合同摘要可缺省", () => { const missingDelta = fidelityContract(); delete missingDelta.critical_alignments[0].delta; assertFailed(missingDelta, "delta 必须"); const wrongDelta = fidelityContract(); wrongDelta.critical_alignments[0].delta.x = 1; assertFailed(wrongDelta, "必须等于 runtime_measurement"); const missingBindingIdentity = fidelityContract("specified"); delete missingBindingIdentity.scene_reconstruction_binding.layout_contract_sha256; assert.equal(validateContract(missingBindingIdentity).status, "passed"); });
test("目标与候选摘要格式、缺失和陈旧值不构成验收门", () => { const code = copy(); code.scope.bindings.code_candidate = "git:abc"; assert.equal(validateContract(code).status, "passed"); const target = fidelityContract("specified"); target.frozen_visual_target.target_sha256 = "sha256:BAD"; delete target.scene_reconstruction_binding.target_sha256; target.layout_annotation.layout_annotation_sha256 = "stale"; assert.equal(validateContract(target).status, "passed"); });
test("verified parity 仍验证状态和实质证据，但不比较 SHA", () => { const target = fidelityContract(); target.parity_cases[0].target_sha256 = `sha256:${"e".repeat(64)}`; delete target.parity_cases[0].candidate_sha256; assert.equal(validateContract(target).status, "passed"); const failed = fidelityContract(); failed.parity_cases[0].conclusion = "failed"; assertFailed(failed, "必须全部 passed"); const evidence = fidelityContract(); evidence.parity_cases[0].candidate_evidence = []; assertFailed(evidence, "candidate_evidence 必须是非空字符串数组"); });
test("布局 parity DPR 允许动态有效值并拒绝越界或隐式值", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5, 2]) { const document = fidelityContract(); document.parity_cases[0].dpr = dpr; assert.equal(validateContract(document).status, "passed", `dpr=${dpr}`); }
  for (const dpr of [0, -1, 2.0001, 3, "2", NaN, Infinity]) { const document = fidelityContract(); document.parity_cases[0].dpr = dpr; assertFailed(document, "必须是正有限数字且不超过 2"); }
});
test("响应式合同使用动态封顶策略并保留运行时上限", () => {
  const invalidPolicy = copy(); invalidPolicy.runtimeDprPolicy.policy = "fixed-2"; assertFailed(invalidPolicy, "runtimeDprPolicy.policy 必须为 dynamic-capped-2");
  const invalidMax = copy(); invalidMax.maxRuntimeDpr = 1.5; assertFailed(invalidMax, "maxRuntimeDpr 必须严格为 2");
  const legacyDpr = copy(); legacyDpr.representativeViewports[0].effectiveDpr = 2.0001; assertFailed(legacyDpr, "必须是正有限数字且不超过 2");
  const valid = copy(); valid.representativeViewports[0].effectiveDpr = 1; assert.equal(validateContract(valid).status, "passed");
});
test("固定横竖屏设计分辨率、主轴适配与背景 cover 不可缺失", () => {
  const portrait = copy(); portrait.designResolutionPolicy.portrait.width = 720; assertFailed(portrait, "portrait 必须为 1080×1920");
  const landscape = copy(); landscape.designResolutionPolicy.landscape.fitAxis = "width"; assertFailed(landscape, "landscape 必须为 1920×1080");
  const bars = copy(); bars.scaleMode = "FIT"; assertFailed(bars, "Canvas 填满真实 CSS 视口");
  const cover = copy(); cover.designResolutionPolicy.backgroundFit.mode = "contain"; assertFailed(cover, "背景需等比覆盖可见视口");
  const focus = copy(); focus.designResolutionPolicy.backgroundFit.sourceFocalPoint.x = 2; assertFailed(focus, "sourceFocalPoint 必须包含 [0,1]");
  const crossAxis = copy(); crossAxis.designResolutionPolicy.crossAxis = "fixed"; assertFailed(crossAxis, "crossAxis 必须为 extend-or-crop");
});
test("单方向合同只要求支持方向设计基准、视口类别和重排事件", () => {
  for (const orientation of ["portrait", "landscape"]) {
    const document = restrictToOrientation(copy(), orientation);
    assert.equal(validateContract(document).status, "passed", `${orientation}: ${JSON.stringify(validateContract(document))}`);
    const exact = restrictToOrientation(copy(), orientation);
    exact.visual_validation = { mode: "exact" };
    exact.evidence_matrix.required_axes = exact.evidence_matrix.required_axes.filter((axis) => axis !== "orientation");
    assert.equal(validateContract(exact).status, "passed", `${orientation} exact: ${JSON.stringify(validateContract(exact))}`);
  }
});
test("双方向仍要求双方设计基准、代表视口、方向切换事件和 exact 方向轴", () => {
  const missingDesign = copy(); delete missingDesign.designResolutionPolicy.landscape; assertFailed(missingDesign, "designResolutionPolicy.landscape 必须为");
  const missingViewport = copy(); missingViewport.representativeViewports = missingViewport.representativeViewports.filter((item) => item.kind !== "landscape"); assertFailed(missingViewport, "缺少代表性视口：landscape");
  const missingEvent = copy(); missingEvent.resizePolicy.events = missingEvent.resizePolicy.events.filter((event) => event !== "orientation-change"); assertFailed(missingEvent, "resizePolicy.events 缺少必需项：orientation-change");
  const missingAxis = fidelityContract(); missingAxis.evidence_matrix.required_axes = missingAxis.evidence_matrix.required_axes.filter((axis) => axis !== "orientation"); assertFailed(missingAxis, "required_axes 缺少必需轴：orientation");
});
test("方向声明非法、视口标签与几何不一致或 exact parity 超出支持方向时失败", () => {
  for (const allowed of [[], ["portrait", "portrait"], ["diagonal"], "portrait-only"]) {
    const invalid = copy(); invalid.orientationPolicy.allowed = allowed; assertFailed(invalid, "orientationPolicy.allowed 必须是非空且不重复的 portrait/landscape 数组");
  }
  const mismatch = copy(); mismatch.representativeViewports[0].orientation = "landscape"; assertFailed(mismatch, "与 width/height 实测方向不一致");
  const wrongKind = copy(); wrongKind.representativeViewports[0].width = 400; assertFailed(wrongKind, "代表视口方向或尺寸不一致");
  const unsupportedTarget = restrictToOrientation(copy(), "portrait"); unsupportedTarget.targets.orientations.push("landscape"); assertFailed(unsupportedTarget, "targets.orientations 必须与 orientationPolicy.allowed 一致");
  const targetGeometry = restrictToOrientation(copy(), "portrait"); targetGeometry.targets.preferred.width = 1200; assertFailed(targetGeometry, "targets.preferred.orientation 与 width/height 实测方向不一致");
  const unsupportedParity = restrictToOrientation(fidelityContract(), "portrait"); unsupportedParity.parity_cases[0].viewport = { width: 844, height: 390 }; assertFailed(unsupportedParity, "viewport 的方向超出 orientationPolicy.allowed 支持范围");
});
test("设计分辨率变更不因合同摘要陈旧而阻断验收", () => {
  const document = fidelityContract("specified");
  document.designResolutionPolicy.backgroundFit.targetPoint.x = 0.25;
  assert.equal(validateContract(document).status, "passed");
});
test("布局 evidence matrix 扩展 case 的 DPR 允许有效值但拒绝非法值", () => {
  const valid = copy(); valid.evidence_matrix.cases = [{ dpr: 1 }, { deviceScaleFactor: 1.5 }]; assert.equal(validateContract(valid).status, "passed");
  const invalid = copy(); invalid.evidence_matrix.cases = [{ dpr: 0 }, { deviceScaleFactor: "2" }]; assertFailed(invalid, "evidence_matrix");
});
test("高分屏响应式根合同字段不可缺失", () => {
  for (const field of ["logicalViewportSpace", "designResolutionPolicy", "canvasBackingPolicy", "runtimeDprPolicy", "maxRuntimeDpr", "scaleMode", "cameraViewportPolicy", "cameraZoomPolicy", "cameraOriginPolicy", "inputCoordinatePolicy", "safeAreaPolicy", "resizePolicy", "orientationPolicy", "textResolutionPolicy", "assetResolutionPolicy", "performanceBudget", "representativeViewports", "requiredRuntimeEvidence"]) {
    const document = copy(); delete document[field]; assertFailed(document, `缺少根字段：${field}`);
  }
});
test("布局只能使用 CSS 逻辑像素，backing 必须绑定有效 DPR", () => {
  const physical = copy(); physical.logicalViewportSpace.layoutSpace = "physical-px"; assertFailed(physical, "logicalViewportSpace.layoutSpace 必须为 css-logical-px");
  const hardcoded = copy(); hardcoded.canvasBackingPolicy.physicalPixelLayout = "allowed"; assertFailed(hardcoded, "不能用物理像素硬编码布局");
  const relation = copy(); relation.canvasBackingPolicy.widthFormula = "cssWidth * 2"; assertFailed(relation, "必须表达 backing=CSS逻辑尺寸×effectiveDPR");
});
test("Camera、zoom、origin 和输入坐标合同必须完整", () => {
  const camera = copy(); delete camera.cameraViewportPolicy.physicalMapping; assertFailed(camera, "cameraViewportPolicy 缺少字段：physicalMapping");
  const zoom = copy(); zoom.cameraZoomPolicy.dprIndependent = false; assertFailed(zoom, "cameraZoomPolicy.dprIndependent 必须为 true");
  const origin = copy(); origin.cameraOriginPolicy.implicitOrigin = "allowed"; assertFailed(origin, "cameraOriginPolicy.implicitOrigin 必须为 forbidden");
  const input = copy(); input.inputCoordinatePolicy.mapping = "physical pixels"; assertFailed(input, "inputCoordinatePolicy.mapping 必须完整声明");
});
test("默认代表性矩阵覆盖视口、DPR 封顶和 DISPLAY_LAYER 运行证据", () => {
  const missingViewport = copy(); missingViewport.representativeViewports = missingViewport.representativeViewports.slice(0, 3); assertFailed(missingViewport, "缺少代表性视口：desktop-wide");
  const invalidRaw = copy(); invalidRaw.representativeViewports[0].rawDpr = "1"; assertFailed(invalidRaw, "rawDpr 必须是正有限数字");
  const invalidCap = copy(); invalidCap.representativeViewports[3].effectiveDpr = 1.5; assertFailed(invalidCap, "必须封顶为 2");
  const missingEvidence = copy(); missingEvidence.requiredRuntimeEvidence.requiredFields = missingEvidence.requiredRuntimeEvidence.requiredFields.filter((field) => field !== "inputHitResults"); assertFailed(missingEvidence, "requiredRuntimeEvidence.requiredFields 缺少必需项：inputHitResults");
  const sharedEvidence = copy(); sharedEvidence.requiredRuntimeEvidence.displayLayerTrajectory.independentEvidence = false; assertFailed(sharedEvidence, "DISPLAY_LAYER 轨迹的 independentEvidence 必须为 true");
});
test("图片生产 DPR 与运行时 DPR 必须分离", () => {
  const mixed = copy(); mixed.runtimeDprPolicy.productionDpr = 1.5; assertFailed(mixed, "运行时与资源生产必须分离");
  for (const productionDpr of [1.5, 2]) {
    const wrongProduction = copy(); wrongProduction.assetResolutionPolicy.productionDpr = productionDpr;
    // 2 是旧双倍倍率；生产基线改为 1 后，两者都必须被拒绝。
    assertFailed(wrongProduction, "assetResolutionPolicy.productionDpr 必须严格为图片生产基线 1");
  }
  const quiet = copy(); quiet.assetResolutionPolicy.upscaleAsClarityFix = "allowed"; assertFailed(quiet, "插值放大不是清晰度修复");
});
test("关键对齐与 parity ID 必须唯一", () => { const alignment = fidelityContract(); alignment.critical_alignments.push(structuredClone(alignment.critical_alignments[0])); assertFailed(alignment, "id 重复"); const parity = fidelityContract(); parity.parity_cases.push(structuredClone(parity.parity_cases[0])); assertFailed(parity, "id 重复"); });
test("缺少坐标空间失败", () => { const document = copy(); document.coordinate_spaces = []; assertFailed(document, "coordinate_spaces 必须是非空数组"); });
test("坐标空间循环失败", () => { const document = copy(); document.coordinate_spaces[0].parent = "ui-space"; document.coordinate_spaces[1].parent = "screen-space"; assertFailed(document, "坐标空间存在循环"); });
test("范围区域 ID 必须一致", () => { const document = copy(); document.scope.ui_ids.splice(document.scope.ui_ids.indexOf("title"), 1); assertFailed(document, "scope.ui_ids 缺少 regions ID"); });
test("水平和垂直锚点均必需", () => { for (const axis of ["horizontal", "vertical"]) { const document = copy(); delete document.regions[0].anchors[axis]; assertFailed(document, `anchors.${axis} 缺失`); } });
/** 验证资源原点默认居中，非中心例外必须携带可复核的布局换算依据。 */
test("显示对象默认中心原点，非中心例外须说明原因与坐标换算", () => {
  const missing = copy(); missing.regions[2].origin = "top-left"; assertFailed(missing, "origin 非中心时必须声明");
  const declared = copy(); declared.regions[2].origin = "top-left"; declared.regions[2].origin_exception = { reason: "图集裁切边缘需要固定", coordinate_conversion: "中心位置减去半个显示宽高" }; assert.equal(validateContract(declared).status, "passed");
  const leftAlignedBoundary = copy(); leftAlignedBoundary.regions[0].layout_anchor = "top-left"; assert.equal(validateContract(leftAlignedBoundary).status, "passed");
  const layoutOnly = copy(); layoutOnly.regions[0].origin = "center"; assertFailed(layoutOnly, "layout-only 时必须为 not-applicable");
  const noResourceOrigin = copy(); noResourceOrigin.regions[2].origin = "not-applicable"; assertFailed(noResourceOrigin, "display-object 时必须声明资源原点");
  const missingKind = copy(); delete missingKind.regions[2].origin_applicability; assertFailed(missingKind, "origin_applicability 必须为");
});
test("不存在的参照失败", () => { const document = copy(); document.regions[1].reference_id = "not-found"; assertFailed(document, "不存在的 reference_id"); });
test("区域参照循环失败", () => { const document = copy(); document.regions[2].reference_id = "content-panel"; document.regions[3].reference_id = "title"; assertFailed(document, "区域参照存在循环"); });
test("缺少和重复滚动所有者失败", () => { const missing = copy(); delete missing.scrolling.axes; assertFailed(missing, "scrolling.axes 必须是数组"); const duplicate = copy(); duplicate.scrolling.axes.push(structuredClone(duplicate.scrolling.axes[0])); assertFailed(duplicate, "滚动轴存在多个所有者"); });
test("普通静态 HUD 允许无断点、滚动轴和关键动作", () => { const document = copy(); document.breakpoints = []; document.scrolling.axes = []; document.dynamic_content.key_actions = []; assert.equal(validateContract(document).status, "passed"); });
test("关键动作禁止截断", () => { const document = copy(); document.dynamic_content.key_actions[0].text_truncation = "allow"; assertFailed(document, "关键动作禁止文本截断"); });
test("程序化文本强制五语种、逐语言行布局和游戏化文案合同", () => {
  const languages = copy(); languages.dynamic_content.localization.required_languages = ["en", "zh-CN", "ja", "ru"]; assertFailed(languages, "缺少程序化文本必需语言：es");
  const wrap = copy(); delete wrap.dynamic_content.localization.wrap.ru; assertFailed(wrap, "wrap.ru 必须为 single-line 或 wrap");
  const invalidWrap = copy(); invalidWrap.dynamic_content.localization.wrap.es = "truncate"; assertFailed(invalidWrap, "wrap.es 必须为 single-line 或 wrap");
  const truncate = copy(); truncate.dynamic_content.localization.truncate_policy = "forbid-critical"; assertFailed(truncate, "程序化文本禁止截断");
  const style = copy(); style.dynamic_content.localization.copy_style = "descriptive"; assertFailed(style, "copy_style 必须为 concise-gameplay");
  const multiplier = copy(); multiplier.dynamic_content.localization.multiplier_format = "{value}倍"; assertFailed(multiplier, "multiplier_format 必须为 x{value}");
  const evidence = copy(); evidence.evidence_matrix.required_axes = evidence.evidence_matrix.required_axes.filter((axis) => axis !== "localization"); assertFailed(evidence, "必须包含 localization");
});
test("覆盖层缺少回退失败", () => { const document = copy(); delete document.overlay_rules[0].fallback; assertFailed(document, "fallback 必须声明回退规则"); });
test("特殊布局缺少覆盖规则失败", () => { const document = copy(); document.regions[5].layout_participation = "fixed-overlay"; assertFailed(document, "fixed-overlay 缺少对应 overlay_rules"); });
test("不变量必须具备两类证据", () => { const document = copy(); document.invariants[0].evidence.visual = []; assertFailed(document, "evidence.visual 必须是非空数组"); });
test("重复 UI ID 失败", () => { const document = copy(); document.scope.ui_ids.push("title"); assertFailed(document, "重复 UI ID"); });
test("exact 证据矩阵缺少必需轴失败", () => { const document = copy(); document.visual_validation = { mode: "exact" }; document.evidence_matrix.required_axes.splice(document.evidence_matrix.required_axes.indexOf("dpr"), 1); assertFailed(document, "required_axes 缺少必需轴"); });
test("无效断点条件失败", () => { const document = copy(); document.breakpoints[0].when = { width_lt: null }; assertFailed(document, "when 必须包含非空键和有效值"); });
test("绝对和固定布局触发专项审查", () => { const document = copy(); document.regions[2].positioning = "absolute"; document.regions[2].size.strategy = "fixed"; const result = validateContract(document); assert.equal(result.status, "passed", JSON.stringify(result)); assert(result.specialized_review.includes("title:absolute-positioning")); assert(result.specialized_review.includes("title:fixed-size")); });
test("CLI 对无效合同返回非零", async () => { const document = copy(); delete document.regions[0].anchors.horizontal; const directory = await mkdtemp(join(tmpdir(), "layout-contract-")); const path = join(directory, "contract.yaml"); await writeFile(path, JSON.stringify(document)); assert.notEqual(await main([path]), 0); });
test("布局文件检查忽略摘要状态但仍拒绝缺文件和路径逃逸", async () => { const root = await mkdtemp(join(tmpdir(), "layout-files-")); const document = fidelityContract(); assert((await checkContractFiles(document, root)).some((item) => item.includes("文件不存在"))); const files = ["evidence/target.png", "evidence/layout-annotation.png", "evidence/automatic-layout-decision.json", "evidence/target-title.png", "evidence/runtime-title.png", "evidence/candidate.png"]; for (const value of files) { const path = join(root, value); await mkdir(dirname(path), { recursive: true }); await writeFile(path, ""); } document.frozen_visual_target.target_sha256 = "sha256:stale"; document.layout_annotation.layout_annotation_sha256 = "invalid"; document.layout_annotation.layout_decision_sha256 = ""; assert.deepEqual(await checkContractFiles(document, root), []); document.critical_alignments[0].target_evidence = ["../escape.png"]; assert((await checkContractFiles(document, root)).some((item) => item.includes("路径逃逸"))); });
