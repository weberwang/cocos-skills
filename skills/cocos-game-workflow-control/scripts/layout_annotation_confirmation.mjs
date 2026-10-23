#!/usr/bin/env node

/**
 * V2 阶段 B 独立布局确认合同。
 *
 * 拆解确认、布局候选和人工布局确认是三个串行身份。确认门会把实际
 * review.html、layout-nodes.json、布局决策副本、PNG、参考图和 proposal
 * 的实际结构和内容后放行；摘要仅作为可选追踪信息。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { decodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements, validateLayoutAnnotationPng } from "../../cocos-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { validateDecompositionElements } from "../../cocos-game-asset-integration/scripts/decomposition-elements.mjs";
import { validateAutomaticLayoutDecision } from "../../cocos-game-asset-integration/scripts/automatic-layout-decision.mjs";
import { readAndValidateLayoutReviewPayload, validateLayoutNodesDocument } from "../../cocos-game-asset-integration/scripts/layout_review_bundle.mjs";

export const LAYOUT_ANNOTATION_CONFIRMATION_SCHEMA = "layout-annotation-confirmation/1.0";
const REQUIRED_FIELDS = [
  "confirmation_schema", "confirmation_id", "status", "confirmation_mode",
  "layout_annotation_file", "layout_annotation_width", "layout_annotation_height",
  "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file",
  "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id",
  "user_original_text", "decision_record_file", "user_decision_receipt_file", "accepted_at",
];
const DECISION_BINDING_FIELDS = [
  "layout_annotation_file", "layout_review_file", "layout_nodes_file",
  "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id", "user_statement", "accepted_at",
];

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断非空字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 生成稳定 JSON。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 计算 SHA-256。 */
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

/** 计算不含自引用字段的布局确认身份。 */
export function computeLayoutAnnotationConfirmationSha256(record = {}) { const payload = { ...record }; delete payload.confirmation_sha256; return sha256(canonicalJson(payload)); }

/** 保留历史摘要生成接口供记录端输出；确认验收不依赖该摘要。 */
export function computeLayoutUserMessageSha256(text) { return sha256(String(text ?? "")); }

/** 限制确认文件路径落在项目内，并允许尚未创建的直接子路径。 */
function safeProjectPath(projectRoot, value) {
  if (!nonEmptyString(projectRoot) || !nonEmptyString(value) || isAbsolute(value)) return null;
  const root = resolve(projectRoot); const candidate = resolve(root, value); const lexical = relative(root, candidate);
  if (!lexical || lexical === ".." || lexical.startsWith("..\\") || lexical.startsWith("../") || isAbsolute(lexical)) return null;
  const real = (path) => { try { return realpathSync(path); } catch { return null; } };
  const realRoot = real(root); const realCandidate = real(candidate);
  if (realRoot && realCandidate) { const realRelative = relative(realRoot, realCandidate); if (realRelative === ".." || realRelative.startsWith("..\\") || realRelative.startsWith("../") || isAbsolute(realRelative)) return null; }
  return candidate;
}

/** 安全读取确认关联文件；文件路径、存在性和 JSON 结构承担实际校验。 */
function readBoundFile(projectRoot, file, label, errors, parseJson = false) {
  const path = safeProjectPath(projectRoot, file);
  if (!path || !existsSync(path) || !statSync(path).isFile()) { errors.push(`${label} 文件不存在或路径越界`); return null; }
  const bytes = readFileSync(path);
  if (!parseJson) return { bytes };
  try { return { bytes, json: JSON.parse(bytes.toString("utf8")) }; } catch (error) { errors.push(`${label} 不是合法 JSON：${error.message}`); return null; }
}

