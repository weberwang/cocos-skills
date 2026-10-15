#!/usr/bin/env node

/**
 * 布局审阅页工件合同。
 *
 * 生成器和确认门共用这里的节点文档、绑定对象、路径检查及身份计算，
 * 以保证 PNG、JSON 和离线 HTML 不会各自维护一套布局事实。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { renderLayoutReviewPage, readLayoutReviewPayload, validateReviewNodesDocument } from "./layout_review_page.mjs";

export const LAYOUT_NODES_SCHEMA = "cocos-layout-nodes/1.0";
export const LAYOUT_REVIEW_SCHEMA = "cocos-layout-review/1.0";
export const LAYOUT_REVIEW_STATUS = "candidate-awaiting-layout-confirmation";

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断非空字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 生成对象键排序、数组保序的确定性 JSON。 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 生成只用于比较的投影，可选摘要字段差异不改变节点与布局内容的一致性判断。 */
function canonicalWithoutSha(value) {
  if (Array.isArray(value)) return value.map(canonicalWithoutSha);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:sha1|sha256|hash|fingerprint)/iu.test(key))
    .map(([key, item]) => [key, canonicalWithoutSha(item)]));
}

/** 计算字节 SHA-256；工件身份统一使用 sha256: 前缀。 */
export function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 以稳定的可读格式序列化 JSON 工件。 */
export function serializeJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }

/** 将项目内路径转换成跨平台的项目相对路径。 */
export function projectRelativePath(projectRoot, value) {
  const root = resolve(projectRoot);
  const absolute = resolve(root, value);
  const lexical = relative(root, absolute);
  if (!lexical || lexical === ".." || lexical.startsWith("..\\") || lexical.startsWith("../") || isAbsolute(lexical)) throw new Error(`工件路径逃逸项目根目录：${value}`);
  const rootReal = realpathSync(root);
  const candidateReal = realPathOrNearest(absolute);
  if (candidateReal) {
    const realRelative = relative(rootReal, candidateReal);
    if (realRelative === ".." || realRelative.startsWith("..\\") || realRelative.startsWith("../") || isAbsolute(realRelative)) throw new Error(`工件真实路径逃逸项目根目录：${value}`);
  }
  return lexical.replace(/\\/g, "/");
}

/** 判断两个路径是否指向同一个项目位置；Windows 路径比较不区分大小写。 */
function samePath(left, right) {
  const leftReal = realPathOrNearest(resolve(left)); const rightReal = realPathOrNearest(resolve(right));
  return (leftReal ?? resolve(left)).toLowerCase() === (rightReal ?? resolve(right)).toLowerCase();
}

/** 判断生成器输入决定与默认副本是否为同一真实路径。 */
export function pathsReferToSameFile(left, right) { return samePath(left, right); }

/** 对不存在的输出文件解析最近存在祖先，检查目录 symlink 的真实落点。 */
function realPathOrNearest(path) {
  let cursor = resolve(path); const tail = [];
  while (!existsSync(cursor)) { const parent = dirname(cursor); if (parent === cursor) return null; tail.unshift(basename(cursor)); cursor = parent; }
  try { return resolve(realpathSync(cursor), ...tail); } catch { return null; }
}

/** 计算布局审阅页的四个默认旁车工件路径。 */
export function deriveLayoutReviewArtifactPaths(projectRoot, annotationPath) {
  const output = resolve(annotationPath);
  const directory = resolve(join(output, ".."));
  return {
    annotation: output,
    nodes: join(directory, "layout-nodes.json"),
    decision: join(directory, "layout-decision.json"),
    review: join(directory, "review.html"),
    generationResult: join(directory, "generation-result.json"),
    annotationFile: projectRelativePath(projectRoot, output),
    nodesFile: projectRelativePath(projectRoot, join(directory, "layout-nodes.json")),
    decisionFile: projectRelativePath(projectRoot, join(directory, "layout-decision.json")),
    reviewFile: projectRelativePath(projectRoot, join(directory, "review.html")),
    generationResultFile: projectRelativePath(projectRoot, join(directory, "generation-result.json")),
  };
}

