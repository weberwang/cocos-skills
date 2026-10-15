#!/usr/bin/env node

/**
 * V2 阶段 B 布局标注图入口。
 *
 * 该入口只在拆解人工确认通过后运行。它读取确认过 proposal 中的
 * decomposition_elements，并消费智能视觉判断生成的显式双轴对齐决策，随后
 * 推导并生成独立布局 PNG；不消费预存 layout_nodes，也不靠距离猜测对齐。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodePngRgba } from "./effect_image_raster.mjs";
import { loadManifest, readPngDimensions } from "./validate_visual_manifest.mjs";
import { computeLayoutAnnotationIdentitySha256, deriveAutomaticLayoutFacts, deriveLayoutNodesFromDecompositionElements, renderLayoutAnnotation } from "./layout_annotation_contract.mjs";
import { decompositionElementIds, validateDecompositionElements } from "./decomposition-elements.mjs";
import { validateAutomaticLayoutDecision, automaticLayoutDecisionId } from "./automatic-layout-decision.mjs";
import { buildLayoutNodesDocument, buildLayoutReviewBindings, computeLayoutReviewIdentitySha256, deriveLayoutReviewArtifactPaths, pathsReferToSameFile, renderLayoutReviewBundle, serializeJson, sha256 as bundleSha256, validateLayoutReviewArtifactPaths } from "./layout_review_bundle.mjs";
const DECOMPOSITION_REQUIRED_FIELDS = ["confirmation_schema", "confirmation_id", "status", "confirmation_mode", "proposal_id", "proposal_file", "annotation_file", "annotation_mime", "annotation_width", "annotation_height", "annotation_schema", "annotation_layout", "decision_record_file", "user_decision_receipt_file", "scene_id", "state_id", "user_original_text", "accepted_at"];

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断非空字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 将输入路径限制在项目根目录，拒绝 symlink/junction 造成的文件逃逸。 */
function projectPath(projectRoot, value) {
  if (!nonEmptyString(value)) throw new Error("路径不能为空"); const result = resolve(projectRoot, value); const root = resolve(projectRoot); const lexical = relative(root, result);
  if (!lexical || lexical === ".." || lexical.startsWith("..\\") || lexical.startsWith("../") || isAbsolute(lexical)) throw new Error(`路径逃逸项目根目录：${value}`);
  const real = (candidate) => { let current = candidate; while (true) { try { return realpathSync(current); } catch { const parent = dirname(current); if (parent === current) return null; current = parent; } } };
  const rootReal = real(root); const resultReal = real(result); if (rootReal && resultReal) { const realRelative = relative(rootReal, resultReal); if (realRelative === ".." || realRelative.startsWith("..\\") || realRelative.startsWith("../") || isAbsolute(realRelative)) throw new Error(`路径真实位置逃逸项目根目录：${value}`); }
  return result;
}
/** 解析 CLI 参数；显式确认 ID 和 scene/state 防止从错误场景猜测上游身份。 */
function parseArgs(argv) {
  const args = { projectRoot: "." }; for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (!args.manifest && !token.startsWith("-")) args.manifest = token; else if (token === "--project-root") args.projectRoot = argv[++index]; else if (token === "--scene-id") args.sceneId = argv[++index]; else if (token === "--state-id") args.stateId = argv[++index]; else if (token === "--output") args.output = argv[++index]; else if (token === "--decomposition-confirmation-id") args.decompositionConfirmationId = argv[++index]; else if (token === "--decomposition-confirmation-sha256") args.decompositionConfirmationSha256 = argv[++index]; else if (token === "--proposal-sha256") args.proposalSha256 = argv[++index]; else if (token === "--layout-decision-file") args.layoutDecisionFile = argv[++index]; else if (token === "--layout-decision-sha256") args.layoutDecisionSha256 = argv[++index]; else throw new Error(`不支持的参数：${token}`); }
  for (const field of ["manifest", "sceneId", "stateId", "output", "decompositionConfirmationId", "layoutDecisionFile"]) if (!nonEmptyString(args[field])) throw new Error(`缺少参数：${field}`);
  if (!args.output.toLowerCase().endsWith(".png")) throw new Error("布局标注输出必须使用 .png"); return args;
}

/** 读取项目内确认文件并校验其实际内容结构；摘要仅为可选记录。 */
async function readBoundFile(projectRoot, file, label, parseJson = false) {
  if (!nonEmptyString(file)) throw new Error(`${label} 缺少文件路径`);
  const bytes = await readFile(projectPath(projectRoot, file));
  if (!parseJson) return { bytes };
  let json;
  try { json = JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`${label} 不是合法 JSON：${error.message}`); }
  if (!isObject(json)) throw new Error(`${label} 必须是 JSON 对象`);
  return { bytes, json };
}

