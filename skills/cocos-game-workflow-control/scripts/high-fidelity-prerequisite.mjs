import { isAbsolute, relative } from 'node:path';
import { assertGlobalVisualBaselineSelection } from './global-visual-baseline-contract.mjs';
import { assertVisualStagePrerequisites, classifyVisibleVisualProductionIntegration } from './visual-stage-prerequisites.mjs';
import { V2_PLAN_FIELDS } from './v2-reconstruction-plan-contract.mjs';

const SCENE_UNIT_TYPES = new Set(['SCENE', 'DISPLAY_LAYER']);
const FOUNDATION_UNIT_TYPES = new Set(['SHARED', 'MODULE']);
const FORMAL_UNIT_TYPES = new Set(['SHARED', 'MODULE', 'SCENE', 'DISPLAY_LAYER', 'INTEGRATION']);
const PREREQUISITE_FIELDS = [
  'workItemId', 'status', 'stage', 'frozen', 'sceneId', 'displayLayerId', 'hostSceneId',
  'evidenceFile',
];
const IMAGE_FIELDS = ['file', 'sceneId'];
const ARTIFACT_FIELDS = ['file', 'sceneId'];
const DISPLAY_LAYER_CONTEXT_FIELDS = ['displayLayerId', 'hostSceneId', 'hostContextImage'];
const DISPLAY_LAYER_CONTEXT_REQUIRED_FIELDS = ['displayLayerId', 'hostSceneId', 'hostContextImage'];
const CONTEXT_IMAGE_FIELDS = ['file', 'sceneId', 'displayLayerId', 'hostSceneId'];
const CONFIRMATION_FIELDS = ['confirmationId', 'confirmationMode', 'status', 'evidenceFile'];
const EVIDENCE_SCHEMA = 'cocos-scene-v2-reconstruction-plan/1.0';
const OPTIONAL_SNAPSHOT_FIELDS = new Set([
  'sha256', 'targetSha256', 'target_sha256', 'candidateSha256', 'candidate_sha256',
  'diffFingerprint', 'diff_fingerprint', 'evidenceSha256', 'evidence_sha256',
  'baselineId', 'baseline_id',
]);
const VISUAL_STAGES = ['V0', 'V1', 'V2', 'V3', 'V4'];
const PACKAGE_VISUAL_FIELDS = Object.freeze([
  'visualContractVersion', 'candidateVersion', 'visualManifestFile', 'visualManifestSha256',
  'visualDecompositionConfirmations', 'current_stage',
  'currentStage', 'scene_reconstruction_contract', 'sceneReconstructionContract', 'visualProductionUnits',
]);