/** 校验决定/receipt 的用户解除语义，并要求它们绑定新的审阅工件身份。 */
function validateLayoutDecisionDocument(document, record, label, errors, receipt = false) {
  if (!isObject(document)) { errors.push(`${label} 必须是 JSON 对象并明确确认当前布局图`); return; }
  const required = ["author_role", "resolution_status", "resolved_from", ...DECISION_BINDING_FIELDS, ...(receipt ? ["message_id", "thread_id", "resolution_id"] : ["confirmation_id", "confirmation_mode"])];
  for (const field of required) if (!nonEmptyString(document[field])) errors.push(`${label}.${field} 必须是非空值`);
  if (document.author_role !== "user" || document.resolution_status !== "resolved" || document.resolved_from !== "USER_INPUT_REQUIRED") errors.push(`${label} 必须是 user 解除 USER_INPUT_REQUIRED 的 resolved 记录`);
  if (!receipt && (document.status !== "accepted" || document.confirmation_mode !== "manual")) errors.push(`${label} 必须是 accepted/manual 布局决定`);
  for (const [field, expected] of DECISION_BINDING_FIELDS.map((field) => [field, field === "user_statement" ? record.user_original_text : record[field]])) if (expected !== undefined && document[field] !== expected) errors.push(`${label}.${field} 未绑定布局确认记录`);
  if (!receipt && document.confirmation_id !== record.confirmation_id) errors.push(`${label}.confirmation_id 未绑定当前布局确认`);
  if (nonEmptyString(document.user_statement) && document.user_statement !== record.user_original_text) errors.push(`${label}.user_statement 与 user_original_text 不一致`);
  if (nonEmptyString(document.accepted_at) && Number.isNaN(Date.parse(document.accepted_at))) errors.push(`${label}.accepted_at 必须是合法时间`);
  if (nonEmptyString(document.accepted_at) && document.accepted_at !== record.accepted_at) errors.push(`${label}.accepted_at 未绑定布局确认时间`);
}

/** 读取提案中用于验证父级/语义的区域边界；不从布局节点反推拆解区域。 */
function proposalRegions(proposal) {
  const regions = proposal?.technical_analysis?.regions;
  if (!Array.isArray(regions)) return [];
  return regions.map((region) => ({ id: region?.region_id, scene_id: region?.scene_id, state_id: region?.state_id, bounds: region?.bounds }));
}

/** 读取布局节点的真实元素几何，兼容节点文档中的 target_bounds/bounds 同义位置。 */
function nodeBounds(node) { return node?.target_bounds ?? node?.targetBounds ?? node?.bounds; }