/** 比较结构时忽略可选摘要，确保技术投影仍绑定确认过的 bounds/角色。 */
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (isObject(value)) return `{${Object.keys(value).filter((key) => !/(?:sha1|sha256|hash|fingerprint)/iu.test(key)).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; const encoded = JSON.stringify(value); return encoded === undefined ? "null" : encoded; }
/** 比较 proposal 顶层和 technical_analysis 的同一份拆解元素身份及顺序。 */
function sameElementSequence(actual, expected, label) { if (!Array.isArray(actual) || canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} 必须按已确认拆解元素原顺序逐项一致`); }

/** 校验拆解标注 PNG 的真实 metadata、尺寸及当前场景区域身份。 */
function validateDecompositionAnnotation(bytes, record, expectedRegions) {
  let decoded;
  try { decoded = decodePngRgba(bytes); } catch (error) { throw new Error(`最终拆解图不是合法 PNG：${error.message}`); }
  const metadata = decoded.metadata;
  if (!isObject(metadata) || metadata.schema !== "effect-image-annotation/png/1" || metadata.layout !== "image-plus-right-panel" || metadata.width !== decoded.width || metadata.height !== decoded.height || metadata.panel_content_complete !== true || !Array.isArray(metadata.regions)) throw new Error("最终拆解图缺少完整 schema/layout/尺寸/regions metadata");
  if (record.annotation_width !== decoded.width || record.annotation_height !== decoded.height) throw new Error("最终拆解图尺寸与确认记录不一致");
  const actualRegions = metadata.regions.map((item) => `${item?.annotation_number}\0${item?.region_id}\0${item?.scene_id}\0${item?.state_id}`).sort(); const expected = expectedRegions.map((region) => `${region.annotation_number}\0${region.id}\0${region.scene_id}\0${region.state_id}`).sort();
  if (JSON.stringify(actualRegions) !== JSON.stringify(expected)) throw new Error("最终拆解图 metadata 未完整绑定当前 scene/state 区域");
  return { decoded, metadata };
}

/** 校验 proposal 的拆解元素快照，确保布局节点只能从人工确认 proposal 重新推导。 */
function validateDecompositionProposal(proposal, record, scene, expectedRegions) {
  if (!isObject(proposal) || proposal.proposal_id !== record.proposal_id || proposal.scene_id !== scene.sceneId || proposal.state_id !== scene.stateId || proposal.annotation_file !== record.annotation_file) throw new Error("已确认 proposal 未绑定当前 confirmation/annotation/scene/state");
  const elements = proposal.decomposition_elements;
  const elementErrors = []; const elementById = validateDecompositionElements(elements, expectedRegions, scene.target.viewport, "proposal.decomposition_elements", elementErrors); if (elementErrors.length > 0 || !(elementById instanceof Map) || elementById.size !== elements?.length) throw new Error(elementErrors[0] ?? "已确认 proposal.decomposition_elements 无效");
  const technicalElements = proposal.technical_analysis?.decomposition_elements;
  sameElementSequence(technicalElements, elements, "proposal.technical_analysis.decomposition_elements");
  const proposalRegions = proposal.regions; if (!Array.isArray(proposalRegions) || proposalRegions.length !== expectedRegions.length) throw new Error("已确认 proposal.regions 未完整覆盖当前区域");
  for (const region of expectedRegions) {
    const item = proposalRegions.find((candidate) => candidate?.region_id === region.id);
    if (!item || item.annotation_number !== region.annotation_number || item.scene_id !== scene.sceneId || item.state_id !== scene.stateId) throw new Error(`proposal 未绑定区域 ${region.id} 的编号和 scene/state`);
  }
  const technicalRegions = proposal.technical_analysis?.regions; if (!Array.isArray(technicalRegions) || technicalRegions.length !== expectedRegions.length) throw new Error("proposal.technical_analysis.regions 未完整冻结区域元素");
  for (const region of expectedRegions) { const item = technicalRegions.find((candidate) => candidate?.region_id === region.id); const regionElements = elements.filter((element) => element.region_id === region.id); if (!item || item.scene_id !== scene.sceneId || item.state_id !== scene.stateId) throw new Error(`proposal technical_analysis 遗漏或篡改区域 ${region.id}`); sameElementSequence(item.decomposition_elements, regionElements, `proposal.technical_analysis.${region.id}.decomposition_elements`); }
  return { elements, elementIds: decompositionElementIds(elements) };
}

