#!/usr/bin/env node
/**
 * 视觉 V0→V4 跨阶段硬门。
 *
 * 该模块只读取 Work Item 及其显式绑定的视觉证据，不接受根节点布尔值、
 * Approval Ledger 文本或 stageId 猜测。所有控制入口都应调用同一个函数，
 * 这样待审批的候选在 prepare、handoff、approve 和 advance 之间不会出现
 * 不同解释。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateArtExperienceAcceptance } from './art-experience-acceptance-contract.mjs';
import { validateGlobalVisualBaselineSelectionReferenceShape } from './global-visual-baseline-contract.mjs';
import { V2_PLAN_FIELDS } from './v2-reconstruction-plan-contract.mjs';
import { canonicalJson, deriveVisualDisposition, earliestVisualReturnStage as earliestReturnStage, isPlainObject as isObject, nonEmptyString as nonEmpty, VISUAL_REMEDIATION, VISUAL_REMEDIATION_LABEL, VISUAL_REMEDIATION_NEXT_ACTION } from './visual-contract-core.mjs';
export { VISUAL_REMEDIATION } from './visual-contract-core.mjs';

export const VISUAL_STAGE_IDS = Object.freeze(['V0', 'V1', 'V2', 'V3', 'V4']);
export const VISUAL_STAGE_STATES = Object.freeze([
  'not-started',
  'in-progress',
  'pending',
  'failed',
  'stale',
  'invalid',
  'global-static-baseline-frozen',
  'v2-production-planning-complete',
  'v3-formal-acceptance-complete',
  'v4-runtime-integration-candidate',
]);

export const VISUAL_STAGE_STATE_FOR = Object.freeze({
  V0: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'global-static-baseline-frozen']),
  V1: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'global-static-baseline-frozen']),
  V2: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v2-production-planning-complete']),
  V3: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v3-formal-acceptance-complete']),
  V4: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v4-runtime-integration-candidate']),
});

export const VISIBLE_VISUAL_BEHAVIORS = Object.freeze([
  'registersFormalScene',
  'replacesFormalScene',
  'modifiesBootEntry',
  'registersProductionEntry',
  'formalRuntimeConsumption',
  'deletesLegacyVisualImplementation',
  'declaresVisualComplete',
]);

const BEHAVIOR_ALIASES = Object.freeze({
  registersFormalScene: ['registersFormalScene', 'registerFormalScene', 'registers_formal_scene', 'register_formal_scene', 'formalSceneRegistration'],
  replacesFormalScene: ['replacesFormalScene', 'replaceFormalScene', 'replaces_formal_scene', 'replace_formal_scene'],
  modifiesBootEntry: ['modifiesBootEntry', 'modifyBootEntry', 'modifies_boot_entry', 'bootToVisibleScene', 'changesBootEntry'],
  registersProductionEntry: ['registersProductionEntry', 'registerProductionEntry', 'registers_production_entry', 'productionEntryRegistration', 'formalProductionEntry'],
  formalRuntimeConsumption: ['formalRuntimeConsumption', 'consumesFormalVisualAsset', 'consumeVisibleAsset', 'consumesVisibleAsset', 'consume_visible_asset', 'consumes_visible_asset', 'runtimeVisualIntegration', 'formal_runtime_consumption', 'runtime_visual_integration'],
  deletesLegacyVisualImplementation: ['deletesLegacyVisualImplementation', 'deleteLegacyVisualImplementation', 'deletes_legacy_visual_implementation', 'removesVisualFallback'],
  declaresVisualComplete: ['declaresVisualComplete', 'visualComplete', 'productionizedVisual', 'declares_visual_complete', 'sceneUiComplete'],
});

const FORMAL_TEXT = /(?:register|replace|modify|change|wire|connect|consume|delete|remove|complete|productioniz|publish|正式|注册|替换|接入|消费|删除|移除|生产化|完成|可发布).*(?:scene|ui|visual|asset|background|character|vfx|icon|font|boot|入口|场景|界面|视觉|资源|背景|角色|特效|图标|字体)|(?:scene|ui|visual|asset|background|character|vfx|icon|font|boot|入口|场景|界面|视觉|资源|背景|角色|特效|图标|字体).*(?:register|replace|modify|change|wire|connect|consume|delete|remove|complete|productioniz|publish|正式|注册|替换|接入|消费|删除|移除|生产化|完成|可发布)/i;
const FORMAL_RUNTIME_INTENT_TEXT = /(?:boot\s*(?:→|->|to)\s*scene|(?:register|replace|wire|connect|modify|change|consume|delete|remove|publish|接入|注册|替换|连接|修改|更改|消费|删除|移除|发布).{0,32}(?:boot|main\s*scene|scene|ui|主场景入口|场景入口|正式入口|场景|界面|boot入口)|(?:boot|main\s*scene|scene|ui|主场景入口|场景入口|正式入口|场景|界面|boot入口).{0,32}(?:registration|integration|entry|runtime|注册|接入|集成|运行时|消费|入口)|(?:consume|use|load|render|消费|使用|加载|渲染).{0,24}(?:visible|formal|production|可见|正式|运行时)?.{0,12}(?:visual\s*)?(?:assets?|images?|sprites?|资源|图片|图像)|(?:formal|正式).{0,16}(?:main\s*(?:scene|entry)|boot\s*(?:entry|scene)|scene\s*entry|ui\s*entry|主场景入口|正式入口|boot→scene)|正式.{0,12}(?:boot|main\s*scene|scene|ui).{0,12}(?:接入|注册|集成|入口))/i;
const GRAYBOX_TEXT = /(?:graybox|greybox|placeholder|prototype|diagnostic|sandbox|isolated|隔离|灰盒|占位|原型|诊断|沙盒)/i;
const VISUAL_CONTEXT_TEXT = /(?:visual|scene|ui|asset|resource|effect|sprite|background|character|vfx|icon|font|视觉|场景|界面|资源|特效|角色|背景|图标|字体)/i;
const PENDING_ASSET_STATUS = new Set(['planned', 'pending', 'unapproved', 'proposed', 'producing', 'review']);
const OPTIONAL_SNAPSHOT_FIELDS = new Set([
  'sha256', 'targetSha256', 'target_sha256', 'candidateSha256', 'candidate_sha256',
  'baselineHash', 'baseline_hash', 'baselineSha256', 'baseline_sha256', 'contentHash', 'content_hash', 'contentSha256', 'content_sha256', 'artifactHash', 'artifact_hash', 'artifactFingerprint', 'artifact_fingerprint',
  'dependencyHash', 'dependency_hash', 'dependencySha256', 'dependency_sha256', 'diffFingerprint', 'diff_fingerprint', 'diffSha256', 'diff_sha256', 'candidateHash', 'candidate_hash', 'candidate_sha',
  'targetHash', 'target_hash', 'target_sha', 'evidenceSha256', 'evidence_sha256', 'visualManifestSha256', 'visual_manifest_sha256',
  'referenceSha256', 'reference_sha256', 'layoutContractSha256', 'layout_contract_sha256', 'conditionsFingerprint', 'conditions_fingerprint', 'styleFingerprint', 'style_fingerprint',
  'briefSha256', 'brief_sha256', 'outputSha256', 'output_sha256', 'decisionSha256', 'decision_sha256', 'documentSha256', 'document_sha256',
  'annotationSha256', 'annotation_sha256', 'receiptSha256', 'receipt_sha256', 'proposalSha256', 'proposal_sha256', 'metadataSha256', 'metadata_sha256',
]);
const SNAPSHOT_IDENTITY_KEYS = Object.freeze([
  'workItemId', 'unitResultId', 'candidateId', 'candidateVersion',
  'V2DecompositionConfirmationId', 'V2PlanSceneId', 'V3AcceptanceId', 'V4CandidateId',
  'V2ReferencePath', 'V3ReferencePath', 'V4ReferencePath',
]);

const REMEDIATION_LABEL = VISUAL_REMEDIATION_LABEL;
const REMEDIATION_NEXT_ACTION = VISUAL_REMEDIATION_NEXT_ACTION;
/** 识别行为时只读取字段值，避免对象键名（例如 visualIntegration）制造假阳性。 */
function valuesOnly(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => valuesOnly(item, depth + 1));
  if (isObject(value)) return Object.values(value).flatMap((item) => valuesOnly(item, depth + 1));
  return [];
}