/** 从绑定的 proposal 和 decision 重建布局事实；确认时不能信任节点文件自带的策略或偏移。 */
function validateLayoutNodesAgainstProposal(proposal, nodesDocument, decisionDocument, record, errors, label) {
  const elements = proposal?.decomposition_elements;
  const regions = proposalRegions(proposal);
  const elementErrors = [];
  const elementById = validateDecompositionElements(elements, regions, nodesDocument?.viewport, `${label}.proposal.decomposition_elements`, elementErrors);
  errors.push(...elementErrors);
  if (!(elementById instanceof Map) || elementById.size !== elements?.length) return;
  const actualNodes = Array.isArray(nodesDocument?.layout_nodes) ? nodesDocument.layout_nodes : [];
  if (actualNodes.length !== elements.length) { errors.push(`${label}.layout_nodes 必须与 proposal.decomposition_elements 数量一致`); return; }

  const decisionErrors = [];
  const alignmentDecisions = validateAutomaticLayoutDecision(decisionDocument, {
    elements,
    sceneId: record.scene_id,
    stateId: record.state_id,
    decompositionConfirmationId: record.decomposition_confirmation_id,
  }, decisionErrors, `${label}.layout_decision`);
  errors.push(...decisionErrors);
  if (!alignmentDecisions) return;

  let expectedNodes;
  let expectedFacts;
  try {
    expectedNodes = deriveLayoutNodesFromDecompositionElements(elements, nodesDocument.viewport, {
      sceneId: record.scene_id,
      stateId: record.state_id,
      alignmentDecisions,
    });
    // 中心解析只平移 bounds；元素尺寸仍必须直接继承已确认的拆解测量。
    for (const [index, element] of elements.entries()) {
      const sourceBounds = element.bounds;
      const derivedBounds = nodeBounds(expectedNodes[index]);
      if (!sourceBounds || derivedBounds?.width !== sourceBounds.width || derivedBounds?.height !== sourceBounds.height) {
        throw new Error(`元素 ${element.element_id} 的宽高不得由布局阶段改写`);
      }
    }
    expectedFacts = deriveAutomaticLayoutFacts(expectedNodes, nodesDocument.viewport, { sceneId: record.scene_id, stateId: record.state_id });
  } catch (error) {
    errors.push(`${label}.layout_nodes 无法按绑定 decision/proposal 重建：${error.message}`);
    return;
  }

  if (decisionDocument?.decision_id !== record.layout_decision_id) errors.push(`${label}.layout_decision.decision_id 未绑定确认记录`);
  for (const [index, element] of elements.entries()) {
    const node = actualNodes[index];
    const expectedFact = expectedFacts.find((fact) => fact.layout_node_id === element.element_id);
    const expectedContainer = element.element_type === "container";
    const expectedEmpty = expectedContainer && element.empty_container === true;
    const sourceIdentityMatches = node
      && node.layout_node_id === element.element_id
      && node.element_id === element.element_id
      && node.element_type === element.element_type
      && node.render_kind === element.render_kind
      && node.is_container === expectedContainer
      && node.empty_container === expectedEmpty
      && node.parent_layout_node_id === element.parent_element_id
      && node.parent_element_id === element.parent_element_id
      && node.scene_id === element.scene_id
      && node.state_id === element.state_id
      && node.region_id === element.region_id
      && node.component_id === element.component_id
      && node.placement_id === element.placement_id
      && canonicalJson(node.semantic_grouping) === canonicalJson(element.semantic_grouping)
      && canonicalJson(node.ui_layout) === canonicalJson(element.ui_layout);
    if (!sourceIdentityMatches) errors.push(`${label}.layout_nodes[${index}] 未逐项继承 proposal 的元素身份、semantic_grouping、ui_layout 或 parent_element_id`);

    // 同时比较最终目标矩形、中心策略和定位快照，避免仅改 bounds 或清零 offset 绕过确认。
    const expectedGeometry = {
      bounds: expectedFact?.bounds,
      target_bounds: expectedFact?.target_bounds,
      axis_alignment: expectedFact?.axis_alignment,
      center_alignment: expectedFact?.center_alignment,
      layout_execution: expectedFact?.layout_execution,
      offset: expectedFact?.offset,
      docking: expectedFact?.docking,
      relative_position: expectedFact?.relative_position,
      reference_id: expectedFact?.reference_id,
      parent_target_bounds: expectedFact?.parent_target_bounds,
      reference_target_bounds: expectedFact?.reference_target_bounds,
      self_anchor: expectedFact?.self_anchor,
      reference_anchor: expectedFact?.reference_anchor,
      sprite_geometry: expectedFact?.sprite_geometry,
    };
    const actualGeometry = {
      bounds: node?.bounds,
      target_bounds: nodeBounds(node),
      axis_alignment: node?.axis_alignment ?? node?.axisAlignment,
      center_alignment: node?.center_alignment,
      layout_execution: node?.layout_execution,
      offset: node?.offset,
      docking: node?.docking,
      relative_position: node?.relative_position,
      reference_id: node?.reference_id,
      parent_target_bounds: node?.parent_target_bounds,
      reference_target_bounds: node?.reference_target_bounds,
      self_anchor: node?.self_anchor,
      reference_anchor: node?.reference_anchor,
      sprite_geometry: node?.sprite_geometry,
    };
    const changedGeometry = Object.keys(expectedGeometry).filter((field) => canonicalJson(actualGeometry[field]) !== canonicalJson(expectedGeometry[field]));
    if (changedGeometry.length > 0) errors.push(`${label}.layout_nodes[${index}] 的 ${changedGeometry.join("、")} 未按绑定 center_alignment/decision/proposal 重算`);
  }
  return expectedFacts;
}