/** 判断值是否为不带数组的普通对象。 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 判断值是否为非空字符串。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

/** 摘要键只作为可选追踪字段放行；其缺失或取值变化不构成验收身份。 */
function isOptionalSnapshotField(field) {
  const normalized = String(field).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return OPTIONAL_SNAPSHOT_FIELDS.has(field)
    || /(^|[_-])(sha(?:1|256)?|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/.test(normalized);
}

/** 生成场景或独立弹窗 Work Item 的视觉实现上下文身份。 */
function unitContext(unit) {
  return unit.unitType === 'SCENE'
    ? { sceneId: unit.sceneId, displayLayerId: null, hostSceneId: null }
    : { sceneId: unit.hostSceneId, displayLayerId: unit.displayLayerId, hostSceneId: unit.hostSceneId };
}

/** 返回结构错误；调用方可在计划结构门中一次性转成控制面错误。 */
export function validateHighFidelityPrerequisiteShape(unit) {
  const errors = [];
  const value = unit?.highFidelityPrerequisite;
  if (!SCENE_UNIT_TYPES.has(unit?.unitType)) {
    if (value !== null) errors.push(`execution unit ${unit?.unitId ?? '<unknown>'}.highFidelityPrerequisite 仅 SCENE/DISPLAY_LAYER 可填写，其他类型必须为 null`);
    return errors;
  }
  if (!isRecord(value)) {
    errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 必须引用当前 Work Item 的 V2 拆解还原方案`);
    return errors;
  }
  const missing = PREREQUISITE_FIELDS.filter((field) => value[field] === undefined);
  const extra = Object.keys(value).filter((field) => !PREREQUISITE_FIELDS.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!isNonEmptyString(value.workItemId) || value.status !== 'COMPLETE' || value.stage !== 'V2' || value.frozen !== true || !isNonEmptyString(value.evidenceFile)) {
    errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 必须绑定当前 Work Item 的 COMPLETE/frozen V2 拆解还原方案及来源文件`);
  }
  const expected = unitContext(unit);
  if (value.sceneId !== expected.sceneId || value.displayLayerId !== expected.displayLayerId || value.hostSceneId !== expected.hostSceneId) errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 的 scene/layer/host 身份必须与宿主单元一致`);
  return errors;
}

/** 生成视觉前置失败的统一错误，明确回到当前场景或弹窗 Work Item。 */
function prerequisiteError(unit, detail) {
  return new Error(`视觉 V2 前置门拒绝 ${unit?.unitId ?? '<package>'}：${detail}；应回到当前 Work Item 的 V2 拆解方案确认`);
}

/** 生成正式执行前置门错误，指出必须回到当前 Work Item 核实 V2/V3 来源。 */
function executionGateError(detail) {
  return new Error(`V4 正式功能执行前置门拒绝：${detail}；应回到当前场景 Work Item 核实 V2 拆解与 V3 正式资源验收`);
}

/**
 * 判断实施包是否只包含项目骨架和场景无关基础模块。
 * 通过单元类型推导而不是增加可手写的包类别，确保混入场景或集成单元时自动回到正式门。
 */
export function isFoundationOnlyPackage(pkg) {
  const units = pkg?.executionUnits;
  return Array.isArray(units) && units.length > 0 && units.every((unit) => FOUNDATION_UNIT_TYPES.has(unit?.unitType));
}

/** 判断实施包是否声明视觉合同、资产生产或场景视觉阶段字段。 */
function hasPackageVisualDependency(pkg) {
  return PACKAGE_VISUAL_FIELDS.some((field) => pkg?.[field] !== undefined);
}

/** 判断 Work Item 或包是否声明正式可见视觉行为；灰盒声明不能降级正式门。 */
function hasFormalVisualBehavior(work, pkg) {
  const subjects = [work, pkg].filter(isRecord);
  // 正式入口、可见资源消费等行为统一由共享分类器判定，避免在此复制别名或引入旧包兼容路径。
  return subjects.some((subject) => classifyVisibleVisualProductionIntegration(subject).isVisibleVisualProductionIntegration);
}

/** 判断 foundation-only 包应走全局基线门、正式视觉门还是直接进入基础工程。 */
function foundationGateMode(work, pkg) {
  if (!isFoundationOnlyPackage(pkg)) return 'formal';
  if (hasFormalVisualBehavior(work, pkg)) return 'formal';
  return hasPackageVisualDependency(pkg) ? 'global-baseline' : 'none';
}

/** 校验视觉依赖基础实施包的三候选人工确认基线；保留来源文件与人工决策内容检查。 */
function assertFoundationBaselineFrozen(work, repo, io) {
  if (work?.globalStaticBaselineState !== 'global-static-baseline-frozen') {
    throw prerequisiteError(null, '具有视觉依赖的基础包只能在完成 3 张候选图 + 人工确认并写入 globalStaticBaselineState=global-static-baseline-frozen 后创建或执行；当前全局静态 visual_baseline 尚未冻结');
  }
  if (!repo || !io) throw prerequisiteError(null, '具有视觉依赖的基础包缺少三张候选图、人工确认及冻结文件的读取能力');
  try {
    assertGlobalVisualBaselineSelection(work, repo, io);
  } catch (error) {
    throw prerequisiteError(null, error.message);
  }
  return true;
}

/** 判断实施包规划是否已经越过当前场景 Work Item 的 V2 视觉验收边界。 */
export function assertFormalImplementationAfterV2(work, pkg, repo, io) {
  const foundationMode = foundationGateMode(work, pkg);
  if (foundationMode === 'none') return true;
  if (foundationMode === 'global-baseline') return assertFoundationBaselineFrozen(work, repo, io);
  const formalUnits = (pkg?.executionUnits ?? []).filter((unit) => FORMAL_UNIT_TYPES.has(unit?.unitType));
  if (!formalUnits.length) return true;
  const stage = String(work?.visualStage ?? '').trim().toUpperCase();
  const stageIndex = VISUAL_STAGES.indexOf(stage);
  const v2Approved = stageIndex >= VISUAL_STAGES.indexOf('V2') && (stage !== 'V2' || work?.visualStageState === 'v2-production-planning-complete');
  if (!v2Approved) throw prerequisiteError(null, '正式功能实施包只能在 V2 拆解方案确认完成后创建或执行；V2 前仅允许隔离灰盒/无业务逻辑视觉样片');
  return true;
}

/**
 * 校验正式执行所需的 V2/V3 当前来源及 V4 实施状态。
 * V2 冻结拆解和 V3 正式资源均由同一视觉前置门复核，避免借状态字段或根 PASS 绕过来源校验。
 */
export function assertFormalExecutionAfterV3(work, pkg, repo, io) {
  const foundationMode = foundationGateMode(work, pkg);
  if (foundationMode === 'none') return true;
  if (foundationMode === 'global-baseline') return assertFoundationBaselineFrozen(work, repo, io);
  const formalUnits = (pkg?.executionUnits ?? []).filter((unit) => FORMAL_UNIT_TYPES.has(unit?.unitType));
  if (!formalUnits.length) return true;
  const stage = String(work?.visualStage ?? '').trim().toUpperCase();
  if (stage !== 'V4' || !['in-progress', 'v4-runtime-integration-candidate'].includes(String(work?.visualStageState ?? ''))) throw executionGateError(`正式功能单元只能在 V4 正式实施/运行验收状态执行，当前阶段为 ${stage || 'unknown'}/${work?.visualStageState ?? 'missing'}`);
  if (!repo || !io) throw executionGateError('缺少 V2/V3 当前证据读取能力');
  const result = assertVisualStagePrerequisites({ ...work, visibleVisualProductionIntegration: true }, { projectRoot: repo, implementationPackage: pkg });
  if (!result.ok) throw executionGateError(result.errors?.[0]?.message ?? result.missingEvidence?.[0] ?? 'V2/V3 阶段证据未闭合');
  return true;
}

/** 解析仓库内相对文件，拒绝绝对路径、路径穿越和仓库根目录本身。 */
function resolveRepoFile(repo, file, io, unit, label) {
  if (!isNonEmptyString(file) || isAbsolute(file) || file.includes('\0')) throw prerequisiteError(unit, `${label} 必须是仓库内相对路径`);
  const repoRoot = io.resolve(repo);
  const target = io.resolve(repo, file);
  const relativePath = relative(repoRoot, target).replaceAll('\\', '/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) throw prerequisiteError(unit, `${label} 越出仓库：${file}`);
  if (!io.existsSync(target)) throw prerequisiteError(unit, `${label} 文件不存在：${file}`);
  return target;
}

/** 校验普通文件证据的字段、场景身份和文件存在性。 */
function assertArtifact(artifact, fields, expected, repo, io, unit, label) {
  if (!isRecord(artifact)) throw prerequisiteError(unit, `${label} 必须为对象`);
  const missing = fields.filter((field) => artifact[field] === undefined);
  const extra = Object.keys(artifact).filter((field) => !fields.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) throw prerequisiteError(unit, `${label} 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  const identityFields = fields.filter((field) => ['sceneId', 'displayLayerId', 'hostSceneId'].includes(field));
  if (!isNonEmptyString(artifact.file) || identityFields.some((field) => artifact[field] !== expected[field])) throw prerequisiteError(unit, `${label} 未绑定当前场景身份或来源文件`);
  resolveRepoFile(repo, artifact.file, io, unit, `${label}.file`);
}

