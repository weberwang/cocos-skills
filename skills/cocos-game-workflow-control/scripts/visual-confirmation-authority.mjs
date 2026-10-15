#!/usr/bin/env node

/**
 * 视觉确认的控制面权威加载器。
 *
 * Work Item 只保存 ledger_file/receipt_id 引用；真实 receipt 必须
 * 由编排层从受保护的 user-resolution-ledger 工件读取。可信标记使用模块私有
 * Symbol，JSON、manifest 和实施代理无法通过复制字段伪造 authority。
 */
import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathPatternCoversTarget } from "./path-matcher.mjs";

const TRUSTED_AUTHORITY = Symbol("trusted-visual-confirmation-authority");
const LEDGER_SCHEMA = "user-resolution-ledger/1.0";
const PROTECTED_PREFIX = ".workflow-control/user-resolutions/";
const RECEIPT_FIELDS = [
  "message_id", "thread_id", "author_role", "accepted_at",
  "work_item_id", "candidate_version", "scene_id", "state_id",
  "resolution_id", "resolution_status", "resolved_from", "user_statement",
];
const ENTRY_FIELDS = [
  ...RECEIPT_FIELDS, "receipt_id", "receipt_file", "annotation_file",
  "annotation_width", "annotation_height", "annotation_schema", "annotation_layout",
  "proposal_id", "proposal_file", "decision_record_file",
];