/** 只接受显式 V0-V4；stageId、文本和用户回复不能替代阶段声明。 */
export function normalizeVisualStage(value) {
  const stage = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VISUAL_STAGE_IDS.includes(stage) ? stage : null;
}

/** 读取 canonical visualStage 字段，同时拒绝 snake_case 值冲突。 */
export function readVisualStage(subject = {}) {
  const values = [subject.visualStage, subject.visual_stage, subject.visualPhase, subject.visual_phase].filter((value) => value !== undefined);
  if (!values.length) return { stage: null, conflicts: [] };
  const normalized = values.map(normalizeVisualStage);
  return { stage: normalized[0], conflicts: normalized.some((item) => item === null) || new Set(normalized).size > 1 ? values : [] };
}

/** 校验阶段声明自身；即使工作尚未进入正式集成，也不接受裸 frozen 或未知 V 阶段。 */
export function validateVisualStageDeclaration(subject = {}) {
  const errors = [];
  const { stage, conflicts } = readVisualStage(subject);
  const rawStageId = String(subject.stageId ?? '').trim();
  const baselineState = firstValue(subject.globalStaticBaselineState, subject.global_static_baseline_state);
  const visualContext = Boolean(subject.visualStage || subject.visual_stage || subject.visualStageState || subject.visual_stage_state || baselineState || subject.visualDomain || subject.visualWork || VISUAL_CONTEXT_TEXT.test(String(subject.domain ?? '')) || /^V/i.test(rawStageId));
  if (!visualContext) return errors;
  if (conflicts.length) errors.push(error('VISUAL_STAGE_DECLARATION_INVALID', 'visualStage 字段未知或互相矛盾，不允许猜测', { missingEvidence: ['visualStage'] }));
  if (/^V/i.test(rawStageId) && !/^V[0-4]$/i.test(rawStageId)) errors.push(error('VISUAL_STAGE_UNKNOWN', `未知视觉阶段：${rawStageId}`, { missingEvidence: ['visualStage'] }));
  if ((subject.visualStageState ?? subject.visual_stage_state ?? subject.visualState ?? subject.visual_state) === 'frozen') errors.push(error('VISUAL_BARE_FROZEN', '裸 frozen 没有视觉阶段语义；请使用 global-static-baseline-frozen 或 v2-production-planning-complete', { missingEvidence: ['visualStageState'] }));
  if (baselineState && baselineState !== 'global-static-baseline-frozen') errors.push(error(baselineState === 'frozen' ? 'VISUAL_BARE_FROZEN' : 'VISUAL_STAGE_STATE_INVALID', '全局静态基线状态必须为 global-static-baseline-frozen，且不能代替 V2', { missingEvidence: ['globalStaticBaselineState'] }));
  const state = firstValue(subject.visualStageState, subject.visual_stage_state, subject.visualState, subject.visual_state);
  if (stage && state !== null && !VISUAL_STAGE_STATE_FOR[stage]?.has(String(state))) errors.push(error('VISUAL_STAGE_STATE_INVALID', `阶段 ${stage} 与状态 ${String(state)} 不匹配`, { missingEvidence: ['visualStageState'] }));
  // 全局冻结状态必须绑定三候选人工选择证据；只写状态字段不能绕过冻结前置。
  // 这里仅校验消费者引用的 path+sha 形状；根证据的生产者链由 loader 完整复核。
  if (baselineState === 'global-static-baseline-frozen' || ((stage === 'V0' || stage === 'V1') && state === 'global-static-baseline-frozen')) {
    const selectionErrors = validateGlobalVisualBaselineSelectionReferenceShape(subject.globalVisualBaselineSelectionRef);
    for (const message of selectionErrors) errors.push(error('GLOBAL_VISUAL_BASELINE_SELECTION_MISSING', message, { missingEvidence: ['globalVisualBaselineSelectionRef'] }));
  }
  if (/^V[0-4]$/i.test(rawStageId) && stage && rawStageId.toUpperCase() !== stage) errors.push(error('VISUAL_STAGE_DECLARATION_CONFLICT', 'stageId 仅作范围标签，必须与显式 visualStage 一致且不能替代它', { missingEvidence: ['visualStage'] }));
  if (stage && !state) errors.push(error('VISUAL_STAGE_STATE_MISSING', `阶段 ${stage} 缺少有语义状态`, { missingEvidence: ['visualStageState'] }));
  if (!stage && /^V[0-4]$/i.test(rawStageId)) errors.push(error('VISUAL_STAGE_MISSING', 'V0-V4 工作必须显式声明 visualStage，不能从 stageId 推断', { missingEvidence: ['visualStage'] }));
  return errors;
}

/** 从 Work Item 的行为字段中识别正式可见视觉集成；stageId 本身不参与证据替代。 */
export function classifyVisibleVisualProductionIntegration(subject = {}) {
  const behaviorSource = [subject.visualIntegration, subject.visual_integration, subject.visualBehaviors, subject.visual_behaviors, subject.behaviors, subject].filter(Boolean);
  const behaviors = [];
  for (const behavior of VISIBLE_VISUAL_BEHAVIORS) {
    const aliases = BEHAVIOR_ALIASES[behavior];
    if (behaviorSource.some((source) => aliases.some((key) => source?.[key] === true))) behaviors.push(behavior);
  }
  if (subject.visibleVisualProductionIntegration === true || subject.visible_visual_production_integration === true || subject.requiresVisualStageGate === true || subject.requires_visual_stage_gate === true) behaviors.push('explicit-visible-visual-integration');
  const behaviorText = valuesOnly({
    domain: subject.domain,
    objective: subject.objective,
    inScope: subject.inScope,
    approvedRequirements: subject.approvedRequirements,
    pendingApprovalObject: subject.pendingApprovalObject,
    pendingApprovalContext: subject.pendingApprovalContext,
    userOriginalText: subject.userOriginalText,
    visualIntegration: subject.visualIntegration,
    behaviors: subject.behaviors,
    visualBehaviors: subject.visualBehaviors,
  }).join(' ');
  const visualContext = Boolean(subject.visualDomain || subject.visualWork || subject.visualStage || subject.visual_stage || VISUAL_CONTEXT_TEXT.test(`${subject.domain ?? ''} ${behaviorText}`));
  const stage = readVisualStage(subject).stage;
  // V3 本身就是正式资源生产阶段，Main 等 stageId 只是贯穿 Work Item 的范围标签；只有真实运行入口/消费意图才触发下游硬门。
  const v3ResourceStageWithoutRuntimeIntent = stage === 'V3' && !FORMAL_RUNTIME_INTENT_TEXT.test(behaviorText);
  const stageHint = /(?:production-entry|formal-entry|main|integration|integrate|正式入口|主场景|集成)/i.test(String(subject.stageId ?? ''));
  if (visualContext && stageHint && !v3ResourceStageWithoutRuntimeIntent) behaviors.push('stage-scope-requires-visual-gate');
  if (!behaviors.length && FORMAL_TEXT.test(behaviorText) && visualContext && !v3ResourceStageWithoutRuntimeIntent) behaviors.push('formal-visual-text');
  const graybox = subject.graybox === true || subject.grayBox === true || subject.isolatedPrototype === true || GRAYBOX_TEXT.test(behaviorText);
  const formal = behaviors.length > 0;
  // 灰盒只在未声明正式行为时豁免；一旦同一项工作注册正式入口，灰盒文字不能降级门槛。
  const isolatedGraybox = graybox && !formal && (subject.actionLevel === 'A2' || subject.pendingApprovalActionLevel === 'A2' || subject.safeA3 === true || subject.isolated === true);
  return { isVisibleVisualProductionIntegration: formal && !isolatedGraybox, behaviors: [...new Set(behaviors)], visualContext, graybox, isolatedGraybox };
}