/** 校验 Stage A 决定与 user receipt，避免 pending/伪造文件启动布局阶段。 */
function validateDecompositionDecision(decision, receipt, record, scene, expectedRegions) {
  if (!isObject(decision) || decision.status !== "accepted" || decision.confirmation_mode !== "manual" || decision.confirmation_id !== record.confirmation_id || decision.proposal_id !== record.proposal_id || decision.user_statement !== record.user_original_text || decision.accepted_at !== record.accepted_at || decision.scene_id !== scene.sceneId || decision.state_id !== scene.stateId) throw new Error("decision_record 未绑定 accepted/manual 拆解确认、用户原文或 scene/state");
  const decisionRegions = decision.regions; if (!Array.isArray(decisionRegions) || decisionRegions.length !== expectedRegions.length) throw new Error("decision_record.regions 未完整绑定当前区域");
  for (const region of expectedRegions) { const item = decisionRegions.find((candidate) => candidate?.region_id === region.id); if (!item || item.annotation_number !== region.annotation_number || item.scene_id !== scene.sceneId || item.state_id !== scene.stateId) throw new Error(`decision_record 遗漏或篡改区域 ${region.id}`); }
  const receiptFields = ["message_id", "thread_id", "resolution_id", "author_role", "resolution_status", "resolved_from", "user_statement", "accepted_at", "scene_id", "state_id"];
  if (!isObject(receipt) || receiptFields.some((field) => !nonEmptyString(receipt[field]))) throw new Error("user_decision_receipt 缺少用户解除和场景身份字段");
  if (receipt.author_role !== "user" || receipt.resolution_status !== "resolved" || receipt.resolved_from !== "USER_INPUT_REQUIRED" || receipt.user_statement !== record.user_original_text || receipt.accepted_at !== record.accepted_at || receipt.scene_id !== scene.sceneId || receipt.state_id !== scene.stateId) throw new Error("user_decision_receipt 未绑定当前用户决定、拆解确认或 scene/state");
}