/** 检查旁车工件不会覆盖上游确认文件或彼此互撞。 */
export function validateLayoutReviewArtifactPaths(projectRoot, paths, protectedFiles = [], decisionInputFile = null) {
  const outputPaths = [paths.annotation, paths.nodes, paths.decision, paths.review, paths.generationResult];
  const seen = new Map();
  for (const path of outputPaths) {
    const key = (realPathOrNearest(resolve(path)) ?? resolve(path)).toLowerCase();
    const previous = seen.get(key);
    if (previous) throw new Error(`布局审阅工件路径冲突：${previous} 与 ${path}`);
    seen.set(key, path);
    projectRelativePath(projectRoot, path);
  }
  for (const protectedFile of protectedFiles.filter(nonEmptyString)) {
    const protectedPath = resolve(projectRoot, protectedFile);
    for (const outputPath of outputPaths) {
      // 布局决定允许原地读取/复制到同目录默认名称，写入内容必须保持同一批输入字节。
      if (decisionInputFile && samePath(protectedPath, resolve(projectRoot, decisionInputFile)) && samePath(outputPath, paths.decision)) continue;
      if (samePath(protectedPath, outputPath)) throw new Error(`布局审阅工件不能覆盖上游文件：${protectedFile}`);
    }
  }
  return paths;
}

/** 从同一批 PNG 事实构造通用布局节点文档。 */
export function buildLayoutNodesDocument(facts, context = {}) {
  if (!Array.isArray(facts) || facts.length === 0) throw new Error("布局审阅节点文档需要非空布局事实");
  const layoutNodes = facts.filter((fact) => fact?.is_root_container !== true);
  const rootNodes = facts.filter((fact) => fact?.is_root_container === true);
  if (layoutNodes.length === 0 || rootNodes.length === 0) throw new Error("布局审阅节点文档必须同时包含非根节点和根节点");
  const viewport = context.viewport ?? context.targetViewport ?? context.target_viewport;
  if (!isObject(viewport) || !Number.isInteger(viewport.width) || viewport.width <= 0 || !Number.isInteger(viewport.height) || viewport.height <= 0) throw new Error("布局审阅节点文档缺少有效 viewport");
  const required = [["scene_id", context.sceneId ?? context.scene_id], ["state_id", context.stateId ?? context.state_id], ["decomposition_confirmation_id", context.decompositionConfirmationId ?? context.decomposition_confirmation_id], ["layout_decision_id", context.layoutDecisionId ?? context.layout_decision_id]];
  for (const [field, value] of required) if (!nonEmptyString(value)) throw new Error(`布局审阅节点文档缺少 ${field}`);
  return {
    schema: LAYOUT_NODES_SCHEMA,
    status: LAYOUT_REVIEW_STATUS,
    scene_id: context.sceneId ?? context.scene_id,
    state_id: context.stateId ?? context.state_id,
    viewport: { width: viewport.width, height: viewport.height },
    ...((context.targetSha256 ?? context.target_sha256) !== undefined ? { target_sha256: context.targetSha256 ?? context.target_sha256 } : {}),
    decomposition_confirmation_id: context.decompositionConfirmationId ?? context.decomposition_confirmation_id,
    ...((context.decompositionConfirmationSha256 ?? context.decomposition_confirmation_sha256) !== undefined ? { decomposition_confirmation_sha256: context.decompositionConfirmationSha256 ?? context.decomposition_confirmation_sha256 } : {}),
    ...((context.proposalSha256 ?? context.proposal_sha256) !== undefined ? { proposal_sha256: context.proposalSha256 ?? context.proposal_sha256 } : {}),
    layout_decision_id: context.layoutDecisionId ?? context.layout_decision_id,
    ...((context.layoutDecisionSha256 ?? context.layout_decision_sha256) !== undefined ? { layout_decision_sha256: context.layoutDecisionSha256 ?? context.layout_decision_sha256 } : {}),
    layout_nodes: layoutNodes,
    root_nodes: rootNodes,
  };
}