/** 将证据状态规范化为只用于严格枚举比较的小写文本。 */
function textStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** 取得候选列表中的首个普通对象。 */
function firstObject(...values) { return values.find(isObject) ?? null; }
/** 取得候选列表中的首个已声明值。 */
function firstValue(...values) { return values.find((value) => value !== undefined && value !== null && value !== '') ?? null; }

/** 从冻结 V2 场景及当前工作包的显示层上下文确定验收场景身份。 */
function artAcceptanceSceneId(subject, v2, options) {
  const sceneId = nonEmpty(v2?.sceneId) ? v2.sceneId : null;
  if (!sceneId) return null;
  const declaredScene = firstValue(subject.sceneId, subject.scene_id);
  const declaredHost = firstValue(subject.hostSceneId, subject.host_scene_id);
  if ((declaredScene && declaredScene !== sceneId) || (declaredHost && declaredHost !== sceneId)) return null;

  const contexts = Array.isArray(v2.displayLayerContexts) ? v2.displayLayerContexts : [];
  const layerId = firstValue(subject.displayLayerId, subject.display_layer_id);
  if (layerId) {
    const matches = contexts.filter((context) => context?.displayLayerId === layerId);
    if (matches.length !== 1 || matches[0].hostSceneId !== sceneId || (declaredHost && declaredHost !== matches[0].hostSceneId)) return null;
  }
  // DISPLAY_LAYER 的身份只能沿 V2 中唯一的 layer→host 关系归一到实际宿主场景。
  const displayUnits = (options.implementationPackage?.executionUnits ?? []).filter((unit) => unit?.unitType === 'DISPLAY_LAYER');
  for (const unit of displayUnits) {
    const matches = contexts.filter((context) => context?.displayLayerId === unit.displayLayerId);
    if (!nonEmpty(unit.displayLayerId) || matches.length !== 1
      || matches[0].hostSceneId !== sceneId || unit.hostSceneId !== matches[0].hostSceneId) return null;
  }
  return sceneId;
}

/** 读取视觉阶段 JSON 来源文件，并用其中的工作项和结果 ID 核对引用归属。 */
export function loadImmutableVisualStageReference(reference, label, options = {}) {
  if (!isObject(reference)) return null;
  const file = reference.path;
  if (!nonEmpty(file) || isAbsolute(String(file)) || String(file).includes('\0')) return null;
  let root;
  let absolute;
  try {
    root = realpathSync(resolve(options.projectRoot ?? process.cwd()));
    const candidate = resolve(root, String(file));
    const lexical = relative(root, candidate);
    if (isAbsolute(String(file)) || !lexical || lexical === '..' || lexical.startsWith('..\\') || lexical.startsWith('../') || isAbsolute(lexical)) return null;
    absolute = realpathSync(candidate);
    const actualRelative = relative(root, absolute);
    if (!actualRelative || actualRelative === '..' || actualRelative.startsWith('..\\') || actualRelative.startsWith('../') || isAbsolute(actualRelative) || !statSync(absolute).isFile()) return null;
  } catch { return null; }
  let bytes;
  try { bytes = readFileSync(absolute); } catch { return null; }
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    // 引用身份必须由内容交叉验证，不能由 ref 自己宣称 resultId/workItemId。
    if (!isObject(parsed) || (reference.resultId && parsed.resultId !== reference.resultId) || (reference.unitResultId && parsed.unitResultId !== reference.unitResultId) || (reference.workItemId && (parsed.workItemId ?? parsed.work_item_id) !== reference.workItemId)) return null;
    return { value: parsed, file: String(file), label };
  } catch { return null; }
}

/** 取得阶段引用集合；只允许每一阶段一个不可变 JSON 证据文件。 */
function stageReferences(subject = {}, options = {}) {
  return firstObject(options.visualStageEvidenceRefs, options.visual_stage_evidence_refs, subject.visualStageEvidenceRefs, subject.visual_stage_evidence_refs, subject.visualPrerequisiteReferences, subject.visual_prerequisite_references, subject.visualDependencyRefs, subject.visual_dependency_refs) ?? {};
}

/** 兼容不同证据容器，但只消费对象证据，不消费根节点 PASS。 */
function evidenceObjects(subject = {}, options = {}) {
  const refs = stageReferences(subject, options);
  const evidence = firstObject(options.evidence, options.visualEvidence, options.visualStageEvidence, subject.visualStageEvidence, subject.visual_stage_evidence, subject.visualDependencyChain, subject.visual_dependency_chain) ?? {};
  const refFor = (stage) => firstObject(refs[stage], refs[stage.toLowerCase()], refs[`V${stage.slice(1)}`], refs[`${stage.toLowerCase()}Evidence`], refs[`${stage.toLowerCase()}_evidence`]);
  const v2Ref = refFor('V2'); const v3Ref = refFor('V3'); const v4Ref = refFor('V4');
  const v2 = loadImmutableVisualStageReference(v2Ref, 'V2 reconstruction production plan', options)?.value ?? null;
  const v3 = loadImmutableVisualStageReference(v3Ref, 'V3 formal acceptance', options)?.value ?? null;
  const v4 = loadImmutableVisualStageReference(v4Ref, 'V4 runtime candidate', options)?.value ?? null;
  return { evidence: { ...evidence, __references: { V2: v2Ref, V3: v3Ref, V4: v4Ref } }, v2, v3, v4, refs: { V2: v2Ref, V3: v3Ref, V4: v4Ref } };
}

/** 仅接受明确的成功终态，不读取根摘要布尔值。 */
function statusPass(value) { return ['pass', 'passed', 'accepted', 'complete', 'completed', 'valid'].includes(textStatus(value)); }
/** 计算 pending 的语义身份快照；文件摘要变化由最终人工验收处理。 */
export function visualPrerequisiteSnapshot(subject = {}, options = {}) {
  const { evidence, v2, v3, v4, refs } = evidenceObjects(subject, options);
  const decompositionConfirmation = firstObject(v2?.visualDecompositionConfirmation);
  const identity = {
    workItemId: firstValue(subject.workItemId, subject.work_item_id, evidence.workItemId, evidence.work_item_id),
    unitResultId: firstValue(subject.unitResultId, subject.unit_result_id, evidence.unitResultId, evidence.unit_result_id),
    candidateId: firstValue(subject.candidateId, subject.candidate_id, evidence.candidateId, evidence.candidate_id, v4?.candidateId, v4?.candidate_id),
    candidateVersion: firstValue(subject.candidateVersion, subject.candidate_version, evidence.candidateVersion, evidence.candidate_version, v3?.candidateVersion),
    V2DecompositionConfirmationId: firstValue(decompositionConfirmation?.confirmationId),
    V2PlanSceneId: firstValue(v2?.sceneId),
    V3AcceptanceId: firstValue(v3?.acceptanceId),
    V4CandidateId: firstValue(v4?.candidateId),
    V2ReferencePath: firstValue(refs?.V2?.path),
    V3ReferencePath: firstValue(refs?.V3?.path),
    V4ReferencePath: firstValue(refs?.V4?.path),
  };
  return Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== null && value !== undefined));
}

