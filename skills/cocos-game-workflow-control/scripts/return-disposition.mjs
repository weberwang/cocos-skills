#!/usr/bin/env node

/**
 * 工作流 RETURN 处置的共享规则。
 *
 * RETURN 是一条带审计记录的失效边界：它会清除当前消费位置，保留历史文件，
 * 并且只允许控制面根据 affectedScope 推导出的最早恢复状态重新进入工作流。
 */
import { existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** 普通代码候选变化只重验当前范围；只有设计、目标范围或关键前置改变才回退。 */
export const RETURN_CLASSIFICATIONS = Object.freeze([
  'upstream-fact-invalidated',
  'scope-changed',
  'hard-gate-would-be-bypassed',
]);

/** 控制面允许回到的最早前向状态；INTAKE 不是 RETURN 的恢复出口。 */
export const RETURN_STATES = Object.freeze(['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING']);

/** 所有 RETURN 记录必须声明的失效工件；历史文件仍保留在原位置或归档位置。 */
export const RETURN_CORE_INVALIDATED_ARTIFACTS = Object.freeze([
  'approvalRecord',
  'pendingApprovalStatus',
  'pendingVisualPrerequisiteSnapshot',
  'pendingApprovalPresentation',
  'diffAuditRecord',
  'validationBatchId',
]);

/** RETURN 记录允许声明的工件名称，防止手写任意字段伪造失效完成。 */
export const RETURN_INVALIDATED_ARTIFACTS = Object.freeze([
  ...RETURN_CORE_INVALIDATED_ARTIFACTS,
  'implementationPackageRecord',
  'executionState',
  'visualStageEvidenceRefs',
  'visualDecompositionConfirmation',
]);

/** 影响范围只接受这三种可审计前缀；前缀和值都不能使用通配表达式。 */
const RETURN_SCOPE_PATTERN = /^(stage|scene|artifact):([A-Za-z0-9][A-Za-z0-9._/-]*)$/;

/** 用于选择最早恢复出口的状态顺序。 */
const RETURN_STATE_RANK = Object.freeze({ BASELINE: 0, PROPOSAL: 1, REVIEW: 2, IMPLEMENTING: 3 });

/** 校验与 Work Item Schema date-time 一致的 RFC3339 时间戳。 */
function validDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** 阶段范围到恢复状态的确定性映射。 */
const STAGE_SCOPE_STATE = Object.freeze({
  INTAKE: 'BASELINE', BASELINE: 'BASELINE', SCOPE: 'BASELINE', GLOBAL: 'BASELINE', V0: 'BASELINE',
  V1: 'PROPOSAL', PROPOSAL: 'PROPOSAL',
  V2: 'REVIEW', V3: 'REVIEW', REVIEW: 'REVIEW',
  V4: 'IMPLEMENTING', IMPLEMENTING: 'IMPLEMENTING', VALIDATING: 'IMPLEMENTING', PASSED: 'IMPLEMENTING', INTEGRATING: 'IMPLEMENTING', RELEASE_APPROVAL_REQUIRED: 'IMPLEMENTING', RELEASING: 'IMPLEMENTING', COMPLETE: 'IMPLEMENTING',
});

/** 已知工件名称到最早恢复状态的映射；未知工件仍需依赖分类或显式 stage 范围。 */
const ARTIFACT_SCOPE_STATE = Object.freeze({
  scope: 'BASELINE', baseline: 'BASELINE', 'visual-baseline': 'BASELINE',
  v1: 'PROPOSAL', proposal: 'PROPOSAL', candidate: 'REVIEW', 'visual-candidate': 'REVIEW', v2: 'REVIEW', approvalrecord: 'REVIEW', visualdecompositionconfirmation: 'REVIEW',
  implementationpackagerecord: 'IMPLEMENTING', implementationpackage: 'IMPLEMENTING', executionstate: 'IMPLEMENTING', diffauditrecord: 'IMPLEMENTING', diffaudit: 'IMPLEMENTING', evidence: 'IMPLEMENTING', validationbatchid: 'IMPLEMENTING',
});

/** 将命令行单值/重复值拆成原始数组；保留非字符串以便严格校验能够拒绝它。 */
function readList(value) {
  if (value === undefined || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => typeof item === 'string' ? item.split(',') : [item]);
}

/** 规范化并严格校验 affectedScope，拒绝旧的裸阶段、数字、空值、通配和未知前缀。 */
export function normalizeAffectedScope(value) {
  if (!Array.isArray(value)) return { error: 'affectedScope 必须是非空字符串数组，不能使用单值、数字或旧的裸阶段写法' };
  if (!value.length) return { error: 'affectedScope 必须是非空字符串数组' };
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return { error: 'affectedScope 每一项必须是非空字符串' };
    const scope = item.trim();
    const match = RETURN_SCOPE_PATTERN.exec(scope);
    if (!match) return { error: `affectedScope 无效：${scope}；必须使用 stage:/scene:/artifact: 前缀，且不得包含通配符` };
    if (match[2].includes('*') || match[2].includes('?')) return { error: `affectedScope 不得使用通配范围：${scope}` };
    normalized.push(scope);
  }
  if (new Set(normalized).size !== normalized.length) return { error: 'affectedScope 必须唯一，不能重复声明同一影响范围' };
  return { value: normalized };
}