/** 构造审阅页唯一绑定对象；引用全部使用项目相对路径。 */
export function buildLayoutReviewBindings(paths, context = {}) {
  const viewport = context.viewport ?? context.targetViewport ?? context.target_viewport;
  const binding = {
    schema: LAYOUT_REVIEW_SCHEMA,
    status: LAYOUT_REVIEW_STATUS,
    scene_id: context.sceneId ?? context.scene_id,
    state_id: context.stateId ?? context.state_id,
    viewport: { width: viewport.width, height: viewport.height },
    decomposition_confirmation_id: context.decompositionConfirmationId ?? context.decomposition_confirmation_id,
    ...((context.decompositionConfirmationSha256 ?? context.decomposition_confirmation_sha256) !== undefined ? { decomposition_confirmation_sha256: context.decompositionConfirmationSha256 ?? context.decomposition_confirmation_sha256 } : {}),
    layout_decision_id: context.layoutDecisionId ?? context.layout_decision_id,
    reference: { file: projectRelativePath(context.projectRoot, context.referenceFile ?? context.reference_file), ...((context.referenceSha256 ?? context.reference_sha256) !== undefined ? { sha256: context.referenceSha256 ?? context.reference_sha256 } : {}) },
    proposal: { file: projectRelativePath(context.projectRoot, context.proposalFile ?? context.proposal_file), ...((context.proposalSha256 ?? context.proposal_sha256) !== undefined ? { sha256: context.proposalSha256 ?? context.proposal_sha256 } : {}) },
    decision: { file: paths.decisionFile, ...((context.layoutDecisionSha256 ?? context.layout_decision_sha256) !== undefined ? { sha256: context.layoutDecisionSha256 ?? context.layout_decision_sha256 } : {}) },
    nodes: { file: paths.nodesFile, ...((context.nodesSha256 ?? context.nodes_sha256) !== undefined ? { sha256: context.nodesSha256 ?? context.nodes_sha256 } : {}) },
    annotation: { file: paths.annotationFile, ...((context.annotationSha256 ?? context.annotation_sha256) !== undefined ? { sha256: context.annotationSha256 ?? context.annotation_sha256 } : {}) },
  };
  const errors = [];
  validateLayoutReviewBindings(binding, context, errors);
  if (errors.length > 0) throw new Error(errors[0]);
  return binding;
}

/** 计算绑定对象身份；HTML 不内嵌自身 SHA，避免自引用。 */
export function computeLayoutReviewIdentitySha256(bindings) { return sha256(Buffer.from(canonicalJson(bindings), "utf8")); }

/** 校验布局节点文档的结构和完整父子关系。 */
export function validateLayoutNodesDocument(document, expected = {}, errors = [], label = "layout_nodes") {
  if (!isObject(document)) { errors.push(`${label} 必须是 JSON 对象`); return null; }
  try { validateReviewNodesDocument(document); } catch (error) { errors.push(`${label} ${error.message}`); }
  for (const [field, value] of [["scene_id", expected.sceneId ?? expected.scene_id], ["state_id", expected.stateId ?? expected.state_id], ["decomposition_confirmation_id", expected.decompositionConfirmationId ?? expected.decomposition_confirmation_id], ["layout_decision_id", expected.layoutDecisionId ?? expected.layout_decision_id]]) if (value !== undefined && document[field] !== value) errors.push(`${label}.${field} 未绑定当前布局身份`);
  if (expected.layoutNodes && canonicalJson(document.layout_nodes) !== canonicalJson(expected.layoutNodes)) errors.push(`${label}.layout_nodes 与 PNG/生成结果的同批布局事实不一致`);
  if (expected.rootNodes && canonicalJson(document.root_nodes) !== canonicalJson(expected.rootNodes)) errors.push(`${label}.root_nodes 与 PNG/生成结果的同批布局事实不一致`);
  return document;
}