/** 比较 pending 创建时与当前快照，返回发生漂移的身份字段。 */
function compareSnapshots(previous, current) {
  if (!isObject(previous)) return [];
  const changed = [];
  for (const key of SNAPSHOT_IDENTITY_KEYS) if (previous[key] !== current[key]) changed.push(key);
  return changed.sort();
}

/** 创建所有控制入口共用的结构化视觉门错误。 */
function error(errorCode, message, details = {}) {
  const disposition = details.disposition ?? VISUAL_REMEDIATION.REPAIR;
  if (!Object.hasOwn(REMEDIATION_LABEL, disposition)) throw new Error(`未知视觉处置级别：${String(disposition)}`);
  const affectedScope = [...new Set(details.affectedScope ?? [])].filter(nonEmpty);
  return {
    errorCode,
    message,
    disposition,
    remediation: REMEDIATION_LABEL[disposition],
    missingStages: details.missingStages ?? [],
    missingEvidence: details.missingEvidence ?? [],
    invalidatedDependencies: details.invalidatedDependencies ?? [],
    affectedScope,
    invalidatesDownstream: details.invalidatesDownstream === true || disposition === VISUAL_REMEDIATION.RETURN,
    nextAction: details.nextAction ?? REMEDIATION_NEXT_ACTION[disposition],
  };
}

/** 摘要字段只能作为可选跟踪值出现，结构严格门仍拒绝非摘要未知字段。 */
function isOptionalSnapshotField(field) {
  const normalized = String(field).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return OPTIONAL_SNAPSHOT_FIELDS.has(field) || field === 'baselineId' || field === 'baseline_id'
    || /(^|[_-])(sha(?:1|256)?|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/.test(normalized);
}

/** 从快照差异和证据错误中判定最小必要处置，不把普通缺字段升级为阶段回退。 */
function classifyRemediation(details = {}) { return deriveVisualDisposition(details); }

/** 判断机器结构化验证是否明确失败；缺少字段仍属于原地修复，不升级为重验或回退。 */
function hasMachineEvidenceFailure(value) {
  const review = firstObject(value?.machineValidation, value?.machine_validation, value?.visualStructuredReview, value?.visual_structured_review, value?.decompositionValidation, value?.decomposition_validation);
  return isObject(review) && ['fail', 'failed', 'invalid', 'stale'].includes(textStatus(review.status ?? review.verdict ?? review.result));
}

/** 返回当前场景、候选版本或人工确认身份发生真实变化的最小证据列表。 */
function collectIdentityChanges(subject, { v2, oldSnapshot, snapshot } = {}) {
  const changes = [];
  const compare = (label, values) => {
    const known = values.filter(nonEmpty).map((value) => String(value).trim());
    if (known.length === 2 && known[0] !== known[1]) changes.push(label);
  };
  // 阶段回退只由稳定业务身份变化触发，文件摘要变化留给人工验收处理。
  compare('workItemId', [subject?.workItemId, v2?.workItemId]);
  compare('V2 plan scene identity', [subject?.sceneId ?? subject?.scene_id, v2?.sceneId]);
  for (const key of ['candidateId', 'candidateVersion', 'V2DecompositionConfirmationId', 'V2PlanSceneId']) {
    compare(key, [oldSnapshot?.[key], snapshot?.[key]]);
  }
  return [...new Set(changes)];
}

/** 将当前失败收敛到最小受影响阶段和下游，供编排器决定继续、重验或回退。 */
function finalizeRemediation(result, context = {}) {
  const identityChanges = collectIdentityChanges(context.subject, context);
  if (identityChanges.length) result.ok = false;
  const disposition = identityChanges.length > 0
    ? VISUAL_REMEDIATION.RETURN
    : classifyRemediation({ changed: context.changed, missingEvidence: result.missingEvidence, identityChanges, machineFailure: hasMachineEvidenceFailure(context.v2) });
  const errorDispositions = result.errors.map((item) => item.disposition).filter(Boolean);
  const hasReturnError = errorDispositions.includes(VISUAL_REMEDIATION.RETURN);
  const hasRevalidationError = errorDispositions.includes(VISUAL_REMEDIATION.REVALIDATE);
  const finalDisposition = identityChanges.length > 0 || hasReturnError
    ? VISUAL_REMEDIATION.RETURN
    : hasRevalidationError || disposition === VISUAL_REMEDIATION.REVALIDATE
      ? VISUAL_REMEDIATION.REVALIDATE
      : result.errors.length > 0 ? VISUAL_REMEDIATION.REPAIR : null;
  const affectedScope = [...new Set([
    ...result.errors.flatMap((item) => item.affectedScope ?? []),
    ...result.invalidatedDependencies,
    ...(finalDisposition === VISUAL_REMEDIATION.RETURN ? identityChanges : []),
  ])].filter(nonEmpty);
  result.disposition = finalDisposition;
  result.remediation = finalDisposition ? REMEDIATION_LABEL[finalDisposition] : null;
  result.affectedScope = affectedScope;
  result.identityChanges = identityChanges;
  result.invalidatesDownstream = finalDisposition === VISUAL_REMEDIATION.RETURN;
  if (finalDisposition === VISUAL_REMEDIATION.RETURN) {
    const stage = context.returnStage && identityChanges.length === 0
      ? context.returnStage
      : earliestReturnStage(identityChanges, context.returnStage ?? (result.stage && /^V[0-4]$/.test(result.stage) ? result.stage : 'V2'));
    result.returnStage = stage;
    const startIndex = VISUAL_STAGE_IDS.indexOf(stage);
    result.invalidatedStages = startIndex >= 0 ? VISUAL_STAGE_IDS.slice(startIndex) : [];
  } else {
    result.returnStage = null;
    result.invalidatedStages = [];
  }
  result.nextAction = result.ok ? '当前硬门已满足，可沿工作流继续推进' : REMEDIATION_NEXT_ACTION[finalDisposition ?? VISUAL_REMEDIATION.REPAIR];
  return result;
}

/** 递归查找未完成资产和未批准替代，并保留确定性字段路径。 */
function collectPendingEvidence(value, path = '', output = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectPendingEvidence(item, `${path}[${index}]`, output));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => {
    const currentPath = path ? `${path}.${key}` : key;
    if (['status', 'state', 'approvalStatus', 'approval_status'].includes(key) && PENDING_ASSET_STATUS.has(textStatus(item))) output.push({ path: currentPath, value: item });
    if (['substitution', 'replacement', 'alternative', 'substitute'].some((token) => key.toLowerCase().includes(token)) && item !== false && item !== null && textStatus(item) !== 'approved') output.push({ path: currentPath, value: item });
    collectPendingEvidence(item, currentPath, output);
  });
  return output;
}

