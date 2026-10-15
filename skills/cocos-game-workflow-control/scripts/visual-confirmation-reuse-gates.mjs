#!/usr/bin/env node

/**
 * 视觉确认与既有资源复用的跨阶段硬门。
 *
 * 该模块保持 confirmation/reuse 规则与生产合同主流程解耦，避免主合同文件
 * 继续堆叠跨阶段身份检查。复用资源永远需要不可变快照，不能由方法字段自证。
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { validateVisualDecompositionConfirmations, buildVisualConfirmationAuthorityByRegion } from "./visual-decomposition-confirmation.mjs";
import { isPlainObject as isObject, nonEmptyString, VISUAL_PRODUCTION_METHODS as PRODUCTION_METHODS } from "./visual-contract-core.mjs";

const REUSE_SCHEMA = "asset-reuse-snapshot/1.0";

/** 统一生成门禁错误，保证每条失败都能定位编号和区域。 */
function gateError(context = {}, message, details = {}) {
  const stage = context.stage ?? "V3";
  const annotation = context.annotation_number ?? context.annotationNumber ?? "?";
  const region = context.region_id ?? context.regionId ?? "?";
  const expected = details.expectedMethod ?? context.expectedMethod ?? "production-contract";
  const observed = details.observedMethod ?? context.observedMethod ?? "missing";
  const missing = details.missing ? ` 缺失=${details.missing}` : "";
  return `[${stage}] annotation_number=${annotation} region_id=${region} expected_method=${expected} observed_method=${observed}${missing} ${message}`;
}
/** 统一 Change Request 的上下文，避免生产主文件重复拼接错误。 */
function changeContext(region, expectedMethod, observedMethod) {
  return { stage: "CHANGE_REQUEST", annotation_number: region?.annotation_number ?? "*", region_id: region?.id ?? region?.region_id ?? "*", expectedMethod, observedMethod };
}

/**
 * 将确认门固定为一个入口；调用方必须把 workflow authority 原样传入。
 * 缺少 check-files/authority 时由下层返回 decision gap，而不是浅层放行。
 */
export function validateVisualConfirmationGate(manifest, options = {}) {
  const authority = options.authority ?? options;
  const authorityByRegion = options.authorityByRegion ?? buildVisualConfirmationAuthorityByRegion(manifest, { ...options, authority });
  return validateVisualDecompositionConfirmations(manifest, { ...options, authorityByRegion, authority });
}

/** 校验复用快照文件位于项目根目录内，且不允许软链接逃逸。 */
function safeReusePath(projectRoot, value) {
  if (!nonEmptyString(projectRoot) || !nonEmptyString(value)) return null;
  const root = resolve(projectRoot); const candidate = resolve(root, value); const lexical = relative(root, candidate);
  if (!lexical || lexical === "." || lexical === ".." || lexical.startsWith("../") || lexical.startsWith("..\\") || isAbsolute(lexical)) return null;
  try {
    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    const realRelative = relative(realRoot, realCandidate);
    if (!realRelative || realRelative === "." || realRelative === ".." || realRelative.startsWith("../") || realRelative.startsWith("..\\") || isAbsolute(realRelative)) return null;
  } catch { return null; }
  return candidate;
}

/** 读取根目录内的真实来源文件；路径和内容结构负责验收，不复算摘要。 */
function readReuseFile(projectRoot, value, field, context, errors) {
  const path = safeReusePath(projectRoot, value);
  if (!path || !existsSync(path) || !statSync(path).isFile()) { errors.push(gateError(context, `复用快照 ${field} 文件不存在或路径越界`, { missing: field })); return null; }
  return { path, bytes: readFileSync(path) };
}

/**
 * 校验 reuse ⇔ reuse-existing 和不可变 asset-reuse-snapshot 合同。
 * check-files=false 只能用于结构扫描；进入后续阶段时必须重新走文件门。
 */
