import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { decodePngRgba, encodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { computeLayoutAnnotationIdentitySha256, deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements, renderLayoutAnnotation } from "../../cocos-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { buildLayoutNodesDocument, buildLayoutReviewBindings, computeLayoutReviewIdentitySha256, deriveLayoutReviewArtifactPaths, renderLayoutReviewBundle, serializeJson, sha256 } from "../../cocos-game-asset-integration/scripts/layout_review_bundle.mjs";
import { readLayoutReviewPayload } from "../../cocos-game-asset-integration/scripts/layout_review_page.mjs";
import { validateAutomaticLayoutDecision } from "../../cocos-game-asset-integration/scripts/automatic-layout-decision.mjs";
import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256, validateLayoutAnnotationConfirmation } from "./layout_annotation_confirmation.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造结构完整的布局确认；确认 SHA 由不含自身的稳定投影计算。 */
function confirmation(overrides = {}) {
  const base = {
    confirmation_schema: "layout-annotation-confirmation/1.0", confirmation_id: "layout-confirmation-1", status: "accepted", confirmation_mode: "manual",
    layout_annotation_file: "evidence/v2/layout.png", layout_annotation_sha256: SHA, layout_annotation_width: 64, layout_annotation_height: 48,
    layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA,
    layout_review_file: "evidence/v2/review.html", layout_review_sha256: SHA, layout_review_identity_sha256: SHA, layout_nodes_file: "evidence/v2/layout-nodes.json", layout_nodes_sha256: SHA,
    decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default",
    user_original_text: "确认布局图", user_message_sha256: computeLayoutUserMessageSha256("确认布局图"), decision_record_file: "evidence/v2/layout-decision-record.json", decision_record_sha256: SHA,
    user_decision_receipt_file: "evidence/v2/layout-receipt.json", user_decision_receipt_sha256: SHA, accepted_at: "2026-01-01T00:00:00Z",
  };
  const result = { ...base, ...overrides };
  return { ...result, confirmation_sha256: computeLayoutAnnotationConfirmationSha256(result) };
}