/** 校验标准冻结 V2 方案及其拆解、技术和布局来源文件。 */
function validateV2ProductionPlan(v2, subject, options, missingEvidence) {
  if (!isObject(v2)) return;
  const missing = V2_PLAN_FIELDS.filter((field) => v2[field] === undefined);
  const extra = Object.keys(v2).filter((field) => !V2_PLAN_FIELDS.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) missingEvidence.push(`V2 reconstruction plan fields (missing: ${missing.join(',') || 'none'}; extra: ${extra.join(',') || 'none'})`);
  if (v2.schemaVersion !== 'cocos-scene-v2-reconstruction-plan/1.0' || v2.status !== 'COMPLETE' || v2.stage !== 'V2' || v2.frozen !== true
    || !nonEmpty(v2.workItemId) || (subject?.workItemId && v2.workItemId !== subject.workItemId)
    || !nonEmpty(v2.sceneId)) {
    missingEvidence.push('V2 COMPLETE/frozen plan identity (work/scene)');
  }
  if (!isObject(v2.visualProductionContract) || !Array.isArray(v2.visualProductionUnits) || v2.visualProductionUnits.length === 0 || !Array.isArray(v2.displayLayerContexts)) {
    missingEvidence.push('V2 production contract/units/display-layer contexts');
  }

  const root = resolve(options.projectRoot ?? process.cwd());
  const rootReal = (() => { try { return realpathSync(root); } catch { return null; } })();
  /** 安全读取 V2 来源文件；摘要快照不参与文件有效性判断。 */
  const readSourceFile = (file, label) => {
    if (!rootReal || !nonEmpty(file) || isAbsolute(file) || file.includes('\0')) {
      missingEvidence.push(`${label} source path`);
      return null;
    }
    try {
      const candidate = resolve(rootReal, file);
      const lexical = relative(rootReal, candidate);
      if (!lexical || lexical === '..' || lexical.startsWith('..\\') || lexical.startsWith('../') || isAbsolute(lexical)) throw new Error('path escape');
      const actual = realpathSync(candidate);
      const realRelative = relative(rootReal, actual);
      if (!realRelative || realRelative === '..' || realRelative.startsWith('..\\') || realRelative.startsWith('../') || isAbsolute(realRelative) || !statSync(actual).isFile()) throw new Error('symlink escape');
      return readFileSync(actual);
    } catch {
      missingEvidence.push(`${label} source file/path`);
      return null;
    }
  };
  const sceneMaster = v2.sceneMaster;
  if (!isObject(sceneMaster) || Object.keys(sceneMaster).some((key) => !['file', 'sha256', 'sceneId'].includes(key) && !isOptionalSnapshotField(key))
    || !nonEmpty(sceneMaster.file) || sceneMaster.sceneId !== v2.sceneId) missingEvidence.push('V2 sceneMaster source/scene binding');
  readSourceFile(sceneMaster?.file, 'V2 sceneMaster');
  for (const field of ['sceneReconstructionContract', 'decompositionAnnotation', 'technicalDecomposition']) {
    const artifact = v2[field];
    if (!isObject(artifact) || Object.keys(artifact).some((key) => !['file', 'sha256', 'sceneId'].includes(key) && !isOptionalSnapshotField(key)) || !nonEmpty(artifact.file) || artifact.sceneId !== v2.sceneId) {
      missingEvidence.push(`V2 ${field} scene/source binding`);
      continue;
    }
    const bytes = readSourceFile(artifact.file, `V2 ${field}`);
    if (bytes && field === 'sceneReconstructionContract') {
      try {
        const contract = JSON.parse(bytes.toString('utf8'));
        const conditions = contract.target_conditions;
        const layout = contract.layout_decomposition;
        const annotation = layout?.layout_annotation;
        const nodes = layout?.layout_nodes;
        if (!isObject(conditions) || conditions.scene_id !== v2.sceneId || !nonEmpty(conditions.state_id)
          || !Array.isArray(nodes) || nodes.length === 0 || !isObject(annotation)
          || !nonEmpty(annotation.layout_nodes_file)) {
          missingEvidence.push('V2 scene reconstruction target/layout coverage');
          continue;
        }
        const nodesBytes = readSourceFile(annotation.layout_nodes_file, 'V2 layout nodes');
        if (nodesBytes) {
          const document = JSON.parse(nodesBytes.toString('utf8'));
          const sourceNodes = document?.layout_nodes;
          const contractIds = nodes.map((node) => node?.layout_node_id);
          const sourceIds = Array.isArray(sourceNodes) ? sourceNodes.map((node) => node?.layout_node_id) : [];
          if (!Array.isArray(sourceNodes) || sourceNodes.length === 0 || sourceIds.some((id) => !nonEmpty(id))
            || new Set(sourceIds).size !== sourceIds.length || JSON.stringify(contractIds) !== JSON.stringify(sourceIds)
            || document.scene_id !== v2.sceneId) missingEvidence.push('V2 contract/layout node identity and coverage');
        }
      } catch {
        missingEvidence.push('V2 scene reconstruction contract/layout JSON');
      }
    }
  }
  const confirmation = v2.visualDecompositionConfirmation;
  if (!isObject(confirmation) || confirmation.confirmationMode !== 'manual' || !['PASS', 'accepted'].includes(confirmation.status)
    || !nonEmpty(confirmation.confirmationId) || !nonEmpty(confirmation.evidenceFile)) missingEvidence.push('V2 manual decomposition confirmation identity');
  if (isObject(confirmation)) readSourceFile(confirmation.evidenceFile, 'V2 decomposition confirmation');
}

/** 对外复用同一 V2 来源文件和身份校验，避免阶段入口出现较弱的独立门。 */
export function validateStandardV2ProductionPlan(value, subject = {}, options = {}) {
  const missingEvidence = [];
  const staleFiles = [];
  validateV2ProductionPlan(value, subject, options, missingEvidence);
  return { ok: missingEvidence.length === 0, missingEvidence, staleFiles };
}

/**
 * 逐项读取阶段证据文件，而不是相信 JSON 内声明的 PASS；命令输出必须实际落在同一组文件中。
 * 摘要仅作可选记录，不参与来源文件是否有效的判断。
 */
function validateEvidenceFiles(value, label, options, missingEvidence, requireCommands = false) {
  if (!isObject(value) || !Array.isArray(value.files) || value.files.length === 0 || new Set(value.files).size !== value.files.length) {
    missingEvidence.push(`${label} source files`);
    return false;
  }
  const files = value.files.map((file) => String(file));
  const root = resolve(options.projectRoot ?? process.cwd());
  let rootReal;
  try { rootReal = realpathSync(root); } catch { rootReal = null; }
  let valid = true;
  for (const file of files) {
    if (!rootReal || isAbsolute(file) || file.includes('\0')) {
      missingEvidence.push(`${label} evidence file ${file}`);
      valid = false;
      continue;
    }
    try {
      const target = resolve(rootReal, file);
      const relativeTarget = relative(rootReal, target);
      if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith('..\\') || relativeTarget.startsWith('../') || isAbsolute(relativeTarget)) throw new Error('path escape');
      const actual = realpathSync(target);
      const realRelative = relative(rootReal, actual);
      if (!realRelative || realRelative === '..' || realRelative.startsWith('..\\') || realRelative.startsWith('../') || isAbsolute(realRelative) || !statSync(actual).isFile()) throw new Error('invalid source');
      readFileSync(actual);
    } catch {
      missingEvidence.push(`${label} evidence source file ${file}`);
      valid = false;
    }
  }
  if (requireCommands) {
    if (!Array.isArray(value.commands) || value.commands.length === 0) {
      missingEvidence.push(`${label} commands`);
      valid = false;
    } else {
      for (const command of value.commands) {
        if (!isObject(command) || !nonEmpty(command.command) || command.exitCode !== 0 || !nonEmpty(command.outputFile) || !files.includes(command.outputFile)) {
          missingEvidence.push(`${label} command output binding`);
          valid = false;
        }
      }
    }
  }
  return valid;
}

