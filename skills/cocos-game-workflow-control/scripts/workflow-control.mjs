#!/usr/bin/env node
/** Cocos Creator 3.x 全局控制 CLI：只校验和记录，不执行被门控的业务动作。 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { assertCompletedUnits, assertExecutionWorkflowComplete, assertImplementationPackagePlanningPrerequisites, assertSceneWorkItemComplete, assertUnitReady, executionStateSummary, initializeExecutionState, loadExecutionState, updateExecutionStateStage, validateAndCompleteExecutionUnit } from './execution-unit-control.mjs';
import { validateParallelBatch } from './parallel-batch-control.mjs';
import { validateDelegationBinding, validateExecutionPlan } from './parallel-plan.mjs';
import { repositoryLint } from './repository-lint.mjs';
import { pathMatches } from './path-matcher.mjs';
import { isVisualProductionWork, loadVisualManifestSnapshot, validateVisualChangeRequest, validateVisualDelegationBinding, validateVisualEvidence, validateVisualImplementationPackage, validateVisualImplementationPackageBinding } from './visual-production-contract.mjs';
import { validateVisualConfirmationReferences, visualConfirmationAuthority } from './visual-confirmation-authority.mjs';
import { enforceVisualStageGate, structuredVisualStageFailure, validateVisualStageDeclaration, validateVisualStagePrerequisites, VISUAL_REMEDIATION } from './visual-stage-prerequisites.mjs'; import { createReturnRecord, invalidateReturnArtifacts, parseReturnRequest, validateReturnRecord, validateReturnResume } from './return-disposition.mjs';
import { artifactFingerprint, computePlanFingerprint, fileHash, hashText } from './runtime/fingerprint.mjs';
import { parseArgs, list, readJson, readJsonWithIdentity, captureJsonIdentity, writeJson, writeJsonTransaction, transactionJournalPathForLedger, requireFields, requireStringArray } from './runtime/io.mjs';
import { failureRecord, renderResult, writeResult } from './runtime/output.mjs';
import { createStableCommands } from './runtime/stable-commands.mjs';
import { createRecordValidators } from './runtime/validators.mjs';
import { createValidationContext } from './runtime/validation-context.mjs';
import { declaredOperationFlags, requestedOperationFlags, requireResolvedUserInput, requiresExplicitApproval, userInputRequired, workAllowsLevel } from './runtime/workflow-scope.mjs';
import { schemaEnum, schemaRequired } from './runtime/schema-contract.mjs';
import { approvalMatchesPending, approvalMatchesQuery, approvalSnapshotFromWork } from './runtime/approval-contract.mjs';
import { validateActionState, validateChangeRequests as validateChangeRequestRules } from './runtime/workflow-state-contract.mjs';
import { prepareSceneStageTransition } from './scene-stage-transition.mjs';
import { prepareImplementationTransition } from './workflow-implementation-transition.mjs';
import { hasResponsiveDeclaration, isResponsiveWorkItem, validateResponsiveContract } from './responsive-viewport-contract.mjs';
const STATES = schemaEnum('work-item.schema.json', ['properties', 'globalState']);
const LEVELS = schemaEnum('work-item.schema.json', ['properties', 'pendingApprovalActionLevel']);
const GATES = schemaEnum('work-item.schema.json', ['properties', 'nextGate']);
const EVIDENCE_GATES = schemaRequired('evidence-manifest.schema.json', ['properties', 'gateResults']);
const COCOS_ACTION_TYPES = schemaEnum('work-item.schema.json', ['properties', 'pendingApprovalActionType']);
const COCOS_ACTION_LEVEL = new Map([
  ['cocos-inspect', 'A0'], ['cocos-spec-candidate', 'A1'], ['cocos-prototype', 'A2'],
  ['cocos-code-change', 'A3'], ['cocos-asset-change', 'A3'], ['cocos-ui-change', 'A3'], ['cocos-audio-change', 'A3'], ['cocos-balance-change', 'A3'], ['cocos-qa-build', 'A3'],
  ['cocos-integration', 'A4'], ['cocos-build-upload', 'A5'], ['cocos-backend-config', 'A5'], ['cocos-channel-config', 'A5'],
  ['cocos-device-test', 'A6'], ['cocos-store-submit', 'A6'], ['cocos-release', 'A6'], ['cocos-game-rollback', 'A6']
]);
const COCOS_ACTIONS = new Set(COCOS_ACTION_TYPES);
const AUTOMATIC_COCOS_ACTIONS = new Set([...COCOS_ACTION_LEVEL].filter(([, level]) => ['A0', 'A1', 'A2', 'A3'].includes(level)).map(([action]) => action));
const TRANSITIONS = {
  INTAKE: ['BASELINE', 'BLOCKED'], BASELINE: ['PROPOSAL', 'BLOCKED'], PROPOSAL: ['REVIEW', 'RETURN', 'BLOCKED'], REVIEW: ['VALIDATING', 'IMPLEMENTING', 'RETURN', 'BLOCKED'], IMPLEMENTING: ['VALIDATING', 'RETURN', 'BLOCKED'], VALIDATING: ['PASSED', 'RETURN', 'BLOCKED'], PASSED: ['INTEGRATING', 'COMPLETE', 'REVIEW', 'RETURN', 'BLOCKED'], INTEGRATING: ['COMPLETE', 'RELEASE_APPROVAL_REQUIRED', 'RETURN', 'BLOCKED'], RELEASE_APPROVAL_REQUIRED: ['RELEASING', 'RETURN', 'BLOCKED'], RELEASING: ['COMPLETE', 'BLOCKED'], COMPLETE: [], RETURN: ['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING', 'BLOCKED'], BLOCKED: ['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING']
};
const SHORT_APPROVAL = /^(批准|同意|可以|继续|就这个|选\s*[a-zA-Z]|按流程推进|你看着办|做完它|批准然后按(?:照)?工作流推进)[。！!\s]*$/i;
const AFFIRMATIVE_APPROVAL = /^(批准|同意|确认|接受|通过)(?:$|[\s，,：:。！!].*)/;
const NEGATIVE_APPROVAL = /(不同意|不批准|拒绝|取消|停止)/;
/** 控制面异常；统一在 CLI 入口处理，保证旧命令和新入口都稳定退出。 */
class WorkflowControlError extends Error {
  constructor(message, code = 2, details = null) {
    super(String(message));
    this.name = 'WorkflowControlError';
    this.code = code;
    this.details = details;
  }
}
/** 抛出中文控制面错误，由最外层按命令选择兼容或紧凑输出。 */
function fail(message, code = 2, details = null) {
  throw new WorkflowControlError(message, code, details);
}
const visualStageGate = enforceVisualStageGate;
/** 校验 Cocos 生命周期动作白名单及其唯一等级，未知 cocos-* 也不得旁路。 */ function validateCocosAction(actionType, level = null, label = 'actionType') {
  if (!COCOS_ACTIONS.has(actionType)) fail(`${label} 不是受控 Cocos 动作白名单成员：${actionType}`);
  if (level && COCOS_ACTION_LEVEL.get(actionType) !== level) fail(`${label} 与动作等级不一致：${actionType} 只能使用 ${COCOS_ACTION_LEVEL.get(actionType)}`);
}
/** 非 Cocos 操作完全退出本控制面，不读取或修改任何工作流工件。 */ function returnOutOfScope(actionType) { process.stdout.write(JSON.stringify({ controlled: false, channel: 'OUT_OF_SCOPE', authorizationBasis: 'OUTSIDE_COCOS_WORKFLOW', explicitApprovalRequired: false })); return true; }
/** 在读取 Work Item 前判定显式 actionType 是否属于本控制面。 */ function bypassOutsideCocos(args) {
  const actionType = String(args['action-type'] ?? '');
  if (!actionType || actionType.startsWith('cocos-')) return false;
  return returnOutOfScope(actionType);
}
const recordValidators = createRecordValidators({
  gates: GATES, states: STATES, automaticActions: AUTOMATIC_COCOS_ACTIONS, actionLevels: LEVELS,
  requireFields, requireStringArray, validateCocosAction,
  actionLevelFor: (action) => COCOS_ACTION_LEVEL.get(action), validateExecutionPlan,
  validateVisualImplementationPackage, validateVisualChangeRequest, pathMatches, fail,
});
const { validateApproval, validateDelegation, validateEvidence, validateResponsiveEvidence, validateImplementationPackageShape, validateChangeRequestShape, validateChangeRequest } = recordValidators;
/** 校验工作项的核心结构、枚举与控制字段。 */
function validateWorkItem(work) {
  // outOfScope 只是范围说明；缺失按空数组处理，工作项身份、目标、路径和证据字段仍必须显式提供。
  if (work && typeof work === 'object' && !Array.isArray(work)) work.outOfScope ??= [];
  requireFields(work, schemaRequired('work-item.schema.json'), 'Work Item');
  const visualDeclarationErrors = validateVisualStageDeclaration(work);
  if (visualDeclarationErrors.length) {
    const declarationError = visualDeclarationErrors[0]; const disposition = declarationError.disposition ?? VISUAL_REMEDIATION.REPAIR; const failure = { ok: false, command: 'work-item-schema', errorCode: declarationError.errorCode, message: declarationError.message, disposition, remediation: declarationError.remediation ?? (disposition === VISUAL_REMEDIATION.RETURN ? 'RETURN_REQUIRED' : disposition === VISUAL_REMEDIATION.REVALIDATE ? 'REVALIDATION_REQUIRED' : 'REPAIR_REQUIRED'), missingStages: declarationError.missingStages ?? [], missingEvidence: declarationError.missingEvidence ?? [], invalidatedDependencies: declarationError.invalidatedDependencies ?? [], affectedScope: declarationError.affectedScope ?? [], invalidatesDownstream: declarationError.invalidatesDownstream === true, nextAction: declarationError.nextAction ?? '原地修复视觉阶段声明后，重新运行当前门；沿工作流继续推进' };
    fail(failure.message, 2, failure);
  }
  const visualReferenceErrors = validateVisualConfirmationReferences(work);
  if (visualReferenceErrors.length) fail(visualReferenceErrors[0]);
  // V1 或已明确声明可见响应式合同的工作项必须先冻结逻辑坐标和 DPR 事实，不能把 stageId 当作运行证明。
  if (isResponsiveWorkItem(work)) {
    const identityFields = ['responsiveContractVersion', 'layoutContractVersion', 'visualBaselineVersion'];
    requireFields(work, identityFields, 'Work Item 响应式身份');
    if (identityFields.some((field) => typeof work[field] !== 'string' || !work[field].trim())) fail('Work Item 响应式合同、布局合同和视觉基线版本必须为非空字符串');
    const responsiveErrors = validateResponsiveContract(work, { stage: work.visualStage ?? work.stageId, scope: work.workItemId });
    if (responsiveErrors.length) fail(responsiveErrors[0]);
  }
  requireStringArray(work.moduleIds, 'Work Item.moduleIds');
  if (!work.moduleIds.length || new Set(work.moduleIds).size !== work.moduleIds.length || JSON.stringify(work.moduleIds) !== JSON.stringify([...work.moduleIds].sort())) fail('Work Item.moduleIds 必须为非空、唯一且已排序数组');
  if (!STATES.includes(work.globalState)) fail(`未知全局状态 ${work.globalState}`);
  const returnRecordError = validateReturnRecord(work.returnRecord, { required: work.globalState === 'RETURN', work }); if (returnRecordError) fail(returnRecordError);
  if (!GATES.includes(work.nextGate) || !GATES.includes(work.pendingApprovalGate)) fail('Work Item nextGate/pendingApprovalGate 必须为 F0-F4');
  if (!LEVELS.includes(work.pendingApprovalActionLevel)) fail('Work Item pendingApprovalActionLevel 无效');
  validateCocosAction(work.pendingApprovalActionType, work.pendingApprovalActionLevel, 'Work Item.pendingApprovalActionType');
  if (!STATES.includes(work.pendingApprovalState) || !work.pendingApprovalContext) fail('Work Item pending approval 必须绑定有效全局状态与上下文');
  if (Number.isNaN(Date.parse(work.pendingApprovalPreparedAt))) fail('Work Item.pendingApprovalPreparedAt 必须为有效时间');
  if (work.pendingApprovalPresentedId !== null && work.pendingApprovalPresentedId !== work.pendingApprovalId) fail('Work Item pending 展示记录与当前审批点不一致');
  if (work.pendingApprovalPresentedAt !== null && Number.isNaN(Date.parse(work.pendingApprovalPresentedAt))) fail('Work Item.pendingApprovalPresentedAt 必须为有效时间或 null');
  if (work.userOriginalText !== undefined && (typeof work.userOriginalText !== 'string' || !work.userOriginalText.trim())) fail('Work Item.userOriginalText 必须为非空字符串');
  if (work.visualConfirmationPrerequisiteFiles !== undefined) requireStringArray(work.visualConfirmationPrerequisiteFiles, 'Work Item.visualConfirmationPrerequisiteFiles');
  for (const field of ['inScope', 'outOfScope', 'approvedRequirements', 'allowedActions', 'allowedActionLevels', 'explicitApprovalActionLevels', 'prohibitedActions', 'allowedPaths', 'forbiddenPaths', 'allowedExternalTargets', 'protectedExternalTargets', 'requiredGates', 'delegatedAgents', 'expectedOutputs', 'validationPlan', 'exitCriteria', 'changeRequestFiles', 'pendingApprovalImpactSummary', 'pendingApprovalFileScope', 'pendingApprovalServices', 'pendingApprovalExternalTargets']) requireStringArray(work[field], `Work Item.${field}`);
  for (const action of [...work.allowedActions, ...work.prohibitedActions]) validateCocosAction(action, null, 'Work Item 动作');
  // 当前动作必须同时受白名单和工作项集合约束，避免 diff-audit 绕过 preflight 的动作检查。
  if (!work.allowedActions.includes(work.pendingApprovalActionType) || work.prohibitedActions.includes(work.pendingApprovalActionType) || work.allowedActions.some((action) => work.prohibitedActions.includes(action))) fail('Work Item 当前动作必须已允许、未禁止，且 allowedActions/prohibitedActions 不得相交');
  if (work.allowedActions.some((action) => !(['A0', 'A1', 'A2', 'A3'].includes(COCOS_ACTION_LEVEL.get(action)) ? work.allowedActionLevels : work.explicitApprovalActionLevels).includes(COCOS_ACTION_LEVEL.get(action)))) fail('Work Item.allowedActions 与自动/显式动作等级不一致');
  for (const field of ['pendingApprovalAllowServiceStart', 'pendingApprovalAllowDelete', 'pendingApprovalExternalWrite', 'pendingApprovalDestructive', 'pendingApprovalPhysicalDevice', 'pendingApprovalRelease']) if (typeof work[field] !== 'boolean') fail(`Work Item.${field} 必须为布尔值`);
  const pendingNeedsApproval = requiresExplicitApproval(work.pendingApprovalActionLevel, declaredOperationFlags(work));
  if (pendingNeedsApproval && (!work.pendingApprovalImpactSummary.length || work.pendingApprovalImpactSummary.some((item) => !item.trim()))) fail('需要显式批准的 pending 必须提供非空影响列表');
  if (work.allowedActionLevels.some((level) => !['A0', 'A1', 'A2', 'A3'].includes(level)) || work.explicitApprovalActionLevels.some((level) => !['A4', 'A5', 'A6'].includes(level))) fail('Work Item 自动/显式批准等级分区无效');
  const pendingEffects = work.pendingApprovalExternalWrite || work.pendingApprovalDestructive || work.pendingApprovalPhysicalDevice || work.pendingApprovalRelease || work.pendingApprovalAllowDelete;
  if (['A0', 'A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel) && pendingEffects) fail('A0-A3 Cocos pending 不得声明外部、破坏、真机、发布或删除副作用');
  if (work.pendingApprovalActionLevel === 'A5' && (!work.pendingApprovalExternalWrite || !work.pendingApprovalExternalTargets.length)) fail('A5 Cocos pending 必须冻结外部写入与精确游戏目标');
  if (work.pendingApprovalActionLevel === 'A6' && !(work.pendingApprovalExternalWrite || work.pendingApprovalPhysicalDevice || work.pendingApprovalRelease || work.pendingApprovalDestructive)) fail('A6 Cocos pending 必须冻结高风险副作用');
  if (work.requiredGates.some((gate) => !GATES.includes(gate))) fail('Work Item.requiredGates 含未知 F 门');
  if (work.legacyReadOnly) fail('旧记录只能只读迁移，不能驱动新任务');
  if (!work.workItemId || !work.pendingApprovalId || !work.pendingApprovalObject || !work.pendingApprovalActionType || !work.validationBatchId) fail('Work Item 关键标识不能为空');
  return work;
}
/** 校验 Implementation Package 与 Work Item/审批/基线一致。 */
function validateImplementationPackage(pkg, work, repo = process.cwd(), delegations = [], options = {}) {
  const visualRequired = isVisualProductionWork(work) || pkg?.visualProductionUnits !== undefined || pkg?.visualManifestFile !== undefined;
  const manifestSnapshot = options.manifestSnapshot ?? (visualRequired ? loadVisualManifestSnapshot(pkg, repo) : null);
  if (visualRequired && (!manifestSnapshot || manifestSnapshot.errors?.length)) fail(manifestSnapshot?.errors?.[0] ?? '视觉 Implementation Package 缺少有效 visual manifest');
  const authority = options.authority ?? visualConfirmationAuthority(work, manifestSnapshot?.manifest ?? null, { projectRoot: repo, checkFiles: true, implementationPackage: pkg, delegations });
  // Shape 负责通用包结构，视觉单元基础校验延后到 binding；同一命令只遍历一次 visualProductionUnits。
  validateImplementationPackageShape(pkg, { projectRoot: repo, checkFiles: true, authority, deferVisualValidation: true });
  const visualBindingErrors = validateVisualImplementationPackageBinding(pkg, { projectRoot: repo, allowedPaths: work.allowedPaths, pathMatches, requireVisual: isVisualProductionWork(work), authority, manifestSnapshot });
  if (visualBindingErrors.length) fail(visualBindingErrors[0]);
  if (isResponsiveWorkItem(work, pkg)) {
    const responsiveErrors = validateResponsiveContract(pkg, { stage: work.visualStage ?? work.stageId, scope: pkg.packageId });
    if (responsiveErrors.length) fail(responsiveErrors[0]);
    for (const unit of pkg.executionUnits.filter((item) => ['SCENE', 'DISPLAY_LAYER'].includes(item?.unitType) && hasResponsiveDeclaration(item))) {
      const unitErrors = validateResponsiveContract(unit.responsiveContract ?? unit.responsiveViewportContract ?? unit, { stage: work.visualStage ?? work.stageId, scope: unit.displayLayerId ?? unit.sceneId ?? unit.unitId });
      if (unitErrors.length) fail(unitErrors[0]);
    }
  }
  if (pkg.workItemId !== work.workItemId || pkg.baselineVersion !== work.baselineVersion) fail('Implementation Package 未绑定当前工作项与基线版本');
  if (JSON.stringify(pkg.approvedRequirements) !== JSON.stringify(work.approvedRequirements) || JSON.stringify(pkg.allowedPaths) !== JSON.stringify(work.allowedPaths) || JSON.stringify(pkg.forbiddenPaths) !== JSON.stringify(work.forbiddenPaths) || JSON.stringify(pkg.outOfScope) !== JSON.stringify(work.outOfScope)) fail('Implementation Package 与工作项范围不一致');
  if (pkg.executionUnits.some((unit) => !work.moduleIds.includes(unit.moduleId))) fail('Implementation Package execution unit.moduleId 不属于 Work Item.moduleIds');
  try { assertImplementationPackagePlanningPrerequisites(pkg, work, repo, unitIo(repo)); } catch (error) { fail(error.message); }
  if (work.substantiveTradeoffRequired || work.visualDecisionRequired) fail('存在未决用户选择；请先澄清并更新 Work Item 或权威工件');
  for (const path of [...pkg.expectedAddedFiles, ...pkg.expectedDeletedFiles, ...Object.keys(pkg.fileOwnership)]) {
    if (!work.allowedPaths.some((pattern) => pathMatches(path, pattern)) || work.forbiddenPaths.some((pattern) => pathMatches(path, pattern))) fail(`Implementation Package 文件超出范围：${path}`);
  }
  if (Object.values(pkg.fileOwnership).some((owner) => owner !== work.assignedAgent && !work.delegatedAgents.includes(owner))) fail('Implementation Package 文件所有者不属于当前任务代理');
  return pkg;
}
/** 把路径规范化为仓库相对 POSIX 表示，并拒绝越出仓库。 */
function normalizeRepoPath(repo, path) {
  const absolute = resolve(repo, String(path));
  const rel = relative(repo, absolute);
  if (!rel || rel === '.') return '.';
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`路径越出仓库：${path}`);
  return rel.split(sep).join('/');
}
/** 验证目标路径全部在允许范围，且不命中禁止范围。 */
function checkPaths(paths, allowed, forbidden, repo) {
  const normalized = paths.map((path) => normalizeRepoPath(repo, path));
  for (const path of normalized) {
    if (forbidden.some((pattern) => pathMatches(path, pattern))) fail(`路径命中 forbiddenPaths：${path}`);
    if (!allowed.some((pattern) => pathMatches(path, pattern))) fail(`路径不在 allowedPaths：${path}`);
  }
  return normalized;
}
/** 加载并完整验证审批账本；value 用于复用与身份快照同一次读取的内容。 */
function readLedger(path, value = undefined) {
  const ledger = value ?? readJson(path, 'Approval Ledger');
  if (ledger.schemaVersion !== '1.0' || !Array.isArray(ledger.approvals)) fail('Approval Ledger 结构无效');
  ledger.approvals.forEach(validateApproval);
  return ledger;
}
/** 查找与当前对象、基线、等级、范围和副作用精确匹配的审批。 */
function matchingApprovals(work, ledger, options) {
  return ledger.approvals.filter((approval) => approvalMatchesQuery(approval, work, options, pathMatches));
}
/** 返回当前冻结 pending 唯一对应且仍有效的审批记录。 */
function effectiveApproval(work, ledger) {
  // RETURN 是审批消费的硬断点；即使旧账本文件仍存在，也不得重新绑定历史批准。
  if (work.globalState === 'RETURN' || work.pendingApprovalStatus === 'invalid' || !work.approvalRecord) return null;
  const matches = matchingApprovals(work, ledger, { approvalId: work.approvalRecord, level: work.pendingApprovalActionLevel, gate: work.pendingApprovalGate, object: work.pendingApprovalObject, actionType: work.pendingApprovalActionType, paths: work.pendingApprovalFileScope, targets: work.pendingApprovalExternalTargets, external: work.pendingApprovalExternalWrite, device: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, destructive: work.pendingApprovalDestructive });
  return matches.length === 1 ? matches[0] : null;
}
/** 纯函数：按 Cocos 审批或冻结工作项推导生命周期路线。 */
function deriveRoute(work, approval) {
  const level = approval?.actionLevel ?? work.pendingApprovalActionLevel;
  const channel = (({ A0: 'INSPECTION', A1: 'CANDIDATE', A2: 'PROTOTYPE', A3: 'PRODUCTION', A4: 'INTEGRATION', A5: 'EXTERNAL', A6: 'RELEASE' })[level] ?? 'CANDIDATE');
  let requiredArtifacts = {
    CANDIDATE: ['Work Item Scope', 'Artifact Audit', 'Evidence Manifest'],
    PROTOTYPE: ['Work Item Scope', 'Artifact/Diff Audit', 'Evidence Manifest'],
    PRODUCTION: ['Work Item Scope', 'Implementation Package', 'Diff Audit', 'F0-F3 Evidence'],
    INTEGRATION: ['A4/F4 Approval', 'Diff Audit', 'F4 Evidence'],
    EXTERNAL: ['A5 Exact Target Approval', 'External Receipt Artifact', 'Manual External Execution'],
    RELEASE: ['Independent Release Work Item', 'A6/F4 Exact Target Approval', 'Release Receipt Artifact', 'Manual Release Execution'],
    INSPECTION: ['Work Item Scope', 'Read-only Cocos Evidence']
  }[channel];
  const blockers = [];
  const decisionRequired = userInputRequired(work);
  const explicitRequired = requiresExplicitApproval(level, { external: work.pendingApprovalExternalWrite, device: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, destructive: work.pendingApprovalDestructive, allowDelete: work.pendingApprovalAllowDelete });
  if (channel === 'INTEGRATION' && !explicitRequired) requiredArtifacts = ['Work Item Scope', 'Diff Audit', 'F4 Evidence'];
  if (explicitRequired && !approval) blockers.push(work.pendingApprovalPresentedId === work.pendingApprovalId ? '等待当前 pending 用户确认' : '先运行 handoff 展示当前 pending');
  if (decisionRequired) blockers.push('USER_INPUT_REQUIRED：先澄清选择并更新 Work Item 或权威工件');
  if (channel === 'RELEASE' && !work.releaseWorkItem) blockers.push('A6 必须使用独立发布 Work Item');
  if (['EXTERNAL', 'RELEASE'].includes(channel)) blockers.push('自动化不得执行外部动作或发布');
  const nextState = work.globalState === 'REVIEW' && level === 'A1' ? 'VALIDATING'
    : work.globalState === 'REVIEW' && ['A2', 'A3'].includes(level) ? 'IMPLEMENTING'
      : work.globalState === 'PASSED' && ['A1', 'A2'].includes(level) ? 'COMPLETE'
        : (TRANSITIONS[work.globalState] ?? [])[0] ?? null;
  return { channel: `${channel}(${level})`, actionLevel: level, authorizationBasis: explicitRequired ? 'EXPLICIT_APPROVAL' : 'TASK_SCOPE', userInputRequired: decisionRequired, explicitApprovalRequired: explicitRequired, nextLegalState: decisionRequired ? null : nextState, requiredArtifacts, blockers };
}

/** 输出自动推导的风险通道和下一条安全命令，不执行任何动作。 */
function route(args) {
  if (bypassOutsideCocos(args)) return;
  const requestedType = String(args['action-type'] ?? '');
  if (requestedType) validateCocosAction(requestedType, args['action-level'] ? String(args['action-level']) : null, 'route actionType');
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(args['work-item'], 'Work Item')); if (work.globalState !== 'RETURN') visualStageGate(work, { command: 'route', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo }); // RETURN 只表示进入恢复路径；允许 route 展示恢复出口，不让失效的前进证据阻塞回到 BASELINE/PROPOSAL。
  if (requestedType && requestedType !== work.pendingApprovalActionType) fail('route 显式 Cocos 动作必须匹配 Work Item 当前动作');
  const ledger = validationContext.readLedger(args.ledger);
  const approval = effectiveApproval(work, ledger);
  const result = deriveRoute(work, approval);
  let nextCommand;
  if (work.globalState === 'RETURN') { result.blockers.push('已进入必要回退恢复路径；请选择最早受影响的前序状态并显式迁移'); nextCommand = `node <skill-dir>/scripts/workflow-control.mjs transition --work-item ${args['work-item']} --to ${result.nextLegalState ?? 'BASELINE'}`; }
  else if (result.userInputRequired) nextCommand = '向用户提出一个精确选择问题；记录 USER_DECISION，更新 Work Item/权威工件并清除未决标志';
  else if (result.explicitApprovalRequired && !approval) nextCommand = work.pendingApprovalPresentedId === work.pendingApprovalId ? `node <skill-dir>/scripts/workflow-control.mjs approve --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --approval-id <id> --user-text "批准"` : `node <skill-dir>/scripts/workflow-control.mjs handoff --work-item ${args['work-item']}`;
  else if (work.globalState === 'REVIEW' && result.actionLevel === 'A3') {
    result.blockers.push('A3 进入 IMPLEMENTING 需要严格 Implementation Package');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --implementation-package <package>`;
  } else if ((work.globalState === 'REVIEW' && result.actionLevel === 'A1') || (work.globalState === 'IMPLEMENTING' && ['A2', 'A3'].includes(result.actionLevel))) {
    if (!work.diffAuditRecord) { result.blockers.push('缺少当前候选 Diff/Artifact Audit'); nextCommand = `node <skill-dir>/scripts/workflow-control.mjs diff-audit --work-item ${args['work-item']}${result.actionLevel === 'A3' ? ' --implementation-package <package>' : ''} --record <record> ...`; }
    else nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}`;
  } else if (work.globalState === 'VALIDATING') {
    result.blockers.push('需要当前批次 Evidence Manifest');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --evidence <evidence>`;
  } else if (work.globalState === 'PASSED' && ['A1', 'A2', 'A3'].includes(result.actionLevel)) {
    result.blockers.push('COMPLETE 仍需当前 Evidence Manifest');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --evidence <evidence>`;
  } else if (work.globalState === 'PASSED') {
    if (result.actionLevel === 'A4' && !result.explicitApprovalRequired) {
      nextCommand = `node <skill-dir>/scripts/workflow-control.mjs transition --work-item ${args['work-item']} --to INTEGRATING`;
    } else {
      result.blockers.push('生产候选需要新的 A4/F4 集成审批点');
      nextCommand = `node <skill-dir>/scripts/workflow-control.mjs prepare-approval --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --action-level A4 --gate F4 ...`;
    }
  } else nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}`;
  process.stdout.write(JSON.stringify({ workItemId: work.workItemId, globalState: work.globalState, ...result, returnRecord: work.returnRecord ?? null, actionType: work.pendingApprovalActionType, nextCommand }, null, 2));
}
/** 阻断影响当前模块且尚未形成用户决定的 Change Request。 */
/** 执行写入或副作用前的统一预检。 */
function preflight(args) {
  if (bypassOutsideCocos(args)) return;
  const actionType = String(args['action-type'] ?? '');
  const level = String(args['action-level'] ?? '');
  validateCocosAction(actionType, level, 'preflight actionType');
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validationContext.validateWorkItem(args['work-item']);
  requireResolvedUserInput(work, fail);
  if (!LEVELS.includes(level) || !workAllowsLevel(work, level)) fail('动作 A 等级无效或不在 Work Item 动作/显式批准通道');
  if (!work.allowedActions.includes(actionType)) fail('动作类型未列入 Work Item.allowedActions');
  if (work.prohibitedActions.includes(actionType)) fail(`动作命中 prohibitedActions：${actionType}`);
  // 先执行视觉硬门，避免正式入口被普通等级/包校验的错误顺序遮蔽而形成旁路。
  visualStageGate({ ...work, actionLevel: level }, { command: 'preflight', actionLevel: level, projectRoot: repo });
  const paths = checkPaths(list(args.path), work.allowedPaths, work.forbiddenPaths, repo);
  if (level !== 'A0' && paths.length === 0 && !['A5', 'A6'].includes(level)) fail('本地动作必须声明至少一个 --path');
  const targets = list(args['external-target']);
  const flags = declaredOperationFlags(work, args);
  const requestedFlags = requestedOperationFlags(args);
  validateActionState(work, level, flags, fail);
  if (['A5', 'A6'].includes(level) && targets.length === 0) fail('A5/A6 动作必须声明精确 --external-target');
  if (targets.some((target) => work.protectedExternalTargets.includes(target) || !work.allowedExternalTargets.includes(target))) fail('外部目标受保护或未列入 Work Item.allowedExternalTargets');
  const explicitRequired = requiresExplicitApproval(level, flags);
  const ledger = explicitRequired ? validationContext.readLedger(args.ledger, { required: true }) : null;
  let pkg = null;
  if (['A3', 'A4'].includes(level)) {
    const packageValue = validationContext.readJson(args['implementation-package'], 'Implementation Package');
    pkg = validationContext.validateImplementationPackage(packageValue, work);
    if (level === 'A3' && pkg.expectedDeletedFiles.length) fail('A3 不得删除旧实现；删除或正式替换必须升级到 A4/A6');
  }
  validateChangeRequestRules(work, repo, level, ledger, pkg, { readJson, resolve, validateChangeRequest }, fail);
  let processEvidence = null;
  if (args['start-process'] === true) {
    processEvidence = validationContext.readJson(args['process-evidence'], '进程查重证据');
    requireFields(processEvidence, ['projectRoot', 'serviceType', 'mode', 'port', 'checkedPids', 'healthStatus', 'existingHealthy', 'reusePlanned'], '进程查重证据');
    if (processEvidence.existingHealthy && !processEvidence.reusePlanned) fail('存在健康实例时必须复用，不能启动新进程');
    if (resolve(processEvidence.projectRoot) !== repo || !['local', 'test', 'development'].includes(processEvidence.mode) || processEvidence.externalWrite === true || processEvidence.privileged === true) fail('仅本项目、非特权、无外部写入的本地验证服务可直接启动');
  }
  if (ledger) {
    // Work Item 冻结声明决定是否需要审批，命令参数仍需逐项重申，避免省略 release/destructive 等字段而消费更宽批准。
    const approvals = matchingApprovals(work, ledger, { approvalId: work.approvalRecord, level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? ''), actionType, paths, targets, ...requestedFlags, serviceStart: args['start-process'] === true, serviceType: processEvidence?.serviceType });
    if (approvals.length !== 1) fail('没有唯一且与当前对象、基线、模块、路径、动作等级和副作用精确匹配的审批');
  }
  const output = { ok: true, command: 'preflight', controlled: true, workItemId: work.workItemId, state: work.globalState, level, actionType, authorizationBasis: explicitRequired ? 'EXPLICIT_APPROVAL' : 'TASK_SCOPE', explicitApprovalRequired: explicitRequired, paths, targets };
  if (args.record) writeJson(args.record, output);
  process.stdout.write(JSON.stringify(output, null, 2));
}
/** 由控制面创建新的单次审批点，并让上一审批记录退出当前审批位置。 */
function prepareApproval(args) {
  const requestedActionType = String(args['action-type'] ?? '');
  const requestedLevel = String(args['action-level'] ?? '');
  validateCocosAction(requestedActionType, requestedLevel, 'prepare-approval actionType');
  const workPath = resolve(String(args['work-item']));
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  // 在事务提交前使用副本，避免校验失败时污染命令级缓存中的已提交 Work Item。
  const work = structuredClone(validationContext.validateWorkItem(workPath));
  const pendingId = String(args['pending-id'] ?? '');
  const object = String(args.object ?? '');
  const stage = String(args.stage ?? '');
  const level = requestedLevel;
  const gate = String(args.gate ?? '');
  const context = String(args.context ?? '');
  const actionType = requestedActionType;
  const impactSummary = list(args.impact);
  let fileScope = list(args.path);
  const services = list(args.service);
  const externalTargets = list(args['external-target']);
  const flags = { allowServiceStart: args['allow-service-start'] === true, allowDelete: args['allow-delete'] === true, externalWrite: args['external-write'] === true, destructive: args.destructive === true, physicalDevice: args.device === true, release: args.release === true };
  const allowed = {
    PASSED: { levels: ['A4'], gates: ['F4'] },
    INTEGRATING: { levels: ['A5', 'A6'], gates: ['F4'] },
    RELEASE_APPROVAL_REQUIRED: { levels: ['A6'], gates: ['F4'] }
  }[work.globalState];
  if (!allowed || !allowed.levels.includes(level) || !allowed.gates.includes(gate)) fail(`不能在 ${work.globalState} 准备 ${level}/${gate} 审批点`);
  if (!requiresExplicitApproval(level, { external: flags.externalWrite, device: flags.physicalDevice, release: flags.release, destructive: flags.destructive })) fail('当前操作没有需要人工批准的具体副作用，不应创建 A4-A6 审批点');
  // 审批记录只在真正需要时创建；普通 Work Item 初始化和本地流程无需预置空账本。
  // prepare 允许账本路径尚不存在，approve 会在确认时以 CAS 方式创建它。
  const ledgerPath = args.ledger && args.ledger !== true ? resolve(repo, String(args.ledger)) : null;
  const ledger = ledgerPath && existsSync(ledgerPath) ? validationContext.readLedger(ledgerPath) : { schemaVersion: '1.0', approvals: [] };
  if (!impactSummary.length) fail('操作审批必须用至少一个 --impact 冻结明确影响');
  if (!pendingId || !object || !context || stage !== work.stageId) fail('新审批点必须提供唯一 ID、明确对象、当前阶段与上下文');
  if (!workAllowsLevel(work, level) || !work.allowedActions.includes(actionType)) fail('新审批点动作类型或 A 等级未获 Work Item 授权');
  if (['A1', 'A2', 'A3', 'A4'].includes(level) && !fileScope.length) fail('本地审批点必须冻结至少一个精确 --path');
  if (['A5', 'A6'].includes(level) && !externalTargets.length) fail('外部或高风险审批点必须冻结精确外部目标');
  if (fileScope.length) fileScope = checkPaths(fileScope, work.allowedPaths, work.forbiddenPaths, repo);
  if (externalTargets.some((target) => !work.allowedExternalTargets.includes(target) || work.protectedExternalTargets.includes(target))) fail('审批点包含未授权或受保护外部对象');
  if (flags.allowServiceStart && !services.length) fail('允许启动服务时必须冻结具体 services');
  if (flags.allowDelete && !['A4', 'A6'].includes(level)) fail('删除旧实现只能由 A4/A6 审批点授权');
  if (flags.externalWrite && !['A5', 'A6'].includes(level)) fail('外部写入审批点至少为 A5');
  if ((flags.physicalDevice || flags.release) && level !== 'A6') fail('真机或发布审批点必须为 A6');
  if (flags.destructive && !['A4', 'A6'].includes(level)) fail('破坏性审批点必须为 A4/A6');
  if (ledger.approvals.some((approval) => approval.promptContextId === pendingId) || pendingId === work.pendingApprovalId) fail('pendingApprovalId 已使用，审批点必须轮换');
  if (work.globalState === 'RELEASE_APPROVAL_REQUIRED' && !work.releaseWorkItem) fail('发布审批点必须属于独立发布 Work Item');
  const implementationPackage = args['implementation-package'] ? validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work) : null;
  const visualGate = visualStageGate({ ...work, actionLevel: level }, { command: 'prepare-approval', actionLevel: level, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo, implementationPackage });
  if (visualGate.required && level !== 'A4') fail('正式可见视觉集成必须使用 A4/F4，不得以其他等级替代');
  work.previousApprovalRecord = work.approvalRecord;
  work.pendingApprovalId = pendingId;
  work.pendingApprovalObject = object;
  work.pendingApprovalStage = stage;
  work.pendingApprovalActionLevel = level;
  work.pendingApprovalGate = gate;
  work.pendingApprovalState = work.globalState;
  work.pendingApprovalContext = context;
  work.pendingApprovalActionType = actionType;
  work.pendingApprovalImpactSummary = impactSummary;
  work.pendingApprovalFileScope = fileScope;
  work.pendingApprovalServices = services;
  work.pendingApprovalAllowServiceStart = flags.allowServiceStart;
  work.pendingApprovalAllowDelete = flags.allowDelete;
  work.pendingApprovalExternalWrite = flags.externalWrite;
  work.pendingApprovalDestructive = flags.destructive;
  work.pendingApprovalPhysicalDevice = flags.physicalDevice;
  work.pendingApprovalRelease = flags.release;
  work.pendingApprovalExternalTargets = externalTargets;
  work.pendingApprovalPreparedAt = new Date().toISOString();
  work.pendingApprovalPresentedId = null;
  work.pendingApprovalPresentedAt = null;
  if (visualGate.required) {
    // 快照写入 pending 只用于失效检测；不写入或改写 Approval Ledger 历史。
    work.pendingVisualPrerequisiteSnapshot = visualGate.snapshot;
    work.pendingApprovalStatus = 'pending';
  }
  work.nextGate = gate;
  work.approvalRecord = null; work.pendingApprovalStatus = 'pending';
  // 先在内存中验证完整 pending，失败时不得把下次无法读取的半成品写回磁盘。
  validateWorkItem(work);
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'prepare-approval', workItemId: work.workItemId, pendingApprovalId: pendingId, object, stage, actionType, actionLevel: level, impactSummary, gate, state: work.globalState, context, fileScope, services, externalTargets, ...flags }, null, 2));
}
/** 追加审批，且所有原文只能绑定当前已展示 pending approval。 */
function approve(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const workPath = resolve(String(args['work-item']));
  if (!args.ledger || args.ledger === true) fail('缺少 Approval Ledger 路径');
  const ledgerPath = resolve(String(args.ledger));
  // Work Item 与 Ledger 必须从同一次字节读取捕获身份，提交时 CAS 才能识别审批读取期间的并发变化。
  const workSnapshot = readJsonWithIdentity(workPath, 'Work Item');
  const work = validateWorkItem(workSnapshot.value);
  visualStageGate(work, { command: 'approve', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo });
  if (!['A4', 'A5', 'A6'].includes(work.pendingApprovalActionLevel)) fail('approve 仅接受 A4-A6 具体操作审批');
  if (!requiresExplicitApproval(work.pendingApprovalActionLevel, declaredOperationFlags(work))) fail('当前 pending 没有需要人工批准的具体副作用');
  const ledgerSnapshot = existsSync(ledgerPath)
    ? readJsonWithIdentity(ledgerPath, 'Approval Ledger')
    : { value: { schemaVersion: '1.0', approvals: [] }, identity: captureJsonIdentity(ledgerPath) };
  const ledger = readLedger(ledgerPath, ledgerSnapshot.value);
  if (work.approvalRecord !== null) fail('当前 pending approval 已批准，不得重复批准');
  // 无 record 时，记录完全从当前已冻结 pending 生成，调用者不能借短回复扩权。
  const generated = args.record ? null : {
    approvalId: args['approval-id'], userOriginalText: args['user-text'], approvedAt: new Date().toISOString(),
    invalidatedWhen: ['pending 轮换', '对象、阶段、范围或基线变化'], ...approvalSnapshotFromWork(work),
  };
  if (!args.record && (!args['approval-id'] || !args['user-text'])) fail('自动审批记录需要 --approval-id 与 --user-text');
  if (!args.record && (NEGATIVE_APPROVAL.test(String(args['user-text']).trim()) || (!SHORT_APPROVAL.test(String(args['user-text']).trim()) && !AFFIRMATIVE_APPROVAL.test(String(args['user-text']).trim())))) fail('自动审批原文必须是无否定冲突的当前 pending 肯定确认');
  const approval = validateApproval(args.record ? validationContext.readJson(args.record, '审批记录') : generated);
  if (ledger.approvals.some((item) => item.approvalId === approval.approvalId)) fail(`approvalId 已存在：${approval.approvalId}`);
  if (work.pendingApprovalPresentedId !== work.pendingApprovalId || !work.pendingApprovalPresentedAt) fail('当前 pending approval 尚未由 handoff 展示，不能批准');
  if (!approvalMatchesPending(approval, work)) fail('审批只能绑定当前已展示 pending approval，不得扩写对象、等级、阶段或下一门');
  if (ledger.approvals.some((item) => approvalMatchesPending(item, work))) fail('当前 pending approval 已存在有效审批记录，不得重复批准');
  if (SHORT_APPROVAL.test(approval.userOriginalText.trim()) && approval.promptContextId !== work.pendingApprovalPresentedId) fail('短回复只能确认当前最近展示的 pending approval');
  if (approval.externalWrite && !['A5', 'A6'].includes(approval.actionLevel)) fail('外部状态审批至少为 A5');
  if (approval.allowDelete && !['A4', 'A6'].includes(approval.actionLevel)) fail('删除旧实现审批必须为 A4/A6');
  if ((approval.physicalDevice || approval.release) && approval.actionLevel !== 'A6') fail('真机或发布审批必须为 A6');
  if (approval.destructive && !['A4', 'A6'].includes(approval.actionLevel)) fail('破坏性审批必须为 A4/A6');
  ledger.approvals.push(approval);
  work.approvalRecord = approval.approvalId;
  const journalPath = transactionJournalPathForLedger(ledgerPath, work.workItemId, workPath);
  // 先提交 Work Item，再提交 Ledger；事务日志保证进程中断后读取任一文件都能补齐另一份。
  writeJsonTransaction([{ path: workPath, value: work, expected: workSnapshot.identity }, { path: ledgerPath, value: ledger, expected: ledgerSnapshot.identity }], journalPath);
  process.stdout.write(JSON.stringify({ ok: true, approvalId: approval.approvalId, promptContextId: approval.promptContextId }, null, 2));
}
/** 校验委派继承 Work Item 范围、状态、禁止范围和代理登记。 */
function validateDelegationForWork(delegation, work, repo) {
  if (delegation.workItemId !== work.workItemId || delegation.stageId !== work.stageId) fail('委派包工作项或阶段不匹配');
  validateActionState(work, delegation.actionLevel, {}, fail);
  if (!workAllowsLevel(work, delegation.actionLevel) || delegation.allowedActions.some((action) => !work.allowedActions.includes(action))) fail('委派动作不是 Work Item 允许动作子集');
  if (work.prohibitedActions.some((action) => !delegation.forbiddenActions.includes(action))) fail('委派 forbiddenActions 未继承 Work Item.prohibitedActions');
  if (work.forbiddenPaths.some((path) => !delegation.forbiddenPaths.includes(path))) fail('委派 forbiddenPaths 未继承 Work Item.forbiddenPaths');
  if (!work.delegatedAgents.includes(delegation.assignedAgent)) fail('委派 assignedAgent 未登记在 Work Item.delegatedAgents');
  checkPaths(delegation.ownership, work.allowedPaths, work.forbiddenPaths, repo);
  checkPaths(delegation.allowedPaths, work.allowedPaths, work.forbiddenPaths, repo);
  const protectedResolutionRoot = '.workflow-control/user-resolutions';
  if ([...delegation.ownership, ...delegation.allowedPaths].some((path) => String(path).replaceAll('\\', '/').replace(/\/$/, '') === protectedResolutionRoot || String(path).replaceAll('\\', '/').startsWith(`${protectedResolutionRoot}/`))) fail('实施代理和委派单元不得创建或修改 user-resolution-ledger');
}
/** 组装实施单元证据模块所需的只读能力。 */
function unitIo(repo = null) {
  return { git, fileHash, hashText, resolve, existsSync, readdirSync, readFileSync, normalizeRepoPath, writeJson, repo };
}

/** 创建 workflow-control 命令使用的统一只读上下文，避免同一命令重复加载包和视觉清单。 */
function commandValidationContext(repo) {
  return createValidationContext(repo, { validateWorkItem, readJson, readLedger, loadVisualManifestSnapshot, validateImplementationPackage, visualConfirmationAuthority });
}

/** 验证串行委派；并行 A3 必须转入原子批次命令。 */
function delegateCheck(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(args['work-item'], 'Work Item'));
  requireResolvedUserInput(work, fail);
  const delegation = validateDelegation(validationContext.readJson(args.delegation, 'Delegation Package'));
  validateDelegationForWork(delegation, work, repo);
  if (delegation.actionLevel === 'A3') {
    const pkg = validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work, [delegation]);
    if (delegation.parallelGroup !== null) fail('并行 A3 委派不得单独 delegate-check；请使用 parallel-check 原子校验完整批次');
    const binding = validateDelegationBinding(delegation, pkg, pathMatches, fail);
    const visualErrors = validateVisualDelegationBinding(delegation, pkg);
    if (visualErrors.length) fail(visualErrors[0]);
    for (const unit of binding.units) {
      try { assertUnitReady(unit, work, pkg, repo, unitIo(repo)); } catch (error) { fail(error.message); }
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, command: 'delegate-check', assignedAgent: delegation.assignedAgent }, null, 2));
}
/** 校验一个实施单元的当前完成证据。 */
function unitCheck(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(args['work-item'], 'Work Item')); requireResolvedUserInput(work, fail); validateActionState(work, 'A3', {}, fail);
  const pkg = validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work);
  const resultPath = resolve(String(args.result));
  const result = validationContext.readJson(resultPath, 'Execution Unit Result');
  const unit = pkg.executionUnits.find((item) => item.unitId === result.unitId);
  if (!unit) fail(`Execution Unit Result 引用未知单元：${result.unitId}`);
  visualStageGate({ ...work, implementationPackage: pkg }, { command: 'unit-check', actionLevel: work.pendingApprovalActionLevel, projectRoot: repo, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot });
  try {
    const updated = validateAndCompleteExecutionUnit(result, resultPath, work, pkg, unit, repo, unitIo(repo));
    process.stdout.write(JSON.stringify({ ok: true, command: 'unit-check', unitId: unit.unitId, resultId: result.resultId, executionState: executionStateSummary(work, updated.state) }, null, 2));
  } catch (error) { fail(error.message); }
}
/** 原子校验同一并行组的完整 A3 委派批次。 */
function parallelCheck(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(args['work-item'], 'Work Item'));
  requireResolvedUserInput(work, fail);
  const batchPath = resolve(String(args.batch));
  const batchValue = validationContext.readJson(batchPath, 'Parallel Delegation Batch');
  const delegations = Array.isArray(batchValue.delegationFiles) ? batchValue.delegationFiles.map((path) => validationContext.readJson(resolve(repo, path), 'Delegation Package')) : [];
  const pkg = validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work, delegations);
  const io = { readJson: validationContext.readJson.bind(validationContext), resolve, normalizeRepoPath, existsSync, readdirSync, readFileSync, validateDelegation, validateDelegationForWork, validateDelegationBinding: (delegation, value) => validateDelegationBinding(delegation, value, pathMatches, fail), assertUnitReady: (unit, currentWork, value, currentRepo) => assertUnitReady(unit, currentWork, value, currentRepo, unitIo(currentRepo)) };
  let result; try { result = validateParallelBatch(batchValue, batchPath, work, pkg, repo, io); } catch (error) { fail(error.message); }
  process.stdout.write(JSON.stringify({ ok: true, command: 'parallel-check', ...result }, null, 2));
}

/** 调用 Git 只读命令并返回文本。 */
function git(repo, args) {
  try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { fail(`Git 审计失败：${error.stderr?.trim() || error.message}`); }
}

/** 收集真实 Git diff 状态，包括未跟踪文件和删除。 */
function changedEntries(repo, baseline) {
  const entries = [];
  for (const line of git(repo, ['diff', '--name-status', '--find-renames', baseline, '--']).split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    entries.push({ status: parts[0][0], file: (parts.at(-1) ?? '').replaceAll('\\', '/') });
  }
  for (const line of git(repo, ['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/).filter((item) => item.startsWith('?? '))) entries.push({ status: 'A', file: line.slice(3).replaceAll('\\', '/') });
  return [...new Map(entries.map((entry) => [entry.file, entry])).values()].sort((a, b) => a.file.localeCompare(b.file));
}

/** 计算候选 diff 指纹，包含未跟踪文件字节。 */
function diffFingerprint(repo, baseline, entries) {
  const hash = createHash('sha256');
  const files = entries.map((entry) => entry.file);
  if (files.length) hash.update(git(repo, ['diff', '--binary', baseline, '--', ...files]));
  const tracked = new Set(git(repo, ['ls-files']).split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll('\\', '/')));
  for (const file of files) if (existsSync(resolve(repo, file)) && !tracked.has(file)) hash.update(readFileSync(resolve(repo, file)));
  return `sha256:${hash.digest('hex')}`;
}

/** 读取实际工件并生成可复算的路径/哈希记录。 */
function artifactRecords(repo, paths, work, externalReceipt = false) {
  const normalized = externalReceipt ? paths.map((path) => normalizeRepoPath(repo, path)) : checkPaths(paths, work.allowedPaths, work.forbiddenPaths, repo);
  if (externalReceipt) {
    const evidenceRoot = resolve(repo, work.evidenceRoot);
    for (const file of normalized) {
      if (work.forbiddenPaths.some((pattern) => pathMatches(file, pattern))) fail(`回执工件命中 forbiddenPaths：${file}`);
      if (relative(evidenceRoot, resolve(repo, file)).startsWith('..')) fail(`A5/A6 回执工件必须位于 evidenceRoot：${file}`);
    }
  }
  return normalized.map((file) => {
    const target = resolve(repo, file);
    if (!existsSync(target)) fail(`审计工件不存在：${file}`);
    return { file, hash: fileHash(target) };
  });
}

/** 对真实 diff 执行审批、模块、删除、所有权、路径和基线审计。 */
function diffAudit(args) {
  const workPath = resolve(String(args['work-item']));
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(workPath, 'Work Item'));
  requireResolvedUserInput(work, fail);
  // 基线引用用于确定本次 Git diff 范围；后续验收按 Work Item 基线复核真实路径，不比较摘要文本。
  const baseline = String(args.baseline ?? work.baselineId);
  const level = String(args['action-level'] ?? work.pendingApprovalActionLevel);
  const actionType = String(args['action-type'] ?? work.pendingApprovalActionType);
  validateCocosAction(actionType, level, 'diff-audit actionType');
  if (actionType !== work.pendingApprovalActionType) fail('diff-audit actionType 与 Work Item 当前动作不一致');
  const explicitRequired = requiresExplicitApproval(level, declaredOperationFlags(work, args));
  const ledger = explicitRequired ? validationContext.readLedger(args.ledger, { required: true }) : null;
  const pkg = ['A3', 'A4'].includes(level) ? validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work) : null;
  const entries = changedEntries(repo, baseline).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  const artifacts = entries.length ? [] : artifactRecords(repo, list(args.artifact), work, ['A5', 'A6'].includes(level));
  if (!entries.length && ['A3', 'A4'].includes(level)) fail('A3/A4 生产或集成审计禁止空 diff');
  if (!entries.length && !['A1', 'A2', 'A5', 'A6'].includes(level)) fail('当前等级不允许 artifact-only 审计');
  if (!entries.length && !artifacts.length) fail('无 Git diff 时必须提供至少一个真实 --artifact');
  if (entries.length) checkPaths(entries.map((entry) => entry.file), work.allowedPaths, work.forbiddenPaths, repo);
  if (level === 'A3' && entries.some((entry) => entry.status === 'D')) fail('A3 不得删除旧实现；删除或正式替换必须升级到 A4/A6');
  const mapping = [];
  for (const entry of entries) {
    let executionUnit = null;
    if (pkg) {
      const ownership = Object.entries(pkg.fileOwnership).filter(([pattern]) => pathMatches(entry.file, pattern));
      if (ownership.length === 0) fail(`diff 文件未归属 Implementation Package.fileOwnership：${entry.file}`);
      if (ownership.length > 1) fail(`diff 文件所有权重叠：${entry.file}`);
      if (entry.status === 'A' && !pkg.expectedAddedFiles.includes(entry.file)) fail(`新增文件不在 Implementation Package.expectedAddedFiles：${entry.file}`);
      const units = pkg.executionUnits.filter((unit) => unit.ownedPaths.some((pattern) => pathMatches(entry.file, pattern)));
      if (units.length !== 1) fail(`diff 文件未唯一归属 execution unit：${entry.file}`);
      executionUnit = units[0];
    }
    const candidates = ledger ? matchingApprovals(work, ledger, { level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? work.pendingApprovalObject), actionType, paths: [entry.file], targets: [] }) : [];
    if (ledger && candidates.length === 0) fail(`未归属或未审批 diff：${entry.file}`);
    if (ledger && candidates.length > 1) fail(`审批范围重叠：${entry.file}`);
    const approval = candidates[0] ?? null;
    if (approval && approval.approvalId !== work.approvalRecord) fail(`diff 未由 Work Item.approvalRecord 覆盖：${entry.file}`);
    if (entry.status === 'D' && approval && !approval.allowDelete) fail(`未批准删除：${entry.file}`);
    if (entry.status === 'D' && pkg && !pkg.expectedDeletedFiles.includes(entry.file)) fail(`删除不在 Implementation Package.expectedDeletedFiles：${entry.file}`);
    // 显示层实施单元不能只落到宿主 Scene 身份，否则 diff 审计会把多个弹窗/抽屉混成同一个对象。
    const approvalBinding = approval ? { approvalId: approval.approvalId, authorizationBasis: 'EXPLICIT_APPROVAL' } : { authorizationBasis: 'TASK_SCOPE' };
    mapping.push({ ...entry, workItemId: work.workItemId, executionUnitId: executionUnit?.unitId ?? null, moduleId: executionUnit?.moduleId ?? null, sceneId: executionUnit?.sceneId ?? null, displayLayerId: executionUnit?.displayLayerId ?? null, hostSceneId: executionUnit?.hostSceneId ?? null, domain: work.domain, stageId: work.stageId, actionLevel: level, ...approvalBinding, owner: executionUnit?.owner ?? work.assignedAgent });
  }
  if (!entries.length) {
    if (ledger) {
      const candidates = matchingApprovals(work, ledger, { level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? work.pendingApprovalObject), actionType, paths: ['A1', 'A2'].includes(level) ? artifacts.map((item) => item.file) : [], targets: list(args['external-target']) });
      if (candidates.length !== 1 || candidates[0].approvalId !== work.approvalRecord) fail('artifact-only 审计缺少当前精确审批或审批范围重叠');
    }
  }
  const fingerprint = entries.length ? diffFingerprint(repo, baseline, entries) : artifactFingerprint(artifacts);
  const record = { recordType: 'DIFF_AUDIT', workItemId: work.workItemId, baselineId: baseline, baselineHash: work.baselineHash, diffFingerprint: fingerprint, actionLevel: level, authorizationBasis: explicitRequired ? 'EXPLICIT_APPROVAL' : 'TASK_SCOPE', ...(explicitRequired ? { approvalId: work.approvalRecord } : {}), recordedAt: new Date().toISOString(), entries: mapping, artifacts, verdict: 'PASS' };
  if (!args.record) fail('diff-audit 必须使用 --record 保存可验证记录');
  writeJson(args.record, record);
  work.diffAuditRecord = normalizeRepoPath(repo, args.record);
  work.diffAuditLedgerRecord = ledger ? normalizeRepoPath(repo, args.ledger) : null;
  if (pkg) work.implementationPackageRecord = normalizeRepoPath(repo, args['implementation-package']);
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'diff-audit', ...record }, null, 2));
}

/** 按当前真实变更路径复核审计记录；摘要只作记录，不决定验收是否有效。 */
function verifyDiffAudit(work, repo, path, validationContext = null) {
  if (!path) fail('缺少 Diff Audit Record 路径');
  const read = validationContext?.readJson?.bind(validationContext) ?? readJson;
  const record = read(resolve(repo, path), 'Diff Audit Record');
  requireFields(record, ['recordType', 'workItemId', 'actionLevel', 'authorizationBasis', 'recordedAt', 'entries', 'artifacts', 'verdict'], 'Diff Audit Record');
  // 记录中的 baselineId 只是追踪信息；实际变更始终按当前 Work Item 的基线重算。
  if (record.recordType !== 'DIFF_AUDIT' || record.verdict !== 'PASS' || record.workItemId !== work.workItemId || !LEVELS.includes(record.actionLevel) || Number.isNaN(Date.parse(record.recordedAt)) || !Array.isArray(record.entries) || !Array.isArray(record.artifacts)) fail('Diff Audit Record 绑定不一致');
  if (record.authorizationBasis === 'EXPLICIT_APPROVAL') {
    if (!record.approvalId || record.approvalId !== work.approvalRecord) fail('Diff Audit Record 显式审批审计未绑定当前 approvalId');
    if (!work.diffAuditLedgerRecord) fail('显式审批审计缺少 Approval Ledger 绑定');
    const approval = (validationContext?.readLedger?.(resolve(repo, work.diffAuditLedgerRecord)) ?? readLedger(resolve(repo, work.diffAuditLedgerRecord))).approvals.find((item) => item.approvalId === record.approvalId && !item.invalidatedAt && !item.legacyReadOnly);
    if (!approval || approval.workItemId !== work.workItemId || JSON.stringify(approval.moduleIds) !== JSON.stringify(work.moduleIds) || approval.actionLevel !== record.actionLevel) fail('Diff Audit Record 审批已失效或绑定不一致');
  } else if (record.authorizationBasis !== 'TASK_SCOPE' || record.approvalId !== undefined || requiresExplicitApproval(record.actionLevel, declaredOperationFlags(work)) || userInputRequired(work)) fail('Diff Audit Record Work Item 范围绑定无效或存在未决用户选择');
  const entries = changedEntries(repo, work.baselineId).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  if (!entries.length && !record.artifacts.length) fail('Diff Audit Record 缺少真实变更或 artifact-only 证据');
  if (!entries.length && record.artifacts.length) {
    const artifactPaths = record.artifacts.map((item) => item?.file);
    if (artifactPaths.some((file) => typeof file !== 'string' || !file) || new Set(artifactPaths).size !== artifactPaths.length) fail('Diff Audit Record 工件路径无效');
    const externalReceipt = ['A5', 'A6'].includes(record.actionLevel);
    const normalized = externalReceipt ? artifactPaths.map((file) => normalizeRepoPath(repo, file)) : checkPaths(artifactPaths, work.allowedPaths, work.forbiddenPaths, repo);
    const evidenceRoot = resolve(repo, work.evidenceRoot);
    for (const file of normalized) {
      if (externalReceipt && (work.forbiddenPaths.some((pattern) => pathMatches(file, pattern)) || relative(evidenceRoot, resolve(repo, file)).startsWith('..'))) fail(`回执工件路径无效：${file}`);
      const target = resolve(repo, file);
      if (!existsSync(target)) fail(`审计工件不存在：${file}`);
      readFileSync(target);
    }
  } else if (record.artifacts.length) fail('Diff Audit Record 不得在存在 Git diff 时另附 artifact-only 工件');
  checkPaths(entries.map((entry) => entry.file), work.allowedPaths, work.forbiddenPaths, repo);
  if (record.entries.length !== entries.length) fail('Diff Audit Record.entries 与真实 diff 数量不一致');
  if (['A3', 'A4'].includes(record.actionLevel) && !work.implementationPackageRecord) fail('Diff Audit Record 缺少 Implementation Package 绑定');
  const packageValue = ['A3', 'A4'].includes(record.actionLevel) ? (validationContext?.readJson?.(resolve(repo, work.implementationPackageRecord), 'Implementation Package') ?? read(resolve(repo, work.implementationPackageRecord), 'Implementation Package')) : null;
  const packageManifest = packageValue && (isVisualProductionWork(work) || packageValue.visualProductionUnits !== undefined) ? (validationContext?.loadVisualManifestSnapshot?.(packageValue) ?? loadVisualManifestSnapshot(packageValue, repo)) : null;
  const packageAuthority = packageValue ? (validationContext?.authorityFor?.(packageValue, work) ?? visualConfirmationAuthority(work, packageManifest?.manifest, { projectRoot: repo, checkFiles: true, implementationPackage: packageValue })) : null;
  const pkg = packageValue ? (validationContext?.validateImplementationPackage?.(packageValue, work) ?? validateImplementationPackageShape(packageValue, { projectRoot: repo, checkFiles: true, authority: packageAuthority, deferVisualValidation: true })) : null;
  for (const entry of entries) {
    const mapped = record.entries.filter((item) => item.file === entry.file && item.status === entry.status);
    if (mapped.length !== 1) fail(`Diff Audit Record.entries 文件或 status 不一致：${entry.file}`);
    const item = mapped[0];
    if (item.workItemId !== work.workItemId || item.domain !== work.domain || item.stageId !== work.stageId || item.actionLevel !== record.actionLevel || (item.approvalId ?? null) !== (record.approvalId ?? null) || item.authorizationBasis !== record.authorizationBasis) fail(`Diff Audit Record.entries 归属映射不一致：${entry.file}`);
    if (pkg) {
      if (pkg.workItemId !== work.workItemId) fail('Diff Audit Record 的 Implementation Package 绑定不一致');
      const owners = Object.entries(pkg.fileOwnership).filter(([pattern]) => pathMatches(entry.file, pattern));
      const units = pkg.executionUnits.filter((unit) => unit.ownedPaths.some((pattern) => pathMatches(entry.file, pattern)));
      if (owners.length !== 1 || units.length !== 1 || item.owner !== owners[0][1] || item.executionUnitId !== units[0].unitId || item.moduleId !== units[0].moduleId || item.sceneId !== units[0].sceneId || item.displayLayerId !== (units[0].displayLayerId ?? null) || item.hostSceneId !== (units[0].hostSceneId ?? null)) fail(`Diff Audit Record.entries 单元/模块/场景/显示层/ownership 不一致：${entry.file}`);
    } else if (item.owner !== work.assignedAgent) fail(`Diff Audit Record.entries owner 不一致：${entry.file}`);
  }
  return record;
}

/** 验证证据目录、命令结果、批次身份和 F0-F3 门结果。 */
function evidenceCheck(args, silent = false, validationContextOverride = null) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = validationContextOverride ?? commandValidationContext(repo);
  const work = validationContext.validateWorkItem(args['work-item']);
  const evidence = validateEvidence(validationContext.readEvidence(args.evidence));
  const evidenceRoot = resolve(repo, work.evidenceRoot);
  if (relative(evidenceRoot, resolve(String(args.evidence))).startsWith('..')) fail('Evidence Manifest 目录与 evidenceRoot 不一致');
  if (evidence.workItemId !== work.workItemId || evidence.batchId !== work.validationBatchId) fail('证据绑定了旧工作项或旧批次');
  for (const file of evidence.files) {
    const target = resolve(repo, file);
    if (relative(evidenceRoot, target).startsWith('..')) fail(`证据文件不在 evidenceRoot：${file}`);
    if (!existsSync(target)) fail(`证据文件不存在：${file}`);
    // 文件摘要可能随中途编辑变化；验收继续检查引用路径真实存在且可读取。
    readFileSync(target);
  }
  for (const command of evidence.commands) {
    requireFields(command, ['command', 'exitCode', 'outputFile'], 'Evidence command');
    const output = resolve(repo, command.outputFile);
    if (relative(evidenceRoot, output).startsWith('..') || !existsSync(output) || command.exitCode !== 0) fail('命令结果工件不在证据目录、不存在或命令失败');
    readFileSync(output);
  }
  if (evidence.verdict !== 'PASS' || evidence.uncoveredItems.length) fail('证据不是完整 PASS，或仍有未覆盖项');
  const audit = verifyDiffAudit(work, repo, work.diffAuditRecord, validationContext);
  let visualPackage = null;
  let executionPackage = null;
  const packagePath = work.implementationPackageRecord ?? args['implementation-package'];
  if (audit.actionLevel === 'A3') {
    const implementationPackage = validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work);
    executionPackage = implementationPackage;
    if (isVisualProductionWork(work)) visualPackage = implementationPackage;
  } else if (isVisualProductionWork(work) && ['V3', 'V4'].includes(String(work.visualStage ?? '').toUpperCase())) {
    if (!packagePath) fail('V3/V4 视觉 Evidence 必须绑定 Implementation Package');
    visualPackage = validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work);
  }
  if (Date.parse(evidence.recordedAt) < Date.parse(audit.recordedAt)) fail('Evidence.recordedAt 早于当前 Diff Audit Record');
  const visualMachineValidation = isVisualProductionWork(work);
  for (const gate of EVIDENCE_GATES) {
    const result = evidence.gateResults[gate];
    const passed = result.status === 'PASS' || (gate === 'F2' && visualMachineValidation && result.status === 'passed');
    if (!passed) fail(`${gate} 未通过`);
  }
  const reviewer = evidence.gateResults.F2.reviewer;
  const reviewMode = evidence.gateResults.F2.reviewMode;
  const f0 = evidence.gateResults.F0;
  // Evidence 顶层已经绑定 Work Item；F0 可附带 TASK_SCOPE 或 workItemId，附带时必须一致。
  const f0MatchesWork = (f0.workItemId === undefined || f0.workItemId === work.workItemId)
    && (f0.authorizationBasis === undefined || f0.authorizationBasis === audit.authorizationBasis);
  // V2 拆解确认通过后，V3/V4 的视觉 F2 只消费机器验证事实；通用非视觉 F2 仍保留 reviewer/reviewMode 硬门。
  if (!f0MatchesWork || evidence.gateResults.F3.evidenceId !== evidence.evidenceId || (!visualMachineValidation && !reviewer)) fail('F0 范围、F2 审查或 F3 证据绑定不完整');
  let visualManifest = null;
  if (visualPackage) { const snapshot = validationContext.loadVisualManifestSnapshot(visualPackage); if (snapshot?.errors?.length) fail(snapshot.errors[0]); visualManifest = snapshot?.manifest ?? null; }
  // V4 可见单元必须逐条提交真实响应式运行证据；宿主场景通过不能替代独立 DISPLAY_LAYER 轨迹。
  if (isResponsiveWorkItem(work, executionPackage ?? visualPackage) && (String(work.visualStage ?? work.stageId).toUpperCase() === 'V4' || evidence.responsiveEvidence !== undefined || evidence.responsiveRuntimeEvidence !== undefined)) validateResponsiveEvidence(evidence, executionPackage ?? visualPackage ?? work, { stage: 'V4', requiredUnits: (executionPackage?.executionUnits ?? visualPackage?.executionUnits ?? []).filter((unit) => ['SCENE', 'DISPLAY_LAYER'].includes(unit?.unitType)) });
  visualStageGate({ ...work, implementationPackage: visualPackage, visualManifest }, { command: 'evidence-check', actionLevel: audit.actionLevel, projectRoot: repo, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, evidence });
  const visualEvidenceErrors = validateVisualEvidence(evidence, visualPackage, { manifest: visualManifest, projectRoot: repo, implementationPackage: visualPackage, authority: visualPackage ? validationContext.authorityFor(visualPackage, work) : null });
  if (visualEvidenceErrors.length) fail(visualEvidenceErrors[0]);
  if (!visualMachineValidation) {
    if (['A1', 'A2'].includes(audit.actionLevel)) {
    if (!['SELF', 'INDEPENDENT'].includes(reviewMode)) fail('A1/A2 F2 必须声明 SELF 或 INDEPENDENT reviewMode');
    if (reviewMode === 'SELF' && reviewer !== work.assignedAgent) fail('SELF reviewer 必须是 Work Item.assignedAgent');
    } else if (reviewMode !== 'INDEPENDENT' || reviewer === work.assignedAgent || work.delegatedAgents.includes(reviewer)) fail('A3-A6 F2 必须由独立 reviewer 审查');
  }
  // 先返回证据自身的精确错误，再执行任务完成状态硬门，避免状态缺口遮蔽 F0-F3 问题。
  if (audit.actionLevel === 'A3') {
    try { assertCompletedUnits(evidence, work, executionPackage, repo, unitIo(repo)); } catch (error) { fail(error.message); }
  }
  if (!silent) process.stdout.write(JSON.stringify({ ok: true, command: 'evidence-check', evidenceId: evidence.evidenceId, fingerprint: evidence.diffFingerprint }, null, 2));
  return evidence;
}

/** 在允许迁移图内改变状态，并执行各关键状态硬门。 */
function transition(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = args.validationContext ?? commandValidationContext(repo);
  const workPath = resolve(String(args['work-item']));
  // 在事务提交前使用副本，避免校验失败时污染命令级缓存中的已提交 Work Item。
  const workIdentity = captureJsonIdentity(workPath);
  let work = structuredClone(validationContext.validateWorkItem(workPath));
  const stateIdentity = captureJsonIdentity(resolve(repo, work.evidenceRoot, 'execution-state.json'));
  const stateWrites = [];
  // 先收集阶段状态和归档，全部守卫通过后与工作项一起提交，失败时不留下半切换状态。
  const stageIo = { ...unitIo(repo), writeJson: (path, value) => stateWrites.push({ path, value, expected: resolve(path) === stateIdentity.path ? stateIdentity : captureJsonIdentity(path) }) };
  const target = String(args.to ?? '');
  const hasVisualStageInput = args['visual-stage'] !== undefined || args['visual-stage-state'] !== undefined;
  const stageEntryAllowed = hasVisualStageInput && ((target === 'REVIEW' && ['REVIEW', 'PASSED'].includes(work.globalState)) || (target === 'IMPLEMENTING' && ['IMPLEMENTING', 'PASSED'].includes(work.globalState)));
  if (!(TRANSITIONS[work.globalState] ?? []).includes(target) && !stageEntryAllowed) fail(`禁止状态迁移：${work.globalState} → ${target}`);
  let stageTransitionPlan = null;
  if (args['visual-stage'] !== undefined || args['visual-stage-state'] !== undefined) {
    stageTransitionPlan = prepareSceneStageTransition({ work, target, args, repo, validationContext, unitIo: (currentRepo) => unitIo(currentRepo), validateWorkItem });
    work = stageTransitionPlan.nextWork;
  }
  const resumingReturn = work.globalState === 'RETURN' && target !== 'RETURN';
  const returnRequest = target === 'RETURN' ? parseReturnRequest(args, work) : null;
  if (returnRequest?.error) fail(returnRequest.error);
  if (returnRequest) {
    try { work.returnRecord = createReturnRecord(returnRequest, work); invalidateReturnArtifacts(work, work.returnRecord, { projectRoot: repo }); }
    catch (error) { fail(error.message); }
  }
  if (resumingReturn) {
    const resumeError = validateReturnResume(work, target, { projectRoot: repo });
    if (resumeError) fail(resumeError);
    work.globalState = target;
    work.pendingApprovalState = target;
    work.pendingApprovalContext = `return-recovery:${target}`;
    work.returnRecord.resolvedAt = new Date().toISOString();
  }
  if (!returnRequest && !resumingReturn) requireResolvedUserInput(work, fail);
  if (!returnRequest && !resumingReturn && !stageTransitionPlan) {
    const packagePath = args['implementation-package'] ?? (['A3', 'A4'].includes(work.pendingApprovalActionLevel) ? work.implementationPackageRecord : null);
    const implementationPackage = packagePath ? validationContext.validateImplementationPackage(validationContext.readJson(packagePath, 'Implementation Package'), work) : null;
    visualStageGate(work, {
      command: 'transition',
      actionLevel: work.pendingApprovalActionLevel,
      pendingSnapshot: work.pendingVisualPrerequisiteSnapshot,
      projectRoot: repo,
      evidence: args.evidence ? validationContext.readEvidence(args.evidence) : null,
      implementationPackage,
    });
  }
  let packageActivated = false;
  if (target === 'IMPLEMENTING') {
    const plan = prepareImplementationTransition({ work, args, repo, validationContext, stageTransitionPlan, stageIo, unitIo: (currentRepo) => unitIo(currentRepo), validateWorkItem, isVisualProductionWork, initializeExecutionState, normalizeRepoPath });
    work = plan.work;
    packageActivated = plan.packageActivated;
  }
  if (stageTransitionPlan?.updateExecutionState && !packageActivated) {
    // 先验证最终 Work Item 副本，再更新状态文件，避免阶段元数据单边切换。
    validateWorkItem({ ...work, globalState: target });
    updateExecutionStateStage(stageTransitionPlan.previousWork, work, stageTransitionPlan.previousPackage, repo, stageIo);
  }
  if (target === 'VALIDATING') {
    verifyDiffAudit(work, repo, work.diffAuditRecord, validationContext);
    if (work.pendingApprovalActionLevel === 'A3') {
      const packagePath = args['implementation-package'] ?? work.implementationPackageRecord; const pkg = validationContext.validateImplementationPackage(validationContext.readJson(packagePath, 'Implementation Package'), work);
      try { assertExecutionWorkflowComplete(work, pkg, repo, unitIo(repo)); } catch (error) { fail(error.message); }
    }
  }
  if (target === 'PASSED') evidenceCheck(args, true, validationContext);
  if (target === 'INTEGRATING') {
    const requiresIntegrationApproval = requiresExplicitApproval('A4', declaredOperationFlags(work, args));
    if (requiresIntegrationApproval && work.pendingApprovalState !== 'PASSED') fail('进入 INTEGRATING 必须使用在 PASSED 准备的新审批点');
    if (requiresIntegrationApproval) {
      const approvals = matchingApprovals(work, validationContext.readLedger(args.ledger, { required: true }), { approvalId: work.approvalRecord, level: 'A4', gate: 'F4', object: String(args.object ?? ''), actionType: String(args['action-type'] ?? ''), paths: [], targets: [] });
      if (approvals.length !== 1) fail('进入 INTEGRATING 缺少 A4/F4 精确集成审批');
    }
  }
  if (target === 'RELEASE_APPROVAL_REQUIRED' && !work.releaseWorkItem) fail('RELEASE_APPROVAL_REQUIRED 必须使用独立发布 Work Item');
  if (target === 'RELEASING') {
    if (!work.releaseWorkItem || work.pendingApprovalState !== 'RELEASE_APPROVAL_REQUIRED') fail('RELEASING 必须使用独立发布 Work Item 及当前发布审批点');
    const approvals = matchingApprovals(work, validationContext.readLedger(args.ledger, { required: true }), { approvalId: work.approvalRecord, level: 'A6', gate: 'F4', object: String(args.object ?? ''), actionType: String(args['action-type'] ?? ''), paths: [], targets: list(args['external-target']), external: true, release: true });
    if (approvals.length !== 1) fail('没有精确 A6/F4 发布审批');
  }
  if (target === 'COMPLETE') {
    const evidence = evidenceCheck(args, true, validationContext);
    if (work.expectedOutputs.some((item) => !evidence.completedOutputs.includes(item)) || work.exitCriteria.some((item) => !evidence.satisfiedExitCriteria.includes(item))) fail('COMPLETE 前 expectedOutputs/exitCriteria 未全部绑定完成证据');
    const audit = verifyDiffAudit(work, repo, work.diffAuditRecord, validationContext);
    const packagePath = work.implementationPackageRecord ?? args['implementation-package'];
    const pkg = packagePath ? validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work) : null;
    try { assertSceneWorkItemComplete(work, pkg, repo, evidence); } catch (error) { fail(error.message); }
    if (audit.authorizationBasis === 'EXPLICIT_APPROVAL') {
      const requiredLevel = work.releaseWorkItem ? 'A6' : 'A4';
      const currentApproval = validationContext.readLedger(args.ledger, { required: true }).approvals.find((item) => item.approvalId === audit.approvalId && !item.invalidatedAt && item.promptContextId === work.pendingApprovalId && item.pendingState === work.pendingApprovalState && item.pendingContext === work.pendingApprovalContext);
      const f4 = evidence.gateResults.F4;
      if (!currentApproval || currentApproval.actionLevel !== requiredLevel || currentApproval.gate !== 'F4' || Date.parse(evidence.recordedAt) < Date.parse(currentApproval.approvedAt) || f4.status !== 'PASS' || f4.approvalId !== audit.approvalId) fail('COMPLETE 缺少当前精确 F4 集成/发布审批与证据');
    }
  }
  work.globalState = target; validateWorkItem(work);
  if (args['next-gate']) {
    if (!GATES.includes(String(args['next-gate']))) fail('--next-gate 必须为 F0-F4');
    work.nextGate = String(args['next-gate']);
  }
  if (stateWrites.length) writeJsonTransaction([...stateWrites, { path: workPath, value: work, expected: workIdentity }], resolve(repo, '.workflow-control', 'transactions', `transition-${hashText(workPath).slice(7)}.json`));
  else writeJson(workPath, work);
  validationContext.replaceJson(workPath, work, { validated: true });
  if (args.silent !== true) process.stdout.write(JSON.stringify({ ok: true, command: 'transition', workItemId: work.workItemId, globalState: target, return: returnRequest, returnRecord: work.returnRecord ?? null }, null, 2));
}

/** 自动推进一个状态；审批边界和外部动作始终停止，不自动准备或批准。 */
function advance(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(args['work-item'], 'Work Item')); if (work.globalState === 'RETURN') fail('RETURN 恢复路径不能使用 advance；请按 returnRecord 的最小受影响范围显式迁移到 BASELINE、PROPOSAL、REVIEW 或 IMPLEMENTING');
  requireResolvedUserInput(work, fail);
  const implementationPackage = args['implementation-package'] ? validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work) : null;
  visualStageGate(work, { command: 'advance', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo, evidence: args.evidence ? validationContext.readEvidence(args.evidence) : null, implementationPackage });
  const ledger = validationContext.readLedger(args.ledger);
  const approval = effectiveApproval(work, ledger);
  const routeResult = deriveRoute(work, approval);
  if (['EXTERNAL(A5)', 'RELEASE(A6)'].includes(routeResult.channel)) fail('A5/A6 只能人工执行精确批准的外部动作，advance 不会执行');
  let target;
  if (work.globalState === 'REVIEW') target = routeResult.actionLevel === 'A1' ? 'VALIDATING' : ['A2', 'A3'].includes(routeResult.actionLevel) ? 'IMPLEMENTING' : null;
  else if (work.globalState === 'IMPLEMENTING') target = 'VALIDATING';
  else if (work.globalState === 'VALIDATING') target = 'PASSED';
  else if (work.globalState === 'PASSED' && ['A1', 'A2', 'A3'].includes(routeResult.actionLevel)) target = 'COMPLETE';
  else if (work.globalState === 'PASSED' && routeResult.actionLevel === 'A4' && !routeResult.explicitApprovalRequired) target = 'INTEGRATING';
  else if (work.globalState === 'INTEGRATING' && routeResult.actionLevel === 'A4' && !routeResult.explicitApprovalRequired && args.evidence) target = 'COMPLETE';
  else if (['INTAKE', 'BASELINE', 'PROPOSAL'].includes(work.globalState)) target = (TRANSITIONS[work.globalState] ?? [])[0];
  if (!target || target === 'RETURN') fail(target === 'RETURN' ? 'advance 只沿工作流向前推进，不会选择 RETURN；必要回退必须由 transition 显式声明分类、理由和最小受影响范围' : '当前状态不能自动推进；需要新的审批点、F4 决策或人工外部执行');
  transition({ ...args, to: target, object: work.pendingApprovalObject, 'action-type': work.pendingApprovalActionType, 'external-target': work.pendingApprovalExternalTargets, validationContext });
}
/** 输出绑定真实候选与单次 pending 审批点的机器可执行交接包。 */
function handoff(args) {
  const workPath = resolve(String(args['work-item']));
  const repo = resolve(String(args.repo ?? process.cwd()));
  const validationContext = commandValidationContext(repo);
  const work = validateWorkItem(validationContext.readJson(workPath, 'Work Item'));
  const handoffEvidence = args.evidence ? validationContext.readEvidence(args.evidence) : null;
  const implementationPackage = args['implementation-package'] ? validationContext.validateImplementationPackage(validationContext.readJson(args['implementation-package'], 'Implementation Package'), work) : null;
  visualStageGate(work, { command: 'handoff', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo, evidence: handoffEvidence, implementationPackage });
  if (!['A4', 'A5', 'A6'].includes(work.pendingApprovalActionLevel) || !requiresExplicitApproval(work.pendingApprovalActionLevel, { external: work.pendingApprovalExternalWrite, device: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, destructive: work.pendingApprovalDestructive, allowDelete: work.pendingApprovalAllowDelete })) fail('handoff 仅展示 A4-A6 的具体操作及影响；用户选择不得进入审批账本');
  if (work.pendingApprovalState !== work.globalState || work.approvalRecord !== null) fail('handoff 只能针对当前状态新准备且尚未批准的 pending approval');
  const actualEntries = changedEntries(repo, work.baselineId).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  const audit = work.diffAuditRecord ? verifyDiffAudit(work, repo, work.diffAuditRecord, validationContext) : null;
  const evidence = args.evidence ? evidenceCheck(args, true, validationContext) : null;
  const plannedFiles = work.pendingApprovalFileScope;
  const externalTargets = work.pendingApprovalExternalTargets;
  if (plannedFiles.length) checkPaths(plannedFiles, work.allowedPaths, work.forbiddenPaths, repo);
  if (externalTargets.some((target) => !work.allowedExternalTargets.includes(target) || work.protectedExternalTargets.includes(target))) fail('审批交接包含未授权或受保护外部对象');
  const completed = [...new Set([...(evidence?.completedOutputs ?? []), ...actualEntries.map((entry) => `${entry.status}:${entry.file}`)])];
  const notExecuted = evidence ? evidence.uncoveredItems : work.validationPlan.map((item) => `未提供验证证据：${item}`);
  work.pendingApprovalPresentedId = work.pendingApprovalId;
  work.pendingApprovalPresentedAt = new Date().toISOString();
  writeJson(workPath, work);
  const output = {
    workItem: { workItemId: work.workItemId, projectId: work.projectId, moduleIds: work.moduleIds, domain: work.domain, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash },
    stage: { stageId: work.stageId, globalState: work.globalState, nextGate: work.nextGate },
    completed,
    actualModifiedScope: audit?.entries ?? actualEntries,
    notExecuted,
    risks: { prohibitedActions: work.prohibitedActions, forbiddenPaths: work.forbiddenPaths, protectedExternalTargets: work.protectedExternalTargets },
    validation: evidence ? { evidenceId: evidence.evidenceId, verdict: evidence.verdict, gateResults: evidence.gateResults } : { verdict: 'NOT_RUN', gateResults: {} },
    operationApproval: { pendingApprovalId: work.pendingApprovalId, object: work.pendingApprovalObject, stage: work.pendingApprovalStage, actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, impactSummary: work.pendingApprovalImpactSummary, gate: work.pendingApprovalGate, state: work.pendingApprovalState, context: work.pendingApprovalContext, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease },
    plannedFiles,
    externalTargets,
    approvalPrompt: '回复「批准」即可确认当前审批点；该回复只确认本次交接展示的唯一 pending，不会授权后续阶段或扩大范围。',
    acceptedShortReplies: ['批准', '同意', '可以', '继续', '批准然后按流程推进'],
    nextCommand: `node <skill-dir>/scripts/workflow-control.mjs approve --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --approval-id <id> --user-text "批准"`,
    auditApprovalBinding: { pendingApprovalId: work.pendingApprovalId, object: work.pendingApprovalObject, stage: work.pendingApprovalStage, actionLevel: work.pendingApprovalActionLevel, gate: work.pendingApprovalGate, state: work.pendingApprovalState, context: work.pendingApprovalContext, presentedAt: work.pendingApprovalPresentedAt }
  };
  process.stdout.write(JSON.stringify(output, null, 2));
}

/** 仅在控制目录不存在时创建空账本、目录和首个 Work Item。 */
function init(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const controlRoot = resolve(repo, '.workflow-control');
  if (existsSync(controlRoot)) fail('控制目录已存在，禁止重复 bootstrap');
  const record = args.record ? readJson(args.record, 'Bootstrap Record') : {
    workItemId: args['work-item-id'], projectId: args['project-id'], moduleIds: list(args['module-id']).sort(), domain: args.domain, stageId: args['stage-id'], baselineId: args['baseline-id'], baselineVersion: args['baseline-version'], baselineHash: args['baseline-hash'], objective: args.objective, userOriginalText: args['user-text'], explicitObject: args.object, actionLevel: 'A1', allowedPaths: list(args['allowed-path']), pendingApprovalId: args['pending-approval-id']
  };
  requireFields(record, ['workItemId', 'projectId', 'moduleIds', 'domain', 'stageId', 'baselineId', 'baselineVersion', 'objective', 'userOriginalText', 'explicitObject', 'allowedPaths'], 'Bootstrap Record');
  requireStringArray(record.moduleIds, 'Bootstrap.moduleIds');
  record.moduleIds = [...new Set(record.moduleIds)].sort();
  if (!record.moduleIds.length) fail('Bootstrap.moduleIds 不能为空');
  requireStringArray(record.allowedPaths, 'Bootstrap.allowedPaths');
  if (record.actionLevel !== 'A1' || SHORT_APPROVAL.test(record.userOriginalText.trim()) || !record.explicitObject) fail('Bootstrap 必须来自明确 A1 用户原文和对象');
  for (const directory of ['work-items', 'delegations', 'delegations/batches', `evidence/${record.workItemId}`, `evidence/${record.workItemId}/units`, 'change-requests']) mkdirSync(join(controlRoot, directory), { recursive: true });
  const work = {
    workItemId: record.workItemId, projectId: record.projectId, moduleIds: record.moduleIds, domain: record.domain, stageId: record.stageId, globalState: 'INTAKE', baselineId: record.baselineId, baselineVersion: record.baselineVersion, baselineHash: record.baselineHash, objective: record.objective, userOriginalText: record.userOriginalText,
    inScope: [record.explicitObject], outOfScope: [], approvedRequirements: [], allowedActions: ['cocos-inspect', 'cocos-spec-candidate'], allowedActionLevels: ['A0', 'A1'], explicitApprovalActionLevels: [], prohibitedActions: ['cocos-build-upload', 'cocos-device-test', 'cocos-release', 'cocos-game-rollback'], allowedPaths: record.allowedPaths, forbiddenPaths: ['.git'], allowedExternalTargets: [], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null, assignedAgent: 'orchestrator', delegatedAgents: [], expectedOutputs: [], validationPlan: [], exitCriteria: [], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: `.workflow-control/evidence/${record.workItemId}`,
    pendingApprovalId: record.pendingApprovalId ?? `PENDING-${record.workItemId}-F0`, pendingApprovalObject: record.explicitObject, pendingApprovalStage: record.stageId, pendingApprovalActionLevel: 'A1', pendingApprovalGate: 'F0', pendingApprovalState: 'INTAKE', pendingApprovalContext: 'bootstrap', pendingApprovalActionType: 'cocos-spec-candidate', pendingApprovalImpactSummary: [], pendingApprovalFileScope: record.allowedPaths, pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: new Date().toISOString(), pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null, validationBatchId: `BATCH-${record.workItemId}-1`, changeRequestFiles: [], moduleGateRequired: false, releaseWorkItem: false
  };
  writeJson(join(controlRoot, 'work-items', `${record.workItemId}.json`), work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'init', workItem: `.workflow-control/work-items/${record.workItemId}.json` }, null, 2));
}

/** 对控制文件或整个仓库执行完整结构/策略 lint。 */
function lint(args) {
  let checked = 0;
  for (const path of list(args['work-item'])) { const work = validateWorkItem(readJson(path, 'Work Item')); visualStageGate(work, { command: 'lint', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repository === true ? process.cwd() : args.repository ?? process.cwd())) }); checked += 1; }
  for (const path of list(args.ledger)) { readLedger(path); checked += 1; }
  for (const path of list(args.delegation)) { validateDelegation(readJson(path, 'Delegation Package')); checked += 1; }
  for (const path of list(args.evidence)) { validateEvidence(readJson(path, 'Evidence Manifest')); checked += 1; }
  for (const path of list(args['implementation-package'])) { validateImplementationPackageShape(readJson(path, 'Implementation Package'), { projectRoot: resolve(String(args.repository === true ? process.cwd() : args.repository ?? process.cwd())), checkFiles: true }); checked += 1; }
  for (const path of list(args['change-request'])) { validateChangeRequestShape(readJson(path, 'Change Request')); checked += 1; }
  if (args.repository) { const repo = resolve(String(args.repository === true ? process.cwd() : args.repository)); const workRoot = join(repo, '.workflow-control', 'work-items'); if (existsSync(workRoot)) for (const name of readdirSync(workRoot).filter((item) => item.endsWith('.json')).sort()) { const work = validateWorkItem(readJson(join(workRoot, name), 'Work Item')); visualStageGate(work, { command: 'lint', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo }); checked += 1; } repositoryLint(repo, fail); checked += 1; }
  if (!checked) fail('lint 至少需要一种控制文件或 --repository');
  process.stdout.write(JSON.stringify({ ok: true, command: 'lint', checked }, null, 2));
}

const HELP_COMMANDS = ['run', 'check', 'status', 'init', 'route', 'advance', 'prepare-approval', 'handoff', 'preflight', 'approve', 'delegate-check', 'parallel-check', 'unit-check', 'diff-audit', 'evidence-check', 'transition', 'lint'];
const COMMAND_HELP = {
  transition: '用法：node <skill-dir>/scripts/workflow-control.mjs transition --repo <目录> --work-item <文件> --to <状态> [--visual-stage V3|V4] [--visual-stage-state <状态>]\nV2→V3 进入 REVIEW；V3 正式资源验收后通过 A3 激活新包，直接进入 V4/IMPLEMENTING。阶段通过须绑定真实证据。',
  run: '用法：node <skill-dir>/scripts/workflow-control.mjs run --repo <目录> --work-item <文件> [--input <文件>]... [--json]\n必填：--repo、--work-item；连续推进已满足条件的 A0-A3 控制面状态，进入 IMPLEMENTING 或遇到门禁即停止。',
  check: '用法：node <skill-dir>/scripts/workflow-control.mjs check --repo <目录> --work-item <文件> [--implementation-package <文件>] [--evidence <文件>] [--input <文件>]... [--json]\n必填：--repo、--work-item；只读校验，不写入工件。',
  status: '用法：node <skill-dir>/scripts/workflow-control.mjs status --repo <目录> --work-item <文件> [--input <文件>]... [--json]\n必填：--repo、--work-item；输出最小状态、阻断原因和下一动作。',
  init: '用法：node <skill-dir>/scripts/workflow-control.mjs init --repo <目录> --work-item-id <id> --project-id <id> --module-id <module> --domain <domain> --stage-id <stage> --baseline-id <git-id> --baseline-version <version> [--baseline-hash <摘要记录>] --objective "<目标>" --user-text "<用户原文>" --object "<对象>" --allowed-path <path>...\n必填：除 --baseline-hash 外的 Bootstrap Record 字段；--module-id、--allowed-path 可重复。也可用 --record <bootstrap.json>。',
};

/** 输出只读顶层或命令级帮助；未知命令仍保持明确拒绝。 */
function help(command = null) {
  if (command && !HELP_COMMANDS.includes(command)) fail(`未知命令 ${command}`);
  const text = command ? (COMMAND_HELP[command] ?? `用法：node <skill-dir>/scripts/workflow-control.mjs ${command} [选项]`) : `用法：node <skill-dir>/scripts/workflow-control.mjs <${HELP_COMMANDS.join('|')}> [选项]\n命令级帮助：help <command>、<command> --help 或 <command> -h。\n稳定入口：run/check/status/init。`;
  process.stdout.write(`${text}\n`);
}
const stableCommands = createStableCommands({
  validateWorkItem, readJson, validateImplementationPackage, loadVisualManifestSnapshot,
  visualConfirmationAuthority,
  validateVisualStagePrerequisites, structuredVisualStageFailure, evidenceCheck,
  readLedger, deriveRoute, effectiveApproval, computePlanFingerprint, executionStateSummary,
  loadExecutionState, unitIo, assertExecutionWorkflowComplete, assertSceneWorkItemComplete, transition,
});
const [rawCommand, ...rest] = process.argv.slice(2);
const command = rawCommand === '--help' || rawCommand === '-h' ? 'help' : rawCommand;
const args = parseArgs(rest);
const commands = { ...stableCommands, init, route, advance, 'prepare-approval': prepareApproval, handoff, preflight, approve, 'delegate-check': delegateCheck, 'parallel-check': parallelCheck, 'unit-check': unitCheck, 'diff-audit': diffAudit, 'evidence-check': evidenceCheck, transition, lint };
try {
  if (!command || command === 'help') help(args._?.[0] ?? null);
  else if (args.help === true) help(command);
  else {
    const result = (commands[command] ?? (() => fail(`未知命令 ${command}`)))(args);
    // run/check 的阻断必须让自动化立即停止；status 仅查询，即使展示阻断也保持成功退出。
    if (['run', 'check'].includes(command) && result?.status === 'BLOCKED') process.exitCode = 2;
  }
} catch (error) {
  const code = Number.isInteger(error?.code) ? error.code : 2;
  if (['run', 'check', 'status'].includes(command)) {
    const details = error?.result ? structuredVisualStageFailure(error, command) : error?.details;
    const output = failureRecord(details ? { ...error, details } : error, String(args.stage ?? 'unknown'));
    if (args.json === true || args.json === 'true') process.stderr.write(`${JSON.stringify(output)}\n`);
    else process.stderr.write(renderResult(output));
  } else if (error?.result) {
    process.stderr.write(`${JSON.stringify(structuredVisualStageFailure(error, command), null, 2)}\n`);
  } else if (error?.details?.errorCode && error?.details?.message) {
    process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  } else {
    process.stderr.write(`拒绝：${error?.message ?? error}\n`);
  }
  process.exitCode = code;
}
