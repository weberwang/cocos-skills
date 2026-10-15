/**
 * 视觉清单确认与复用合同辅助模块。
 *
 * 该模块只依赖 workflow-control 的纯校验入口，不反向依赖清单主入口，
 * 让 annotation/proposal/decision 的 scene/state 分组门可以被文件门安全复用。
 */
import { buildVisualConfirmationAuthorityByRegion, validateVisualDecompositionConfirmations } from "../../cocos-game-workflow-control/scripts/visual-decomposition-confirmation.mjs";
import { validateLayoutAnnotationConfirmation } from "../../cocos-game-workflow-control/scripts/layout_annotation_confirmation.mjs";
import { auditProductionContract, resolveProductionContract, validateV4ProductionGate } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";


/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 校验 reuse 方法与 reuse-existing 执行模式的双向绑定。 */
export function validateReusePlanRelation(region, label, errors) {
  const method = resolveProductionContract(region).production_method;
  const mode = region?.implementation_plan?.mode;
  if (method === "reuse" && mode !== "reuse-existing") errors.push(`${label} annotation_number=${region?.annotation_number ?? "?"} region_id=${region?.id ?? "?"} production_method=reuse 必须绑定 implementation_plan.mode=reuse-existing，禁止 generate-now`);
  if (mode === "reuse-existing" && method !== "reuse") errors.push(`${label} annotation_number=${region?.annotation_number ?? "?"} region_id=${region?.id ?? "?"} implementation_plan.mode=reuse-existing 必须绑定 production_method=reuse`);
}

/** 校验人工确认的结构字段；实际内容与适配关系由文件门检查，SHA 仅作可选记录。 */
export function validateManualConfirmationEvidence(confirmation, label, errors) {
  if (confirmation?.confirmation_schema !== "visual-decomposition-confirmation/1.0") errors.push(`${label}.confirmation.confirmation_schema 必须为 visual-decomposition-confirmation/1.0`);
  if (confirmation?.status !== "accepted") errors.push(`${label}.confirmation.status 必须为 accepted`);
  if (confirmation?.confirmation_mode !== "manual" || Object.hasOwn(confirmation ?? {}, "mode")) errors.push(`${label}.confirmation_mode 必须为 manual accepted，禁止 AUTO/旧 mode`);
  // 必须保留人工决定、scene/state、区域、工作项与候选版本身份；摘要不参与通过判定。
  for (const field of ["confirmation_id", "proposal_id", "scene_id", "state_id", "annotation_number", "region_id", "production_origin", "production_method", "delivery_kind", "production_label", "component_ids", "state_ids", "asset_requirement_ids", "asset_ids", "user_original_text", "accepted_at", "work_item_id", "candidate_version"]) if (!Object.hasOwn(confirmation ?? {}, field)) errors.push(`${label}.confirmation.${field} 必须绑定人工确认身份`);
  for (const field of ["proposal_file", "annotation_file", "decision_record_file", "user_decision_receipt_file"]) if (!nonEmptyString(confirmation?.[field])) errors.push(`${label}.confirmation.${field} 必须绑定可读取的人工确认文件`);
  for (const field of ["annotation_width", "annotation_height", "annotation_schema", "annotation_layout"]) if (!Object.hasOwn(confirmation ?? {}, field) || (typeof confirmation[field] === "string" && !nonEmptyString(confirmation[field]))) errors.push(`${label}.confirmation.${field} 必须绑定实际标注结构`);
}

