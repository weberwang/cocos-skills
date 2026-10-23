import { fixtureLayoutNodes, layoutSourceDocuments } from '../../cocos-game-workflow-control/scripts/v2-layout-source-test-fixtures.mjs';
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256 } from "../../cocos-game-workflow-control/scripts/layout_annotation_confirmation.mjs";
import { buildLayoutNodesDocument, buildLayoutReviewBindings, computeLayoutReviewIdentitySha256, renderLayoutReviewBundle, serializeJson, sha256 as layoutBundleSha256 } from "./layout_review_bundle.mjs";
import { computeLayoutAnnotationIdentitySha256, deriveAutomaticLayoutFacts, renderLayoutAnnotation } from "./layout_annotation_contract.mjs";

/** 计算测试夹具文件的标准 SHA-256。 */
function sha256Bytes(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 为场景布局确认写入五件真实审阅产物及其用户决定链。 */
export async function writeLayoutReviewFixtureArtifacts(root, manifest) {
  const sceneContract = manifest.scene_reconstruction_contract;
  const decomposition = sceneContract?.layout_decomposition;
  const layoutAnnotation = decomposition?.layout_annotation;
  const layoutConfirmation = decomposition?.layout_annotation_confirmation;
  const target = sceneContract?.target_conditions;
  const canvas = manifest.coverage_audit?.canvases?.find((item) => item.scene_id === target?.scene_id && item.state_id === target?.state_id);
  const upstream = manifest.coverage_audit?.regions?.find((item) => item.scene_id === target?.scene_id && item.state_id === target?.state_id)?.confirmation ?? sceneContract.visual_decomposition_confirmation;
  if (!decomposition?.layout_source || !layoutAnnotation || !layoutConfirmation || !target || !canvas || !upstream) return;

  const layoutNodes = fixtureLayoutNodes(sceneContract);
  const originalBytes = await readFile(join(root, manifest.reference_target.original_file));
  const facts = deriveAutomaticLayoutFacts(layoutNodes, canvas, { sceneId: target.scene_id, stateId: target.state_id });
  const layoutDecision = { decision_schema: "automatic-layout-decision/1.0", decision_id: layoutAnnotation.layout_decision_id, decision_method: "visual-judgement", target_sha256: manifest.reference_target.target_sha256, scene_id: target.scene_id, state_id: target.state_id, decomposition_confirmation_id: upstream.confirmation_id, decomposition_confirmation_sha256: upstream.confirmation_sha256, proposal_sha256: upstream.proposal_sha256, elements: layoutNodes.map((node) => ({ element_id: node.element_id ?? node.layout_node_id, horizontal_alignment: node.axis_alignment.horizontal, vertical_alignment: node.axis_alignment.vertical, ...(node.center_alignment !== undefined ? { center_alignment: node.center_alignment } : {}) })) };
  const layoutDecisionBytes = Buffer.from(`${JSON.stringify(layoutDecision, null, 2)}\n`);
  const layoutDecisionPath = join(root, layoutAnnotation.layout_decision_file);
  await mkdir(dirname(layoutDecisionPath), { recursive: true });
  await writeFile(layoutDecisionPath, layoutDecisionBytes);
  const layoutDecisionSha = sha256Bytes(layoutDecisionBytes);
  const rendered = renderLayoutAnnotation(originalBytes, canvas, facts, { targetSha256: manifest.reference_target.target_sha256, sceneId: target.scene_id, stateId: target.state_id, decompositionConfirmationId: upstream.confirmation_id, decompositionConfirmationSha256: upstream.confirmation_sha256, decompositionProposalSha256: upstream.proposal_sha256, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha });
  const layoutSha = sha256Bytes(rendered.bytes);
  const layoutPath = join(root, layoutAnnotation.layout_annotation_file);
  await writeFile(layoutPath, rendered.bytes);
  const layoutNodesFile = decomposition.layout_source.nodes_file;
  const layoutReviewFile = "evidence/v2/review.html";
  const layoutContext = { projectRoot: root, viewport: target.viewport, targetSha256: manifest.reference_target.target_sha256, sceneId: target.scene_id, stateId: target.state_id, decompositionConfirmationId: upstream.confirmation_id, decompositionConfirmationSha256: upstream.confirmation_sha256, proposalSha256: upstream.proposal_sha256, proposalFile: upstream.proposal_file, referenceFile: manifest.reference_target.original_file, referenceSha256: manifest.reference_target.target_sha256, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha, annotationSha256: layoutSha };
  const nodesDocument = buildLayoutNodesDocument(facts, layoutContext);
  layoutSourceDocuments.set(layoutNodesFile, nodesDocument);
  const nodesBytes = serializeJson(nodesDocument);
  const nodesSha = layoutBundleSha256(nodesBytes);
  const reviewBindings = buildLayoutReviewBindings({ annotationFile: layoutAnnotation.layout_annotation_file, nodesFile: layoutNodesFile, decisionFile: layoutAnnotation.layout_decision_file }, { ...layoutContext, nodesSha256: nodesSha });
  const reviewBytes = renderLayoutReviewBundle({ nodesDocument, bindings: reviewBindings, originalBytes, annotationBytes: rendered.bytes, nodesBytes, decisionBytes: layoutDecisionBytes });
  const reviewSha = layoutBundleSha256(reviewBytes);
  const reviewIdentitySha = computeLayoutReviewIdentitySha256(reviewBindings);
  await writeFile(join(root, layoutNodesFile), nodesBytes);
  await writeFile(join(root, layoutReviewFile), reviewBytes);
  Object.assign(layoutAnnotation, { layout_annotation_sha256: layoutSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_schema: rendered.metadata.schema, layout_annotation_layout: rendered.metadata.layout, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: computeLayoutAnnotationIdentitySha256(layoutSha, rendered.width, rendered.height, rendered.metadataSha256), layout_review_file: layoutReviewFile, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, layout_nodes_file: layoutNodesFile, layout_nodes_sha256: nodesSha, decomposition_confirmation_id: upstream.confirmation_id, decomposition_confirmation_sha256: upstream.confirmation_sha256, proposal_sha256: upstream.proposal_sha256, layout_decision_sha256: layoutDecisionSha, target_sha256: manifest.reference_target.target_sha256, scene_id: target.scene_id, state_id: target.state_id, layout_node_ids: layoutNodes.map((node) => node.layout_node_id) });
  const userText = layoutConfirmation.user_original_text;
  const binding = { layout_annotation_file: layoutAnnotation.layout_annotation_file, layout_annotation_sha256: layoutSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_schema: rendered.metadata.schema, layout_annotation_layout: rendered.metadata.layout, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: layoutAnnotation.layout_annotation_identity_sha256, layout_review_file: layoutReviewFile, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, layout_nodes_file: layoutNodesFile, layout_nodes_sha256: nodesSha, decomposition_confirmation_id: layoutAnnotation.decomposition_confirmation_id, decomposition_confirmation_sha256: layoutAnnotation.decomposition_confirmation_sha256, proposal_sha256: layoutAnnotation.proposal_sha256, layout_decision_file: layoutAnnotation.layout_decision_file, layout_decision_sha256: layoutAnnotation.layout_decision_sha256, layout_decision_id: layoutAnnotation.layout_decision_id, target_sha256: layoutAnnotation.target_sha256, scene_id: layoutAnnotation.scene_id, state_id: layoutAnnotation.state_id, user_statement: userText, user_message_sha256: computeLayoutUserMessageSha256(userText), accepted_at: layoutConfirmation.accepted_at };
  const decision = { author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", status: "accepted", confirmation_mode: "manual", confirmation_id: layoutConfirmation.confirmation_id, ...binding };
  const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
  const decisionPath = join(root, layoutConfirmation.decision_record_file);
  await mkdir(dirname(decisionPath), { recursive: true });
  await writeFile(decisionPath, decisionBytes);
  const decisionSha = sha256Bytes(decisionBytes);
  const receipt = { message_id: `message-${layoutConfirmation.confirmation_id}`, thread_id: "thread-layout", resolution_id: `resolution-${layoutConfirmation.confirmation_id}`, author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", ...binding, decision_record_sha256: decisionSha };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptPath = join(root, layoutConfirmation.user_decision_receipt_file);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, receiptBytes);
  const receiptSha = sha256Bytes(receiptBytes);
  Object.assign(layoutConfirmation, { ...binding, decision_record_sha256: decisionSha, user_decision_receipt_sha256: receiptSha });
  layoutConfirmation.confirmation_sha256 = computeLayoutAnnotationConfirmationSha256(layoutConfirmation);
}