export function validateReuseProductionGate(contract = {}, context = {}, options = {}) {
  const errors = []; const plan = contract?.implementation_plan ?? contract?.implementationPlan ?? {};
  const method = contract?.production_method ?? contract?.productionMethod ?? contract?.production_contract?.production_method;
  const snapshot = contract?.reuse_snapshot ?? contract?.reuseSnapshot ?? plan?.reuse_source ?? plan?.reuseSource;
  const mode = plan?.mode;
  const reuseMethod = method === "reuse"; const reuseMode = mode === "reuse-existing";
  if (reuseMethod !== reuseMode) errors.push(gateError(context, "reuse 必须与 implementation_plan.mode=reuse-existing 一一对应", { expectedMethod: "reuse", observedMethod: method ?? mode ?? "missing" }));
  if (!reuseMethod && !reuseMode) return errors;
  if (!isObject(snapshot)) { errors.push(gateError(context, "reuse-existing 必须携带 asset-reuse-snapshot/1.0", { missing: "reuse_snapshot" })); return errors; }
  if (snapshot.schema !== REUSE_SCHEMA) errors.push(gateError(context, "复用快照 schema 必须为 asset-reuse-snapshot/1.0", { missing: REUSE_SCHEMA }));
  for (const field of ["source_file", "source_manifest_file", "compatibility_evidence_file", "accepted_at", "source_status"]) if (!Object.hasOwn(snapshot, field)) errors.push(gateError(context, "复用快照缺少不可变来源字段", { missing: `reuse_snapshot.${field}` }));
  if (snapshot.source_status !== "accepted") errors.push(gateError(context, "复用快照来源必须是 accepted 资源", { missing: "reuse_snapshot.source_status=accepted" }));
  if (!nonEmptyString(snapshot.source_file) || !/\.(?:png|jpe?g)$/i.test(snapshot.source_file)) errors.push(gateError(context, "复用源文件必须是 PNG/JPG 位图", { missing: "reuse_snapshot.source_file" }));
  if (!nonEmptyString(snapshot.accepted_at) || Number.isNaN(Date.parse(snapshot.accepted_at))) errors.push(gateError(context, "复用快照 accepted_at 无效", { missing: "reuse_snapshot.accepted_at" }));
  if (options.checkFiles !== true || !nonEmptyString(options.projectRoot)) { errors.push(gateError(context, "reuse 后续阶段必须使用 check-files/project-root 复算快照", { missing: "checkFiles=true,projectRoot" })); return errors; }
  const source = readReuseFile(options.projectRoot, snapshot.source_file, "source_file", context, errors);
  const manifest = readReuseFile(options.projectRoot, snapshot.source_manifest_file, "source_manifest_file", context, errors);
  const evidence = readReuseFile(options.projectRoot, snapshot.compatibility_evidence_file, "compatibility_evidence_file", context, errors);
  let manifestData; let evidenceData;
  try { if (manifest) manifestData = JSON.parse(manifest.bytes.toString("utf8")); } catch (caught) { errors.push(gateError(context, `复用 source_manifest_file 不是合法 JSON：${caught.message}`, { missing: "source_manifest_file" })); }
  try { if (evidence) evidenceData = JSON.parse(evidence.bytes.toString("utf8")); } catch (caught) { errors.push(gateError(context, `复用 compatibility_evidence_file 不是合法 JSON：${caught.message}`, { missing: "compatibility_evidence_file" })); }
  if (manifestData) {
    if (manifestData.status !== "accepted") errors.push(gateError(context, "复用 source manifest 必须处于 accepted 状态", { missing: "source_manifest.status=accepted" }));
    const registered = manifestData.source_file ?? manifestData.runtime_file ?? manifestData.file;
    if (registered && registered !== snapshot.source_file) errors.push(gateError(context, "复用快照 source_file 与 source manifest 不一致"));
    const snapshotAssetId = snapshot.source_asset_id ?? snapshot.sourceAssetId;
    const manifestAssetId = manifestData.asset_id ?? manifestData.assetId ?? manifestData.id;
    if (nonEmptyString(snapshotAssetId) && nonEmptyString(manifestAssetId) && snapshotAssetId !== manifestAssetId) errors.push(gateError(context, "复用快照 source_asset_id 与 source manifest 不一致"));
  }
  if (evidenceData && !["passed", "accepted", "verified"].includes(String(evidenceData.status ?? "").toLowerCase())) errors.push(gateError(context, "复用 compatibility evidence 必须是 passed/accepted/verified", { missing: "compatibility_evidence.status" }));
  const evidenceSource = evidenceData?.source_file ?? evidenceData?.sourceFile;
  if (nonEmptyString(evidenceSource) && evidenceSource !== snapshot.source_file) errors.push(gateError(context, "复用兼容证据未指向当前 source_file"));
  if (source && !source.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && !source.bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) errors.push(gateError(context, "复用 source_file 必须是真实 PNG/JPEG 文件", { missing: "source_file.magic" }));
  return errors;
}