/** 构造文件级布局确认链，覆盖 PNG、审阅页、节点 JSON、decision 和 receipt。 */
async function fileBackedConfirmation({ centerAlignmentById = {}, extraMeasuredNodes = [] } = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), "layout-confirmation-"));
  const original = encodePngRgba(64, 48, Buffer.alloc(64 * 48 * 4, 220)); const targetSha = sha256(original); const referenceFile = "reference.png"; await writeFile(join(projectRoot, referenceFile), original);
  const measuredNodes = [{ layout_node_id: "panel", element_id: "panel", element_type: "container", parent_element_id: "viewport", parent_layout_node_id: "viewport", semantic_grouping: { kind: "region", rationale: "组织对话框中的独立入口" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, region_id: "panel-region", component_id: "panel", placement_id: "panel-placement", target_bounds: { x: 2, y: 2, width: 16, height: 12 }, layout_role: "container", axis_alignment: { horizontal: "center", vertical: "center" } }, { layout_node_id: "button", element_id: "button", element_type: "component", parent_element_id: "panel", parent_layout_node_id: "panel", semantic_grouping: { kind: "standalone", rationale: "完整按钮在区域内独立布局" }, ui_layout: { grouping_basis: ["INTERACTION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "HIT_TARGET" }, region_id: "panel-region", component_id: "button", placement_id: "button-placement", target_bounds: { x: 5, y: 5, width: 6, height: 4 }, node_type: "element", axis_alignment: { horizontal: "center", vertical: "center" } }, ...extraMeasuredNodes];
  const elements = measuredNodes.map((node) => ({ element_id: node.element_id, element_type: node.element_type, role: node.layout_role ?? node.node_type, bounds: { ...node.target_bounds }, scene_id: "main", state_id: "default", region_id: "panel-region", component_id: node.component_id, placement_id: node.placement_id, parent_element_id: node.parent_element_id, semantic_grouping: node.semantic_grouping, ui_layout: node.ui_layout, empty_container: node.element_type === "container" ? false : false }));
  const upstreamSha = `sha256:${"b".repeat(64)}`; const proposalFile = "evidence/v2/proposal.json"; const proposal = { proposal_id: "proposal-1", target_sha256: targetSha, scene_id: "main", state_id: "default", annotation_file: "evidence/v2/decomposition.png", annotation_sha256: upstreamSha, created_at: "2025-12-31T23:00:00Z", decomposition_elements: elements, technical_analysis: { decomposition_elements: elements, regions: [{ region_id: "panel-region", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 64, height: 48 }, decomposition_elements: elements }] }, regions: [{ region_id: "panel-region", scene_id: "main", state_id: "default" }] }; const proposalBytes = Buffer.from(JSON.stringify(proposal), "utf8"); const proposalSha = sha256(proposalBytes); await mkdir(dirname(join(projectRoot, proposalFile)), { recursive: true }); await writeFile(join(projectRoot, proposalFile), proposalBytes);
  const layoutDecisionFile = "evidence/v2/automatic-layout-decision.json"; const layoutDecision = { decision_schema: "automatic-layout-decision/1.0", decision_id: "layout-decision-1", decision_method: "visual-judgement", target_sha256: targetSha, scene_id: "main", state_id: "default", decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: upstreamSha, proposal_sha256: proposalSha, elements: measuredNodes.map((node) => ({ element_id: node.element_id, horizontal_alignment: node.axis_alignment.horizontal, vertical_alignment: node.axis_alignment.vertical, ...(centerAlignmentById[node.element_id] !== undefined ? { center_alignment: centerAlignmentById[node.element_id] } : {}) })) }; const layoutDecisionBytes = serializeJson(layoutDecision); await writeFile(join(projectRoot, layoutDecisionFile), layoutDecisionBytes); const layoutDecisionSha = sha256(layoutDecisionBytes);
  const decisionErrors = []; const alignmentDecisions = validateAutomaticLayoutDecision(layoutDecision, { elements, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1" }, decisionErrors); assert.deepEqual(decisionErrors, []);
  const nodes = deriveLayoutNodesFromDecompositionElements(elements, { width: 64, height: 48 }, { sceneId: "main", stateId: "default", alignmentDecisions });
  const facts = deriveAutomaticLayoutFacts(nodes, { width: 64, height: 48 }, { sceneId: "main", stateId: "default" });
  const rendered = renderLayoutAnnotation(original, { width: 64, height: 48 }, facts, { targetSha256: targetSha, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: upstreamSha, decompositionProposalSha256: proposalSha, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha });
  const imageFile = "evidence/v2/layout.png"; await writeFile(join(projectRoot, imageFile), rendered.bytes); const imageSha = sha256(rendered.bytes); const identitySha = computeLayoutAnnotationIdentitySha256(imageSha, rendered.width, rendered.height, rendered.metadataSha256);
  const paths = deriveLayoutReviewArtifactPaths(projectRoot, join(projectRoot, imageFile)); const context = { projectRoot, viewport: { width: 64, height: 48 }, targetSha256: targetSha, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: upstreamSha, proposalSha256: proposalSha, proposalFile, referenceFile, referenceSha256: targetSha, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha, annotationSha256: imageSha };
  const nodesDocument = buildLayoutNodesDocument(facts, context); const nodesBytes = serializeJson(nodesDocument); const nodesSha = sha256(nodesBytes); const bindings = buildLayoutReviewBindings(paths, { ...context, nodesSha256: nodesSha }); const reviewBytes = renderLayoutReviewBundle({ nodesDocument, bindings, originalBytes: original, annotationBytes: rendered.bytes, nodesBytes, decisionBytes: layoutDecisionBytes });
  const reviewFile = paths.reviewFile; await writeFile(join(projectRoot, paths.nodesFile), nodesBytes); await writeFile(join(projectRoot, paths.decisionFile), layoutDecisionBytes); await writeFile(join(projectRoot, reviewFile), reviewBytes); const reviewSha = sha256(reviewBytes); const reviewIdentitySha = computeLayoutReviewIdentitySha256(bindings);
  const decisionFile = "evidence/v2/layout-decision-record.json"; const userText = "确认布局图"; const binding = { layout_annotation_file: imageFile, layout_annotation_sha256: imageSha, layout_annotation_identity_sha256: identitySha, layout_review_file: reviewFile, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, layout_nodes_file: paths.nodesFile, layout_nodes_sha256: nodesSha, decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: upstreamSha, proposal_sha256: proposalSha, layout_decision_file: paths.decisionFile, layout_decision_sha256: layoutDecisionSha, layout_decision_id: layoutDecision.decision_id, target_sha256: targetSha, scene_id: "main", state_id: "default", user_statement: userText, user_message_sha256: computeLayoutUserMessageSha256(userText), accepted_at: "2026-01-01T00:00:00Z" };
  const decision = { author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", status: "accepted", confirmation_mode: "manual", confirmation_id: "layout-confirmation-1", ...binding }; const decisionRecordBytes = serializeJson(decision); await writeFile(join(projectRoot, decisionFile), decisionRecordBytes); const decisionSha = sha256(decisionRecordBytes);
  const receiptFile = "evidence/v2/layout-receipt.json"; const receipt = { message_id: "message-layout-1", thread_id: "thread-layout-1", author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", resolution_id: "resolution-layout-1", ...binding, decision_record_sha256: decisionSha }; const receiptBytes = serializeJson(receipt); await writeFile(join(projectRoot, receiptFile), receiptBytes); const receiptSha = sha256(receiptBytes);
  const record = confirmation({ layout_annotation_file: imageFile, layout_annotation_sha256: imageSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: identitySha, layout_review_file: reviewFile, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, layout_nodes_file: paths.nodesFile, layout_nodes_sha256: nodesSha, decomposition_confirmation_sha256: upstreamSha, proposal_sha256: proposalSha, layout_decision_file: paths.decisionFile, layout_decision_sha256: layoutDecisionSha, layout_decision_id: layoutDecision.decision_id, target_sha256: targetSha, decision_record_file: decisionFile, decision_record_sha256: decisionSha, user_decision_receipt_file: receiptFile, user_decision_receipt_sha256: receiptSha });
  return { projectRoot, record, decisionFile, receiptFile, layoutDecisionFile, context: { ...context, layoutNodes: nodes, checkFiles: true } };
}

const context = { targetSha256: SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, proposalSha256: SHA, checkFiles: false };

test("布局确认完整绑定最终布局图、审阅页和上游拆解", () => {
  const errors = [];
  validateLayoutAnnotationConfirmation(confirmation(), context, errors);
  assert.deepEqual(errors, []);
});

test("布局确认拒绝空 ID、文件、schema、时间和非正尺寸", () => {
  const errors = [];
  validateLayoutAnnotationConfirmation(confirmation({ confirmation_id: "", layout_annotation_file: "", layout_review_file: "", layout_nodes_file: "", layout_annotation_schema: "", accepted_at: "not-a-date", layout_annotation_width: 0, layout_annotation_height: -1 }), context, errors);
  assert(errors.some((item) => item.includes("confirmation_id 必须是非空字符串")));
  assert(errors.some((item) => item.includes("layout_annotation_file 必须是非空字符串")));
  assert(errors.some((item) => item.includes("schema")));
  assert(errors.some((item) => item.includes("accepted_at 必须是合法时间")));
  assert(errors.some((item) => item.includes("必须是正整数")));
});

test("布局确认摘要缺失或错误不阻断，但上游业务身份漂移仍失败", () => {
  const changed = confirmation({ confirmation_sha256: "stale", user_message_sha256: "missing-or-stale", layout_annotation_sha256: undefined });
  const errors = []; validateLayoutAnnotationConfirmation(changed, context, errors); assert.deepEqual(errors, []);
  const drift = []; validateLayoutAnnotationConfirmation(confirmation(), { ...context, decompositionConfirmationId: "decomp-drift" }, drift); assert(drift.some((item) => item.includes("上游身份")));
});

test("布局确认文件门拒绝伪造 decision，同时不以审阅页摘要变化阻断", async () => {
  const value = await fileBackedConfirmation();
  const decision = JSON.parse(await readFile(join(value.projectRoot, value.decisionFile), "utf8")); decision.author_role = "system"; await writeFile(join(value.projectRoot, value.decisionFile), JSON.stringify(decision)); const decisionErrors = []; validateLayoutAnnotationConfirmation(value.record, value.context, decisionErrors); assert(decisionErrors.some((item) => item.includes("decision_record") && item.includes("必须是 user 解除")));
  const fresh = await fileBackedConfirmation();
  const review = await readFile(join(fresh.projectRoot, fresh.record.layout_review_file)); await writeFile(join(fresh.projectRoot, fresh.record.layout_review_file), Buffer.concat([review, Buffer.from("\n<!-- harmless formatting change -->\n")]));
  const reviewErrors = []; validateLayoutAnnotationConfirmation(fresh.record, fresh.context, reviewErrors); assert.deepEqual(reviewErrors, []);
});

test("布局确认文件门拒绝伪造 user receipt 和空 JSON", async () => {
  const value = await fileBackedConfirmation(); const receipt = JSON.parse(await readFile(join(value.projectRoot, value.receiptFile), "utf8")); receipt.resolved_from = "SYSTEM"; await writeFile(join(value.projectRoot, value.receiptFile), JSON.stringify(receipt)); const receiptErrors = []; validateLayoutAnnotationConfirmation(value.record, value.context, receiptErrors); assert(receiptErrors.some((item) => item.includes("user_decision_receipt") && (item.includes("USER_INPUT_REQUIRED") || item.includes("SHA-256"))));
  for (const [fileKey, label] of [["decisionFile", "decision_record"], ["receiptFile", "user_decision_receipt"]]) { const fresh = await fileBackedConfirmation(); await writeFile(join(fresh.projectRoot, fresh[fileKey]), "{}"); const errors = []; validateLayoutAnnotationConfirmation(fresh.record, fresh.context, errors); assert(errors.some((item) => item.includes(label) && (item.includes("必须是 JSON 对象") || item.includes("必须是非空值") || item.includes("SHA-256")))); }
});

test("布局确认文件门通过真实 PNG、审阅页、节点 JSON、decision 和 receipt", async () => {
  const value = await fileBackedConfirmation(); const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert.deepEqual(errors, []);
});

test("proposal测量有误差时文件确认按strict重算居中且保留RAW尺寸", async () => {
  const value = await fileBackedConfirmation();
  const proposal = JSON.parse(await readFile(join(value.projectRoot, value.context.proposalFile), "utf8"));
  const nodesDocument = JSON.parse(await readFile(join(value.projectRoot, value.record.layout_nodes_file), "utf8"));
  const measuredPanel = proposal.decomposition_elements.find((element) => element.element_id === "panel").bounds;
  const finalPanel = nodesDocument.layout_nodes.find((node) => node.layout_node_id === "panel");
  assert.notEqual(finalPanel.target_bounds.x, measuredPanel.x, "布局候选应修正proposal中的测量偏差");
  assert.deepEqual(
    { width: finalPanel.target_bounds.width, height: finalPanel.target_bounds.height },
    { width: measuredPanel.width, height: measuredPanel.height },
    "严格居中只能调整位置，不得改变原始尺寸",
  );

  // 文件门必须能仅凭绑定 proposal 和 decision 复算，不能依赖调用方额外传入的布局节点。
  const { layoutNodes: _untrustedContextNodes, ...contextWithoutLayoutNodes } = value.context;
  const errors = [];
  validateLayoutAnnotationConfirmation(value.record, contextWithoutLayoutNodes, errors);
  assert.deepEqual(errors, []);
});

test("有理由的reference中心偏移可通过文件确认", async () => {
  const value = await fileBackedConfirmation({
    centerAlignmentById: {
      button: { horizontal: { mode: "reference", offset: 3, reason: "图标视觉重心向右补偿" } },
    },
  });
  const errors = [];
  validateLayoutAnnotationConfirmation(value.record, value.context, errors);
  assert.deepEqual(errors, []);
});

test("文件确认从proposal重算Widget执行计划，拒绝改参照或删除计划", async () => {
  const value = await fileBackedConfirmation();
  const nodesPath = join(value.projectRoot, value.record.layout_nodes_file);
  const original = JSON.parse(await readFile(nodesPath, "utf8"));
  assert.equal(original.layout_nodes[1].layout_execution.position_driver, "WIDGET");
  for (const remove of [false, true]) {
    const changed = structuredClone(original);
    if (remove) delete changed.layout_nodes[1].layout_execution;
    else changed.layout_nodes[1].layout_execution.widget.target_id = "button";
    await writeFile(nodesPath, serializeJson(changed));
    const errors = [];
    validateLayoutAnnotationConfirmation(value.record, value.context, errors);
    assert(errors.some((message) => message.includes("layout_execution") && message.includes("decision/proposal 重算")), errors.join("；"));
  }
});

test("绑定decision的图文虚拟组整体居中且广告角标独立", async () => {
  const value = await fileBackedConfirmation({
    centerAlignmentById: { button: { member_ids: ["button", "label"] } },
    extraMeasuredNodes: [
      { layout_node_id: "label", element_id: "label", element_type: "component", parent_element_id: "panel", parent_layout_node_id: "panel", semantic_grouping: { kind: "standalone", rationale: "按钮文字与主图标共同表达按钮功能" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE", position_reference_id: "button" }, region_id: "panel-region", component_id: "button", placement_id: "label-placement", target_bounds: { x: 12, y: 5, width: 4, height: 4 }, node_type: "element", axis_alignment: { horizontal: "center", vertical: "center" } },
      { layout_node_id: "ad-badge", element_id: "ad-badge", element_type: "component", parent_element_id: "panel", parent_layout_node_id: "panel", semantic_grouping: { kind: "standalone", rationale: "广告标记独立显示" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "PARENT", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, region_id: "panel-region", component_id: "ad-badge", placement_id: "ad-badge-placement", target_bounds: { x: 14, y: 3, width: 2, height: 2 }, node_type: "element", axis_alignment: { horizontal: "right", vertical: "top" } },
    ],
  });
  const errors = [];
  validateLayoutAnnotationConfirmation(value.record, value.context, errors);
  assert.deepEqual(errors, []);

  const facts = deriveAutomaticLayoutFacts(value.context.layoutNodes, value.context.viewport, { sceneId: "main", stateId: "default" });
  const icon = facts.find((fact) => fact.layout_node_id === "button").target_bounds;
  const label = facts.find((fact) => fact.layout_node_id === "label").target_bounds;
  const panel = facts.find((fact) => fact.layout_node_id === "panel").target_bounds;
  const badge = facts.find((fact) => fact.layout_node_id === "ad-badge").target_bounds;
  const groupCenter = (Math.min(icon.x, label.x) + Math.max(icon.x + icon.width, label.x + label.width)) / 2;
  assert.equal(groupCenter, panel.x + panel.width / 2);
  assert.equal(badge.x + badge.width, panel.x + panel.width - 2, "广告角标仍按自身停靠，不扩展主图文居中范围");
});

test("文件确认拒绝把严格居中决策改为reference而沿用旧bounds", async () => {
  const value = await fileBackedConfirmation();
  const decisionPath = join(value.projectRoot, value.record.layout_decision_file);
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  decision.elements.find((element) => element.element_id === "button").center_alignment = {
    horizontal: { mode: "reference", offset: 1, reason: "篡改决策测试" },
  };
  await writeFile(decisionPath, serializeJson(decision));

  const errors = [];
  validateLayoutAnnotationConfirmation(value.record, value.context, errors);
  assert(errors.some((message) => message.includes("target_bounds") && message.includes("center_alignment/decision/proposal 重算")), errors.join("；"));
});

test("文件确认拒绝改最终bounds或清除offset但保留bounds", async () => {
  const changedBounds = await fileBackedConfirmation();
  const changedBoundsPath = join(changedBounds.projectRoot, changedBounds.record.layout_nodes_file);
  const changedBoundsDocument = JSON.parse(await readFile(changedBoundsPath, "utf8"));
  const changedButton = changedBoundsDocument.layout_nodes.find((node) => node.layout_node_id === "button");
  changedButton.bounds.x += 1;
  changedButton.target_bounds.x += 1;
  await writeFile(changedBoundsPath, serializeJson(changedBoundsDocument));
  const boundsErrors = [];
  validateLayoutAnnotationConfirmation(changedBounds.record, changedBounds.context, boundsErrors);
  assert(boundsErrors.some((message) => message.includes("bounds") && message.includes("center_alignment/decision/proposal 重算")), boundsErrors.join("；"));

  const clearedOffset = await fileBackedConfirmation({
    centerAlignmentById: {
      button: { horizontal: { mode: "reference", offset: 3, reason: "图标视觉重心补偿" } },
    },
  });
  const clearedOffsetPath = join(clearedOffset.projectRoot, clearedOffset.record.layout_nodes_file);
  const clearedOffsetDocument = JSON.parse(await readFile(clearedOffsetPath, "utf8"));
  const offsetButton = clearedOffsetDocument.layout_nodes.find((node) => node.layout_node_id === "button");
  offsetButton.offset = { ...offsetButton.offset, x: 0 };
  await writeFile(clearedOffsetPath, serializeJson(clearedOffsetDocument));
  const offsetErrors = [];
  validateLayoutAnnotationConfirmation(clearedOffset.record, clearedOffset.context, offsetErrors);
  assert(offsetErrors.some((message) => message.includes("offset") && message.includes("center_alignment/decision/proposal 重算")), offsetErrors.join("；"));
});

test("真实布局工件同批更新后仍拒绝不继承 proposal 的语义理由", async () => {
  const value = await fileBackedConfirmation();
  const proposalPath = join(value.projectRoot, value.context.proposalFile);
  const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
  const updateReason = (elements) => { const element = elements?.find((item) => item?.element_id === "button"); if (element) element.semantic_grouping.rationale = "布局阶段擅自改变的功能归属理由"; };
  updateReason(proposal.decomposition_elements); updateReason(proposal.technical_analysis?.decomposition_elements); updateReason(proposal.technical_analysis?.regions?.[0]?.decomposition_elements);
  const proposalBytes = serializeJson(proposal); await writeFile(proposalPath, proposalBytes); const proposalSha = sha256(proposalBytes);

  const nodesPath = join(value.projectRoot, value.record.layout_nodes_file);
  const nodesDocument = JSON.parse(await readFile(nodesPath, "utf8")); nodesDocument.proposal_sha256 = proposalSha;
  const decisionInput = JSON.parse(await readFile(join(value.projectRoot, value.layoutDecisionFile), "utf8")); decisionInput.proposal_sha256 = proposalSha;
  const decisionBytes = serializeJson(decisionInput); const layoutDecisionSha = sha256(decisionBytes); nodesDocument.layout_decision_sha256 = layoutDecisionSha; const nodesBytes = serializeJson(nodesDocument); await writeFile(nodesPath, nodesBytes); const nodesSha = sha256(nodesBytes); await writeFile(join(value.projectRoot, value.layoutDecisionFile), decisionBytes); await writeFile(join(value.projectRoot, value.record.layout_decision_file), decisionBytes);

  const originalBytes = await readFile(join(value.projectRoot, "reference.png"));
  const facts = deriveAutomaticLayoutFacts(value.context.layoutNodes, value.context.viewport, { sceneId: value.context.sceneId, stateId: value.context.stateId });
  const rendered = renderLayoutAnnotation(originalBytes, value.context.viewport, facts, { ...value.context, decompositionProposalSha256: proposalSha, layoutDecisionSha256: layoutDecisionSha });
  await writeFile(join(value.projectRoot, value.record.layout_annotation_file), rendered.bytes); const annotationSha = sha256(rendered.bytes); const annotationIdentity = computeLayoutAnnotationIdentitySha256(annotationSha, rendered.width, rendered.height, rendered.metadataSha256);
  const reviewPath = join(value.projectRoot, value.record.layout_review_file); const reviewPayload = readLayoutReviewPayload((await readFile(reviewPath)).toString("utf8"));
  const bindings = structuredClone(reviewPayload.bindings); bindings.proposal.sha256 = proposalSha; bindings.nodes.sha256 = nodesSha; bindings.decision.sha256 = layoutDecisionSha; bindings.annotation.sha256 = annotationSha;
  const reviewBytes = renderLayoutReviewBundle({ nodesDocument, bindings, originalBytes, annotationBytes: rendered.bytes, nodesBytes, decisionBytes }); const reviewSha = sha256(reviewBytes); const reviewIdentitySha = computeLayoutReviewIdentitySha256(bindings); await writeFile(reviewPath, reviewBytes);
  Object.assign(value.record, { proposal_sha256: proposalSha, layout_nodes_sha256: nodesSha, layout_decision_sha256: layoutDecisionSha, layout_annotation_sha256: annotationSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: annotationIdentity, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha });
  value.context.proposalSha256 = proposalSha; value.context.layoutDecisionSha256 = layoutDecisionSha; value.context.annotationSha256 = annotationSha;

  const decisionPath = join(value.projectRoot, value.decisionFile); const decision = JSON.parse(await readFile(decisionPath, "utf8")); Object.assign(decision, { proposal_sha256: proposalSha, layout_nodes_sha256: nodesSha, layout_decision_sha256: layoutDecisionSha, layout_annotation_sha256: annotationSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: annotationIdentity, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha }); const decisionRecordBytes = serializeJson(decision); await writeFile(decisionPath, decisionRecordBytes); const decisionRecordSha = sha256(decisionRecordBytes);
  const receiptPath = join(value.projectRoot, value.receiptFile); const receipt = JSON.parse(await readFile(receiptPath, "utf8")); Object.assign(receipt, { proposal_sha256: proposalSha, layout_nodes_sha256: nodesSha, layout_decision_sha256: layoutDecisionSha, layout_annotation_sha256: annotationSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: annotationIdentity, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, decision_record_sha256: decisionRecordSha }); const receiptBytes = serializeJson(receipt); await writeFile(receiptPath, receiptBytes); const receiptSha = sha256(receiptBytes);
  Object.assign(value.record, { decision_record_sha256: decisionRecordSha, user_decision_receipt_sha256: receiptSha }); value.record.confirmation_sha256 = computeLayoutAnnotationConfirmationSha256(value.record);
  const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert(errors.some((message) => message.includes("未逐项继承 proposal") && message.includes("semantic_grouping")), errors.join("；"));
});