/** 校验 review.html、layout-nodes.json 及其引用文件的真实内容和归属。 */
function validateLayoutReviewFiles(record, context, files, image, errors, label) {
  const { review, nodes, layoutDecision } = files;
  if (!review || !nodes) return;
  const expected = { projectRoot: context.projectRoot, sceneId: record.scene_id, stateId: record.state_id, decompositionConfirmationId: record.decomposition_confirmation_id, layoutDecisionId: record.layout_decision_id, referenceFile: context.referenceFile ?? context.reference_file, proposalFile: context.proposalFile ?? context.proposal_file };
  const payload = readAndValidateLayoutReviewPayload(review.bytes, nodes.bytes, expected, errors, label);
  if (!payload) return;
  const bindings = payload.bindings;
  const references = [];
  for (const [name, item] of [["reference", bindings.reference], ["proposal", bindings.proposal]]) if (isObject(item)) references.push([name, readBoundFile(context.projectRoot, item.file, `${label}.${name}`, errors, name === "proposal")]);
  const proposal = references.find(([name]) => name === "proposal")?.[1];
  let expectedFacts = null;
  if (proposal?.json && layoutDecision?.json) {
    expectedFacts = validateLayoutNodesAgainstProposal(proposal.json, payload.externalNodes, layoutDecision.json, record, errors, label);
  } else {
    errors.push(`${label} 缺少可用 proposal 或 layout decision，无法复算最终布局几何`);
  }
  const nodeErrors = [];
  validateLayoutNodesDocument(payload.externalNodes, { ...expected, layoutNodes: expectedFacts?.filter((node) => node.is_root_container !== true), rootNodes: expectedFacts?.filter((node) => node.is_root_container === true) }, nodeErrors, `${label}.layout_nodes`);
  errors.push(...nodeErrors);
  // 即使调用方没有提供 context.layoutNodes，也必须把节点 JSON 与 PNG 内的实际 facts 逐项绑定。
  try {
    const annotationMetadata = decodePngRgba(image.bytes).metadata;
    const documentFacts = [...payload.externalNodes.layout_nodes, ...payload.externalNodes.root_nodes];
    if (!Array.isArray(annotationMetadata?.nodes) || canonicalJson(annotationMetadata.nodes) !== canonicalJson(documentFacts)) errors.push(`${label} layout-nodes.json 与标准 PNG 的实际布局 facts 不一致`);
  } catch (error) { errors.push(`${label} 无法读取标准 PNG 布局 facts：${error.message}`); }
  const bindingPairs = [["layout_annotation_file", bindings.annotation?.file], ["layout_review_file", record.layout_review_file], ["layout_nodes_file", bindings.nodes?.file], ["layout_decision_file", bindings.decision?.file]];
  for (const [field, actual] of bindingPairs) if (actual !== record[field]) errors.push(`${label}.${field} 未绑定确认记录`);
}