/** 判断普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断非空字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 规范化项目内路径，真实路径也必须留在项目边界内。 */
function safeProjectPath(projectRoot, value) {
  if (!nonEmptyString(projectRoot) || !nonEmptyString(value) || isAbsolute(value)) return null;
  const candidate = resolve(projectRoot, value); const root = resolve(projectRoot); const lexical = relative(root, candidate);
  if (!lexical || lexical === ".." || lexical.startsWith("..\\") || lexical.startsWith("../") || isAbsolute(lexical)) return null;
  try { const realRoot = realpathSync(root); const realCandidate = realpathSync(candidate); const realRelative = relative(realRoot, realCandidate); if (!realRelative || realRelative === ".." || realRelative.startsWith("..\\") || realRelative.startsWith("../") || isAbsolute(realRelative)) return null; }
  catch { return null; }
  return candidate;
}
/** 受保护的 user-resolution ledger 不能被普通代码路径引用。 */
function protectedLedgerPath(projectRoot, value) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  if (!normalized.startsWith(PROTECTED_PREFIX) || !normalized.endsWith(".json")) return null;
  return safeProjectPath(projectRoot, normalized);
}
/** 判断路径声明是否覆盖受保护 ledger；简单前缀足以拒绝越权覆盖。 */
/** 收集 package/delegation 的所有文件覆盖声明。 */
function collectCoverage(value, output = []) {
  if (Array.isArray(value)) { value.forEach((item) => collectCoverage(item, output)); return output; }
  if (!isObject(value)) return output;
  for (const field of ["ownedPaths", "outputPaths", "ownership", "allowedPaths"]) {
    const declared = value[field];
    if (typeof declared === "string") output.push(declared);
    else if (Array.isArray(declared)) output.push(...declared.map((item) => typeof item === "string" ? item : item?.path ?? item?.file ?? item?.outputPath));
    else if (isObject(declared)) output.push(declared.path ?? declared.file ?? declared.outputPath);
  }
  if (isObject(value.fileOwnership)) output.push(...Object.keys(value.fileOwnership));
  for (const field of ["executionUnits", "visualProductionUnits", "delegations", "units"]) if (Array.isArray(value[field])) value[field].forEach((item) => collectCoverage(item, output));
  return output.filter(nonEmptyString);
}
/** 返回 scene/state 稳定键。 */
export function visualConfirmationGroupKey(sceneId, stateId) { return `${sceneId}\0${stateId}`; }
/** 仅验证 Work Item 的引用形状，不读取文件。 */
export function validateVisualConfirmationReferences(work = {}) {
  const errors = [];
  if (Object.hasOwn(work, "userDecisionReceipt") || Object.hasOwn(work, "user_decision_receipt") || Object.hasOwn(work, "visualConfirmationAuthority") || Object.hasOwn(work, "visual_confirmation_authority")) errors.push("Work Item 禁止内嵌 userDecisionReceipt/visualConfirmationAuthority；必须引用 user-resolution-ledger");
  // 前置文件现在直接归属 Work Item；这里只校验引用形状，文件内容由 loader 复算。
  if (Object.hasOwn(work, "visual_confirmation_authority_refs")) errors.push("Work Item 禁止旧 snake_case visual_confirmation_authority_refs；必须升级为 visualConfirmationAuthorityRefs");
  const refs = work.visualConfirmationAuthorityRefs;
  if (refs === undefined) return errors;
  if (!Array.isArray(refs) || refs.length === 0) { errors.push("visualConfirmationAuthorityRefs 必须是非空数组"); return errors; }
  const groups = new Set();
  for (const [index, ref] of refs.entries()) {
    for (const field of ["scene_id", "state_id", "ledger_file", "receipt_id"]) if (!nonEmptyString(ref?.[field])) errors.push(`visualConfirmationAuthorityRefs[${index}] 缺少 ${field}`);
    const key = visualConfirmationGroupKey(ref?.scene_id, ref?.state_id);
    if (groups.has(key)) errors.push(`visualConfirmationAuthorityRefs[${index}] scene/state 重复：${key}`); groups.add(key);
    if (nonEmptyString(ref?.ledger_file) && (!ref.ledger_file.startsWith(PROTECTED_PREFIX) || !ref.ledger_file.endsWith(".json"))) errors.push(`visualConfirmationAuthorityRefs[${index}].ledger_file 必须位于 ${PROTECTED_PREFIX}`);
  }
  return errors;
}
/** 读取项目内 JSON 文件；验收使用显式记录身份与实际结构，不依赖摘要。 */
function readJsonFile(projectRoot, value, label, errors) {
  const path = safeProjectPath(projectRoot, value);
  if (!path || !existsSync(path) || !statSync(path).isFile()) { errors.push(`${label} 文件不存在或路径越界：${value}`); return null; }
  const bytes = readFileSync(path);
  try { return { path, bytes, json: JSON.parse(bytes.toString("utf8")) }; }
  catch (error) { errors.push(`${label} 不是合法 JSON：${error.message}`); return null; }
}
/** 校验 ledger entry 的用户决定与当前 Work Item/manifest 身份。 */
function validateEntry(entry, receipt, work, manifest, errors) {
  for (const field of ENTRY_FIELDS) if (!Object.hasOwn(entry, field)) errors.push(`ledger entry 缺少 ${field}`);
  for (const field of RECEIPT_FIELDS) if (!Object.hasOwn(receipt ?? {}, field)) errors.push(`receipt 缺少 ${field}`);
  for (const field of ["message_id", "thread_id", "author_role", "accepted_at", "work_item_id", "candidate_version", "scene_id", "state_id", "resolution_id", "resolution_status", "resolved_from", "user_statement"]) if (!nonEmptyString(entry?.[field]) || !nonEmptyString(receipt?.[field])) errors.push(`ledger/receipt ${field} 不能为空`);
  if (entry.author_role !== "user" || entry.resolution_status !== "resolved" || entry.resolved_from !== "USER_INPUT_REQUIRED") errors.push("ledger entry 必须是用户解除 USER_INPUT_REQUIRED 的记录");
  for (const field of RECEIPT_FIELDS) if (receipt?.[field] !== entry[field]) errors.push(`ledger entry 与 receipt.${field} 不一致`);
  if (!nonEmptyString(work?.workItemId) || entry.work_item_id !== work.workItemId) errors.push("ledger entry work_item_id 未绑定当前 Work Item");
  if (!nonEmptyString(manifest?.candidateVersion) || entry.candidate_version !== manifest.candidateVersion) errors.push("ledger entry candidate_version 未绑定当前候选版本");
  const expectedCandidateId = manifest?.candidateId ?? manifest?.candidate_id ?? manifest?.candidate_identity?.candidate_id ?? manifest?.candidate_identity?.candidateId;
  const observedCandidateId = entry.candidate_id ?? entry.candidateId;
  if (nonEmptyString(expectedCandidateId) && nonEmptyString(observedCandidateId) && observedCandidateId !== expectedCandidateId) errors.push("ledger entry candidate_id 未绑定当前候选");
  if (Number.isNaN(Date.parse(entry.accepted_at)) || Date.parse(entry.accepted_at) > Date.now() + 5 * 60 * 1000) errors.push(`ledger entry ${entry.receipt_id ?? "?"} accepted_at 无效或晚于当前时间`);
}
/** 由真实 ledger 构造带私有可信标记的 authority。 */
function trustedAuthority(fields) {
  const authority = { ...fields }; Object.defineProperty(authority, TRUSTED_AUTHORITY, { value: true, enumerable: false }); return authority;
}
/** 判断 authority 是否由本模块 loader 生成。 */
export function isTrustedVisualConfirmationAuthority(value) { return isObject(value) && value[TRUSTED_AUTHORITY] === true; }
/** 加载每个 scene/state 独立的 user-resolution ledger receipt。 */
export function loadVisualConfirmationAuthority(work, { projectRoot, manifest, checkFiles = true, implementationPackage = null, delegations = null } = {}) {
  const errors = []; const refs = work?.visualConfirmationAuthorityRefs;
  errors.push(...validateVisualConfirmationReferences(work));
  if (!Array.isArray(refs) || !refs.length) errors.push("缺少 Work Item.visualConfirmationAuthorityRefs，不能证明人工确认");
  if (!checkFiles || !nonEmptyString(projectRoot)) errors.push("decision gap：loader 必须在 check-files/projectRoot 模式读取 user-resolution-ledger");
  if (!isObject(manifest)) errors.push("decision gap：loader 必须绑定当前 visual manifest");
  const frozenPrerequisites = work?.visualConfirmationPrerequisiteFiles;
  if (!Array.isArray(frozenPrerequisites) || !frozenPrerequisites.length) errors.push("Work Item 缺少冻结的 visualConfirmationPrerequisiteFiles");
  const normalizedPrerequisites = Array.isArray(frozenPrerequisites) ? frozenPrerequisites.map((item) => String(item).replaceAll("\\", "/")) : [];
  if (normalizedPrerequisites.length !== new Set(normalizedPrerequisites).size || JSON.stringify(normalizedPrerequisites) !== JSON.stringify([...normalizedPrerequisites].sort())) errors.push("Work Item.visualConfirmationPrerequisiteFiles 必须是排序且唯一的冻结路径");
  const prerequisiteSet = new Set((Array.isArray(frozenPrerequisites) ? frozenPrerequisites : []).map((item) => String(item).replaceAll("\\", "/")));
  const groups = {}; const seenLedgers = new Set(); const seenReceipts = new Map();
  for (const ref of Array.isArray(refs) ? refs : []) {
    const groupKey = visualConfirmationGroupKey(ref.scene_id, ref.state_id); const ledgerPath = protectedLedgerPath(projectRoot, ref.ledger_file);
    if (!ledgerPath) { errors.push(`ledger_file 必须位于受保护目录 ${PROTECTED_PREFIX}：${ref.ledger_file ?? "missing"}`); continue; }
    if (seenLedgers.has(ref.ledger_file)) errors.push(`不同 scene/state 不得共享 ledger_file：${ref.ledger_file}`); seenLedgers.add(ref.ledger_file);
    // 每个 scene/state 必须有独立的用户解除记录；复用 receipt 身份会把场景确认串组。
    if (seenReceipts.has(ref.receipt_id) && seenReceipts.get(ref.receipt_id) !== groupKey) errors.push(`不同 scene/state 不得共享 receipt_id：${ref.receipt_id}`);
    seenReceipts.set(ref.receipt_id, groupKey);
    if (!prerequisiteSet.has(ref.ledger_file.replaceAll("\\", "/"))) errors.push(`ledger_file 必须存在于 Work Item 前置证据列表：${ref.ledger_file}`);
    if (collectCoverage(implementationPackage).some((path) => pathPatternCoversTarget(path, ref.ledger_file)) || collectCoverage(delegations).some((path) => pathPatternCoversTarget(path, ref.ledger_file))) errors.push(`ledger_file 不得被 Implementation Package ownedPaths/outputPaths 或委派动作覆盖：${ref.ledger_file}`);
    const ledgerBytes = existsSync(ledgerPath) ? readFileSync(ledgerPath) : null;
    if (!ledgerBytes) { errors.push(`ledger_file 不存在：${ref.ledger_file}`); continue; }
    let ledger; try { ledger = JSON.parse(ledgerBytes.toString("utf8")); } catch (error) { errors.push(`ledger_file JSON 无效：${error.message}`); continue; }
    if (ledger.schema !== LEDGER_SCHEMA) errors.push(`ledger schema 必须为 ${LEDGER_SCHEMA}`);
    if (ledger.work_item_id !== work?.workItemId) errors.push(`ledger 未绑定当前 Work Item：${ref.ledger_file}`);
    const entries = Array.isArray(ledger.entries) ? ledger.entries : []; const entry = entries.find((item) => item?.receipt_id === ref.receipt_id);
    if (!entry) { errors.push(`ledger 缺少 receipt_id=${ref.receipt_id}`); continue; }
    if (entry.scene_id !== ref.scene_id || entry.state_id !== ref.state_id) errors.push(`receipt_id=${ref.receipt_id} scene/state 与 Work Item 引用不一致`);
    if (!protectedLedgerPath(projectRoot, entry.receipt_file)) errors.push(`receipt_file 必须位于受保护目录 ${PROTECTED_PREFIX}：${entry.receipt_file ?? "missing"}`);
    const receiptFile = readJsonFile(projectRoot, entry.receipt_file, `receipt[${ref.receipt_id}]`, errors);
    const receiptPath = String(entry.receipt_file ?? "").replaceAll("\\", "/");
    if (!prerequisiteSet.has(receiptPath)) errors.push(`receipt_file 必须存在于 Work Item 前置文件列表：${entry.receipt_file}`);
    validateEntry(entry, receiptFile?.json, work, manifest, errors);
    if (groups[groupKey]) errors.push(`scene/state 组重复：${groupKey}`);
    groups[groupKey] = trustedAuthority({
      projectRoot, checkFiles: true, ledgerFile: ref.ledger_file, receiptId: ref.receipt_id, receiptFile: entry.receipt_file,
      sceneId: entry.scene_id, stateId: entry.state_id, targetFile: manifest?.reference_target?.original_file,
      workItemId: entry.work_item_id, candidateVersion: entry.candidate_version,
      userDecisionReceipt: receiptFile?.json, annotationFile: entry.annotation_file,
      annotationWidth: entry.annotation_width, annotationHeight: entry.annotation_height, annotationSchema: entry.annotation_schema, annotationLayout: entry.annotation_layout,
      proposalId: entry.proposal_id, proposalFile: entry.proposal_file, decisionRecordFile: entry.decision_record_file,
    });
  }
  if (errors.length) return { authority: { loaderErrors: errors }, authorityByGroup: {}, errors };
  const first = Object.values(groups)[0];
  const authority = trustedAuthority({ projectRoot, checkFiles: true, targetFile: manifest.reference_target?.original_file, targetFrozenAt: manifest.reference_target?.frozen_at, workItemId: work.workItemId, candidateId: manifest.candidateId ?? manifest.candidate_id ?? manifest.candidate_identity?.candidate_id ?? manifest.candidate_identity?.candidateId, candidateVersion: manifest.candidateVersion, authorityByGroup: groups });
  if (first && Object.keys(groups).length === 1) Object.assign(authority, { sceneId: first.sceneId, stateId: first.stateId, userDecisionReceipt: first.userDecisionReceipt, ledgerFile: first.ledgerFile, receiptId: first.receiptId, receiptFile: first.receiptFile, annotationFile: first.annotationFile, annotationWidth: first.annotationWidth, annotationHeight: first.annotationHeight, annotationSchema: first.annotationSchema, annotationLayout: first.annotationLayout });
  return { authority, authorityByGroup: groups, errors: [] };
}
/** workflow-control 调用的入口；失败时返回不可信对象，让下游输出 decision gap。 */
export function visualConfirmationAuthority(work, manifest = null, options = {}) { return loadVisualConfirmationAuthority(work, { ...options, manifest }).authority; }
