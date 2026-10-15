import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveAutomaticLayoutFacts, renderLayoutAnnotation } from "./layout_annotation_contract.mjs";
import { buildLayoutNodesDocument, buildLayoutReviewBindings, computeLayoutReviewIdentitySha256, deriveLayoutReviewArtifactPaths, readAndValidateLayoutReviewPayload, renderLayoutReviewBundle, serializeJson, sha256, validateLayoutNodesDocument, validateLayoutReviewArtifactPaths } from "./layout_review_bundle.mjs";

/** 构造可供通用审阅模板消费的最小节点与四类输入字节。 */
async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "layout-review-bundle-"));
  const originalBytes = (await import("./effect_image_raster.mjs")).encodePngRgba(96, 80, Buffer.alloc(96 * 80 * 4, 220));
  const targetSha256 = sha256(originalBytes);
  const proposalBytes = Buffer.from('{"proposal":"confirmed"}\n', "utf8");
  const proposalSha256 = sha256(proposalBytes);
  const decisionDocument = { decision_schema: "automatic-layout-decision/1.0", decision_id: "layout-decision-1", decision_method: "visual-judgement", target_sha256: targetSha256, scene_id: "main", state_id: "default" };
  const decisionBytes = serializeJson(decisionDocument);
  const layoutDecisionSha256 = sha256(decisionBytes);
  const rawNodes = [
    { layout_node_id: "panel", element_id: "panel", display_name_zh: "主面板", parent_layout_node_id: "viewport", layout_role: "container", ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, axis_alignment: { horizontal: "center", vertical: "center" }, target_bounds: { x: 12, y: 10, width: 60, height: 52 } },
    { layout_node_id: "title", element_id: "title", display_name_zh: "标题<script>alert(1)</script>", parent_layout_node_id: "panel", layout_role: "text", ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "PARENT", size_policy: "CONTENT", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, axis_alignment: { horizontal: "center", vertical: "top" }, target_bounds: { x: 24, y: 18, width: 36, height: 12 } },
  ];
  const facts = deriveAutomaticLayoutFacts(rawNodes, { width: 96, height: 80 }, { sceneId: "main", stateId: "default" });
  const rendered = renderLayoutAnnotation(originalBytes, { width: 96, height: 80 }, facts, { targetSha256, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: `sha256:${"b".repeat(64)}`, decompositionProposalSha256: proposalSha256, layoutDecisionId: decisionDocument.decision_id, layoutDecisionSha256 });
  const annotationBytes = rendered.bytes;
  const annotationSha256 = sha256(annotationBytes);
  const outputPath = join(projectRoot, "evidence", "v2", "layout.png");
  const paths = deriveLayoutReviewArtifactPaths(projectRoot, outputPath);
  const context = { projectRoot, viewport: { width: 96, height: 80 }, sceneId: "main", stateId: "default", targetSha256, decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: `sha256:${"b".repeat(64)}`, proposalSha256, proposalFile: "proposal.json", referenceFile: "reference.png", referenceSha256: targetSha256, layoutDecisionId: decisionDocument.decision_id, layoutDecisionSha256, annotationSha256 };
  const nodesDocument = buildLayoutNodesDocument(facts, context);
  const nodesBytes = serializeJson(nodesDocument);
  const nodesSha256 = sha256(nodesBytes);
  const bindings = buildLayoutReviewBindings(paths, { ...context, nodesSha256 });
  const reviewBytes = renderLayoutReviewBundle({ nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes });
  return { projectRoot, facts, nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes, reviewBytes, context: { ...context, nodesDocument } };
}

test("标准审阅 bundle 使用同一份节点事实并可确定性重建", async () => {
  const value = await fixture();
  const errors = [];
  const payload = readAndValidateLayoutReviewPayload(value.reviewBytes, value.nodesBytes, value.context, errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(payload.nodesDocument.layout_nodes, value.nodesDocument.layout_nodes);
  assert.equal(computeLayoutReviewIdentitySha256(value.bindings), computeLayoutReviewIdentitySha256(payload.bindings));
  const rebuilt = renderLayoutReviewBundle({ nodesDocument: value.nodesDocument, bindings: value.bindings, originalBytes: value.originalBytes, annotationBytes: value.annotationBytes, nodesBytes: value.nodesBytes, decisionBytes: value.decisionBytes });
  assert.deepEqual(rebuilt, value.reviewBytes);
});

test("节点文档异常会明确拒绝缺失父节点和循环关系", async () => {
  const value = await fixture();
  const missingParent = structuredClone(value.nodesDocument);
  missingParent.layout_nodes[1].parent_layout_node_id = "missing-parent";
  const missingErrors = [];
  validateLayoutNodesDocument(missingParent, {}, missingErrors, "layout_nodes");
  assert(missingErrors.some((item) => item.includes("父") || item.includes("parent")), missingErrors.join("\n"));
  const cycle = structuredClone(value.nodesDocument);
  cycle.layout_nodes[0].parent_layout_node_id = cycle.layout_nodes[1].layout_node_id;
  cycle.layout_nodes[1].parent_layout_node_id = cycle.layout_nodes[0].layout_node_id;
  const cycleErrors = [];
  validateLayoutNodesDocument(cycle, {}, cycleErrors, "layout_nodes");
  assert(cycleErrors.length > 0, cycleErrors.join("\n"));
});

test("节点名称进入 HTML 数据块时会转义脚本边界", async () => {
  const value = await fixture();
  const html = value.reviewBytes.toString("utf8");
  assert(!html.includes("<script>alert(1)</script>"));
  assert(html.includes("\\u003cscript\\u003ealert(1)"));
});

test("旁车工件路径不能覆盖参考图且允许合法同目录布局决定副本", async () => {
  const value = await fixture();
  const paths = deriveLayoutReviewArtifactPaths(value.projectRoot, join(value.projectRoot, "evidence", "v2", "layout.png"));
  assert.throws(() => validateLayoutReviewArtifactPaths(value.projectRoot, paths, [paths.annotation]));
  assert.doesNotThrow(() => validateLayoutReviewArtifactPaths(value.projectRoot, paths, ["reference.png", "proposal.json"], "other-layout-decision.json"));
});

test("HTML 数据块与外部节点 JSON 漂移时 fail closed", async () => {
  const value = await fixture();
  const changed = serializeJson({ ...value.nodesDocument, state_id: "other" });
  const errors = [];
  readAndValidateLayoutReviewPayload(value.reviewBytes, changed, value.context, errors);
  assert(errors.some((item) => item.includes("不一致") || item.includes("一致")), errors.join("\n"));
});