/** 校验独立布局确认；布局阶段必须提供上游拆解和完整审阅页上下文。 */
export function validateLayoutAnnotationConfirmation(record, context = {}, errors = [], label = "layout_annotation_confirmation") {
  if (!isObject(record)) { errors.push(`${label} 必须是对象；V2 最终门缺少独立布局确认`); return null; }
  for (const field of REQUIRED_FIELDS) if (!Object.hasOwn(record, field)) errors.push(`${label}.${field} 必须存在`);
  for (const field of ["confirmation_id", "confirmation_mode", "layout_annotation_file", "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file", "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id", "user_original_text", "decision_record_file", "user_decision_receipt_file", "accepted_at"]) if (!nonEmptyString(record[field])) errors.push(`${label}.${field} 必须是非空字符串`);
  if (record.confirmation_schema !== LAYOUT_ANNOTATION_CONFIRMATION_SCHEMA) errors.push(`${label}.confirmation_schema 必须为 ${LAYOUT_ANNOTATION_CONFIRMATION_SCHEMA}`);
  if (record.layout_annotation_schema !== "layout-annotation/png/1") errors.push(`${label}.layout_annotation_schema 必须为 layout-annotation/png/1`);
  if (record.layout_annotation_layout !== "image-plus-right-panel") errors.push(`${label}.layout_annotation_layout 必须为 image-plus-right-panel`);
  if (nonEmptyString(record.accepted_at) && Number.isNaN(Date.parse(record.accepted_at))) errors.push(`${label}.accepted_at 必须是合法时间`);
  for (const field of ["layout_annotation_width", "layout_annotation_height"]) if (!Number.isInteger(record[field]) || record[field] <= 0) errors.push(`${label}.${field} 必须是正整数`);
  if (record.status !== "accepted" || record.confirmation_mode !== "manual") errors.push(`${label} 必须是 manual accepted`);
  for (const [field, expected] of [["scene_id", context.sceneId ?? context.scene_id], ["state_id", context.stateId ?? context.state_id], ["decomposition_confirmation_id", context.decompositionConfirmationId ?? context.decomposition_confirmation_id]]) if (expected !== undefined && record[field] !== expected) errors.push(`${label}.${field} 未绑定当前串行上游身份`);
  if (nonEmptyString(context.decompositionConfirmationId) && record.confirmation_id === context.decompositionConfirmationId) errors.push(`${label}.confirmation_id 必须独立于拆解确认 ID`);
  if (context.checkFiles === true && nonEmptyString(context.projectRoot)) {
    const image = readBoundFile(context.projectRoot, record.layout_annotation_file, `${label}.layout_annotation`, errors);
    const review = readBoundFile(context.projectRoot, record.layout_review_file, `${label}.layout_review`, errors);
    const nodes = readBoundFile(context.projectRoot, record.layout_nodes_file, `${label}.layout_nodes`, errors);
    const layoutDecision = readBoundFile(context.projectRoot, record.layout_decision_file, `${label}.layout_decision`, errors, true);
    const decision = readBoundFile(context.projectRoot, record.decision_record_file, `${label}.decision_record`, errors, true);
    const receipt = readBoundFile(context.projectRoot, record.user_decision_receipt_file, `${label}.user_decision_receipt`, errors, true);
    if (image) {
      const checkErrors = [];
      const validated = validateLayoutAnnotationPng(image.bytes, { sceneId: record.scene_id, stateId: record.state_id, decompositionConfirmationId: record.decomposition_confirmation_id, layoutDecisionId: record.layout_decision_id, layoutNodes: context.layoutNodes }, checkErrors, label);
      errors.push(...checkErrors);
      if (validated) { if (validated.decoded.width !== record.layout_annotation_width || validated.decoded.height !== record.layout_annotation_height) errors.push(`${label} 尺寸与确认记录不一致`); if (validated.metadata.schema !== record.layout_annotation_schema || validated.metadata.layout !== record.layout_annotation_layout) errors.push(`${label} schema/layout 与确认记录不一致`); }
    }
    let nodesDocument = null;
    if (nodes) {
      try { nodesDocument = JSON.parse(nodes.bytes.toString("utf8")); } catch (error) { errors.push(`${label}.layout_nodes 不是合法 JSON：${error.message}`); }
    }
    if (layoutDecision) {
      if (layoutDecision.json?.decision_id !== record.layout_decision_id) errors.push(`${label}.layout_decision.decision_id 未绑定确认记录`);
    }
    if (review && nodes && image && layoutDecision) validateLayoutReviewFiles(record, context, { review, nodes, layoutDecision }, image, errors, `${label}.layout_review`);
    if (decision) validateLayoutDecisionDocument(decision.json, record, `${label}.decision_record`, errors);
    if (receipt) validateLayoutDecisionDocument(receipt.json, record, `${label}.user_decision_receipt`, errors, true);
  }
  return record;
}
