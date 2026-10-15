#!/usr/bin/env node

/**
 * 效果图原子拆解的人工确认合同。
 *
 * 该合同只允许一次明确的人工确认，并把编号 PNG、提案、冻结目标、
 * 区域定义、状态与资产需求绑定到同一身份。摘要仅可作为追踪信息，
 * 实际文件结构、区域事实和人工决定承担验收职责。旧的 AUTO 或隐式推断记录
 * 不会被转换为新记录；缺少新字段时必须重新生成并确认。
 */
import { createHash } from "node:crypto";
import { existsSync, statSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { normalizeVisualRegionDefinition } from "../../cocos-game-asset-integration/scripts/effect_image_annotation_core.mjs";
import { decodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { validateDecompositionElements } from "../../cocos-game-asset-integration/scripts/decomposition-elements.mjs";
import { deriveAtomicImageRequirements, normalizeAtomicImageRequirements } from "./visual-atomic-contract.mjs";
import { isTrustedVisualConfirmationAuthority, visualConfirmationGroupKey } from "./visual-confirmation-authority.mjs";
import { VISUAL_FIXED_IMAGE_METHODS as FIXED_VISUAL_IMAGE_METHODS, VISUAL_PROGRAM_METHODS as PROGRAM_VISUAL_METHODS } from "./visual-contract-core.mjs";

/** 人工拆解确认记录的唯一版本；改动字段时必须生成新版本。 */
export const VISUAL_DECOMPOSITION_CONFIRMATION_SCHEMA = "visual-decomposition-confirmation/1.0";
/** 对外保留拆解合同的词汇名称，实际集合由共享核心单一维护。 */
export { FIXED_VISUAL_IMAGE_METHODS, PROGRAM_VISUAL_METHODS };
const RUNTIME_OWNER_TYPES = new Set(["runtime-data", "runtime-rendered"]);
const PLAN_LABELS = new Map([["generate-now", "新建图片资产"], ["reuse-existing", "复用现有图片"], ["runtime-program", "程序绘制或动态逻辑"]]);
const REQUIRED_CONFIRMATION_FIELDS = [
  "confirmation_schema",
  "confirmation_id",
  "status",
  "confirmation_mode",
  "proposal_id",
  "proposal_file",
  "annotation_file",
  "annotation_mime",
  "annotation_width",
  "annotation_height",
  "annotation_schema",
  "annotation_layout",
  "decision_record_file",
  "user_decision_receipt_file",
  "scene_id",
  "state_id",
  "annotation_number",
  "region_id",
  "production_origin",
  "production_method",
  "delivery_kind",
  "production_label",
  "component_ids",
  "state_ids",
  "asset_requirement_ids",
  "asset_ids",
  "user_original_text",
  "accepted_at",
  "work_item_id",
  "candidate_version",
];

/** 判断值是否为普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断字符串是否非空。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 统一显示 production method，避免错误信息丢失实际观察值。 */
function methodOf(region = {}) { return region.production_method ?? region.productionMethod ?? region.production_contract?.production_method ?? region.productionContract?.production_method ?? "missing"; }
/** 读取固定视觉区域的计划模式。 */
function planModeOf(region = {}) { return region.implementation_plan?.mode ?? region.implementationPlan?.mode ?? ""; }
/** 取得必须冻结在确认记录中的中文生产标签。 */
function productionLabelOf(region = {}) {
  return region.production_label ?? region.productionLabel ?? PLAN_LABELS.get(planModeOf(region)) ?? methodOf(region);
}
/** 读取 coverage 的稳定区域 ID，兼容新的 region_id 命名但不做旧记录推断。 */
function regionIdOf(region = {}) { return region.id ?? region.region_id; }
/** 判断区域是否需要进入人工确认集合；集合覆盖全部编号，而不是只覆盖 bitmap-decomposition。 */
export function requiresManualVisualDecomposition(region = {}) {
  return isObject(region) && Number.isInteger(region.annotation_number) && region.annotation_number > 0 && nonEmptyString(regionIdOf(region));
}
/** 生成阶段、编号、区域和方法均齐全的错误，便于阻断定位。 */
function confirmationError(context = {}, message, details = {}) {
  const stage = context.stage ?? "V3";
  const annotation = context.annotation_number ?? context.annotationNumber ?? "?";
  const region = context.region_id ?? context.regionId ?? "?";
  const component = details.component_id ?? details.componentId ?? context.component_id;
  const observed = details.observedMethod ?? context.observedMethod ?? "missing";
  const componentLabel = component === undefined ? "" : ` component_id=${component}`;
  const missing = details.missing ? ` 缺失=${details.missing}` : "";
  return `[${stage}] annotation_number=${annotation} region_id=${region}${componentLabel} expected_method=manual-confirmation observed_method=${observed}${missing} ${message}`;
}
/** 收集编号区域必须冻结的生产、原子部件、状态和资产身份。 */
function regionIdentity(region = {}) {
  const canonical = normalizeVisualRegionDefinition(region);
  const inventory = region.component_inventory ?? region.componentInventory ?? {};
  const components = Array.isArray(inventory.components) ? inventory.components : [];
  const componentIds = components.map((item) => item?.component_id ?? item?.componentId ?? "").filter(nonEmptyString).sort();
  const stateIds = [...new Set([region.state_id, ...((Array.isArray(region.state_analysis?.states) ? region.state_analysis.states : []).map((state) => state?.state_id ?? state?.stateId ?? "")), ...components.flatMap((component) => {
    const states = Array.isArray(component?.state_coverage) ? component.state_coverage : (Array.isArray(component?.stateCoverage) ? component.stateCoverage : []);
    return states.map((state) => state?.state_id ?? state?.stateId ?? "").filter(nonEmptyString);
  })])].sort();
  const requirements = normalizeAtomicImageRequirements(region.atomic_image_requirements ?? region.atomicImageRequirements ?? deriveAtomicImageRequirements(region));
  const assetIds = [...new Set([
    ...(Array.isArray(canonical.asset_ids) ? canonical.asset_ids : []),
    canonical.asset_id,
    ...(Array.isArray(canonical.expected_assets) ? canonical.expected_assets.map((asset) => asset?.asset_id ?? asset?.assetId) : []),
  ].filter(nonEmptyString))].sort();
  return {
    productionOrigin: canonical.production_origin ?? null,
    productionMethod: canonical.production_method ?? "",
    deliveryKind: canonical.delivery_kind ?? "",
    productionLabel: productionLabelOf(region),
    componentIds,
    stateIds,
    assetRequirementIds: requirements.map((item) => item.requirement_id).filter(nonEmptyString).sort(),
    assetIds,
  };
}
/** 生成可写入提案、决定和 Implementation Package 的完整区域快照。 */
function regionSnapshot(region = {}) {
  const identity = regionIdentity(region);
  return {
    annotation_number: region.annotation_number,
    region_id: regionIdOf(region),
    scene_id: region.scene_id,
    state_id: region.state_id,
    production_origin: identity.productionOrigin,
    production_method: identity.productionMethod,
    delivery_kind: identity.deliveryKind,
    production_label: identity.productionLabel,
    component_ids: identity.componentIds,
    state_ids: identity.stateIds,
    asset_requirement_ids: identity.assetRequirementIds,
    asset_ids: identity.assetIds,
  };
}
/** 提案与决定文件必须冻结同一 annotation/proposal 下的全部编号定义。 */
function validateConfirmationRegionSet(observed, regions, context, errors, label) {
  if (!Array.isArray(observed)) { errors.push(confirmationError(context, `${label} 必须是非空数组`, { missing: label })); return; }
  const expected = regions.map(regionSnapshot).sort((left, right) => `${left.annotation_number}\0${left.region_id}`.localeCompare(`${right.annotation_number}\0${right.region_id}`));
  const actual = observed.slice().sort((left, right) => `${left?.annotation_number}\0${left?.region_id}`.localeCompare(`${right?.annotation_number}\0${right?.region_id}`));
  if (canonicalJson(withoutSummaryDigests(actual)) !== canonicalJson(withoutSummaryDigests(expected))) errors.push(confirmationError(context, `${label} 未完整冻结全部编号、生产标签、组件、状态和资产需求`, { missing: label }));
}
/** 校验真实 proposal 的显式元素、父级和技术分析投影，防止只改布局节点绕过拆解确认。 */
function validateProposalDecompositionElements(proposal, regions, canvas, context, errors, annotationMetadata) {
  const elements = proposal?.decomposition_elements;
  const elementErrors = [];
  const elementById = validateDecompositionElements(elements, regions, canvas, "proposal_file.decomposition_elements", elementErrors);
  errors.push(...elementErrors.map((message) => confirmationError(context, message, { missing: "proposal.decomposition_elements" })));
  if (!(elementById instanceof Map) || elementById.size !== elements?.length) return;
  const technical = proposal?.technical_analysis;
  if (!isObject(technical) || !Array.isArray(technical.decomposition_elements)) {
    errors.push(confirmationError(context, "proposal_file.technical_analysis.decomposition_elements 必须完整保留已确认元素", { missing: "proposal.technical_analysis.decomposition_elements" }));
  } else if (canonicalJson(technical.decomposition_elements) !== canonicalJson(elements)) {
    errors.push(confirmationError(context, "proposal_file technical_analysis 的语义元素/父级与顶层 proposal 不一致", { missing: "proposal.technical_analysis.decomposition_elements" }));
  }
  const metadataRegions = annotationMetadata?.regions;
  const metadataElements = Array.isArray(metadataRegions) ? metadataRegions.flatMap((item) => Array.isArray(item?.decomposition_elements) ? item.decomposition_elements : []) : [];
  if (!Array.isArray(metadataRegions) || canonicalJson(metadataElements) !== canonicalJson(elements)) errors.push(confirmationError(context, "proposal_file.decomposition_elements 未绑定拆解图中的同一语义元素顺序", { missing: "annotation-meta.regions.decomposition_elements" }));
  const technicalRegions = Array.isArray(technical?.regions) ? technical.regions : [];
  for (const region of regions) {
    const expected = elements.filter((element) => element.region_id === regionIdOf(region));
    const item = technicalRegions.find((candidate) => candidate?.region_id === regionIdOf(region));
    if (!item || canonicalJson(item.decomposition_elements) !== canonicalJson(expected)) errors.push(confirmationError({ ...context, annotation_number: region.annotation_number, region_id: regionIdOf(region) }, "proposal_file technical_analysis 区域未保留同一语义元素与父级", { missing: "technical_analysis.regions.decomposition_elements" }));
    const metadataRegion = Array.isArray(metadataRegions) ? metadataRegions.find((candidate) => candidate?.region_id === regionIdOf(region)) : null;
    if (!metadataRegion || canonicalJson(metadataRegion.decomposition_elements) !== canonicalJson(expected)) errors.push(confirmationError({ ...context, annotation_number: region.annotation_number, region_id: regionIdOf(region) }, "拆解图 metadata 未逐区域绑定同一语义元素与父级", { missing: "annotation-meta.region.decomposition_elements" }));
  }
}
/** 生成 Implementation Package 需要携带的带确认身份区域快照。 */
function packageRegionSnapshot(region = {}) {
  return { ...regionSnapshot(region), confirmation_id: region.confirmation?.confirmation_id };
}
/** 返回待确认的固定视觉区域，保持 annotation_number/region_id 作为唯一键。 */
export function manualDecompositionRegions(manifest = {}) {
  const regions = Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : [];
  return regions.filter((region) => isObject(region) && requiresManualVisualDecomposition(region)).map((region) => region.id ? region : { ...region, id: region.region_id });
}
/** 按 scene/state 分组确认，允许不同场景使用各自独立的标注、提案和决定文件。 */
export function visualConfirmationRegionGroupKey(region = {}) { return visualConfirmationGroupKey(region.scene_id ?? region.sceneId ?? "?", region.state_id ?? region.stateId ?? "?"); }
/** 返回每个 scene/state 的完整编号集合，组内必须同时覆盖生成、复用和非图片逻辑。 */
export function manualDecompositionGroups(manifest = {}) {
  const groups = new Map();
  for (const region of manualDecompositionRegions(manifest)) { const key = visualConfirmationRegionGroupKey(region); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(region); }
  return groups;
}
/** 为编排器显式构造逐编号权威上下文；校验器不会在缺少该上下文时从区域自证。 */
export function buildVisualConfirmationAuthorityByRegion(manifest = {}, base = {}) {
  const shared = isObject(base.authority) ? base.authority : base;
  return Object.fromEntries(manualDecompositionRegions(manifest).map((region) => {
    const group = shared?.authorityByGroup?.[visualConfirmationRegionGroupKey(region)] ?? shared;
    const authority = isObject(group) ? Object.create(group) : {};
    Object.assign(authority, { sceneId: region.scene_id, stateId: region.state_id, annotationNumber: region.annotation_number, regionId: regionIdOf(region) });
      return [`${region.annotation_number}\0${regionIdOf(region)}`, authority];
  }));
}
/** 以稳定键序列化权威确认，避免属性顺序成为哈希旁路。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}
/** 比较区域和证据语义时忽略摘要追踪字段，保留所有真实标识及内容事实。 */
function withoutSummaryDigests(value) {
  if (Array.isArray(value)) return value.map(withoutSummaryDigests);
  if (!isObject(value)) return value;
  const summaryKey = /(^|[_-])(sha1|sha256|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/i;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !summaryKey.test(key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))).map(([key, item]) => [key, withoutSummaryDigests(item)]));
}
/** 可选生成规范化确认摘要，仅用于追踪记录，不参与确认验收。 */
export function computeVisualConfirmationSha256(record = {}) {
  const payload = { ...record };
  delete payload.confirmation_sha256;
  return `sha256:${createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex")}`;
}
/** 可选生成用户原文摘要，仅用于追踪记录，不参与人工确认判断。 */
export function computeVisualUserMessageSha256(text) {
  return `sha256:${createHash("sha256").update(String(text ?? ""), "utf8").digest("hex")}`;
}
/** 计算标准标注 metadata 身份；JSON 属性顺序不影响确认哈希。 */
export function computeVisualAnnotationMetadataSha256(metadata = {}) {
  return `sha256:${createHash("sha256").update(canonicalJson(metadata), "utf8").digest("hex")}`;
}
/** 计算 PNG 字节、尺寸和 metadata 的标准重建身份。 */
export function computeVisualAnnotationIdentitySha256(annotationSha256, width, height, metadataSha256, schema, layout) {
  return `sha256:${createHash("sha256").update(canonicalJson({ annotation_sha256: annotationSha256, width, height, metadata_sha256: metadataSha256, schema, layout }), "utf8").digest("hex")}`;
}
/** 校验路径是项目内文件路径，避免确认记录指向仓库外证据。 */
function safeEvidencePath(projectRoot, value) {
  if (!nonEmptyString(projectRoot) || !nonEmptyString(value)) return null;
  const candidate = resolve(projectRoot, value);
  const root = resolve(projectRoot);
  const rel = relative(root, candidate);
  if (!rel || rel === "." || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) return null;
  try {
    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    const realRel = relative(realRoot, realCandidate);
    if (!realRel || realRel === "." || realRel === ".." || realRel.startsWith("..\\") || realRel.startsWith("../") || isAbsolute(realRel)) return null;
  } catch {
    return null;
  }
  return candidate;
}
/** 所有确认文件均必须走同一安全路径、存在性和 JSON 解析门。 */
function readConfirmationFile(projectRoot, value, field, context, errors, parseJson = false) {
  const path = safeEvidencePath(projectRoot, value);
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    errors.push(confirmationError(context, `${field} 文件不存在或路径越界`, { missing: field }));
    return null;
  }
  const bytes = readFileSync(path);
  if (!parseJson) return { path, bytes };
  try { return { path, bytes, json: JSON.parse(bytes.toString("utf8")) }; }
  catch (caught) { errors.push(confirmationError(context, `${field} 必须是可解析 JSON：${caught.message}`, { missing: field })); return null; }
}
/** 权威调用至少要提供文件门和冻结身份，禁止 direct validate 只做浅层字段检查。 */
function resolveAuthority(region, options = {}, context = {}, errors = []) {
  // 先检查 loader 的私有可信标记，再合并 manifest 当前身份；Work Item 不能覆盖 A/B 合同。
  const supplied = options.authority;
  if (!isTrustedVisualConfirmationAuthority(supplied)) {
    const details = Array.isArray(supplied?.loaderErrors) ? supplied.loaderErrors.join("；") : "authority 未由 user-resolution-ledger loader 生成";
    errors.push(confirmationError(context, `decision gap：${details}`, { missing: "trusted user-resolution-ledger authority" }));
    errors.push(confirmationError(context, "authority.sceneId 必须来自逐区域可信 loader 身份", { missing: "authority.sceneId" }));
  }
  const source = isObject(supplied) ? supplied : {};
  const current = options;
  const choose = (currentValue, suppliedValue, field) => {
    if (nonEmptyString(currentValue) && nonEmptyString(suppliedValue) && currentValue !== suppliedValue) errors.push(confirmationError(context, `authority.${field} 与当前 manifest/workflow 身份不一致`, { missing: currentValue }));
    return currentValue ?? suppliedValue;
  };
  const authority = {
    projectRoot: current.projectRoot ?? source.projectRoot,
    checkFiles: current.checkFiles ?? source.checkFiles,
    targetFrozenAt: choose(current.targetFrozenAt ?? current.target_frozen_at, source.targetFrozenAt ?? source.target_frozen_at, "targetFrozenAt"),
    workItemId: choose(current.workItemId ?? current.work_item_id, source.workItemId ?? source.work_item_id, "workItemId"),
    candidateVersion: choose(current.candidateVersion ?? current.candidate_version, source.candidateVersion ?? source.candidate_version, "candidateVersion"),
    ledgerFile: source.ledgerFile,
    receiptId: source.receiptId,
    receiptFile: source.receiptFile,
    userDecisionReceipt: source.userDecisionReceipt ?? source.user_decision_receipt,
    sceneId: current.sceneId ?? current.scene_id ?? source.sceneId ?? source.scene_id,
    stateId: current.stateId ?? current.state_id ?? source.stateId ?? source.state_id,
    annotationNumber: current.annotationNumber ?? current.annotation_number ?? source.annotationNumber ?? source.annotation_number,
    regionId: current.regionId ?? current.region_id ?? source.regionId ?? source.region_id,
    annotationWidth: source.annotationWidth ?? source.annotation_width,
    annotationHeight: source.annotationHeight ?? source.annotation_height,
    annotationSchema: source.annotationSchema ?? source.annotation_schema,
    annotationLayout: source.annotationLayout ?? source.annotation_layout,
  };
  for (const field of ["projectRoot", "targetFrozenAt", "workItemId", "candidateVersion", "ledgerFile", "receiptId", "receiptFile", "sceneId", "stateId", "annotationNumber", "regionId", "annotationWidth", "annotationHeight", "annotationSchema", "annotationLayout"]) {
    const valid = ["annotationNumber", "annotationWidth", "annotationHeight"].includes(field) ? Number.isInteger(authority[field]) && authority[field] > 0 : nonEmptyString(authority[field]);
    if (!valid) errors.push(confirmationError(context, `缺少权威确认身份 ${field}，不能浅层通过`, { missing: `authority.${field}` }));
  }
  if (nonEmptyString(authority.targetFrozenAt) && Number.isNaN(Date.parse(authority.targetFrozenAt))) errors.push(confirmationError(context, "权威 targetFrozenAt 必须是有效时间", { missing: "authority.targetFrozenAt" }));
  if (authority.checkFiles !== true) errors.push(confirmationError(context, "确认文件必须在 check-files 模式下读取并核对真实结构", { missing: "authority.checkFiles=true" }));
  if (!isObject(authority.userDecisionReceipt)) errors.push(confirmationError(context, "缺少 workflow preflight 提供的 user_decision_receipt 权威身份", { missing: "authority.userDecisionReceipt" }));
  return authority;
}
/** 比较两个数组身份，顺序不影响但重复和漏项都必须失败。 */
function sameSortedArray(left, right) {
  const normalize = (value) => Array.isArray(value) ? [...new Set(value.filter(nonEmptyString))].sort() : [];
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right)) && Array.isArray(left) && left.length === normalize(left).length;
}
/** 验证单个区域的人工确认记录、权威决定文件及其原子状态/资产映射。 */
export function validateVisualDecompositionConfirmationRecord(record, region, context = {}, options = {}) {
  const errors = [];
  const local = { ...context, annotation_number: region?.annotation_number, region_id: regionIdOf(region), observedMethod: methodOf(region) };
  const error = (message, details = {}) => errors.push(confirmationError(local, message, details));
  const authority = resolveAuthority(region, options, local, errors);
  if (!isObject(record)) { error("拆解分析图必须人工确认后才能进入下一阶段", { missing: "confirmation" }); return errors; }
  if (authority.receiptFile && record.user_decision_receipt_file !== authority.receiptFile) error("user_decision_receipt_file 未绑定 ledger receipt_file", { missing: authority.receiptFile });
  for (const field of REQUIRED_CONFIRMATION_FIELDS) if (!Object.hasOwn(record, field)) error("确认记录缺少新合同字段，必须升级记录", { missing: `confirmation.${field}` });
  if (record.confirmation_schema !== VISUAL_DECOMPOSITION_CONFIRMATION_SCHEMA) error("confirmation_schema 必须使用新的人工确认 schema，旧记录不兼容", { missing: "visual-decomposition-confirmation/1.0" });
  if (record.status !== "accepted") error("status 必须为 accepted，pending/auto 不能进入实施", { missing: "confirmation.status=accepted" });
  if (record.confirmation_mode !== "manual") error("confirmation_mode 必须为 manual，禁止 auto-confirm", { missing: "confirmation.confirmation_mode=manual" });
  if (record.mode !== undefined || record.confirmation_mode === "auto" || record.decision_source === "AUTO") error("禁止使用 AUTO 或旧确认模式，必须重新取得人工确认");
  if (record.annotation_mime !== "image/png") error("annotation_mime 必须为 image/png，拆解分析图只接受 PNG", { missing: "confirmation.annotation_mime=image/png" });
  if (nonEmptyString(record.annotation_file) && !/\.png$/i.test(record.annotation_file)) error("annotation_file 必须为 PNG，不能使用 SVG/JPG 标注图", { missing: "confirmation.annotation_file" });
  if (record.annotation_number !== authority.annotationNumber) error("annotation_number 未绑定权威确认编号", { missing: authority.annotationNumber });
  if (record.region_id !== authority.regionId) error("region_id 未绑定权威区域", { missing: authority.regionId });
  for (const [field, expected] of [["work_item_id", authority.workItemId], ["candidate_version", authority.candidateVersion], ["scene_id", authority.sceneId], ["state_id", authority.stateId]]) if (record[field] !== expected) error(`${field} 未绑定权威确认身份`, { missing: expected });
  for (const [field, expected] of [["annotation_width", authority.annotationWidth], ["annotation_height", authority.annotationHeight], ["annotation_schema", authority.annotationSchema], ["annotation_layout", authority.annotationLayout]]) if (record[field] !== expected) error(`${field} 未绑定 workflow preflight 的实际标注结构`, { missing: expected });
  const identity = regionIdentity(region);
  for (const [field, expected] of [["production_origin", identity.productionOrigin], ["production_method", identity.productionMethod], ["delivery_kind", identity.deliveryKind], ["production_label", identity.productionLabel]]) if ((record[field] ?? null) !== (expected ?? null)) error(`${field} 未冻结当前区域生产合同`, { missing: `confirmation.${field}` });
  for (const [field, expected] of [["component_ids", identity.componentIds], ["state_ids", identity.stateIds], ["asset_requirement_ids", identity.assetRequirementIds], ["asset_ids", identity.assetIds]]) if (!sameSortedArray(record[field], expected)) error(`${field} 未完整绑定当前原子拆解清单`, { missing: `confirmation.${field}` });
  if (!nonEmptyString(record.user_original_text)) error("user_original_text 必须记录用户原文", { missing: "confirmation.user_original_text" });
  if (!nonEmptyString(record.accepted_at) || Number.isNaN(Date.parse(record.accepted_at))) error("accepted_at 必须是有效人工确认时间", { missing: "confirmation.accepted_at" });
  if (authority.checkFiles === true && nonEmptyString(authority.projectRoot)) {
    const annotation = readConfirmationFile(authority.projectRoot, record.annotation_file, "annotation_file", local, errors);
    let annotationMetadata = null;
    let annotationCanvas = null;
    if (annotation) {
      try {
        const decoded = decodePngRgba(annotation.bytes);
        const metadata = decoded.metadata;
        annotationMetadata = metadata;
        if (Number.isFinite(metadata?.original_width) && Number.isFinite(metadata?.original_height)) annotationCanvas = { width: metadata.original_width, height: metadata.original_height };
        if (!isObject(metadata) || metadata.schema !== "effect-image-annotation/png/1" || metadata.layout !== "image-plus-right-panel" || metadata.width !== decoded.width || metadata.height !== decoded.height || metadata.panel_content_complete !== true || !Array.isArray(metadata.regions)) error("annotation_file 必须包含完整标准重建 metadata（schema/layout/尺寸/regions）", { missing: "annotation-meta" });
        if (decoded.width !== record.annotation_width || decoded.height !== record.annotation_height || metadata?.schema !== record.annotation_schema || metadata?.layout !== record.annotation_layout) error("annotation_file 实际尺寸/schema/layout 与确认记录不一致", { missing: "annotation_width/annotation_height/annotation_schema/annotation_layout" });
        if (Array.isArray(options.allRegions)) for (const expectedRegion of options.allRegions) {
          const actualRegion = metadata?.regions?.find((item) => item?.annotation_number === expectedRegion.annotation_number && item?.region_id === regionIdOf(expectedRegion));
          if (!actualRegion) {
            error("annotation_file metadata 缺少当前编号或区域", { missing: "annotation-meta.regions" });
            continue;
          }
          const expectedFacts = regionSnapshot(expectedRegion);
          const fields = ["scene_id", "state_id", "production_origin", "production_method", "delivery_kind", "production_label"];
          const differs = fields.some((field) => field === "production_origin"
            ? (actualRegion[field] || null) !== expectedFacts[field]
            : actualRegion[field] !== expectedFacts[field]);
          if (differs) error("annotation_file metadata 未绑定当前编号、场景状态和生产事实", { missing: "annotation-meta.regions" });
        }
      } catch (caught) { error(`annotation_file 不是完整合法 PNG：${caught.message}`, { missing: "annotation_file.strict-png" }); }
    }
    const proposal = readConfirmationFile(authority.projectRoot, record.proposal_file, "proposal_file", local, errors, true);
    const decision = readConfirmationFile(authority.projectRoot, record.decision_record_file, "decision_record_file", local, errors, true);
    const receipt = readConfirmationFile(authority.projectRoot, record.user_decision_receipt_file, "user_decision_receipt_file", local, errors, true);
    const proposalData = proposal?.json;
    const decisionData = decision?.json;
    const receiptData = receipt?.json;
    if (proposalData) {
      if (proposalData.proposal_id !== record.proposal_id || proposalData.annotation_file !== record.annotation_file) error("proposal_file 未绑定当前编号标注或提案身份");
      if (!nonEmptyString(proposalData.created_at) || Number.isNaN(Date.parse(proposalData.created_at))) error("proposal_file.created_at 无效", { missing: "proposal.created_at" });
      if (Number.isFinite(Date.parse(record.accepted_at)) && Number.isFinite(Date.parse(proposalData.created_at)) && Date.parse(record.accepted_at) <= Date.parse(proposalData.created_at)) error("accepted_at 必须晚于 proposal.created_at");
      if (!Array.isArray(options.allRegions) || options.allRegions.length === 0) error("文件门缺少当前 scene/state 的完整 allRegions，不能跳过 proposal 语义校验", { missing: "options.allRegions" });
      else {
        validateConfirmationRegionSet(proposalData.regions, options.allRegions, local, errors, "proposal_file.regions");
        validateProposalDecompositionElements(proposalData, options.allRegions, annotationCanvas, local, errors, annotationMetadata);
      }
    }
    if (decisionData) {
      if (decisionData.status !== "accepted" || decisionData.confirmation_mode !== "manual") error("decision_record_file 必须是 accepted/manual 的权威用户决定");
      if (decisionData.confirmation_id !== record.confirmation_id || decisionData.proposal_id !== record.proposal_id) error("decision_record_file 未绑定当前确认/提案身份");
      if (decisionData.user_statement !== record.user_original_text) error("decision_record_file.user_statement 与确认记录不一致");
      if (decisionData.accepted_at !== record.accepted_at) error("accepted_at 必须等于权威 decision_record.accepted_at");
      if (decisionData.work_item_id !== authority.workItemId || decisionData.candidate_version !== authority.candidateVersion) error("decision_record_file 未绑定当前 Work Item 或候选版本");
      if (Array.isArray(options.allRegions)) validateConfirmationRegionSet(decisionData.regions, options.allRegions, local, errors, "decision_record_file.regions");
    }
    if (receiptData) {
      for (const field of ["message_id", "thread_id", "author_role", "accepted_at", "work_item_id", "candidate_version", "scene_id", "state_id", "resolution_id", "resolution_status", "resolved_from", "user_statement"]) if (!nonEmptyString(receiptData[field])) error(`user_decision_receipt 缺少 ${field}`, { missing: `user_decision_receipt.${field}` });
      if (receiptData.author_role !== "user" || receiptData.resolution_status !== "resolved" || receiptData.resolved_from !== "USER_INPUT_REQUIRED") error("user_decision_receipt 必须是用户解除 USER_INPUT_REQUIRED 的权威记录");
      for (const [field, expected] of [["accepted_at", record.accepted_at], ["work_item_id", authority.workItemId], ["candidate_version", authority.candidateVersion], ["scene_id", authority.sceneId], ["state_id", authority.stateId], ["user_statement", record.user_original_text]]) if (receiptData[field] !== expected) error(`user_decision_receipt.${field} 与权威上下文不一致`);
      const expectedReceipt = authority.userDecisionReceipt;
      if (isObject(expectedReceipt)) for (const field of ["message_id", "thread_id", "author_role", "accepted_at", "work_item_id", "candidate_version", "scene_id", "state_id", "resolution_id", "resolution_status", "resolved_from", "user_statement"]) if (receiptData[field] !== expectedReceipt[field]) error(`user_decision_receipt.${field} 未匹配 workflow preflight authority`);
      if (Date.parse(receiptData.accepted_at) > Date.now() + 5 * 60 * 1000) error("user_decision_receipt.accepted_at 不得晚于当前时间（允许 5 分钟时钟偏差）");
    }
    if (Number.isFinite(Date.parse(record.accepted_at)) && Date.parse(record.accepted_at) > Date.now() + 5 * 60 * 1000) error("accepted_at 不得晚于当前时间（允许 5 分钟时钟偏差）");
    if (Number.isFinite(Date.parse(record.accepted_at)) && Number.isFinite(Date.parse(authority.targetFrozenAt)) && Date.parse(record.accepted_at) <= Date.parse(authority.targetFrozenAt)) error("accepted_at 必须晚于冻结目标时间");
  }
  return errors;
}
/** 校验清单中所有需要拆解确认的编号，拒绝少编号、重复编号和漏绑区域。 */
export function validateVisualDecompositionConfirmations(manifest = {}, options = {}) {
  const errors = [];
  const regions = manualDecompositionRegions(manifest);
  const authorityByRegion = options.authorityByRegion;
  if (regions.length && !authorityByRegion) errors.push(confirmationError({ stage: options.stage ?? "V3", annotation_number: "*", region_id: "*", observedMethod: "untrusted-authority" }, "decision gap：V2/V3/V4 必须由 workflow preflight 提供逐区域 authority map", { missing: "authorityByRegion/authority.sceneId" }));
  const identity = {
    projectRoot: options.projectRoot,
    checkFiles: options.checkFiles,
    targetFrozenAt: options.targetFrozenAt,
    workItemId: options.workItemId,
    candidateVersion: options.candidateVersion,
  };
  const seen = new Set();
  const sharedAcrossGroups = new Map();
  for (const [groupKey, groupRegions] of manualDecompositionGroups(manifest).entries()) {
    let shared = null;
    for (const region of groupRegions) {
      const key = `${region.annotation_number}\0${regionIdOf(region)}`;
      if (seen.has(key)) errors.push(confirmationError({ stage: options.stage ?? "V3", annotation_number: region.annotation_number, region_id: regionIdOf(region), observedMethod: methodOf(region) }, "确认区域编号重复"));
      seen.add(key);
      const record = region.confirmation;
      if (isObject(record)) {
        const currentShared = [record.confirmation_id, record.proposal_id, record.proposal_file, record.annotation_file, record.annotation_width, record.annotation_height, record.annotation_schema, record.annotation_layout, record.decision_record_file, record.user_decision_receipt_file];
        if (shared && JSON.stringify(shared) !== JSON.stringify(currentShared)) errors.push(confirmationError({ stage: options.stage ?? "V3", annotation_number: region.annotation_number, region_id: regionIdOf(region), observedMethod: methodOf(region) }, "同一 scene/state 组必须冻结同一 annotation/proposal/decision/receipt 身份"));
        shared ??= currentShared;
        const sharedKey = JSON.stringify(currentShared); const previousGroup = sharedAcrossGroups.get(sharedKey);
        if (previousGroup && previousGroup !== groupKey) errors.push(confirmationError({ stage: options.stage ?? "V3", annotation_number: region.annotation_number, region_id: regionIdOf(region), observedMethod: methodOf(region) }, "不同 scene/state 组不得共享 annotation/proposal/decision/receipt 文件身份"));
        sharedAcrossGroups.set(sharedKey, groupKey);
      }
      const authority = authorityByRegion?.[key] ?? options.authority;
      if (isObject(authority)) for (const [field, expected] of [["sceneId", region.scene_id], ["stateId", region.state_id], ["annotationNumber", region.annotation_number], ["regionId", regionIdOf(region)]]) if (authority[field] !== expected) errors.push(confirmationError({ stage: options.stage ?? "V3", annotation_number: region.annotation_number, region_id: regionIdOf(region), observedMethod: methodOf(region) }, `authority.${field} 未绑定当前区域定义`));
      errors.push(...validateVisualDecompositionConfirmationRecord(region.confirmation, region, { stage: options.stage ?? "V3" }, { ...options, authority, allRegions: groupRegions }));
    }
  }
  if (options.requireManualConfirmation !== false && regions.length === 0 && options.requireVisual === true) errors.push(confirmationError({ stage: options.stage ?? "V3" }, "效果图不存在可进入实施的人工拆解确认区域", { missing: "coverage_audit.regions" }));
  return errors;
}
/** 校验实施包携带的确认身份与当前清单所有区域逐项一致。 */
export function validateVisualDecompositionConfirmationBinding(pkg = {}, manifest = {}, options = {}) {
  const errors = [];
  const regions = manualDecompositionRegions(manifest);
  if (!regions.length) return errors;
  if (!isTrustedVisualConfirmationAuthority(options.authority)) errors.push(confirmationError({ stage: options.stage ?? "V3", annotation_number: "*", region_id: "*", observedMethod: "untrusted-authority" }, "decision gap：Implementation Package 绑定必须使用 user-resolution-ledger loader authority", { missing: "trusted authority" }));
  const groups = manualDecompositionGroups(manifest);
  const identities = pkg.visualDecompositionConfirmations;
  const context = { stage: options.stage ?? "V3", annotation_number: "*", region_id: "*", observedMethod: "manual-confirmation" };
  if (!Array.isArray(identities) || identities.length === 0) {
    errors.push(confirmationError(context, "Implementation Package 缺少按 scene/state 分组的 visualDecompositionConfirmations，不能进入实施", { missing: "visualDecompositionConfirmations" }));
    return errors;
  }
  const expectedGroupKeys = new Set(groups.keys()); const observedGroupKeys = new Set();
  for (const identity of identities) {
    const groupKey = `${identity?.scene_id ?? "?"}\0${identity?.state_id ?? "?"}`;
    if (observedGroupKeys.has(groupKey)) errors.push(confirmationError(context, "Implementation Package visualDecompositionConfirmations 不得重复 scene/state 组"));
    observedGroupKeys.add(groupKey);
    const groupRegions = groups.get(groupKey);
    if (!groupRegions) { errors.push(confirmationError({ ...context, region_id: groupKey }, "Implementation Package 包含 coverage 未声明的 scene/state 组")); continue; }
    const groupAuthority = options.authority?.authorityByGroup?.[groupKey] ?? options.authority;
    if (!isTrustedVisualConfirmationAuthority(groupAuthority)) errors.push(confirmationError({ ...context, region_id: groupKey }, "Implementation Package scene/state 组缺少独立可信 receipt", { missing: "authorityByGroup" }));
    for (const field of ["scene_id", "state_id", "ledger_file", "receipt_id", "confirmation_id", "proposal_id", "proposal_file", "annotation_file", "annotation_width", "annotation_height", "annotation_schema", "annotation_layout", "decision_record_file", "user_decision_receipt_file", "work_item_id", "candidate_version", "regions"]) if (!Object.hasOwn(identity, field)) errors.push(confirmationError({ ...context, region_id: groupKey }, "Implementation Package 分组确认身份缺少字段", { missing: `visualDecompositionConfirmations.${field}` }));
    for (const [field, expected] of [["work_item_id", manifest.workItemId], ["candidate_version", manifest.candidateVersion], ["scene_id", groupAuthority?.sceneId], ["state_id", groupAuthority?.stateId], ["ledger_file", groupAuthority?.ledgerFile], ["receipt_id", groupAuthority?.receiptId], ["user_decision_receipt_file", groupAuthority?.receiptFile], ["annotation_file", groupAuthority?.annotationFile], ["annotation_width", groupAuthority?.annotationWidth], ["annotation_height", groupAuthority?.annotationHeight], ["annotation_schema", groupAuthority?.annotationSchema], ["annotation_layout", groupAuthority?.annotationLayout]]) if (identity[field] !== expected) errors.push(confirmationError({ ...context, region_id: groupKey }, `Implementation Package ${field} 未与 manifest/ledger authority 三方绑定`));
    const boundRegions = Array.isArray(identity.regions) ? identity.regions : []; const observedKeys = new Set();
    for (const item of boundRegions) {
      const key = `${item?.annotation_number}\0${item?.region_id}`;
      if (observedKeys.has(key)) errors.push(confirmationError({ ...context, annotation_number: item?.annotation_number, region_id: item?.region_id }, "Implementation Package 确认编号重复"));
      observedKeys.add(key);
      const region = groupRegions.find((candidate) => `${candidate.annotation_number}\0${regionIdOf(candidate)}` === key);
      if (!region) { errors.push(confirmationError({ ...context, annotation_number: item?.annotation_number, region_id: item?.region_id }, "Implementation Package 确认包含 coverage 未声明编号")); continue; }
      const expected = packageRegionSnapshot(region);
      if (canonicalJson(withoutSummaryDigests(item)) !== canonicalJson(expected)) errors.push(confirmationError({ ...context, annotation_number: region.annotation_number, region_id: regionIdOf(region) }, "Implementation Package 未冻结 coverage 的同一确认身份、生产标签和原子清单"));
    }
    for (const region of groupRegions) if (!observedKeys.has(`${region.annotation_number}\0${regionIdOf(region)}`)) errors.push(confirmationError({ ...context, annotation_number: region.annotation_number, region_id: regionIdOf(region) }, "Implementation Package 漏绑确认编号", { missing: "visualDecompositionConfirmations.regions" }));
    const expectedIdentity = groupRegions[0]?.confirmation;
    if (expectedIdentity) for (const [field, value] of [["confirmation_id", expectedIdentity.confirmation_id], ["proposal_id", expectedIdentity.proposal_id], ["proposal_file", expectedIdentity.proposal_file], ["annotation_file", expectedIdentity.annotation_file], ["annotation_width", expectedIdentity.annotation_width], ["annotation_height", expectedIdentity.annotation_height], ["annotation_schema", expectedIdentity.annotation_schema], ["annotation_layout", expectedIdentity.annotation_layout], ["decision_record_file", expectedIdentity.decision_record_file], ["user_decision_receipt_file", expectedIdentity.user_decision_receipt_file], ["work_item_id", expectedIdentity.work_item_id], ["candidate_version", expectedIdentity.candidate_version]]) if (identity[field] !== value) errors.push(confirmationError({ ...context, region_id: groupKey }, `Implementation Package ${field} 未绑定 coverage 权威确认`));
  }
  for (const key of expectedGroupKeys) if (!observedGroupKeys.has(key)) errors.push(confirmationError({ ...context, region_id: key }, "Implementation Package 漏绑 scene/state 确认组", { missing: "visualDecompositionConfirmations" }));
  return errors;
}
/** 校验每个实施单元都绑定 coverage 对应的完整确认身份，不允许只在根包声明。 */
export function validateVisualProductionUnitConfirmation(unit = {}, region = null, pkg = {}, context = {}) {
  const errors = [];
  const error = (message, missing) => errors.push(confirmationError(context, message, { missing }));
  if (!nonEmptyString(unit.decomposition_confirmation_id)) error("实施单元缺少确认 ID，禁止进入实施", "decomposition_confirmation_id");
  if (region?.confirmation) {
    if (unit.decomposition_confirmation_id !== region.confirmation.confirmation_id) error("实施单元确认 ID 未绑定 coverage 对应确认", "confirmation.confirmation_id");
  }
  const groupKey = visualConfirmationRegionGroupKey(region ?? unit);
  const group = Array.isArray(pkg.visualDecompositionConfirmations) ? pkg.visualDecompositionConfirmations.find((item) => `${item?.scene_id ?? "?"}\0${item?.state_id ?? "?"}` === groupKey) : null;
  if (!group) error("实施单元缺少对应 scene/state 的 visualDecompositionConfirmations 分组", "visualDecompositionConfirmations");
  else {
    if (unit.decomposition_confirmation_id !== group.confirmation_id) error("实施单元确认 ID 未绑定对应 scene/state 分组", "visualDecompositionConfirmations.confirmation_id");
  }
  return errors;
}
/** 校验固定视觉和运行时逻辑的 owner/method/asset 边界。 */
export function validateFixedVisualProductionMethod(region, context = {}) {
  const errors = [];
  const canonical = normalizeVisualRegionDefinition(region);
  const ownerType = canonical.owner_type;
  const method = canonical.production_method ?? "missing";
  const local = { ...context, annotation_number: region?.annotation_number, region_id: regionIdOf(region), observedMethod: method };
  const error = (message, details = {}) => errors.push(confirmationError(local, message, details));
  const inventory = region?.component_inventory ?? region?.componentInventory ?? {};
  const components = Array.isArray(inventory.components) ? inventory.components : [];
  const expected = Array.isArray(canonical.expected_assets) ? canonical.expected_assets : [];
  const nested = region?.production_contract ?? region?.productionContract ?? {};
  const rawExpected = Array.isArray(region?.expected_assets ?? region?.expectedAssets) ? (region.expected_assets ?? region.expectedAssets) : (Array.isArray(nested.expected_assets ?? nested.expectedAssets) ? (nested.expected_assets ?? nested.expectedAssets) : expected);
  const actual = Array.isArray(region?.actual_assets ?? region?.actualAssets) ? (region.actual_assets ?? region.actualAssets) : [];
  const usages = region?.runtime_consumption?.component_usages ?? region?.runtime_consumption?.componentUsages;
  if (RUNTIME_OWNER_TYPES.has(ownerType)) {
    const nested = region?.production_contract ?? region?.productionContract ?? {};
    if (components.length || Object.hasOwn(region, "component_inventory") || Object.hasOwn(region, "componentInventory") || Object.hasOwn(nested, "component_inventory") || Object.hasOwn(nested, "componentInventory")) error("runtime-data/runtime-rendered 非图片逻辑不得携带 component_inventory", { component_id: components[0]?.component_id ?? "?" });
    const runtimeImplementation = canonical.runtime_implementation;
    for (const field of ["component_id", "componentId", "component_ids", "componentIds", "atomic_image_requirements", "atomicImageRequirements", "interaction_hotspots", "interactionHotspots", "asset_id", "assetId", "asset_ids", "assetIds", "expected_assets", "expectedAssets", "actual_assets", "actualAssets"]) if (Object.hasOwn(region, field) || Object.hasOwn(nested, field) || (isObject(runtimeImplementation) && Object.hasOwn(runtimeImplementation, field)) || (Array.isArray(canonical[field]) && canonical[field].length > 0) || nonEmptyString(canonical[field])) error(`${ownerType} 非图片逻辑不得携带 ${field}`);
    if (region?.runtime_consumption || usages || nested.runtime_consumption || nested.runtimeConsumption) error(`${ownerType} 非图片逻辑不得携带 runtime_consumption.asset/component 消费身份`);
    if (method !== "missing" && !PROGRAM_VISUAL_METHODS.has(method)) error(`${ownerType} 非图片逻辑只能使用 cocos-graphics/runtime-program`, { observedMethod: method });
    return errors;
  }
  if (ownerType !== "fixed-production-visual") return errors;
  // fixed-production-visual 永远是图片组件；delivery_kind 自报为 runtime-drawing 也不能绕过方法硬门。
  if (!FIXED_VISUAL_IMAGE_METHODS.has(method)) error("fixed-production-visual 只能使用 image-generation/authored-raster/reuse，禁止程序绘制、SVG 或缺失方法", { observedMethod: method });
  for (const component of components) {
    const componentMethod = component?.production_method ?? component?.productionMethod ?? component?.method;
    const componentDelivery = String(component?.delivery_kind ?? component?.deliveryKind ?? "").toLowerCase();
    if (componentMethod && !FIXED_VISUAL_IMAGE_METHODS.has(componentMethod)) error(`component ${component?.component_id ?? component?.componentId ?? "?"} 只能使用固定视觉位图生产方式`, { component_id: component?.component_id ?? component?.componentId ?? "?", observedMethod: componentMethod });
    if (componentDelivery && !["raster-image", "existing-asset"].includes(componentDelivery)) error(`component ${component?.component_id ?? component?.componentId ?? "?"} 不能使用程序绘制或矢量交付`, { component_id: component?.component_id ?? component?.componentId ?? "?", observedMethod: componentDelivery });
  }
  for (const requirement of Array.isArray(canonical.atomic_image_requirements) ? canonical.atomic_image_requirements : []) {
    const requirementMethod = requirement?.production_method ?? requirement?.productionMethod;
    const requirementDelivery = String(requirement?.delivery_kind ?? requirement?.deliveryKind ?? "").toLowerCase();
    if (requirementMethod && !FIXED_VISUAL_IMAGE_METHODS.has(requirementMethod)) error("atomic_image_requirements 不能声明程序绘制或 SVG 图片", { component_id: requirement?.component_id ?? "?", observedMethod: requirementMethod });
    if (requirementDelivery && !["raster-image", "existing-asset"].includes(requirementDelivery)) error("atomic_image_requirements 只能声明 raster-image/existing-asset", { component_id: requirement?.component_id ?? "?", observedMethod: requirementDelivery });
  }
  if (PROGRAM_VISUAL_METHODS.has(method)) {
    for (const component of components) errors.push(confirmationError({ ...local, component_id: component?.component_id ?? component?.componentId ?? "?" }, "程序绘制方法不能作为游戏图片 component/expected_asset/actual_asset/runtime consumption"));
  }
  for (const [list, listName] of [[rawExpected, "expected_assets"], [actual, "actual_assets"]]) list.forEach((asset, index) => {
    const assetMethod = asset?.production_method ?? asset?.productionMethod ?? asset?.method;
    const assetDelivery = String(asset?.delivery_kind ?? asset?.deliveryKind ?? "").toLowerCase();
    const assetKind = String(asset?.asset_kind ?? asset?.assetKind ?? asset?.kind ?? "").toLowerCase();
    if (assetDelivery && !["raster-image", "existing-asset"].includes(assetDelivery)) errors.push(confirmationError({ ...local, component_id: asset?.component_id ?? asset?.componentId ?? "?" }, `${listName}[${index}] fixed-production-visual 只能交付 raster-image/existing-asset`, { observedMethod: assetDelivery }));
    if (assetMethod === "authored-svg" || PROGRAM_VISUAL_METHODS.has(assetMethod) || assetMethod === "runtime-drawing" || assetDelivery === "runtime-drawing" || assetDelivery === "runtime-program" || /graphics|canvas|texture|runtime-program|runtime-drawing|svg/.test(assetKind)) errors.push(confirmationError({ ...local, component_id: asset?.component_id ?? asset?.componentId ?? "?" }, `${listName}[${index}] 不能使用程序绘制图片或 SVG`, { observedMethod: assetMethod ?? assetDelivery ?? assetKind }));
    if (nonEmptyString(assetMethod) && !FIXED_VISUAL_IMAGE_METHODS.has(assetMethod)) errors.push(confirmationError({ ...local, component_id: asset?.component_id ?? asset?.componentId ?? "?" }, `${listName}[${index}] production_method 必须与固定视觉图片方法一致`, { observedMethod: assetMethod }));
    if (FIXED_VISUAL_IMAGE_METHODS.has(method)) for (const [field, path] of [["source_file", asset?.source_file ?? asset?.sourceFile], ["runtime_file", asset?.runtime_file ?? asset?.runtimeFile], ["file", asset?.file ?? asset?.path]]) if (nonEmptyString(path) && !/\.(?:png|jpe?g)$/i.test(path)) errors.push(confirmationError({ ...local, component_id: asset?.component_id ?? asset?.componentId ?? "?" }, `${listName}[${index}].${field} 必须是 PNG/JPG 位图，不能使用 SVG 或其他格式`, { observedMethod: method }));
  });
  if (usages) for (const [index, usage] of (Array.isArray(usages) ? usages : []).entries()) {
    const usageMethod = usage?.production_method ?? usage?.productionMethod ?? usage?.method;
    const usageDelivery = String(usage?.delivery_kind ?? usage?.deliveryKind ?? "").toLowerCase();
    const usageKind = String(usage?.asset_kind ?? usage?.assetKind ?? "").toLowerCase();
    if (usageMethod === "authored-svg" || PROGRAM_VISUAL_METHODS.has(usageMethod) || usageMethod === "runtime-drawing" || usageDelivery === "runtime-drawing" || usageDelivery === "runtime-program" || /graphics|canvas|texture|runtime-program|runtime-drawing|svg/.test(usageKind)) error(`runtime_consumption.component_usages[${index}] 不能使用程序绘制图片或 SVG`, { component_id: usage?.component_id ?? "?", observedMethod: usageMethod ?? usageDelivery ?? usageKind ?? "missing" });
  }
  return errors;
}