/** 校验实施模式及不可变复用快照的结构身份。 */
export function validateImplementationPlan(plan, region, assetById, label, errors) {
  if (!isObject(plan)) { errors.push(`${label}.implementation_plan 必须是对象`); return null; }
  const modes = new Set(["generate-now", "reuse-existing", "runtime-program"]);
  if (!modes.has(plan.mode)) errors.push(`${label}.implementation_plan.mode 无效`);
  if (!nonEmptyString(plan.summary)) errors.push(`${label}.implementation_plan.summary 必须是非空说明`);
  if (plan.mode === "generate-now" && region.owner_type !== "fixed-production-visual") errors.push(`${label} generate-now 只能用于 fixed-production-visual`);
  if (plan.mode === "runtime-program" && !["runtime-data", "runtime-rendered"].includes(region.owner_type)) errors.push(`${label} runtime-program 只能用于 runtime-data/runtime-rendered`);
  validateReusePlanRelation(region, label, errors);
  if (plan.mode === "reuse-existing") {
    if (region.owner_type !== "fixed-production-visual") errors.push(`${label} reuse-existing 只能用于 fixed-production-visual`);
    // 复用快照属于区域生产合同本身；工作流门也从区域顶层读取，避免嵌套字段被合并时丢失。
    const source = region.reuse_snapshot;
    const asset = assetById.get(region.asset_id ?? (Array.isArray(region.asset_ids) ? region.asset_ids[0] : undefined));
    if (!isObject(source)) { errors.push(`${label}.reuse_snapshot 必须是对象`); return plan.mode; }
    if (source.schema !== "asset-reuse-snapshot/1.0") errors.push(`${label}.reuse_snapshot.schema 必须为 asset-reuse-snapshot/1.0`);
    for (const field of ["source_file", "source_manifest_file", "compatibility_evidence_file", "accepted_at", "source_status"]) if (!Object.hasOwn(source, field)) errors.push(`${label}.reuse_snapshot.${field} 必须是可追溯来源字段`);
    if (nonEmptyString(source.source_file) && !/\.(?:png|jpe?g)$/i.test(source.source_file)) errors.push(`${label}.reuse_snapshot.source_file 必须是 PNG/JPG 位图`);
    if (nonEmptyString(source.source_manifest_file) && !source.source_manifest_file.toLowerCase().endsWith(".json")) errors.push(`${label}.reuse_snapshot.source_manifest_file 必须是 JSON 快照文件`);
    if (nonEmptyString(source.accepted_at) && Number.isNaN(Date.parse(source.accepted_at))) errors.push(`${label}.reuse_snapshot.accepted_at 必须是可解析时间`);
    if (source.source_status !== "accepted") errors.push(`${label}.reuse_snapshot.source_status 必须为 accepted`);
    if (!asset || asset.status !== "accepted") errors.push(`${label} reuse-existing 必须映射 status=accepted 的既有资源`);
    if (nonEmptyString(source.source_asset_id) && source.source_asset_id !== region.asset_id) errors.push(`${label}.reuse_snapshot.source_asset_id 必须等于区域 asset_id`);
  }
  return plan.mode;
}

/** 按 scene/state 划分独立确认组，防止不同画布共用确认文件。 */
function confirmationRegionGroups(data) {
  const groups = new Map();
  for (const region of data?.coverage_audit?.regions ?? []) {
    if (!isObject(region) || !Number.isInteger(region.annotation_number) || region.annotation_number <= 0 || !nonEmptyString(region.id)) continue;
    const key = `${region.scene_id}\0${region.state_id}`;
    const list = groups.get(key) ?? []; list.push(region); groups.set(key, list);
  }
  return [...groups.entries()].map(([key, regions]) => ({ key, sceneId: regions[0].scene_id, stateId: regions[0].state_id, regions: regions.slice().sort((left, right) => left.annotation_number - right.annotation_number) }));
}

/** 复制最小清单视图供共享门逐组校验。 */
function scopedConfirmationManifest(data, regions) {
  return { ...data, coverage_audit: { ...data.coverage_audit, regions } };
}