/** 校验审阅页绑定对象和所有文件引用的基本身份。 */
export function validateLayoutReviewBindings(bindings, expected = {}, errors = [], label = "layout_review") {
  if (!isObject(bindings)) { errors.push(`${label}.bindings 必须是对象`); return null; }
  if (bindings.schema !== LAYOUT_REVIEW_SCHEMA) errors.push(`${label}.schema 必须为 ${LAYOUT_REVIEW_SCHEMA}`);
  if (bindings.status !== LAYOUT_REVIEW_STATUS) errors.push(`${label}.status 必须标记为候选待人工布局确认`);
  for (const [field, value] of [["scene_id", expected.sceneId ?? expected.scene_id], ["state_id", expected.stateId ?? expected.state_id], ["decomposition_confirmation_id", expected.decompositionConfirmationId ?? expected.decomposition_confirmation_id], ["layout_decision_id", expected.layoutDecisionId ?? expected.layout_decision_id]]) if (value !== undefined && bindings[field] !== value) errors.push(`${label}.${field} 未绑定当前布局身份`);
  const viewport = bindings.viewport;
  if (!isObject(viewport) || !Number.isInteger(viewport.width) || viewport.width <= 0 || !Number.isInteger(viewport.height) || viewport.height <= 0) errors.push(`${label}.viewport 必须是正整数尺寸`);
  for (const name of ["reference", "proposal", "decision", "nodes", "annotation"]) {
    const item = bindings[name];
    if (!isObject(item) || !nonEmptyString(item.file)) errors.push(`${label}.${name} 必须包含项目相对 file`);
    else if (isAbsolute(item.file) || item.file.includes("..\\") || item.file.includes("../")) errors.push(`${label}.${name}.file 必须是项目相对路径`);
  }
  if (expected.referenceFile) {
    try { if (bindings.reference?.file !== projectRelativePath(expected.projectRoot, expected.referenceFile)) errors.push(`${label}.reference.file 未绑定当前参考图`); } catch (error) { errors.push(`${label}.reference.file 当前期望路径无效：${error.message}`); }
  }
  if (expected.proposalFile) {
    try { if (bindings.proposal?.file !== projectRelativePath(expected.projectRoot, expected.proposalFile)) errors.push(`${label}.proposal.file 未绑定当前拆解提案`); } catch (error) { errors.push(`${label}.proposal.file 当前期望路径无效：${error.message}`); }
  }
  return bindings;
}

/** 读取并验证审阅页数据块与外部节点文档的语义一致性。 */
export function readAndValidateLayoutReviewPayload(htmlBytes, nodesBytes, expected = {}, errors = [], label = "layout_review") {
  let payload;
  try { payload = readLayoutReviewPayload(htmlBytes.toString("utf8")); } catch (error) { errors.push(`${label} 无法解析唯一数据块：${error.message}`); return null; }
  if (!isObject(payload)) { errors.push(`${label} 数据块必须返回对象`); return null; }
  const bindingErrors = [];
  validateLayoutReviewBindings(payload.bindings, expected, bindingErrors, label);
  errors.push(...bindingErrors);
  if (bindingErrors.length > 0) return null;
  let externalNodes;
  try { externalNodes = JSON.parse(nodesBytes.toString("utf8")); } catch (error) { errors.push(`${label}.layout_nodes 外部 JSON 无效：${error.message}`); return null; }
  validateLayoutNodesDocument(externalNodes, expected, errors, `${label}.layout_nodes`);
  if (canonicalJson(canonicalWithoutSha(payload.nodesDocument)) !== canonicalJson(canonicalWithoutSha(externalNodes))) errors.push(`${label} HTML 数据块与外部 layout-nodes.json 内容不一致`);
  if (expected.nodesDocument && canonicalJson(canonicalWithoutSha(externalNodes)) !== canonicalJson(canonicalWithoutSha(expected.nodesDocument))) errors.push(`${label} HTML 节点文档不是本次生成的同一份布局事实`);
  return { ...payload, externalNodes };
}

/** 生成审阅页 HTML，并返回其 UTF-8 字节；该函数不创建任何确认记录。 */
export function renderLayoutReviewBundle({ nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes }) {
  const errors = [];
  validateLayoutNodesDocument(nodesDocument, {}, errors, "layout_nodes");
  validateLayoutReviewBindings(bindings, {}, errors, "layout_review");
  if (errors.length > 0) throw new Error(errors[0]);
  const html = renderLayoutReviewPage({ nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes });
  if (typeof html !== "string" || html.length === 0) throw new Error("布局审阅模板必须返回非空 HTML 字符串");
  return Buffer.from(html, "utf8");
}

/** 读取文件并计算真实 SHA，供确认门复用。 */
export function readFileSha256(projectRoot, file, label = "文件") {
  const path = resolve(projectRoot, file);
  const root = resolve(projectRoot);
  const lexical = relative(root, path);
  if (!lexical || lexical === ".." || lexical.startsWith("..\\") || lexical.startsWith("../") || isAbsolute(lexical)) throw new Error(`${label} 路径越界`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} 文件不存在`);
  const bytes = readFileSync(path);
  return { path, bytes, sha256: sha256(bytes) };
}