/** 校验方法变更只能由完整 ACCEPTED 用户 Change Request 授权。 */
export function validateProductionMethodChangeRequest(change, context = {}) {
  const errors = [];
  const changes = Array.isArray(change?.production_method_changes) ? change.production_method_changes : (Array.isArray(change?.productionMethodChanges) ? change.productionMethodChanges : []);
  if (!changes.length) {
    const prefix = changeContext(context, context.proposedMethod ?? "production-method", "missing");
    if (change?.status !== "ACCEPTED" && context.workItemId) errors.push(gateError(prefix, `Change Request ${change?.changeRequestId ?? change?.change_request_id ?? change?.id ?? "?"} 必须为 ACCEPTED 用户决定`, { missing: "status=ACCEPTED" }));
    if (context.annotation_number !== undefined || context.region_id !== undefined || context.previousMethod !== undefined || context.proposedMethod !== undefined) errors.push(gateError(prefix, "Change Request 缺少逐区域 production_method_changes", { missing: "production_method_changes" }));
    return errors;
  }
  const requestWorkItem = change.workItemId; const requestCandidateVersion = change.candidateVersion;
  const requestContext = changeContext({ annotation_number: context.annotation_number, id: context.region_id }, context.proposedMethod ?? "production-method", context.previousMethod ?? "missing");
  const requestError = (message) => errors.push(gateError(requestContext, message));
  if (context.workItemId && requestWorkItem !== context.workItemId) requestError("workItemId 与当前工作项不一致");
  if (context.candidateVersion && requestCandidateVersion !== context.candidateVersion) requestError("candidateVersion 与当前候选版本不一致");
  for (const [index, item] of changes.entries()) {
    const local = changeContext({ annotation_number: item?.annotation_number, id: item?.region_id }, item?.proposed_method ?? "proposed-method", item?.previous_method ?? "previous-method");
    const error = (message, missing = "") => errors.push(gateError(local, `production method 变更[${index}] ${message}`, { missing }));
    if (change.status !== "ACCEPTED") error("只有 ACCEPTED Change Request 才能变更 production_method");
    if (!nonEmptyString(change.changeRequestId ?? change.change_request_id ?? change.id)) error("缺少 changeRequestId", "changeRequestId");
    if (!nonEmptyString(requestWorkItem)) error("缺少 workItemId", "workItemId");
    if (Object.hasOwn(change, "work_item_id")) error("禁止使用旧 work_item_id，必须使用 workItemId", "workItemId");
    if (Object.hasOwn(change, "candidate_version")) error("禁止使用旧 candidate_version，必须使用 candidateVersion", "candidateVersion");
    if (!nonEmptyString(requestCandidateVersion)) error("缺少候选版本绑定", "candidateVersion");
    if (!nonEmptyString(change.user_original_text ?? change.userOriginalText ?? change.user_original_request ?? change.userOriginalRequest ?? change.original_user_text ?? change.originalUserText)) error("缺少用户原文绑定", "user_original_text");
    const decidedAt = change.accepted_at ?? change.acceptedAt ?? change.decided_at ?? change.decidedAt;
    if (!nonEmptyString(decidedAt) || Number.isNaN(Date.parse(decidedAt))) error("缺少有效决定时间", "accepted_at");
    for (const field of ["region_id", "previous_method", "proposed_method"]) if (!nonEmptyString(item?.[field])) error(`缺少 ${field}`, field);
    if (!Number.isInteger(item?.annotation_number) || item.annotation_number <= 0) error("缺少合法 annotation_number", "annotation_number");
    if (context.annotation_number !== undefined && item.annotation_number !== context.annotation_number) error("annotation_number 与当前区域不一致", "annotation_number");
    if (context.region_id !== undefined && (item.region_id ?? item.regionId) !== context.region_id) error("region_id 与当前区域不一致", "region_id");
    if (context.previousMethod !== undefined && item.previous_method !== context.previousMethod) error("previous_method 与当前区域旧方法不一致", "previous_method");
    if (context.proposedMethod !== undefined && item.proposed_method !== context.proposedMethod) error("proposed_method 与当前区域新方法不一致", "proposed_method");
    if (item?.previous_method === item?.proposed_method) error("previous_method 与 proposed_method 不得相同");
    if (nonEmptyString(item?.proposed_method) && !PRODUCTION_METHODS.has(item.proposed_method)) error(`proposed_method 无效：${item.proposed_method}`);
  }
  return errors;
}

export { REUSE_SCHEMA };