/** 生成确认文件门使用的根权威身份；清单自身不能伪造用户决定。 */
export function confirmationAuthorityBase(data, projectRoot, options = {}, group = null) {
  const configured = options.authority ?? options.userDecisionReceiptAuthority ?? options.user_decision_receipt_authority ?? options.userDecisionReceipt ?? data.user_decision_receipt_authority;
  // workflow-control loader 返回 authorityByGroup 和 camelCase 身份；这里仅做
  // 官方 authority 对象的字段适配，不接受清单自行声明的普通对象作为可信来源。
  const groupEntries = configured?.authorityByGroup ?? configured?.groups ?? configured?.by_scene_state;
  const groupAuthority = group && isObject(groupEntries) ? (groupEntries[group.key] ?? groupEntries[`${group.sceneId}/${group.stateId}`]) : null;
  const authority = isObject(groupAuthority) ? groupAuthority : (isObject(configured) ? configured : {});
  const receipt = authority.userDecisionReceipt ?? authority.receipt ?? authority.user_decision_receipt ?? authority;
  const camelFields = {
    target_sha256: "targetSha", target_frozen_at: "targetFrozenAt", work_item_id: "workItemId",
    candidate_version: "candidateVersion", candidate_sha256: "candidateSha",
    annotation_width: "annotationWidth", annotation_height: "annotationHeight", annotation_schema: "annotationSchema",
    annotation_layout: "annotationLayout", annotation_metadata_sha256: "annotationMetadataSha256", annotation_identity_sha256: "annotationIdentitySha256",
  };
  const read = (field, fallback = undefined) => authority[field] ?? authority[camelFields[field]] ?? configured?.[field] ?? configured?.[camelFields[field]] ?? fallback;
  return {
    // 保留 loader 产生的私有 authority，buildVisualConfirmationAuthorityByRegion
    // 会从此对象取得各 scene/state 的可信 receipt，而不是使用普通字段副本。
    authority: configured,
    projectRoot,
    checkFiles: true,
    targetSha: read("target_sha256", data.reference_target?.target_sha256),
    targetSha256: read("target_sha256", data.reference_target?.target_sha256),
    targetFrozenAt: read("target_frozen_at", data.reference_target?.frozen_at),
    // 只有 preflight authority 或显式调用方可以提供 Work Item/candidate 身份。
    workItemId: options.workItemId ?? read("work_item_id"),
    candidateVersion: options.candidateVersion ?? read("candidate_version"),
    candidateSha: options.candidateSha ?? read("candidate_sha256"),
    candidateSha256: options.candidateSha ?? read("candidate_sha256"),
    userDecisionReceipt: receipt,
    annotationWidth: read("annotation_width"),
    annotationHeight: read("annotation_height"),
    annotationSchema: read("annotation_schema"),
    annotationLayout: read("annotation_layout"),
    annotationMetadataSha256: read("annotation_metadata_sha256"),
    annotationIdentitySha256: read("annotation_identity_sha256"),
  };
}