/** 从项目根目录内安全读取来源文件，连符号链接逃逸也一并拒绝。 */
function readProjectSourceFile(file, label, options, missingEvidence) {
  const root = resolve(options.projectRoot ?? process.cwd());
  let rootReal;
  try { rootReal = realpathSync(root); } catch { rootReal = null; }
  if (!rootReal || !nonEmpty(file) || isAbsolute(file) || file.includes('\0')) {
    missingEvidence.push(`${label} source path`);
    return null;
  }
  try {
    const candidate = resolve(rootReal, file);
    const lexical = relative(rootReal, candidate);
    if (!lexical || lexical === '..' || lexical.startsWith('..\\') || lexical.startsWith('../') || isAbsolute(lexical)) throw new Error('path escape');
    const actual = realpathSync(candidate);
    const realRelative = relative(rootReal, actual);
    if (!realRelative || realRelative === '..' || realRelative.startsWith('..\\') || realRelative.startsWith('../') || isAbsolute(realRelative) || !statSync(actual).isFile()) throw new Error('symlink escape');
    return readFileSync(actual);
  } catch {
    missingEvidence.push(`${label} source file/path`);
    return null;
  }
}

/** 逐层核对 V2 冻结目标、真实 layout_nodes 来源与 V3 manifest 覆盖画布。 */
function validateV2ManifestTarget(v2, manifest, options, missingEvidence) {
  const contractBytes = readProjectSourceFile(v2?.sceneReconstructionContract?.file, 'V2 scene reconstruction contract', options, missingEvidence);
  if (!contractBytes) return;
  try {
    const contract = JSON.parse(contractBytes.toString('utf8'));
    const conditions = contract.target_conditions;
    const viewport = conditions?.viewport;
    const layout = contract.layout_decomposition;
    const nodes = layout?.layout_nodes;
    const nodesFile = layout?.layout_annotation?.layout_nodes_file;
    if (!isObject(conditions) || conditions.scene_id !== v2.sceneId || !nonEmpty(conditions.state_id)
      || !isObject(viewport) || !Number.isFinite(viewport.width) || viewport.width <= 0
      || !Number.isFinite(viewport.height) || viewport.height <= 0 || !Array.isArray(nodes) || nodes.length === 0) {
      missingEvidence.push('V2 scene/state/viewport/layout target identity');
      return;
    }
    const nodesBytes = readProjectSourceFile(nodesFile, 'V2 layout_nodes source', options, missingEvidence);
    if (!nodesBytes) return;
    const nodesDocument = JSON.parse(nodesBytes.toString('utf8'));
    const sourceNodes = nodesDocument?.layout_nodes;
    if (nodesDocument.schema !== 'cocos-layout-nodes/1.0' || !Array.isArray(sourceNodes) || sourceNodes.length === 0
      || nodesDocument.scene_id !== conditions.scene_id || nodesDocument.state_id !== conditions.state_id
      || canonicalJson(nodesDocument.viewport) !== canonicalJson(viewport)
      || canonicalJson(sourceNodes) !== canonicalJson(nodes)) {
      missingEvidence.push('V2 contract/layout_nodes scene/state/viewport/content binding');
      return;
    }

    const target = manifest?.reference_target;
    const normalizePath = (value) => typeof value === 'string' ? value.replaceAll('\\', '/').replace(/^\.\//, '') : '';
    if (normalizePath(target?.original_file) !== normalizePath(v2.sceneMaster?.file)) missingEvidence.push('V3 reference_target.original_file must bind V2 sceneMaster');
    if (!target?.scene_ids?.includes(conditions.scene_id) || !target?.state_ids?.includes(conditions.state_id)) missingEvidence.push('V3 reference_target scene/state coverage must include the V2 target');
    const canvases = Array.isArray(manifest?.coverage_audit?.canvases)
      ? manifest.coverage_audit.canvases.filter((item) => item?.scene_id === conditions.scene_id && item?.state_id === conditions.state_id)
      : [];
    const canvas = canvases[0];
    if (canvases.length !== 1 || !isObject(canvas) || canvas.width !== viewport.width || canvas.height !== viewport.height) missingEvidence.push('V3 coverage_audit must contain exactly one canvas matching the V2 target viewport');
  } catch {
    missingEvidence.push('V2 scene/state/viewport/layout target JSON');
  }
}

/** 复核 V3 清单身份与可用来源，分别检查图片文件和原生实现路径。 */
function validateV3ManifestSource(v2, v3, subject, options, missingEvidence) {
  if (!nonEmpty(v3?.visualManifestFile)) {
    missingEvidence.push('V3 visualManifestFile source path');
    return;
  }
  const bytes = readProjectSourceFile(v3.visualManifestFile, 'V3 visual manifest', options, missingEvidence);
  if (!bytes) return;
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { missingEvidence.push('V3 visual manifest source JSON'); return; }
  if (!isObject(manifest) || manifest.schema_version !== '1.5'
    || manifest.workItemId !== (subject.workItemId ?? v3.workItemId)
    || manifest.candidateVersion !== v3.candidateVersion) {
    missingEvidence.push('V3 visual manifest schema/workItemId/candidateVersion identity');
    return;
  }
  validateV2ManifestTarget(v2, manifest, options, missingEvidence);

  const manifestAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const assetsById = new Map(manifestAssets.filter(isObject).map((asset) => [asset.id, asset]));
  const auditUnits = manifest.production_contract_audit?.units;
  const regions = manifest.coverage_audit?.regions;
  const nativeFilesByRegion = new Map();
  if (Array.isArray(regions)) for (const region of regions) {
    // 合并当前合同允许的根级与嵌套事实，避免遗漏原生实现的实际文件。
    const contract = { ...region, ...(region?.production_contract ?? region?.productionContract ?? {}) };
    const method = contract.production_method;
    const files = contract?.runtime_implementation?.integration_files;
    if (['runtime-program', 'cocos-graphics'].includes(method) && Array.isArray(files) && files.length) nativeFilesByRegion.set(region.id, files);
  }
  const formalAssets = Array.isArray(v3.formalAssets) ? v3.formalAssets : [];
  if (!formalAssets.length && nativeFilesByRegion.size === 0) missingEvidence.push('V3 accepted formal asset or native implementation source');
  for (const asset of formalAssets) {
    const assetId = firstValue(asset?.id, asset?.asset_id, asset?.assetId);
    if (!nonEmpty(assetId)) {
      missingEvidence.push('V3 formal asset ID binding');
      continue;
    }
    const manifestAsset = assetsById.get(assetId);
    if (manifestAsset) {
      if (!statusPass(manifestAsset.status)) {
        missingEvidence.push(`V3 visual manifest accepted asset ${assetId}`);
        continue;
      }
      const runtimeFiles = Array.isArray(manifestAsset.runtime_outputs) ? manifestAsset.runtime_outputs : [];
      if (!runtimeFiles.length) missingEvidence.push(`V3 accepted asset ${assetId} runtime output path`);
      else validateEvidenceFiles({ files: runtimeFiles }, `V3 accepted asset ${assetId}`, options, missingEvidence);
      continue;
    }
    const regionId = firstValue(asset?.region_id, asset?.regionId, asset?.id, asset?.asset_id);
    const integrationFiles = nativeFilesByRegion.get(regionId);
    if (!statusPass(asset?.status) || !integrationFiles?.length) missingEvidence.push(`V3 accepted asset ${assetId} file/native source binding`);
    else validateEvidenceFiles({ files: integrationFiles }, `V3 native implementation ${regionId}`, options, missingEvidence);
  }

  if (!Array.isArray(auditUnits) || !auditUnits.length) {
    missingEvidence.push('V3 production_contract_audit actual_assets');
    return;
  }
  for (const [unitIndex, unit] of auditUnits.entries()) {
    const region = Array.isArray(regions) ? regions.find((item) => item?.annotation_number === unit?.annotation_number && item?.id === unit?.region_id) : null;
    const contract = { ...region, ...(region?.production_contract ?? region?.productionContract ?? {}) };
    const method = contract.production_method ?? unit?.observed_method ?? unit?.production_method;
    const nativeFiles = contract?.runtime_implementation?.integration_files;
    if (['runtime-program', 'cocos-graphics'].includes(method)) {
      if (!statusPass(unit?.status) || !Array.isArray(nativeFiles) || !nativeFiles.length) {
        missingEvidence.push(`V3 production unit ${unitIndex} native integration_files PASS`);
      } else validateEvidenceFiles({ files: nativeFiles }, `V3 native production unit ${unitIndex}`, options, missingEvidence);
      continue;
    }
    const actualAssets = Array.isArray(unit?.actual_assets) ? unit.actual_assets : [];
    if (!statusPass(unit?.status) || !actualAssets.length) {
      missingEvidence.push(`V3 production_contract_audit.units[${unitIndex}] actual_assets PASS`);
      continue;
    }
    for (const [assetIndex, actual] of actualAssets.entries()) {
      const file = firstValue(actual?.file, actual?.path, actual?.output_file);
      if (!nonEmpty(file)) missingEvidence.push(`V3 actual_assets[${assetIndex}] source file`);
      else validateEvidenceFiles({ files: [file] }, `V3 actual_assets[${assetIndex}]`, options, missingEvidence);
    }
  }
}

/** 校验每个阶段的显式候选 ID 或版本，防止不同候选的证据拼接。 */
function validateCandidateIdentity(value, label, missingEvidence, strict = false) {
  const candidate = strict ? value?.candidateIdentity : value?.candidateIdentity ?? value?.candidate_identity;
  const candidateId = firstValue(value?.candidateId, value?.candidate_id, candidate?.candidateId, candidate?.candidate_id);
  const candidateVersion = firstValue(value?.candidateVersion, value?.candidate_version, candidate?.candidateVersion, candidate?.candidate_version);
  if (!isObject(candidate) || (!nonEmpty(candidateId) && !nonEmpty(candidateVersion))) {
    missingEvidence.push(`${label} candidate ID/version`);
    return false;
  }
  return true;
}

/** 校验视觉 V3 正式资源与 V4 正式运行态的阶段门。 */
export function validateVisualStagePrerequisites(subject = {}, options = {}) {
  const classification = classifyVisibleVisualProductionIntegration(subject);
  const result = { ok: true, required: classification.isVisibleVisualProductionIntegration, classification, stage: null, state: null, missingStages: [], missingEvidence: [], invalidatedDependencies: [], errors: [], snapshot: null, nextAction: null, disposition: null, remediation: null, affectedScope: [], identityChanges: [], invalidatesDownstream: false, returnStage: null, invalidatedStages: [] };
  const { stage, conflicts } = readVisualStage(subject);
  result.stage = stage;
  const state = firstValue(subject.visualStageState, subject.visual_stage_state, subject.visualState, subject.visual_state);
  result.state = state;
  if (!result.required) {
    if (conflicts.length) { result.ok = false; result.errors.push(error('VISUAL_STAGE_DECLARATION_INVALID', '视觉阶段字段未知或互相矛盾', { missingEvidence: ['visualStage'] })); }
    return finalizeRemediation(result, { subject, changed: [] });
  }
  if (classification.isolatedGraybox) return finalizeRemediation(result, { subject, changed: [] });
  if (conflicts.length) result.errors.push(error('VISUAL_STAGE_DECLARATION_INVALID', '视觉阶段字段未知或互相矛盾，不允许猜测', { missingEvidence: ['visualStage'] }));

  const formalImplementation = stage === 'V4' && state === 'in-progress';
  const runtimeAccepted = stage === 'V4' && state === 'v4-runtime-integration-candidate';
  const v3ReadyForImplementation = stage === 'V3' && state === 'v3-formal-acceptance-complete';
  if (!v3ReadyForImplementation && !formalImplementation && !runtimeAccepted) {
    const missingStage = 'V4';
    result.missingStages.push(missingStage);
    result.errors.push(error('VISUAL_STAGE_NOT_READY', `正式可见视觉行为必须在 V4 正式实现/运行验收状态执行；当前为 ${stage ?? 'unknown'}/${state ?? 'missing'}`, { missingStages: [missingStage], missingEvidence: ['visualStage', 'visualStageState'] }));
  }

  const { evidence, v2, v3, v4, refs } = evidenceObjects(subject, options);
  const missingEvidence = result.missingEvidence;
  const requiredRefs = ['V2', 'V3', ...(runtimeAccepted ? ['V4'] : [])];
  for (const referenceStage of requiredRefs) {
    const reference = refs[referenceStage];
    if (!isObject(reference) || !nonEmpty(reference.path)) missingEvidence.push(`${referenceStage} source evidence path`);
    else if (!loadImmutableVisualStageReference(reference, `${referenceStage} source evidence`, options)) missingEvidence.push(`${referenceStage} source evidence file/JSON/identity`);
  }
  if (isObject(v2)) {
    validateV2ProductionPlan(v2, subject, options, missingEvidence);
  } else missingEvidence.push('V2 standard frozen reconstruction plan');
  if (!isObject(v3) || v3.evidenceType !== 'v3-formal-acceptance' || v3.status !== 'PASS') missingEvidence.push('V3 acceptance PASS');
  if (isObject(v3)) {
    if (!nonEmpty(v3.acceptanceId) || !nonEmpty(v3.workItemId) || (subject.workItemId && v3.workItemId !== subject.workItemId)
      || !nonEmpty(v3.candidateVersion)) missingEvidence.push('V3 acceptance work/candidate identity');
    validateEvidenceFiles(v3, 'V3 formal acceptance', options, missingEvidence);
    validateCandidateIdentity(v3, 'V3 formal acceptance', missingEvidence, true);
    const formalAssets = v3.formalAssets;
    const components = v3.components;
    if (!Array.isArray(formalAssets) || formalAssets.length === 0) missingEvidence.push('V3 accepted formal assets');
    else if (formalAssets.some((asset) => !isObject(asset) || !statusPass(asset.status))) missingEvidence.push('V3 formal asset accepted statuses');
    if (!Array.isArray(components) || components.length === 0) missingEvidence.push('V3 accepted component states');
    else if (components.some((component) => !isObject(component) || !statusPass(component.status))) missingEvidence.push('V3 component accepted statuses');
    validateV3ManifestSource(v2, v3, subject, options, missingEvidence);
  }

  if (runtimeAccepted) {
    if (!isObject(v4) || v4.evidenceType !== 'v4-runtime-integration-candidate' || v4.status !== 'PASS') missingEvidence.push('V4 runtime candidate PASS');
    if (isObject(v4)) {
      if (!nonEmpty(v4.candidateId) || v4.workItemId !== subject.workItemId) missingEvidence.push('V4 candidate/work item identity');
      validateEvidenceFiles(v4, 'V4 runtime candidate', options, missingEvidence);
      validateCandidateIdentity(v4, 'V4 runtime candidate', missingEvidence, true);
      const acceptanceErrors = validateArtExperienceAcceptance(v4.artExperienceAcceptance, {
        workItemId: subject.workItemId,
        candidateId: v4.candidateId,
        sceneId: artAcceptanceSceneId(subject, v2, options),
      }, options);
      if (acceptanceErrors.length) missingEvidence.push(...acceptanceErrors.map((item) => `V4 art experience acceptance: ${item}`));
    }
  }

  const pending = collectPendingEvidence({ v2, v3, v4, visualManifest: options.visualManifest, implementationPackage: options.implementationPackage });
  if (pending.length) result.invalidatedDependencies.push(...pending.map((item) => `${item.path}=${item.value}`));
  const snapshot = visualPrerequisiteSnapshot(subject, { ...options, visualStageEvidence: evidence, v2, v3, v4 });
  result.snapshot = snapshot;
  const oldSnapshot = options.pendingSnapshot ?? subject.pendingVisualPrerequisiteSnapshot ?? subject.pending_visual_prerequisite_snapshot;
  const changed = compareSnapshots(oldSnapshot, snapshot);
  if (changed.length) result.invalidatedDependencies.push(...changed);
  if (pending.length) result.errors.push(error('VISUAL_PENDING_ASSET', '存在 planned/pending 资源或未批准替代，当前门尚未满足', { invalidatedDependencies: result.invalidatedDependencies, disposition: VISUAL_REMEDIATION.REVALIDATE, affectedScope: pending.map((item) => item.path) }));
  if (changed.length) result.errors.push(error('VISUAL_PENDING_STALE', '当前门使用的工作项、候选或证据来源身份已更新，需要重新验证；不因文件摘要变化自动回退阶段', { invalidatedDependencies: changed, disposition: VISUAL_REMEDIATION.REVALIDATE, affectedScope: changed }));
  if (missingEvidence.length) result.errors.push(error('VISUAL_PREREQUISITES_MISSING', 'V2/V3/V4 下游证据不完整；根摘要、手写 PASS 或用户批准不具备证明力', { missingEvidence }));
  result.missingEvidence = [...new Set(missingEvidence)];
  result.invalidatedDependencies = [...new Set(result.invalidatedDependencies)];
  result.ok = result.errors.length === 0;
  return finalizeRemediation(result, { subject, v2, v3, v4, oldSnapshot, snapshot, changed, returnStage: 'V2' });
}

/** 供 CLI 使用的异常，保留结构化门禁信息而非拼接不可解析文本。 */
export class VisualStagePrerequisiteError extends Error {
  constructor(result, command = 'visual-stage-gate') {
    const primary = result.errors?.[0] ?? error('VISUAL_PREREQUISITES_MISSING', '视觉阶段前置条件不满足');
    super(primary.message);
    this.name = 'VisualStagePrerequisiteError';
    this.command = command;
    this.result = result;
    this.errorCode = primary.errorCode;
  }
}

/** 只有适用阶段缺少前置证据时抛出结构化阻断，非视觉工作不受影响。 */
export function assertVisualStagePrerequisites(subject, options = {}) {
  const result = validateVisualStagePrerequisites(subject, options);
  if (result.required && !result.ok) throw new VisualStagePrerequisiteError(result, options.command);
  return result;
}

/** 将门禁失败标准化为 CLI stderr JSON，便于所有入口和自动化消费同一错误码。 */
export function structuredVisualStageFailure(errorValue, command = 'visual-stage-gate') {
  const result = errorValue?.result ?? errorValue;
  if (result?.ok === true) return { ok: true, command, required: result.required === true, stage: result.stage ?? null, state: result.state ?? null, snapshot: result.snapshot ?? null, disposition: null, remediation: null, affectedScope: [], invalidatedStages: [] };
  const primary = result?.errors?.[0] ?? error('VISUAL_PREREQUISITES_MISSING', errorValue?.message ?? '视觉阶段前置条件不满足');
  return {
    ok: false,
    command,
    errorCode: primary.errorCode,
    message: primary.message,
    disposition: result?.disposition ?? primary.disposition ?? VISUAL_REMEDIATION.REPAIR,
    remediation: result?.remediation ?? primary.remediation ?? REMEDIATION_LABEL[result?.disposition ?? primary.disposition ?? VISUAL_REMEDIATION.REPAIR],
    missingStages: [...new Set(result?.missingStages ?? primary.missingStages ?? [])],
    missingEvidence: [...new Set(result?.missingEvidence ?? primary.missingEvidence ?? [])],
    invalidatedDependencies: [...new Set(result?.invalidatedDependencies ?? primary.invalidatedDependencies ?? [])],
    affectedScope: [...new Set(result?.affectedScope ?? primary.affectedScope ?? [])],
    invalidatesDownstream: result?.invalidatesDownstream === true || primary.invalidatesDownstream === true,
    invalidatedStages: [...new Set(result?.invalidatedStages ?? [])],
    returnStage: result?.returnStage ?? null,
    nextAction: result?.nextAction ?? primary.nextAction ?? REMEDIATION_NEXT_ACTION[VISUAL_REMEDIATION.REPAIR],
  };
}

/**
 * 所有 CLI 入口共享的视觉阶段门；失败抛出结构化异常交给 CLI 输出，
 * 避免某入口把缺失证据降级成普通提示或被批准文本覆盖。
 */
export function enforceVisualStageGate(work, options = {}) {
  const result = validateVisualStagePrerequisites(work, options);
  const actionLevel = String(options.actionLevel ?? '');
  const formalCodeWork = result.stage === 'V4' && result.state === 'in-progress';
  const runtimeProofReady = result.stage === 'V4' && result.state === 'v4-runtime-integration-candidate';
  const directV4Activation = result.stage === 'V3' && result.state === 'v3-formal-acceptance-complete'
    && String(options.actionLevel ?? '') === 'A3';
  const prematureA4 = result.required && actionLevel === 'A4' && !runtimeProofReady && !result.classification.isolatedGraybox;
  const prematureFormalAction = result.required && ['A0', 'A1', 'A2', 'A3'].includes(actionLevel)
    && !directV4Activation && !formalCodeWork && !result.classification.isolatedGraybox;
  if (prematureA4 || prematureFormalAction) {
    result.ok = false;
    result.errors.unshift(error(prematureA4 ? 'VISUAL_A4_REQUIRES_V4_RUNTIME_ACCEPTANCE' : 'VISUAL_FORMAL_ENTRY_REQUIRES_A4', prematureA4
      ? 'A4/F4 正式入口必须等待 V4 运行验收候选完成'
      : '正式可见视觉集成必须通过 V4 正式实现和运行验收；V3 资源验收完成后仅允许 A3 激活正式实施包', {
      missingStages: [prematureA4 ? 'V4' : 'V4'],
      affectedScope: ['当前动作等级', 'A4/F4 pending'],
      disposition: VISUAL_REMEDIATION.REPAIR,
      nextAction: '原地修复当前动作等级或 pending 上下文，再重新运行当前门；A4/F4 只能在 V4 运行验收后进入',
    }));
    // 该错误只说明当前动作与门不匹配，不使已冻结的候选失效，也不触发阶段回退。
    result.affectedScope = [...new Set([...result.affectedScope, '当前动作等级', 'A4/F4 pending'])];
    if (result.disposition !== VISUAL_REMEDIATION.RETURN) {
      result.disposition = VISUAL_REMEDIATION.REPAIR;
      result.remediation = REMEDIATION_LABEL[VISUAL_REMEDIATION.REPAIR];
      result.invalidatesDownstream = false;
      result.returnStage = null;
      result.invalidatedStages = [];
      result.nextAction = '原地修复当前动作等级或 pending 上下文，再重新运行当前门；A4/F4 只能在 V4 运行验收后进入';
    }
  }
  if (result.required && !result.ok) throw new VisualStagePrerequisiteError(result, options.command ?? 'visual-stage-gate');
  return result;
}