/** 从受影响范围提取类型和值，调用前已完成严格格式校验。 */
function scopeParts(scope) {
  const separator = scope.indexOf(':');
  return { type: scope.slice(0, separator), value: scope.slice(separator + 1) };
}

/** 将分类和范围确定性地映射为最早恢复状态。 */
export function deriveReturnState({ classification, affectedScope = [], fromState } = {}) {
  const candidates = [];
  for (const scope of affectedScope) {
    const { type, value } = scopeParts(scope);
    if (type === 'stage') {
      const state = STAGE_SCOPE_STATE[value.toUpperCase()];
      if (state) candidates.push(state);
    } else if (type === 'artifact') {
      const state = ARTIFACT_SCOPE_STATE[value.toLowerCase()];
      if (state) candidates.push(state);
    }
  }
  if (classification === 'scope-changed') candidates.push('BASELINE');
  if (!candidates.length && fromState && RETURN_STATE_RANK[fromState] !== undefined) candidates.push(fromState);
  if (!candidates.length) candidates.push('REVIEW');
  return candidates.sort((left, right) => RETURN_STATE_RANK[left] - RETURN_STATE_RANK[right])[0];
}

/** 根据恢复出口计算完整失效清单；核心门始终失效，实施链在实施前一律重建。 */
export function deriveInvalidatedArtifacts(returnState, work = {}) {
  const artifacts = new Set(RETURN_CORE_INVALIDATED_ARTIFACTS);
  if (RETURN_STATE_RANK[returnState] <= RETURN_STATE_RANK.IMPLEMENTING) {
    artifacts.add('implementationPackageRecord');
    artifacts.add('executionState');
  }
  if (RETURN_STATE_RANK[returnState] <= RETURN_STATE_RANK.REVIEW && (work.visualStage || work.visualStageState || work.visualStageEvidenceRefs || work.visualDecompositionConfirmation)) {
    artifacts.add('visualStageEvidenceRefs');
    artifacts.add('visualDecompositionConfirmation');
  }
  return [...artifacts];
}