/** 复算完整 Stage A 文件/身份链；只有这条链通过才允许后置布局生成。 */
async function validateDecompositionConfirmationFiles(confirmation, scene, args, projectRoot, expectedRegions) {
  for (const field of DECOMPOSITION_REQUIRED_FIELDS) if (!Object.hasOwn(confirmation, field)) throw new Error(`拆解确认缺少 ${field}`);
  if (confirmation.confirmation_schema !== "visual-decomposition-confirmation/1.0" || confirmation.status !== "accepted" || confirmation.confirmation_mode !== "manual") throw new Error("布局阶段必须以前置 visual-decomposition-confirmation/1.0 的 accepted/manual 记录启动");
  if (confirmation.confirmation_id !== args.decompositionConfirmationId || !nonEmptyString(confirmation.proposal_id) || confirmation.scene_id !== scene.sceneId || confirmation.state_id !== scene.stateId || confirmation.annotation_mime !== "image/png" || !/\.png$/i.test(confirmation.annotation_file)) throw new Error("拆解确认未绑定显式 ID、proposal 或当前 scene/state");
  const annotation = await readBoundFile(projectRoot, confirmation.annotation_file, "最终拆解图"); validateDecompositionAnnotation(annotation.bytes, confirmation, expectedRegions);
  const proposal = await readBoundFile(projectRoot, confirmation.proposal_file, "已确认 proposal", true); const proposalFacts = validateDecompositionProposal(proposal.json, confirmation, scene, expectedRegions);
  const decision = await readBoundFile(projectRoot, confirmation.decision_record_file, "拆解 decision", true); const receipt = await readBoundFile(projectRoot, confirmation.user_decision_receipt_file, "拆解 user receipt", true); validateDecompositionDecision(decision.json, receipt.json, confirmation, scene, expectedRegions);
  return { confirmation, proposal: proposal.json, proposalBytes: proposal.bytes, elements: proposalFacts.elements, elementIds: proposalFacts.elementIds, annotationBytes: annotation.bytes };
}
/** 选取场景/状态合同，禁止跨场景复用拆解确认。 */
function sceneContract(manifest, sceneId, stateId) {
  const contract = manifest.scene_reconstruction_contract; if (!isObject(contract)) throw new Error("缺少 scene_reconstruction_contract，布局阶段不能从清单草案自行识别元素");
  const target = contract.target_conditions ?? contract.targetConditions; if (!isObject(target) || target.scene_id !== sceneId || target.state_id !== stateId) throw new Error("scene/state 与冻结场景合同不一致");
  const regions = (manifest.coverage_audit?.regions ?? []).filter((region) => region?.scene_id === sceneId && region?.state_id === stateId); if (regions.length === 0) throw new Error("选定 scene/state 没有 coverage 区域"); return { contract, target, regions, sceneId, stateId };
}
/** 从当前 scene/state 的人工确认记录中取唯一上游身份，并复算 proposal/拆解图文件。 */
async function resolveDecompositionConfirmation(manifest, sceneId, stateId, projectRoot, args, scene) {
  const regionConfirmations = scene.regions.map((region) => region.confirmation).filter(isObject);
  if (regionConfirmations.length > 0 && regionConfirmations.length !== scene.regions.length) throw new Error("当前 scene/state 存在未确认的拆解区域，布局阶段禁止启动");
  const confirmation = regionConfirmations.find((item) => item.confirmation_id === args.decompositionConfirmationId) ?? (regionConfirmations.length === 0 ? scene.contract.visual_decomposition_confirmation : null);
  if (!isObject(confirmation)) throw new Error("当前 scene/state 缺少可复核的拆解确认");
  for (const item of regionConfirmations) {
    for (const field of ["confirmation_id", "proposal_id", "proposal_file", "annotation_file", "decision_record_file", "user_decision_receipt_file"]) if (item[field] !== confirmation[field]) throw new Error(`拆解区域确认 ${field} 不一致，不能拼接未同批确认元素`);
  }
  return validateDecompositionConfirmationFiles(confirmation, scene, args, projectRoot, scene.regions);
}
/** 生成后置布局图；输入只来自前置拆解确认，不读取未确认 manifest 草案的元素集合。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const projectRoot = resolve(args.projectRoot);
    const manifest = await loadManifest(projectPath(projectRoot, args.manifest));
    const scene = sceneContract(manifest, args.sceneId, args.stateId);
    const upstream = await resolveDecompositionConfirmation(manifest, args.sceneId, args.stateId, projectRoot, args, scene);
    const decisionInput = await readBoundFile(projectRoot, args.layoutDecisionFile, "自动布局视觉决策", true);
    const decisionErrors = [];
    const alignmentDecisions = validateAutomaticLayoutDecision(decisionInput.json, { elements: upstream.elements, sceneId: args.sceneId, stateId: args.stateId, decompositionConfirmationId: args.decompositionConfirmationId }, decisionErrors);
    if (decisionErrors.length > 0 || !alignmentDecisions) throw new Error(decisionErrors[0] ?? "自动布局视觉决策无效");

    if (!isObject(manifest.reference_target) || !nonEmptyString(manifest.reference_target.original_file)) throw new Error("reference_target.original_file 必须绑定可读取的冻结参考图");
    const referenceFile = manifest.reference_target.original_file;
    const originalBytes = await readFile(projectPath(projectRoot, referenceFile));
    const dimensions = readPngDimensions(originalBytes);
    if (!dimensions || dimensions.width !== scene.target.viewport.width || dimensions.height !== scene.target.viewport.height) throw new Error("冻结原图 PNG 尺寸与场景 viewport 不一致");

    const outputPath = projectPath(projectRoot, args.output);
    const artifactPaths = deriveLayoutReviewArtifactPaths(projectRoot, outputPath);
    validateLayoutReviewArtifactPaths(projectRoot, artifactPaths, [args.manifest, referenceFile, upstream.confirmation.proposal_file, upstream.confirmation.annotation_file, upstream.confirmation.decision_record_file, upstream.confirmation.user_decision_receipt_file, args.layoutDecisionFile], args.layoutDecisionFile);
    const layoutNodes = deriveLayoutNodesFromDecompositionElements(upstream.elements, scene.target.viewport, { sceneId: args.sceneId, stateId: args.stateId, alignmentDecisions });
    const facts = deriveAutomaticLayoutFacts(layoutNodes, scene.target.viewport, { sceneId: args.sceneId, stateId: args.stateId });
    const layoutDecisionId = automaticLayoutDecisionId(decisionInput.json);
    const rendered = renderLayoutAnnotation(originalBytes, scene.target.viewport, facts, { targetSha256: scene.target.target_sha256, sceneId: args.sceneId, stateId: args.stateId, decompositionConfirmationId: args.decompositionConfirmationId, decompositionConfirmationSha256: args.decompositionConfirmationSha256, decompositionProposalSha256: args.proposalSha256, layoutDecisionId, layoutDecisionSha256: decisionInput.sha256 });
    const annotationBytes = rendered.bytes;
    const annotationSha256 = bundleSha256(annotationBytes);
    const identitySha256 = computeLayoutAnnotationIdentitySha256(annotationSha256, rendered.width, rendered.height, rendered.metadataSha256);
    const finalNodes = facts.filter((fact) => !fact.is_root_container);
    const rootNodes = facts.filter((fact) => fact.is_root_container === true);
    const commonContext = { projectRoot, viewport: scene.target.viewport, sceneId: args.sceneId, stateId: args.stateId, targetSha256: scene.target.target_sha256, decompositionConfirmationId: args.decompositionConfirmationId, decompositionConfirmationSha256: args.decompositionConfirmationSha256, proposalSha256: args.proposalSha256, referenceFile, referenceSha256: scene.target.target_sha256, proposalFile: upstream.confirmation.proposal_file, layoutDecisionId, layoutDecisionSha256: decisionInput.sha256, annotationSha256 };
    const nodesDocument = buildLayoutNodesDocument(facts, commonContext);
    const nodesBytes = serializeJson(nodesDocument);
    const nodesSha256 = bundleSha256(nodesBytes);
    const bindings = buildLayoutReviewBindings({ ...artifactPaths, annotationFile: artifactPaths.annotationFile, nodesFile: artifactPaths.nodesFile, decisionFile: artifactPaths.decisionFile }, { ...commonContext, nodesSha256 });
    const reviewBytes = renderLayoutReviewBundle({ nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes: decisionInput.bytes });
    const reviewSha256 = bundleSha256(reviewBytes);
    const reviewIdentitySha256 = computeLayoutReviewIdentitySha256(bindings);
    const result = { layout_annotation_file: artifactPaths.annotationFile, layout_annotation_mime: "image/png", layout_annotation_sha256: annotationSha256, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_schema: rendered.metadata.schema, layout_annotation_layout: rendered.metadata.layout, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: identitySha256, layout_review_file: artifactPaths.reviewFile, layout_review_sha256: reviewSha256, layout_review_identity_sha256: reviewIdentitySha256, layout_nodes_file: artifactPaths.nodesFile, layout_nodes_sha256: nodesSha256, decomposition_confirmation_id: args.decompositionConfirmationId, decomposition_confirmation_sha256: args.decompositionConfirmationSha256, proposal_sha256: args.proposalSha256, layout_decision_file: artifactPaths.decisionFile, layout_decision_sha256: decisionInput.sha256, layout_decision_id: layoutDecisionId, target_sha256: scene.target.target_sha256, scene_id: args.sceneId, state_id: args.stateId, decomposition_element_ids: upstream.elementIds, layout_node_ids: finalNodes.map((node) => node.layout_node_id), layout_nodes: finalNodes, root_nodes: rootNodes, generation_method: "automatic-visual-judgement-from-confirmed-decomposition", user_editable_final: true, layout_marker_map: rendered.metadata.marker_map, layout_marker_layouts: rendered.metadata.marker_layouts };
    // 所有字节在这里已经完成校验和计算；先让旧成功清单失效，再发布旁车工件和最终清单。
    const generationResultBytes = serializeJson(result);
    const generationResultSha256 = bundleSha256(generationResultBytes);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(artifactPaths.generationResult, serializeJson({ schema: "cocos-layout-generation-result/1.0", status: "invalidated", reason: "regeneration-in-progress" }));
    const decisionIsExistingOutput = pathsReferToSameFile(resolve(projectRoot, args.layoutDecisionFile), artifactPaths.decision);
    await Promise.all([writeFile(artifactPaths.annotation, annotationBytes), writeFile(artifactPaths.nodes, nodesBytes), ...(decisionIsExistingOutput ? [] : [writeFile(artifactPaths.decision, decisionInput.bytes)]), writeFile(artifactPaths.review, reviewBytes)]);
    // 生成结果最后写入，调用方只有在完整旁车工件已落盘后才能读取成功清单。
    await writeFile(artifactPaths.generationResult, generationResultBytes);
    console.log(JSON.stringify({ ...result, generation_result_file: artifactPaths.generationResultFile, generation_result_sha256: generationResultSha256 }));
    return 0;
  } catch (error) { console.error(`布局标注生成失败：${error.message}`); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