/** 校验拆解图确认的证据文件及其目标身份。 */
function assertReviewEvidence(review, fields, repo, io, unit, label) {
  if (!isRecord(review)) throw prerequisiteError(unit, `${label} 必须为对象`);
  const missing = fields.filter((field) => review[field] === undefined);
  const extra = Object.keys(review).filter((field) => !fields.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) throw prerequisiteError(unit, `${label} 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!isNonEmptyString(review.confirmationId) || !isNonEmptyString(review.evidenceFile)) throw prerequisiteError(unit, `${label} 缺少确认身份或证据来源文件`);
  resolveRepoFile(repo, review.evidenceFile, io, unit, `${label}.evidenceFile`);
}

/** 读取并复核当前场景或弹窗 Work Item 的不可变 V2 拆解还原方案。 */
export function assertHighFidelityPrerequisite(unit, work, pkg, repo, io) {
  const shapeErrors = validateHighFidelityPrerequisiteShape(unit);
  if (shapeErrors.length) throw prerequisiteError(unit, shapeErrors[0]);
  if (!SCENE_UNIT_TYPES.has(unit.unitType)) return null;
  if (!repo || !io || typeof io.resolve !== 'function' || typeof io.existsSync !== 'function' || typeof io.readFileSync !== 'function') throw prerequisiteError(unit, '缺少 V2 证据读取能力');
  const reference = unit.highFidelityPrerequisite;
  if (reference.workItemId !== work?.workItemId || pkg?.workItemId !== work?.workItemId) throw prerequisiteError(unit, 'Implementation Package、前置引用与当前 Work Item 不一致；只能引用当前任务结果');
  const currentV2 = work?.visualStageEvidenceRefs?.V2;
  if (!isRecord(currentV2) || currentV2.path !== reference.evidenceFile || (currentV2.workItemId && currentV2.workItemId !== work.workItemId)) throw prerequisiteError(unit, 'Implementation Package 必须只引用当前 Work Item 的 V2 拆解方案');
  const evidencePath = resolveRepoFile(repo, reference.evidenceFile, io, unit, 'evidenceFile');
  let evidence;
  try { evidence = JSON.parse(io.readFileSync(evidencePath, 'utf8')); } catch (error) { throw prerequisiteError(unit, `evidenceFile 不是有效 JSON：${error.message}`); }
  if (!isRecord(evidence)) throw prerequisiteError(unit, 'V2 拆解方案必须为对象');
  const missing = V2_PLAN_FIELDS.filter((field) => evidence[field] === undefined);
  const extra = Object.keys(evidence).filter((field) => !V2_PLAN_FIELDS.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) throw prerequisiteError(unit, `V2 拆解方案字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  const expected = unitContext(unit);
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA || evidence.workItemId !== work.workItemId || evidence.status !== 'COMPLETE' || evidence.stage !== 'V2' || evidence.frozen !== true || evidence.sceneId !== expected.sceneId) throw prerequisiteError(unit, 'V2 拆解方案未绑定当前 Work Item、场景、完成状态或冻结状态');
  assertArtifact(evidence.sceneMaster, IMAGE_FIELDS, expected, repo, io, unit, 'sceneMaster');
  assertArtifact(evidence.sceneReconstructionContract, ARTIFACT_FIELDS, expected, repo, io, unit, 'sceneReconstructionContract');
  assertArtifact(evidence.decompositionAnnotation, ARTIFACT_FIELDS, expected, repo, io, unit, 'decompositionAnnotation');
  assertArtifact(evidence.technicalDecomposition, ARTIFACT_FIELDS, expected, repo, io, unit, 'technicalDecomposition');
  assertReviewEvidence(evidence.visualDecompositionConfirmation, CONFIRMATION_FIELDS, repo, io, unit, 'visualDecompositionConfirmation');
  if (evidence.visualDecompositionConfirmation.confirmationMode !== 'manual' || !['PASS', 'accepted'].includes(evidence.visualDecompositionConfirmation.status)) throw prerequisiteError(unit, 'visualDecompositionConfirmation 必须是 manual PASS/accepted 的拆解图确认');
  if (!Array.isArray(evidence.visualProductionUnits) || evidence.visualProductionUnits.length === 0) throw prerequisiteError(unit, 'V2 拆解方案必须包含 visualProductionUnits');
  if (!isRecord(evidence.visualProductionContract)) throw prerequisiteError(unit, 'V2 拆解方案必须包含 visualProductionContract');
  if (!Array.isArray(evidence.displayLayerContexts)) throw prerequisiteError(unit, 'V2 拆解方案必须包含 displayLayerContexts 数组');
  const contexts = evidence.displayLayerContexts;
  const seenContexts = new Set();
  for (const context of contexts) {
    if (!isRecord(context)) throw prerequisiteError(unit, 'displayLayerContexts 每项必须为对象');
    const missingContext = DISPLAY_LAYER_CONTEXT_REQUIRED_FIELDS.filter((field) => context[field] === undefined);
    const extraContext = Object.keys(context).filter((field) => !DISPLAY_LAYER_CONTEXT_FIELDS.includes(field) && !isOptionalSnapshotField(field));
    if (missingContext.length || extraContext.length) throw prerequisiteError(unit, `displayLayerContexts 字段不严格：缺少 ${missingContext.join('、') || '无'}；多余 ${extraContext.join('、') || '无'}`);
    if (!isNonEmptyString(context.displayLayerId) || context.hostSceneId !== expected.sceneId) throw prerequisiteError(unit, 'displayLayerContexts 的 displayLayerId/hostSceneId 未绑定根场景');
    const contextKey = `${context.displayLayerId}:${context.hostSceneId}`;
    if (seenContexts.has(contextKey)) throw prerequisiteError(unit, `displayLayerContexts 存在重复宿主上下文：${contextKey}`);
    seenContexts.add(contextKey);
    assertArtifact(context.hostContextImage, CONTEXT_IMAGE_FIELDS, { sceneId: expected.sceneId, displayLayerId: context.displayLayerId, hostSceneId: context.hostSceneId }, repo, io, unit, `displayLayerContexts[${contextKey}].hostContextImage`);
  }
  if (unit.unitType === 'DISPLAY_LAYER') {
    const matches = contexts.filter((context) => context.displayLayerId === expected.displayLayerId && context.hostSceneId === expected.hostSceneId);
    if (matches.length !== 1) throw prerequisiteError(unit, `displayLayerContexts 必须包含唯一匹配上下文：${expected.displayLayerId}:${expected.hostSceneId}`);
  }
  return evidence;
}

/** 复核实施包的 V2 规划前置；V3 执行门由 Execution State/READY 入口另行校验。 */
export function assertHighFidelityPrerequisites(pkg, work, repo, io) {
  assertFormalImplementationAfterV2(work, pkg, repo, io);
  for (const unit of pkg.executionUnits) assertHighFidelityPrerequisite(unit, work, pkg, repo, io);
  return true;
}