/** 逐组运行人工确认门，并拒绝跨组复用确认身份和文件。 */
export function validateConfirmationGroups(data, options = {}) {
  const errors = [];
  const seen = new Map();
  for (const group of confirmationRegionGroups(data)) {
    const scoped = scopedConfirmationManifest(data, group.regions);
    const base = confirmationAuthorityBase(data, options.projectRoot, options, group);
    const authorityByRegion = buildVisualConfirmationAuthorityByRegion(scoped, base);
    errors.push(...validateVisualDecompositionConfirmations(scoped, { ...options, ...base, authorityByRegion, stage: options.stage ?? "V3", requireManualConfirmation: true }));
    const first = group.regions[0]?.confirmation;
    const decomposition = data.scene_reconstruction_contract?.layout_decomposition;
    const layoutConfirmation = decomposition?.layout_annotation_confirmation ?? decomposition?.layoutAnnotationConfirmation;
    const layoutTarget = data.scene_reconstruction_contract?.target_conditions ?? data.scene_reconstruction_contract?.targetConditions;
    // 一个场景还原合同只描述一个目标状态，不能拿它的布局确认去校验其他拆解组。
    if (isObject(layoutConfirmation) && group.sceneId === layoutTarget?.scene_id && group.stateId === layoutTarget?.state_id) {
      const decompositionConfirmation = data.scene_reconstruction_contract?.visual_decomposition_confirmation ?? first;
      validateLayoutAnnotationConfirmation(layoutConfirmation, { projectRoot: options.projectRoot, checkFiles: options.checkFiles === true, targetSha256: data.reference_target?.target_sha256, sceneId: group.sceneId, stateId: group.stateId, viewport: layoutTarget?.viewport, referenceFile: data.reference_target?.original_file, proposalFile: decompositionConfirmation?.proposal_file, decompositionConfirmationId: decompositionConfirmation?.confirmation_id, decompositionConfirmationSha256: decompositionConfirmation?.confirmation_sha256, proposalSha256: decompositionConfirmation?.proposal_sha256, layoutNodes: decomposition?.layout_nodes }, errors, `scene_reconstruction_contract.layout_decomposition.layout_annotation_confirmation[${group.sceneId}/${group.stateId}]`);
    }
    if (!isObject(first)) continue;
    for (const field of ["confirmation_id", "proposal_id", "proposal_file", "annotation_file", "decision_record_file", "user_decision_receipt_file"]) {
      const value = first[field];
      if (!nonEmptyString(value)) continue;
      const previous = seen.get(field);
      if (previous && previous.value === value) errors.push(`[${options.stage ?? "V3"}] scene_id=${group.sceneId} state_id=${group.stateId} confirmation ${field} 不得复用其他 scene/state 组文件或身份（已被 ${previous.group} 使用）`);
      else if (!previous) seen.set(field, { value, group: `${group.sceneId}/${group.stateId}` });
    }
  }
  return [...new Set(errors)];
}

/** 逐 scene/state 运行 V3 资源审计，使每组只比较自己的确认文件和编号集合。 */
export async function auditProductionContractByGroups(data, options = {}) {
  const groups = confirmationRegionGroups(data);
  if (groups.length === 0) return auditProductionContract(data, options);
  const errors = [];
  for (const group of groups) {
    const fixedRegions = group.regions.filter((region) => resolveProductionContract(region).owner_type === "fixed-production-visual");
    // 纯运行逻辑仍参加确认组，但不能伪造空的 production unit。
    if (fixedRegions.length === 0) continue;
    const scoped = scopedConfirmationManifest(data, group.regions);
    const units = data.production_contract_audit?.units;
    if (Array.isArray(units)) scoped.production_contract_audit = { ...data.production_contract_audit, units: units.filter((unit) => fixedRegions.some((region) => region.annotation_number === unit?.annotation_number && region.id === unit?.region_id)) };
    const base = confirmationAuthorityBase(data, options.projectRoot, options, group);
    errors.push(...await auditProductionContract(scoped, { ...options, ...base, projectRoot: options.projectRoot, checkFiles: options.checkFiles === true || base.checkFiles === true, authorityByRegion: buildVisualConfirmationAuthorityByRegion(scoped, base) }));
  }
  return [...new Set(errors)];
}

/** 逐 scene/state 运行 V4 总门，避免不同确认文件互相串联。 */
export function validateV4ProductionGateByGroups(data, options = {}) {
  const groups = confirmationRegionGroups(data);
  if (groups.length === 0) return validateV4ProductionGate(data, options);
  const errors = [];
  for (const group of groups) {
    const scoped = scopedConfirmationManifest(data, group.regions);
    const base = confirmationAuthorityBase(data, options.projectRoot, options, group);
    errors.push(...validateV4ProductionGate(scoped, { ...options, ...base, projectRoot: options.projectRoot, checkFiles: options.checkFiles === true || base.checkFiles === true, authorityByRegion: buildVisualConfirmationAuthorityByRegion(scoped, base) }));
  }
  return [...new Set(errors)];
}