/** 校验分类、理由和最小影响范围，并由控制面提前计算恢复出口。 */
export function parseReturnRequest(args = {}, work = {}) {
  if (args['return-state'] !== undefined || args.returnState !== undefined) return { error: 'RETURN 的 returnState 只能由控制面根据 affectedScope 推导，不能由命令行指定' };
  const rawClassification = args['return-classification'] ?? args['return-category'];
  const classification = typeof rawClassification === 'string' ? rawClassification.trim().toLowerCase() : '';
  const reason = typeof args['return-reason'] === 'string' ? args['return-reason'].trim() : '';
  const scopeResult = normalizeAffectedScope(readList(args['affected-scope'] ?? args.scope));
  if (!RETURN_CLASSIFICATIONS.includes(classification)) return { error: 'RETURN 只能用于必要回退；必须声明有效 --return-classification（upstream-fact-invalidated、scope-changed 或 hard-gate-would-be-bypassed）；普通候选修改请原地修复并定向重验' };
  if (!reason) return { error: 'RETURN 必须声明非空 --return-reason，说明继续推进会绕过硬门或使上游冻结事实失效' };
  if (scopeResult.error) return { error: `RETURN 的 --affected-scope 无效：${scopeResult.error}` };
  const fromState = work.globalState;
  const returnState = deriveReturnState({ classification, affectedScope: scopeResult.value, fromState });
  if (!RETURN_STATES.includes(returnState)) return { error: 'RETURN 无法从 affectedScope 推导合法恢复状态' };
  if (fromState && RETURN_STATE_RANK[fromState] !== undefined && RETURN_STATE_RANK[returnState] > RETURN_STATE_RANK[fromState]) return { error: `RETURN 恢复状态 ${returnState} 晚于当前状态 ${fromState}，不能把回退伪装成前进` };
  return { classification, reason, affectedScope: scopeResult.value, fromState, toState: 'RETURN', returnState };
}

/** 将必要回退写成完整审计记录；不接受旧版缺少 returnState/失效清单的结构。 */
export function createReturnRecord(request, work = {}) {
  if (request?.toState !== undefined && request.toState !== 'RETURN') throw new Error('RETURN 的 toState 只能由控制面生成，不能由请求自定义');
  const scopeResult = normalizeAffectedScope(request?.affectedScope);
  if (scopeResult.error) throw new Error(scopeResult.error);
  const classification = request?.classification;
  const reason = typeof request?.reason === 'string' ? request.reason.trim() : '';
  if (!RETURN_CLASSIFICATIONS.includes(classification) || !reason) throw new Error('RETURN 记录必须包含有效 classification 与非空 reason');
  const fromState = work.globalState ?? request.fromState;
  const returnState = deriveReturnState({ classification, affectedScope: scopeResult.value, fromState });
  if (!RETURN_STATES.includes(returnState)) throw new Error('RETURN 记录无法推导合法 returnState');
  if (request?.returnState !== undefined && request.returnState !== returnState) throw new Error(`RETURN 的 returnState 必须由 affectedScope 推导为 ${returnState}`);
  if (fromState && RETURN_STATE_RANK[fromState] !== undefined && RETURN_STATE_RANK[returnState] > RETURN_STATE_RANK[fromState]) throw new Error(`RETURN 恢复状态 ${returnState} 晚于当前状态 ${fromState}`);
  return {
    classification, reason, affectedScope: scopeResult.value, fromState, toState: 'RETURN', returnState,
    invalidatedArtifacts: deriveInvalidatedArtifacts(returnState, work), previousValidationBatchId: work.validationBatchId ?? null,
    invalidatesDownstream: true, recordedAt: new Date().toISOString(), resolvedAt: null,
  };
}

/** 将 evidenceRoot 解析为项目内的具体目录，拒绝仓库根和任何越界路径。 */
function resolveProjectEvidenceRoot(work, projectRoot) {
  if (!projectRoot || !work?.evidenceRoot) return null;
  const unresolvedRoot = resolve(projectRoot);
  if (!existsSync(unresolvedRoot)) return null;
  const root = realpathSync(unresolvedRoot);
  const unresolvedEvidenceRoot = resolve(root, String(work.evidenceRoot));
  const evidenceRoot = existsSync(unresolvedEvidenceRoot) ? realpathSync(unresolvedEvidenceRoot) : unresolvedEvidenceRoot;
  const relativeRoot = relative(root, evidenceRoot);
  if (!relativeRoot || relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`) || isAbsolute(relativeRoot)) return null;
  return evidenceRoot;
}

/** 归档旧 Execution State，保留审计文件且让固定路径不再被新恢复流程消费。 */
function archiveExecutionState(work, projectRoot) {
  if (!projectRoot || !work?.evidenceRoot) return null;
  const evidenceRoot = resolveProjectEvidenceRoot(work, projectRoot);
  if (!evidenceRoot) throw new Error('RETURN 的 evidenceRoot 必须是项目内的具体证据目录，不能指向仓库根或越界路径');
  const statePath = resolve(evidenceRoot, 'execution-state.json');
  if (!existsSync(statePath)) return null;
  const archiveRoot = resolve(evidenceRoot, 'invalidated');
  mkdirSync(archiveRoot, { recursive: true });
  const stamp = Date.now().toString(36);
  let archivePath = join(archiveRoot, `execution-state.invalidated-${stamp}.json`);
  let suffix = 1;
  while (existsSync(archivePath)) archivePath = join(archiveRoot, `execution-state.invalidated-${stamp}-${suffix++}.json`);
  renameSync(statePath, archivePath);
  return archivePath;
}

/** 进入 RETURN 时清除所有可消费引用；历史审批、证据和状态文件不被删除。 */
export function invalidateReturnArtifacts(work, returnRecord, options = {}) {
  const invalidated = new Set(returnRecord.invalidatedArtifacts ?? []);
  work.previousApprovalRecord = work.approvalRecord ?? null;
  work.approvalRecord = null;
  work.pendingApprovalStatus = 'invalid';
  work.pendingApprovalPresentedId = null;
  work.pendingApprovalPresentedAt = null;
  delete work.pendingVisualPrerequisiteSnapshot;
  delete work.diffAuditRecord;
  delete work.diffAuditLedgerRecord;
  if (invalidated.has('implementationPackageRecord')) delete work.implementationPackageRecord;
  if (invalidated.has('visualStageEvidenceRefs')) {
    delete work.visualStageEvidenceRefs;
    delete work.visual_stage_evidence_refs;
  }
  if (invalidated.has('visualDecompositionConfirmation')) {
    delete work.visualDecompositionConfirmation;
    delete work.visual_decomposition_confirmation;
    delete work.visualHumanApproval;
    delete work.visual_human_approval;
  }
  // validationBatchId 必须轮换，旧 Evidence 即使文件仍存在也不能重新绑定当前批次。
  work.validationBatchId = `BATCH-${work.workItemId}-RETURN-${Date.now().toString(36)}`;
  if (work.visualStage && invalidated.has('visualStageEvidenceRefs')) work.visualStageState = 'invalid';
  if (invalidated.has('executionState')) archiveExecutionState(work, options.projectRoot);
  return work;
}

/** 校验持久化 RETURN 记录与当前 Work Item 的阶段/失效状态，防止自由选择恢复目标。 */
export function validateReturnRecord(record, options = {}) {
  if (record === undefined || record === null) return options.required === true ? 'RETURN 状态缺少持久化 returnRecord' : null;
  if (typeof record !== 'object' || Array.isArray(record)) return 'returnRecord 必须是对象';
  if (!RETURN_CLASSIFICATIONS.includes(record.classification)) return 'returnRecord.classification 无效';
  if (typeof record.reason !== 'string' || !record.reason.trim()) return 'returnRecord.reason 必须是非空字符串';
  const allowedFields = ['classification', 'reason', 'affectedScope', 'fromState', 'toState', 'returnState', 'invalidatedArtifacts', 'previousValidationBatchId', 'invalidatesDownstream', 'recordedAt', 'resolvedAt'];
  const extraFields = Object.keys(record).filter((field) => !allowedFields.includes(field));
  if (extraFields.length) return `returnRecord 包含 Schema 禁止字段：${extraFields.join('、')}`;
  const scopeResult = normalizeAffectedScope(record.affectedScope);
  if (scopeResult.error) return `returnRecord.${scopeResult.error}`;
  if (record.toState !== 'RETURN' || record.invalidatesDownstream !== true) return 'returnRecord 必须绑定 toState=RETURN 与 invalidatesDownstream=true';
  if (typeof record.fromState !== 'string' || !record.fromState.trim()) return 'returnRecord.fromState 必须是非空状态';
  if (!RETURN_STATES.includes(record.returnState)) return 'returnRecord.returnState 必须是 BASELINE、PROPOSAL、REVIEW 或 IMPLEMENTING';
  const derived = deriveReturnState({ classification: record.classification, affectedScope: scopeResult.value, fromState: record.fromState });
  if (record.returnState !== derived) return `returnRecord.returnState 必须由 affectedScope 推导为 ${derived}`;
  if (!Array.isArray(record.invalidatedArtifacts) || !record.invalidatedArtifacts.length || new Set(record.invalidatedArtifacts).size !== record.invalidatedArtifacts.length || record.invalidatedArtifacts.some((item) => !RETURN_INVALIDATED_ARTIFACTS.includes(item))) return 'returnRecord.invalidatedArtifacts 必须是唯一且受控的失效工件数组';
  if (RETURN_CORE_INVALIDATED_ARTIFACTS.some((item) => !record.invalidatedArtifacts.includes(item))) return 'returnRecord.invalidatedArtifacts 缺少审批、视觉快照、展示、Diff Audit 或批次失效声明';
  if (RETURN_STATE_RANK[record.returnState] <= RETURN_STATE_RANK.IMPLEMENTING && (!record.invalidatedArtifacts.includes('implementationPackageRecord') || !record.invalidatedArtifacts.includes('executionState'))) return 'RETURN 到 IMPLEMENTING 及更早状态必须声明 implementationPackageRecord 与 executionState 失效';
  if (!Object.hasOwn(record, 'previousValidationBatchId') || (record.previousValidationBatchId !== null && typeof record.previousValidationBatchId !== 'string')) return 'returnRecord.previousValidationBatchId 必须是字符串或 null';
  if (!validDateTime(record.recordedAt)) return 'returnRecord.recordedAt 必须是 RFC3339 时间';
  if (record.resolvedAt !== null && !validDateTime(record.resolvedAt)) return 'returnRecord.resolvedAt 必须是 RFC3339 时间或 null';
  if (options.work) {
    if (options.work.globalState === 'RETURN' && record.resolvedAt !== null) return 'RETURN 状态的 returnRecord.resolvedAt 必须保持 null';
    if (options.work.globalState !== 'RETURN' && record.resolvedAt === null) return '退出 RETURN 后必须写入 returnRecord.resolvedAt';
  }
  return null;
}

/** 校验 RETURN 恢复出口并确认入口失效动作已经落盘。 */
export function validateReturnResume(work, target, options = {}) {
  const error = validateReturnRecord(work?.returnRecord, { required: true, work });
  if (error) return error;
  if (target !== work.returnRecord.returnState) return `RETURN 只能恢复到 returnRecord.returnState=${work.returnRecord.returnState}，不能迁移到 ${target}`;
  if (work.approvalRecord !== null) return 'RETURN 恢复前必须清空 approvalRecord，旧审批不能继续消费';
  if (work.pendingApprovalStatus !== 'invalid') return 'RETURN 恢复前 pendingApprovalStatus 必须为 invalid';
  if (work.pendingApprovalPresentedId !== null || work.pendingApprovalPresentedAt !== null) return 'RETURN 恢复前必须清空 pending approval 展示信息';
  if (work.pendingVisualPrerequisiteSnapshot !== undefined) return 'RETURN 恢复前必须清空 pendingVisualPrerequisiteSnapshot';
  if (work.diffAuditRecord !== undefined || work.diffAuditLedgerRecord !== undefined) return 'RETURN 恢复前必须清空 Diff Audit 引用';
  if (work.returnRecord.invalidatedArtifacts.includes('implementationPackageRecord') && work.implementationPackageRecord !== undefined) return 'RETURN 恢复前必须清空 Implementation Package 引用';
  if (work.returnRecord.previousValidationBatchId !== null && work.validationBatchId === work.returnRecord.previousValidationBatchId) return 'RETURN 恢复前必须轮换 validationBatchId';
  if (work.returnRecord.invalidatedArtifacts.includes('executionState') && options.projectRoot && work.evidenceRoot) {
    const evidenceRoot = resolveProjectEvidenceRoot(work, options.projectRoot);
    if (!evidenceRoot) return 'RETURN 的 evidenceRoot 必须是项目内的具体证据目录，不能指向仓库根或越界路径';
    const statePath = resolve(evidenceRoot, 'execution-state.json');
    if (existsSync(statePath)) return 'RETURN 恢复前固定路径上的旧 Execution State 仍可消费，必须先归档失效状态';
  }
  return null;
}
